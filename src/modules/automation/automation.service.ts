import { BrowserManager } from '@/infrastructure/playwright/browser.manager';
import { AppError } from '@/shared/errors/AppError';
import {
  assertSafeUrl,
  NON_NETWORK_PROTOCOLS,
  UnsafeUrlError,
} from '@/shared/security/url-guard';
import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  HeadingEvidence,
  ImageEvidence,
  LinkEvidence,
  ButtonEvidence,
  FormEvidence,
  FormElementEvidence,
  LandmarkEvidence,
  ComputedStyleEvidence,
} from '@/modules/snapshots/snapshot-evidence.model';

export interface InteractiveElement {
  selector?: string;
  type: 'button' | 'input' | 'link' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'image' | 'other';
  text: string | null;
  ariaLabel: string | null;
  role: string | null;
  isDisabled: boolean;
  isPrimary: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  domSnapshot: string;
  metaDescription?: string;
  headings: HeadingEvidence[];
  images: ImageEvidence[];
  links: LinkEvidence[];
  buttons: ButtonEvidence[];
  forms: FormEvidence[];
  landmarks: LandmarkEvidence[];
  computedStyles: ComputedStyleEvidence[];
  /** J4 Step 2a — larger, bounded candidate pool (up to 500) for the Gemini-facing dedup+prioritization pipeline. Never read by DeterministicAnalyzer. */
  computedStylesCandidates: ComputedStyleEvidence[];
  accessibilityTree?: string;
  visibleDOMSummary?: InteractiveElement[];
}

export interface NavigationResult {
  success: boolean;
  finalUrl: string;
  statusCode?: number;
  loadTimeMs: number;
}

/**
 * Phase 2.2.1 — Unique, verified, Playwright-consumable CSS selector.
 *
 * A candidate is only ever returned if it is EXPLICITLY verified — never
 * assumed — to resolve to exactly one element, AND that element is the
 * original one: `document.querySelectorAll(sel)` has length 1 and its
 * single match `=== el`. This is required because `id`/`aria-label`/`name`
 * are not guaranteed unique in real-world markup (duplicate ids do happen),
 * and a bare `tag:nth-of-type(n)` relative only to the immediate parent is
 * NOT globally unique — confirmed real: a single real page produced the
 * exact same selector string for 5 different <a> elements (different
 * href/text each), which corrupted DeterministicAnalyzer, evidence
 * deduplication keys, and the evidence Gemini received.
 *
 * No DOM mutation: this only ever reads attributes/structure, never writes
 * anything to the page under evaluation.
 *
 * Defined here (module scope, self-contained — only browser globals, no
 * closure over anything outside itself) so it is a single source of truth
 * runnable both from `extractCurrentSnapshot`'s real Playwright evaluate
 * call (via its serialized source, reconstructed inside the page context —
 * see below) and directly from tests against a real Playwright page,
 * without duplicating the algorithm.
 */
