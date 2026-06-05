import { Request, Response } from 'express';
import { authService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto } from './dto/auth.dto';

/**
 * AuthController — HTTP layer for authentication routes.
 * Thin: only maps HTTP ↔ AuthService. No business logic here.
 */
export class AuthController {
  /**
   * POST /auth/register
   * Body: { name, email, password }
   */
  async register(req: Request, res: Response): Promise<void> {
    const dto = req.body as RegisterDto;
    const { user, tokens } = await authService.register(dto);
    res.status(201).json({ status: 'success', data: { user, tokens } });
  }

  /**
   * POST /auth/login
   * Body: { email, password }
   */
  async login(req: Request, res: Response): Promise<void> {
    const dto = req.body as LoginDto;
    const { user, tokens } = await authService.login(dto);
    res.status(200).json({ status: 'success', data: { user, tokens } });
  }

  /**
   * POST /auth/refresh
   * Body: { refreshToken }
   * Returns a new access token without requiring re-login.
   */
  async refresh(req: Request, res: Response): Promise<void> {
    const dto = req.body as RefreshDto;
    const { accessToken } = await authService.refresh(dto);
    res.status(200).json({ status: 'success', data: { accessToken } });
  }

  /**
   * POST /auth/logout
   * Requires: authenticate middleware (JWT guard)
   * Invalidates the stored refresh token in DB.
   */
  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(req.user!.userId);
    res.status(200).json({ status: 'success', message: 'Logged out successfully' });
  }

  /**
   * GET /auth/me
   * Requires: authenticate middleware
   * Returns the authenticated user's profile.
   */
  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getMe(req.user!.userId);
    res.status(200).json({ status: 'success', data: user });
  }
}

export const authController = new AuthController();
