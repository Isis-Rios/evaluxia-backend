import { Schema, model, Document } from 'mongoose';

export type ExpertiseLevel = 'junior' | 'mid' | 'senior' | 'expert';

export interface IEvaluatorProfile extends Document {
  userId: string;           // Reference to auth user
  displayName: string;
  bio?: string;
  expertiseLevel: ExpertiseLevel;
  specializations: string[]; // e.g. ['accessibility', 'mobile-ux', 'e-commerce']
  totalEvaluations: number;
  averageScore?: number;
  certifications: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EvaluatorProfileSchema = new Schema<IEvaluatorProfile>(
  {
    userId: { type: String, required: true, unique: true },
    displayName: { type: String, required: true, trim: true },
    bio: { type: String, maxlength: 500 },
    expertiseLevel: {
      type: String,
      enum: ['junior', 'mid', 'senior', 'expert'],
      default: 'junior',
    },
    specializations: [{ type: String }],
    totalEvaluations: { type: Number, default: 0 },
    averageScore: { type: Number, min: 0, max: 100 },
    certifications: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const EvaluatorProfile = model<IEvaluatorProfile>('EvaluatorProfile', EvaluatorProfileSchema);
