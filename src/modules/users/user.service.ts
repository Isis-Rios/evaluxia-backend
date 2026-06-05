import { IUser } from './user.model';
import { userRepository } from './user.repository';
import { UpdateProfileDto } from './dto/user.dto';
import { HttpError } from '@/shared/errors/HttpError';

/**
 * UserService — Business logic for user profile management.
 *
 * Auth-related logic (register/login/refresh/logout) lives in AuthService.
 * This service handles post-authentication profile operations.
 */
export class UserService {
  /**
   * Returns the authenticated user's profile.
   * Throws 404 if the user no longer exists (e.g., deleted account).
   */
  async getProfile(userId: string): Promise<IUser> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw HttpError.notFound('User not found');
    }
    return user;
  }

  /**
   * Updates the authenticated user's profile fields.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<IUser> {
    const user = await userRepository.update(userId, dto);
    if (!user) {
      throw HttpError.notFound('User not found');
    }
    return user;
  }
}

export const userService = new UserService();
