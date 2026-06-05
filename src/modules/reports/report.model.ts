import { Schema, model, Document } from 'mongoose';

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
  overallScore?: number;
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
    overallScore: { type: Number, min: 0, max: 100 },
    generatedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Report = model<IReport>('Report', ReportSchema);
