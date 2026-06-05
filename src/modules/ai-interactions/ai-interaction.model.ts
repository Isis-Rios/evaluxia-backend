import { Schema, model, Document, Types } from 'mongoose';

/**
 * AiInteraction — Logs AI requests and responses for academic tracking,
 * debugging, and cost estimation (tokens).
 */
export interface IAiInteraction extends Document {
  evaluationId: Types.ObjectId;
  iteration: number;
  requestTokens: number;
  responseTokens: number;
  executionTimeMs: number;
  metadata: any; // model used, parameters, summary of inputs
  createdAt: Date;
  updatedAt: Date;
}

const AiInteractionSchema = new Schema<IAiInteraction>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true },
    iteration: { type: Number, required: true, min: 1 },
    requestTokens: { type: Number, default: 0 },
    responseTokens: { type: Number, default: 0 },
    executionTimeMs: { type: Number, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const AiInteraction = model<IAiInteraction>('AiInteraction', AiInteractionSchema);
