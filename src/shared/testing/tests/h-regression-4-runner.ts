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

/**
 * H-REGRESSION-4 — EXPERIMENTO PREPARADO, NO EJECUTADO.
 *
 * OBJETIVO EXPERIMENTAL ÚNICO: observar si Gemini REAL produce, de forma
 * espontánea, al menos un finding cuya evidencia citada (property/value)
 * sea objetivamente inconsistente con la evidencia real enviada, y si J6
 * (EvidenceGate/J1 -> cardinality -> J6 -> metrics) la detecta y degrada
 * correctamente. NO busca medir precisión/calidad/mejora de Gemini -- ver
 * cabecera del diseño para la lista explícita de lo que este experimento
 * NO intenta demostrar.
 *
 * Mismo fixture que H-REGRESSION-1/2/3 (forms/login-missing-label.html):
 * ya demostró en 3 ejecuciones reales previas ofrecer suficiente superficie
 * verificable (ariaLabel/label/placeholder/name, todos null/valores reales
 * conocidos) -- no se crea un fixture nuevo.
 *
 * CRÍTICO: este archivo NO fue ejecutado como parte de su propia
 * preparación. Contiene la llamada real a Gemini (igual que los runners
 * H1-H3), pero requiere autorización explícita y separada antes de
 * invocarse con `ts-node`.
 */
