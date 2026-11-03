/**
 * Originally created for H-REGRESSION-2 as a harness-only contract check.
 * J6 hardening (Post-Fase H) extends it with `applyCardinalityEnforcement`,
 * now consumed from production (`audit-engine.service.ts`) as the BACKEND
 * enforcement half of "Prompt = prevención, Backend = enforcement" — same
 * documented tension as `payload-budgets.ts` (J2), which this module now
 * mirrors: it lives under `src/shared/testing/` for historical/harness
 * reasons but is imported by production code. Not moved in this pass to
 * avoid an unrelated refactor.
 *
 * Contract: "1 finding = 1 WCAG criterion" (rule 4 of ABSOLUTE AUDIT RULE in
 * ai.service.ts's buildV2AuditPrompt, added post-H-REGRESSION-1).
 *
 * This is DELIBERATELY separate from `normalizeCriterionKey`
 * (audit-metrics.service.ts / ground-truth-oracle.ts): that function
 * EXTRACTS one canonical code from a string (first-match), which is exactly
 * why it can silently succeed even on a combined string. This module instead
 * COUNTS how many distinct WCAG codes appear in a `wcagCriterion` string, so
 * it can flag a contract violation that `normalizeCriterionKey` would mask.
 *
 * `checkWcagCardinality`/`countWcagCodesInCriterion`/`violatesWcagCardinality`
 * never modify, block, or correct any finding; they only report.
 * `applyCardinalityEnforcement` is the one addition that acts: it degrades
 * (never rewrites/splits/picks-a-winner) — see its own docstring.
 */

/** Counts how many distinct "WCAG X.Y.Z" code occurrences appear in a string. */
export function countWcagCodesInCriterion(criterion: string | null | undefined): number {
  if (!criterion) return 0;
  const matches = criterion.match(/WCAG\s+\d+\.\d+\.\d+/gi);
  return matches ? matches.length : 0;
}

/** True when a `wcagCriterion` string contains MORE THAN ONE WCAG code. */
export function violatesWcagCardinality(criterion: string | null | undefined): boolean {
  return countWcagCodesInCriterion(criterion) > 1;
}

export interface CardinalityCheckResult {
  index: number;
  selector: string;
  wcagCriterion: string | null | undefined;
  codeCount: number;
  violatesCardinality: boolean;
}

/**
 * Runs the cardinality check across a batch of raw (pre-EvidenceGate)
 * findings as returned directly by Gemini — the exact shape H-REGRESSION-2
 * inspects. Only findings carrying a non-empty `wcagCriterion` are checked;
 * pure Nielsen (heuristicCode-only) findings are not applicable and are
 * excluded from the result set entirely (not reported as passing).
 */
export function checkWcagCardinality(
  findings: Array<{ wcagCriterion?: string | null; affectedElement?: { selector?: string } }>,
): CardinalityCheckResult[] {
  return findings
    .map((f, index) => ({
      index,
      selector: f.affectedElement?.selector ?? 'n/a',
      wcagCriterion: f.wcagCriterion,
      codeCount: countWcagCodesInCriterion(f.wcagCriterion),
      violatesCardinality: violatesWcagCardinality(f.wcagCriterion),
    }))
    .filter((r) => r.wcagCriterion != null && r.wcagCriterion !== '');
}

export interface CardinalityEnforcementSummary {
  total: number;
  violations: number;
}

/**
 * J6 (Hardening Post-Fase H) — BACKEND enforcement of the cardinality
 * contract, independent of the prompt-level prevention (rule 4). Runs after
 * receiving Gemini's response, before findings are consolidated.
 *
 * Behavior on violation: degrade to NOT_EVALUABLE/confidence=low — the same
 * pattern J1/EvidenceGate already use. Never picks a "winning" code from the
 * combined string, never splits the finding into several — the contract is
 * that GEMINI must comply, not that the backend repairs non-compliant input.
 */
export function applyCardinalityEnforcement<
  T extends { wcagCriterion?: string | null; status?: string; confidence?: string; recommendation?: string | null },
>(findings: T[]): { findings: T[]; summary: CardinalityEnforcementSummary } {
  let violations = 0;

  const result = findings.map((f) => {
    if (!violatesWcagCardinality(f.wcagCriterion)) return f;
    violations++;
    return { ...f, status: 'NOT_EVALUABLE', confidence: 'low', recommendation: null };
  });

  console.log(`[WcagCardinalityAudit] total=${findings.length} violations=${violations}`);

  return { findings: result, summary: { total: findings.length, violations } };
}
