import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput } from '@/shared/testing/synthetic-mongoose-evidence';
import { buildEvolvingIterationLinks } from '@/shared/testing/stress-generators';
import {
  measurePayload,
  computeWorstCaseCumulativeTokens,
  classifyPayloadLevel,
  PHASE2_BUDGET,
  shouldBlockBeforeSending,
} from '@/shared/testing/payload-budgets';
import { DYNAMIC_ITERATIONS_CONFIG } from '@/modules/evaluations/services/dynamic-iterations.service';

/**
 * Fase F — F5: Crecimiento realista a lo largo de una sesión Phase 1
 * completa (las 8 iteraciones máximas reales, DYNAMIC_ITERATIONS_CONFIG.
 * MAX_LIMIT), contrastado contra `computeWorstCaseCumulativeTokens()` —
 * hoy puramente analítico, nunca confirmado con un dato empírico de 8
 * iteraciones reales (adjustment #2, Fase 2.3).
 *
 * AISLADA: un solo factor (número de iteraciones acumuladas), en dos
 * variantes del MISMO factor:
 *   - 'realistic': la mayoría del contenido se repite exacto entre
 *     iteraciones (nav/landmarks fijos) + un número pequeño y realista de
 *     elementos genuinamente nuevos por iteración (progreso de
 *     exploración) — el caso que el mecanismo de dedup está diseñado para
 *     manejar bien.
 *   - 'no-dedup-benefit': CADA enlace es único a su iteración (nada que
 *     fusionar) — el peor caso real para el dedup, usado para acercarse
 *     deliberadamente al techo analítico y poder ejercer la instrucción
 *     explícita: si lo medido supera la predicción, identificar QUÉ
 *     supuesto del modelo no representa el flujo real antes de
 *     clasificarlo como defecto (no asumir automáticamente que es un bug).
 */
function buildPhase2Prompt(mode: 'realistic' | 'no-dedup-benefit', iterations: number, fixedCount: number, novelPerIteration: number): { prompt: string; dedupedLinksCount: number } {
  const docs = Array.from({ length: iterations }).map((_, i) =>
    buildSyntheticMongooseEvidence({ iteration: i + 1, links: buildEvolvingIterationLinks(i + 1, mode, { fixedCount, novelPerIteration }) }),
  );
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(docs.map((d) => toEvidenceInput(d)));
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: `f5-${mode}-${iterations}`, title: 'F5', url: 'https://fixture.local/f5',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: iterations,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  return { prompt, dedupedLinksCount: dedupedLinks.length };
}

