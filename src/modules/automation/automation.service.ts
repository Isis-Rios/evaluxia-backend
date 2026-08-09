import { BrowserManager } from '@/infrastructure/playwright/browser.manager';
import { AppError } from '@/shared/errors/AppError';
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
   * Starts a new stateful browser session for a specific evaluation.
   */
  async startSession(evaluationId: string, url: string): Promise<NavigationResult> {
    if (this.activeSessions.has(evaluationId)) {
      await this.closeSession(evaluationId);
    }

    const { page, close } = await this.browserManager.newPage();
    this.activeSessions.set(evaluationId, { page, close });

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
   * Extracts snapshot of the current state of the page in the active session.
   */
  async extractCurrentSnapshot(evaluationId: string): Promise<PageSnapshot> {
    const session = this.activeSessions.get(evaluationId);
    if (!session) {
      throw new AppError(`No active browser session found for evaluation ${evaluationId}`, 404);
    }

    const { page } = session;

    try {
      const snapshot = await page.evaluate((): Omit<PageSnapshot, 'accessibilityTree'> => {
        const getText = (el: Element) => el.textContent?.trim() ?? '';

        const getCssSelector = (el: Element): string => {
          if (el.id) return `#${el.id}`;
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
          const name = el.getAttribute('name');
          if (name) return `[name="${name.replace(/"/g, '\\"')}"]`;
          const tag = el.tagName.toLowerCase();
          const parent = el.parentElement;
          if (!parent) return tag;
          const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(el) + 1;
            return `${tag}:nth-of-type(${index})`;
          }
          return tag;
        };

        // Helper to extract interactive elements for visibleDOMSummary (Preserved 100% for Phase 1)
        const getInteractiveElements = (): InteractiveElement[] => {
          const elements = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]'));
          
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
            const isDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
            
            const className = el.className.toLowerCase();
            const isPrimary = className.includes('primary') || className.includes('btn-primary') || typeAttr === 'submit' || el.getAttribute('aria-primary') === 'true';

            return {
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
          const className = btn.className.toLowerCase();
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

        // 7. Computed Styles (Limited to 50 key visual/text elements to prevent payload bloat)
        const styleTargetElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, button, [role="button"], a[href], input, select, textarea, label, p')).slice(0, 50);
        const computedStyles: ComputedStyleEvidence[] = styleTargetElements.map((el) => {
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
          visibleDOMSummary: getInteractiveElements(),
        };
      });

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
    const targetSelector = action.selector || action.targetElement?.value;

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
