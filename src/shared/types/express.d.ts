import 'express';

/**
 * Extends Express Request with EvalUXIA-specific properties.
 * req.user is populated by authenticate.middleware after JWT verification.
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      };
      evaluationId?: string;
    }
  }
}

export {};
