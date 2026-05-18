import { Router } from 'express';
import { evaluationController } from './evaluation.controller';
import { validate } from '@/shared/middleware/validate.middleware';
import {
  CreateEvaluationSchema,
  UpdateEvaluationSchema,
  GetEvaluationsQuerySchema,
} from './dto/evaluation.dto';

const router = Router();

/**
 * Evaluation Routes
 *
 * GET    /api/v1/evaluations         → List all (with pagination + filter)
 * POST   /api/v1/evaluations         → Create new evaluation
 * GET    /api/v1/evaluations/:id     → Get single evaluation
 * PATCH  /api/v1/evaluations/:id     → Update evaluation
 * DELETE /api/v1/evaluations/:id     → Delete evaluation
 */
router.get(
  '/',
  validate(GetEvaluationsQuerySchema, 'query'),
  evaluationController.findAll.bind(evaluationController),
);

router.post(
  '/',
  validate(CreateEvaluationSchema),
  evaluationController.create.bind(evaluationController),
);

router.get(
  '/:id',
  evaluationController.findById.bind(evaluationController),
);

router.patch(
  '/:id',
  validate(UpdateEvaluationSchema),
  evaluationController.update.bind(evaluationController),
);

router.delete(
  '/:id',
  evaluationController.delete.bind(evaluationController),
);

export { router as evaluationRoutes };
