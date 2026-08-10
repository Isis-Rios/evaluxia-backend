import { Schema, model, Document } from 'mongoose';
import { EvaluationMetrics } from '@/shared/infrastructure/metrics-tracker';

export type ReportFormat = 'json' | 'html' | 'pdf';
export type ReportStatus = 'generating' | 'ready' | 'failed';

export interface IReport extends Document {
  evaluationId: string;
  title: string;
  format: ReportFormat;
  status: ReportStatus;
  filePath?: string;
  summary?: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  passCount?: number;
  failCount?: number;
  notEvaluableCount?: number;
  nielsenCompliance?: number | null;
  wcagCompliance?: number | null;
  auditCoverage?: number;
  nielsenCoverage?: number;
  wcagCoverage?: number;
  evaluatedCriteria?: number;
  totalCriteria?: number;
  evidenceCount?: number;
  screenshotsCount?: number;
  iterationsEvaluated?: number;
  overallScore?: number | null;
  metrics?: EvaluationMetrics;
  generatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
  {
    evaluationId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    format: { type: String, enum: ['json', 'html', 'pdf'], default: 'json' },
    status: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating' },
    filePath: { type: String },
    summary: { type: String },
    totalFindings: { type: Number, default: 0 },
    criticalCount: { type: Number, default: 0 },
    highCount: { type: Number, default: 0 },
    mediumCount: { type: Number, default: 0 },
    lowCount: { type: Number, default: 0 },
    infoCount: { type: Number, default: 0 },
    passCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    notEvaluableCount: { type: Number, default: 0 },
    nielsenCompliance: { type: Number, default: null },
    wcagCompliance: { type: Number, default: null },
    auditCoverage: { type: Number, default: 0 },
    nielsenCoverage: { type: Number, default: 0 },
    wcagCoverage: { type: Number, default: 0 },
    evaluatedCriteria: { type: Number, default: 0 },
    totalCriteria: { type: Number, default: 20 },
    evidenceCount: { type: Number, default: 0 },
    screenshotsCount: { type: Number, default: 0 },
    iterationsEvaluated: { type: Number, default: 1 },
    overallScore: { type: Number, default: null },
    metrics: { type: Schema.Types.Mixed, default: null },
    generatedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Report = model<IReport>('Report', ReportSchema);
