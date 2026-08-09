import { snapshotEvidenceRepository } from './snapshot-evidence.repository';
import { ISnapshotEvidence } from './snapshot-evidence.model';

export class SnapshotEvidenceService {
  private static instance: SnapshotEvidenceService;

  private constructor() {}

  public static getInstance(): SnapshotEvidenceService {
    if (!SnapshotEvidenceService.instance) {
      SnapshotEvidenceService.instance = new SnapshotEvidenceService();
    }
    return SnapshotEvidenceService.instance;
  }

  async saveEvidence(data: Partial<ISnapshotEvidence>): Promise<ISnapshotEvidence> {
    return snapshotEvidenceRepository.create(data);
  }

  async getEvidencesForEvaluation(evaluationId: string): Promise<ISnapshotEvidence[]> {
    return snapshotEvidenceRepository.findByEvaluationId(evaluationId);
  }

  async getEvidenceForIteration(
    evaluationId: string,
    iteration: number,
  ): Promise<ISnapshotEvidence | null> {
    return snapshotEvidenceRepository.findByEvaluationAndIteration(evaluationId, iteration);
  }
}

export const snapshotEvidenceService = SnapshotEvidenceService.getInstance();
