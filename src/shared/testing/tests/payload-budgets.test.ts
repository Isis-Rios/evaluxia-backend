import { AI_RETRY_CONFIG } from '@/config/constants';
import { DYNAMIC_ITERATIONS_CONFIG } from '@/modules/evaluations/services/dynamic-iterations.service';
import {
  estimateTokensFromChars,
  classifyPayloadLevel,
  measurePayload,
  shouldBlockBeforeSending,
  isAcceptableForFixtureKind,
  computeWorstCaseCumulativeTokens,
  PHASE1_BUDGET,
  PHASE2_BUDGET,
  GOOGLE_TOKENS_PER_MINUTE_LIMIT,
} from '@/shared/testing/payload-budgets';

/**
 * Fase 2.3 — unit validation of the payload-budgets module itself.
 *
 * T1 (token-budget-mongoose-regression.test.ts) exercises this module
 * against one real scenario; this file validates the module's own
 * arithmetic and boundary behavior directly, independent of any fixture.
 */
function runTests() {
  console.log('🧪 Starting payload-budgets unit validation (Fase 2.3)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${msg}`);
      failed++;
    }
  }

  console.log('--- estimateTokensFromChars ---');
  assert(estimateTokensFromChars(0) === 0, 'estimateTokensFromChars(0) === 0');
  assert(estimateTokensFromChars(4) === 1, 'estimateTokensFromChars(4) === 1');
  assert(estimateTokensFromChars(5) === 2, 'estimateTokensFromChars(5) === 2 (redondea hacia arriba)');
  assert(estimateTokensFromChars(1_000_000) === 250_000, 'estimateTokensFromChars(1,000,000) === 250,000');

  console.log('\n--- classifyPayloadLevel: límites exactos de Phase 1 ---');
  assert(classifyPayloadLevel(PHASE1_BUDGET.normalMaxChars, PHASE1_BUDGET) === 'NORMAL', 'Exactamente en el límite NORMAL -> NORMAL (inclusive)');
  assert(classifyPayloadLevel(PHASE1_BUDGET.normalMaxChars + 1, PHASE1_BUDGET) === 'WARNING', 'Un char por encima de NORMAL -> WARNING');
  assert(classifyPayloadLevel(PHASE1_BUDGET.warningMaxChars, PHASE1_BUDGET) === 'WARNING', 'Exactamente en el límite WARNING -> WARNING (inclusive)');
  assert(classifyPayloadLevel(PHASE1_BUDGET.warningMaxChars + 1, PHASE1_BUDGET) === 'CRITICAL', 'Un char por encima de WARNING -> CRITICAL');

  console.log('\n--- classifyPayloadLevel: límites exactos de Phase 2 ---');
  assert(classifyPayloadLevel(PHASE2_BUDGET.normalMaxChars, PHASE2_BUDGET) === 'NORMAL', 'Phase 2: límite NORMAL exacto -> NORMAL');
  assert(classifyPayloadLevel(PHASE2_BUDGET.warningMaxChars, PHASE2_BUDGET) === 'WARNING', 'Phase 2: límite WARNING exacto -> WARNING');
  assert(classifyPayloadLevel(PHASE2_BUDGET.warningMaxChars + 1, PHASE2_BUDGET) === 'CRITICAL', 'Phase 2: un char por encima de WARNING -> CRITICAL');

  console.log('\n--- measurePayload: chars vs. bytes (Unicode multibyte) ---');
  {
    const asciiPrompt = 'a'.repeat(100);
    const m1 = measurePayload(2, asciiPrompt);
    assert(m1.chars === 100 && m1.bytes === 100, 'ASCII puro: chars === bytes');

    const unicodePrompt = '日'.repeat(100); // 3 bytes UTF-8 por carácter
    const m2 = measurePayload(2, unicodePrompt);
    assert(m2.chars === 100 && m2.bytes === 300, `Unicode multibyte: chars=100, bytes=300 (obtenido chars=${m2.chars}, bytes=${m2.bytes})`);
  }
  {
    // 150,000 chars supera PHASE1_BUDGET.warningMaxChars (100,000) pero está
    // muy por debajo de PHASE2_BUDGET.warningMaxChars (1,000,000) — el
    // mismo tamaño debe clasificar distinto según la fase, confirmando que
    // measurePayload realmente selecciona el presupuesto correcto por `phase`.
    const asPhase1 = measurePayload(1, 'x'.repeat(150_000));
    const asPhase2 = measurePayload(2, 'x'.repeat(150_000));
    assert(asPhase1.phase === 1 && asPhase1.level === 'CRITICAL', `measurePayload(1, ...) usa el presupuesto de Phase 1: 150,000 chars > warningMaxChars(${PHASE1_BUDGET.warningMaxChars}) -> CRITICAL`);
    assert(asPhase2.phase === 2 && asPhase2.level === 'NORMAL', `El MISMO tamaño (150,000 chars) es NORMAL bajo el presupuesto de Phase 2 (warningMaxChars=${PHASE2_BUDGET.warningMaxChars}) — confirma que measurePayload no reutiliza un único umbral global`);
  }

  console.log('\n--- shouldBlockBeforeSending / isAcceptableForFixtureKind ---');
  {
    const normal = measurePayload(2, 'x'.repeat(1000));
    const warning = measurePayload(2, 'x'.repeat(PHASE2_BUDGET.normalMaxChars + 1));
    const critical = measurePayload(2, 'x'.repeat(PHASE2_BUDGET.warningMaxChars + 1));

    assert(!shouldBlockBeforeSending(normal), 'NORMAL no bloquea');
    assert(!shouldBlockBeforeSending(warning), 'WARNING no bloquea (continúa, pero se registra)');
    assert(shouldBlockBeforeSending(critical), 'CRITICAL SÍ bloquea antes de enviar (ajuste #3)');

    assert(isAcceptableForFixtureKind(normal, 'functional') === true, 'Fixture funcional en NORMAL es aceptable');
    assert(isAcceptableForFixtureKind(warning, 'functional') === true, 'Fixture funcional en WARNING es aceptable (no ideal, pero no bloqueante)');
    assert(isAcceptableForFixtureKind(critical, 'functional') === false, 'Fixture funcional en CRITICAL NO es aceptable (señal de bug, no de estrés intencional)');
    assert(isAcceptableForFixtureKind(critical, 'stress') === true, 'Fixture de estrés en CRITICAL SÍ es aceptable (esperado por diseño, ajuste #5)');
  }

  console.log('\n--- computeWorstCaseCumulativeTokens: parámetros custom (aritmética exacta) ---');
  {
    const r = computeWorstCaseCumulativeTokens({ phase1MaxIterations: 1, maxRetries: 0 });
    assert(r.requestsPerLogicalCall === 1, 'requestsPerLogicalCall = 1 + 0 reintentos = 1');
    assert(r.phase1WorstCaseTokens === estimateTokensFromChars(PHASE1_BUDGET.warningMaxChars), 'Phase1WorstCase = 1 iteración × 1 request × techo WARNING de Phase 1');
    assert(r.phase2WorstCaseTokens === estimateTokensFromChars(PHASE2_BUDGET.warningMaxChars), 'Phase2WorstCase = 1 request × techo WARNING de Phase 2');
    assert(r.combinedWorstCaseTokens === r.phase1WorstCaseTokens + r.phase2WorstCaseTokens, 'combinedWorstCaseTokens = suma de ambos');
    assert(r.exceedsGoogleLimit === (r.combinedWorstCaseTokens > GOOGLE_TOKENS_PER_MINUTE_LIMIT), 'exceedsGoogleLimit refleja correctamente la comparación contra el límite real');
    assert(r.exceedsGoogleLimit === false, 'Con 1 iteración y 0 reintentos, el peor caso NO excede el límite real');
  }

  console.log('\n--- computeWorstCaseCumulativeTokens: parámetros por defecto == configuración real del sistema ---');
  {
    const r = computeWorstCaseCumulativeTokens();
    assert(r.phase1MaxIterations === DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT, `Por defecto usa DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT real (${DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT})`);
    assert(r.requestsPerLogicalCall === 1 + AI_RETRY_CONFIG.maxRetries, `Por defecto usa 1 + AI_RETRY_CONFIG.maxRetries real (${AI_RETRY_CONFIG.maxRetries})`);
    // Con la config real actual (maxRetries=3, maxIterations=8): 8*4*25000 + 4*250000 = 800,000 + 1,000,000 = 1,800,000
    assert(r.combinedWorstCaseTokens === 1_800_000, `Con la configuración real actual, el peor caso combinado es exactamente 1,800,000 (obtenido: ${r.combinedWorstCaseTokens.toLocaleString()})`);
    assert(r.exceedsGoogleLimit === true, 'Con la configuración real actual, el peor caso teórico SÍ excede el límite real de Google (1,000,000/min) — hallazgo del ajuste #2, confirmado aritméticamente');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
