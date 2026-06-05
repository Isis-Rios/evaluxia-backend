import { IAiInteraction, AiInteraction } from './ai-interaction.model';

export class AiInteractionRepository {
  async create(data: Partial<IAiInteraction>): Promise<IAiInteraction> {
    return AiInteraction.create(data);
  }

  async findByEvaluationId(evaluationId: string): Promise<IAiInteraction[]> {
    return AiInteraction.find({ evaluationId }).sort({ iteration: 1 });
  }
}

export const aiInteractionRepository = new AiInteractionRepository();
