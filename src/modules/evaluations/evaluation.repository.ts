import { Evaluation, IEvaluation } from './evaluation.model';
import { Types } from 'mongoose';
import { CreateEvaluationDto, GetEvaluationsQuery } from './dto/evaluation.dto';

/**
 * EvaluationRepository — Encapsulates all Mongoose operations for Evaluation.
 *
 * All read queries are scoped by userId to enforce data ownership.
 */
export class EvaluationRepository {
  async findAll(
    userId: string,
    query: GetEvaluationsQuery,
  ): Promise<{ data: IEvaluation[]; total: number }> {
    const filter = query.status ? { userId, status: query.status } : { userId };
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      Evaluation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
      Evaluation.countDocuments(filter),
    ]);

    return { data, total };
  }

  async findByIdAndUserId(id: string, userId: string): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOne({ _id: id, userId });
  }

  async create(userId: string, dto: CreateEvaluationDto): Promise<IEvaluation> {
    return Evaluation.create({ ...dto, userId });
  }

  async update(
    id: string,
    userId: string,
    dto: Partial<IEvaluation> | Record<string, any>,
  ): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOneAndUpdate({ _id: id, userId }, dto, {
      new: true,
      runValidators: true,
    });
  }

  async delete(id: string, userId: string): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOneAndDelete({ _id: id, userId });
  }
}

export const evaluationRepository = new EvaluationRepository();
