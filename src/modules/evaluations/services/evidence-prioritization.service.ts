import { ComputedStyleEvidence, LandmarkEvidence, LinkEvidence, ButtonEvidence, HeadingEvidence, ImageEvidence, FormEvidence } from '@/modules/snapshots/snapshot-evidence.model';
import { Deduplicated } from './evidence-deduplication.service';
import { computeContrastFailure } from './deterministic-analyzer.service';

/**
 * evidence-prioritization.service — Hardening Post-Fase H, J4 Step 2b.
 *
 * Selects the FINAL, budget-bounded set of computedStyles actually sent to
 * Gemini, from the larger deduplicated candidate pool produced by J4 Step 1
 * (fed from the wider capture pool of J4 Step 2a). This module does NOT
 * decide which elements to CAPTURE (that's automation.service.ts) and does
 * NOT decide whether a finding is correct (that's EvidenceGate/J1) — it
 * answers one narrow question: "given more candidates than the budget
 * allows, which ones should make the final cut, without silently starving
 * any one category by DOM position alone?"
 *
 * EXPLICIT DESIGN CHOICE (per instruction): this is NOT an absolute
 * hierarchy where a higher group always displaces a lower one regardless
 * of quantity. Each group gets a GUARANTEED MINIMUM quota; only leftover
 * capacity is filled by round-robin across groups that still have
 * candidates. This is what prevents "text/label always loses" bias.
 */

export const COMPUTED_STYLES_FINAL_BUDGET = 50; // unchanged from the pre-J4 budget — never removed, per instruction.

export type PriorityGroup = 'finding' | 'evidenced' | 'unbacked';

export interface PrioritizationSignals {
  /** Selectors present in dedupedLinks/dedupedButtons/dedupedLandmarks/headings/images/forms(+elements) for this session. */
  otherEvidenceSelectors: Set<string>;
  /**
   * Selectors with an existing DeterministicAnalyzer finding whose
   * criterion does NOT itself depend on computedStyles (i.e. NOT WCAG
   * 1.4.3 contrast) — using a contrast finding here would be circular:
   * an element only ever gets a contrast finding if its computedStyle was
   * ALREADY captured, so "has a contrast finding" can never justify
   * capturing a style that was never measured in the first place.
   */
  independentFindingSelectors: Set<string>;
}

export interface PrioritizationResult {
  final: Array<Deduplicated<ComputedStyleEvidence>>;
  candidateCount: number;
  finalCount: number;
  /** How many deduplicated candidates existed in each group, BEFORE selection. */
  groupSizes: Record<PriorityGroup, number>;
  /** How many from each group were actually retained in `final`. */
  groupRetained: Record<PriorityGroup, number>;
  /**
   * Hardening K.1, Parte D — cuántos candidatos fueron reservados por tener
   * un contraste objetivamente insuficiente (misma fórmula/umbral que
   * `DeterministicAnalyzer.analyzeContrast`, vía `computeContrastFailure`),
   * garantizados en `final` ANTES de aplicar cuotas/round-robin. Nunca
   * excede `finalBudget` (el cap estructural se preserva).
   */
  criticalCount: number;
}

/**
 * Builds the "otherEvidenceSelectors" signal from the SAME per-session data
 * already assembled elsewhere (dedupedLinks/Buttons/Landmarks +
 * evidencesSummary) — never re-queries Playwright.
 */
export function collectOtherEvidenceSelectors(input: {
  dedupedLandmarks: Array<Deduplicated<LandmarkEvidence>>;
  dedupedLinks: Array<Deduplicated<LinkEvidence>>;
  dedupedButtons: Array<Deduplicated<ButtonEvidence>>;
  evidencesSummary: Array<{ headings: HeadingEvidence[]; images: ImageEvidence[]; forms: FormEvidence[] }>;
}): Set<string> {
  const selectors = new Set<string>();
  for (const lm of input.dedupedLandmarks) selectors.add(lm.selector);
  for (const l of input.dedupedLinks) selectors.add(l.selector);
  for (const b of input.dedupedButtons) selectors.add(b.selector);
  for (const snap of input.evidencesSummary) {
    for (const h of snap.headings || []) selectors.add(h.selector);
    for (const img of snap.images || []) selectors.add(img.selector);
    for (const form of snap.forms || []) {
      selectors.add(form.selector);
      for (const el of form.elements || []) selectors.add(el.selector);
    }
  }
  return selectors;
}

/**
 * Builds the "independentFindingSelectors" signal from DeterministicAnalyzer's
 * output, EXCLUDING WCAG 1.4.3 (contrast) findings — see the circularity
 * note on `PrioritizationSignals.independentFindingSelectors`.
 */
export function collectIndependentFindingSelectors(
  deterministicFindings: Array<{ wcagCriterion?: string; affectedElement?: { selector?: string } }>,
): Set<string> {
  const selectors = new Set<string>();
  for (const f of deterministicFindings) {
    if (f.wcagCriterion?.includes('1.4.3')) continue; // circular for this signal — excluded deliberately
    if (f.affectedElement?.selector) selectors.add(f.affectedElement.selector);
  }
  return selectors;
}

