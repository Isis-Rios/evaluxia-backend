import { User, IUser } from './user.model';
import { Types } from 'mongoose';

/**
 * UserRepository — Encapsulates all Mongoose operations for the User model.
 *
 * Services never import the Mongoose model directly;
 * they always go through this repository.
 */
export class UserRepository {
  /** Find a user by their MongoDB ObjectId. Returns null if not found. */
  async findById(id: string): Promise<IUser | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return User.findById(id);
  }

  /** Find a user by email (case-insensitive, handled at model level). */
  async findByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email: email.toLowerCase().trim() });
  }

  /** Find a user by their stored refresh token. */
  async findByRefreshToken(token: string): Promise<IUser | null> {
    return User.findOne({ refreshToken: token });
  }

  /** Create a new user document. */
  async create(data: {
    name: string;
    email: string;
    passwordHash: string;
    role?: 'admin' | 'evaluator';
  }): Promise<IUser> {
    return User.create(data);
  }

  /** Update the stored refresh token. Pass null to invalidate (logout). */
  async updateRefreshToken(id: string, token: string | null): Promise<void> {
    await User.findByIdAndUpdate(id, { refreshToken: token });
  }

  /** Update user profile fields. */
  async update(id: string, data: { name?: string }): Promise<IUser | null> {
    return User.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  }
}

export const userRepository = new UserRepository();
