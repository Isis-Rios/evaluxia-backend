import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex, checkFindingTraceability } from '@/modules/evaluations/services/evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { checkClaimConsistency, applyClaimConsistency } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { aiService } from '@/modules/ai/ai.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { checkWcagCardinality, applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';

/**
 * H-REGRESSION-3 — EJECUCIÓN REAL AUTORIZADA (1 fixture, 1 evaluación, 0
 * retries). Valida que J1 (selector traceability), cardinality enforcement
 * y J6 (evidence claim consistency) actúan CORRECTAMENTE JUNTAS sobre una
 * respuesta real de Gemini, en el MISMO orden exacto que audit-engine.
 * service.ts (EvidenceGate/J1 -> cardinality -> J6). No usa stub -- golpea
 * el GeminiClient real. No se ejecuta automáticamente.
 */
async function main() {
  console.log('🚨 H-REGRESSION-3 — Ejecución real controlada (1 fixture, 1 evaluación, 0 retries)\n');
  console.log('Objetivo: validar J1 + cardinality enforcement + J6 actuando juntas sobre una respuesta real.\n');

  // ---------------------------------------------------------------------
  // PRE-FLIGHT (idéntico a H-REGRESSION-1/2: mismo fixture, mismo pipeline)
  // ---------------------------------------------------------------------
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-3';
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
    evaluationId: evalId, title: 'H-REGRESSION-3', url: 'https://fixture.local/forms/login-missing-label.html',
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
  console.log(`fixture: forms/login-missing-label.html (idéntico a H-REGRESSION-1/2)`);
  console.log(`payload chars: ${measurement.chars}  estimated input tokens: ${measurement.estimatedTokens}  budget level: ${measurement.level}`);
  console.log(`J2 bloquearía: ${wouldBlock}`);
  console.log(`expected Gemini calls: 1, expected retries: 0`);
  console.log(`deterministic findings (precondición): ${deterministicFindings.length}`);

  if (wouldBlock || (measurement.level !== 'NORMAL' && measurement.level !== 'WARNING')) {
    console.error('\n⛔ ABORTADO: preflight no cumple condiciones seguras. No se realiza la llamada real.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // EJECUCIÓN REAL (1 sola llamada) -- SIN stub, SIN mock, SIN retries manuales
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
    console.error('H-REGRESSION-3 RESULT: FAIL (error durante la única llamada permitida)');
    console.error('========================================');
    console.error(`Error: ${executionError?.message || executionError}`);
    console.error(`statusCode: ${executionError?.statusCode ?? 'n/a'}`);
    console.error(`wallClockMs: ${wallClockMs}`);
    console.error('Ejecución detenida per protocolo: sin reintentos, sin segunda variante.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // 1. RESULTADO RAW DE GEMINI (sin corregir, antes de cualquier defensa)
  // ---------------------------------------------------------------------
  console.log('========================================');
  console.log('1. RESULTADO RAW DE GEMINI');
  console.log('========================================');
  console.log(`overallScore (Gemini, ignorado por AuditEngine): ${auditResult.result.overallScore}`);
  console.log(`executiveSummary:\n${auditResult.result.executiveSummary}\n`);
  const rawFindings = auditResult.result.findings;
  console.log(`rawFindings count: ${rawFindings.length}`);
  rawFindings.forEach((f: any, i: number) => {
    console.log(`\n  [Finding ${i + 1}]`);
    console.log(`    wcagCriterion: ${f.wcagCriterion ?? 'null'}`);
    console.log(`    heuristicCode: ${f.heuristicCode ?? 'null'}`);
    console.log(`    status: ${f.status}  confidence: ${f.confidence}`);
    console.log(`    selector: ${f.affectedElement?.selector ?? 'n/a'}`);
    console.log(`    evidence: ${JSON.stringify(f.evidence)}`);
    console.log(`    recommendation: ${f.recommendation ?? 'n/a'}`);
    console.log(`    description: ${f.description}`);
  });

  // ---------------------------------------------------------------------
  // 2. MÉTRICAS Y TOKENS
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('2. MÉTRICAS Y TOKENS');
  console.log('========================================');
  console.log(`model: gemini-2.5-flash (env.GEMINI_MODEL)`);
  console.log(`promptTokens: ${auditResult.usage.promptTokens}`);
  console.log(`outputTokens: ${auditResult.usage.outputTokens}`);
  console.log(`totalTokens: ${auditResult.usage.totalTokens}`);
  console.log(`thinkingTokens: ${auditResult.usage.thinkingTokens ?? 'no reportado'}`);
  console.log(`cachedContentTokens: ${auditResult.usage.cachedContentTokens ?? 'no reportado'}`);
  console.log(`toolUsePromptTokens: ${auditResult.usage.toolUsePromptTokens ?? 'no reportado'}`);
  console.log(`executionTimeMs (interno): ${auditResult.executionTimeMs}`);
  console.log(`wallClockMs (total): ${wallClockMs}`);
  console.log(`retries: 0 (ausencia de executionError confirma 0 reintentos manuales)`);
  const cost = metricsTracker.calculateCost('gemini-2.5-flash', auditResult.usage.promptTokens, auditResult.usage.outputTokens);
  console.log(`costo calculado (prompt+output, tarifa confirmada): $${cost.toFixed(6)} USD`);

  // ---------------------------------------------------------------------
  // Pipeline: EvidenceGate (incluye J1) -> cardinality enforcement -> J6
  // EXACTAMENTE en el mismo orden que audit-engine.service.ts.
  // ---------------------------------------------------------------------
  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });
  const gatedAiFindings = evidenceGateService.processAiFindings(rawFindings, evidenceIndex);
  const rawCardinality = checkWcagCardinality(rawFindings);
  const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } = applyCardinalityEnforcement(gatedAiFindings);
  const { findings: validatedAiFindings, summary: j6Summary } = applyClaimConsistency(cardinalityCheckedFindings, evidenceIndex);

  // ---------------------------------------------------------------------
  // 3. J1 — SELECTOR TRACEABILITY
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('3. J1 — SELECTOR TRACEABILITY');
  console.log('========================================');
  let traceableCount = 0;
  rawFindings.forEach((f: any, i: number) => {
    const t = checkFindingTraceability(f, evidenceIndex);
    if (t.traceable) traceableCount++;
    const afterGate = gatedAiFindings[i];
    console.log(`  [Finding ${i + 1}] selector="${f.affectedElement?.selector ?? 'n/a'}" traceable=${t.traceable} reason="${t.reason}"`);
    console.log(`    status raw="${f.status}" -> status post-EvidenceGate="${afterGate.status}" ${f.status !== afterGate.status ? '(DEGRADADO)' : '(sin cambio)'}`);
  });
  console.log(`\ntraceability: ${traceableCount}/${rawFindings.length}`);
  const j1Pass = rawFindings.every((f: any, i: number) => {
    if (!f.affectedElement?.selector) return true;
    const t = checkFindingTraceability(f, evidenceIndex);
    return t.traceable || gatedAiFindings[i].status === 'NOT_EVALUABLE';
  });
  console.log(`J1 PASS (todo finding con selector es trazable o fue degradado): ${j1Pass}`);

  // ---------------------------------------------------------------------
  // 4. CARDINALIDAD
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('4. CARDINALIDAD WCAG');
  console.log('========================================');
  console.log(`findings con wcagCriterion aplicable (raw): ${rawCardinality.length}`);
  rawCardinality.forEach((r) => console.log(`  [Finding idx=${r.index}] selector="${r.selector}" codeCount=${r.codeCount} ${r.violatesCardinality ? '❌ VIOLACIÓN (criterio combinado)' : '✅ OK'}`));
  console.log(`\nviolaciones detectadas ANTES del enforcement: ${rawCardinality.filter((r) => r.violatesCardinality).length}`);
  console.log(`violaciones tras applyCardinalityEnforcement (deben ser 0 en el resultado final): ${cardinalitySummary.violations > 0 ? cardinalitySummary.violations : 0}`);
  const postEnforcementCardinality = checkWcagCardinality(cardinalityCheckedFindings);
  const cardinalityPass = postEnforcementCardinality.every((r) => !r.violatesCardinality);
  console.log(`CARDINALIDAD PASS (0 findings finales con >1 código WCAG): ${cardinalityPass}`);

  // ---------------------------------------------------------------------
  // 5. J6 — EVIDENCE CLAIM CONSISTENCY
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('5. J6 — EVIDENCE CLAIM CONSISTENCY');
  console.log('========================================');
  const itemStatusCounts: Record<string, number> = { CONSISTENT: 0, INCONSISTENT: 0, PROPERTY_NOT_FOUND: 0, NOT_CHECKABLE: 0 };
  const overallStatusCounts: Record<string, number> = { CONSISTENT: 0, INCONSISTENT: 0, INSUFFICIENT: 0 };
  cardinalityCheckedFindings.forEach((f: any, i: number) => {
    const check = checkClaimConsistency(f, evidenceIndex);
    overallStatusCounts[check.overallStatus]++;
    console.log(`  [Finding ${i + 1}] selector="${f.affectedElement?.selector ?? 'n/a'}" overallStatus=${check.overallStatus}`);
    check.items.forEach((it) => {
      itemStatusCounts[it.status]++;
      console.log(`      item#${it.itemIndex} property=${it.property ?? 'n/a'} claimedValue=${it.claimedValue ?? 'n/a'} -> ${it.status} (${it.reason})`);
    });
    const afterJ6 = validatedAiFindings[i];
    console.log(`    status post-cardinality="${f.status}" -> status post-J6="${afterJ6.status}" ${f.status !== afterJ6.status ? '(DEGRADADO por J6)' : '(sin cambio)'}`);
  });
  console.log(`\nDistribución de ítems J6: ${JSON.stringify(itemStatusCounts)}`);
  console.log(`Distribución de findings J6 (overallStatus): ${JSON.stringify(overallStatusCounts)}`);
  console.log(`j6Summary: ${JSON.stringify(j6Summary)}`);

  const j6Pass = cardinalityCheckedFindings.every((f: any, i: number) => {
    const check = checkClaimConsistency(f, evidenceIndex);
    const after = validatedAiFindings[i];
    if (check.overallStatus === 'INCONSISTENT') return after.status === 'NOT_EVALUABLE' && after.confidence === 'low';
    return after.status === f.status; // CONSISTENT/INSUFFICIENT nunca degradados
  });
  console.log(`J6 PASS (INCONSISTENT siempre degradado, CONSISTENT/INSUFFICIENT nunca degradado): ${j6Pass}`);

  // ---------------------------------------------------------------------
  // Consolidación final (determinístico + IA validada por las 3 defensas)
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
      recommendation: f.recommendation || undefined, iteration: 1, url: promptInput.url, screenshotUrl: '/uploads/h-regression-3_step_1.png',
    })),
  ];
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);

  // ---------------------------------------------------------------------
  // 6. COMPARACIÓN CON H-REGRESSION-2
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('6. COMPARACIÓN CON H-REGRESSION-2');
  console.log('========================================');
  console.log('H-REGRESSION-2: promptTokens=3365 outputTokens=3798 thinkingTokens=6148 totalTokens=13311 rawFindings=9 consolidatedFindings=14 combined WCAG criterion=NO traceability=9/9');
  console.log(
    `H-REGRESSION-3 (ahora): promptTokens=${auditResult.usage.promptTokens} outputTokens=${auditResult.usage.outputTokens} ` +
    `thinkingTokens=${auditResult.usage.thinkingTokens ?? 'n/a'} totalTokens=${auditResult.usage.totalTokens} ` +
    `rawFindings=${rawFindings.length} consolidatedFindings=${metrics.consolidatedFindings.length} ` +
    `combined WCAG criterion=${rawCardinality.some((r) => r.violatesCardinality) ? 'YES' : 'NO'} traceability=${traceableCount}/${rawFindings.length}`,
  );

  // ---------------------------------------------------------------------
  // 7 y 8. VEREDICTOS
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('7-8. VEREDICTOS');
  console.log('========================================');
  console.log(`A. Cardinalidad: ${cardinalityPass ? 'PASS' : 'FAIL'}`);
  console.log(`B. J1 (selector traceability): ${j1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`C. J6 (evidence claim consistency): ${j6Pass ? 'PASS' : 'FAIL'}`);
  const pipelinePass = cardinalityPass && j1Pass && j6Pass;
  console.log(`\nPIPELINE COMPLETO: ${pipelinePass ? 'PASS' : 'PARTIAL'}`);

  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
