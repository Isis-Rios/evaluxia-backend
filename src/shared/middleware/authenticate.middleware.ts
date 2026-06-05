import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';

interface JwtAccessPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * authenticate — JWT guard middleware.
 *
 * Reads the Bearer token from `Authorization` header,
 * verifies it against JWT_ACCESS_SECRET, and injects
 * `req.user` with the decoded payload.
 *
 * Throws 401 if the token is missing, malformed, or expired.
 *
 * Usage:
 *   router.get('/protected', authenticate, controller.handler);
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('No token provided. Use Authorization: Bearer <token>', 401));
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtAccessPayload;

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Access token expired', 401));
    }
    return next(new AppError('Invalid access token', 401));
  }
}
