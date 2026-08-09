import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '@/shared/errors/AppError';

type ValidateTarget = 'body' | 'query' | 'params';

/**
 * validate — Factory middleware that validates an Express request segment
 * against a Zod schema before the request reaches the controller.
 *
 * Usage:
 *   router.post('/evaluations', validate(CreateEvaluationSchema), controller.create);
 *   router.get('/evaluations', validate(GetEvaluationsQuerySchema, 'query'), controller.findAll);
 */
export function validate(
  schema: ZodSchema,
  target: ValidateTarget = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const error = result.error as ZodError;
      const messages = error.issues
        .map((issue) => `[${issue.path.join('.')}] ${issue.message}`)
        .join('; ');

      return next(new AppError(`Validation error: ${messages}`, 400));
    }

    // Attach validated + coerced data back to request
    if (target === 'body') {
      req.body = result.data;
    } else {
      // req.query and req.params are getters in Express, mutating their content is safer
      for (const key in req[target]) {
        delete req[target][key];
      }
      Object.assign(req[target], result.data);
    }
    next();
  };
}
