import { Schema, model, Document, Types } from 'mongoose';
import { EVALUATION_STATUS, EvaluationStatus } from '@/config/constants';

/**
 * Evaluation — Core entity representing a UX evaluation session (State Machine).
 */
export interface IEvaluation extends Document {
  userId: Types.ObjectId;
  archetypeId: Types.ObjectId;
  type: string; // 'prototype' | 'website'
  url: string;
  status: EvaluationStatus;
  
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
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    archetypeId: { type: Schema.Types.ObjectId, ref: 'Archetype', required: true },
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

// Index for efficient status-based queries
EvaluationSchema.index({ status: 1 });
EvaluationSchema.index({ createdAt: -1 });

export const Evaluation = model<IEvaluation>('Evaluation', EvaluationSchema);
