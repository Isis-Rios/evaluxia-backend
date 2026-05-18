import { Router } from 'express';

/**
 * Evaluator Profiles Module — Placeholder
 *
 * Future implementation:
 * - GET   /evaluator-profiles           → List all active evaluator profiles
 * - POST  /evaluator-profiles           → Create profile (linked to auth user)
 * - GET   /evaluator-profiles/:id       → Get single profile
 * - PATCH /evaluator-profiles/:id       → Update profile
 * - GET   /evaluator-profiles/me        → Get own profile (authenticated)
 */

const router = Router();

router.get('/status', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Evaluator Profiles module ready — not yet implemented',
  });
});

export { router as evaluatorProfilesRoutes };
