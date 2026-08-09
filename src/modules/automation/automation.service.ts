import { BrowserManager } from '@/infrastructure/playwright/browser.manager';
import { AppError } from '@/shared/errors/AppError';
import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';

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
  headings: { level: number; text: string }[];
  images: { src: string; alt: string }[];
  links: { href: string; text: string; isExternal: boolean }[];
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

        // Helper to extract interactive elements for visibleDOMSummary
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

        return {
          url: window.location.href,
          title: document.title,
          domSnapshot: document.documentElement.outerHTML,
          metaDescription:
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute('content') ?? undefined,
          headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
            (h) => ({
              level: parseInt(h.tagName[1] as string),
              text: getText(h),
            }),
          ),
          images: Array.from(document.querySelectorAll('img')).map((img) => ({
            src: img.src,
            alt: img.alt,
          })),
          links: Array.from(document.querySelectorAll('a[href]')).map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: getText(a),
            isExternal: (a as HTMLAnchorElement).hostname !== window.location.hostname,
          })),
          visibleDOMSummary: getInteractiveElements()
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
   * Executes a suggested action in the active session page.
   */
  async executeAction(
    evaluationId: string,
    actionType: string,
    matchStrategy: string,
    selectorValue: string,
    actionData?: string
  ): Promise<void> {
    const session = this.activeSessions.get(evaluationId);
    if (!session) {
      throw new AppError(`No active browser session found for evaluation ${evaluationId}`, 404);
    }

    const { page } = session;

    // Resolve the selector based on matchStrategy
    const selector = this.resolveSelector(matchStrategy, selectorValue);

    console.log(`[AutomationService] Executing ${actionType} on selector: ${selector}`);

    try {
      switch (actionType.toUpperCase()) {
        case 'CLICK':
          await page.click(selector);
          break;
        case 'TYPE':
          await page.fill(selector, actionData ?? '');
          break;
        case 'HOVER':
          await page.hover(selector);
          break;
        case 'FOCUS':
          await page.focus(selector);
          break;
        case 'CLEAR':
          await page.fill(selector, '');
          break;
        case 'CHECK':
          await page.check(selector);
          break;
        case 'UNCHECK':
          await page.uncheck(selector);
          break;
        case 'WAIT_FOR_ELEMENT':
          await page.waitForSelector(selector);
          break;
        case 'WAIT':
          const ms = parseInt(selectorValue, 10) || 1000;
          await page.waitForTimeout(ms);
          break;
        case 'NAVIGATE':
          await page.goto(selectorValue, { waitUntil: 'networkidle' });
          break;
        case 'SELECT':
        case 'SELECT_OPTION':
          await page.selectOption(selector, actionData || selectorValue);
          break;
        default:
          throw new AppError(`Unsupported action type: ${actionType}`, 400);
      }
    } catch (error) {
      throw new AppError(
        `Failed to execute ${actionType} on element '${selectorValue}': ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
  }

  /**
   * Closes the active browser session and releases resources.
   */
  async closeSession(evaluationId: string): Promise<void> {
    const session = this.activeSessions.get(evaluationId);
    if (session) {
      console.log(`[AutomationService] Closing session for evaluation ${evaluationId}`);
      await session.close();
      this.activeSessions.delete(evaluationId);
    }
  }

  /**
   * Translates design match strategies into Playwright locator selectors.
   */
  private resolveSelector(matchStrategy: string, value: string): string {
    switch (matchStrategy.toUpperCase()) {
      case 'CSS':
        return value;
      case 'XPATH':
        return `xpath=${value}`;
      case 'TEXT':
        return `text=${value}`;
      case 'ROLE':
        return `[role="${value}"]`;
      case 'LABEL':
        return `label=${value}`;
      case 'PLACEHOLDER':
        return `[placeholder="${value}"]`;
      case 'ALT_TEXT':
        return `img[alt="${value}"]`;
      case 'TEST_ID':
        return `[data-testid="${value}"]`;
      default:
        return value; // Fallback to raw string
    }
  }
}

export const automationService = new AutomationService();
