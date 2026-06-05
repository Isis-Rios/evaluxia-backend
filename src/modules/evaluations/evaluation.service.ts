import { IEvaluation } from './evaluation.model';
import { evaluationRepository } from './evaluation.repository';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';
import { HttpError } from '@/shared/errors/HttpError';
import { AppError } from '@/shared/errors/AppError';
import { EVALUATION_STATUS } from '@/config/constants';

import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiService } from '@/modules/ai/ai.service';
import { findingService } from '@/modules/findings/finding.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { reportService } from '@/modules/reports/report.service';

/**
 * EvaluationService — Business logic for evaluation lifecycle management.
 *
 * Orchestrates the full evaluation flow (DOM extraction, Gemini AI, persistence).
 */
export class EvaluationService {
  async findAll(
    userId: string,
    query: GetEvaluationsQuery,
  ): Promise<{ data: IEvaluation[]; total: number; page: number; limit: number }> {
    const { data, total } = await evaluationRepository.findAll(userId, query);
    return { data, total, page: query.page, limit: query.limit };
  }

  async findById(userId: string, id: string): Promise<IEvaluation> {
    const evaluation = await evaluationRepository.findByIdAndUserId(id, userId);
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation '${id}' not found`);
    }
    return evaluation;
  }

  /**
   * Orchestrates the evaluation: fetch DOM -> Gemini -> Findings -> Report
   */
  async create(userId: string, dto: CreateEvaluationDto): Promise<IEvaluation> {
    // 1. Validate Evaluator Profile
    const profile = await evaluatorProfileService.findById(userId, dto.evaluatorProfileId);

    // 2. Create Evaluation (PENDING)
    let evaluation = await evaluationRepository.create(userId, dto);

    try {
      // 3. Mark as RUNNING
      evaluation = (await evaluationRepository.update(evaluation.id, userId, { status: EVALUATION_STATUS.RUNNING }))!;

      // 4. Fetch DOM Context (Mock of Playwright for Iteration 3)
      const domSnapshot = await this.fetchDomSnapshot(dto.url);

      // 5. Invoke AI via Gemini
      const { result, executionTimeMs } = await aiService.analyzeUx({
        url: dto.url,
        pageTitle: dto.title,
        domSnapshot,
        evaluationContext: dto.description,
        evaluatorProfile: {
          fullName: profile.fullName,
          phrase: profile.phrase,
          age: profile.age,
          profession: profile.profession,
          archetype: profile.archetype,
          techSavviness: profile.techSavviness,
          accessibilityNeeds: profile.accessibilityNeeds,
          goals: profile.goals,
          frustrations: profile.frustrations,
        },
      });

      // 6. Persist Findings
      for (const f of result.findings) {
        await findingService.create({
          evaluationId: evaluation.id,
          iteration: 1,
          findingGroup: f.category === 'accessibility' ? 'accessibility' : 'ux',
          severity: f.severity as any,
          description: f.description,
          type: f.title,
          heuristic: f.recommendation, // Map recommendation to heuristic field temporarily
          wcagCriterion: f.wcagCriteria,
        });
      }

      // 7. Persist AI Interaction
      await aiInteractionService.logInteraction(
        evaluation.id,
        1,
        executionTimeMs,
        { summary: result.summary, overallScore: result.overallScore, totalFindings: result.findings.length }
      );

      // 8. Generate Report
      await reportService.generateReport(evaluation.id, evaluation.title, result.findings);

      // 9. Mark as COMPLETED
      evaluation = (await evaluationRepository.update(evaluation.id, userId, { status: EVALUATION_STATUS.COMPLETED }))!;

    } catch (error: any) {
      // Mark as FAILED if anything crashes
      await evaluationRepository.update(evaluation.id, userId, { status: EVALUATION_STATUS.FAILED });
      throw new AppError(error.message || 'Evaluation failed', error.statusCode || 500);
    }

    return evaluation;
  }

  async update(userId: string, id: string, dto: UpdateEvaluationDto): Promise<IEvaluation> {
    const evaluation = await evaluationRepository.update(id, userId, dto);
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation '${id}' not found`);
    }
    return evaluation;
  }

  async delete(userId: string, id: string): Promise<void> {
    const evaluation = await this.findById(userId, id);
    if (evaluation.status === EVALUATION_STATUS.RUNNING) {
      throw HttpError.conflict('Cannot delete an evaluation that is currently running');
    }
    await evaluationRepository.delete(id, userId);
  }

  /**
   * Encapsulates context extraction. 
   * In the future, this will call the Playwright Automation Service.
   */
  private async fetchDomSnapshot(url: string): Promise<string> {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'EvalUXIA Bot' } });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      }
      return response.text();
    } catch (error: any) {
      throw new Error(`DOM Extraction failed: ${error.message}`);
    }
  }
}

export const evaluationService = new EvaluationService();
