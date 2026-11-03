import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { EvidenceIndex, checkFindingTraceability } from '@/modules/evaluations/services/evidence-traceability.service';
import { checkClaimConsistency, ClaimItemResult } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { countWcagCodesInCriterion } from '@/shared/testing/wcag-criterion-cardinality';

/**
 * H-REGRESSION-4 (testing-only module) — pipeline-stage analysis shared by
 * the real runner (h-regression-4-runner.ts) AND the deterministic mock
 * tests (h-regression-4-mocks.test.ts). Reuses the REAL production
 * functions (checkFindingTraceability, checkClaimConsistency,
 * countWcagCodesInCriterion) at every step — nothing reimplemented, nothing
 * that could diverge from what audit-engine.service.ts actually does.
 *
 * Answers, per finding, the ONE question H-REGRESSION-4 cares about:
 * "did this finding carry an objectively verifiable property/value claim,
 * and if so, did it match the real evidence?" — never a semantic judgment
 * about whether the WCAG/Nielsen criterion itself was the right one.
 */

export interface H4FindingReport {
  index: number;
  selector: string | undefined;
  wcagCriterion: string | null | undefined;
  heuristicCode: string | null | undefined;
  rawStatus: string;
  traceable: boolean;
  cardinalityCodeCount: number;
  cardinalityViolation: boolean;
  statusAfterGate: string;
  statusAfterCardinality: string;
  statusAfterJ6: string;
  confidenceAfterJ6: string;
  recommendationAfterJ6: string | null | undefined;
  degradedByGate: boolean;
  degradedByCardinality: boolean;
  degradedByJ6: boolean;
  j6OverallStatus: 'CONSISTENT' | 'INCONSISTENT' | 'INSUFFICIENT';
  j6Items: ClaimItemResult[];
}

export interface H4InconsistentFindingSummary {
  index: number;
  wcagCriterion: string | null | undefined;
  heuristicCode: string | null | undefined;
  selector: string | undefined;
  property: string | undefined;
  realValue: string;
  claimedValue: string | undefined;
  statusBeforeJ6: string;
  statusAfterJ6: string;
}

export interface H4Report {
  findings: H4FindingReport[];
  j6ItemCounts: { CONSISTENT: number; INCONSISTENT: number; PROPERTY_NOT_FOUND: number; NOT_CHECKABLE: number };
  j6FindingCounts: { consistent: number; inconsistent: number; insufficient: number };
  inconsistentFindings: H4InconsistentFindingSummary[];
  verdict: 'PASS' | 'NO_INCONSISTENCY_OBSERVED' | 'FAIL';
  verdictReason: string;
}

/**
 * Builds the per-finding, per-stage report. `rawFindings` must be in the
 * SAME order/identity as `gatedFindings`/`cardinalityCheckedFindings`/
 * `validatedFindings` (i.e. the exact 4 arrays audit-engine.service.ts/
 * gemini-mock-harness.ts already produce in sequence) — this function does
 * not re-run any defense, it only OBSERVES the already-computed stages.
 */
export function buildH4FindingsReport(
  rawFindings: V2AuditFinding[],
  evidenceIndex: EvidenceIndex,
  gatedFindings: V2AuditFinding[],
  cardinalityCheckedFindings: V2AuditFinding[],
  validatedFindings: V2AuditFinding[],
): H4FindingReport[] {
  return rawFindings.map((raw, i) => {
    const traceability = checkFindingTraceability(raw, evidenceIndex);
    const codeCount = countWcagCodesInCriterion(raw.wcagCriterion);
    const gated = gatedFindings[i];
    const cardinalityChecked = cardinalityCheckedFindings[i];
    const validated = validatedFindings[i];
    // J6 is evaluated on the SAME input it actually received in production
    // (the post-cardinality finding) -- never on the raw finding, so this
    // mirrors exactly what applyClaimConsistency saw.
    const j6 = checkClaimConsistency(cardinalityChecked, evidenceIndex);

    return {
      index: i,
      selector: raw.affectedElement?.selector,
      wcagCriterion: raw.wcagCriterion,
      heuristicCode: raw.heuristicCode,
      rawStatus: raw.status,
      traceable: traceability.traceable,
      cardinalityCodeCount: codeCount,
      cardinalityViolation: codeCount > 1,
      statusAfterGate: gated.status,
      statusAfterCardinality: cardinalityChecked.status,
      statusAfterJ6: validated.status,
      confidenceAfterJ6: validated.confidence,
      recommendationAfterJ6: validated.recommendation,
      degradedByGate: raw.status !== gated.status,
      degradedByCardinality: gated.status !== cardinalityChecked.status,
      degradedByJ6: cardinalityChecked.status !== validated.status,
      j6OverallStatus: j6.overallStatus,
      j6Items: j6.items,
    };
  });
}

/**
 * Aggregates the per-finding report into the summary H-REGRESSION-4 needs,
 * including the experiment's verdict — computed EXCLUSIVELY from what was
 * actually observed (never from semantic/WCAG-correctness judgments, per
 * the experiment's explicit scope).
 */
export function summarizeH4Report(findings: H4FindingReport[]): H4Report {
  const j6ItemCounts = { CONSISTENT: 0, INCONSISTENT: 0, PROPERTY_NOT_FOUND: 0, NOT_CHECKABLE: 0 };
  const j6FindingCounts = { consistent: 0, inconsistent: 0, insufficient: 0 };
  const inconsistentFindings: H4InconsistentFindingSummary[] = [];

  for (const f of findings) {
    if (f.j6OverallStatus === 'CONSISTENT') j6FindingCounts.consistent++;
    else if (f.j6OverallStatus === 'INCONSISTENT') j6FindingCounts.inconsistent++;
    else j6FindingCounts.insufficient++;

    for (const item of f.j6Items) {
      j6ItemCounts[item.status]++;
      if (item.status === 'INCONSISTENT') {
        inconsistentFindings.push({
          index: f.index,
          wcagCriterion: f.wcagCriterion,
          heuristicCode: f.heuristicCode,
          selector: f.selector,
          property: item.property,
          realValue: item.reason,
          claimedValue: item.claimedValue,
          statusBeforeJ6: f.statusAfterCardinality,
          statusAfterJ6: f.statusAfterJ6,
        });
      }
    }
  }

  let verdict: H4Report['verdict'];
  let verdictReason: string;

  const inconsistentFindingReports = findings.filter((f) => f.j6OverallStatus === 'INCONSISTENT');
  if (inconsistentFindingReports.length === 0) {
    verdict = 'NO_INCONSISTENCY_OBSERVED';
    verdictReason = 'Ningún finding contuvo un ítem de evidencia INCONSISTENT en esta ejecución -- J6 no fue ejercitado por una inconsistencia real, lo cual no es un fallo.';
  } else {
    const allCorrectlyDegraded = inconsistentFindingReports.every(
      (f) => f.statusAfterJ6 === 'NOT_EVALUABLE' && f.confidenceAfterJ6 === 'low' && f.recommendationAfterJ6 === null,
    );
    if (allCorrectlyDegraded) {
      verdict = 'PASS';
      verdictReason = `${inconsistentFindingReports.length} finding(s) con evidencia INCONSISTENT fueron correctamente degradados a NOT_EVALUABLE/confidence=low/recommendation=null.`;
    } else {
      verdict = 'FAIL';
      verdictReason = 'Al menos un finding con evidencia INCONSISTENT NO fue degradado correctamente (status/confidence/recommendation no coinciden con el contrato esperado).';
    }
  }

  return { findings, j6ItemCounts, j6FindingCounts, inconsistentFindings, verdict, verdictReason };
}
