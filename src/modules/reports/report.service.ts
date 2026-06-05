import { IReport } from './report.model';
import { reportRepository } from './report.repository';
import { HttpError } from '@/shared/errors/HttpError';

export class ReportService {
  async getReportForEvaluation(evaluationId: string): Promise<IReport> {
    const report = await reportRepository.findByEvaluationId(evaluationId);
    if (!report) {
      throw HttpError.notFound(`Report for evaluation '${evaluationId}' not found`);
    }
    return report;
  }

  async generateReport(evaluationId: string, title: string, findings: any[]): Promise<IReport> {
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const highCount = findings.filter((f) => f.severity === 'high').length;
    const mediumCount = findings.filter((f) => f.severity === 'medium').length;
    const lowCount = findings.filter((f) => f.severity === 'low').length;
    const infoCount = findings.filter((f) => f.severity === 'info').length;

    // Simulate some logic for overall score (this comes from Gemini, but we can store it or calculate)
    // For now, we'll wait for the AiService output to set overallScore in the evaluation flow.
    
    const reportData = {
      evaluationId,
      title: `UX Report: ${title}`,
      status: 'ready' as const,
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
      generatedAt: new Date(),
    };

    return reportRepository.create(reportData);
  }
}

export const reportService = new ReportService();
