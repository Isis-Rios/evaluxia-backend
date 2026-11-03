import { evaluateGroundTruth, normalizeCriterionKey, GroundTruth, ActualFindingLike } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase 2.3 — unit validation of the Ground Truth oracle's comparison logic
 * itself, with synthetic findings (no fixture files, no browser, no Gemini).
 * The infrastructure end-to-end proof (fixture-infrastructure.test.ts)
 * covers the happy path against a real fixture; this file covers the
 * oracle's decision logic across EXACT / SEMANTIC / NONDETERMINISTIC,
 * mustNotAppear, and duplicate detection.
 */
function runTests() {
  console.log('🧪 Starting ground-truth-oracle unit validation (Fase 2.3)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${msg}`);
      failed++;
    }
  }

  console.log('--- normalizeCriterionKey ---');
  assert(normalizeCriterionKey('WCAG 1.4.3 Contraste (Mínimo)') === 'WCAG 1.4.3', 'Extrae el código canónico WCAG de un string largo');
  assert(normalizeCriterionKey('N-01 Visibilidad del estado del sistema') === 'N-01', 'Extrae el código canónico Nielsen de un string largo');
  assert(normalizeCriterionKey(undefined) === 'unknown', 'undefined -> "unknown"');

  console.log('\n--- EXACT: coincide ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'WCAG 3.3.2', expectedStatus: 'FAIL', match: 'EXACT', verifiableBy: 'deterministic' }],
    };
    const findings: ActualFindingLike[] = [{ wcagCriterion: 'WCAG 3.3.2 Etiquetas', status: 'FAIL' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === true, 'EXACT que coincide -> overallPassed=true');
    assert(report.criteriaResults[0].passed === true, 'El criterio individual pasa');
  }

  console.log('\n--- EXACT: NO coincide (debe fallar el oráculo) ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'WCAG 3.3.2', expectedStatus: 'FAIL', match: 'EXACT', verifiableBy: 'deterministic' }],
    };
    const findings: ActualFindingLike[] = [{ wcagCriterion: 'WCAG 3.3.2 Etiquetas', status: 'PASS' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === false, 'EXACT que NO coincide (PASS real vs. FAIL esperado) -> overallPassed=false');
    assert(!report.criteriaResults[0].passed, 'El criterio individual falla, con razón explicada: ' + report.criteriaResults[0].reason);
  }

  console.log('\n--- EXACT: criterio ausente en los findings reales (debe fallar) ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'WCAG 2.1.1', expectedStatus: 'PASS', match: 'EXACT', verifiableBy: 'deterministic' }],
    };
    const report = evaluateGroundTruth(gt, []);
    assert(report.overallPassed === false, 'Criterio EXACT ausente por completo -> overallPassed=false (missing, no "silenciosamente OK")');
    assert(report.criteriaResults[0].missing === true, 'missing=true refleja que no hubo ningún finding para ese criterio');
  }

  console.log('\n--- SEMANTIC: banda por defecto acepta NOT_EVALUABLE ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'N-05', expectedStatus: 'FAIL', match: 'SEMANTIC', verifiableBy: 'ai' }],
    };
    const findings: ActualFindingLike[] = [{ heuristicCode: 'N-05', status: 'NOT_EVALUABLE' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === true, 'SEMANTIC: NOT_EVALUABLE es aceptable por defecto cuando se esperaba FAIL (Gemini abstenerse no es un fallo duro)');
  }

  console.log('\n--- SEMANTIC: fuera de la banda aceptable (debe fallar) ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'N-05', expectedStatus: 'FAIL', match: 'SEMANTIC', verifiableBy: 'ai', acceptableStatuses: ['FAIL'] }],
    };
    const findings: ActualFindingLike[] = [{ heuristicCode: 'N-05', status: 'PASS' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === false, 'SEMANTIC con banda explícita restringida: PASS fuera de ["FAIL"] -> overallPassed=false');
  }

  console.log('\n--- NONDETERMINISTIC: nunca falla el oráculo por sí solo ---');
  {
    const gt: GroundTruth = {
      fixture: 'x', criteria: [{ code: 'WCAG 9.9.9', expectedStatus: 'FAIL', match: 'NONDETERMINISTIC', verifiableBy: 'ai' }],
    };
    const reportEmpty = evaluateGroundTruth(gt, []);
    const reportMismatch = evaluateGroundTruth(gt, [{ wcagCriterion: 'WCAG 9.9.9', status: 'PASS' }]);
    assert(reportEmpty.overallPassed === true, 'NONDETERMINISTIC sin ningún finding real -> sigue pasando (informativo únicamente)');
    assert(reportMismatch.overallPassed === true, 'NONDETERMINISTIC con estado real distinto del esperado -> sigue pasando (nunca es un fallo duro)');
  }

  console.log('\n--- mustNotAppear: violación real detectada ---');
  {
    const gt: GroundTruth = {
      fixture: 'x',
      criteria: [],
      mustNotAppear: [{ code: 'WCAG 2.4.4', reason: 'No hay enlaces en este fixture' }],
    };
    const findings: ActualFindingLike[] = [{ wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces', status: 'FAIL' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === false, 'Un FAIL sobre un criterio en mustNotAppear -> overallPassed=false (posible alucinación)');
    assert(report.mustNotAppearViolations.length === 1, 'Se reporta exactamente 1 violación de mustNotAppear');
  }

  console.log('\n--- mustNotAppear: PASS/NOT_EVALUABLE en la lista NO es una violación ---');
  {
    const gt: GroundTruth = {
      fixture: 'x',
      criteria: [],
      mustNotAppear: [{ code: 'WCAG 2.4.4', reason: 'No hay enlaces en este fixture' }],
    };
    const findings: ActualFindingLike[] = [{ wcagCriterion: 'WCAG 2.4.4', status: 'NOT_EVALUABLE' }];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === true, 'NOT_EVALUABLE sobre un criterio de mustNotAppear NO cuenta como violación (solo un FAIL es señal de alucinación)');
  }

  console.log('\n--- Detección de duplicados por (criterio, selector) ---');
  {
    const gt: GroundTruth = { fixture: 'x', criteria: [] };
    const findings: ActualFindingLike[] = [
      { wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', affectedElement: { selector: 'a:nth-of-type(1)' } },
      { wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', affectedElement: { selector: 'a:nth-of-type(1)' } },
    ];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === false, 'Dos findings idénticos en (criterio, selector) -> overallPassed=false (regresión de deduplicateFindings)');
    assert(report.duplicateViolations.length === 1 && report.duplicateViolations[0].count === 2, 'Se reporta exactamente 1 grupo duplicado con count=2');
  }

  console.log('\n--- Sin duplicados cuando el selector difiere (mismo criterio, distinto elemento real) ---');
  {
    const gt: GroundTruth = { fixture: 'x', criteria: [] };
    const findings: ActualFindingLike[] = [
      { wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', affectedElement: { selector: 'a:nth-of-type(1)' } },
      { wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', affectedElement: { selector: 'a:nth-of-type(2)' } },
    ];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.duplicateViolations.length === 0, 'Selectores distintos -> NO se marca como duplicado (son elementos reales distintos)');
  }

  console.log('\n--- selectorHint: distingue 2 elementos con el mismo criterio y estados distintos ---');
  {
    const gt: GroundTruth = {
      fixture: 'x',
      criteria: [
        { code: 'WCAG 4.1.2', expectedStatus: 'FAIL', match: 'EXACT', verifiableBy: 'deterministic', selectorHint: 'bad' },
        { code: 'WCAG 4.1.2', expectedStatus: 'PASS', match: 'EXACT', verifiableBy: 'deterministic', selectorHint: 'good' },
      ],
    };
    const findings: ActualFindingLike[] = [
      { wcagCriterion: 'WCAG 4.1.2', status: 'FAIL', affectedElement: { selector: 'button[data-t="bad"]' } },
      { wcagCriterion: 'WCAG 4.1.2', status: 'PASS', affectedElement: { selector: 'button[data-t="good"]' } },
    ];
    const report = evaluateGroundTruth(gt, findings);
    assert(report.overallPassed === true, 'Con selectorHint, 2 elementos con el mismo criterio y estados opuestos se evalúan correctamente por separado');
    assert(report.criteriaResults[0].actualStatuses.length === 1 && report.criteriaResults[0].actualStatuses[0] === 'FAIL', 'El criterio con selectorHint="bad" solo ve el finding del botón malo');
    assert(report.criteriaResults[1].actualStatuses.length === 1 && report.criteriaResults[1].actualStatuses[0] === 'PASS', 'El criterio con selectorHint="good" solo ve el finding del botón bueno');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
