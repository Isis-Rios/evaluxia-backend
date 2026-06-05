import { Request, Response } from 'express';
import { userService } from './user.service';
import { UpdateProfileDto } from './dto/user.dto';

/**
 * UserController — HTTP layer for user profile routes.
 * Thin: delegates all logic to UserService.
 * req.user is guaranteed by authenticate middleware on all routes.
 */
export class UserController {
  /**
   * GET /users/me
   * Returns the authenticated user's profile.
   */
  async getMe(req: Request, res: Response): Promise<void> {
    const user = await userService.getProfile(req.user!.userId);
    res.status(200).json({ status: 'success', data: user });
  }

  /**
   * PATCH /users/me
   * Updates the authenticated user's profile.
   */
  async updateMe(req: Request, res: Response): Promise<void> {
    const dto = req.body as UpdateProfileDto;
    const user = await userService.updateProfile(req.user!.userId, dto);
    res.status(200).json({ status: 'success', data: user });
  }
}

export const userController = new UserController();
