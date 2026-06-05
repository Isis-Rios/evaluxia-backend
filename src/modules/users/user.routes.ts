import { Router } from 'express';
import { userController } from './user.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { validate } from '@/shared/middleware/validate.middleware';
import { UpdateProfileSchema } from './dto/user.dto';

const router = Router();

/**
 * User Routes — all protected by JWT authentication
 *
 * GET   /api/v1/users/me   → Get authenticated user's profile
 * PATCH /api/v1/users/me   → Update authenticated user's profile
 */
router.get('/me', authenticate, userController.getMe.bind(userController));

router.patch(
  '/me',
  authenticate,
  validate(UpdateProfileSchema),
  userController.updateMe.bind(userController),
);

export { router as userRoutes };
