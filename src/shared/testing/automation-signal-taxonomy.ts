/**
 * Fase D — Automation-Signal vs. DOM-Observation taxonomy.
 *
 * Formalizes the distinction identified during the Fase 2.2.1 design and
 * the Fase 2.2 audit (the real incident: a Playwright click timeout on an
 * ambiguous/hidden selector produced WCAG 2.1.1 + N-01 findings with ZERO
 * corroborating DOM evidence). The core rule this module encodes:
 *
 *   A tool failure (timeout, ambiguous locator, navigation error) describes
 *   OUR AUTOMATION, not the page. It can NEVER by itself justify a
 *   WCAG/Nielsen FAIL verdict — only a real, observable DOM/ARIA/style fact
 *   can.
 *
 * P1.7.3.1 — ya NO es exclusivamente de pruebas: `canJustifyFail`,
 * `classifyDomFact` y `recommendedStatusForEvidence` se reutilizan desde
 * `evidence-gate.service.ts` (producción) para proteger hallazgos FAIL de
 * sitios web cuyo único sustento real sea una señal de automatización.
 * `classifyActionFailure` sigue usándose solo en pruebas, porque el Evidence
 * Gate no recibe el objeto `{success, error}` real de `executeAction` (ver
 * `evidence-gate.service.ts`, sección "Automation Signal Protection") --
 * ahí se construye la clasificación a partir del texto de `description` del
 * propio finding, no de ese objeto. Permanece en `src/shared/testing/` por
 * ser el camino de menor impacto (evita modificar las importaciones de los
 * 4 archivos de prueba de Fase D/E que ya dependen de esta ruta); se deja
 * documentado como una inconsistencia de ubicación conocida y aceptada, no
 * resuelta en esta fase (ver informe P1.7.3.1, sección "problema de
 * ubicación").
 */

export type EvidenceOrigin = 'automation-signal' | 'dom-observation';

export interface ClassifiedEvidenceItem {
  origin: EvidenceOrigin;
  /** Human-readable description of what this item represents. */
  description: string;
  /** The original data this was derived from, kept for traceability. */
  raw: unknown;
}

/**
 * Classifies a Playwright `executeAction` result. Returns `null` on
 * success (nothing to classify — no automation signal occurred).
 */
export function classifyActionFailure(actionResult: { success: boolean; error?: string }): ClassifiedEvidenceItem | null {
  if (actionResult.success) return null;
  return {
    origin: 'automation-signal',
    description: `Fallo de automatización: ${actionResult.error ?? 'error desconocido'}`,
    raw: actionResult,
  };
}

/** Classifies a raw DOM/computed-style/ARIA fact as dom-observation evidence. */
export function classifyDomFact(description: string, raw: unknown): ClassifiedEvidenceItem {
  return { origin: 'dom-observation', description, raw };
}

/**
 * THE CORE RULE. A verdict of FAIL is only justifiable when at least one
 * `dom-observation` item is present — any number of `automation-signal`
 * items, however severe, is insufficient on its own.
 */
export function canJustifyFail(evidence: ClassifiedEvidenceItem[]): boolean {
  return evidence.some((e) => e.origin === 'dom-observation');
}

/** What a FAIL/NOT_EVALUABLE decision SHOULD be, given only this rule (not a full AI judgment). */
export function recommendedStatusForEvidence(evidence: ClassifiedEvidenceItem[]): 'FAIL' | 'NOT_EVALUABLE' {
  return canJustifyFail(evidence) ? 'FAIL' : 'NOT_EVALUABLE';
}

/** Convenience: does this evidence set contain ONLY automation-signal items (the dangerous case)? */
export function isAutomationSignalOnly(evidence: ClassifiedEvidenceItem[]): boolean {
  return evidence.length > 0 && evidence.every((e) => e.origin === 'automation-signal');
}
