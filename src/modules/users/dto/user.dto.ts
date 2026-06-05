import { z } from 'zod';

/**
 * Zod schemas for User DTOs.
 */

export const UpdateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .trim(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
