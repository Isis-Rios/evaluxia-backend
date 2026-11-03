import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { aiService } from '@/modules/ai/ai.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { matchFindings } from '@/shared/testing/finding-matching';

/**
 * Fase I.3 — Landing V1, batería LOCAL/DETERMINÍSTICA. CERO Gemini: se
 * construye el prompt de Fase 2 únicamente para medir el Payload Audit
 * (measurePayload), nunca se invoca `aiService.performAuditAnalysis` ni
 * ninguna llamada real. Solo findings determinísticos son evaluados contra
 * el Ground Truth (`expectedFindings[]`, Fase I.1).
 */
async function main() {
  console.log('🧪 Fase I.3 — Landing V1 — Batería local (0 Gemini)\n');

  const fixture = loadFixture('landing/landing-v1.html');
  const evalId = 'landing-v1-local-battery';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const evidences: EvidenceInput[] = [{
    iteration: 1, url: 'https://fixture.local/landing/landing-v1.html', screenshotPath: '/x.png',
    headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
    forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    computedStylesCandidates: snapshot.computedStylesCandidates,
  }];

  console.log('========================================');
  console.log('1-3. EXTRACCIÓN / EVIDENCIA');
  console.log('========================================');
  console.log(`headings=${snapshot.headings.length} images=${snapshot.images.length} links=${snapshot.links.length} buttons=${snapshot.buttons.length} forms=${snapshot.forms.length} (elements=${snapshot.forms.reduce((s, f: any) => s + f.elements.length, 0)}) landmarks=${snapshot.landmarks.length} computedStyles=${snapshot.computedStyles.length} computedStylesCandidates=${snapshot.computedStylesCandidates.length}`);

  const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
  const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
  const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
  const prioritization = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });
  const dedupedComputedStyles = prioritization.final;

  console.log('\n========================================');
  console.log('4. DEDUPLICACIÓN / PRIORIZACIÓN');
  console.log('========================================');
  console.log(`dedupedLandmarks=${dedupedLandmarks.length} dedupedLinks=${dedupedLinks.length} dedupedButtons=${dedupedButtons.length}`);
  console.log(`computedStyles: candidatos=${allDeduped.length} final(priorizado)=${dedupedComputedStyles.length}`);

  console.log('\n========================================');
  console.log('5. PAYLOAD AUDIT (medido, sin llamar a Gemini)');
  console.log('========================================');
  const promptInput: any = {
    evaluationId: evalId, title: 'Landing V1', url: 'https://fixture.local/landing/landing-v1.html',
    archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero entender el producto rápido', goals: ['Evaluar el servicio'], frustrations: ['Interfaces confusas'] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);
  console.log(`payload chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} budget=${measurement.level} J2 bloquearía=${wouldBlock}`);

  console.log('\n========================================');
  console.log('6. REGLAS DETERMINÍSTICAS');
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

  console.log('\n========================================');
  console.log('7-9. GROUND TRUTH MATCHER (J1 trazabilidad + Ground Truth, vía EvidenceIndex real)');
  console.log('========================================');
  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });
  const expectedFindings = fixture.groundTruth.expectedFindings || [];
  const deterministicOnly = expectedFindings.filter((e) => e.verifiableBy !== 'ai');
  const summary = matchFindings(deterministicOnly, deterministicFindings as any, evidenceIndex);

  console.log(`expectedFindings totales en GT: ${expectedFindings.length} (verifiableBy='ai', excluidos de esta batería local: ${expectedFindings.length - deterministicOnly.length})`);
  console.log(`\nConteos: ${JSON.stringify(summary.counts, null, 2)}`);
  console.log(`\nMétricas: precision=${summary.metrics.precision} recall=${summary.metrics.recall} f1=${summary.metrics.f1}`);

  console.log('\n--- Detalle por expectedFinding (coverage) ---');
  for (const c of summary.coverage) {
    console.log(`  ${c.expectedFindingId}: ${c.status}${c.matchedFindingIndex !== undefined ? ` (finding real #${c.matchedFindingIndex})` : ''}`);
  }

  console.log('\n--- Findings reales sin corresponder a ningún expectedFinding (UNMATCHED) ---');
  const unmatched = summary.results.filter((r) => r.classification === 'UNMATCHED');
  unmatched.forEach((r) => {
    const f = deterministicFindings[r.findingIndex];
    console.log(`  #${r.findingIndex} selector=${f.affectedElement?.selector} criterion=${f.wcagCriterion} status=${f.status} -- fuera del alcance de este GT, no juzgable.`);
  });

  const anyFP = summary.results.filter((r) => r.classification === 'FP');
  console.log(`\n--- Falsos positivos detectados: ${anyFP.length} ---`);
  anyFP.forEach((r) => console.log(`  ${JSON.stringify(r)}`));

  console.log('\n========================================');
  console.log('10-11. CONSOLIDACIÓN FINAL (J1/cardinality/J6 no aplican -- 0 findings de IA en esta batería)');
  console.log('========================================');
  const allRawFindings: InputAuditFinding[] = deterministicFindings.map((df: any) => ({
    findingGroup: df.findingGroup, type: df.type, status: df.status, severity: df.severity, confidence: df.confidence,
    description: df.description, heuristicCode: df.heuristicCode, heuristicName: df.heuristicName, wcagCriterion: df.wcagCriterion,
    evidence: df.evidence, affectedElement: df.affectedElement, impact: df.impact, recommendation: df.recommendation,
    iteration: df.iteration, url: df.url, screenshotUrl: df.screenshotUrl,
  }));
  const metrics = auditMetricsService.calculateMetrics(allRawFindings);
  console.log(`consolidatedFindings: ${metrics.consolidatedFindings.length} (dedup por criterio+selector ya aplicado)`);
  console.log(`overallScore (determinístico puro, sin Gemini): ${metrics.overallScore}`);
  console.log(`wcagMetrics: ${JSON.stringify(metrics.wcagMetrics)}`);
  console.log(`nielsenMetrics: ${JSON.stringify(metrics.nielsenMetrics)}`);

  console.log('\n========================================');
  console.log('RESUMEN FINAL');
  console.log('========================================');
  console.log(`Gemini calls: 0`);
  console.log(`Selectores únicos verificados: ver sección de verificación de unicidad (script separado)`);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
