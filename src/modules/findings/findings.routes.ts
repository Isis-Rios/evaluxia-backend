import { Router } from 'express';

/**
 * Findings Module — Placeholder
 *
 * Future implementation:
 * - GET    /findings                    → List all findings (filter by evaluation, severity, category)
 * - POST   /findings                    → Create finding manually
 * - GET    /findings/:id                → Get single finding
 * - PATCH  /findings/:id               → Update finding (e.g. mark as resolved)
 * - DELETE /findings/:id               → Delete finding
 * - GET    /findings/evaluation/:evalId → All findings for a specific evaluation
 *
 * Findings are typically auto-created by the AI analysis pipeline,
 * but can also be created manually by human evaluators.
 */

const router = Router();

router.get('/status', (_req, res) => {
  res.status(200).json({ status: 'success', message: 'Findings module ready — not yet implemented' });
});

export { router as findingsRoutes };
