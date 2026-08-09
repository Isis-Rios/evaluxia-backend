import { Request, Response } from 'express';
import { evaluationService } from './evaluation.service';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';

/**
 * EvaluationController — HTTP layer for evaluation routes.
 * Delegates all logic to EvaluationService.
 * req.user is guaranteed by authenticate middleware.
 */
export class EvaluationController {
  async findAll(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetEvaluationsQuery;
    const result = await evaluationService.findAll(req.user!.userId, query);
    res.status(200).json({ status: 'success', ...result });
  }

  async findById(req: Request, res: Response): Promise<void> {
    const evaluation = await evaluationService.findById(
      req.user!.userId,
      req.params['id'] as string,
    );
    res.status(200).json({ status: 'success', data: evaluation });
  }

  async create(req: Request, res: Response): Promise<void> {
    const dto = req.body as CreateEvaluationDto;
    const evaluation = await evaluationService.create(req.user!.userId, dto);
    res.status(202).json({ status: 'success', data: evaluation });
  }

  async update(req: Request, res: Response): Promise<void> {
    const dto = req.body as UpdateEvaluationDto;
    const evaluation = await evaluationService.update(
      req.user!.userId,
      req.params['id'] as string,
      dto,
    );
    res.status(200).json({ status: 'success', data: evaluation });
  }

  async delete(req: Request, res: Response): Promise<void> {
    await evaluationService.delete(req.user!.userId, req.params['id'] as string);
    res.status(204).send();
  }
}

export const evaluationController = new EvaluationController();
