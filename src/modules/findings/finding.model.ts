import { Schema, model, Document, Types } from 'mongoose';

export type FindingGroup = 'ux' | 'accessibility';
export type FindingSeverity = 'high' | 'medium' | 'low';

/**
 * Finding — Unifies UX and Accessibility findings returned by Gemini.
 */
export interface IFinding extends Document {
  evaluationId: Types.ObjectId;
  iteration: number;
  findingGroup: FindingGroup;
  type?: string; // usability, content, interaction, visual (for UX)
  severity: FindingSeverity;
  description: string;
  
  // UX Specific
  heuristic?: string;
  affectedArchetypeTraits?: string[];
  
  // Accessibility Specific
  wcagCriterion?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const FindingSchema = new Schema<IFinding>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true, index: true },
    iteration: { type: Number, required: true, min: 1 },
    findingGroup: { type: String, enum: ['ux', 'accessibility'], required: true },
    type: { type: String },
    severity: { type: String, enum: ['high', 'medium', 'low'], required: true },
    description: { type: String, required: true },
    
    // UX Specific
    heuristic: { type: String },
    affectedArchetypeTraits: [{ type: String }],
    
    // Accessibility Specific
    wcagCriterion: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

FindingSchema.index({ evaluationId: 1, findingGroup: 1 });

export const Finding = model<IFinding>('Finding', FindingSchema);
