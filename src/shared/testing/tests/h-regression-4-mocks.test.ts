import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { buildH4FindingsReport, summarizeH4Report } from '@/shared/testing/h-regression-analysis';

/**
 * H-REGRESSION-4 preparation — deterministic, Gemini-free tests proving the
 * RUNNER's own analysis/categorization logic (buildH4FindingsReport /
 * summarizeH4Report) correctly records CASE A (INCONSISTENT) / CASE B
 * (CONSISTENT) / CASE C (NOT_CHECKABLE, non-traceable selector) / CASE D
 * (cardinality violation, J6 must not revert it) — see the H-REGRESSION-4
 * design doc. These mocks exist ONLY to validate the runner's measurement
 * machinery; they are explicitly NOT a substitute for the real experiment
 * (observing whether a REAL Gemini response contains a spontaneous
 * property/value inconsistency) — that question remains open until H4 is
 * actually authorized and executed against real Gemini.
 *
 * Gemini calls: 0.
 */
async function main() {
  console.log('🧪 Starting H-REGRESSION-4 runner-analysis mock tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/h4-mocks', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [],
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [
          { selector: '#email', type: 'email', name: 'email', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: true, placeholder: 'Email', ariaInvalid: false },
        ],
      }],
      landmarks: [{ type: 'form', selector: 'form', ariaLabel: null }],
      computedStyles: [],
    },
  ];

  // ===== Mock 1: evidencia CONSISTENT =====
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        {
          findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: 'El input de email no tiene ariaLabel.',
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: null, selector: '#email' }],
          affectedElement: { tag: 'input', selector: '#email' },
          recommendation: 'Agregar un aria-label descriptivo.',
        },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'h4-mock1' });
      const report = buildH4FindingsReport(result.rawAiFindings, result.evidenceIndex, result.gatedAiFindings, result.cardinalityCheckedFindings, result.validatedAiFindings);
      const summary = summarizeH4Report(report);
      assert(report[0].j6OverallStatus === 'CONSISTENT', `Mock 1: J6 clasifica CASE B (CONSISTENT) (obtenido: ${report[0].j6OverallStatus})`);
      assert(!report[0].degradedByJ6, 'Mock 1: no degradado por J6.');
      assert(summary.verdict === 'NO_INCONSISTENCY_OBSERVED', `Mock 1: veredicto agregado = NO_INCONSISTENCY_OBSERVED (obtenido: ${summary.verdict})`);
    } finally {
      stub.restore();
    }
  }

  // ===== Mock 2: evidencia INCONSISTENT =====
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        {
          findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: 'El input de email tiene un ariaLabel descriptivo.',
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Correo válido', selector: '#email' }],
          affectedElement: { tag: 'input', selector: '#email' },
          recommendation: 'Mejorar el texto del aria-label.',
        },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'h4-mock2' });
      const report = buildH4FindingsReport(result.rawAiFindings, result.evidenceIndex, result.gatedAiFindings, result.cardinalityCheckedFindings, result.validatedAiFindings);
      const summary = summarizeH4Report(report);
      assert(report[0].j6OverallStatus === 'INCONSISTENT', `Mock 2: J6 clasifica CASE A (INCONSISTENT) (obtenido: ${report[0].j6OverallStatus})`);
      assert(report[0].degradedByJ6, 'Mock 2: degradado por J6 (no por gate ni cardinalidad).');
      assert(!report[0].degradedByGate && !report[0].degradedByCardinality, 'Mock 2: NO degradado por gate/cardinalidad -- la degradación es específicamente de J6.');
      assert(report[0].statusAfterJ6 === 'NOT_EVALUABLE' && report[0].confidenceAfterJ6 === 'low' && report[0].recommendationAfterJ6 === null, 'Mock 2: contrato de degradación completo (NOT_EVALUABLE/low/null).');
      assert(summary.verdict === 'PASS', `Mock 2: veredicto agregado = PASS (obtenido: ${summary.verdict}, razón: ${summary.verdictReason})`);
      assert(summary.inconsistentFindings.length === 1 && summary.inconsistentFindings[0].property === 'ariaLabel', 'Mock 2: inconsistentFindings identifica selector/property/claimedValue correctamente.');
    } finally {
      stub.restore();
    }
  }

  // ===== Mock 3: selector inexistente (CASE C, NOT_CHECKABLE) =====
  {
    const HALLUCINATED = 'button.never-sent';
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        {
          findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: `El botón en ${HALLUCINATED} carece de nombre accesible.`,
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: null, selector: HALLUCINATED }],
          affectedElement: { tag: 'button', selector: HALLUCINATED },
          recommendation: 'Agregar un aria-label descriptivo.',
        },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'h4-mock3' });
      const report = buildH4FindingsReport(result.rawAiFindings, result.evidenceIndex, result.gatedAiFindings, result.cardinalityCheckedFindings, result.validatedAiFindings);
      const summary = summarizeH4Report(report);
      assert(!report[0].traceable, 'Mock 3: J1 confirma selector NO trazable.');
      assert(report[0].degradedByGate, 'Mock 3: EvidenceGate/J1 ya degrada este finding (antes de cardinalidad/J6).');
      assert(report[0].j6OverallStatus === 'INSUFFICIENT', `Mock 3: J6 clasifica CASE C (INSUFFICIENT/NOT_CHECKABLE, nunca INCONSISTENT) (obtenido: ${report[0].j6OverallStatus})`);
      assert(report[0].j6Items.every((it) => it.status === 'NOT_CHECKABLE'), 'Mock 3: todos los ítems J6 son NOT_CHECKABLE, ninguno INCONSISTENT (selector inexistente no se convierte en inconsistencia).');
      assert(summary.verdict === 'NO_INCONSISTENCY_OBSERVED', `Mock 3: veredicto agregado = NO_INCONSISTENCY_OBSERVED (obtenido: ${summary.verdict})`);
    } finally {
      stub.restore();
    }
  }

  // ===== Mock 4: múltiples códigos WCAG (CASE D, cardinalidad degrada, J6 no revierte) =====
  {
    const COMBINED = 'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones';
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        {
          findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
          wcagCriterion: COMBINED,
          description: 'El input de email no tiene label ni ariaLabel.',
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: null, selector: '#email' }],
          affectedElement: { tag: 'input', selector: '#email' },
          recommendation: 'Agregar un aria-label descriptivo.',
        },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'h4-mock4' });
      const report = buildH4FindingsReport(result.rawAiFindings, result.evidenceIndex, result.gatedAiFindings, result.cardinalityCheckedFindings, result.validatedAiFindings);
      assert(report[0].cardinalityViolation, `Mock 4: cardinalityCodeCount > 1 detectado (obtenido: ${report[0].cardinalityCodeCount})`);
      assert(report[0].degradedByCardinality, 'Mock 4: degradado específicamente por cardinalidad (no por gate).');
      assert(!report[0].degradedByJ6, 'Mock 4: J6 NO aplica una segunda degradación -- el finding ya llegó degradado.');
      assert(report[0].statusAfterJ6 === 'NOT_EVALUABLE', `Mock 4: status final se mantiene NOT_EVALUABLE, J6 no lo revierte (obtenido: ${report[0].statusAfterJ6})`);
    } finally {
      stub.restore();
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
