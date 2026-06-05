import { Schema, model, Document } from 'mongoose';

export type UserRole = 'admin' | 'evaluator';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  refreshToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'evaluator'] as UserRole[],
      default: 'evaluator',
    },
    // Stored to allow refresh token invalidation (logout).
    // Null means the user is logged out.
    refreshToken: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      // Never expose sensitive fields in serialized output
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform: (_doc, ret: Record<string, any>) => {
        delete ret['passwordHash'];
        delete ret['refreshToken'];
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

export const User = model<IUser>('User', UserSchema);
