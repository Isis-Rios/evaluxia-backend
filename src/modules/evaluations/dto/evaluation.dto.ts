import { z } from 'zod';

/**
 * Zod schemas for Evaluation DTOs.
 * These schemas serve as the single source of truth for request validation.
 */

export const CreateEvaluationSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters'),
  targetUrl: z
    .string()
    .url('targetUrl must be a valid URL (include https://)'),
  description: z
    .string()
    .max(1000, 'Description cannot exceed 1000 characters')
    .optional(),
});

export const UpdateEvaluationSchema = CreateEvaluationSchema.partial();

export const GetEvaluationsQuerySchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateEvaluationDto = z.infer<typeof CreateEvaluationSchema>;
export type UpdateEvaluationDto = z.infer<typeof UpdateEvaluationSchema>;
export type GetEvaluationsQuery = z.infer<typeof GetEvaluationsQuerySchema>;
