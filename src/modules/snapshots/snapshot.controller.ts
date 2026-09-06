import { Request, Response, NextFunction } from 'express';
import { snapshotEvidenceService } from './snapshot-evidence.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { HttpError } from '@/shared/errors/HttpError';

export class SnapshotController {
  public async getEvidencesForEvaluation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const evaluationId = req.params.evaluationId as string;

      // Snapshot evidence (DOM/screenshots per iteration) doesn't carry its
      // own userId; ownership is resolved through the parent Evaluation —
      // without this check any authenticated user could read any other
      // user's captured evidence just by knowing/guessing the evaluationId.
      const evaluation = await evaluationRepository.findByIdAndUserId(
        evaluationId,
        req.user!.userId,
      );
      if (!evaluation) {
        throw HttpError.notFound(`Evaluation '${evaluationId}' not found`);
      }

      const evidences = await snapshotEvidenceService.getEvidencesForEvaluation(evaluationId);
      res.status(200).json({
        status: 'success',
        data: evidences,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const snapshotController = new SnapshotController();
