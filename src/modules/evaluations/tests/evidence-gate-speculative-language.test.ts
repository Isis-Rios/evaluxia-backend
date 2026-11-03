import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { evidenceGateService } from '../services/evidence-gate.service';

/**
 * Hardening post Gemini Real #1 — hallazgo D: taxonomía de lenguaje
 * especulativo en `description` (Gate Rule 1, evidence-gate.service.ts).
 *
 * Caso real que motivó esta fase: un finding de Gemini con evidencia real
 * CONSISTENT (J6) y confidence=high fue degradado a NOT_EVALUABLE solo por
 * contener "potentially" en una cláusula de CONSECUENCIA ("...placeholder
 * text which disappears on input, potentially causing users to forget..."),
 * no de duda sobre la existencia del problema.
 *
 * Gemini calls: 0. Todo sintético/determinístico.
 */

function finding(overrides: Partial<V2AuditFinding>): V2AuditFinding {
  return {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    description: 'desc',
    evidence: [],
    recommendation: 'fix it',
    ...overrides,
  } as V2AuditFinding;
}

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function runSpeculativeLanguageTests() {
  console.log('🧪 Starting J1 speculative-language taxonomy (hallazgo D) tests...\n');

  const realEvidence = [{ type: 'DOM_ATTRIBUTE' as const, property: 'placeholder', value: 'Empresa' }];

  // Caso A — especulación FUERTE sobre la EXISTENCIA del problema, sin evidencia -> degrada.
  {
    const f = finding({ description: 'The button may be inaccessible.', evidence: [], confidence: 'high' });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso A (fuerte, "may", sin evidencia) -> NOT_EVALUABLE.', r);
  }

  // Caso A — especulación FUERTE degrada SIEMPRE, incluso con evidencia real y confidence alta
  // (a diferencia del caso débil "potentially", "may/might/could" hedgean la EXISTENCIA del
  // problema mismo, no una consecuencia de un hecho ya confirmado -- no se les da la exención
  // de corroboración).
  {
    const f = finding({ description: 'The element could be inaccessible for some users.', evidence: realEvidence, confidence: 'high' });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso A (fuerte, "could", CON evidencia real + confidence alta) -> degrada igual (no se exime).', r);
  }

  // Caso A — regresión: "podría" (español, fuerte) sigue degradando como antes de esta fase.
  {
    const f = finding({ description: 'El botón podría ser inaccesible.', evidence: [], confidence: 'high' });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Regresión: "podría" (fuerte, español) sigue degradando sin cambios.', r);
  }

  // Caso B — el caso REAL corregido: "potentially" introduce una CONSECUENCIA de un hecho ya
  // evidenciado, con evidencia real + confidence alta -> YA NO degrada solo por la palabra.
  {
    const f = finding({
      description: 'The placeholder text disappears when typing, potentially causing users to forget what information is required.',
      evidence: realEvidence,
      confidence: 'high',
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'FAIL', 'Caso B (débil, "potentially", CON evidencia real + confidence alta) -> YA NO degrada solo por el lenguaje (caso real de Gemini #1).', r);
  }

  // Caso B — control negativo: "potentially" SIN evidencia real -> degrada igual (sin corroboración, Caso D).
  {
    const f = finding({
      description: 'This might potentially cause confusion for some users in some scenarios.',
      evidence: [],
      confidence: 'high',
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso B control negativo: "potentially" SIN evidencia real -> degrada (sin corroboración).', r);
  }

  // Caso B — control negativo: "potentially" CON evidencia pero confidence YA baja -> degrada igual
  // (la corroboración exige evidencia Y confidence alta, no solo una de las dos).
  {
    const f = finding({
      description: 'The placeholder text disappears when typing, potentially causing users to forget what information is required.',
      evidence: realEvidence,
      confidence: 'low',
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso B control negativo: "potentially" con evidencia pero confidence=low -> degrada (corroboración incompleta).', r);
  }

  // Caso D — lenguaje hipotético/condicional explícito sin evidencia -> degrada.
  {
    const f = finding({ description: 'If implemented as described, this control would lack a name.', evidence: [], confidence: 'high' });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso D ("if implemented", sin evidencia) -> NOT_EVALUABLE.', r);
  }

  // Control: finding SIN ningún lenguaje especulativo, con evidencia real y confidence alta -> nunca degrada por Gate Rule 1.
  {
    const f = finding({
      description: 'The input field for the company name is missing a visible, programmatically associated label.',
      evidence: realEvidence,
      confidence: 'high',
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    expect(r.status === 'FAIL', 'Control: sin lenguaje especulativo, con evidencia real + confidence alta -> FAIL se conserva.', r);
  }

  console.log(`\n🎉 ALL J1 speculative-language taxonomy (hallazgo D) tests passed (${passed} assertions).`);
  process.exit(0);
}

runSpeculativeLanguageTests();
