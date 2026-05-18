import { BrowserManager } from '@/infrastructure/playwright/browser.manager';
import { AppError } from '@/shared/errors/AppError';

export interface PageSnapshot {
  url: string;
  title: string;
  domSnapshot: string;
  metaDescription?: string;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string }[];
  links: { href: string; text: string; isExternal: boolean }[];
  accessibilityTree?: string;
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
 * EvalUXIA Architecture:
 *   - This service ONLY extracts data from pages (DOM, screenshots, accessibility tree).
 *   - It does NOT perform business logic or call the AI directly.
 *   - All extracted data is passed back to the orchestrating service (e.g., EvaluationService)
 *     which then decides whether to call the AI, persist data, etc.
 *
 * Iterative Evaluation Flow:
 *   1. navigate(url) → get NavigationResult
 *   2. extractSnapshot() → get PageSnapshot
 *   3. captureScreenshot() → get screenshot path
 *   4. [repeat for sub-pages or interactions]
 *   5. close() → release browser resources
 */
export class AutomationService {
  private browserManager: BrowserManager;

  constructor() {
    this.browserManager = BrowserManager.getInstance();
  }

  /**
   * Navigates to a URL and returns basic navigation metadata.
   */
  async navigate(url: string): Promise<NavigationResult> {
    const { page, close } = await this.browserManager.newPage();
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
      throw new AppError(
        `Failed to navigate to ${url}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    } finally {
      await close();
    }
  }

  /**
   * Extracts a comprehensive DOM snapshot from a URL.
   * This is the primary data source for AI analysis.
   */
  async extractSnapshot(url: string): Promise<PageSnapshot> {
    const { page, close } = await this.browserManager.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const snapshot = await page.evaluate((): Omit<PageSnapshot, 'accessibilityTree'> => {
        const getText = (el: Element) => el.textContent?.trim() ?? '';

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
        };
      });

      return snapshot;
    } catch (error) {
      throw new AppError(
        `Failed to extract snapshot from ${url}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    } finally {
      await close();
    }
  }

  /**
   * Captures a screenshot and returns the base64-encoded PNG.
   */
  async captureScreenshot(url: string): Promise<string> {
    const { page, close } = await this.browserManager.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const buffer = await page.screenshot({ type: 'png', fullPage: true });
      return buffer.toString('base64');
    } catch (error) {
      throw new AppError(
        `Failed to capture screenshot of ${url}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    } finally {
      await close();
    }
  }
}

export const automationService = new AutomationService();
