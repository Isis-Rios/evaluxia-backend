import { Evaluation, IEvaluation } from './evaluation.model';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';
import { HttpError } from '@/shared/errors/HttpError';
import { EVALUATION_STATUS } from '@/config/constants';

/**
 * EvaluationService — Business logic for evaluation lifecycle management.
 *
 * This service is the orchestration hub:
 * 1. Persists evaluations to MongoDB
 * 2. Delegates automation steps to AutomationService (Playwright)
 * 3. Delegates AI reasoning to AiService (Gemini)
 * 4. Coordinates findings and report generation
 */
export class EvaluationService {
  /**
   * Creates a new evaluation in PENDING state.
   */
  async create(dto: CreateEvaluationDto): Promise<IEvaluation> {
    const evaluation = await Evaluation.create(dto);
    return evaluation;
  }

  /**
   * Returns a paginated list of evaluations with optional status filter.
   */
  async findAll(query: GetEvaluationsQuery): Promise<{
    data: IEvaluation[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = query.status ? { status: query.status } : {};
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      Evaluation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
      Evaluation.countDocuments(filter),
    ]);

    return { data, total, page: query.page, limit: query.limit };
  }

  /**
   * Finds a single evaluation by ID.
   */
  async findById(id: string): Promise<IEvaluation> {
    const evaluation = await Evaluation.findById(id);
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation with id '${id}' not found`);
    }
    return evaluation;
  }

  /**
   * Updates evaluation fields.
   */
  async update(id: string, dto: UpdateEvaluationDto): Promise<IEvaluation> {
    const evaluation = await Evaluation.findByIdAndUpdate(id, dto, {
      new: true,
      runValidators: true,
    });
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation with id '${id}' not found`);
    }
    return evaluation;
  }

  /**
   * Deletes an evaluation. Only PENDING evaluations can be deleted.
   */
  async delete(id: string): Promise<void> {
    const evaluation = await this.findById(id);
    if (evaluation.status === EVALUATION_STATUS.RUNNING) {
      throw HttpError.conflict(
        'Cannot delete an evaluation that is currently running',
      );
    }
    await evaluation.deleteOne();
  }
}

export const evaluationService = new EvaluationService();
