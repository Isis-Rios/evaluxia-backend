import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex, checkFindingTraceability } from '@/modules/evaluations/services/evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { aiService } from '@/modules/ai/ai.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { checkWcagCardinality } from '@/shared/testing/wcag-criterion-cardinality';

/**
 * H-REGRESSION-2 — EJECUCIÓN REAL AUTORIZADA (pendiente de autorización
 * explícita; NO se ejecuta automáticamente). Réplica exacta del setup de
 * H-REGRESSION-1 (mismo fixture, mismo pipeline, sin stub -- golpea el
 * GeminiClient real) con UN objetivo adicional específico: validar si el
 * prompt reforzado (regla 4 de ABSOLUTE AUDIT RULE, ver ai.service.ts)
 * evita que Gemini combine varios códigos WCAG dentro de un mismo
 * `wcagCriterion`.
 *
 * IMPORTANTE — separación deliberada de dos preguntas independientes:
 *   1. CONTRACT VALIDATION: ¿cada wcagCriterion contiene como máximo un
 *      código WCAG? (esto es lo que decide el STATUS FINAL de este runner)
 *   2. Ground Truth comparison: sección puramente informativa, reportada
 *      por separado, que NUNCA participa en el STATUS FINAL de
 *      H-REGRESSION-2. Un finding puede respetar el contrato de
 *      cardinalidad y aun así no coincidir con el Ground Truth (o
 *      viceversa) -- son preguntas distintas y este runner no las mezcla.
 */
