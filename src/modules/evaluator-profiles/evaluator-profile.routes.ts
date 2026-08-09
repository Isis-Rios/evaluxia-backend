import { Router } from 'express';
import { evaluatorProfileController } from './evaluator-profile.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { validate } from '@/shared/middleware/validate.middleware';
import {
  CreateEvaluatorProfileSchema,
  UpdateEvaluatorProfileSchema,
  GetEvaluatorProfilesQuerySchema,
} from './dto/evaluator-profile.dto';

const router = Router();

/**
 * Evaluator Profile Routes — all protected by JWT
 *
 * GET    /api/v1/evaluator-profiles       → List user's evaluator profiles
 * POST   /api/v1/evaluator-profiles       → Create a new profile
 * GET    /api/v1/evaluator-profiles/:id   → Get single profile
 * PATCH  /api/v1/evaluator-profiles/:id            → Update profile
 * PATCH  /api/v1/evaluator-profiles/:id/activate   → Set as active profile
 * DELETE /api/v1/evaluator-profiles/:id            → Delete profile
 */
router.use(authenticate);

router.get('/', validate(GetEvaluatorProfilesQuerySchema, 'query'), evaluatorProfileController.findAll.bind(evaluatorProfileController));
router.post('/', validate(CreateEvaluatorProfileSchema), evaluatorProfileController.create.bind(evaluatorProfileController));
router.get('/:id', evaluatorProfileController.findById.bind(evaluatorProfileController));
router.patch('/:id', validate(UpdateEvaluatorProfileSchema), evaluatorProfileController.update.bind(evaluatorProfileController));
router.patch('/:id/activate', evaluatorProfileController.activate.bind(evaluatorProfileController));
router.delete('/:id', evaluatorProfileController.delete.bind(evaluatorProfileController));

export { router as evaluatorProfileRoutes };
