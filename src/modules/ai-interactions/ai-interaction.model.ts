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
  promptContext: any; // Raw JSON payload sent to Gemini
  rawResponse: any;   // Raw JSON payload received from Gemini
  createdAt: Date;
  updatedAt: Date;
}

const AiInteractionSchema = new Schema<IAiInteraction>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true },
    iteration: { type: Number, required: true, min: 1 },
    requestTokens: { type: Number, default: 0 },
    responseTokens: { type: Number, default: 0 },
    promptContext: { type: Schema.Types.Mixed, required: true },
    rawResponse: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const AiInteraction = model<IAiInteraction>('AiInteraction', AiInteractionSchema);
