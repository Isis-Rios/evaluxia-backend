import { z } from 'zod';

/**
 * Zod schemas for Finding DTOs.
 */

export const CreateFindingSchema = z.object({
  evaluationId: z.string().min(1, 'evaluationId is required'),
  iteration: z.number().int().min(1),
  findingGroup: z.enum(['ux', 'accessibility']),
  type: z.string().max(100).nullish(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000),

  // UX-specific
  heuristic: z.string().max(200).nullish(),
  affectedArchetypeTraits: z.array(z.string().max(100)).nullish(),

  // Accessibility-specific
  wcagCriterion: z.string().max(100).nullish(),
});

export const UpdateFindingSchema = CreateFindingSchema.partial().omit({
  evaluationId: true,
  iteration: true,
});

export const GetFindingsQuerySchema = z.object({
  evaluationId: z.string().optional(),
  findingGroup: z.enum(['ux', 'accessibility']).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFindingDto = z.infer<typeof CreateFindingSchema>;
export type UpdateFindingDto = z.infer<typeof UpdateFindingSchema>;
export type GetFindingsQuery = z.infer<typeof GetFindingsQuerySchema>;
