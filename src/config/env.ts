import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Environment variable schema — validated at startup.
 * If any required variable is missing, the process exits with a clear error.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Gemini AI (optional in this iteration)
  GEMINI_API_KEY: z.string().optional(),
  // P1.7.4-B / Ronda 2 — modelo por defecto bajo validación comparativa (ver
  // docs/experimental/model-comparison/gemini-model-comparison.md).
  // `gemini-3.5-flash-lite` y `gemini-2.5-flash` siguen disponibles
  // estableciendo GEMINI_MODEL en el entorno — este valor es el fallback
  // cuando la variable no se define.
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n');
  parsed.error.issues.forEach((issue) => {
    console.error(`   [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
