/**
 * AppError — Base class for all operational application errors.
 *
 * Distinguishes between:
 * - isOperational: true  → predictable errors (validation, not found, auth). Safe to expose.
 * - isOperational: false → programming bugs, unexpected failures. Should not expose details.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
