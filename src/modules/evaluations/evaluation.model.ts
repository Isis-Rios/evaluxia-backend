import { Schema, model, Document, Types } from 'mongoose';
import {
  EVALUATION_STATUS,
  EvaluationStatus,
  AUDIT_STATUS,
  AuditStatus,
} from '@/config/constants';

/**
 * Evaluation — Core entity representing a UX evaluation session (State Machine).
 */
export interface IEvaluation extends Document {
  userId: Types.ObjectId;
  evaluatorProfileId: Types.ObjectId;
  title: string;
  description?: string;
  type: 'prototype' | 'website';
  url: string;
  status: EvaluationStatus;
  auditStatus: AuditStatus;

  // JSON Contract Mapping
  flowDefinition: {
    flowDescription: string;
    totalStepsEstimated: number;
  };
  flowState: {
    currentStep: number;
    completedSteps: string[];
    previousActions: Array<{ actionType: string; description: string; result: string }>;
    blockingError: string | null;
  };

  createdAt: Date;
  updatedAt: Date;
}

const EvaluationSchema = new Schema<IEvaluation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    evaluatorProfileId: { type: Schema.Types.ObjectId, ref: 'EvaluatorProfile', required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    type: { type: String, enum: ['prototype', 'website'], required: true },
    url: {
      type: String,
      required: [true, 'URL is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(EVALUATION_STATUS),
      default: EVALUATION_STATUS.PENDING,
    },
    auditStatus: {
      type: String,
      enum: Object.values(AUDIT_STATUS),
      default: AUDIT_STATUS.PENDING,
    },
    flowDefinition: {
      flowDescription: { type: String },
      totalStepsEstimated: { type: Number },
    },
    flowState: {
      currentStep: { type: Number, default: 1 },
      completedSteps: [{ type: String }],
      previousActions: [
        {
          actionType: { type: String },
          description: { type: String },
          result: { type: String, enum: ['success', 'failure'] },
        },
      ],
      blockingError: { type: String, default: null },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

EvaluationSchema.index({ status: 1 });
EvaluationSchema.index({ auditStatus: 1 });
EvaluationSchema.index({ createdAt: -1 });

export const Evaluation = model<IEvaluation>('Evaluation', EvaluationSchema);
