import { aiService } from '@/modules/ai/ai.service';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { metricsTracker, checkUsageConsistency, TokenUsage } from '@/shared/infrastructure/metrics-tracker';
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

  // --- Caso 6: cost calculation -- no inventa tarifas, no duplica tokens, no cuenta totalTokenCount como input+output ---
  {
    const cost = metricsTracker.calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    assert(Math.abs(cost - 2.80) < 0.0001, `Caso 6: calculateCost(1M prompt, 1M output) = $2.80 exactos, tarifa confirmada sin cambios (obtenido: $${cost})`);

    const metricsNoThinking = metricsTracker.recordEvaluation({
      evaluationId: 'j3-cost-no-thinking', phase1Calls: 0, phase2Calls: 1, totalExecutionTimeMs: 100,
      promptTokens: 1000, outputTokens: 500,
    });
    assert(metricsNoThinking.totalTokens === 1500, `Caso 6: totalTokens = promptTokens+outputTokens (1500), NUNCA usa totalTokenCount de Gemini como sustituto (obtenido: ${metricsNoThinking.totalTokens})`);
    assert(metricsNoThinking.costStatus === 'confirmed', `Caso 6: sin thinkingTokens, costStatus='confirmed' (obtenido: ${metricsNoThinking.costStatus})`);
    assert(metricsNoThinking.thinkingTokens === undefined, 'Caso 6: thinkingTokens no aparece cuando no se proveyó');

    const metricsWithThinking = metricsTracker.recordEvaluation({
      evaluationId: 'j3-cost-with-thinking', phase1Calls: 0, phase2Calls: 1, totalExecutionTimeMs: 100,
      promptTokens: 1000, outputTokens: 500, thinkingTokens: 3000,
    });
    assert(metricsWithThinking.estimatedCostUsd === metricsNoThinking.estimatedCostUsd, 'Caso 6: estimatedCostUsd es IDÉNTICO con o sin thinkingTokens -- el costo confirmado nunca incluye una tarifa de thinking no verificada');
    assert(metricsWithThinking.costStatus === 'confirmed-excludes-unverified-thinking-cost', `Caso 6: con thinkingTokens>0, costStatus señala explícitamente que excluye una tarifa no verificada (obtenido: ${metricsWithThinking.costStatus})`);
    assert(metricsWithThinking.thinkingTokens === 3000, 'Caso 6: thinkingTokens se reporta aparte, nunca sumado en silencio al costo');
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