async function main() {
  console.log('🚨 H-REGRESSION-4 — Experimento preparado (1 fixture, 1 llamada lógica planeada)\n');
  console.log('Pregunta experimental: ¿Gemini real produce una afirmación property/value objetivamente inconsistente, y J6 la detecta?\n');

  // ---------------------------------------------------------------------
  // PRE-FLIGHT
  // ---------------------------------------------------------------------
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-4';
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
    evaluationId: evalId, title: 'H-REGRESSION-4', url: 'https://fixture.local/forms/login-missing-label.html',
    archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero iniciar sesión rápido', goals: ['Acceder a su cuenta'], frustrations: ['Formularios confusos'] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);

  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });

  console.log('========================================');
  console.log('PRE-FLIGHT');
  console.log('========================================');
  console.log(`fixture: forms/login-missing-label.html`);
  console.log(`snapshots: 1`);
  console.log(`evidence counts: headings=${snapshot.headings.length} images=${snapshot.images.length} links=${snapshot.links.length} buttons=${snapshot.buttons.length} forms=${snapshot.forms.length} landmarks=${snapshot.landmarks.length}`);
  console.log(`payload chars: ${measurement.chars}  bytes: ${measurement.bytes}  estimated tokens: ${measurement.estimatedTokens}`);
  console.log(`budget status: ${measurement.level}`);
  console.log(`J2 bloquearía: ${wouldBlock}`);
  console.log(`expected logical Gemini calls (si se autoriza): 1`);

  // ---------------------------------------------------------------------
  // SNAPSHOT BASELINE — evidencia real, EXACTAMENTE como la ve J6 (no se
  // inventa ningún valor; se listan los pares selector/kind/property/value
  // que existen en el EvidenceIndex ya construido arriba).
  // ---------------------------------------------------------------------
  console.log('\n========================================');
  console.log('SNAPSHOT BASELINE (evidencia real para contraste -- lo que J6 podrá comprobar)');
  console.log('========================================');
  for (const [selector, entry] of evidenceIndex.entries()) {
    for (const occ of entry.occurrences) {
      const record = (occ as any).record as Record<string, unknown>;
      console.log(`  selector="${selector}" kind=${occ.kind} record=${JSON.stringify(record)}`);
    }
  }

  if (wouldBlock || (measurement.level !== 'NORMAL' && measurement.level !== 'WARNING')) {
    console.error('\n⛔ ABORTADO: el payload sería bloqueado por J2 (CRITICAL). No se realizaría ninguna llamada real.');
    process.exit(1);
  }

  // =======================================================================
  // DETENCIÓN OBLIGATORIA ANTES DE GEMINI (H-REGRESSION-4 preparation task)
  //
  // El código de la llamada real existe más abajo (idéntico en estructura a
  // H-REGRESSION-1/2/3), pero esta tarea de preparación NO autoriza
  // ejecutarlo. Este runner se detiene aquí deliberadamente cuando la
  // variable de entorno de autorización explícita no está presente --
  // nunca se ejecuta la llamada real como efecto colateral de una
  // preparación/prueba de este archivo.
  // =======================================================================
  if (process.env.H_REGRESSION_4_AUTHORIZED !== 'yes') {
    console.log('\n========================================');
    console.log('DETENIDO ANTES DE GEMINI (preparación, no ejecución)');
    console.log('========================================');
    console.log('Este runner está preparado (preflight + baseline OK) pero NO fue autorizado a llamar a Gemini real.');
    console.log('Para ejecutar la única llamada real autorizada, se requiere una instrucción explícita separada.');
    process.exit(0);
  }

  // ---------------------------------------------------------------------
  // EJECUCIÓN REAL (1 sola llamada lógica) -- SIN stub, SIN mock.
  // Requiere H_REGRESSION_4_AUTHORIZED=yes (ver detención arriba).
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
    console.error('H-REGRESSION-4 RESULT: FAIL (error durante la única llamada lógica autorizada)');
    console.error('========================================');
    console.error(`Error: ${executionError?.message || executionError}`);
    console.error('Sin reintentos manuales, sin segunda ejecución.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // RETRY ACCOUNTING — distinguir llamadas lógicas de intentos físicos
  // ---------------------------------------------------------------------
  const logicalCalls = 1;
  const physicalAttempts = auditResult.retryAccounting?.attempts ?? 1;
  const retries = physicalAttempts - 1;

  console.log('========================================');
  console.log('MÉTRICAS Y TOKENS');
  console.log('========================================');
  console.log(`logical calls: ${logicalCalls}`);
  console.log(`physical attempts: ${physicalAttempts}`);
  console.log(`retries: ${retries}`);
  console.log(`usage (último intento exitoso): promptTokens=${auditResult.usage.promptTokens} outputTokens=${auditResult.usage.outputTokens} totalTokens=${auditResult.usage.totalTokens} thinkingTokens=${auditResult.usage.thinkingTokens ?? 'no reportado'} cachedContentTokens=${auditResult.usage.cachedContentTokens ?? 'no reportado'}`);
  if (auditResult.retryAccounting) {
    const cu = auditResult.retryAccounting.cumulativeUsage;
    console.log(`retryAccounting.cumulativeUsage (todos los intentos observables): promptTokens=${cu.promptTokens} outputTokens=${cu.outputTokens} totalTokens=${cu.totalTokens} thinkingTokens=${cu.thinkingTokens ?? 'no reportado'} cachedContentTokens=${cu.cachedContentTokens ?? 'no reportado'}`);
  } else {
    console.log('retryAccounting: no disponible (no se pudo observar usage en ningún intento).');
  }
  const cost = metricsTracker.calculateCost('gemini-2.5-flash', auditResult.usage.promptTokens, auditResult.usage.outputTokens);
  console.log(`costo calculado (solo intento final, tarifa confirmada): $${cost.toFixed(6)} USD`);
  console.log(`wallClockMs: ${wallClockMs}`);

  // ---------------------------------------------------------------------
  // Pipeline: EvidenceGate (incluye J1) -> cardinality -> J6
  // ---------------------------------------------------------------------
  const rawFindings = auditResult.result.findings;
  const gatedFindings = evidenceGateService.processAiFindings(rawFindings, evidenceIndex);
  const { findings: cardinalityCheckedFindings } = applyCardinalityEnforcement(gatedFindings);
  const { findings: validatedFindings } = applyClaimConsistency(cardinalityCheckedFindings, evidenceIndex);

  console.log('\n========================================');
  console.log('FINDINGS POR ETAPA');
  console.log('========================================');
  console.log(`raw: ${rawFindings.length}  post-J1(gate): ${gatedFindings.length}  post-cardinality: ${cardinalityCheckedFindings.length}  post-J6(final): ${validatedFindings.length}`);

  // ---------------------------------------------------------------------
  // H4 ANALYSIS — reutiliza EXACTAMENTE la misma función que los mocks ya probaron
  // ---------------------------------------------------------------------
  const findingsReport = buildH4FindingsReport(rawFindings, evidenceIndex, gatedFindings, cardinalityCheckedFindings, validatedFindings);
  const h4 = summarizeH4Report(findingsReport);

  console.log('\n========================================');
  console.log('J6 SUMMARY');
  console.log('========================================');
  console.log(`j6ItemCounts: ${JSON.stringify(h4.j6ItemCounts)}`);
  console.log(`j6FindingCounts: ${JSON.stringify(h4.j6FindingCounts)}`);
  if (h4.inconsistentFindings.length > 0) {
    console.log('\ninconsistentFindings:');
    h4.inconsistentFindings.forEach((f) => console.log(`  ${JSON.stringify(f)}`));
  }

  // ---------------------------------------------------------------------
  // Consolidación final + verificación de que las métricas no reviven nada
  // ---------------------------------------------------------------------
  const allRawFindings: InputAuditFinding[] = [
    ...deterministicFindings.map((df: any) => ({
      findingGroup: df.findingGroup, type: df.type, status: df.status, severity: df.severity, confidence: df.confidence,
      description: df.description, heuristicCode: df.heuristicCode, heuristicName: df.heuristicName, wcagCriterion: df.wcagCriterion,
      evidence: df.evidence, affectedElement: df.affectedElement, impact: df.impact, recommendation: df.recommendation,
      iteration: df.iteration, url: df.url, screenshotUrl: df.screenshotUrl,
    })),
    ...validatedFindings.map((f: any) => ({
      findingGroup: f.findingGroup, type: f.type || 'usability', status: f.status || 'FAIL', severity: f.severity,
      confidence: f.confidence || 'high', description: f.description, heuristicCode: f.heuristicCode || undefined,
      heuristicName: f.heuristicName || undefined, heuristic: f.heuristic || undefined, wcagCriterion: f.wcagCriterion || undefined,
      evidence: f.evidence || [], affectedElement: f.affectedElement || undefined, impact: f.impact || undefined,
      recommendation: f.recommendation || undefined, iteration: 1, url: promptInput.url, screenshotUrl: '/uploads/h-regression-4_step_1.png',
    })),
  ];
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);

  console.log('\n========================================');
  console.log('VERIFICACIÓN: METRICS NO REVIVEN NINGÚN FINDING DEGRADADO');
  console.log('========================================');
  let metricsReviveViolation = false;
  for (const inc of h4.inconsistentFindings) {
    const consolidated = metrics.consolidatedFindings.filter((f: any) => f.affectedElement?.selector === inc.selector);
    const revived = consolidated.some((f: any) => f.status === 'FAIL');
    if (revived) metricsReviveViolation = true;
    console.log(`  selector="${inc.selector}": consolidatedFindings.status=${JSON.stringify(consolidated.map((f: any) => f.status))} revived=${revived}`);
  }

  console.log('\n========================================');
  console.log('VEREDICTO H-REGRESSION-4');
  console.log('========================================');
  console.log(h4.verdictReason);
  const finalVerdict = metricsReviveViolation ? 'FAIL' : h4.verdict;
  if (metricsReviveViolation) {
    console.log('⚠️ Al menos un finding degradado por J6/cardinalidad fue "revivido" como FAIL en las métricas consolidadas.');
  }
  console.log(`\nVEREDICTO FINAL: ${finalVerdict}`);

  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
