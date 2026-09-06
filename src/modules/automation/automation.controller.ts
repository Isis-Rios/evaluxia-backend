import { Request, Response, NextFunction, Router } from 'express';
import { automationService } from './automation.service';
import { validate } from '@/shared/middleware/validate.middleware';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { z } from 'zod';

const NavigateSchema = z.object({
  url: z.string().url('Must be a valid URL (include https://)'),
});

const SnapshotSchema = z.object({
  url: z.string().url('Must be a valid URL (include https://)'),
});

export class AutomationController {
  async navigate(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const { url } = req.body as { url: string };
    const result = await automationService.startSession('transient-test-navigate', url);
    await automationService.closeSession('transient-test-navigate');
    res.status(200).json({ status: 'success', data: result });
  }

  async extractSnapshot(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const { url } = req.body as { url: string };
    await automationService.startSession('transient-test-snapshot', url);
    const snapshot = await automationService.extractCurrentSnapshot('transient-test-snapshot');
    await automationService.closeSession('transient-test-snapshot');
    res.status(200).json({ status: 'success', data: snapshot });
  }

  async captureScreenshot(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const { url } = req.body as { url: string };
    await automationService.startSession('transient-test-screenshot', url);
    const filepath = await automationService.captureAndSaveScreenshot('transient-test-screenshot', 1);
    await automationService.closeSession('transient-test-screenshot');
    res.status(200).json({ status: 'success', data: { screenshot: filepath } });
  }
}

export const automationController = new AutomationController();

// ─── Routes ──────────────────────────────────────────────────────────────────

const router = Router();

/**
 * All automation routes operate a real Playwright/Chromium session against a
 * caller-supplied URL — they must not be reachable anonymously.
 */
router.use(authenticate);

/**
 * POST /api/v1/automation/navigate      → Navigate and get metadata
 * POST /api/v1/automation/snapshot      → Extract full DOM snapshot
 * POST /api/v1/automation/screenshot    → Capture full-page screenshot
 */
router.post('/navigate', validate(NavigateSchema), automationController.navigate.bind(automationController));
router.post('/snapshot', validate(SnapshotSchema), automationController.extractSnapshot.bind(automationController));
router.post('/screenshot', validate(SnapshotSchema), automationController.captureScreenshot.bind(automationController));

export { router as automationRoutes };
