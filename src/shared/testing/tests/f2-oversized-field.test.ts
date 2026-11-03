import { automationService } from '@/modules/automation/automation.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildOversizedFieldHtml } from '@/shared/testing/stress-generators';
import { classifyPayloadLevel, PHASE2_BUDGET } from '@/shared/testing/payload-budgets';

/**
 * Fase F — F2: Texto extremo en UN SOLO campo (heading), llevado por pasos
 * hasta encontrar el cruce real NORMAL->WARNING->CRITICAL. Extiende T4
 * (que confirmó "no se trunca" con ~1 sola medición) cuantificando el gap
 * ya documentado a varios órdenes de magnitud.
 *
 * AISLADA: un solo factor (longitud de un campo), sin combinar con otros.
 *
 * PREDICCIÓN ANTES DE EJECUTAR: dado que el campo NO se trunca (T4), el
 * payload total predicho ~= overhead_fijo + chars_del_campo. Los puntos de
 * cruce NORMAL/WARNING/CRITICAL se predicen directamente restando el
 * overhead medido a los umbrales de PHASE2_BUDGET, ANTES de generar los
 * pasos grandes.
 */
async function measureForChars(chars: number): Promise<{ chars: number; promptChars: number }> {
  const evalId = `f2-${chars}`;
  const html = buildOversizedFieldHtml('heading', chars);
  await automationService.attachTestSession(evalId, html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local/f2', screenshotPath: '/x.png', headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons, forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'F2', url: 'https://fixture.local/f2',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  return { chars: snapshot.headings[0]?.text.length ?? 0, promptChars: prompt.length };
}

async function main() {
  console.log('🧪 Starting F2 — Oversized Single Field, Threshold Crossing (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- Calibración con un paso pequeño para derivar el overhead fijo real ---
  const baseline = await measureForChars(100);
  const overhead = baseline.promptChars - baseline.chars;
  console.log(`  ℹ️  Calibración: campo=100c -> prompt=${baseline.promptChars}c => overhead fijo real=${overhead}c`);

  const predictedNormalMax = PHASE2_BUDGET.normalMaxChars - overhead;
  const predictedWarningMax = PHASE2_BUDGET.warningMaxChars - overhead;
  console.log(`  ℹ️  Predicción de cruce: NORMAL hasta ~${predictedNormalMax}c de campo, WARNING hasta ~${predictedWarningMax}c de campo (más allá => CRITICAL)`);

  const steps = [1_000, 10_000, Math.max(1, predictedNormalMax), Math.max(1, predictedWarningMax), 150_000, 1_200_000];
  const results: Array<{ requested: number; chars: number; promptChars: number; level: ReturnType<typeof classifyPayloadLevel> }> = [];
  for (const step of steps) {
    const r = await measureForChars(step);
    const level = classifyPayloadLevel(r.promptChars, PHASE2_BUDGET);
    results.push({ requested: step, ...r, level });
    console.log(`  ℹ️  solicitado=${step}c campo_real=${r.chars}c prompt=${r.promptChars}c level=${level}`);
  }

  // El campo real capturado nunca se trunca (gap ya confirmado en T4,
  // ahora a mayor escala) — el prompt crece 1:1 con el campo.
  const last = results[results.length - 1];
  assert(last.chars > 1_000_000, `GAP CONFIRMADO a escala extrema: un campo de ~1.2M chars se captura SIN truncar (obtenido: ${last.chars})`);

  // El cruce de niveles ocurre exactamente donde predice la fórmula
  // (overhead medido + chars del campo), confirmando que no hay ningún
  // otro factor oculto influyendo el tamaño del prompt en este escenario.
  const normalStep = results.find((r) => r.chars <= predictedNormalMax);
  const criticalStep = results.find((r) => r.chars > predictedWarningMax);
  assert(!!normalStep && normalStep.level === 'NORMAL', `Por debajo del umbral NORMAL predicho, el nivel real es NORMAL (campo=${normalStep?.chars})`);
  assert(!!criticalStep && criticalStep.level === 'CRITICAL', `Por encima del umbral WARNING predicho, el nivel real es CRITICAL (campo=${criticalStep?.chars})`);

  // El propio campo NUNCA se trunca ni siquiera en CRITICAL — confirma el
  // principio de "no destruir evidencia" (payload-budgets.ts): CRITICAL
  // solo clasifica, no recorta contenido por su cuenta. Se compara el campo
  // realmente capturado contra lo SOLICITADO en ese paso (no un valor fijo),
  // con tolerancia por la granularidad del generador de texto de relleno.
  const criticalTruncationRatio = criticalStep!.chars / criticalStep!.requested;
  console.log(`  ℹ️  Paso CRITICAL: solicitado=${criticalStep!.requested}c capturado=${criticalStep!.chars}c ratio=${(criticalTruncationRatio * 100).toFixed(1)}%`);
  assert(criticalTruncationRatio > 0.9, `El campo en el paso CRITICAL conserva >90% de su longitud solicitada (ratio=${(criticalTruncationRatio * 100).toFixed(1)}%) — no fue recortado por ningún mecanismo automático`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
