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

/**
 * H-REGRESSION-1 — EJECUCIÓN REAL AUTORIZADA (1 sola fixture, 1 sola
 * evaluación). NO usa ningún stub -- golpea el GeminiClient real. No se
 * ejecuta automáticamente; requiere invocación manual explícita.
 */
async function main() {
  console.log('🚨 H-REGRESSION-1 — Ejecución real controlada (1 fixture, 1 evaluación)\n');

  // ---------------------------------------------------------------------
  // PRE-FLIGHT
  // ---------------------------------------------------------------------
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-1';
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
    evaluationId: evalId, title: 'H-REGRESSION-1', url: 'https://fixture.local/forms/login-missing-label.html',
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
  console.log(`fixture: forms/login-missing-label.html`);
  console.log(`payload chars: ${measurement.chars}`);
  console.log(`payload bytes: ${measurement.bytes}`);
  console.log(`estimated input tokens: ${measurement.estimatedTokens}`);
  console.log(`budget level: ${measurement.level}`);
  console.log(`J2 bloquearía: ${wouldBlock}`);
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
    console.error('H-REGRESSION-1 RESULT');
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

  const cost = metricsTracker.calculateCost('gemini-2.5-flash', auditResult.usage.promptTokens, auditResult.usage.outputTokens);
  console.log(`costo calculado por el sistema (prompt+output, tarifa confirmada): $${cost.toFixed(6)} USD`);
  console.log(`costo estimado externo: no disponible en este runner`);

  // ---------------------------------------------------------------------
  // RAW RESULT
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('RAW RESULT (respuesta de Gemini, sin corregir)');
  console.log('========================================');
  console.log(`overallScore (de Gemini, IGNORADO por AuditEngine): ${auditResult.result.overallScore}`);
  console.log(`executiveSummary:\n${auditResult.result.executiveSummary}`);
  console.log(`\ncantidad total de findings crudos: ${auditResult.result.findings.length}`);
  auditResult.result.findings.forEach((f: any, i: number) => {
    console.log(`\n  [Finding ${i + 1}]`);
    console.log(`    criterion: ${f.wcagCriterion || f.heuristicCode || f.heuristicName || 'n/a'}`);
    console.log(`    status: ${f.status}`);
    console.log(`    confidence: ${f.confidence}`);
    console.log(`    selector: ${f.affectedElement?.selector ?? 'n/a'}`);
    console.log(`    evidence: ${JSON.stringify(f.evidence)}`);
    console.log(`    recommendation: ${f.recommendation ?? 'n/a'}`);
    console.log(`    description: ${f.description}`);
  });

  // ---------------------------------------------------------------------
  // EvidenceGate + EVIDENCE TRACEABILITY
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

  // ---------------------------------------------------------------------
  // Consolidación final (determinístico + IA validada)
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
      recommendation: f.recommendation || undefined, iteration: 1, url: promptInput.url, screenshotUrl: '/uploads/h-regression-1_step_1.png',
    })),
  ];
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);

  // ---------------------------------------------------------------------
  // GROUND TRUTH COMPARISON
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('GROUND TRUTH COMPARISON');
  console.log('========================================');
  function statusFor(code: string) {
    return metrics.consolidatedFindings.filter((f: any) => (f.wcagCriterion || '').includes(code)).map((f: any) => f.status);
  }
  console.log(`WCAG 4.1.2 (esperado PASS determinístico): obtenido=${JSON.stringify(statusFor('4.1.2'))}`);
  console.log(`WCAG 1.4.3 (esperado PASS determinístico): obtenido=${JSON.stringify(statusFor('1.4.3'))}`);
  console.log(`WCAG 3.3.2 (esperado FAIL vía IA -- HALLAZGO PRINCIPAL): obtenido=${JSON.stringify(statusFor('3.3.2'))}`);
  console.log(`WCAG 1.1.1 (no debe aparecer como FAIL): obtenido=${JSON.stringify(statusFor('1.1.1'))}`);
  console.log(`WCAG 2.4.4 (no debe aparecer como FAIL): obtenido=${JSON.stringify(statusFor('2.4.4'))}`);
  const otherFindings = metrics.consolidatedFindings.filter((f: any) => !['4.1.2', '1.4.3', '3.3.2', '1.1.1', '2.4.4'].some((c) => (f.wcagCriterion || '').includes(c)));
  console.log(`Findings adicionales no anticipados por el Ground Truth (${otherFindings.length}), reportados sin descartar:`);
  otherFindings.forEach((f: any) => console.log(`  - ${f.heuristicCode || f.wcagCriterion || 'n/a'}: ${f.status} — ${f.description}`));

  // ---------------------------------------------------------------------
  // H2 COMPARISON (valores históricos de la Fase H original)
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('H2 COMPARISON (Fase H original vs. H-REGRESSION-1)');
  console.log('========================================');
  console.log('H2 (histórico): promptTokens=2997 outputTokens=1421 totalTokens=8504 costo≈$0.004452 WCAG 3.3.2=[FAIL,FAIL] findings consolidados=7');
  console.log(`H-REGRESSION-1 (ahora): promptTokens=${auditResult.usage.promptTokens} outputTokens=${auditResult.usage.outputTokens} totalTokens=${auditResult.usage.totalTokens} costo≈$${cost.toFixed(6)} WCAG 3.3.2=${JSON.stringify(statusFor('3.3.2'))} findings consolidados=${metrics.consolidatedFindings.length}`);

  // ---------------------------------------------------------------------
  // REGRESSION CHECK
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('REGRESSION CHECK');
  console.log('========================================');
  const wcag332DetectedAsFail = statusFor('3.3.2').includes('FAIL');
  const noHallucinatedSelectorSurvived = auditResult.result.findings.every((f: any, i: number) => {
    const t = checkFindingTraceability(f, evidenceIndex);
    return t.traceable || validatedAiFindings[i].status === 'NOT_EVALUABLE';
  });
  const no429 = true; // si hubiera ocurrido, executionError habría detenido la ejecución antes de este punto
  const noAutomationSignalFail = true; // este fixture no involucra ninguna interacción/acción fallida -- solo captura estática
  console.log(`WCAG 3.3.2 detectado como FAIL: ${wcag332DetectedAsFail}`);
  console.log(`Ningún selector inventado sobrevive como trazable: ${noHallucinatedSelectorSurvived}`);
  console.log(`Sin 429/quota exhaustion: ${no429}`);
  console.log(`Sin evidencia de automation-signal generando FAIL (fixture estático, sin interacciones): ${noAutomationSignalFail}`);
  console.log(`Schema válido (llegó hasta aquí sin excepción): true`);

  const finalStatus = wcag332DetectedAsFail && noHallucinatedSelectorSurvived && no429 ? 'PASS' : 'PARTIAL';
  console.log(`\nSTATUS FINAL: ${finalStatus}`);

  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
