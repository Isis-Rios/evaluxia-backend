import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { BROWSER_CONFIG } from '@/config/constants';

/**
 * BrowserManager — Singleton that manages a shared Playwright browser instance.
 *
 * Design decisions:
 * - One browser process is shared across all automation requests (performance).
 * - Each evaluation gets its own isolated BrowserContext (security + state isolation).
 * - Contexts and pages are explicitly closed after use to prevent memory leaks.
 *
 * Usage:
 *   const browser = BrowserManager.getInstance();
 *   const { page, close } = await browser.newPage();
 *   // ... do automation
 *   await close();
 */
export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Lazily initializes the browser on first call.
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      console.log('🌐  Launching Playwright browser...');
      this.browser = await chromium.launch({
        headless: BROWSER_CONFIG.headless,
      });
    }
    return this.browser;
  }

  /**
   * Creates a new isolated browser context and page.
   * Returns the page and a `close()` function to clean up resources.
   */
  public async newPage(): Promise<{ page: Page; close: () => Promise<void> }> {
    const browser = await this.getBrowser();

    const context: BrowserContext = await browser.newContext({
      viewport: BROWSER_CONFIG.viewport,
      userAgent:
        'Mozilla/5.0 (compatible; EvalUXIA-Bot/1.0; +https://evaluxia.com/bot)',
    });

    const page: Page = await context.newPage();
    page.setDefaultTimeout(BROWSER_CONFIG.timeout);

    const close = async (): Promise<void> => {
      await page.close();
      await context.close();
    };

    return { page, close };
  }

  /**
   * Gracefully shuts down the browser.
   * Should be called on application shutdown.
   */
  public async shutdown(): Promise<void> {
    if (this.browser) {
      console.log('🔌  Closing Playwright browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}
