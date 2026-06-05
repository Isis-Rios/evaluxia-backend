import { z } from 'zod';

export const CreateEvaluatorProfileSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(100).trim(),
  phrase: z.string().min(5, 'Phrase is required').max(300).trim(),
  age: z.number().int().min(0).max(120),
  profession: z.string().min(2).max(100).trim(),
  maritalStatus: z.string().min(2).max(50).trim(),
  country: z.string().min(2).max(100).trim(),
  city: z.string().min(2).max(100).trim(),
  archetype: z.string().min(2).max(100).trim(),
  biography: z.string().min(10, 'Biography is required').max(2000).trim(),
  personality: z.string().min(5, 'Personality description is required').max(500).trim(),
  goals: z.array(z.string().min(1).max(200)).min(1, 'At least one goal is required').max(10),
  frustrations: z
    .array(z.string().min(1).max(200))
    .min(1, 'At least one frustration is required')
    .max(10),
  
  techSavviness: z.enum(['low', 'medium', 'high']).default('medium'),
  accessibilityNeeds: z.array(z.string().max(100)).default([]),
  preferredDevice: z.enum(['desktop', 'mobile', 'tablet']).default('desktop'),
});

export const UpdateEvaluatorProfileSchema = CreateEvaluatorProfileSchema.partial();

export const GetEvaluatorProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateEvaluatorProfileDto = z.infer<typeof CreateEvaluatorProfileSchema>;
export type UpdateEvaluatorProfileDto = z.infer<typeof UpdateEvaluatorProfileSchema>;
export type GetEvaluatorProfilesQuery = z.infer<typeof GetEvaluatorProfilesQuerySchema>;
