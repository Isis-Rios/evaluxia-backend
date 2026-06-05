import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { userRepository } from '@/modules/users/user.repository';
import { IUser } from '@/modules/users/user.model';
import { HttpError } from '@/shared/errors/HttpError';
import { RegisterDto, LoginDto, RefreshDto } from './dto/auth.dto';

const SALT_ROUNDS = 12;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  user: IUser;
  tokens: TokenPair;
}

/**
 * AuthService — Business logic for authentication lifecycle.
 *
 * Responsibilities:
 *   - Hash / compare passwords with bcrypt
 *   - Issue / verify JWT access + refresh tokens
 *   - Persist refresh tokens via UserRepository for invalidation support
 *
 * Does NOT touch Express (req/res). Fully testable in isolation.
 */
export class AuthService {
  // ─── Token Helpers ────────────────────────────────────────────────────────

  private generateAccessToken(user: IUser): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
  }

  private generateRefreshToken(user: IUser): string {
    return jwt.sign(
      { userId: user.id },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
  }

  private async issueTokenPair(user: IUser): Promise<TokenPair> {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);
    await userRepository.updateRefreshToken(user.id, refreshToken);
    return { accessToken, refreshToken };
  }

  // ─── Auth Operations ──────────────────────────────────────────────────────

  /**
   * Register a new user.
   * Throws 409 if the email is already taken.
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await userRepository.findByEmail(dto.email);
    if (existing) {
      throw HttpError.conflict('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await userRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });

    const tokens = await this.issueTokenPair(user);
    return { user, tokens };
  }

  /**
   * Login with email + password.
   * Throws 401 for any credential mismatch (intentionally vague for security).
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await userRepository.findByEmail(dto.email);

    // Constant-time comparison to prevent timing attacks
    const passwordHash = user?.passwordHash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXX';
    const isValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !isValid) {
      throw HttpError.unauthorized('Invalid email or password');
    }

    const tokens = await this.issueTokenPair(user);
    return { user, tokens };
  }

  /**
   * Refresh access token using a valid refresh token.
   * Throws 401 if the token is invalid, expired, or revoked.
   */
  async refresh(dto: RefreshDto): Promise<{ accessToken: string }> {
    // 1. Verify the JWT signature and expiry
    let payload: { userId: string };
    try {
      payload = jwt.verify(dto.refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };
    } catch {
      throw HttpError.unauthorized('Invalid or expired refresh token');
    }

    // 2. Confirm the token is still stored in DB (not revoked via logout)
    const user = await userRepository.findByRefreshToken(dto.refreshToken);
    if (!user || user.id !== payload.userId) {
      throw HttpError.unauthorized('Refresh token has been revoked');
    }

    const accessToken = this.generateAccessToken(user);
    return { accessToken };
  }

  /**
   * Logout — invalidates the stored refresh token.
   * The access token expires naturally (short-lived).
   */
  async logout(userId: string): Promise<void> {
    await userRepository.updateRefreshToken(userId, null);
  }

  /**
   * Get the currently authenticated user's profile.
   */
  async getMe(userId: string): Promise<IUser> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw HttpError.notFound('User not found');
    }
    return user;
  }
}

export const authService = new AuthService();
