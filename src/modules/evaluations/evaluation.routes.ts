import { Router } from 'express';
import { evaluationController } from './evaluation.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { validate } from '@/shared/middleware/validate.middleware';
import { prototypeImageUpload } from '@/shared/middleware/prototype-upload.middleware';
import {
  CreateEvaluationSchema,
  UpdateEvaluationSchema,
  GetEvaluationsQuerySchema,
} from './dto/evaluation.dto';
import { CreatePrototypeEvaluationSchema } from '@/modules/ai/contracts/prototype.contracts';

const router = Router();

/**
 * Evaluation Routes — all protected by JWT
 *
 * GET    /api/v1/evaluations       → List user's evaluations (paginated + filter)
 * POST   /api/v1/evaluations       → Create new evaluation
 * GET    /api/v1/evaluations/:id   → Get single evaluation
 * PATCH  /api/v1/evaluations/:id   → Update evaluation
 * DELETE /api/v1/evaluations/:id   → Delete evaluation
 */
router.use(authenticate);

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

/**
 * [P4] POST /evaluations/prototype — multipart/form-data (`image` + campos
 * de texto). Mounted on the SAME router as WEB's `/evaluations`
 * (convención existente, sección 23) pero con su propio schema/upload
 * middleware -- `CreateEvaluationSchema`/`POST /` para WEB permanece
 * intacto.
 */
router.post(
  '/prototype',
  prototypeImageUpload,
  validate(CreatePrototypeEvaluationSchema),
  evaluationController.createPrototype.bind(evaluationController),
);

router.get('/:id', evaluationController.findById.bind(evaluationController));

router.patch(
  '/:id',
  validate(UpdateEvaluationSchema),
  evaluationController.update.bind(evaluationController),
);

router.delete('/:id', evaluationController.delete.bind(evaluationController));

export { router as evaluationRoutes };
