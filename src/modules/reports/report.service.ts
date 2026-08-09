import { IReport } from './report.model';
import { reportRepository } from './report.repository';
import { HttpError } from '@/shared/errors/HttpError';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';

export class ReportService {
  async getReportForEvaluation(evaluationId: string): Promise<IReport> {
    const report = await reportRepository.findByEvaluationId(evaluationId);
    if (!report) {
      throw HttpError.notFound(`Report for evaluation '${evaluationId}' not found`);
    }
    return report;
  }

  getCumulativeMetrics() {
    return metricsTracker.getCumulativeStats();
  }

  async generateReport(evaluationId: string, title: string, findings: any[]): Promise<IReport> {
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const highCount = findings.filter((f) => f.severity === 'high').length;
    const mediumCount = findings.filter((f) => f.severity === 'medium').length;
    const lowCount = findings.filter((f) => f.severity === 'low').length;
    const infoCount = findings.filter((f) => f.severity === 'info').length;

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
