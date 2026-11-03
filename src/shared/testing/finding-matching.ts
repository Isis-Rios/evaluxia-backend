import { normalizeCriterionKey } from './ground-truth-oracle';
import { normalizeSelectorForComparison, EvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { checkClaimConsistency } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * Fase I.1 — finding-level quality methodology (testing-only module).
 *
 * INDEPENDENT and ADDITIVE from `ground-truth-oracle.ts`: `evaluateGroundTruth()`
 * there is completely unchanged, unread, untouched by this module. This
 * module answers a NARROWER, DIFFERENT question than the oracle:
 *
 *   ground-truth-oracle.ts: "for this WCAG/Nielsen CODE, is the aggregate
 *                            status what we expected?"
 *   finding-matching.ts:    "for this SPECIFIC finding, does it correspond
 *                            to a SPECIFIC expected problem, on the right
 *                            element, with evidence that actually holds up?"
 *
 * Deterministic by design: NO NLP, NO embeddings, NO second LLM. Reuses
 * `normalizeCriterionKey` (single source of truth, same as dedup/metrics/
 * oracle), `normalizeSelectorForComparison` (J1), and `checkClaimConsistency`
 * (J6) — evidence consistency is NEVER re-implemented here. When a case
 * cannot be resolved by these existing, deterministic structures, it is
 * classified `AMBIGUOUS`/`UNMATCHED` rather than guessed at.
 */

export interface ExpectedEvidenceRequirement {
  property: string;
  expectedRealValue: string | number | boolean | null;
}

export type ExpectedFindingStatus = 'FAIL' | 'PASS' | 'NOT_EVALUABLE';

export interface ExpectedFinding {
  id: string;
  problemType: string;
  /**
   * KNOWN LIMITATION (documented, not solved here): `criterion` is the ONLY
   * gate the matcher uses to shortlist candidates (Nivel 1). An
   * ExpectedFinding with `criterion: null` can never be matched by this
   * matcher today — there is no NLP-free way to derive a real finding's
   * "problemType" independently of its WCAG/Nielsen code. Flagged rather
   * than silently pretended to work.
   */
  criterion?: string | null;
  relevantSelectors: string[];
  expectedStatus: ExpectedFindingStatus;
  minimumEvidence?: ExpectedEvidenceRequirement[];
  expectedRecommendationConcept?: string;
  severityIfObjective?: string | null;
  compositeGroup?: string | null;
  verifiableBy?: 'deterministic' | 'ai' | 'both';
}

export type MatchClassification =
  | 'TP_EXACT'
  | 'TP_SEMANTIC'
  | 'FP'
  | 'NOT_EVALUABLE'
  | 'DUPLICATE'
  | 'UNMATCHED'
  | 'AMBIGUOUS';

/** Structural subset `matchFindings` needs — any real finding shape (deterministic or post-J6 AI finding) satisfies this. */
export interface ActualFindingForMatching {
  wcagCriterion?: string | null;
  heuristicCode?: string | null;
  status: string;
  affectedElement?: { selector?: string };
  /**
   * `attribute` (Hardening post Gemini Real #1): alias histórico de
   * `property` -- el schema de Gemini (`TechnicalEvidenceItemSchema`)
   * acepta `property OR attribute` para `type: DOM_ATTRIBUTE`, pero Gemini
   * mismo y la mayoría de reglas determinísticas ya usan exclusivamente
   * `property` (contrato canónico, ver docstring de `canonicalProperty`
   * abajo). Se preserva aquí solo para no perder evidencia citada bajo el
   * nombre legacy.
   */
  evidence?: Array<{ property?: string; attribute?: string; value?: string; selector?: string }>;
}

/**
 * Contrato canónico (Hardening post Gemini Real #1): `property` es el
 * nombre de campo autoritativo para identificar QUÉ propiedad cita un ítem
 * de evidencia -- Gemini (vía el prompt y su propio schema) siempre lo usa;
 * J6 (`evidence-claim-consistency.service.ts`) ya lo trata como tal
 * (`item.property ?? item.attribute`). `attribute` es un alias legacy que
 * dos reglas determinísticas (`analyzeImages`, `analyzeLinks`) usaban antes
 * de esta fase -- ya migradas a `property` (ver deterministic-analyzer.
 * service.ts). Esta función solo existe para que el matcher no pierda
 * evidencia de fixtures/mocks preexistentes que aún citan `attribute`.
 */
function canonicalProperty(item: { property?: string; attribute?: string }): string | undefined {
  return item.property ?? item.attribute;
}

export interface FindingMatchResult {
  findingIndex: number;
  classification: MatchClassification;
  matchedExpectedFindingId?: string;
  criterionMatch: boolean;
  selectorMatch: boolean;
  problemTypeMatch: boolean | 'unresolved';
  evidenceStatus?: 'CONSISTENT' | 'INCONSISTENT' | 'INSUFFICIENT';
  reason: string;
  /** Only set for AMBIGUOUS: the candidate expectedFinding ids that could not be disambiguated. */
  candidateIds?: string[];
}

export type ExpectedFindingCoverageStatus =
  | 'TP_EXACT'
  | 'TP_SEMANTIC'
  | 'FN'
  | 'UNCOVERED_NOT_EVALUABLE_EXPECTED'
  /** GT esperaba un estado evaluable (FAIL/PASS) pero el sistema se abstuvo (NOT_EVALUABLE) -- abstención aceptable, NUNCA FN. */
  | 'ADDRESSED_NOT_EVALUABLE';

export interface ExpectedFindingCoverage {
  expectedFindingId: string;
  status: ExpectedFindingCoverageStatus;
  matchedFindingIndex?: number;
}

export interface MatchingCounts {
  TP_EXACT: number;
  TP_SEMANTIC: number;
  FP: number;
  FN: number;
  NOT_EVALUABLE: number;
  DUPLICATE: number;
  UNMATCHED: number;
  AMBIGUOUS: number;
}

export interface MatchingSummary {
  results: FindingMatchResult[];
  coverage: ExpectedFindingCoverage[];
  counts: MatchingCounts;
  /**
   * Precision/Recall/F1 computed ONLY from TP_EXACT+TP_SEMANTIC (as TP), FP,
   * and FN — never from NOT_EVALUABLE/DUPLICATE/UNMATCHED/AMBIGUOUS (all
   * four are diagnostic-only and deliberately excluded, per the approved
   * design: none of them may be silently counted as TP or FP).
   * `'N/A'` (never 0, never NaN) when the denominator would be 0.
   */
  metrics: {
    precision: number | 'N/A';
    recall: number | 'N/A';
    f1: number | 'N/A';
  };
}

function criterionKeyOf(f: ActualFindingForMatching): string {
  return normalizeCriterionKey(f.wcagCriterion || f.heuristicCode || undefined);
}

/** Counts how many of the candidate's declared minimum-evidence PROPERTY NAMES appear (by name only) among the real finding's cited evidence. Used ONLY to disambiguate between multiple expectedFindings sharing the same criterion+selector — never to judge value correctness (that stays J6's job). */
function evidencePropertyOverlap(req: ExpectedEvidenceRequirement[] | undefined, real: ActualFindingForMatching): number {
  if (!req || req.length === 0) return 0;
  const realProps = new Set((real.evidence || []).map(canonicalProperty).filter(Boolean));
  return req.filter((r) => realProps.has(r.property)).length;
}

/** Does the real finding cite ALL of the candidate's declared minimum-evidence property names (presence only)? Drives the TP_EXACT/TP_SEMANTIC split — never re-checks value correctness (already guaranteed CONSISTENT by J6 before this is called). */
function minimumEvidenceFullyCited(req: ExpectedEvidenceRequirement[] | undefined, real: ActualFindingForMatching): boolean {
  if (!req || req.length === 0) return true;
  const realProps = new Set((real.evidence || []).map(canonicalProperty).filter(Boolean));
  return req.every((r) => realProps.has(r.property));
}

/**
 * Matches a batch of real (already-consolidated or raw) findings against a
 * set of `ExpectedFinding`s, in this exact priority order (approved
 * design): 1) criterio, 2) selector/elemento, 3) problemType (resuelto
 * determinísticamente vía candidato único o solapamiento de evidencia,
 * NUNCA vía NLP), 4) evidencia (J6, reutilizado), 5) — no existe una
 * resolución semántica adicional más allá de 3: si el paso 3 no puede
 * resolverse con las estructuras disponibles, el caso se marca AMBIGUOUS
 * en vez de inventar una coincidencia.
 */
export function matchFindings(
  expectedFindings: ExpectedFinding[],
  actualFindings: ActualFindingForMatching[],
  evidenceIndex: EvidenceIndex,
): MatchingSummary {
  const results: FindingMatchResult[] = [];
  const claimedBy = new Map<string, number>();

  actualFindings.forEach((real, findingIndex) => {
    const realCriterionKey = criterionKeyOf(real);
    const criterionCandidates = expectedFindings.filter(
      (e) => e.criterion != null && normalizeCriterionKey(e.criterion) === realCriterionKey,
    );

    if (criterionCandidates.length === 0) {
      results.push({
        findingIndex,
        classification: 'UNMATCHED',
        criterionMatch: false,
        selectorMatch: false,
        problemTypeMatch: 'unresolved',
        reason: `Ningún expectedFinding declara el criterio "${realCriterionKey}" -- fuera del alcance de este Ground Truth (no se puede juzgar como correcto ni incorrecto).`,
      });
      return;
    }

    const realSelectorRaw = real.affectedElement?.selector;
    const realSelector = realSelectorRaw ? normalizeSelectorForComparison(realSelectorRaw) : undefined;
    const selectorCandidates = criterionCandidates.filter((e) =>
      e.relevantSelectors.some((s) => normalizeSelectorForComparison(s) === realSelector),
    );

    if (selectorCandidates.length === 0) {
      // CORRECCIÓN (post Fase I.3, discrepancia 1): la ausencia de un
      // expectedFinding para ESTE selector específico NO demuestra que el
      // finding sea incorrecto -- solo significa que el Ground Truth nunca
      // se pronunció sobre este elemento en particular, aunque sí lo haya
      // hecho para otros bajo el mismo criterio. Clasificar esto como FP
      // exigiría que el GT tenga cobertura TOTAL de cada elemento bajo un
      // criterio para no penalizar falsamente al sistema -- una exigencia
      // metodológicamente indefendible (un Ground Truth selectivo es
      // legítimo). UNMATCHED ya expresa exactamente la semántica correcta
      // ("no hay evidencia en el GT para juzgar esto ni como correcto ni
      // como incorrecto") -- se reutiliza la MISMA categoría que ya existe
      // para "criterio no representado en absoluto", en vez de introducir
      // una categoría nueva innecesaria. FP se reserva exclusivamente para
      // cuando el GT SÍ declara una expectativa para ese selector exacto y
      // el sistema la contradice (ver más abajo: estado distinto al
      // esperado, o evidencia J6 INCONSISTENT).
      results.push({
        findingIndex,
        classification: 'UNMATCHED',
        criterionMatch: true,
        selectorMatch: false,
        problemTypeMatch: 'unresolved',
        reason: `Criterio "${realCriterionKey}" coincide, pero el selector real ("${realSelectorRaw ?? 'n/a'}") no tiene un expectedFinding propio -- el Ground Truth no cubre este elemento específico (no hay evidencia suficiente en el GT para juzgarlo como correcto ni como incorrecto).`,
      });
      return;
    }

    let candidate: ExpectedFinding;
    const problemTypeMatch: boolean | 'unresolved' = true;
    if (selectorCandidates.length === 1) {
      candidate = selectorCandidates[0];
    } else {
      const scored = selectorCandidates.map((c) => ({ c, overlap: evidencePropertyOverlap(c.minimumEvidence, real) }));
      const maxOverlap = Math.max(...scored.map((s) => s.overlap));
      const winners = scored.filter((s) => s.overlap === maxOverlap);
      if (maxOverlap === 0 || winners.length > 1) {
        results.push({
          findingIndex,
          classification: 'AMBIGUOUS',
          criterionMatch: true,
          selectorMatch: true,
          problemTypeMatch: 'unresolved',
          reason: 'Múltiples expectedFindings comparten criterio+selector y no pueden desambiguarse determinísticamente por solapamiento de evidencia mínima -- requiere revisión manual, no se fuerza una coincidencia.',
          candidateIds: selectorCandidates.map((s) => s.id),
        });
        return;
      }
      candidate = winners[0].c;
    }

    const j6 = checkClaimConsistency(real as unknown as V2AuditFinding, evidenceIndex);

    if (j6.overallStatus === 'INCONSISTENT') {
      results.push({
        findingIndex,
        classification: 'FP',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'INCONSISTENT',
        reason: `La evidencia citada contradice la evidencia real (J6 INCONSISTENT) -- no puede considerarse TP para ${candidate.id}, independientemente de que criterio/elemento coincidan.`,
      });
      return;
    }
    if (j6.overallStatus === 'INSUFFICIENT') {
      results.push({
        findingIndex,
        classification: 'NOT_EVALUABLE',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'INSUFFICIENT',
        reason: `El finding no citó evidencia estructurada verificable para ${candidate.id} (J6 INSUFFICIENT) -- no puede confirmarse ni refutarse; nunca se convierte artificialmente en TP.`,
      });
      return;
    }

    if (real.status === 'NOT_EVALUABLE') {
      results.push({
        findingIndex,
        classification: 'NOT_EVALUABLE',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'CONSISTENT',
        reason:
          candidate.expectedStatus === 'NOT_EVALUABLE'
            ? `Abstención correcta: el Ground Truth también esperaba NOT_EVALUABLE para ${candidate.id}.`
            : `El sistema se abstuvo (NOT_EVALUABLE) donde ${candidate.id} esperaba un estado evaluable -- NUNCA se cuenta como FN automático.`,
      });
      return;
    }

    if (candidate.expectedStatus !== real.status) {
      results.push({
        findingIndex,
        classification: 'FP',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'CONSISTENT',
        reason: `Estado declarado ("${real.status}") no coincide con el esperado ("${candidate.expectedStatus}") para ${candidate.id}.`,
      });
      return;
    }

    const exact = minimumEvidenceFullyCited(candidate.minimumEvidence, real);
    const classification: MatchClassification = exact ? 'TP_EXACT' : 'TP_SEMANTIC';

    const alreadyClaimedIndex = claimedBy.get(candidate.id);
    if (alreadyClaimedIndex !== undefined) {
      results.push({
        findingIndex,
        classification: 'DUPLICATE',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'CONSISTENT',
        reason: `Ya existe un TP previo (finding #${alreadyClaimedIndex}) para ${candidate.id} -- este finding adicional se cuenta como DUPLICATE, nunca suma un TP ni un FP nuevo.`,
      });
      return;
    }

    claimedBy.set(candidate.id, findingIndex);
    results.push({
      findingIndex,
      classification,
      matchedExpectedFindingId: candidate.id,
      criterionMatch: true,
      selectorMatch: true,
      problemTypeMatch,
      evidenceStatus: 'CONSISTENT',
      reason: exact
        ? `Criterio, elemento y evidencia mínima completa coinciden con ${candidate.id}.`
        : `Criterio, elemento y estado coinciden con ${candidate.id}, pero la evidencia mínima declarada no fue citada en su totalidad (evidencia parcial, no falsa).`,
    });
  });

  const coverage: ExpectedFindingCoverage[] = expectedFindings.map((e) => {
    const claimedIndex = claimedBy.get(e.id);
    if (claimedIndex !== undefined) {
      const r = results.find((res) => res.findingIndex === claimedIndex && res.matchedExpectedFindingId === e.id);
      return { expectedFindingId: e.id, status: r!.classification as 'TP_EXACT' | 'TP_SEMANTIC', matchedFindingIndex: claimedIndex };
    }
    // Un finding real pudo haber apuntado a este expectedFinding y haberse
    // clasificado NOT_EVALUABLE (abstención del sistema, o evidencia propia
    // insuficiente vía J6) -- eso NUNCA debe colapsar en FN, sea cual sea
    // el expectedStatus declarado (ver tabla de semántica aprobada).
    const notEvaluableResult = results.find((res) => res.matchedExpectedFindingId === e.id && res.classification === 'NOT_EVALUABLE');
    if (notEvaluableResult) {
      return { expectedFindingId: e.id, status: 'ADDRESSED_NOT_EVALUABLE', matchedFindingIndex: notEvaluableResult.findingIndex };
    }
    if (e.expectedStatus === 'NOT_EVALUABLE') {
      return { expectedFindingId: e.id, status: 'UNCOVERED_NOT_EVALUABLE_EXPECTED' };
    }
    return { expectedFindingId: e.id, status: 'FN' };
  });

  const counts: MatchingCounts = {
    TP_EXACT: results.filter((r) => r.classification === 'TP_EXACT').length,
    TP_SEMANTIC: results.filter((r) => r.classification === 'TP_SEMANTIC').length,
    FP: results.filter((r) => r.classification === 'FP').length,
    FN: coverage.filter((c) => c.status === 'FN').length,
    NOT_EVALUABLE:
      results.filter((r) => r.classification === 'NOT_EVALUABLE').length +
      coverage.filter((c) => c.status === 'UNCOVERED_NOT_EVALUABLE_EXPECTED').length,
    DUPLICATE: results.filter((r) => r.classification === 'DUPLICATE').length,
    UNMATCHED: results.filter((r) => r.classification === 'UNMATCHED').length,
    AMBIGUOUS: results.filter((r) => r.classification === 'AMBIGUOUS').length,
  };

  const tp = counts.TP_EXACT + counts.TP_SEMANTIC;
  const precision: number | 'N/A' = tp + counts.FP > 0 ? tp / (tp + counts.FP) : 'N/A';
  const recall: number | 'N/A' = tp + counts.FN > 0 ? tp / (tp + counts.FN) : 'N/A';
  const f1: number | 'N/A' =
    precision === 'N/A' || recall === 'N/A'
      ? 'N/A'
      : precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

  return { results, coverage, counts, metrics: { precision, recall, f1 } };
}
