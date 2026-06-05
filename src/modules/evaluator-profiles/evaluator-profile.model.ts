import { Schema, model, Document, Types } from 'mongoose';

/**
 * EvaluatorProfile — Represents the User Persona/Archetype simulated by Gemini
 * during UX and Accessibility evaluations.
 */
export interface IEvaluatorProfile extends Document {
  userId: Types.ObjectId;
  
  // Base Persona details
  fullName: string;
  phrase: string;
  age: number;
  profession: string;
  maritalStatus: string;
  country: string;
  city: string;
  archetype: string;
  biography: string;
  personality: string;
  goals: string[];
  frustrations: string[];

  // UX & Accessibility attributes
  techSavviness: 'low' | 'medium' | 'high';
  accessibilityNeeds: string[];
  preferredDevice: 'desktop' | 'mobile' | 'tablet';

  createdAt: Date;
  updatedAt: Date;
}

const EvaluatorProfileSchema = new Schema<IEvaluatorProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    
    fullName: { type: String, required: true },
    phrase: { type: String, required: true },
    age: { type: Number, required: true, min: 0 },
    profession: { type: String, required: true },
    maritalStatus: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, required: true },
    archetype: { type: String, required: true },
    biography: { type: String, required: true },
    personality: { type: String, required: true },
    goals: [{ type: String }],
    frustrations: [{ type: String }],

    techSavviness: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
      default: 'medium'
    },
    accessibilityNeeds: [{ type: String }],
    preferredDevice: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet'],
      required: true,
      default: 'desktop'
    }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const EvaluatorProfile = model<IEvaluatorProfile>('EvaluatorProfile', EvaluatorProfileSchema);
