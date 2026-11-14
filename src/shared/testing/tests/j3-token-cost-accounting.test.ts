import { aiService } from '@/modules/ai/ai.service';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import {
  metricsTracker,
  checkUsageConsistency,
  resolveVerifiedModelPricing,
  TokenUsage,
} from '@/shared/infrastructure/metrics-tracker';
import { stubGeminiResponsesWithUsage, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * Hardening Post-Fase H — J3: Token / Cost Accounting.
 *
 * Todas las respuestas son mockeadas (stubGeminiResponsesWithUsage) — CERO
 * llamadas reales a Gemini. Cubre exactamente los 7 casos exigidos: usage
 * actual, usage completo, campos ausentes, thoughtsTokenCount=0,
 * totalTokenCount inconsistente, cálculo de costo, y compatibilidad hacia
 * atrás.
 */
const SIMPLE_EVIDENCE: EvidenceInput[] = [
  { iteration: 1, url: 'https://fixture.local/j3', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] },
];

function buildInput(evalId: string) {
  return {
    evaluationId: evalId, title: 'J3', url: 'https://fixture.local/j3',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: SIMPLE_EVIDENCE, dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [], accessibilityTrees: [],
  };
}

async function main() {
  console.log('🧪 Starting J3 — Token / Cost Accounting, Hardening Post-Fase H...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const validText = buildValidAuditOutputJson([]);

  // --- Caso 1: usage actual (solo lo que EvalUXIA ya soportaba) sigue funcionando igual ---
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: validText, usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 500, totalTokenCount: 3500 } },
    ]);
    try {
      const result = await aiService.performAuditAnalysis(buildInput('j3-case1') as any);
      assert(result.usage.promptTokens === 3000, `Caso 1: promptTokens=3000 (obtenido: ${result.usage.promptTokens})`);
      assert(result.usage.outputTokens === 500, `Caso 1: outputTokens=500 (obtenido: ${result.usage.outputTokens})`);
      assert(result.usage.totalTokens === 3500, `Caso 1: totalTokens=3500 (obtenido: ${result.usage.totalTokens})`);
      assert(result.usage.thinkingTokens === undefined, 'Caso 1: thinkingTokens es undefined cuando el SDK nunca lo reportó (comportamiento previo intacto)');
    } finally {
      stub.restore();
    }
  }

  // --- Caso 2: usage completo -- todos los campos nuevos capturados ---
  {
    const stub = stubGeminiResponsesWithUsage([
      {
        text: validText,
        usageMetadata: {
          promptTokenCount: 2827, candidatesTokenCount: 5868, thoughtsTokenCount: 7000,
          cachedContentTokenCount: 100, toolUsePromptTokenCount: 8, totalTokenCount: 15803,
        },
      },
    ]);
    try {
      const result = await aiService.performAuditAnalysis(buildInput('j3-case2') as any);
      assert(result.usage.thinkingTokens === 7000, `Caso 2: thinkingTokens=7000 capturado (obtenido: ${result.usage.thinkingTokens})`);
      assert(result.usage.cachedContentTokens === 100, `Caso 2: cachedContentTokens=100 capturado (obtenido: ${result.usage.cachedContentTokens})`);
      assert(result.usage.toolUsePromptTokens === 8, `Caso 2: toolUsePromptTokens=8 capturado (obtenido: ${result.usage.toolUsePromptTokens})`);
      assert(result.usage.totalTokens === 15803, 'Caso 2: totalTokens se preserva tal cual lo reportó Gemini (2827+5868+7000+8=15703 != 15803, pero NO se corrige)');
    } finally {
      stub.restore();
    }
  }

  // --- Caso 3: campos opcionales ausentes -- el pipeline no falla ---
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: validText, usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 } },
    ]);
    try {
      const result = await aiService.performAuditAnalysis(buildInput('j3-case3') as any);
      assert(result.usage.thinkingTokens === undefined, 'Caso 3: thinkingTokens ausente no rompe nada (undefined, no 0 inventado)');
      assert(result.usage.cachedContentTokens === undefined, 'Caso 3: cachedContentTokens ausente no rompe nada');
      assert(result.usage.toolUsePromptTokens === undefined, 'Caso 3: toolUsePromptTokens ausente no rompe nada');
      assert(result.usage.totalTokens === 1200, 'Caso 3: el resto de la extracción sigue funcionando con normalidad');
    } finally {
      stub.restore();
    }
  }

  // --- Caso 4: thoughtsTokenCount=0 NO se trata como undefined ---
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: validText, usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 0, totalTokenCount: 1200 } },
    ]);
    try {
      const result = await aiService.performAuditAnalysis(buildInput('j3-case4') as any);
      assert(result.usage.thinkingTokens === 0, `Caso 4: thoughtsTokenCount=0 se captura como 0, NO como undefined (obtenido: ${JSON.stringify(result.usage.thinkingTokens)}, typeof=${typeof result.usage.thinkingTokens})`);
      assert(typeof result.usage.thinkingTokens === 'number', 'Caso 4: el tipo es number, no undefined -- confirma que 0 es un valor real capturado, no la ausencia del campo');
    } finally {
      stub.restore();
    }
  }

  // --- Caso 5: totalTokenCount inconsistente -- se preserva, se detecta la anomalía, NO se corrige ---
  {
    // prompt=1000 + output=200 + thinking=300 = 1500 esperado, pero Gemini reporta 9999.
    const usage: TokenUsage = { promptTokens: 1000, outputTokens: 200, totalTokens: 9999, thinkingTokens: 300 };
    const consistency = checkUsageConsistency(usage);
    assert(consistency.evaluable === true, 'Caso 5: con prompt/output/total presentes, la consistencia SÍ es evaluable');
    assert(consistency.consistent === false, `Caso 5: se detecta la inconsistencia (esperado=1500, real=9999) — obtenido consistent=${consistency.consistent}`);
    assert(consistency.expectedTotal === 1500, `Caso 5: expectedTotal=1500 (obtenido: ${consistency.expectedTotal})`);
    assert(consistency.difference === 9999 - 1500, `Caso 5: difference calculada correctamente (obtenido: ${consistency.difference})`);

    // Confirmar que esto NUNCA altera usage.totalTokens en el pipeline real (solo se loguea, nunca se corrige).
    const stub = stubGeminiResponsesWithUsage([
      { text: validText, usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 9999 } },
    ]);
    try {
      const result = await aiService.performAuditAnalysis(buildInput('j3-case5') as any);
      assert(result.usage.totalTokens === 9999, `Caso 5 (end-to-end): totalTokens=9999 se PRESERVA tal cual lo reportó Gemini, sin corrección automática (obtenido: ${result.usage.totalTokens})`);
    } finally {
      stub.restore();
    }

    // Caso "faltan componentes" -- no debe marcar inconsistencia automáticamente.
    const incompleteUsage: TokenUsage = { promptTokens: 1000, outputTokens: 200, totalTokens: 1200 };
    const consistencyIncomplete = checkUsageConsistency(incompleteUsage);
    assert(consistencyIncomplete.evaluable === true, 'Caso 5b: con solo prompt/output/total (sin thinking/toolUse), SÍ es evaluable (se tratan como 0 por ausencia real del SDK, no por desconocimiento)');
    assert(consistencyIncomplete.consistent === true, 'Caso 5b: 1000+200+0+0=1200 coincide -- consistente');

    const missingCore: any = { promptTokens: 1000 }; // faltan outputTokens/totalTokens
    const consistencyMissing = checkUsageConsistency(missingCore);
    assert(consistencyMissing.evaluable === false, 'Caso 5c: si faltan campos CORE (outputTokens/totalTokens), NO se marca automáticamente inconsistencia -- evaluable=false');
  }

  // --- Caso 6: cost calculation -- tarifas oficiales verificadas, thinkingTokens incluidos una sola vez como salida, bloqueo de modelos no verificados ---
  {
    const cost25 = metricsTracker.calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    assert(Math.abs(cost25 - 2.80) < 0.0001, `Caso 6a: calculateCost('gemini-2.5-flash', 1M prompt, 1M output) = $2.80 exactos ($0.30 + $2.50, obtenido: $${cost25})`);

    const cost35Lite = metricsTracker.calculateCost('gemini-3.5-flash-lite', 1_000_000, 1_000_000);
    assert(Math.abs(cost35Lite - 2.80) < 0.0001, `Caso 6b: calculateCost('gemini-3.5-flash-lite', 1M prompt, 1M output) = $2.80 exactos ($0.30 + $2.50, obtenido: $${cost35Lite})`);

    const pricing38 = resolveVerifiedModelPricing('gemini-3.8-flash');
    assert(pricing38 !== null && pricing38.inputRatePerMillion === 0.75 && pricing38.outputRatePerMillion === 3.75 && pricing38.thinkingBilledAsOutput === true && pricing38.effectiveUntil === '2026-12-31', 'Caso 6c: gemini-3.8-flash registra tarifa oficial verificada ($0.75 input / $3.75 output por 1M, vigencia hasta 2026-12-31, thinking facturado como salida)');

    const cost38NoThinking = metricsTracker.calculateCost('gemini-3.8-flash', 1_000_000, 1_000_000, 0);
    assert(Math.abs(cost38NoThinking - 4.50) < 0.0001, `Caso 6d: calculateCost('gemini-3.8-flash', 1M prompt, 1M output, 0 thinking) = $4.50 exactos ($0.75 + $3.75, obtenido: $${cost38NoThinking})`);

    const cost38WithThinking = metricsTracker.calculateCost('gemini-3.8-flash', 1_000_000, 1_000_000, 1_000_000);
    assert(Math.abs(cost38WithThinking - 8.25) < 0.0001, `Caso 6e: calculateCost('gemini-3.8-flash', 1M prompt, 1M output, 1M thinking) = $8.25 exactos ($0.75 + 2M * $3.75): thinkingTokens ni excluidos ni duplicados (obtenido: $${cost38WithThinking})`);

    const metricsNoThinking = metricsTracker.recordEvaluation({
      evaluationId: 'j3-cost-no-thinking', modelUsed: 'gemini-3.8-flash', phase1Calls: 0, phase2Calls: 1, totalExecutionTimeMs: 100,
      promptTokens: 1000, outputTokens: 500,
    });
    assert(metricsNoThinking.totalTokens === 1500, `Caso 6f: totalTokens = promptTokens+outputTokens (1500), NUNCA usa totalTokenCount de Gemini como sustituto (obtenido: ${metricsNoThinking.totalTokens})`);
    assert(metricsNoThinking.costStatus === 'confirmed', `Caso 6f: sin thinkingTokens en modelo verificado, costStatus='confirmed' (obtenido: ${metricsNoThinking.costStatus})`);
    assert(metricsNoThinking.thinkingTokens === undefined, 'Caso 6f: thinkingTokens no aparece cuando no se proveyó');
    // 1000 * 0.75 / 1M = 0.00075; 500 * 3.75 / 1M = 0.001875 -> 0.002625
    assert(Math.abs(metricsNoThinking.estimatedCostUsd - 0.002625) < 0.000001, `Caso 6f: costo sin thinking = $0.002625 (obtenido: $${metricsNoThinking.estimatedCostUsd})`);

    const metricsWithThinking = metricsTracker.recordEvaluation({
      evaluationId: 'j3-cost-with-thinking', modelUsed: 'gemini-3.8-flash', phase1Calls: 0, phase2Calls: 1, totalExecutionTimeMs: 100,
      promptTokens: 1000, outputTokens: 500, thinkingTokens: 3000,
    });
    // 1000 * 0.75 / 1M = 0.00075; (500 + 3000) * 3.75 / 1M = 0.013125 -> 0.013875
    assert(Math.abs(metricsWithThinking.estimatedCostUsd - 0.013875) < 0.000001, `Caso 6g: con thinkingTokens=3000 en gemini-3.8-flash, se factura (500+3000)*$3.75/1M + 1000*$0.75/1M = $0.013875 (ni excluidos ni duplicados, obtenido: $${metricsWithThinking.estimatedCostUsd})`);
    assert(metricsWithThinking.costStatus === 'confirmed', `Caso 6g: con tarifa oficial de thinking verificada, costStatus='confirmed' (obtenido: ${metricsWithThinking.costStatus})`);
    assert(metricsWithThinking.thinkingTokens === 3000, 'Caso 6g: thinkingTokens=3000 se preserva en su campo propio');

    // Protección contra uso silencioso de tarifas de otro modelo en variantes no verificadas:
    for (const unverifiedModel of ['gemini-3.8-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'unknown-model']) {
      const unverifiedCost = metricsTracker.calculateCost(unverifiedModel, 1_000_000, 1_000_000, 500_000);
      const unverifiedMetrics = metricsTracker.recordEvaluation({
        evaluationId: `j3-unverified-${unverifiedModel}`,
        modelUsed: unverifiedModel,
        phase1Calls: 0,
        phase2Calls: 1,
        totalExecutionTimeMs: 50,
        promptTokens: 10_000,
        outputTokens: 1_000,
      });
      assert(unverifiedCost === 0, `Caso 6h (${unverifiedModel}): modelo no verificado NO toma silenciosamente la tarifa de otro modelo (cost=${unverifiedCost})`);
      assert(unverifiedMetrics.costStatus === 'unverified-model-rate', `Caso 6h (${unverifiedModel}): modelo no verificado NUNCA se marca como 'confirmed' (costStatus=${unverifiedMetrics.costStatus})`);
    }
  }

  // --- Caso 7: compatibilidad hacia atrás -- consumidores que solo esperan promptTokens/outputTokens/totalTokens siguen funcionando ---
  {
    const legacyUsage: TokenUsage = { promptTokens: 100, outputTokens: 50, totalTokens: 150 };
    const legacySum = legacyUsage.promptTokens + legacyUsage.outputTokens;
    assert(legacySum === 100 + 50, 'Caso 7: el acceso a los 3 campos base sigue funcionando exactamente igual (sin necesidad de conocer los campos nuevos)');
    assert(Object.keys(legacyUsage).length === 3, 'Caso 7: un objeto TokenUsage sin los campos opcionales sigue siendo válido y mínimo -- ningún campo nuevo es obligatorio');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
