import {
  buildCriterionExport,
  toCsv,
  MinimalEvaluationForExport,
  MinimalFindingForExport,
  MinimalReportForExport,
} from '@/shared/testing/methodology-export';

/**
 * P1.7.2 — pruebas del núcleo puro de la herramienta de extracción
 * metodológica. Exclusivamente con datos controlados en memoria: ninguna
 * llamada a Gemini, ninguna escritura en MongoDB.
 */

function webEvaluation(overrides: Partial<MinimalEvaluationForExport> = {}): MinimalEvaluationForExport {
  return { id: 'web-eval-1', type: 'website', status: 'completed', auditStatus: 'completed', ...overrides };
}

function prototypeEvaluation(overrides: Partial<MinimalEvaluationForExport> = {}): MinimalEvaluationForExport {
  return { id: 'proto-eval-1', type: 'prototype', status: 'completed', auditStatus: 'completed', ...overrides };
}

function finding(overrides: Partial<MinimalFindingForExport>): MinimalFindingForExport {
  return {
    status: 'FAIL',
    severity: 'medium',
    description: 'desc',
    recommendation: 'rec',
    evidence: [{ type: 'DOM_ATTRIBUTE' }],
    ...overrides,
  };
}

async function runTests() {
  console.log('🧪 Starting P1.7.2 — Methodology Export Tool Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ─── 1. WEB: FAIL/PASS/NOT_EVALUABLE + OUT_OF_COVERAGE permanente ───────
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL', severity: 'high' }),
      finding({ heuristicCode: 'N-04', status: 'PASS', recommendation: null }),
      finding({ wcagCriterion: 'WCAG 1.3.1 Información y relaciones', status: 'NOT_EVALUABLE', recommendation: null }),
    ];
    const report: MinimalReportForExport = {
      passCount: 1,
      failCount: 1,
      notEvaluableCount: 18, // 20 - 1(FAIL) - 1(PASS)
      totalCriteria: 20,
      findingPersistencePolicy: 'PASS_PERSISTED',
      geminiModel: 'gemini-2.5-flash',
    };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });

    const byId = new Map(result.records.map((r) => [r.criterionId, r]));
    assert(result.evaluationType === 'WEB', '1a. evaluationType=WEB');
    assert(byId.get('WCAG 1.4.3')?.recoveredStatus === 'FAIL confirmado', '1b. WCAG 1.4.3 -> FAIL confirmado');
    assert(byId.get('N-04')?.recoveredStatus === 'PASS confirmado', '1c. N-04 -> PASS confirmado');
    assert(byId.get('WCAG 1.3.1')?.recoveredStatus === 'NOT_EVALUABLE', '1d. WCAG 1.3.1 -> NOT_EVALUABLE');
    assert(byId.get('WCAG 2.1.1')?.recoveredStatus === 'OUT_OF_COVERAGE', '1e. WCAG 2.1.1 (Teclado) -> OUT_OF_COVERAGE, nunca NOT_EVALUABLE');
    assert(byId.get('WCAG 3.2.2')?.recoveredStatus === 'OUT_OF_COVERAGE', '1f. WCAG 3.2.2 -> OUT_OF_COVERAGE, nunca NOT_EVALUABLE');
    assert(byId.get('N-01')?.recoveredStatus === 'SIN_RESULTADO_RECUPERABLE', '1g. N-01 silencioso (evaluación completa, política conocida) -> SIN_RESULTADO_RECUPERABLE, nunca PASS');
    assert(result.records.length === 20, `1h. Exactamente 20 registros (espacio fijo WEB), obtenido=${result.records.length}`);
    assert(result.validation.valid === true, '1i. Validación contra Report: válida (PASS/FAIL/resto cuadran)');
  }

  // ─── 2. PROTOTYPE: criterios aplicables + OUT_OF_COVERAGE del resolver ──
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 1.4.1', status: 'FAIL', severity: 'high' }),
      finding({ heuristicCode: 'N-04', status: 'PASS', recommendation: null }),
    ];
    const report: MinimalReportForExport = {
      passCount: 1,
      failCount: 1,
      coverage: { applicableCriteria: 13, evaluatedCriteria: 2, notEvaluableCriteria: 11, outOfCoverageCriteria: 6 },
      findingPersistencePolicy: 'PASS_PERSISTED',
      geminiModel: 'gemini-2.5-flash',
    };
    const result = buildCriterionExport({ evaluation: prototypeEvaluation(), report, findings });
    const byId = new Map(result.records.map((r) => [r.criterionId, r]));

    assert(result.evaluationType === 'PROTOTYPE', '2a. evaluationType=PROTOTYPE');
    assert(byId.get('WCAG 1.4.1')?.recoveredStatus === 'FAIL confirmado', '2b. WCAG 1.4.1 -> FAIL confirmado');
    assert(byId.get('N-04')?.recoveredStatus === 'PASS confirmado', '2c. N-04 -> PASS confirmado');
    assert(byId.get('WCAG 4.1.2')?.recoveredStatus === 'OUT_OF_COVERAGE', '2d. WCAG 4.1.2 (resolver) -> OUT_OF_COVERAGE');
    assert(byId.get('N-01')?.recoveredStatus === 'OUT_OF_COVERAGE', '2e. N-01 (resolver, requiere antes/después) -> OUT_OF_COVERAGE en prototipos');
    assert(result.records.length === 19, `2f. 13 aplicables + 6 fuera de cobertura = 19 registros, obtenido=${result.records.length}`);
    assert(result.validation.valid === true, '2g. Validación contra Report: válida');
  }

  // ─── 3. Múltiples Findings del mismo criterio, mismo status: consolida sin duplicar registros ──
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', severity: 'medium', description: 'enlace 1' }),
      finding({ wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', severity: 'critical', description: 'enlace 2 (más grave)' }),
    ];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const record = result.records.find((r) => r.criterionId === 'WCAG 2.4.4');

    assert(result.records.filter((r) => r.criterionId === 'WCAG 2.4.4').length === 1, '3a. Un único registro por criterio pese a 2 instancias crudas');
    assert(record?.recoveredStatus === 'FAIL confirmado', '3b. Consolida a FAIL confirmado');
    assert(record?.description === 'enlace 2 (más grave)', '3c. Usa la descripción del FAIL de mayor severidad (critical > medium)');
    assert(Array.isArray(record?.evidence) && record.evidence.length === 2, '3d. Conserva la evidencia de AMBAS instancias (unión, no se descarta)');
  }

  // ─── 4. Múltiples Findings del mismo criterio, status mixto: FAIL > PASS > NOT_EVALUABLE ──
  {
    const findings: MinimalFindingForExport[] = [
      finding({ heuristicCode: 'N-04', status: 'PASS' }),
      finding({ heuristicCode: 'N-04', status: 'FAIL', severity: 'low' }),
    ];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const record = result.records.find((r) => r.criterionId === 'N-04');
    assert(record?.recoveredStatus === 'FAIL confirmado', '4a. FAIL tiene prioridad sobre PASS para el mismo criterio');
  }

  // ─── 5. Evaluación histórica sin findingPersistencePolicy ───────────────
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL' }),
    ];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20 }; // sin findingPersistencePolicy ni geminiModel
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const silentRecord = result.records.find((r) => r.criterionId === 'N-01');

    assert(silentRecord?.recoveredStatus === 'SIN_RESULTADO_RECUPERABLE', '5a. Criterio silencioso en evaluación histórica -> SIN_RESULTADO_RECUPERABLE (nunca PASS)');
    assert(!!silentRecord?.historicalLimitationNote?.includes('histórica'), '5b. La nota identifica explícitamente que es una limitación histórica');
    assert(silentRecord?.geminiModel === null, '5c. geminiModel=null cuando el Report histórico no lo tiene (nunca se infiere)');
    assert(silentRecord?.findingPersistencePolicy === null, '5d. findingPersistencePolicy=null, refleja fielmente la ausencia en el Report');
  }

  // ─── 6. Evaluación incompleta (no terminó exitosamente) ─────────────────
  {
    const findings: MinimalFindingForExport[] = [];
    const report: MinimalReportForExport = { passCount: 0, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({
      evaluation: webEvaluation({ status: 'failed', auditStatus: 'failed' }),
      report,
      findings,
    });
    const anyRecord = result.records.find((r) => r.criterionId === 'N-01');
    assert(anyRecord?.recoveredStatus === 'SIN_RESULTADO_RECUPERABLE', '6a. Evaluación no completada -> SIN_RESULTADO_RECUPERABLE');
    assert(!!anyRecord?.historicalLimitationNote?.includes('no completó'), '6b. La nota distingue explícitamente "no completó" de otras causas');
  }

  // ─── 7. Prohibición absoluta de inferir PASS por ausencia de Finding ────
  {
    const result = buildCriterionExport({ evaluation: webEvaluation(), report: null, findings: [] });
    const anyPass = result.records.some((r) => r.recoveredStatus === 'PASS confirmado');
    assert(!anyPass, '7a. Sin Report ni Findings, NINGÚN criterio se clasifica como PASS confirmado');
    assert(result.validation.valid === false, '7b. Sin Report, la validación se marca explícitamente como no válida');
    assert(result.validation.discrepancies.length > 0, '7c. Se reportan discrepancias explícitas en vez de asumir validez');
  }

  // ─── 8. Discrepancia detectada entre extracción y Report (no se autocorrige) ──
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL' }),
    ];
    // Report con un passCount que NO corresponde a los datos reales.
    const report: MinimalReportForExport = { passCount: 5, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });

    assert(result.validation.valid === false, '8a. Discrepancia PASS detectada -> validación inválida');
    assert(result.validation.passMatchesReport === false, '8b. passMatchesReport=false explícito');
    assert(result.records.length === 20, '8c. Los registros se generan igual (no se ocultan), solo se marca la discrepancia');
    assert(result.validation.discrepancies.some((d) => d.includes('PASS extraído')), '8d. El mensaje de discrepancia es específico y accionable');
  }

  // ─── 9. CSV: cabecera correcta y escape de comas/comillas ───────────────
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: 'WCAG 2.4.4', status: 'FAIL', description: 'Contiene, una coma y "comillas"' }),
    ];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const csv = toCsv([result]);
    const lines = csv.trim().split('\n');

    assert(
      lines[0] === 'evaluationId,evaluationType,criterionId,criterionName,recoveredStatus,evidence,description,recommendation,geminiModel,findingPersistencePolicy,historicalLimitationNote,inAnnexCInstrument,annexCNote,validationStatus,validationDiscrepancies',
      '9a. Cabecera CSV exacta y completa (incluye P1.7.2.3: inAnnexCInstrument/annexCNote/validationStatus/validationDiscrepancies)',
    );
    assert(lines.length === 21, `9b. 1 cabecera + 20 filas (espacio WEB completo), obtenido=${lines.length}`);
    assert(csv.includes('"Contiene, una coma y ""comillas"""'), '9c. Campo con coma y comillas correctamente escapado entre comillas dobles');
  }

  // ─── 10. P1.7.2.3.1: CSV de una evaluación VÁLIDA -- todas sus filas dicen VALID ──
  {
    const findings: MinimalFindingForExport[] = [finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL' })];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const csv = toCsv([result]);
    const lines = csv.trim().split('\n').slice(1);

    assert(result.validation.valid === true, '10a. La evaluación es efectivamente válida');
    assert(lines.every((l) => l.includes(',VALID,')), '10b. TODAS las filas del CSV llevan validationStatus=VALID');
    assert(lines.every((l) => l.endsWith(',')), '10c. validationDiscrepancies vacío en todas las filas (sin discrepancias)');
  }

  // ─── 11. P1.7.2.3.1: CSV de una evaluación INVÁLIDA -- todas sus filas dicen INVALID, con la discrepancia visible ──
  {
    const findings: MinimalFindingForExport[] = [finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL' })];
    const report: MinimalReportForExport = { passCount: 5, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const csv = toCsv([result]);
    const lines = csv.trim().split('\n').slice(1);

    assert(result.validation.valid === false, '11a. La evaluación es efectivamente inválida');
    assert(lines.every((l) => l.includes(',INVALID,')), '11b. TODAS las filas del CSV llevan validationStatus=INVALID -- identificable sin abrir el JSON');
    assert(lines.every((l) => l.includes('PASS extraído')), '11c. La discrepancia concreta aparece en CADA fila de la evaluación inválida');
  }

  // ─── 12. P1.7.2.3.1: CSV con VARIAS evaluaciones y distinta validez -- nunca se mezclan sin identificar ──
  {
    const validResult = buildCriterionExport({
      evaluation: webEvaluation({ id: 'eval-valid' }),
      report: { passCount: 0, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' },
      findings: [],
    });
    const invalidResult = buildCriterionExport({
      evaluation: webEvaluation({ id: 'eval-invalid' }),
      report: { passCount: 99, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' },
      findings: [],
    });
    const csv = toCsv([validResult, invalidResult]);
    const validLines = csv.split('\n').filter((l) => l.startsWith('eval-valid,'));
    const invalidLines = csv.split('\n').filter((l) => l.startsWith('eval-invalid,'));

    assert(validLines.length === 20 && validLines.every((l) => l.includes(',VALID,')), '12a. Las 20 filas de eval-valid dicen VALID');
    assert(invalidLines.length === 20 && invalidLines.every((l) => l.includes(',INVALID,')), '12b. Las 20 filas de eval-invalid dicen INVALID, nunca se confunden con las de eval-valid');
  }

  // ─── 13. P1.7.2.3.1: CSV con discrepancias que contienen comas/comillas/saltos de línea ──
  {
    // Discrepancias sintéticas con comas, comillas y salto de línea deliberados, para probar el
    // escape de `validationDiscrepancies` independientemente de los mensajes fijos de `validateAgainstReport`.
    const fakeResult = {
      evaluationId: 'eval-weird-chars',
      evaluationType: 'WEB' as const,
      records: [],
      validation: {
        valid: false,
        passMatchesReport: false,
        failMatchesReport: null,
        remainderMatchesReport: null,
        discrepancies: ['Discrepancia con, coma y "comillas"', 'Segunda línea\ncon salto'],
      },
    };
    const csv = toCsv([fakeResult]);
    assert(csv.includes('"Discrepancia con, coma y ""comillas""; Segunda línea\ncon salto"'), '13a. validationDiscrepancies con comas/comillas/salto de línea queda correctamente escapado entre comillas dobles en el CSV');
  }

  // ─── 14. P1.7.2.3.1: evaluación sin ningún registro -- su invalidez no desaparece ────
  {
    // Se simula construyendo manualmente un EvaluationExportResult con records=[] (caso defensivo).
    const fakeEmptyResult = {
      evaluationId: 'eval-empty',
      evaluationType: 'WEB' as const,
      records: [],
      validation: { valid: false, passMatchesReport: null, failMatchesReport: null, remainderMatchesReport: null, discrepancies: ['Sin registros'] },
    };
    const csv = toCsv([fakeEmptyResult]);
    const line = csv.split('\n').find((l) => l.startsWith('eval-empty,'));
    assert(!!line, '14a. La evaluación sin registros SÍ genera una fila (placeholder), no desaparece');
    assert(!!line?.includes(',INVALID,'), '14b. Esa fila placeholder conserva visible su invalidez');
  }

  // ─── 15. P1.7.2.3.2: PASS_DISCARDED sin Finding -- nunca PASS, nunca "PASS_PERSISTED" en la nota ──
  {
    const report: MinimalReportForExport = { passCount: 0, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_DISCARDED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings: [] });
    const record = result.records.find((r) => r.criterionId === 'N-04');

    assert(record?.recoveredStatus === 'SIN_RESULTADO_RECUPERABLE', '15a. PASS_DISCARDED sin Finding -> SIN_RESULTADO_RECUPERABLE, nunca PASS');
    assert(!!record?.historicalLimitationNote?.includes('PASS_DISCARDED'), '15b. La nota menciona explícitamente PASS_DISCARDED');
    assert(!record?.historicalLimitationNote?.includes('PASS_PERSISTED'), '15c. La nota NUNCA afirma que la política era PASS_PERSISTED');
  }

  // ─── 16. P1.7.2.3.2: PASS_DISCARDED con Finding explícito -- se conserva el resultado real ──
  {
    const findings: MinimalFindingForExport[] = [finding({ wcagCriterion: 'WCAG 1.4.3 Contraste mínimo', status: 'FAIL', severity: 'high' })];
    const report: MinimalReportForExport = { passCount: 0, failCount: 1, totalCriteria: 20, findingPersistencePolicy: 'PASS_DISCARDED' };
    const result = buildCriterionExport({ evaluation: webEvaluation(), report, findings });
    const record = result.records.find((r) => r.criterionId === 'WCAG 1.4.3');
    assert(record?.recoveredStatus === 'FAIL confirmado', '16a. Un Finding explícito persiste su resultado real aun bajo PASS_DISCARDED');
  }

  // ─── 17. P1.7.2.3.3: evaluación incompleta con Report cuyos conteos "coinciden" -- NUNCA válida ──
  {
    const report: MinimalReportForExport = { passCount: 0, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' };
    const result = buildCriterionExport({
      evaluation: webEvaluation({ status: 'failed', auditStatus: 'failed' }),
      report,
      findings: [],
    });
    assert(result.validation.valid === false, '17a. Evaluación incompleta -> validation.valid=false SIEMPRE, aunque los conteos coincidan por casualidad');
    assert(result.validation.discrepancies.some((d) => d.includes('no completó')), '17b. Se registra una discrepancia explícita que explica la no finalización');
  }

  // ─── 18. P1.7.2.3.4: filas OUT_OF_COVERAGE sin CRI claramente identificadas (solo prototipos) ──
  {
    const result = buildCriterionExport({
      evaluation: prototypeEvaluation(),
      report: { passCount: 0, failCount: 0, coverage: { applicableCriteria: 13, evaluatedCriteria: 0, notEvaluableCriteria: 13, outOfCoverageCriteria: 6 }, findingPersistencePolicy: 'PASS_PERSISTED' },
      findings: [],
    });
    const withoutCri = result.records.filter((r) => !r.inAnnexCInstrument);
    const withCri = result.records.filter((r) => r.inAnnexCInstrument);

    assert(withoutCri.length === 6, `18a. Exactamente 6 criterios marcados inAnnexCInstrument=false, obtenido=${withoutCri.length}`);
    assert(withoutCri.every((r) => r.recoveredStatus === 'OUT_OF_COVERAGE'), '18b. Los 6 sin CRI son precisamente los OUT_OF_COVERAGE');
    assert(withoutCri.every((r) => !!r.annexCNote), '18c. Todos llevan la nota explicativa de exclusión del Anexo C');
    assert(withCri.length === 13 && withCri.every((r) => r.annexCNote === null), '18d. Los 13 aplicables SÍ están en el instrumento (annexCNote=null)');

    // WEB: WCAG 2.1.1/3.2.2 son OUT_OF_COVERAGE pero SÍ tienen código CRI (CRI-05/CRI-08).
    const webResult = buildCriterionExport({
      evaluation: webEvaluation(),
      report: { passCount: 0, failCount: 0, totalCriteria: 20, findingPersistencePolicy: 'PASS_PERSISTED' },
      findings: [],
    });
    assert(webResult.records.every((r) => r.inAnnexCInstrument), '18e. Los 20 criterios WEB están siempre en el Anexo C, incluidos los 2 OUT_OF_COVERAGE (CRI-05/CRI-08)');
  }

  // ─── 19. P0-1: Hallazgos WCAG sin prefijo "WCAG " se asocian a su criterio canónico en la exportación ──
  {
    const findings: MinimalFindingForExport[] = [
      finding({ wcagCriterion: '1.4.1 Uso del color', status: 'PASS', recommendation: null }),
      finding({ wcagCriterion: '1.4.3 Contraste mínimo', status: 'NOT_EVALUABLE', recommendation: null }),
      finding({ heuristicCode: 'N-06', status: 'FAIL', severity: 'high' }),
    ];
    const report: MinimalReportForExport = {
      passCount: 1,
      failCount: 1,
      coverage: { applicableCriteria: 13, evaluatedCriteria: 2, notEvaluableCriteria: 11, outOfCoverageCriteria: 6 },
      findingPersistencePolicy: 'PASS_PERSISTED',
      geminiModel: 'gemini-2.5-flash',
    };
    const result = buildCriterionExport({ evaluation: prototypeEvaluation(), report, findings });
    const byId = new Map(result.records.map((r) => [r.criterionId, r]));

    assert(byId.get('WCAG 1.4.1')?.recoveredStatus === 'PASS confirmado', '19a. "1.4.1 Uso del color" (sin prefijo) se exporta bajo WCAG 1.4.1 como PASS confirmado');
    assert(byId.get('WCAG 1.4.3')?.recoveredStatus === 'NOT_EVALUABLE', '19b. "1.4.3 Contraste mínimo" (sin prefijo) se exporta bajo WCAG 1.4.3 como NOT_EVALUABLE');
    assert(result.validation.valid === true, '19c. La validación contra Report es válida al reconocer los criterios WCAG sin prefijo');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