export function getCssSelector(el: Element): string {
  const isUniqueMatch = (sel: string, target: Element): boolean => {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(sel);
    } catch {
      return false; // invalid selector syntax for this candidate
    }
    return matches.length === 1 && matches[0] === target;
  };

  const escapeAttrValue = (v: string) => v.replace(/"/g, '\\"');

  // Builds a `parent > child` path selector, growing it segment by segment
  // from `el` upward until the accumulated suffix is verified unique+correct
  // — giving the shortest sufficient path rather than always walking all
  // the way to <html>. Each segment uses `tag:nth-of-type(n)` (n = position
  // among same-tag siblings under that exact parent) only when there is
  // more than one such sibling, otherwise the bare tag.
  //
  // A full such path from any element up to <html> is unique by
  // construction (two different nodes can never share the same parent AND
  // the same same-tag-sibling index under that parent — that would make
  // them the same node), so this loop is guaranteed to find a
  // verified-unique match at or before the root. The explicit
  // `isUniqueMatch` check at every step still gates the return, per the
  // "never assume" requirement.
  const buildAncestorPathSelector = (target: Element): string => {
    const segments: string[] = [];
    let node: Element | null = target;

    while (node) {
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;

      let segment = tag;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (c) => c.tagName === node!.tagName,
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(node) + 1;
          segment = `${tag}:nth-of-type(${index})`;
        }
      }
      segments.unshift(segment);

      const candidate = segments.join(' > ');
      if (isUniqueMatch(candidate, target)) {
        return candidate;
      }

      if (!parent) break;
      node = parent;
    }

    // Residual fallback: should not be reachable for any element attached
    // to `document` (see proof above) — kept only so the function always
    // returns a string instead of throwing.
    return segments.join(' > ');
  };

  if (el.id) {
    const idSelector = `#${CSS.escape(el.id)}`;
    if (isUniqueMatch(idSelector, el)) return idSelector;
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const ariaSelector = `[aria-label="${escapeAttrValue(ariaLabel)}"]`;
    if (isUniqueMatch(ariaSelector, el)) return ariaSelector;
  }

  const name = el.getAttribute('name');
  if (name) {
    const nameSelector = `[name="${escapeAttrValue(name)}"]`;
    if (isUniqueMatch(nameSelector, el)) return nameSelector;
  }

  return buildAncestorPathSelector(el);
}

/**
 * AutomationService — Controls all Playwright browser interactions.
 * 
 * In V2, this service is stateful and maintains browser contexts open
 * mapped by evaluationId so that iterations run within the same page session.
 */
export class AutomationService {
  private browserManager: BrowserManager;
  private activeSessions: Map<string, { page: Page; close: () => Promise<void> }> = new Map();

  constructor() {
    this.browserManager = BrowserManager.getInstance();
  }

