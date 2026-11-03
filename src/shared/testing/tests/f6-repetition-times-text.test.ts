import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput } from '@/shared/testing/synthetic-mongoose-evidence';
import { buildCatalogLinks } from '@/shared/testing/stress-generators';
import { measurePayload } from '@/shared/testing/payload-budgets';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase F — F6: Repetición extrema × texto largo (F1 × F2). Reutiliza
 * literalmente `buildCatalogLinks` de F1 (con `textChars` ahora poblado) —
 * NUNCA se construye un fixture combinatorio desde cero.
 *
 * COMBINATORIA: pregunta que ningún escenario aislado responde por sí
 * solo: ¿el crecimiento del payload cuando dos factores crecen a la vez es
 * la SUMA de los efectos aislados (composición aditiva, esperada dado que
 * ambos factores actúan sobre el mismo campo `text` sin interacción
 * conocida entre ellos), o se amplifica/atenúa de forma inesperada?
 *
 * PREDICCIÓN ANTES DE EJECUTAR: chars(N, textChars) - chars(N, 0) debe ser
 * aproximadamente N × textChars (el costo adicional por el texto largo,
 * multiplicado por cuántos elementos lo llevan) — se calcula ANTES y se
 * compara contra la medición real.
 */
function buildPrompt(n: number, textChars: number): { prompt: string; dedupedLinksCount: number } {
  const links = buildCatalogLinks(n, { textChars });
  const doc = buildSyntheticMongooseEvidence({ iteration: 1, links });
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([toEvidenceInput(doc)]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: `f6-${n}-${textChars}`, title: 'F6', url: 'https://fixture.local/f6',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  return { prompt, dedupedLinksCount: dedupedLinks.length };
}

function main() {
  console.log('🧪 Starting F6 — Repetition × Long Text, Combinatorial (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const N = 400;
  const TEXT_CHARS = 500;

  // --- Aisladas de referencia (reutilizadas para predecir la combinatoria) ---
  const baselineNoText = buildPrompt(N, 0);
  const baselineTextOnly = buildPrompt(1, TEXT_CHARS);

  const perElementTextCost = baselineTextOnly.prompt.length - buildPrompt(1, 0).prompt.length;
  const predictedCombined = baselineNoText.prompt.length + perElementTextCost * N;
  console.log(`  ℹ️  Costo de texto largo por elemento (aislado): +${perElementTextCost}c`);
  console.log(`  ℹ️  Predicción combinatoria: repetición_sola(${baselineNoText.prompt.length}c) + ${N}×${perElementTextCost}c = ~${predictedCombined}c`);

  // --- Combinatoria real ---
  const combined = buildPrompt(N, TEXT_CHARS);
  const deviation = Math.abs(combined.prompt.length - predictedCombined) / predictedCombined;
  console.log(`  ℹ️  Medido (combinatoria real): ${combined.prompt.length}c (desviación=${(deviation * 100).toFixed(1)}%)`);
  assert(deviation < 0.15, `El crecimiento combinado es ADITIVO respecto a los factores aislados (desviación=${(deviation * 100).toFixed(1)}% < 15%) — no hay amplificación inesperada al combinar ambos factores`);

  // --- Corrección del dedup NO se degrada por el texto largo: sigue sin fusionar los N distintos ---
  assert(combined.dedupedLinksCount === N, `Con texto largo en cada elemento, los ${N} productos distintos SIGUEN sin fusionarse: dedupedLinks.length=${combined.dedupedLinksCount}`);

  // --- DeterministicAnalyzer + Oracle a escala combinada ---
  const links = buildCatalogLinks(N, { textChars: TEXT_CHARS });
  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    { iteration: 1, url: 'https://fixture.local/f6', screenshotPath: '/x.png', headings: [], images: [], links, buttons: [], forms: [], landmarks: [], computedStyles: [] } as any,
  ]);
  const gt: GroundTruth = {
    fixture: 'synthetic/f6-repetition-times-text',
    criteria: [{ code: 'WCAG 2.4.4', expectedStatus: 'PASS', match: 'EXACT', verifiableBy: 'deterministic' }],
  };
  const report = evaluateGroundTruth(gt, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true incluso con texto largo combinado con volumen — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);

  const measurement = measurePayload(2, combined.prompt);
  console.log(`  ℹ️  Payload Audit combinado: estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Referencia: chars solo repetición=${baselineNoText.prompt.length}, solo texto largo (1 elemento)=${baselineTextOnly.prompt.length}, combinado=${combined.prompt.length}`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

main();
