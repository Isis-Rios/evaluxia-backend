import { Router } from 'express';

/**
 * Reports Module — Placeholder
 *
 * Future implementation:
 * - POST /reports/generate/:evaluationId → Trigger report generation (async)
 * - GET  /reports/:id                    → Get report metadata
 * - GET  /reports/:id/download           → Download report file (JSON/HTML/PDF)
 * - GET  /reports/evaluation/:evalId     → All reports for an evaluation
 *
 * Report generation pipeline:
 *   1. Aggregate all findings for the evaluation
 *   2. Call Gemini for executive summary generation
 *   3. Compile findings + scores + recommendations
 *   4. Render to requested format (json/html/pdf)
 *   5. Store file path + update report status → 'ready'
 */

const router = Router();

router.get('/status', (_req, res) => {
  res.status(200).json({ status: 'success', message: 'Reports module ready — not yet implemented' });
});

export { router as reportsRoutes };