  /**
   * SSRF guard: installs a request-interception handler on the page so that
   * every request it makes — the initial navigation, redirects, dynamic
   * NAVIGATE actions proposed by RuleEngine/AI, and any sub-resource the
   * target page itself triggers — is validated before Chromium is allowed to
   * connect. Re-checking per-request (rather than only once at DTO
   * validation time) is what actually protects against redirects and
   * DNS-rebinding between the initial check and the real navigation.
   */
  private async installNetworkGuard(page: Page): Promise<void> {
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();

      let protocol: string;
      try {
        protocol = new URL(requestUrl).protocol;
      } catch {
        await route.abort('blockedbyclient');
        return;
      }

      if (NON_NETWORK_PROTOCOLS.has(protocol)) {
        await route.continue();
        return;
      }

      try {
        await assertSafeUrl(requestUrl);
        await route.continue();
      } catch (err) {
        console.warn(
          `[AutomationService] Blocked unsafe request: ${requestUrl} — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await route.abort('blockedbyclient');
      }
    });
  }

  /**
   * Starts a new stateful browser session for a specific evaluation.
   */
  async startSession(evaluationId: string, url: string): Promise<NavigationResult> {
    // Re-validate at execution time even if the DTO already checked this URL:
    // the job may run asynchronously after creation, and DNS can change
    // between the two checks (DNS rebinding).
    try {
      await assertSafeUrl(url);
    } catch (err) {
      throw new AppError(
        err instanceof UnsafeUrlError ? err.message : `Unsafe target URL: ${url}`,
        400,
      );
    }

    if (this.activeSessions.has(evaluationId)) {
      await this.closeSession(evaluationId);
    }

    const { page, close } = await this.browserManager.newPage();
    this.activeSessions.set(evaluationId, { page, close });
    await this.installNetworkGuard(page);

    const startTime = Date.now();
    try {
      let statusCode: number | undefined;

      page.on('response', (response) => {
        if (response.url() === url) {
          statusCode = response.status();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle' });
      const finalUrl = page.url();
      const loadTimeMs = Date.now() - startTime;

      return { success: true, finalUrl, statusCode, loadTimeMs };
    } catch (error) {
      await close();
      this.activeSessions.delete(evaluationId);
      throw new AppError(
        `Failed to start session on ${url}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
  }

  /**
   * TEST-ONLY seam (Fase 2.3, Fase A — testing infrastructure).
   *
   * Registers a real Playwright page (same `BrowserManager.newPage()` +
   * `installNetworkGuard` as `startSession`) directly into `activeSessions`,
   * loading a local HTML fixture via `page.setContent()` instead of
   * navigating to a URL. This intentionally bypasses `assertSafeUrl` — the
   * SSRF guard correctly rejects loopback/private addresses and `data:`
   * navigation for real evaluations, which also makes it impossible to
   * serve a local fixture through `startSession` as-is. This method exists
   * so the test suite can exercise `extractCurrentSnapshot`/`executeAction`
   * against local, deterministic fixtures for real, without weakening the
   * guard for actual evaluation traffic.
   *
   * MUST NEVER be called from any production code path (evaluation.service.ts,
   * controllers, RuleEngine, etc.) — only from test files.
   */
  async attachTestSession(evaluationId: string, html: string): Promise<void> {
    if (this.activeSessions.has(evaluationId)) {
      await this.closeSession(evaluationId);
    }

    const { page, close } = await this.browserManager.newPage();
    this.activeSessions.set(evaluationId, { page, close });
    await this.installNetworkGuard(page);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  }

  /**
   * Extracts snapshot of the current state of the page in the active session.
   */
  async extractCurrentSnapshot(evaluationId: string): Promise<PageSnapshot> {
    const session = this.activeSessions.get(evaluationId);
    if (!session) {
      throw new AppError(`No active browser session found for evaluation ${evaluationId}`, 404);
    }

    const { page } = session;

    try {
      const snapshot = await page.evaluate((getCssSelectorSource: string): Omit<PageSnapshot, 'accessibilityTree'> => {
        const getText = (el: Element) => el.textContent?.trim() ?? '';

        // Reconstructed from the exported `getCssSelector` in this same
        // module (see its definition above `PageSnapshot` for the full
        // algorithm/rationale) — single source of truth shared with tests
        // that exercise it directly against a real Playwright page, instead
        // of duplicating the implementation here.
        // eslint-disable-next-line no-new-func
        const getCssSelector: (el: Element) => string = new Function(`return (${getCssSelectorSource});`)();

        // Helper to extract interactive elements for visibleDOMSummary (Preserved 100% for Phase 1)
        const getInteractiveElements = (): InteractiveElement[] => {
          const rawElements = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]'));

          // Filter out elements that are not effectively visible or not genuinely interactable in the current viewport
          const elements = rawElements.filter((el): boolean => {
            // 1. Explicit HTML hidden, inert, or aria-hidden container
            if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
            if (el.hasAttribute('inert') || el.closest('[inert]')) return false;
            if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false;

            // 2. Computed styles: display, visibility, opacity
            const style = window.getComputedStyle(el);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
            if (parseFloat(style.opacity || '1') === 0) return false;

            // 3. Modern browser checkVisibility API if available in Chromium
            if (typeof el.checkVisibility === 'function') {
              if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                return false;
              }
            }

            // 4. Geometry and layout dimensions: element must occupy physical pixels in layout
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if (el.getClientRects().length === 0) return false;

            // 5. Exclude invisible screen-reader-only utility elements (e.g. .sr-only / .visually-hidden with 1x1 rect)
            if (rect.width <= 1 && rect.height <= 1) return false;

            // 6. Exclude accessibility "skip links" (e.g. <a href="#main" class="sf-skip-link">
            // Skip to main content</a>): deliberately positioned far outside the canvas until
            // they receive keyboard focus, but with a normal, positive-size bounding box that
            // passes every check above. Playwright can never click/scroll to these the way a
            // real user would (focus-only, not mouse-only), so a timeout here is not a flaky
            // edge case -- it is guaranteed. Two independent, narrow signals, NEITHER of which
            // excludes ordinary below-the-fold content (positive coordinates, reachable by
            // scrollIntoViewIfNeeded, are never touched by either check):
            //   a) Geometry: coordinates placed far into negative space (the standard
            //      "position offscreen until focus" technique), not merely "outside the
            //      current scroll position" (which below-the-fold content also is).
            //   b) Known naming convention: class or href fragment matching the skip-link
            //      pattern, regardless of its current position.
            const OFF_CANVAS_THRESHOLD = -1000;
            const isFarOffCanvas =
              rect.top < OFF_CANVAS_THRESHOLD ||
              rect.left < OFF_CANVAS_THRESHOLD ||
              rect.bottom < OFF_CANVAS_THRESHOLD ||
              rect.right < OFF_CANVAS_THRESHOLD;
            if (isFarOffCanvas) return false;

            const classAttr = (el.getAttribute('class') || '').toLowerCase();
            const hrefAttr = (el.getAttribute('href') || '').toLowerCase();
            const isSkipLinkClass = /skip[-_]?(to[-_]?)?(content|main|nav|link)/.test(classAttr);
            const isSkipLinkHref = /^#(main|content|maincontent|main-content|skip)/.test(hrefAttr);
            if (isSkipLinkClass || isSkipLinkHref) return false;

            return true;
          });
          
          return elements.map((el): InteractiveElement => {
            const tagName = el.tagName.toLowerCase();
            const roleAttr = el.getAttribute('role');
            const typeAttr = el.getAttribute('type');

            let type: InteractiveElement['type'] = 'other';
            if (tagName === 'a' || roleAttr === 'link') {
              type = 'link';
            } else if (tagName === 'button' || roleAttr === 'button' || typeAttr === 'button' || typeAttr === 'submit') {
              type = 'button';
            } else if (tagName === 'textarea') {
              type = 'textarea';
            } else if (tagName === 'select') {
              type = 'select';
            } else if (tagName === 'input') {
              if (typeAttr === 'checkbox' || roleAttr === 'checkbox') {
                type = 'checkbox';
              } else if (typeAttr === 'radio' || roleAttr === 'radio') {
                type = 'radio';
              } else {
                type = 'input';
              }
            }

            const text = getText(el) || el.getAttribute('value') || '';
            const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('alt') || el.getAttribute('title') || '';
            
            // Accurate evaluation of disabled state
            const style = window.getComputedStyle(el);
            const isHtmlDisabled = el.hasAttribute('disabled') || (el as any).disabled === true;
            const isAriaDisabled = el.getAttribute('aria-disabled') === 'true';
            const isClassDisabled = (el.getAttribute('class') || '').toLowerCase().includes('disabled');
            const isPointerNone = style.pointerEvents === 'none';
            const isDisabled = isHtmlDisabled || isAriaDisabled || isClassDisabled || isPointerNone;
            
            // `el.className` is a plain string on HTMLElement but an
            // SVGAnimatedString (no `.toLowerCase`) on SVGElement — this
            // selector includes `[role="button"]`/`[role="link"]`/etc,
            // which also match SVG elements (e.g. an inline SVG used as a
            // mobile-menu toggle). `getAttribute('class')` returns the raw
            // attribute value as a string for both HTML and SVG elements,
            // so it avoids the type difference entirely.
            const className = (el.getAttribute('class') || '').toLowerCase();
            const isPrimary = className.includes('primary') || className.includes('btn-primary') || typeAttr === 'submit' || el.getAttribute('aria-primary') === 'true';

            return {
              selector: getCssSelector(el),
              type,
              text: text ? text.slice(0, 100) : null,
              ariaLabel: ariaLabel ? ariaLabel.slice(0, 150) : null,
              role: roleAttr || null,
              isDisabled,
              isPrimary
            };
          });
        };

        // 1. Headings
        const headings: HeadingEvidence[] = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => ({
          level: parseInt(h.tagName[1] as string, 10),
          text: getText(h),
          selector: getCssSelector(h),
        }));

        // 2. Images
        const images: ImageEvidence[] = Array.from(document.querySelectorAll('img')).map((img) => {
          const altAttr = img.getAttribute('alt');
          const isDecorative = altAttr === '' || img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true';
          return {
            selector: getCssSelector(img),
            src: img.src || '',
            alt: altAttr !== null ? altAttr : null,
            ariaLabel: img.getAttribute('aria-label'),
            role: img.getAttribute('role'),
            isDecorative,
          };
        });

        // 3. Links
        const links: LinkEvidence[] = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          selector: getCssSelector(a),
          text: getText(a),
          href: (a as HTMLAnchorElement).href || '',
          ariaLabel: a.getAttribute('aria-label'),
          role: a.getAttribute('role'),
          isExternal: (a as HTMLAnchorElement).hostname !== window.location.hostname,
        }));

