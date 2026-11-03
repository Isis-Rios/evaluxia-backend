import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput } from '@/shared/testing/synthetic-mongoose-evidence';
import { buildCatalogLinks, buildCatalogButtons } from '@/shared/testing/stress-generators';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase F — F1: Repetición extrema con identidad DISTINTA (catálogo/listado
 * realista, ej. 600 productos, mismo patrón de marcado, href/text únicos).
 * Extiende T3 (100 tarjetas) a una escala de "página grande real" y añade
 * lo que T3 no hacía: pasar por el DeterministicAnalyzer + Oracle para
 * confirmar que la corrección WCAG 2.4.4 se sostiene a escala.
 *
 * AISLADA: un solo factor (volumen de elementos distintos), sin combinar
 * con otros.
 *
 * PREDICCIÓN ANTES DE EJECUTAR: se AUTO-CALIBRA con 2 mediciones reales
 * pequeñas y baratas (N=10, N=50) para derivar pendiente (chars/elemento) e
 * intercepto (overhead fijo del prompt) por regresión lineal de 2 puntos,
 * en vez de adivinar el overhead — el overhead real de un prompt V2 completo
 * (criterios WCAG/Nielsen + formato de respuesta) no es el mismo que el de
 * Phase 1 (T1: 7-9KB), así que un valor fijo copiado de otra fase sería una
 * suposición, no una fórmula.
 */
const N = 600;

function promptCharsFor(n: number): number {
  const links = buildCatalogLinks(n);
  const buttons = buildCatalogButtons(n);
  const doc = buildSyntheticMongooseEvidence({ iteration: 1, links, buttons });
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([toEvidenceInput(doc)]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: `f1-calib-${n}`, title: 'F1', url: 'https://fixture.local/catalogo',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  return ((aiService as any).buildV2AuditPrompt(input) as string).length;
}

function runTests() {
  console.log('🧪 Starting F1 — Catalog Repetition, Extreme Volume with Distinct Identity (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- Predicción por calibración de 2 puntos reales y baratos ---
  const calibLowN = 10;
  const calibHighN = 50;
  const charsLow = promptCharsFor(calibLowN);
  const charsHigh = promptCharsFor(calibHighN);
  const slope = (charsHigh - charsLow) / (calibHighN - calibLowN); // chars por elemento adicional
  const intercept = charsLow - slope * calibLowN; // overhead fijo extrapolado
  const predictedChars = intercept + slope * N;
  console.log(`  ℹ️  Calibración: N=${calibLowN}->${charsLow}c, N=${calibHighN}->${charsHigh}c => pendiente=${slope.toFixed(1)}c/elemento, overhead=${intercept.toFixed(0)}c`);
  console.log(`  ℹ️  Predicción para N=${N}: ~${predictedChars.toFixed(0)}c`);

  const links = buildCatalogLinks(N);
  const buttons = buildCatalogButtons(N);
  const doc = buildSyntheticMongooseEvidence({ iteration: 1, links, buttons });
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([toEvidenceInput(doc)]);

  // --- Corrección del dedup a escala: NINGÚN colapso falso (los 600 son distintos) ---
  assert(dedupedLinks.length === N, `Los ${N} productos con href únicos NO se fusionan entre sí: dedupedLinks.length=${dedupedLinks.length}`);
  assert(dedupedButtons.length === N, `Los ${N} botones "Añadir al carrito" (mismo texto, selector real distinto) NO se fusionan: dedupedButtons.length=${dedupedButtons.length}`);
  const uniqueHrefs = new Set(dedupedLinks.map((l: any) => l.href));
  assert(uniqueHrefs.size === N, `Los ${N} hrefs distintos se preservan íntegros (${uniqueHrefs.size} valores únicos) — cero pérdida de identidad`);

  // --- DeterministicAnalyzer a escala: exactamente N findings WCAG 2.4.4 PASS, ninguno perdido/duplicado ---
  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    { iteration: 1, url: 'https://fixture.local/catalogo', screenshotPath: '/x.png', headings: [], images: [], links, buttons, forms: [], landmarks: [], computedStyles: [] } as any,
  ]);
  const linkFindings = detFindings.filter((f) => f.wcagCriterion?.includes('2.4.4'));
  console.log(`  ℹ️  DeterministicAnalyzer produjo ${linkFindings.length} findings WCAG 2.4.4 para ${N} enlaces (1:1 esperado)`);
  assert(linkFindings.length === N, `Exactamente 1 finding WCAG 2.4.4 por enlace, sin pérdida ni duplicación a escala (obtenido: ${linkFindings.length}, esperado: ${N})`);
  assert(linkFindings.every((f) => f.status === 'PASS'), 'Los 600 findings son PASS (todos los productos tienen texto de enlace propio no vacío)');

  const gt: GroundTruth = {
    fixture: 'synthetic/f1-catalog-repetition',
    criteria: [{ code: 'WCAG 2.4.4', expectedStatus: 'PASS', match: 'EXACT', verifiableBy: 'deterministic' }],
  };
  const report = evaluateGroundTruth(gt, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true a escala de ${N} elementos — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
  assert(report.duplicateViolations.length === 0, `El propio oráculo no detecta duplicados de (criterio, selector) entre los ${N} findings`);

  // --- Payload real vs. predicción ---
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: 'f1-catalog', title: 'F1', url: 'https://fixture.local/catalogo',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { evidencesSummary: sanitized, dedupedLinks, dedupedButtons });

  const deviation = Math.abs(measurement.chars - predictedChars) / predictedChars;
  console.log(`  ℹ️  Medido: chars=${measurement.chars} vs. predicho=${predictedChars} (desviación=${(deviation * 100).toFixed(1)}%)`);
  console.log(`  ℹ️  Payload Audit: estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  assert(deviation < 0.25, `La medición real se mantiene dentro de ±25% de la predicción lineal (desviación real=${(deviation * 100).toFixed(1)}%) — el crecimiento es explicable, no un factor no modelado`);
  assert(isAcceptableForFixtureKind(measurement, 'stress'), `Presupuesto: level=${measurement.level} (fixture de estrés — se exige detección correcta del nivel, no NORMAL)`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
