import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P1.6.6.1 -- corrige el defecto confirmado en la auditoría P1.6.6: la
 * consolidación de estados por criterio en `calculatePrototypeMetrics`
 * dependía del ORDEN de aparición de los hallazgos en el array de entrada
 * (un mismo par PASS+FAIL para un mismo criterio producía `overallScore: 54`
 * o `overallScore: 0` según cuál apareciera primero). Esta suite valida la
 * política de prioridad explícita `FAIL > PASS > NOT_EVALUABLE` y su
 * independencia total del orden, con la función REAL (nunca reimplementada).
 */
function runTests() {
  console.log('🧪 Starting Prototype Metrics Consolidation (P1.6.6.1) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  function makeFinding(
    criterionCode: string,
    status: 'PASS' | 'FAIL' | 'NOT_EVALUABLE',
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info',
  ): PrototypeAuditFinding {
    const isWcag = criterionCode.startsWith('WCAG');
    return {
      findingGroup: 'ux',
      type: 'usability',
      status,
      severity,
      confidence: 'high',
      heuristicCode: isWcag ? null : criterionCode,
      heuristicName: isWcag ? null : 'Heurística de prueba',
      wcagCriterion: isWcag ? criterionCode : null,
      description: `Hallazgo de prueba para ${criterionCode}`,
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'elemento de prueba', context: 'contexto de prueba' }],
      affectedElement: { visualReference: { description: 'elemento de prueba', region: 'center' } },
      recommendation: status === 'FAIL' ? 'Recomendación de prueba' : null,
    } as any;
  }

  /** Genera todas las permutaciones de un array (usado para el Caso H). */
  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const result: T[][] = [];
    for (let i = 0; i < items.length; i++) {
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      for (const perm of permutations(rest)) {
        result.push([items[i], ...perm]);
      }
    }
    return result;
  }

  function criterionResult(findings: PrototypeAuditFinding[]) {
    // Para inspeccionar el estado consolidado de UN criterio específico sin
    // exponer `statusByCriterion` (privado a la función), usamos una señal
    // indirecta pero inequívoca: failCount/passCount/evaluatedCriteria, ya
    // que cada escenario de este archivo usa un único criterio aplicable
    // por caso (o criterios deliberadamente independientes en el Caso I).
    return calculatePrototypeMetrics(findings);
  }

  // --- Caso A: PASS antes de FAIL -> FAIL ---
  {
    const findings = [makeFinding('WCAG 1.4.1', 'PASS'), makeFinding('WCAG 1.4.1', 'FAIL', 'high')];
    const m = criterionResult(findings);
    assert(m.failCount === 1 && m.passCount === 0, 'Caso A (PASS->FAIL high, mismo criterio): consolidado = FAIL');
    assert(m.highCount === 1, 'Caso A: la severidad consolidada es high');
  }

  // --- Caso B: FAIL antes de PASS -> FAIL (idéntico al Caso A) ---
  {
    const findingsA = [makeFinding('WCAG 1.4.1', 'PASS'), makeFinding('WCAG 1.4.1', 'FAIL', 'high')];
    const findingsB = [makeFinding('WCAG 1.4.1', 'FAIL', 'high'), makeFinding('WCAG 1.4.1', 'PASS')];
    const mA = calculatePrototypeMetrics(findingsA);
    const mB = calculatePrototypeMetrics(findingsB);
    assert(mB.failCount === 1 && mB.passCount === 0, 'Caso B (FAIL high->PASS, mismo criterio): consolidado = FAIL');
    assert(mA.overallScore === mB.overallScore, 'Casos A y B producen EXACTAMENTE el mismo overallScore (defecto de orden corregido)');
    assert(JSON.stringify(mA) === JSON.stringify(mB), 'Casos A y B producen métricas idénticas en todos los campos, no solo el score');
  }

  // --- Caso C: PASS + NOT_EVALUABLE -> PASS, en ambos órdenes ---
  {
    const order1 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'PASS'), makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE')]);
    const order2 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE'), makeFinding('WCAG 1.4.1', 'PASS')]);
    assert(order1.passCount === 1 && order1.failCount === 0, 'Caso C (orden PASS->NOT_EVALUABLE): consolidado = PASS');
    assert(order2.passCount === 1 && order2.failCount === 0, 'Caso C (orden NOT_EVALUABLE->PASS): consolidado = PASS');
    assert(JSON.stringify(order1) === JSON.stringify(order2), 'Caso C: resultado idéntico independientemente del orden');
  }

  // --- Caso D: FAIL + NOT_EVALUABLE -> FAIL, en ambos órdenes ---
  {
    const order1 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'FAIL', 'medium'), makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE')]);
    const order2 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE'), makeFinding('WCAG 1.4.1', 'FAIL', 'medium')]);
    assert(order1.failCount === 1 && order1.passCount === 0, 'Caso D (orden FAIL->NOT_EVALUABLE): consolidado = FAIL');
    assert(order2.failCount === 1 && order2.passCount === 0, 'Caso D (orden NOT_EVALUABLE->FAIL): consolidado = FAIL');
    assert(JSON.stringify(order1) === JSON.stringify(order2), 'Caso D: resultado idéntico independientemente del orden');
  }

  // --- Caso E: varios FAIL (low, critical, medium) -> FAIL critical ---
  // Nota de alcance: `criticalCount`/`highCount`/`mediumCount`/`lowCount` del
  // Report se calculan históricamente POR HALLAZGO crudo (`failFindings.
  // filter(...)`), no por criterio consolidado -- ese es un comportamiento
  // preexistente y deliberadamente FUERA de alcance de P1.6.6.1 (ver
  // auditoría P1.6.6, problema #4). La severidad CONSOLIDADA que de verdad
  // alimenta la penalización del score solo es observable a través de
  // `overallScore`, así que la verificamos comparando contra un escenario
  // equivalente de un único FAIL critical (misma penalización esperada).
  {
    const mixedSeverities = calculatePrototypeMetrics([
      makeFinding('WCAG 1.4.1', 'FAIL', 'low'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'critical'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'medium'),
    ]);
    const onlyCritical = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'FAIL', 'critical')]);
    assert(mixedSeverities.failCount === 1, 'Caso E: los 3 FAIL del mismo criterio consolidan en un único criterio FAIL (sin doble penalización)');
    assert(mixedSeverities.overallScore === onlyCritical.overallScore,
      `Caso E: el overallScore con (low+critical+medium) es idéntico al de un único FAIL critical -- la severidad consolidada usada por el score es critical (obtenidos: ${mixedSeverities.overallScore} vs ${onlyCritical.overallScore})`);
  }

  // --- Caso F: solo NOT_EVALUABLE -> NOT_EVALUABLE ---
  {
    const findings = [makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE'), makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE')];
    const m = calculatePrototypeMetrics(findings);
    assert(m.passCount === 0 && m.failCount === 0, 'Caso F: ningún FAIL/PASS -- el criterio permanece NOT_EVALUABLE (evaluated=0)');
    assert(m.overallScore === null, 'Caso F: overallScore es null cuando el único criterio mencionado es NOT_EVALUABLE (evaluated=0)');
  }

  // --- Caso G: todos los estados combinados -> FAIL high, en cualquier orden ---
  // Se agrega un segundo criterio (N-03, siempre PASS) para que `compliance`
  // sea > 0 y el overallScore distinga numéricamente entre "consolidó a
  // high" (15 de penalización) y "consolidó a medium" (8) -- con un único
  // criterio FAIL y compliance=0 ambas severidades darían overallScore=0 por
  // igual, lo que no demostraría nada sobre CUÁL severidad ganó.
  {
    const base = [
      makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE'),
      makeFinding('WCAG 1.4.1', 'PASS'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'medium'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'high'),
      makeFinding('N-03', 'PASS'),
    ];
    const order1 = calculatePrototypeMetrics(base);
    const order2 = calculatePrototypeMetrics([...base].reverse());
    // evaluated=2 (WCAG1.4.1=FAIL high, N-03=PASS) -> compliance=50,
    // totalPenalty=15, penaltyNormalized=7.5, coverageRatio=2/13,
    // gammaCoverage=0.5+0.5*(2/13)=0.576923, baseQuality=42.5,
    // overallScore=round(42.5*0.576923)=25. Si hubiera consolidado
    // incorrectamente a "medium" (8), el resultado sería 27, no 25.
    assert(order1.failCount === 1 && order1.passCount === 1, 'Caso G (orden original): WCAG 1.4.1 consolida FAIL y N-03 consolida PASS');
    assert(order1.overallScore === 25, `Caso G (orden original): overallScore=25 confirma que la severidad consolidada es high, no medium (obtenido: ${order1.overallScore})`);
    assert(order2.overallScore === 25, `Caso G (orden invertido): overallScore=25 idéntico (obtenido: ${order2.overallScore})`);
    assert(JSON.stringify(order1) === JSON.stringify(order2), 'Caso G: resultado idéntico sin importar el orden de los 5 hallazgos combinados');
  }

  // --- Caso H: permutaciones sistemáticas (24 órdenes de los 4 hallazgos del Caso G) ---
  {
    const base = [
      makeFinding('WCAG 1.4.1', 'NOT_EVALUABLE'),
      makeFinding('WCAG 1.4.1', 'PASS'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'medium'),
      makeFinding('WCAG 1.4.1', 'FAIL', 'high'),
    ];
    const allPerms = permutations(base);
    const results = allPerms.map((perm) => JSON.stringify(calculatePrototypeMetrics(perm)));
    const uniqueResults = new Set(results);
    assert(allPerms.length === 24, 'Caso H: se generaron las 24 permutaciones de 4 elementos esperadas');
    assert(uniqueResults.size === 1, `Caso H: las 24 permutaciones producen EXACTAMENTE el mismo resultado (${uniqueResults.size} resultado(s) único(s) encontrado(s))`);
  }

  // --- Caso I: criterios independientes -- consolidar uno no afecta al otro ---
  {
    const findings = [
      makeFinding('WCAG 1.4.1', 'FAIL', 'critical'),
      makeFinding('WCAG 1.4.1', 'PASS'),
      makeFinding('N-03', 'PASS'),
    ];
    const m = calculatePrototypeMetrics(findings);
    assert(m.failCount === 1 && m.passCount === 1, 'Caso I: WCAG 1.4.1 consolida FAIL y N-03 consolida PASS, sin interferencia mutua');
    assert(m.criticalCount === 1, 'Caso I: la severidad critical de WCAG 1.4.1 se preserva sin verse afectada por el PASS de N-03');
  }

  // --- Caso J: criterios OUT_OF_COVERAGE siguen excluidos del cálculo ---
  {
    const withOutOfCoverage = calculatePrototypeMetrics([
      makeFinding('WCAG 4.1.2', 'FAIL', 'critical'), // OUT_OF_COVERAGE
      makeFinding('WCAG 1.4.1', 'FAIL', 'medium'),
    ]);
    const withoutOutOfCoverage = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'FAIL', 'medium')]);
    assert(withOutOfCoverage.coverage.evaluatedCriteria === 1, 'Caso J: WCAG 4.1.2 (OUT_OF_COVERAGE) no se cuenta como criterio evaluado');
    assert(withOutOfCoverage.coverage.applicableCriteria === withoutOutOfCoverage.coverage.applicableCriteria,
      'Caso J: applicableCriteria no cambia por la presencia de un hallazgo OUT_OF_COVERAGE');
    assert(withOutOfCoverage.overallScore === withoutOutOfCoverage.overallScore,
      `Caso J: overallScore es idéntico con o sin el FAIL critical de WCAG 4.1.2 -- el criterio OUT_OF_COVERAGE nunca participa en la penalización ni en la cobertura (obtenidos: ${withOutOfCoverage.overallScore} vs ${withoutOutOfCoverage.overallScore})`);
  }

  // --- Caso K: regresión del score -- escenarios sintéticos de P1.6.6 siguen produciendo los mismos resultados ---
  {
    // Escenario 7 de P1.6.6 (11 PASS + 1 FAIL low, 12/13 evaluados, N-08 omitido) -> overallScore=88
    const APPLICABLE_13 = ['WCAG 1.4.1', 'WCAG 1.3.1', 'WCAG 1.4.3', 'WCAG 2.4.4', 'WCAG 2.4.6', 'WCAG 1.1.1', 'WCAG 3.3.2', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06', 'N-08'];
    const scenario7 = [...APPLICABLE_13.slice(0, 11).map((c) => makeFinding(c, 'PASS')), makeFinding(APPLICABLE_13[11], 'FAIL', 'low')];
    const m7 = calculatePrototypeMetrics(scenario7);
    assert(m7.overallScore === 88, `Caso K (escenario 7 de P1.6.6, sin colisión de criterio): overallScore sigue siendo 88 (obtenido: ${m7.overallScore})`);

    // Escenario 8 de P1.6.6 (1 PASS de 13) -> overallScore=54
    const m8 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'PASS')]);
    assert(m8.overallScore === 54, `Caso K (escenario 8 de P1.6.6): overallScore sigue siendo 54 (obtenido: ${m8.overallScore})`);

    // Escenario 8b de P1.6.6 (1 FAIL critical de 13) -> overallScore=0
    const m8b = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'FAIL', 'critical')]);
    assert(m8b.overallScore === 0, `Caso K (escenario 8b de P1.6.6): overallScore sigue siendo 0 (obtenido: ${m8b.overallScore})`);

    // Escenario 1 de P1.6.6 (1 FAIL critical aislado, sin colisión) -> overallScore=0
    const m1 = calculatePrototypeMetrics([makeFinding('WCAG 1.4.1', 'FAIL', 'critical')]);
    assert(m1.overallScore === 0, `Caso K (escenario 1 de P1.6.6): overallScore sigue siendo 0 (obtenido: ${m1.overallScore})`);

    // Escenario 12 de P1.6.6 (patrón empírico + 1 PASS) -> overallScore=12
    const scenario12 = [
      makeFinding('WCAG 2.4.6', 'FAIL', 'high'),
      makeFinding('N-06', 'FAIL', 'medium'),
      makeFinding('WCAG 1.4.3', 'NOT_EVALUABLE'),
      makeFinding('N-03', 'FAIL', 'low'),
      makeFinding('N-05', 'NOT_EVALUABLE'),
      makeFinding('N-04', 'PASS'),
    ];
    const m12 = calculatePrototypeMetrics(scenario12);
    assert(m12.overallScore === 12, `Caso K (escenario 12 de P1.6.6): overallScore sigue siendo 12 (obtenido: ${m12.overallScore})`);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
