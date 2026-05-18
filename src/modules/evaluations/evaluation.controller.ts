import { Request, Response, NextFunction } from 'express';
import { evaluationService } from './evaluation.service';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';

/**
 * EvaluationController — HTTP layer for evaluation routes.
 * Delegates all logic to EvaluationService.
 * All methods are async — Express 5 catches errors automatically.
 */
export class EvaluationController {
  async create(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const dto = req.body as CreateEvaluationDto;
    const evaluation = await evaluationService.create(dto);
    res.status(201).json({ status: 'success', data: evaluation });
  }

  async findAll(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const query = req.query as unknown as GetEvaluationsQuery;
    const result = await evaluationService.findAll(query);
    res.status(200).json({ status: 'success', ...result });
  }

  async findById(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const evaluation = await evaluationService.findById(req.params['id'] as string);
    res.status(200).json({ status: 'success', data: evaluation });
  }

  async update(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const dto = req.body as UpdateEvaluationDto;
    const evaluation = await evaluationService.update(req.params['id'] as string, dto);
    res.status(200).json({ status: 'success', data: evaluation });
  }

  async delete(req: Request, res: Response, _next: NextFunction): Promise<void> {
    await evaluationService.delete(req.params['id'] as string);
    res.status(204).send();
  }
}

export const evaluationController = new EvaluationController();
