import { IAiInteraction } from './ai-interaction.model';
import { aiInteractionRepository } from './ai-interaction.repository';

export class AiInteractionService {
  async logInteraction(
    evaluationId: string,
    iteration: number,
    executionTimeMs: number,
    metadata: any = {},
  ): Promise<IAiInteraction> {
    return aiInteractionRepository.create({
      evaluationId: evaluationId as any,
      iteration,
      executionTimeMs,
      metadata,
      requestTokens: 0, // Placeholder as Gemini SDK doesn't always expose this easily
      responseTokens: 0,
    });
  }

  async getInteractions(evaluationId: string): Promise<IAiInteraction[]> {
    return aiInteractionRepository.findByEvaluationId(evaluationId);
  }
}

export const aiInteractionService = new AiInteractionService();
