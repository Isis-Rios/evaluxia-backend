import { z } from 'zod';

/**
 * AI Contracts — Strict JSON schemas for all AI input/output communication.
 *
 * EvalUXIA Design Principle:
 *   - The AI does NOT execute actions. It only reasons and returns structured JSON.
 *   - The backend orchestrator interprets the AI response and decides what to do next.
 *   - Every AI call must have a defined input contract and a validated output contract.
 */

// ─── Input Contracts ──────────────────────────────────────────────────────────

export const UxAnalysisInputSchema = z.object({
  url: z.string().url(),
  pageTitle: z.string(),
  domSnapshot: z.string(),       // Serialized DOM structure extracted by Playwright
  screenshots: z.array(z.string()).optional(), // Base64 encoded screenshots
  evaluationContext: z.string().optional(),    // Optional instructions from evaluator
  evaluatorProfile: z.object({
    fullName: z.string(),
    phrase: z.string(),
    age: z.number(),
    profession: z.string(),
    archetype: z.string(),
    techSavviness: z.string(),
    accessibilityNeeds: z.array(z.string()),
    goals: z.array(z.string()),
    frustrations: z.array(z.string()),
  }),
});

export type UxAnalysisInput = z.infer<typeof UxAnalysisInputSchema>;

// ─── Output Contracts ─────────────────────────────────────────────────────────

export const UxFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: z.enum([
    'accessibility',
    'usability',
    'performance',
    'content',
    'navigation',
    'visual',
  ]),
  title: z.string(),
  description: z.string(),
  affectedElement: z.string().nullish(),
  recommendation: z.string(),
  wcagCriteria: z.string().nullish(),
});

export const UxAnalysisOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(UxFindingSchema),
  nextActions: z.array(z.string()), // Suggested next steps for the evaluator
});

export type UxFinding = z.infer<typeof UxFindingSchema>;
export type UxAnalysisOutput = z.infer<typeof UxAnalysisOutputSchema>;
