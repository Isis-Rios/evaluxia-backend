import * as fs from 'fs';
import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { aiService } from '@/modules/ai/ai.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { applyClaimConsistency } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { buildH4FindingsReport, summarizeH4Report } from '@/shared/testing/h-regression-analysis';
import { matchFindings } from '@/shared/testing/finding-matching';

/**
 * EXPERIMENTO GEMINI REAL #1 — Landing V1.
 *
 * Observacional/diagnóstico, n=1. UNA sola llamada lógica autorizada a
 * `aiService.performAuditAnalysis`. Reutiliza exactamente el mismo cableado
 * de pipeline que `h-regression-4-runner.ts` (J1/cardinality/J6 reales, sin
 * reimplementar nada) y el mismo fixture/extracción que
 * `landing-v1-local-battery.ts`, agregando el Ground Truth Matcher
 * (`matchFindings`, Fase I.1/I.3) sobre los findings YA consolidados
 * (determinísticos + Gemini), incluyendo ahora el expectedFinding
 * `verifiableBy: 'ai'` (EF-016, antes excluido de la batería local).
 *
 * Requiere LANDING_V1_GEMINI_EXPERIMENT_1_AUTHORIZED=yes -- sin esta
 * variable, el runner se detiene justo antes de la llamada real (mismo
 * mecanismo de seguridad que H-REGRESSION-1..4).
 */
