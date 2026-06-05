import { Router } from 'express';
import { findingController } from './finding.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';
import { validate } from '@/shared/middleware/validate.middleware';
import {
  CreateFindingSchema,
  UpdateFindingSchema,
  GetFindingsQuerySchema,
} from './dto/finding.dto';

const router = Router();

/**
 * Finding Routes — all protected by JWT
 *
 * GET    /api/v1/findings                         → List findings (filter by evaluationId, severity, group)
 * POST   /api/v1/findings                         → Create a finding manually
 * GET    /api/v1/findings/:id                     → Get single finding
 * PATCH  /api/v1/findings/:id                     → Update finding
 * DELETE /api/v1/findings/:id                     → Delete finding
 * GET    /api/v1/findings/evaluation/:evaluationId → All findings for an evaluation
 */
router.use(authenticate);

router.get(
  '/',
  validate(GetFindingsQuerySchema, 'query'),
  findingController.findAll.bind(findingController),
);

router.post('/', validate(CreateFindingSchema), findingController.create.bind(findingController));

// Specific route before :id to avoid conflict
router.get(
  '/evaluation/:evaluationId',
  findingController.findByEvaluationId.bind(findingController),
);

router.get('/:id', findingController.findById.bind(findingController));

router.patch(
  '/:id',
  validate(UpdateFindingSchema),
  findingController.update.bind(findingController),
);

router.delete('/:id', findingController.delete.bind(findingController));

export { router as findingsRoutes };
