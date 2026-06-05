import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { validate } from '@/shared/middleware/validate.middleware';
import { RegisterSchema, LoginSchema, RefreshSchema } from './dto/auth.dto';

const router = Router();

/**
 * Auth Routes
 *
 * POST /api/v1/auth/register  → Register a new account
 * POST /api/v1/auth/login     → Login → returns access + refresh tokens
 * POST /api/v1/auth/refresh   → Exchange refresh token for new access token
 * POST /api/v1/auth/logout    → Invalidate refresh token (requires JWT)
 * GET  /api/v1/auth/me        → Get current user profile (requires JWT)
 */

router.post('/register', validate(RegisterSchema), authController.register.bind(authController));

router.post('/login', validate(LoginSchema), authController.login.bind(authController));

router.post('/refresh', validate(RefreshSchema), authController.refresh.bind(authController));

router.post('/logout', authenticate, authController.logout.bind(authController));

router.get('/me', authenticate, authController.me.bind(authController));

export { router as authRoutes };
