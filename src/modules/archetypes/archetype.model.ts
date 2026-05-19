import { Schema, model, Document, Types } from 'mongoose';

/**
 * Archetype — Represents the User Persona/Archetype simulated by Gemini
 * during UX evaluations.
 */
export interface IArchetype extends Document {
  userId: Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

const ArchetypeSchema = new Schema<IArchetype>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const Archetype = model<IArchetype>('Archetype', ArchetypeSchema);
