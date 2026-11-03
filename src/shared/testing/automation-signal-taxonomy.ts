/**
 * Fase D — Automation-Signal vs. DOM-Observation taxonomy (testing-only
 * module, not wired into production EvidenceGate/contracts).
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
 * This is deliberately NOT wired into EvidenceGate/ai.contracts.ts yet —
 * that would be a production contract change (Fase 2.2.3, still pending
 * approval). Here it exists so Fase D can PROVE the rule against real
 * captured data before that production change is ever proposed.
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
