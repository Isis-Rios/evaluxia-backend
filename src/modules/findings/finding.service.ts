import { IFinding } from './finding.model';
import { findingRepository } from './finding.repository';
import { CreateFindingDto, UpdateFindingDto, GetFindingsQuery } from './dto/finding.dto';
import { HttpError } from '@/shared/errors/HttpError';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';

/**
 * FindingService — Business logic for finding management.
 *
 * Findings are typically auto-created by the AI pipeline (AuditEngine),
 * but can also be managed manually by evaluators via the HTTP API.
 *
 * Findings do not carry their own `userId` — ownership is always resolved
 * through the parent Evaluation's `userId`, mirroring the pattern already
 * used by EvaluationService/EvaluationRepository. Every method here takes
 * `userId` and verifies it before touching the finding, so a finding
 * belonging to another user's evaluation can never be read, listed,
 * created against, updated, or deleted just by knowing/guessing its id.
 */
export class FindingService {
  private async assertEvaluationOwnership(userId: string, evaluationId: string): Promise<void> {
    const evaluation = await evaluationRepository.findByIdAndUserId(evaluationId, userId);
    if (!evaluation) {
      // Same response as "the evaluation genuinely doesn't exist" —
      // deliberately does not reveal whether the id belongs to someone else.
      throw HttpError.notFound(`Evaluation '${evaluationId}' not found`);
    }
  }

  async findAll(
    userId: string,
    query: GetFindingsQuery,
  ): Promise<{ data: IFinding[]; total: number; page: number; limit: number }> {
    if (query.evaluationId) {
      await this.assertEvaluationOwnership(userId, query.evaluationId);
      const { data, total } = await findingRepository.findAll(query);
      return { data, total, page: query.page, limit: query.limit };
    }

    // No evaluationId filter: scope the listing to the caller's own
    // evaluations instead of returning findings across every user.
    const ownedEvaluationIds = await evaluationRepository.findIdsByUserId(userId);
    const { data, total } = await findingRepository.findAll(query, ownedEvaluationIds);
    return { data, total, page: query.page, limit: query.limit };
  }

  async findById(userId: string, id: string): Promise<IFinding> {
    const finding = await findingRepository.findById(id);
    if (!finding) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    await this.assertEvaluationOwnership(userId, finding.evaluationId.toString());
    return finding;
  }

  async findByEvaluationId(userId: string, evaluationId: string): Promise<IFinding[]> {
    await this.assertEvaluationOwnership(userId, evaluationId);
    return findingRepository.findByEvaluationId(evaluationId);
  }

  async create(userId: string, dto: CreateFindingDto): Promise<IFinding> {
    await this.assertEvaluationOwnership(userId, dto.evaluationId);
    return findingRepository.create(dto);
  }

  async update(userId: string, id: string, dto: UpdateFindingDto): Promise<IFinding> {
    const finding = await findingRepository.findById(id);
    if (!finding) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    await this.assertEvaluationOwnership(userId, finding.evaluationId.toString());

    const updated = await findingRepository.update(id, dto);
    if (!updated) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    return updated;
  }

  async delete(userId: string, id: string): Promise<void> {
    const finding = await findingRepository.findById(id);
    if (!finding) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    await this.assertEvaluationOwnership(userId, finding.evaluationId.toString());

    const deleted = await findingRepository.delete(id);
    if (!deleted) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
  }
}

export const findingService = new FindingService();
