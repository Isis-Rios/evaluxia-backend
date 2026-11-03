import { AI_RETRY_CONFIG } from '@/config/constants';
import { DYNAMIC_ITERATIONS_CONFIG } from '@/modules/evaluations/services/dynamic-iterations.service';

/**
 * Fase 2.3 — Token/payload budget infrastructure (testing-only module).
 *
 * Thresholds calibrated from REAL measurements taken across this project's
 * incidents and E2E runs (see Fase 2 / 2.1 / 2.2 audits), not invented:
 *   - Phase 1 real: 14,832–16,001 chars / 3,708–4,001 estimated tokens /
 *     5,104–6,065 ACTUAL tokens (2 real E2E runs).
 *   - Phase 2 real, post-fix: 80,782–104,526 chars / 20,196–26,132
 *     estimated tokens / 34,512–45,194 ACTUAL promptTokens.
 *   - Phase 2 incident (pre-fix): 5,420,200–5,423,978 chars / ~1,350,000
 *     estimated tokens → real 429 RESOURCE_EXHAUSTED against Google's
 *     GenerateContentPaidTierInputTokensPerModelPerMinute = 1,000,000.
 *
 * These are a first calibration, expected to be refined once the stress
 * fixture suite (T1–T7) produces more data points across page complexities
 * — see Fase 2.3 plan section 2.
 */

export type PayloadLevel = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface PhaseBudget {
  /** Anything at or below this char count is NORMAL: proceed. */
  normalMaxChars: number;
  /** Above normalMaxChars and at or below this is WARNING: proceed, but log/flag for analysis. */
  warningMaxChars: number;
  /** Above warningMaxChars is CRITICAL: must NOT be sent to Gemini automatically (adjustment #3). */
}

export const PHASE1_BUDGET: PhaseBudget = {
  normalMaxChars: 30_000,
  warningMaxChars: 100_000,
};

export const PHASE2_BUDGET: PhaseBudget = {
  normalMaxChars: 300_000,
  warningMaxChars: 1_000_000,
};

/**
 * Real, confirmed Google quota this project has actually hit
 * (see Fase 2 incident): GenerateContentPaidTierInputTokensPerModelPerMinute.
 */
export const GOOGLE_TOKENS_PER_MINUTE_LIMIT = 1_000_000;

/**
 * Adjustment #1: chars/4 is a preventive LOCAL ESTIMATE, never a measurement
 * of what Gemini actually received. Callers must always label this
 * explicitly (e.g. `estimatedTokens`, never `tokens`) and, whenever a real
 * Gemini response is available, report `realUsage` (promptTokens/
 * outputTokens/totalTokens) alongside it rather than in place of it.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function classifyPayloadLevel(chars: number, budget: PhaseBudget): PayloadLevel {
  if (chars <= budget.normalMaxChars) return 'NORMAL';
  if (chars <= budget.warningMaxChars) return 'WARNING';
  return 'CRITICAL';
}

export interface RealGeminiUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface PayloadMeasurement {
  phase: 1 | 2;
  /** Observed size of the actual prompt string — a fact, not an estimate. */
  chars: number;
  bytes: number;
  /** chars/4 preventive estimate — see estimateTokensFromChars doc. */
  estimatedTokens: number;
  level: PayloadLevel;
  /**
   * Only present once a real Gemini call actually returned usageMetadata.
   * Never fabricate this — absence means "not measured yet", not "zero".
   */
  realUsage?: RealGeminiUsage;
}

export function measurePayload(phase: 1 | 2, prompt: string, realUsage?: RealGeminiUsage): PayloadMeasurement {
  const budget = phase === 1 ? PHASE1_BUDGET : PHASE2_BUDGET;
  const chars = prompt.length;
  return {
    phase,
    chars,
    bytes: Buffer.byteLength(prompt, 'utf8'),
    estimatedTokens: estimateTokensFromChars(chars),
    level: classifyPayloadLevel(chars, budget),
    realUsage,
  };
}

/**
 * Adjustment #3: a CRITICAL measurement must block the call before it
 * consumes credits — this function only classifies; the caller decides
 * what "block" means operationally. It never truncates or discards
 * evidence itself (that would violate the "no destruir evidencia" principle
 * — see Fase 2.3 plan section 12); it only reports the level so a future
 * caller can choose to escalate (compress further, mark NOT_EVALUABLE /
 * reduced scope) before ever calling Gemini.
 */
export function shouldBlockBeforeSending(measurement: PayloadMeasurement): boolean {
  return measurement.level === 'CRITICAL';
}

/**
 * Adjustment #5: whether a CRITICAL/WARNING result is acceptable depends on
 * whether the fixture is a deliberate stress scenario. A "functional" fixture
 * (a normal login form, a normal modal, etc.) landing in CRITICAL is itself
 * a bug signal; a fixture deliberately named/tagged as stress (e.g.
 * repeated-elements-500.html) is EXPECTED to exceed NORMAL, and the
 * assertion for those fixtures is "the pipeline detects and reports the
 * level accurately", not "the level is NORMAL".
 */
export function isAcceptableForFixtureKind(
  measurement: PayloadMeasurement,
  fixtureKind: 'functional' | 'stress',
): boolean {
  if (fixtureKind === 'functional') {
    return measurement.level !== 'CRITICAL';
  }
  // Stress fixtures may legitimately land in WARNING/CRITICAL; what matters
  // is that shouldBlockBeforeSending() correctly flags CRITICAL ones so the
  // pipeline never silently sends them to Gemini un-reviewed.
  return true;
}

/**
 * Adjustment #2 — analytical worst-case cumulative consumption within a
 * single Gemini per-minute quota window, given the CURRENT retry policy and
 * Phase 1's dynamic iteration cap. This is a calculation, not a runtime rate
 * limiter (none is implemented or proposed here). It assumes the
 * "CRITICAL blocks before sending" rule (adjustment #3) is respected, so the
 * largest payload that could actually reach Gemini per call is bounded by
 * each phase's `warningMaxChars` — not an unbounded CRITICAL payload.
 */
export interface WorstCaseCumulativeResult {
  requestsPerLogicalCall: number;
  phase1MaxIterations: number;
  phase1WorstCaseTokens: number;
  phase2WorstCaseTokens: number;
  combinedWorstCaseTokens: number;
  exceedsGoogleLimit: boolean;
}

export function computeWorstCaseCumulativeTokens(params?: {
  phase1MaxIterations?: number;
  maxRetries?: number;
}): WorstCaseCumulativeResult {
  const phase1MaxIterations = params?.phase1MaxIterations ?? DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT;
  const maxRetries = params?.maxRetries ?? AI_RETRY_CONFIG.maxRetries;
  const requestsPerLogicalCall = 1 + maxRetries;

  const phase1WorstCaseTokens =
    phase1MaxIterations * requestsPerLogicalCall * estimateTokensFromChars(PHASE1_BUDGET.warningMaxChars);
  const phase2WorstCaseTokens = requestsPerLogicalCall * estimateTokensFromChars(PHASE2_BUDGET.warningMaxChars);
  const combinedWorstCaseTokens = phase1WorstCaseTokens + phase2WorstCaseTokens;

  return {
    requestsPerLogicalCall,
    phase1MaxIterations,
    phase1WorstCaseTokens,
    phase2WorstCaseTokens,
    combinedWorstCaseTokens,
    exceedsGoogleLimit: combinedWorstCaseTokens > GOOGLE_TOKENS_PER_MINUTE_LIMIT,
  };
}
