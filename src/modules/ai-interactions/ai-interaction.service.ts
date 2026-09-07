import { IAiInteraction } from './ai-interaction.model';
import { aiInteractionRepository } from './ai-interaction.repository';

export class AiInteractionService {
  async logInteraction(
    evaluationId: string,
    iteration: number,
    executionTimeMs: number,
    metadata: any = {},
    requestTokens: number = 0,
    responseTokens: number = 0,
  ): Promise<IAiInteraction> {
    return aiInteractionRepository.create({
      evaluationId: evaluationId as any,
      iteration,
      executionTimeMs,
      metadata,
      requestTokens,
      responseTokens,
    });
  }

  async getInteractions(evaluationId: string): Promise<IAiInteraction[]> {
    return aiInteractionRepository.findByEvaluationId(evaluationId);
  }
}

export const aiInteractionService = new AiInteractionService();
