import { Request, Response } from 'express';
import { findingService } from './finding.service';
import { CreateFindingDto, UpdateFindingDto, GetFindingsQuery } from './dto/finding.dto';

/**
 * FindingController — HTTP layer for finding routes.
 */
export class FindingController {
  async findAll(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetFindingsQuery;
    const result = await findingService.findAll(query);
    res.status(200).json({ status: 'success', ...result });
  }

  async findById(req: Request, res: Response): Promise<void> {
    const finding = await findingService.findById(req.params['id'] as string);
    res.status(200).json({ status: 'success', data: finding });
  }

  async findByEvaluationId(req: Request, res: Response): Promise<void> {
    const findings = await findingService.findByEvaluationId(
      req.params['evaluationId'] as string,
    );
    res.status(200).json({ status: 'success', data: findings, total: findings.length });
  }

  async create(req: Request, res: Response): Promise<void> {
    const dto = req.body as CreateFindingDto;
    const finding = await findingService.create(dto);
    res.status(201).json({ status: 'success', data: finding });
  }

  async update(req: Request, res: Response): Promise<void> {
    const dto = req.body as UpdateFindingDto;
    const finding = await findingService.update(req.params['id'] as string, dto);
    res.status(200).json({ status: 'success', data: finding });
  }

  async delete(req: Request, res: Response): Promise<void> {
    await findingService.delete(req.params['id'] as string);
    res.status(204).send();
  }
}

export const findingController = new FindingController();
