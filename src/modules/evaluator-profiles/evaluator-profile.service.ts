import { IEvaluatorProfile } from './evaluator-profile.model';
import { evaluatorProfileRepository } from './evaluator-profile.repository';
import { CreateEvaluatorProfileDto, UpdateEvaluatorProfileDto, GetEvaluatorProfilesQuery } from './dto/evaluator-profile.dto';
import { HttpError } from '@/shared/errors/HttpError';

export class EvaluatorProfileService {
  async findAll(
    userId: string,
    query: GetEvaluatorProfilesQuery,
  ): Promise<{ data: IEvaluatorProfile[]; total: number; page: number; limit: number }> {
    const { data, total } = await evaluatorProfileRepository.findAll(userId, query);
    return { data, total, page: query.page, limit: query.limit };
  }

  async findById(userId: string, profileId: string): Promise<IEvaluatorProfile> {
    const profile = await evaluatorProfileRepository.findByIdAndUserId(profileId, userId);
    if (!profile) {
      throw HttpError.notFound(`EvaluatorProfile '${profileId}' not found`);
    }
    return profile;
  }

  async create(userId: string, dto: CreateEvaluatorProfileDto): Promise<IEvaluatorProfile> {
    const count = await evaluatorProfileRepository.countByUser(userId);
    const isActive = count === 0;
    return evaluatorProfileRepository.create(userId, dto, isActive);
  }

  async activateProfile(userId: string, profileId: string): Promise<IEvaluatorProfile> {
    // 1. Verify ownership (throws 404 if not found/owned)
    await this.findById(userId, profileId);

    // 2. Deactivate all profiles for this user
    await evaluatorProfileRepository.deactivateAllForUser(userId);

    // 3. Mark the selected profile as active
    const activated = await evaluatorProfileRepository.update(profileId, userId, { isActive: true });
    
    // In theory 'activated' is never null here since we just found it
    return activated!;
  }

  async update(
    userId: string,
    profileId: string,
    dto: UpdateEvaluatorProfileDto,
  ): Promise<IEvaluatorProfile> {
    const profile = await evaluatorProfileRepository.update(profileId, userId, dto);
    if (!profile) {
      throw HttpError.notFound(`EvaluatorProfile '${profileId}' not found`);
    }
    return profile;
  }

  async delete(userId: string, profileId: string): Promise<void> {
    const deleted = await evaluatorProfileRepository.delete(profileId, userId);
    if (!deleted) {
      throw HttpError.notFound(`EvaluatorProfile '${profileId}' not found`);
    }
  }
}

export const evaluatorProfileService = new EvaluatorProfileService();
