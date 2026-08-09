import { SnapshotEvidenceModel, ISnapshotEvidence } from './snapshot-evidence.model';
import { Types } from 'mongoose';

export class SnapshotEvidenceRepository {
  private static instance: SnapshotEvidenceRepository;

  private constructor() {}

  public static getInstance(): SnapshotEvidenceRepository {
    if (!SnapshotEvidenceRepository.instance) {
      SnapshotEvidenceRepository.instance = new SnapshotEvidenceRepository();
    }
    return SnapshotEvidenceRepository.instance;
  }

  async create(data: Partial<ISnapshotEvidence>): Promise<ISnapshotEvidence> {
    return SnapshotEvidenceModel.create(data);
  }

  async findByEvaluationId(evaluationId: string): Promise<ISnapshotEvidence[]> {
    return SnapshotEvidenceModel.find({
      evaluationId: new Types.ObjectId(evaluationId),
    }).sort({ iteration: 1 });
  }

  async findByEvaluationAndIteration(
    evaluationId: string,
    iteration: number,
  ): Promise<ISnapshotEvidence | null> {
    return SnapshotEvidenceModel.findOne({
      evaluationId: new Types.ObjectId(evaluationId),
      iteration,
    });
  }

  async deleteByEvaluationId(evaluationId: string): Promise<number> {
    const res = await SnapshotEvidenceModel.deleteMany({
      evaluationId: new Types.ObjectId(evaluationId),
    });
    return res.deletedCount || 0;
  }
}

export const snapshotEvidenceRepository = SnapshotEvidenceRepository.getInstance();
