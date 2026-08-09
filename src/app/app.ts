import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';

import { loggerMiddleware } from '@/shared/middleware/logger.middleware';
import { errorMiddleware } from '@/shared/middleware/error.middleware';
import { API_PREFIX, APP_NAME, APP_VERSION } from '@/config/constants';
import { env } from '@/config/env';

// Module routes
import { authRoutes } from '@/modules/auth/auth.routes';
import { userRoutes } from '@/modules/users/user.routes';
import { evaluatorProfileRoutes } from '@/modules/evaluator-profiles/evaluator-profile.routes';
import { evaluationRoutes } from '@/modules/evaluations/evaluation.routes';
import { findingsRoutes } from '@/modules/findings/findings.routes';
import { automationRoutes } from '@/modules/automation/automation.controller';
import { aiRoutes } from '@/modules/ai/ai.controller';

/**
 * createApp — Configures and returns the Express application.
 * Separated from server startup to allow easy testing.
 */
export function createApp(): Application {
  const app = express();

  // Serve screenshots as static assets
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // ─── Security Middleware ─────────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // ─── Request Parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' })); // 10MB for DOM snapshots + base64 screenshots
  app.use(express.urlencoded({ extended: true }));

  // ─── Logger ──────────────────────────────────────────────────────────────────
  app.use(loggerMiddleware);

  // ─── Health Check ─────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      app: APP_NAME,
      version: APP_VERSION,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── API Routes ──────────────────────────────────────────────────────────────
  app.use(`${API_PREFIX}/auth`, authRoutes);
  app.use(`${API_PREFIX}/users`, userRoutes);
  app.use(`${API_PREFIX}/evaluator-profiles`, evaluatorProfileRoutes);
  app.use(`${API_PREFIX}/evaluations`, evaluationRoutes);
  app.use(`${API_PREFIX}/findings`, findingsRoutes);
  app.use(`${API_PREFIX}/automation`, automationRoutes);
  app.use(`${API_PREFIX}/ai`, aiRoutes);

  // ─── 404 Handler ─────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      status: 'error',
      message: `Route not found. Available prefix: ${API_PREFIX}`,
      statusCode: 404,
    });
  });

  // ─── Global Error Handler (must be last) ─────────────────────────────────────
  app.use(errorMiddleware);

  return app;
}
