import morgan from 'morgan';
import { env } from '@/config/env';

/**
 * HTTP request logger middleware.
 * - 'dev' format in development: concise colored output
 * - 'combined' format in production: Apache-style logs for log aggregators
 */
export const loggerMiddleware = morgan(
  env.NODE_ENV === 'production' ? 'combined' : 'dev',
);
