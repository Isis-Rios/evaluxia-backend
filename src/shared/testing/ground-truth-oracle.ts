/**
 * Fase 2.3 — Ground Truth Oracle (testing-only module).
 *
 * Compares a fixture's expected Ground Truth against EvalUXIA's actual
 * findings, distinguishing EXACT / SEMANTIC / NONDETERMINISTIC comparison
 * modes per criterion — see Fase 2.3 plan section 7. Deliberately does NOT
 * reduce to `findingCount === expectedCount`: that comparison is explicitly
 * rejected by design (a single scalar count can't tell you whether the
 * RIGHT criteria passed/failed, whether an unrelated criterion was wrongly
 * flagged, or whether duplicates crept back in).
 */

export type CriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export type MatchMode = 'EXACT' | 'SEMANTIC' | 'NONDETERMINISTIC';

export interface GroundTruthCriterion {
  /** Canonical code, e.g. "WCAG 3.3.2" or "N-05" — same normalization as audit-metrics.service.ts. */
  code: string;
  expectedStatus: CriterionStatus;
  match: MatchMode;
  verifiableBy: 'deterministic' | 'ai' | 'requires-interaction';
  /**
   * Only meaningful for `match: 'SEMANTIC'`. If omitted, defaults to
   * `[expectedStatus, 'NOT_EVALUABLE']` — Gemini abstaining into
   * NOT_EVALUABLE on ambiguous evidence is an acceptable (if not ideal)
   * outcome, never treated as a hard failure of the oracle by itself.
   */
  acceptableStatuses?: CriterionStatus[];
  selectorHint?: string;
  note?: string;
}

export interface GroundTruthMustNotAppear {
  code: string;
  reason: string;
}

export interface GroundTruth {
  fixture: string;
  criteria: GroundTruthCriterion[];
  mustNotAppear?: GroundTruthMustNotAppear[];
  elementCounts?: Record<string, number>;
  /**
   * Fase I.1 (finding-level quality methodology) — OPTIONAL, additive.
   * Declared here only as a type extension; `evaluateGroundTruth()` above
   * NEVER reads this field and its behavior is completely unchanged. The
   * actual evaluation of `expectedFindings` lives in the INDEPENDENT module
   * `finding-matching.ts` (`matchFindings()`), never inside this file.
   * See `ExpectedFinding` in `finding-matching.ts` for the shape.
   */
  expectedFindings?: import('./finding-matching').ExpectedFinding[];
}

/**
 * Structural shape the oracle needs from an actual finding — matches both
 * `ConsolidatedFinding` (audit-metrics.service.ts) and `DeterministicFinding`
 * (deterministic-analyzer.service.ts) without adaptation (TS structural
 * typing), so callers can pass either array directly.
 */
export interface ActualFindingLike {
  wcagCriterion?: string;
  heuristicCode?: string;
  status: string;
  affectedElement?: { selector?: string; tag?: string };
}

export interface OracleCriterionResult {
  code: string;
  expectedStatus: CriterionStatus;
  match: MatchMode;
  /** All actual entries whose normalized code matched this criterion. */
  actualStatuses: CriterionStatus[];
  /** `true` when no matching finding was found at all (status list is empty). */
  missing: boolean;
  passed: boolean;
  reason: string;
}

export interface OracleDuplicateViolation {
  criterionKey: string;
  selectorKey: string;
  count: number;
}

export interface OracleReport {
  fixture: string;
  criteriaResults: OracleCriterionResult[];
  mustNotAppearViolations: Array<{ code: string; reason: string; actualStatuses: CriterionStatus[] }>;
  duplicateViolations: OracleDuplicateViolation[];
  /** true only if every EXACT/SEMANTIC criterion passed, no mustNotAppear violations, and no duplicates. NONDETERMINISTIC criteria never affect this. */
  overallPassed: boolean;
}

/**
 * Mirrors `AuditMetricsService.normalizeCriterionKey` (audit-metrics.service.ts)
 * intentionally — same two regexes, so the oracle's grouping matches
 * production's own consolidation logic instead of drifting from it.
 */
