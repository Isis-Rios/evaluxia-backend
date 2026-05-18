import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { loggerMiddleware } from '@/shared/middleware/logger.middleware';
import { errorMiddleware } from '@/shared/middleware/error.middleware';
import { API_PREFIX, APP_NAME, APP_VERSION } from '@/config/constants';
import { env } from '@/config/env';

// Module routes
import { evaluationRoutes } from '@/modules/evaluations/evaluation.routes';
import { aiRoutes } from '@/modules/ai/ai.controller';
import { automationRoutes } from '@/modules/automation/automation.controller';
import { authRoutes } from '@/modules/auth/auth.routes';
import { findingsRoutes } from '@/modules/findings/findings.routes';
import { reportsRoutes } from '@/modules/reports/reports.routes';
import { evaluatorProfilesRoutes } from '@/modules/evaluator-profiles/evaluator-profiles.routes';

/**
 * createApp — Configures and returns the Express application.
 * Separated from server startup to allow easy testing.
 */
export function createApp(): Application {
  const app = express();

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
  app.use(`${API_PREFIX}/evaluations`, evaluationRoutes);
  app.use(`${API_PREFIX}/ai`, aiRoutes);
  app.use(`${API_PREFIX}/automation`, automationRoutes);
  app.use(`${API_PREFIX}/auth`, authRoutes);
  app.use(`${API_PREFIX}/findings`, findingsRoutes);
  app.use(`${API_PREFIX}/reports`, reportsRoutes);
  app.use(`${API_PREFIX}/evaluator-profiles`, evaluatorProfilesRoutes);

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