async function main() {
  console.log('🚨 EXPERIMENTO GEMINI REAL #1 — Landing V1 (observacional, n=1)\n');

  // ---------------------------------------------------------------------
  // EXTRACCIÓN (idéntica a landing-v1-local-battery.ts)
  // ---------------------------------------------------------------------
  const fixture = loadFixture('landing/landing-v1.html');
  const evalId = 'landing-v1-real-gemini-1';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const evidences: EvidenceInput[] = [{
    iteration: 1, url: 'https://fixture.local/landing/landing-v1.html', screenshotPath: '/x.png',
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
    evaluationId: evalId, title: 'Landing V1', url: 'https://fixture.local/landing/landing-v1.html',
    archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero entender el producto rápido', goals: ['Evaluar el servicio'], frustrations: ['Interfaces confusas'] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);
  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });

  console.log('========================================');
  console.log('1-3. EXTRACCIÓN / EVIDENCIA');
  console.log('========================================');
  console.log(`headings=${snapshot.headings.length} images=${snapshot.images.length} links=${snapshot.links.length} buttons=${snapshot.buttons.length} forms=${snapshot.forms.length} (elements=${snapshot.forms.reduce((s, f: any) => s + f.elements.length, 0)}) landmarks=${snapshot.landmarks.length} computedStyles=${snapshot.computedStyles.length} computedStylesCandidates=${snapshot.computedStylesCandidates.length} snapshots/iterations=1`);

  console.log('\n========================================');
  console.log('4. DEDUPLICACIÓN / PRIORIZACIÓN');
  console.log('========================================');
  console.log(`dedupedLandmarks=${dedupedLandmarks.length} dedupedLinks=${dedupedLinks.length} dedupedButtons=${dedupedButtons.length} computedStyles: candidatos=${allDeduped.length} final(priorizado)=${dedupedComputedStyles.length}`);

  console.log('\n========================================');
  console.log('5. PAYLOAD AUDIT');
  console.log('========================================');
  console.log(`chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} budget=${measurement.level} J2 bloquearía=${wouldBlock}`);

  console.log('\n========================================');
  console.log('6. REGLAS DETERMINÍSTICAS (baseline, sin cambios)');
  console.log('========================================');
  const byCriterion = new Map<string, { PASS: number; FAIL: number; NOT_EVALUABLE: number }>();
  for (const f of deterministicFindings) {
    const key = f.wcagCriterion || f.heuristicCode || 'unknown';
    const entry = byCriterion.get(key) || { PASS: 0, FAIL: 0, NOT_EVALUABLE: 0 };
    entry[f.status as 'PASS' | 'FAIL' | 'NOT_EVALUABLE']++;
    byCriterion.set(key, entry);
  }
  console.log(`total findings determinísticos: ${deterministicFindings.length}`);
  for (const [k, v] of byCriterion.entries()) console.log(`  ${k}: PASS=${v.PASS} FAIL=${v.FAIL} NOT_EVALUABLE=${v.NOT_EVALUABLE}`);

  // ---------------------------------------------------------------------
  // PRE-FLIGHT CHECKLIST (sección 21 del pedido)
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('PRE-FLIGHT CHECKLIST');
  console.log('========================================');
  console.log(`[x] Payload NORMAL/WARNING: ${measurement.level !== 'CRITICAL'} (level=${measurement.level})`);
  console.log(`[x] J2 does not block: ${!wouldBlock}`);
  console.log(`[${process.env.LANDING_V1_GEMINI_EXPERIMENT_1_AUTHORIZED === 'yes' ? 'x' : ' '}] Exactly one real experiment authorized (env LANDING_V1_GEMINI_EXPERIMENT_1_AUTHORIZED=yes)`);
  console.log('(Landing V1 / Ground Truth / prompt / matcher / J1 / J6 / cardinality unchanged: verificado externamente antes de esta ejecución -- ver reporte.)');

  if (wouldBlock || measurement.level === 'CRITICAL') {
    console.error('\n⛔ BLOCKED: J2 bloquearía este payload (CRITICAL). No se realiza ninguna llamada real.');
    fs.writeFileSync('/tmp/landing-v1-real-gemini-1-result.json', JSON.stringify({ classification: 'BLOCKED', reason: 'J2 would block (CRITICAL payload)', measurement }, null, 2));
    process.exit(1);
  }

  if (process.env.LANDING_V1_GEMINI_EXPERIMENT_1_AUTHORIZED !== 'yes') {
    console.log('\n========================================');
    console.log('DETENIDO ANTES DE GEMINI (preparación, no ejecución)');
    console.log('========================================');
    console.log('Preflight OK pero no autorizado. Se requiere LANDING_V1_GEMINI_EXPERIMENT_1_AUTHORIZED=yes.');
    process.exit(0);
  }

  // =======================================================================
  // EJECUCIÓN REAL (1 sola llamada lógica)
  // =======================================================================
  console.log('\n========================================');
  console.log('EJECUTANDO LA ÚNICA LLAMADA REAL AUTORIZADA A GEMINI...');
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
    console.error('RESULT: FAIL (error durante la única llamada lógica autorizada)');
    console.error('========================================');
    console.error(`Error: ${executionError?.message || executionError}`);
    fs.writeFileSync('/tmp/landing-v1-real-gemini-1-result.json', JSON.stringify({ classification: 'BLOCKED', reason: `execution error: ${executionError?.message || executionError}` }, null, 2));
    process.exit(1);
  }

  const logicalCalls = 1;
  const physicalAttempts = auditResult.retryAccounting?.attempts ?? 1;
  const retries = physicalAttempts - 1;
  const cost = metricsTracker.calculateCost('gemini-2.5-flash', auditResult.usage.promptTokens, auditResult.usage.outputTokens);

  console.log('========================================');
  console.log('3. GEMINI EXECUTION — MÉTRICAS Y TOKENS');
  console.log('========================================');
  console.log(`logical calls: ${logicalCalls}  physical attempts: ${physicalAttempts}  retries: ${retries}  wallClockMs: ${wallClockMs}`);
  console.log(`usage (último intento exitoso): ${JSON.stringify(auditResult.usage)}`);
  if (auditResult.retryAccounting) console.log(`retryAccounting.cumulativeUsage: ${JSON.stringify(auditResult.retryAccounting.cumulativeUsage)}`);
  else console.log('retryAccounting: no disponible.');
  console.log(`costo (promptTokens+outputTokens, tarifa confirmada gemini-2.5-flash): $${cost.toFixed(6)} USD`);
  console.log(`thinking cost excluded / unverified (tarifa de thinkingTokens no confirmada -- metricsTracker.calculateCost no la incluye).`);

  // ---------------------------------------------------------------------
  // Pipeline: J1 -> cardinality -> J6
  // ---------------------------------------------------------------------
  const rawFindings = auditResult.result.findings;
  const gatedFindings = evidenceGateService.processAiFindings(rawFindings, evidenceIndex);
  const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } = applyCardinalityEnforcement(gatedFindings);
  const { findings: validatedFindings, summary: j6ApplySummary } = applyClaimConsistency(cardinalityCheckedFindings, evidenceIndex);

  const findingsReport = buildH4FindingsReport(rawFindings, evidenceIndex, gatedFindings, cardinalityCheckedFindings, validatedFindings);
  const h4 = summarizeH4Report(findingsReport);

  const traceableCount = findingsReport.filter((f) => f.traceable).length;
  const untraceableCount = findingsReport.filter((f) => !f.traceable).length;
  const degradedByGateCount = findingsReport.filter((f) => f.degradedByGate).length;
  const degradedByCardinalityCount = findingsReport.filter((f) => f.degradedByCardinality).length;
  const degradedByJ6Count = findingsReport.filter((f) => f.degradedByJ6).length;

  console.log('\n========================================');
  console.log('4. RAW FINDINGS');
  console.log('========================================');
  console.log(`cantidad: ${rawFindings.length}`);

  console.log('\n========================================');
  console.log('5. J1 (Evidence Traceability)');
  console.log('========================================');
  console.log(`findings=${rawFindings.length} traceable=${traceableCount} untraceable=${untraceableCount} degradedByGate=${degradedByGateCount}`);

  console.log('\n========================================');
  console.log('6. CARDINALITY');
  console.log('========================================');
  console.log(`findings=${cardinalityCheckedFindings.length} violations=${cardinalitySummary.violations} degradedByCardinality=${degradedByCardinalityCount}`);

  console.log('\n========================================');
  console.log('7. J6 (Claim Consistency)');
  console.log('========================================');
  console.log(`j6ItemCounts (por ítem de evidencia): ${JSON.stringify(h4.j6ItemCounts)}`);
  console.log(`j6FindingCounts (por finding, overallStatus): ${JSON.stringify(h4.j6FindingCounts)}`);
  console.log(`degradedByJ6 (status cambiado por applyClaimConsistency): ${degradedByJ6Count}`);
  console.log(`applyClaimConsistency summary: ${JSON.stringify(j6ApplySummary)}`);
  if (h4.inconsistentFindings.length > 0) {
    console.log('inconsistentFindings:');
    h4.inconsistentFindings.forEach((f) => console.log(`  ${JSON.stringify(f)}`));
  }

  // ---------------------------------------------------------------------
  // Consolidación final (determinísticos + Gemini post-J1/cardinality/J6)
  // ---------------------------------------------------------------------
  const allRawFindings: InputAuditFinding[] = [
    ...deterministicFindings.map((df: any) => ({
      findingGroup: df.findingGroup, type: df.type, status: df.status, severity: df.severity, confidence: df.confidence,
      description: df.description, heuristicCode: df.heuristicCode, heuristicName: df.heuristicName, wcagCriterion: df.wcagCriterion,
      evidence: df.evidence, affectedElement: df.affectedElement, impact: df.impact, recommendation: df.recommendation,
      iteration: df.iteration, url: df.url, screenshotUrl: df.screenshotUrl, origin: 'deterministic' as const,
    })),
    ...validatedFindings.map((f: any) => ({
      findingGroup: f.findingGroup, type: f.type || 'usability', status: f.status || 'FAIL', severity: f.severity,
      confidence: f.confidence || 'high', description: f.description, heuristicCode: f.heuristicCode || undefined,
      heuristicName: f.heuristicName || undefined, heuristic: f.heuristic || undefined, wcagCriterion: f.wcagCriterion || undefined,
      evidence: f.evidence || [], affectedElement: f.affectedElement || undefined, impact: f.impact || undefined,
      recommendation: f.recommendation || undefined, iteration: 1, url: promptInput.url, screenshotUrl: '/uploads/landing-v1-real-gemini-1_step_1.png',
      origin: 'ai' as const,
    })),
  ];
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);

  console.log('\n========================================');
  console.log('8. CONSOLIDATION');
  console.log('========================================');
  console.log(`consolidatedFindings: ${metrics.consolidatedFindings.length} (input: ${deterministicFindings.length} determinísticos + ${validatedFindings.length} Gemini post-J1/cardinality/J6)`);
  console.log(`overallScore: ${metrics.overallScore}`);
  console.log(`wcagMetrics: ${JSON.stringify(metrics.wcagMetrics)}`);
  console.log(`nielsenMetrics: ${JSON.stringify(metrics.nielsenMetrics)}`);

  // ---------------------------------------------------------------------
  // Ground Truth Matcher — AHORA con el set COMPLETO de expectedFindings
  // (incluye EF-016, verifiableBy='ai'), sobre los findings consolidados.
  // ---------------------------------------------------------------------
  const expectedFindings = fixture.groundTruth.expectedFindings || [];
  const gtSummary = matchFindings(expectedFindings, metrics.consolidatedFindings as any, evidenceIndex);

  console.log('\n========================================');
  console.log('9. GROUND TRUTH MATCHER (set completo, incluye verifiableBy=ai)');
  console.log('========================================');
  console.log(`expectedFindings totales: ${expectedFindings.length}`);
  console.log(`Conteos: ${JSON.stringify(gtSummary.counts, null, 2)}`);
  console.log(`Métricas: precision=${gtSummary.metrics.precision} recall=${gtSummary.metrics.recall} f1=${gtSummary.metrics.f1}`);
  console.log('\n--- Cobertura por expectedFinding ---');
  for (const c of gtSummary.coverage) {
    console.log(`  ${c.expectedFindingId}: ${c.status}${c.matchedFindingIndex !== undefined ? ` (finding consolidado #${c.matchedFindingIndex})` : ''}`);
  }
  console.log('\n--- Resultados por finding consolidado ---');
  gtSummary.results.forEach((r) => {
    const f: any = metrics.consolidatedFindings[r.findingIndex];
    console.log(`  #${r.findingIndex} selector=${f?.affectedElement?.selector} criterion=${f?.wcagCriterion} status=${f?.status} -> classification=${r.classification} matched=${r.matchedExpectedFindingId ?? 'n/a'} reason=${r.reason}`);
  });

  // ---------------------------------------------------------------------
  // DUMP COMPLETO A JSON (sin resumir/alterar ningún valor original)
  // ---------------------------------------------------------------------
  const dump = {
    classification: 'OBSERVATIONAL_SUCCESS',
    preflight: { payloadLevel: measurement.level, wouldBlock, chars: measurement.chars, bytes: measurement.bytes, estimatedTokens: measurement.estimatedTokens },
    extraction: {
      headings: snapshot.headings.length, images: snapshot.images.length, links: snapshot.links.length,
      buttons: snapshot.buttons.length, forms: snapshot.forms.length, formElements: snapshot.forms.reduce((s: number, f: any) => s + f.elements.length, 0),
      landmarks: snapshot.landmarks.length, computedStyles: snapshot.computedStyles.length, computedStylesCandidates: snapshot.computedStylesCandidates.length,
    },
    gemini: {
      model: 'gemini-2.5-flash', logicalCalls, physicalAttempts, retries, wallClockMs,
      usage: auditResult.usage, retryAccounting: auditResult.retryAccounting ?? null, costUsd: cost,
      thinkingCostNote: 'thinking cost excluded / unverified',
    },
    rawFindings,
    deterministicFindings,
    findingsReport,
    j6Summary: { j6ItemCounts: h4.j6ItemCounts, j6FindingCounts: h4.j6FindingCounts, inconsistentFindings: h4.inconsistentFindings },
    cardinalitySummary,
    traceability: { traceableCount, untraceableCount, degradedByGateCount, degradedByCardinalityCount, degradedByJ6Count },
    consolidatedFindings: metrics.consolidatedFindings,
    wcagMetrics: metrics.wcagMetrics,
    nielsenMetrics: metrics.nielsenMetrics,
    overallScore: metrics.overallScore,
    expectedFindings,
    gtSummary,
  };
  fs.writeFileSync('/tmp/landing-v1-real-gemini-1-result.json', JSON.stringify(dump, null, 2));

  console.log('\n========================================');
  console.log('RESUMEN FINAL');
  console.log('========================================');
  console.log(`Gemini calls: 1 (lógica) / ${physicalAttempts} (física/s)`);
  console.log(`Dump completo escrito en: /tmp/landing-v1-real-gemini-1-result.json`);
  console.log('CLASIFICACIÓN: OBSERVATIONAL_SUCCESS');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ crashed:', e);
  try {
    fs.writeFileSync('/tmp/landing-v1-real-gemini-1-result.json', JSON.stringify({ classification: 'BLOCKED', reason: `crash: ${e?.message || e}` }, null, 2));
  } catch {}
  process.exit(1);
});
