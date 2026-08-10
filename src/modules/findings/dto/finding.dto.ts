import { z } from 'zod';
import {
  TechnicalEvidenceItemSchema,
  AffectedElementSchema,
} from '@/modules/ai/contracts/ai.contracts';

/**
 * Zod schemas for Finding DTOs (Subetapa 3B).
 */

export const CreateFindingSchema = z.object({
  evaluationId: z.string().min(1, 'evaluationId is required'),
  iteration: z.number().int().min(1),
  findingGroup: z.enum(['ux', 'accessibility']),
  type: z.string().max(100).nullish(),
  status: z.enum(['PASS', 'FAIL', 'NOT_EVALUABLE']).default('FAIL'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['high', 'medium', 'low']).default('high'),
  description: z.string().min(1, 'Description is required').max(2000),

  // UX-specific
  heuristicCode: z.string().max(100).nullish(),
  heuristicName: z.string().max(200).nullish(),
  heuristic: z.string().max(200).nullish(),
  affectedArchetypeTraits: z.array(z.string().max(100)).nullish(),

  // Accessibility-specific
  wcagCriterion: z.string().max(100).nullish(),

  // Evidence-based fields
  evidence: z.array(TechnicalEvidenceItemSchema).optional(),
  affectedElement: AffectedElementSchema.optional(),
  impact: z.string().optional(),
  recommendation: z.string().nullable().optional(),
  screenshotUrl: z.string().optional(),
});

export const UpdateFindingSchema = CreateFindingSchema.partial().omit({
  evaluationId: true,
  iteration: true,
});

export const GetFindingsQuerySchema = z.object({
  evaluationId: z.string().optional(),
  findingGroup: z.enum(['ux', 'accessibility']).optional(),
  status: z.enum(['PASS', 'FAIL', 'NOT_EVALUABLE']).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFindingDto = z.infer<typeof CreateFindingSchema>;
export type UpdateFindingDto = z.infer<typeof UpdateFindingSchema>;
export type GetFindingsQuery = z.infer<typeof GetFindingsQuerySchema>;
