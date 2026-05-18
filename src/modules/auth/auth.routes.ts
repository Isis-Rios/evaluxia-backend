import { Router } from 'express';

/**
 * Auth Module — Placeholder
 *
 * Future implementation:
 * - POST /auth/register   → Register new evaluator
 * - POST /auth/login      → Email/password login → JWT
 * - POST /auth/refresh    → Refresh access token
 * - POST /auth/logout     → Invalidate refresh token
 * - GET  /auth/me         → Get current authenticated user
 *
 * Recommended packages when implementing:
 *   npm install jsonwebtoken bcryptjs
 *   npm install -D @types/jsonwebtoken @types/bcryptjs
 */

const router = Router();

router.get('/status', (_req, res) => {
  res.status(200).json({ status: 'success', message: 'Auth module ready — not yet implemented' });
});

export { router as authRoutes };
