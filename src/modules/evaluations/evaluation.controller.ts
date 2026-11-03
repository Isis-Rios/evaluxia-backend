import { Request, Response } from 'express';
import { evaluationService } from './evaluation.service';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';
import { CreatePrototypeEvaluationDto } from '@/modules/ai/contracts/prototype.contracts';
import { prototypeEvaluationService } from './services/prototype-evaluation.service';
import { AppError } from '@/shared/errors/AppError';

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

  /**
   * [P4] POST /evaluations/prototype — multipart/form-data con el campo
   * `image` (parseado por `prototypeImageUpload` middleware, ver
   * evaluation.routes.ts) + los campos de texto de `CreatePrototypeEvaluationDto`.
   */
  async createPrototype(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      throw new AppError('El campo "image" es requerido (multipart/form-data).', 400);
    }
    const dto = req.body as CreatePrototypeEvaluationDto;
    const evaluation = await prototypeEvaluationService.create(req.user!.userId, dto, {
      buffer: req.file.buffer,
      size: req.file.size,
      originalname: req.file.originalname,
    });
    res.status(202).json({ status: 'success', data: evaluation });
  }
}

export const evaluationController = new EvaluationController();
