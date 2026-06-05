import { EvaluatorProfile, IEvaluatorProfile } from './evaluator-profile.model';
import { Types } from 'mongoose';
import { CreateEvaluatorProfileDto, UpdateEvaluatorProfileDto, GetEvaluatorProfilesQuery } from './dto/evaluator-profile.dto';

export class EvaluatorProfileRepository {
  async findAll(
    userId: string,
    query: GetEvaluatorProfilesQuery,
  ): Promise<{ data: IEvaluatorProfile[]; total: number }> {
    const skip = (query.page - 1) * query.limit;
    const filter = { userId };

    const [data, total] = await Promise.all([
      EvaluatorProfile.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
      EvaluatorProfile.countDocuments(filter),
    ]);

    return { data, total };
  }

  async findByIdAndUserId(id: string, userId: string): Promise<IEvaluatorProfile | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return EvaluatorProfile.findOne({ _id: id, userId });
  }

  async create(userId: string, dto: CreateEvaluatorProfileDto): Promise<IEvaluatorProfile> {
    return EvaluatorProfile.create({ ...dto, userId });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateEvaluatorProfileDto,
  ): Promise<IEvaluatorProfile | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return EvaluatorProfile.findOneAndUpdate({ _id: id, userId }, dto, {
      new: true,
      runValidators: true,
    });
  }

  async delete(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await EvaluatorProfile.deleteOne({ _id: id, userId });
    return result.deletedCount === 1;
  }
}

export const evaluatorProfileRepository = new EvaluatorProfileRepository();
