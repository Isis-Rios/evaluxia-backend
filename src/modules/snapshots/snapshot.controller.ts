import { Request, Response, NextFunction } from 'express';
import { snapshotEvidenceService } from './snapshot-evidence.service';

export class SnapshotController {
  public async getEvidencesForEvaluation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const evaluationId = req.params.evaluationId as string;
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
