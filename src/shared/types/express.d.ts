import { Request } from 'express';

/**
 * Augment Express Request with EvalUXIA-specific properties.
 * Add authenticated user context here once auth is implemented.
 */
declare global {
  namespace Express {
    interface Request {
      // Will be populated by auth middleware
      user?: {
        id: string;
        email: string;
        role: 'admin' | 'evaluator' | 'viewer';
      };
      // Evaluation session context (set by evaluation middleware)
      evaluationId?: string;
    }
  }
}

export {};