        // 4. Buttons
        const buttons: ButtonEvidence[] = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')).map((btn) => {
          // Same SVGAnimatedString issue as above: this query also matches
          // `[role="button"]`, which can be an SVG element.
          const className = (btn.getAttribute('class') || '').toLowerCase();
          const typeAttr = btn.getAttribute('type');
          const isPrimary = className.includes('primary') || className.includes('btn-primary') || typeAttr === 'submit' || btn.getAttribute('aria-primary') === 'true';
          return {
            selector: getCssSelector(btn),
            tag: btn.tagName.toLowerCase(),
            text: getText(btn) || btn.getAttribute('value') || null,
            ariaLabel: btn.getAttribute('aria-label'),
            role: btn.getAttribute('role'),
            isDisabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true',
            isPrimary,
          };
        });

        // 5. Forms
        const forms: FormEvidence[] = Array.from(document.querySelectorAll('form')).map((form) => {
          const elements: FormElementEvidence[] = Array.from(form.querySelectorAll('input, select, textarea, button')).map((el) => {
            const inputType = el.getAttribute('type') || el.tagName.toLowerCase();
            const nameAttr = el.getAttribute('name');
            let labelText: string | null = null;
            if (el.id) {
              const labelEl = document.querySelector(`label[for="${el.id}"]`);
              if (labelEl) labelText = getText(labelEl);
            }
            if (!labelText && el.parentElement?.tagName.toLowerCase() === 'label') {
              labelText = getText(el.parentElement);
            }

            return {
              selector: getCssSelector(el),
              type: inputType,
              name: nameAttr,
              label: labelText,
              ariaLabel: el.getAttribute('aria-label'),
              ariaLabelledBy: el.getAttribute('aria-labelledby'),
              ariaDescribedBy: el.getAttribute('aria-describedby'),
              required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
              placeholder: el.getAttribute('placeholder'),
              ariaInvalid: el.getAttribute('aria-invalid') === 'true',
            };
          });

          return {
            selector: getCssSelector(form),
            name: form.getAttribute('name'),
            action: form.getAttribute('action'),
            elements,
          };
        });

        // 6. Landmarks
        const landmarkSelectors = 'header, nav, main, aside, footer, form, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"]';
        const landmarks: LandmarkEvidence[] = Array.from(document.querySelectorAll(landmarkSelectors)).map((lm) => {
          let type = lm.tagName.toLowerCase();
          const role = lm.getAttribute('role');
          if (role) type = role;
          return {
            type,
            selector: getCssSelector(lm),
            ariaLabel: lm.getAttribute('aria-label'),
          };
        });

        // 7. Computed Styles.
        //
        // J4 Step 2a (Hardening Post-Fase H): the `.slice(0, 50)` cap used to
        // apply directly to the query result, meaning any element beyond
        // position 50 in DOM order was NEVER measured, anywhere, for any
        // consumer — a silent loss confirmed by the J4 Step 2 design audit
        // (label/p/standalone-input have no other evidence source at all).
        //
        // Fix: query a larger, still-BOUNDED candidate pool
        // (COMPUTED_STYLE_CANDIDATE_LIMIT = 500 — an order of magnitude
        // above the existing budget of 50, not "the whole DOM"; a
        // deliberately simple, explainable starting point, not tuned
        // against real traffic yet) and compute styles for all of them
        // once. Two views are then derived from the SAME candidate array:
        //   - `computedStyles` (UNCHANGED field/semantics): the first 50 in
        //     DOM order — byte-identical to what `.slice(0, 50)` on the raw
        //     query always produced. This is the ONLY field
        //     DeterministicAnalyzer reads (see deterministic-analyzer.
        //     service.ts, analyzeContrast) — kept 100% stable so the
        //     contrast rule's findings/statuses/scores never change because
        //     of this capture change (verified in J4 Step 2's regression
        //     suite, not just assumed).
        //   - `computedStylesCandidates` (NEW field): the full bounded pool,
        //     consumed ONLY by the Gemini-facing dedup+prioritization
        //     pipeline (evidence-deduplication.service.ts /
        //     evidence-prioritization.service.ts) — never by
        //     DeterministicAnalyzer.
        const COMPUTED_STYLE_CANDIDATE_LIMIT = 500;
        const styleCandidateElements = Array.from(
          document.querySelectorAll('h1, h2, h3, h4, h5, h6, button, [role="button"], a[href], input, select, textarea, label, p'),
        ).slice(0, COMPUTED_STYLE_CANDIDATE_LIMIT);
        const computedStylesCandidates: ComputedStyleEvidence[] = styleCandidateElements.map((el) => {
          let style: CSSStyleDeclaration | null = null;
          try {
            style = window.getComputedStyle(el);
          } catch (e) {
            // Ignore
          }
          return {
            selector: getCssSelector(el),
            tag: el.tagName.toLowerCase(),
            text: getText(el).slice(0, 80),
            color: style?.color || '',
            backgroundColor: style?.backgroundColor || '',
            fontSize: style?.fontSize || '',
            fontWeight: style?.fontWeight || '',
            lineHeight: style?.lineHeight || '',
            fontFamily: style?.fontFamily || '',
          };
        });
        // Identical to the old `.slice(0, 50)` on the same query — same
        // elements, same order, same values (slicing a 500-cap array down
        // to 50 yields exactly the same first 50 as slicing the unbounded
        // query directly).
        const computedStyles: ComputedStyleEvidence[] = computedStylesCandidates.slice(0, 50);

        return {
          url: window.location.href,
          title: document.title,
          domSnapshot: document.documentElement.outerHTML,
          metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? undefined,
          headings,
          images,
          links,
          buttons,
          forms,
          landmarks,
          computedStyles,
          computedStylesCandidates,
          visibleDOMSummary: getInteractiveElements(),
        };
      }, getCssSelector.toString());

      // Extract accessibility tree using Playwright's native ARIA snapshot API
      let accessibilityTree: string | undefined;
      try {
        accessibilityTree = await page.locator('html').ariaSnapshot();
      } catch (err) {
        console.warn(`[AutomationService] Failed to extract accessibility tree:`, err);
      }

      return {
        ...snapshot,
        accessibilityTree,
      };
    } catch (error) {
      throw new AppError(
        `Failed to extract snapshot: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
  }

  /**
   * Captures a screenshot of the current page in the active session and writes it to disk.
   * Returns the relative URL path to access the static file.
   */
  async captureAndSaveScreenshot(evaluationId: string, iteration: number): Promise<string> {
    const session = this.activeSessions.get(evaluationId);
    if (!session) {
      throw new AppError(`No active browser session found for evaluation ${evaluationId}`, 404);
    }

    const { page } = session;
    const uploadDir = path.join(process.cwd(), 'uploads');

    // Ensure uploads directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `evaluation_${evaluationId}_step_${iteration}.png`;
    const filepath = path.join(uploadDir, filename);

    try {
      await page.screenshot({ path: filepath, fullPage: true });
      return `/uploads/${filename}`;
    } catch (error) {
      throw new AppError(
        `Failed to capture screenshot: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
  }

  /**
   * Executes a suggested browser action in the active session.
   */
  async executeAction(
    evaluationId: string,
    action: { actionType: string; selector?: string; value?: string; targetElement?: { matchStrategy?: string; value?: string } },
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.activeSessions.get(evaluationId);
    if (!session) {
      throw new AppError(`No active browser session found for evaluation ${evaluationId}`, 404);
    }

    const { page } = session;
    let targetSelector = action.selector || action.targetElement?.value;

    // Resolve semantic match strategies into actionable Playwright selectors
    if (action.targetElement && action.targetElement.matchStrategy && action.targetElement.matchStrategy !== 'CSS' && action.targetElement.matchStrategy !== 'XPATH') {
      const strat = action.targetElement.matchStrategy;
      const val = action.targetElement.value;
      if (strat === 'LABEL') {
        targetSelector = `[aria-label="${val}"]`;
      } else if (strat === 'TEXT') {
        targetSelector = `text="${val}"`;
      } else if (strat === 'ROLE') {
        targetSelector = `[role="${val}"]`;
      } else if (strat === 'PLACEHOLDER') {
        targetSelector = `[placeholder="${val}"]`;
      } else if (strat === 'ALT_TEXT') {
        targetSelector = `[alt="${val}"]`;
      } else if (strat === 'TEST_ID') {
        targetSelector = `[data-testid="${val}"]`;
      }
    }

    try {
      switch (action.actionType.toUpperCase()) {
        case 'CLICK':
          if (!targetSelector) throw new Error('CLICK action requires a selector');
          await page.click(targetSelector, { timeout: 10000 });
          break;

        case 'TYPE':
          if (!targetSelector) throw new Error('TYPE action requires a selector');
          await page.fill(targetSelector, action.value || '', { timeout: 10000 });
          break;

        case 'SELECT':
          if (!targetSelector) throw new Error('SELECT action requires a selector');
          await page.selectOption(targetSelector, action.value || '', { timeout: 10000 });
          break;

        case 'CHECK':
          if (!targetSelector) throw new Error('CHECK action requires a selector');
          await page.check(targetSelector, { timeout: 10000 });
          break;

        case 'UNCHECK':
          if (!targetSelector) throw new Error('UNCHECK action requires a selector');
          await page.uncheck(targetSelector, { timeout: 10000 });
          break;

        case 'HOVER':
          if (!targetSelector) throw new Error('HOVER action requires a selector');
          await page.hover(targetSelector, { timeout: 10000 });
          break;

        case 'FOCUS':
          if (!targetSelector) throw new Error('FOCUS action requires a selector');
          await page.focus(targetSelector, { timeout: 10000 });
          break;

        case 'CLEAR':
          if (!targetSelector) throw new Error('CLEAR action requires a selector');
          await page.fill(targetSelector, '', { timeout: 10000 });
          break;

        case 'NAVIGATE':
          if (!action.value) throw new Error('NAVIGATE action requires a URL in value');
          await assertSafeUrl(action.value);
          await page.goto(action.value, { waitUntil: 'networkidle', timeout: 30000 });
          break;

        case 'STOP_FLOW':
          break;

        default:
          throw new Error(`Unsupported action type: ${action.actionType}`);
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Closes the active session for an evaluation.
   */
  async closeSession(evaluationId: string): Promise<void> {
    const session = this.activeSessions.get(evaluationId);
    if (session) {
      try {
        await session.close();
      } catch (err) {
        console.warn(`[AutomationService] Error closing session for ${evaluationId}:`, err);
      } finally {
        this.activeSessions.delete(evaluationId);
      }
    }
  }
}

export const automationService = new AutomationService();
