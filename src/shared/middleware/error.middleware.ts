import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/shared/errors/AppError';
import { env } from '@/config/env';

interface ErrorResponse {
  status: 'error';
  message: string;
  statusCode: number;
  stack?: string;
}

/**
 * Global error handling middleware for Express.
 *
 * - Express 5 automatically catches async errors — no need for express-async-errors.
 * - Operational errors (AppError) expose their message safely to clients.
 * - Programming errors (unexpected) return a generic 500 to avoid leaking internals.
 * - Stack traces are only included in development mode.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Handle known operational AppErrors
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      status: 'error',
      message: err.message,
      statusCode: err.statusCode,
    };

    if (env.NODE_ENV === 'development') {
      response.stack = err.stack;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle Zod validation errors that bubble up
  if (err instanceof Error && err.name === 'ZodError') {
    res.status(422).json({
      status: 'error',
      message: 'Validation failed',
      statusCode: 422,
      issues: (err as any).issues,
    });
    return;
  }

  // Handle Mongoose validation errors
  if (err instanceof Error && err.name === 'ValidationError') {
    res.status(400).json({
      status: 'error',
      message: err.message,
      statusCode: 400,
    });
    return;
  }

  // Unknown / programming errors — do not expose details
  const isDev = env.NODE_ENV === 'development';
  console.error('💥  Unexpected error:', err);

  res.status(500).json({
    status: 'error',
    message: isDev
      ? (err instanceof Error ? err.message : String(err))
      : 'Internal server error',
    statusCode: 500,
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  });
}
