import { IReport, Report } from './report.model';

export class ReportRepository {
  async findByEvaluationId(evaluationId: string): Promise<IReport | null> {
    return Report.findOne({ evaluationId });
  }

  async create(data: Partial<IReport>): Promise<IReport> {
    return Report.create(data);
  }

  async update(id: string, data: Partial<IReport>): Promise<IReport | null> {
    return Report.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  }
}

export const reportRepository = new ReportRepository();
