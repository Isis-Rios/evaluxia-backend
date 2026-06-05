import { IFinding } from './finding.model';
import { findingRepository } from './finding.repository';
import { CreateFindingDto, UpdateFindingDto, GetFindingsQuery } from './dto/finding.dto';
import { HttpError } from '@/shared/errors/HttpError';

/**
 * FindingService — Business logic for finding management.
 *
 * Findings are typically auto-created by the AI pipeline,
 * but can also be managed manually by evaluators.
 */
export class FindingService {
  async findAll(
    query: GetFindingsQuery,
  ): Promise<{ data: IFinding[]; total: number; page: number; limit: number }> {
    const { data, total } = await findingRepository.findAll(query);
    return { data, total, page: query.page, limit: query.limit };
  }

  async findById(id: string): Promise<IFinding> {
    const finding = await findingRepository.findById(id);
    if (!finding) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    return finding;
  }

  async findByEvaluationId(evaluationId: string): Promise<IFinding[]> {
    return findingRepository.findByEvaluationId(evaluationId);
  }

  async create(dto: CreateFindingDto): Promise<IFinding> {
    return findingRepository.create(dto);
  }

  async update(id: string, dto: UpdateFindingDto): Promise<IFinding> {
    const finding = await findingRepository.update(id, dto);
    if (!finding) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
    return finding;
  }

  async delete(id: string): Promise<void> {
    const deleted = await findingRepository.delete(id);
    if (!deleted) {
      throw HttpError.notFound(`Finding '${id}' not found`);
    }
  }
}

export const findingService = new FindingService();
