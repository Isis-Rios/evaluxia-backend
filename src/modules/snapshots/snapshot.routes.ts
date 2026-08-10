import { Router } from 'express';
import { snapshotController } from './snapshot.controller';
import { authenticate } from '@/shared/middleware/authenticate.middleware';

const router = Router();

/**
 * Snapshot Evidence Routes
 *
 * GET /api/v1/snapshots/evaluation/:evaluationId → Retorna la lista de SnapshotEvidence por iteración.
 */
router.use(authenticate);

router.get(
  '/evaluation/:evaluationId',
  snapshotController.getEvidencesForEvaluation.bind(snapshotController),
);

export { router as snapshotsRoutes };
