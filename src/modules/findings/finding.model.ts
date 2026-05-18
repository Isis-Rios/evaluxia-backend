import { Schema, model, Document } from 'mongoose';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'accessibility'
  | 'usability'
  | 'performance'
  | 'content'
  | 'navigation'
  | 'visual';

export interface IFinding extends Document {
  evaluationId: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  description: string;
  affectedElement?: string;
  recommendation: string;
  wcagCriteria?: string;
  screenshotRef?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FindingSchema = new Schema<IFinding>(
  {
    evaluationId: { type: String, required: true, index: true },
    severity: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low', 'info'],
      required: true,
    },
    category: {
      type: String,
      enum: ['accessibility', 'usability', 'performance', 'content', 'navigation', 'visual'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    affectedElement: { type: String },
    recommendation: { type: String, required: true },
    wcagCriteria: { type: String },
    screenshotRef: { type: String },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

FindingSchema.index({ evaluationId: 1, severity: 1 });

export const Finding = model<IFinding>('Finding', FindingSchema);
