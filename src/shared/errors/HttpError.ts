import { AppError } from './AppError';

// Convenience factory for common HTTP errors
export const HttpError = {
  badRequest: (message = 'Bad Request') => new AppError(message, 400),
  unauthorized: (message = 'Unauthorized') => new AppError(message, 401),
  forbidden: (message = 'Forbidden') => new AppError(message, 403),
  notFound: (message = 'Not Found') => new AppError(message, 404),
  conflict: (message = 'Conflict') => new AppError(message, 409),
  unprocessable: (message = 'Unprocessable Entity') => new AppError(message, 422),
  internal: (message = 'Internal Server Error') => new AppError(message, 500, false),
  badGateway: (message = 'Bad Gateway (AI/Playwright)') => new AppError(message, 502),
};