function main() {
  console.log('🧪 Starting F5 — Real 8-Iteration Session Growth vs. Analytical Worst-Case Model (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const MAX_ITERATIONS = DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT;
  assert(MAX_ITERATIONS === 8, `Se usa el máximo real configurado de iteraciones Phase 1 (obtenido: ${MAX_ITERATIONS})`);

  const model = computeWorstCaseCumulativeTokens();
  console.log(`  ℹ️  Modelo analítico (computeWorstCaseCumulativeTokens): phase1WorstCase=${model.phase1WorstCaseTokens} phase2WorstCase=${model.phase2WorstCaseTokens} combined=${model.combinedWorstCaseTokens} exceedsGoogleLimit=${model.exceedsGoogleLimit}`);

  // --- Variante 'realistic' ---
  const realistic = buildPhase2Prompt('realistic', MAX_ITERATIONS, 50, 15);
  const realisticMeasurement = measurePayload(2, realistic.prompt);
  console.log(`  ℹ️  [realistic] 8 iteraciones, 50 fijos + 15 nuevos/iteración: dedupedLinks=${realistic.dedupedLinksCount} chars=${realisticMeasurement.chars} estimatedTokens=${realisticMeasurement.estimatedTokens} level=${realisticMeasurement.level}`);
  assert(realistic.dedupedLinksCount === 50 + 15 * MAX_ITERATIONS, `dedupedLinks = 50 fusionados + 15×8 nuevos = ${50 + 15 * MAX_ITERATIONS} (obtenido: ${realistic.dedupedLinksCount})`);
  assert(
    realisticMeasurement.estimatedTokens < model.phase2WorstCaseTokens,
    `[realistic] Lo medido (${realisticMeasurement.estimatedTokens} tokens est.) queda POR DEBAJO del techo analítico de Phase 2 (${model.phase2WorstCaseTokens}) — el dedup entrega el margen que el modelo asume disponible`,
  );

  // --- Variante 'no-dedup-benefit' (peor caso real para el dedup) ---
  const worst = buildPhase2Prompt('no-dedup-benefit', MAX_ITERATIONS, 50, 15);
  const worstMeasurement = measurePayload(2, worst.prompt);
  console.log(`  ℹ️  [no-dedup-benefit] 8 iteraciones, todo único: dedupedLinks=${worst.dedupedLinksCount} chars=${worstMeasurement.chars} estimatedTokens=${worstMeasurement.estimatedTokens} level=${worstMeasurement.level}`);
  assert(worst.dedupedLinksCount === (50 + 15) * MAX_ITERATIONS, `Sin beneficio de dedup, TODOS los (50+15)×8=${(50 + 15) * MAX_ITERATIONS} enlaces quedan como entradas separadas (obtenido: ${worst.dedupedLinksCount})`);

  // --- Comparación e interpretación explícita (NO se asume bug automáticamente) ---
  const exceedsModel = worstMeasurement.estimatedTokens > model.phase2WorstCaseTokens;
  console.log(`  ℹ️  ¿Lo medido en el peor caso supera el techo analítico de Phase 2? ${exceedsModel} (medido=${worstMeasurement.estimatedTokens} vs. techo=${model.phase2WorstCaseTokens})`);
  if (exceedsModel) {
    console.log(
      '  ⚠️  Antes de clasificar esto como defecto: `computeWorstCaseCumulativeTokens.phase2WorstCaseTokens` asume que ' +
      'CUALQUIER request que realmente llegue a Gemini está acotado por PHASE2_BUDGET.warningMaxChars, bajo el supuesto ' +
      '(adjustment #3) de que un payload CRITICAL se bloquea ANTES de enviarse. Ese supuesto depende de un enforcement ' +
      'productivo de `shouldBlockBeforeSending()` que F8 confirma que HOY NO EXISTE (ningún call-site en producción lo invoca). ' +
      'Si el valor medido aquí supera el techo analítico, la causa más probable no es un error en la fórmula en sí, sino que ' +
      'el escenario sintético "sin beneficio de dedup" generó un prompt real por encima de warningMaxChars — es decir, el ' +
      'propio prompt ya sería CRITICAL y debería bloquearse antes de llegar aquí. El techo analítico es válido SOLO bajo el ' +
      'supuesto de que ese bloqueo existe; sin él, es un límite aspiracional, no una garantía real.',
    );
    assert(
      worstMeasurement.level === 'CRITICAL' || worstMeasurement.level === 'WARNING',
      `El escenario que supera el techo analítico coincide con un nivel ya elevado (WARNING/CRITICAL) del propio Payload Audit (obtenido: ${worstMeasurement.level}) — el propio sistema ya lo habría señalado, aunque no lo bloquee`,
    );
  } else {
    assert(true, 'Incluso en el peor caso real para el dedup (sin ninguna repetición que fusionar), lo medido se mantiene POR DEBAJO del techo analítico — el modelo conserva margen real, no solo teórico');
  }

  // --- Enlace con el enforcement (separado de la clasificación, ver F8) ---
  console.log(`  ℹ️  shouldBlockBeforeSending([no-dedup-benefit])=${shouldBlockBeforeSending(worstMeasurement)} — esta función SOLO clasifica; ningún call-site productivo la invoca hoy (ver F8)`);
  assert(classifyPayloadLevel(worstMeasurement.chars, PHASE2_BUDGET) === worstMeasurement.level, 'La clasificación de nivel es consistente entre measurePayload y classifyPayloadLevel');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

main();
