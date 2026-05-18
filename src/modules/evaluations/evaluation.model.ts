import { Schema, model, Document } from 'mongoose';
import { EVALUATION_STATUS, EvaluationStatus } from '@/config/constants';

/**
 * Evaluation — Core entity representing a UX evaluation session.
 */
export interface IEvaluation extends Document {
  title: string;
  targetUrl: string;
  status: EvaluationStatus;
  description?: string;
  findings: string[];        // References to Finding documents
  aiAnalysis?: string;       // Raw AI analysis text
  screenshotPaths: string[]; // Paths to captured screenshots
  createdAt: Date;
  updatedAt: Date;
}

const EvaluationSchema = new Schema<IEvaluation>(
  {
    title: {
      type: String,
      required: [true, 'Evaluation title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    targetUrl: {
      type: String,
      required: [true, 'Target URL is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(EVALUATION_STATUS),
      default: EVALUATION_STATUS.PENDING,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    findings: [{ type: String }],
    aiAnalysis: { type: String },
    screenshotPaths: [{ type: String }],
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Index for efficient status-based queries
EvaluationSchema.index({ status: 1 });
EvaluationSchema.index({ createdAt: -1 });

export const Evaluation = model<IEvaluation>('Evaluation', EvaluationSchema);