/**
 * Selects the final, budget-bounded computedStyles set.
 *
 * Order note: `deduped` (the output of deduplicateComputedStyles, J4 Step 1)
 * preserves first-seen order (Map insertion order from
 * groupIdenticalEvidence) — the closest available proxy to "DOM order"
 * without adding new bookkeeping, and what this function relies on for its
 * within-group tie-break.
 */
export function prioritizeComputedStyles(
  deduped: Array<Deduplicated<ComputedStyleEvidence>>,
  signals: PrioritizationSignals,
  finalBudget: number = COMPUTED_STYLES_FINAL_BUDGET,
): PrioritizationResult {
  const groups: Record<PriorityGroup, Array<Deduplicated<ComputedStyleEvidence>>> = {
    finding: [],
    evidenced: [],
    unbacked: [],
  };

  for (const item of deduped) {
    if (signals.independentFindingSelectors.has(item.selector)) groups.finding.push(item);
    else if (signals.otherEvidenceSelectors.has(item.selector)) groups.evidenced.push(item);
    else groups.unbacked.push(item);
  }

  // Hardening K.1, Parte D — evidencia de contraste CRÍTICA (ratio YA por
  // debajo del umbral real; misma fórmula/threshold que
  // `DeterministicAnalyzer.analyzeContrast`, reutilizada vía
  // `computeContrastFailure`, nunca reimplementada) se RESERVA antes de
  // cualquier cuota/round-robin: nunca compite por posición DOM contra
  // evidencia decorativa/sin problema conocido (el riesgo confirmado en
  // Fase K, `payload-critical-evidence-loss.test.ts`). El cap estructural
  // (`finalBudget`) se preserva igual para lo reservado -- no hay
  // crecimiento ilimitado ni siquiera si hubiera más de `finalBudget`
  // candidatos críticos a la vez.
  const reserved = deduped
    .filter((item) => {
      // P1.1: `failure` ahora puede ser un resultado "inconclusive" (fondo
      // con transparencia parcial, ratio null) -- se excluye explícitamente
      // aquí para no tratarlo como "ratio por debajo del umbral" (una
      // comparación `null < number` en JS coacciona `null` a 0, lo que
      // reservaría por error un caso no determinable como crítico).
      const failure = computeContrastFailure(item);
      return !!failure && !failure.inconclusive && failure.ratio < failure.minRequiredRatio;
    })
    .slice(0, finalBudget);
  const reservedSelectors = new Set(reserved.map((i) => i.selector));

  const order: PriorityGroup[] = ['finding', 'evidenced', 'unbacked'];
  // Candidatos elegibles para la selección por cuotas: EXCLUYEN lo ya
  // reservado (para no duplicarlo en `final`) -- `groupSizes` (reportado
  // abajo) sigue reflejando el tamaño REAL y completo de cada grupo.
  const selectable: Record<PriorityGroup, Array<Deduplicated<ComputedStyleEvidence>>> = {
    finding: groups.finding.filter((i) => !reservedSelectors.has(i.selector)),
    evidenced: groups.evidenced.filter((i) => !reservedSelectors.has(i.selector)),
    unbacked: groups.unbacked.filter((i) => !reservedSelectors.has(i.selector)),
  };
  const remainingBudget = Math.max(0, finalBudget - reserved.length);
  // Simple, explainable, symmetric starting formula (equal thirds) — NOT
  // tuned against real traffic. See J4 Step 2 design doc section 9/15:
  // calibrating this requires empirical data on real-page composition,
  // deliberately not assumed here.
  const perGroupQuota = Math.ceil(remainingBudget / order.length);

  const cursors: Record<PriorityGroup, number> = { finding: 0, evidenced: 0, unbacked: 0 };
  const final: Array<Deduplicated<ComputedStyleEvidence>> = [...reserved];

  // Phase 1: guaranteed minimum per group (never zero unless the group itself is empty).
  for (const g of order) {
    const take = Math.min(perGroupQuota, selectable[g].length, finalBudget - final.length);
    for (let i = 0; i < take; i++) final.push(selectable[g][i]);
    cursors[g] = take;
  }

  // Phase 2: round-robin fill of any remaining capacity from leftover items
  // (NOT a strict hierarchy — each group gets one more turn in sequence,
  // repeatedly, until the budget or all candidates are exhausted).
  let remaining = finalBudget - final.length;
  while (remaining > 0) {
    let addedThisRound = false;
    for (const g of order) {
      if (remaining <= 0) break;
      if (cursors[g] < selectable[g].length) {
        final.push(selectable[g][cursors[g]]);
        cursors[g]++;
        remaining--;
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break; // every group exhausted before reaching the budget
  }

  return {
    final,
    candidateCount: deduped.length,
    finalCount: final.length,
    groupSizes: { finding: groups.finding.length, evidenced: groups.evidenced.length, unbacked: groups.unbacked.length },
    groupRetained: { ...cursors },
    criticalCount: reserved.length,
  };
}
