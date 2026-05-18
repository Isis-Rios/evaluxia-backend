import { Request, Response, NextFunction } from 'express';
import { aiService } from './ai.service';
import { UxAnalysisInputSchema } from './contracts/ai.contracts';
import { validate } from '@/shared/middleware/validate.middleware';
import { Router } from 'express';

export class AiController {
  /**
   * POST /api/v1/ai/analyze-ux
   * Receives a DOM snapshot and returns a structured UX analysis from Gemini.
   */
  async analyzeUx(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const result = await aiService.analyzeUx(req.body);
    res.status(200).json({ status: 'success', data: result });
  }
}

export const aiController = new AiController();

// ─── Routes ──────────────────────────────────────────────────────────────────

const router = Router();

router.post(
  '/analyze-ux',
  validate(UxAnalysisInputSchema),
  aiController.analyzeUx.bind(aiController),
);

export { router as aiRoutes };