async function main() {
  console.log('🚨 H-REGRESSION-2 — Ejecución real controlada (1 fixture, 1 evaluación)\n');
  console.log('Objetivo: validar el contrato "1 finding = 1 WCAG criterion" tras el refuerzo del prompt.\n');

  // ---------------------------------------------------------------------
  // PRE-FLIGHT (idéntico a H-REGRESSION-1: mismo fixture, mismo pipeline)
  // ---------------------------------------------------------------------
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-2';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const evidences: EvidenceInput[] = [{
    iteration: 1, url: 'https://fixture.local/forms/login-missing-label.html', screenshotPath: '/x.png',
    headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
    forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    computedStylesCandidates: snapshot.computedStylesCandidates,
  }];

  const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
  const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
  const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
  const prioritization = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });
  const dedupedComputedStyles = prioritization.final;

  const promptInput: any = {
    evaluationId: evalId, title: 'H-REGRESSION-2', url: 'https://fixture.local/forms/login-missing-label.html',
    archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero iniciar sesión rápido', goals: ['Acceder a su cuenta'], frustrations: ['Formularios confusos'] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);

  console.log('========================================');
  console.log('PRE-FLIGHT');
  console.log('========================================');
  console.log(`fixture: forms/login-missing-label.html (idéntico a H-REGRESSION-1)`);
  console.log(`payload chars: ${measurement.chars}`);
  console.log(`payload bytes: ${measurement.bytes}`);
  console.log(`estimated input tokens: ${measurement.estimatedTokens}`);
  console.log(`budget level: ${measurement.level}`);
  console.log(`J2 bloquearía: ${wouldBlock}`);
  console.log(`prompt contiene regla de cardinalidad (rule 4): ${prompt.includes('EXACTLY ONE WCAG code')}`);
  console.log(`prompt contiene instrucción de split por criterio: ${prompt.includes('emit ONE SEPARATE finding per criterion')}`);
  console.log(`computedStylesCandidates: ${snapshot.computedStylesCandidates.length}`);
  console.log(`dedupedComputedStyles (todos, pre-priorización): ${allDeduped.length}`);
  console.log(`final computedStyles (post-priorización, enviados): ${dedupedComputedStyles.length}`);
  console.log(`evidence counts: headings=${snapshot.headings.length} images=${snapshot.images.length} links=${snapshot.links.length} buttons=${snapshot.buttons.length} forms=${snapshot.forms.length}`);
  console.log(`expected Gemini calls: 1`);
  console.log(`deterministic findings (precondición): ${deterministicFindings.length}`);

  if (wouldBlock) {
    console.error('\n⛔ ABORTADO: el payload sería bloqueado por J2 (CRITICAL). No se realiza la llamada real.');
    process.exit(1);
  }
  if (measurement.level !== 'NORMAL' && measurement.level !== 'WARNING') {
    console.error('\n⛔ ABORTADO: nivel de presupuesto inesperado. No se realiza la llamada real.');
    process.exit(1);
  }
  if (!prompt.includes('EXACTLY ONE WCAG code')) {
    console.error('\n⛔ ABORTADO: el prompt no contiene la regla de cardinalidad esperada. No se realiza la llamada real.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // EJECUCIÓN REAL (1 sola llamada) -- SIN stub, SIN mock
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('EJECUTANDO LLAMADA REAL A GEMINI...');
  console.log('========================================\n');

  let auditResult: any = null;
  let executionError: any = null;
  const startTime = Date.now();
  try {
    auditResult = await aiService.performAuditAnalysis(promptInput);
  } catch (err: any) {
    executionError = err;
  }
  const wallClockMs = Date.now() - startTime;

  if (executionError) {
    console.error('\n========================================');
    console.error('H-REGRESSION-2 RESULT');
    console.error('STATUS: FAIL');
    console.error('========================================');
    console.error(`Error: ${executionError?.message || executionError}`);
    console.error(`statusCode: ${executionError?.statusCode ?? 'n/a'}`);
    console.error(`wallClockMs: ${wallClockMs}`);
    console.error('Ejecución detenida per instrucción explícita: sin reintentos manuales.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // GEMINI USAGE
  // ---------------------------------------------------------------------
  console.log('========================================');
  console.log('GEMINI USAGE');
  console.log('========================================');
  console.log(`model: gemini-2.5-flash (env.GEMINI_MODEL)`);
  console.log(`promptTokens: ${auditResult.usage.promptTokens}`);
  console.log(`outputTokens: ${auditResult.usage.outputTokens}`);
  console.log(`totalTokens: ${auditResult.usage.totalTokens}`);
  console.log(`thinkingTokens: ${auditResult.usage.thinkingTokens ?? 'no reportado'}`);
  console.log(`cachedContentTokens: ${auditResult.usage.cachedContentTokens ?? 'no reportado'}`);
  console.log(`toolUsePromptTokens: ${auditResult.usage.toolUsePromptTokens ?? 'no reportado'}`);
  console.log(`executionTimeMs (interno): ${auditResult.executionTimeMs}`);
  console.log(`wallClockMs (total, incluye overhead local): ${wallClockMs}`);
  console.log(`retries: no instrumentado en este runner más allá de "executionError ausente = sin reintentos manuales"`);

  const cost = metricsTracker.calculateCost('gemini-2.5-flash', auditResult.usage.promptTokens, auditResult.usage.outputTokens);
  console.log(`costo calculado por el sistema (prompt+output, tarifa confirmada): $${cost.toFixed(6)} USD`);

  // ---------------------------------------------------------------------
  // RAW FINDINGS
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('RAW RESULT (respuesta de Gemini, sin corregir) — rawFindings');
  console.log('========================================');
  console.log(`overallScore (de Gemini, IGNORADO por AuditEngine): ${auditResult.result.overallScore}`);
  console.log(`executiveSummary:\n${auditResult.result.executiveSummary}`);
  console.log(`\ncantidad total de rawFindings: ${auditResult.result.findings.length}`);
  auditResult.result.findings.forEach((f: any, i: number) => {
    console.log(`\n  [Finding ${i + 1}]`);
    console.log(`    wcagCriterion: ${f.wcagCriterion ?? 'null'}`);
    console.log(`    heuristicCode: ${f.heuristicCode ?? 'null'}`);
    console.log(`    status: ${f.status}`);
    console.log(`    confidence: ${f.confidence}`);
    console.log(`    selector: ${f.affectedElement?.selector ?? 'n/a'}`);
    console.log(`    evidence: ${JSON.stringify(f.evidence)}`);
    console.log(`    recommendation: ${f.recommendation ?? 'n/a'}`);
    console.log(`    description: ${f.description}`);
  });

  // =======================================================================
  // CONTRACT VALIDATION — "1 finding = 1 WCAG criterion"
  // ESTA sección, y solo esta, decide el STATUS FINAL de H-REGRESSION-2.
  // =======================================================================
  console.log('\n========================================');
  console.log('CONTRACT VALIDATION (1 finding = 1 WCAG criterion)');
  console.log('========================================');
  const cardinalityResults = checkWcagCardinality(auditResult.result.findings);
  cardinalityResults.forEach((r) => {
    console.log(
      `  [Finding ${r.index + 1}] selector="${r.selector}" wcagCriterion="${r.wcagCriterion}" ` +
      `codeCount=${r.codeCount} ${r.violatesCardinality ? '❌ VIOLATION (combined criterion)' : '✅ OK (single criterion)'}`,
    );
  });
  const anyCardinalityViolation = cardinalityResults.some((r) => r.violatesCardinality);
  console.log(`\nfindings con wcagCriterion aplicable: ${cardinalityResults.length}`);
  console.log(`violaciones de cardinalidad detectadas: ${cardinalityResults.filter((r) => r.violatesCardinality).length}`);
  console.log(`CONTRATO RESPETADO (0 violaciones): ${!anyCardinalityViolation}`);

  // ---------------------------------------------------------------------
  // EvidenceGate + EVIDENCE TRACEABILITY (idéntico a H-REGRESSION-1)
  // ---------------------------------------------------------------------
  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });
  const validatedAiFindings = evidenceGateService.processAiFindings(auditResult.result.findings, evidenceIndex);

  console.log('\n========================================');
  console.log('EVIDENCE TRACEABILITY');
  console.log('========================================');
  auditResult.result.findings.forEach((f: any, i: number) => {
    const traceability = checkFindingTraceability(f, evidenceIndex);
    const afterGate = validatedAiFindings[i];
    console.log(`  [Finding ${i + 1}] selector="${f.affectedElement?.selector ?? 'n/a'}" traceable=${traceability.traceable} reason="${traceability.reason}"`);
    console.log(`    status original="${f.status}" -> status post-EvidenceGate="${afterGate.status}" ${f.status !== afterGate.status ? '(DEGRADADO)' : '(sin cambio)'}`);
  });
  const traceableCount = auditResult.result.findings.filter((f: any) => checkFindingTraceability(f, evidenceIndex).traceable).length;
  console.log(`\ntraceability: ${traceableCount}/${auditResult.result.findings.length}`);

  // ---------------------------------------------------------------------
  // Consolidación final (determinístico + IA validada) -- consolidatedFindings
  // ---------------------------------------------------------------------
  const allRawFindings: InputAuditFinding[] = [
    ...deterministicFindings.map((df: any) => ({
      findingGroup: df.findingGroup, type: df.type, status: df.status, severity: df.severity, confidence: df.confidence,
      description: df.description, heuristicCode: df.heuristicCode, heuristicName: df.heuristicName, wcagCriterion: df.wcagCriterion,
      evidence: df.evidence, affectedElement: df.affectedElement, impact: df.impact, recommendation: df.recommendation,
      iteration: df.iteration, url: df.url, screenshotUrl: df.screenshotUrl,
    })),
    ...validatedAiFindings.map((f: any) => ({
      findingGroup: f.findingGroup, type: f.type || 'usability', status: f.status || 'FAIL', severity: f.severity,
      confidence: f.confidence || 'high', description: f.description, heuristicCode: f.heuristicCode || undefined,
      heuristicName: f.heuristicName || undefined, heuristic: f.heuristic || undefined, wcagCriterion: f.wcagCriterion || undefined,
      evidence: f.evidence || [], affectedElement: f.affectedElement || undefined, impact: f.impact || undefined,
      recommendation: f.recommendation || undefined, iteration: 1, url: promptInput.url, screenshotUrl: '/uploads/h-regression-2_step_1.png',
    })),
  ];
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);
  console.log(`\nconsolidatedFindings: ${metrics.consolidatedFindings.length}`);

  // =======================================================================
  // GROUND TRUTH COMPARISON — INFORMATIVO ÚNICAMENTE.
  // NO participa en el STATUS FINAL de H-REGRESSION-2 (ver cabecera del
  // archivo). Esto responde "¿coincide con lo esperado?", una pregunta
  // SEMÁNTICA distinta de "¿respeta el contrato de cardinalidad?".
  // =======================================================================
  console.log('\n========================================');
  console.log('GROUND TRUTH COMPARISON (informativo — NO decide el STATUS FINAL)');
  console.log('========================================');
  function statusFor(code: string) {
    return metrics.consolidatedFindings.filter((f: any) => (f.wcagCriterion || '').includes(code)).map((f: any) => f.status);
  }
  console.log(`WCAG 4.1.2 (esperado PASS determinístico): obtenido=${JSON.stringify(statusFor('4.1.2'))}`);
  console.log(`WCAG 1.4.3 (esperado PASS determinístico): obtenido=${JSON.stringify(statusFor('1.4.3'))}`);
  console.log(`WCAG 3.3.2 (esperado FAIL vía IA -- HALLAZGO PRINCIPAL): obtenido=${JSON.stringify(statusFor('3.3.2'))}`);
  console.log(`WCAG 1.1.1 (no debe aparecer como FAIL): obtenido=${JSON.stringify(statusFor('1.1.1'))}`);
  console.log(`WCAG 2.4.4 (no debe aparecer como FAIL): obtenido=${JSON.stringify(statusFor('2.4.4'))}`);

  // ---------------------------------------------------------------------
  // H-REGRESSION-1 COMPARISON (línea base real, valores exactos ya capturados)
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('H-REGRESSION-1 COMPARISON (línea base)');
  console.log('========================================');
  console.log('H-REGRESSION-1 (real, ya ejecutado): promptTokens=3216 outputTokens=3023 thinkingTokens=5691 totalTokens=11930 rawFindings=6 consolidatedFindings=11 combined WCAG criterion=YES traceability=6/6 retries=0');
  console.log(
    `H-REGRESSION-2 (ahora): promptTokens=${auditResult.usage.promptTokens} outputTokens=${auditResult.usage.outputTokens} ` +
    `thinkingTokens=${auditResult.usage.thinkingTokens ?? 'n/a'} totalTokens=${auditResult.usage.totalTokens} ` +
    `rawFindings=${auditResult.result.findings.length} consolidatedFindings=${metrics.consolidatedFindings.length} ` +
    `combined WCAG criterion=${anyCardinalityViolation ? 'YES' : 'NO'} traceability=${traceableCount}/${auditResult.result.findings.length} retries=0`,
  );

  // ---------------------------------------------------------------------
  // STATUS FINAL — basado EXCLUSIVAMENTE en CONTRACT VALIDATION.
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('STATUS FINAL (H-REGRESSION-2)');
  console.log('========================================');
  console.log('Criterio de aceptación: 0 findings con más de un código WCAG en wcagCriterion.');
  console.log('La comparación con Ground Truth es informativa y NO afecta este veredicto.');
  const finalStatus = !anyCardinalityViolation ? 'PASS' : 'FAIL';
  console.log(`\nSTATUS FINAL: ${finalStatus}`);

  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
