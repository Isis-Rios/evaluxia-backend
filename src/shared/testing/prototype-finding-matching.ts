import { normalizeCriterionKey } from './ground-truth-oracle';
import { PrototypeAuditFinding, VisualRegion } from '@/modules/ai/contracts/prototype.contracts';
import { checkVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';
import {
  MatchClassification,
  FindingMatchResult,
  MatchingSummary,
  MatchingCounts,
  ExpectedFindingCoverage,
  ExpectedEvidenceRequirement,
} from './finding-matching';

/**
 * prototype-finding-matching.ts (P6) — análogo DELIBERADAMENTE SEPARADO de
 * `finding-matching.ts` (WEB permanece 100% intacto, cero import cruzado de
 * lógica -- solo se reutilizan los TIPOS genéricos/agnósticos de framework:
 * `MatchingSummary`/`FindingMatchResult`/`MatchingCounts`/
 * `ExpectedFindingCoverage`/`ExpectedEvidenceRequirement`).
 *
 * Algoritmo (K.2.1.1 §2, Opción A, confirmada -- NO reabierta):
 *   criterio -> region (filtro estructural débil/opcional, análogo pero
 *   MÁS DÉBIL que `selector` en WEB) -> problemType (vía solapamiento de
 *   `minimumEvidence[].property`, igual mecanismo que WEB) ->
 *   VisualEvidenceConsistency (compuerta POSTERIOR al matching, nunca un
 *   paso de matching en sí -- Matching y Consistency responden preguntas
 *   DISTINTAS, nunca se conflan).
 */

export interface PrototypeExpectedFinding {
  id: string;
  criterion?: string | null;
  problemType: string;
  visualReference: {
    description?: string;
    regions?: VisualRegion[];
  };
  expectedStatus: 'FAIL' | 'PASS' | 'NOT_EVALUABLE';
  minimumEvidence?: ExpectedEvidenceRequirement[];
  expectedRecommendationConcept?: string;
  severityIfObjective?: string | null;
  compositeGroup?: string | null;
  verifiableBy?: 'ai';
}

function evidencePropertyOverlap(req: ExpectedEvidenceRequirement[] | undefined, real: PrototypeAuditFinding): number {
  if (!req || req.length === 0) return 0;
  const realProps = new Set((real.evidence || []).map((e) => e.property).filter(Boolean));
  return req.filter((r) => realProps.has(r.property)).length;
}

/** Las claves de criterio REALMENTE presentes en el finding (sin la prioridad implícita wcagCriterion||heuristicCode). */
function candidateKeysOf(f: PrototypeAuditFinding): string[] {
  const keys: string[] = [];
  if (f.wcagCriterion) keys.push(normalizeCriterionKey(f.wcagCriterion));
  if (f.heuristicCode) keys.push(normalizeCriterionKey(f.heuristicCode));
  return Array.from(new Set(keys));
}

export interface PrincipalCriterionResolution {
  key: string;
  ambiguous: boolean;
  reason?: string;
}

/**
 * [P7.5.1] Causa raíz corregida: un finding puede citar SIMULTÁNEAMENTE
 * `wcagCriterion` Y `heuristicCode` (el prompt lo desaconseja desde
 * P7.4.1, pero es "prevención", no "enforcement" -- el matcher no puede
 * asumir que nunca ocurrirá, caso real confirmado en P7.3: un finding
 * sobre dos botones "Enviar" N-04 citaba también "WCAG 2.4.6", y la
 * prioridad implícita `wcagCriterion || heuristicCode` lo comparó contra
 * el Ground Truth del encabezado en vez del de los botones).
 *
 * Resuelve la clave de criterio principal SIN dar prioridad implícita a
 * ningún campo por convención: cuando ambas claves están presentes Y son
 * distintas, se evalúa cuál tiene soporte real en el Ground Truth
 * reutilizando EXCLUSIVAMENTE el mecanismo YA existente de solapamiento de
 * evidencia (`evidencePropertyOverlap`, el mismo que ya desambigua
 * selector/región empatados) -- nunca NLP, nunca similitud semántica.
 *
 * Si ninguna clave tiene candidato en el GT, o solo una lo tiene, no hay
 * ambigüedad real que resolver (comportamiento ya existente, intacto). Si
 * AMBAS tienen candidato y el solapamiento de evidencia no permite
 * desambiguar con certeza (empate, incluido 0-0), se declara `ambiguous`
 * explícitamente -- reutiliza la categoría `AMBIGUOUS` ya existente del
 * contrato, nunca se fuerza una coincidencia ni se inventa un estado nuevo.
 */
function resolvePrincipalCriterionKey(
  real: PrototypeAuditFinding,
  expectedFindings: PrototypeExpectedFinding[],
): PrincipalCriterionResolution {
  const keys = candidateKeysOf(real);

  if (keys.length === 0) {
    return { key: normalizeCriterionKey(undefined), ambiguous: false };
  }
  if (keys.length === 1) {
    return { key: keys[0], ambiguous: false };
  }

  const scored = keys.map((key) => {
    const candidates = expectedFindings.filter((e) => e.criterion != null && normalizeCriterionKey(e.criterion) === key);
    if (candidates.length === 0) return { key, hasCandidate: false, overlap: -1 };
    const overlap = Math.max(...candidates.map((c) => evidencePropertyOverlap(c.minimumEvidence, real)));
    return { key, hasCandidate: true, overlap };
  });

  const withCandidate = scored.filter((s) => s.hasCandidate);
  if (withCandidate.length === 0) {
    // Ninguna de las dos claves está representada en este Ground Truth --
    // no hay nada que desambiguar; se preserva el comportamiento ya
    // existente (UNMATCHED se decidirá más abajo con la primera clave).
    return { key: keys[0], ambiguous: false };
  }
  if (withCandidate.length === 1) {
    // Solo una clave tiene cobertura en el GT -- la otra simplemente no
    // está representada, esto NO es ambigüedad real.
    return { key: withCandidate[0].key, ambiguous: false };
  }

  const maxOverlap = Math.max(...withCandidate.map((s) => s.overlap));
  const winners = withCandidate.filter((s) => s.overlap === maxOverlap);
  if (winners.length === 1 && maxOverlap > 0) {
    return { key: winners[0].key, ambiguous: false };
  }

  return {
    key: keys[0],
    ambiguous: true,
    reason:
      `El finding cita múltiples criterios (${keys.join(' y ')}), ambos con expectedFindings candidatos en el Ground Truth, ` +
      `sin solapamiento de evidencia suficiente para desambiguar cuál es el criterio principal -- nunca se prioriza ` +
      `wcagCriterion sobre heuristicCode (ni viceversa) por convención.`,
  };
}

function minimumEvidenceFullyCited(req: ExpectedEvidenceRequirement[] | undefined, real: PrototypeAuditFinding): boolean {
  if (!req || req.length === 0) return true;
  const realProps = new Set((real.evidence || []).map((e) => e.property).filter(Boolean));
  return req.every((r) => realProps.has(r.property));
}

export function matchPrototypeFindings(
  expectedFindings: PrototypeExpectedFinding[],
  actualFindings: PrototypeAuditFinding[],
): MatchingSummary {
  const results: FindingMatchResult[] = [];
  const claimedBy = new Map<string, number>();

  actualFindings.forEach((real, findingIndex) => {
    const criterionResolution = resolvePrincipalCriterionKey(real, expectedFindings);
    if (criterionResolution.ambiguous) {
      results.push({
        findingIndex,
        classification: 'AMBIGUOUS',
        criterionMatch: false,
        selectorMatch: false,
        problemTypeMatch: 'unresolved',
        reason: criterionResolution.reason!,
      });
      return;
    }

    const realCriterionKey = criterionResolution.key;
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
        reason: `Ningún expectedFinding declara el criterio "${realCriterionKey}" -- fuera del alcance de este Ground Truth.`,
      });
      return;
    }

    // Filtro por región — ESTRUCTURAL pero DÉBIL/OPCIONAL (K.2.1.1: region
    // es contexto espacial, no identidad). Cuando el finding real no
    // declara región, O cuando un candidato no declara `regions[]`, ese
    // candidato NO se descarta por este filtro (no se fuerza una
    // desambiguación que la región no puede dar con certeza).
    const realRegion = real.affectedElement?.visualReference?.region;
    const regionCandidates = criterionCandidates.filter((e) => {
      if (!realRegion) return true;
      if (!e.visualReference.regions || e.visualReference.regions.length === 0) return true;
      return e.visualReference.regions.includes(realRegion);
    });

    const effectiveCandidates = regionCandidates.length > 0 ? regionCandidates : criterionCandidates;

    let candidate: PrototypeExpectedFinding;
    const problemTypeMatch: boolean | 'unresolved' = true;
    if (effectiveCandidates.length === 1) {
      candidate = effectiveCandidates[0];
    } else {
      const scored = effectiveCandidates.map((c) => ({ c, overlap: evidencePropertyOverlap(c.minimumEvidence, real) }));
      const maxOverlap = Math.max(...scored.map((s) => s.overlap));
      const winners = scored.filter((s) => s.overlap === maxOverlap);
      if (maxOverlap === 0 || winners.length > 1) {
        results.push({
          findingIndex,
          classification: 'AMBIGUOUS',
          criterionMatch: true,
          selectorMatch: regionCandidates.length > 0,
          problemTypeMatch: 'unresolved',
          reason:
            'Múltiples expectedFindings comparten criterio (+región, cuando aplica) y no pueden desambiguarse determinísticamente por solapamiento de evidencia mínima -- requiere revisión manual, no se fuerza una coincidencia.',
          candidateIds: effectiveCandidates.map((s) => s.id),
        });
        return;
      }
      candidate = winners[0].c;
    }

    // Consistency — compuerta POSTERIOR al matching, nunca un paso de
    // matching (K.2.1.1 §4: Matching y Consistency son preguntas distintas).
    const consistency = checkVisualEvidenceConsistency(real);

    if (consistency.overallStatus === 'INCONSISTENT') {
      results.push({
        findingIndex,
        classification: 'FP',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'INCONSISTENT',
        reason: `La evidencia visual citada se contradice internamente (VisualEvidenceConsistency INCONSISTENT) -- no puede considerarse TP para ${candidate.id}, aunque el matching estructural (criterio/región) haya sido correcto (Caso 10, K.2.1).`,
      });
      return;
    }
    if (consistency.overallStatus === 'INSUFFICIENT') {
      results.push({
        findingIndex,
        classification: 'NOT_EVALUABLE',
        matchedExpectedFindingId: candidate.id,
        criterionMatch: true,
        selectorMatch: true,
        problemTypeMatch,
        evidenceStatus: 'INSUFFICIENT',
        reason: `El finding no citó evidencia visual verificable para ${candidate.id} (VisualEvidenceConsistency INSUFFICIENT) -- nunca se convierte artificialmente en TP.`,
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
            : `El sistema se abstuvo (NOT_EVALUABLE) donde ${candidate.id} esperaba un estado evaluable -- nunca se cuenta como FN automático.`,
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
        reason: `Ya existe un TP previo (finding #${alreadyClaimedIndex}) para ${candidate.id} -- este finding adicional se cuenta como DUPLICATE.`,
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
        ? `Criterio, elemento visual y evidencia mínima completa coinciden con ${candidate.id}.`
        : `Criterio y elemento visual coinciden con ${candidate.id}, pero la evidencia mínima declarada no fue citada en su totalidad.`,
    });
  });

  const coverage: ExpectedFindingCoverage[] = expectedFindings.map((e) => {
    const claimedIndex = claimedBy.get(e.id);
    if (claimedIndex !== undefined) {
      const r = results.find((res) => res.findingIndex === claimedIndex && res.matchedExpectedFindingId === e.id);
      return { expectedFindingId: e.id, status: r!.classification as 'TP_EXACT' | 'TP_SEMANTIC', matchedFindingIndex: claimedIndex };
    }
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
