import { Finding, IFinding } from './finding.model';
import { Types } from 'mongoose';
import { CreateFindingDto, UpdateFindingDto, GetFindingsQuery } from './dto/finding.dto';

/**
 * FindingRepository — Encapsulates all Mongoose operations for Finding.
 */
export class FindingRepository {
  /**
   * `ownedEvaluationIds` scopes the query to a specific set of evaluations
   * (used when the caller did not filter by a single evaluationId, so we
   * must not return findings belonging to other users' evaluations).
   */
  async findAll(
    query: GetFindingsQuery,
    ownedEvaluationIds?: string[],
  ): Promise<{ data: IFinding[]; total: number }> {
    const filter: Record<string, unknown> = {};

    if (query.evaluationId) {
      filter['evaluationId'] = query.evaluationId;
    } else if (ownedEvaluationIds) {
      filter['evaluationId'] = { $in: ownedEvaluationIds };
    }
    if (query.findingGroup) filter['findingGroup'] = query.findingGroup;
    if (query.severity) filter['severity'] = query.severity;

    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      Finding.find(filter).sort({ severity: 1, createdAt: -1 }).skip(skip).limit(query.limit),
      Finding.countDocuments(filter),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<IFinding | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Finding.findById(id);
  }

  async findByEvaluationId(evaluationId: string): Promise<IFinding[]> {
    return Finding.find({ evaluationId }).sort({ severity: 1, findingGroup: 1 });
  }

  async create(dto: CreateFindingDto): Promise<IFinding> {
    return Finding.create(dto);
  }

  async update(id: string, dto: UpdateFindingDto): Promise<IFinding | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Finding.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
  }

  async delete(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await Finding.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}

export const findingRepository = new FindingRepository();
