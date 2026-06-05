import { Request, Response } from 'express';
import { evaluatorProfileService } from './evaluator-profile.service';
import { CreateEvaluatorProfileDto, UpdateEvaluatorProfileDto, GetEvaluatorProfilesQuery } from './dto/evaluator-profile.dto';

export class EvaluatorProfileController {
  async findAll(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetEvaluatorProfilesQuery;
    const result = await evaluatorProfileService.findAll(req.user!.userId, query);
    res.status(200).json({ status: 'success', ...result });
  }

  async findById(req: Request, res: Response): Promise<void> {
    const profile = await evaluatorProfileService.findById(
      req.user!.userId,
      req.params['id'] as string,
    );
    res.status(200).json({ status: 'success', data: profile });
  }

  async create(req: Request, res: Response): Promise<void> {
    const dto = req.body as CreateEvaluatorProfileDto;
    const profile = await evaluatorProfileService.create(req.user!.userId, dto);
    res.status(201).json({ status: 'success', data: profile });
  }

  async update(req: Request, res: Response): Promise<void> {
    const dto = req.body as UpdateEvaluatorProfileDto;
    const profile = await evaluatorProfileService.update(
      req.user!.userId,
      req.params['id'] as string,
      dto,
    );
    res.status(200).json({ status: 'success', data: profile });
  }

  async delete(req: Request, res: Response): Promise<void> {
    await evaluatorProfileService.delete(req.user!.userId, req.params['id'] as string);
    res.status(204).send();
  }
}

export const evaluatorProfileController = new EvaluatorProfileController();