export function normalizeCriterionKey(criterion: string | undefined | null): string {
  if (!criterion) return 'unknown';
  const nielsenMatch = criterion.match(/N-\d{2}/i);
  if (nielsenMatch) return nielsenMatch[0].toUpperCase().trim();
  const wcagMatch = criterion.match(/(?<!\d\.)\b(?:WCAG\s+)?(\d+\.\d+\.\d+)(?!\.\d)\b/i);
  if (wcagMatch) return `WCAG ${wcagMatch[1]}`;
  return criterion.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findingCode(f: ActualFindingLike): string {
  return normalizeCriterionKey(f.wcagCriterion || f.heuristicCode || undefined);
}

export function evaluateGroundTruth(groundTruth: GroundTruth, actualFindings: ActualFindingLike[]): OracleReport {
  const byCode = new Map<string, ActualFindingLike[]>();
  for (const f of actualFindings) {
    const code = findingCode(f);
    const list = byCode.get(code) ?? [];
    list.push(f);
    byCode.set(code, list);
  }

  const criteriaResults: OracleCriterionResult[] = groundTruth.criteria.map((criterion) => {
    const normalizedCode = normalizeCriterionKey(criterion.code);
    let matches = byCode.get(normalizedCode) ?? [];
    // When multiple real elements share the same criterion code (e.g. two
    // buttons both evaluated under WCAG 4.1.2, one PASS one FAIL),
    // `selectorHint` narrows the comparison to the specific element this
    // criterion is actually about — without it, aggregating "all statuses
    // for this code" would incorrectly require every element to agree.
    if (criterion.selectorHint) {
      matches = matches.filter((m) => m.affectedElement?.selector?.includes(criterion.selectorHint!));
    }
    const actualStatuses = matches.map((m) => m.status as CriterionStatus);
    const missing = actualStatuses.length === 0;

    if (criterion.match === 'NONDETERMINISTIC') {
      return {
        code: criterion.code,
        expectedStatus: criterion.expectedStatus,
        match: criterion.match,
        actualStatuses,
        missing,
        passed: true, // never fails the oracle by itself
        reason: 'NONDETERMINISTIC: reportado solo con fines informativos, no afecta overallPassed.',
      };
    }

    if (missing) {
      return {
        code: criterion.code,
        expectedStatus: criterion.expectedStatus,
        match: criterion.match,
        actualStatuses,
        missing: true,
        passed: false,
        reason: `Ningún finding real corresponde al criterio "${criterion.code}" (código normalizado "${normalizedCode}").`,
      };
    }

    if (criterion.match === 'EXACT') {
      const passed = actualStatuses.every((s) => s === criterion.expectedStatus);
      return {
        code: criterion.code,
        expectedStatus: criterion.expectedStatus,
        match: criterion.match,
        actualStatuses,
        missing: false,
        passed,
        reason: passed
          ? `EXACT: todos los estados reales coinciden con "${criterion.expectedStatus}".`
          : `EXACT: se esperaba "${criterion.expectedStatus}", se obtuvo [${actualStatuses.join(', ')}].`,
      };
    }

    // SEMANTIC
    const acceptable = criterion.acceptableStatuses ?? [criterion.expectedStatus, 'NOT_EVALUABLE'];
    const passed = actualStatuses.every((s) => acceptable.includes(s));
    return {
      code: criterion.code,
      expectedStatus: criterion.expectedStatus,
      match: criterion.match,
      actualStatuses,
      missing: false,
      passed,
      reason: passed
        ? `SEMANTIC: estados reales [${actualStatuses.join(', ')}] dentro de la banda aceptable [${acceptable.join(', ')}].`
        : `SEMANTIC: estados reales [${actualStatuses.join(', ')}] fuera de la banda aceptable [${acceptable.join(', ')}].`,
    };
  });

  const mustNotAppearViolations = (groundTruth.mustNotAppear ?? [])
    .map((entry) => {
      const normalizedCode = normalizeCriterionKey(entry.code);
      const matches = byCode.get(normalizedCode) ?? [];
      const actualStatuses = matches.map((m) => m.status as CriterionStatus);
      return { code: entry.code, reason: entry.reason, actualStatuses };
    })
    .filter((entry) => entry.actualStatuses.includes('FAIL'));

  // Duplicate detection: same (normalized criterion, selector) appearing
  // more than once in the SAME actual findings array — this is what
  // `deduplicateFindings` is supposed to already prevent; if it appears
  // here, it's a real regression, not a Ground Truth mismatch.
  const bySelectorKey = new Map<string, number>();
  for (const f of actualFindings) {
    const key = `${findingCode(f)}_${f.affectedElement?.selector || f.affectedElement?.tag || 'global'}`;
    bySelectorKey.set(key, (bySelectorKey.get(key) ?? 0) + 1);
  }
  const duplicateViolations: OracleDuplicateViolation[] = Array.from(bySelectorKey.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [criterionKey, ...selectorParts] = key.split('_');
      return { criterionKey, selectorKey: selectorParts.join('_'), count };
    });

  const overallPassed =
    criteriaResults.every((r) => r.passed) && mustNotAppearViolations.length === 0 && duplicateViolations.length === 0;

  return {
    fixture: groundTruth.fixture,
    criteriaResults,
    mustNotAppearViolations,
    duplicateViolations,
    overallPassed,
  };
}
