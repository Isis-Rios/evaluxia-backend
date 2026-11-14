import { z } from 'zod';
import { Types } from 'mongoose';
import {
  GeminiClient,
  GeminiInvocationError,
  GeminiAttemptRecord,
} from '@/infrastructure/gemini/gemini.client';
import { AppError } from '@/shared/errors/AppError';
import {
  stubGeminiJsonResponses,
  stubGeminiResponsesWithUsage,
} from '@/shared/testing/gemini-mock-harness';
import {
  aiInteractionService,
  isPhase1IterationRecord,
} from '../ai-interaction.service';
import { aiInteractionRepository } from '../ai-interaction.repository';
import { AiInteraction, IAiInteraction } from '../ai-interaction.model';
import { aiService } from '@/modules/ai/ai.service';

/**
 * P1.7.4-A — Trazabilidad por intento físico Gemini (MOCK ONLY, cero Gemini
 * real, cero MongoDB — el repositorio se intercepta en memoria, mismo patrón
 * que ai-interaction-tokens.test.ts, y la validación de schema usa
 * `validateSync()`, que no requiere conexión).
 *
 * Cubre los 9 escenarios del diseño cerrado:
 *  1. Respuesta vacía CON usageMetadata (consumo real capturado en attempts[]
 *     sin alterar attemptUsages/retryAccounting).
 *  2. Respuesta vacía SIN usageMetadata (usage null, usageReported false).
 *  3. Error del proveedor (sin objeto de respuesta: modelVersionEffective
 *     AUSENTE, nunca null-confundible).
 *  4. Reintentos mixtos con éxito final (un documento lógico, N intentos,
 *     requestTokens/responseTokens = intento final, retryAccounting intacto).
 *  5. Agotamiento total de reintentos (GeminiInvocationError con todos los
 *     intentos + persistencia FAILED vía logFailedInvocationFromError).
 *  6. Cero llamadas físicas → cero registro (error sin intentos adjuntos, y
 *     bloqueo J2-CRITICAL real de Phase 2).
 *  7. Filtro histórico isPhase1IterationRecord (protección de snapshotsCount).
 *  8. No-regresión J3 — se ejecuta aparte (j3-retry-accounting /
 *     j3-token-cost-accounting sin modificar).
 *  9. Schema: iteration condicional (PHASE_2/PROTOTYPE sin iteration válidos,
 *     PHASE_1/histórico sin iteration inválidos), sin valores sentinel.
 */

const SimpleSchema = z.object({ ok: z.boolean() });
const VALID_JSON = '{"ok":true}';
const FAST_RETRY = { maxRetries: 3, initialDelayMs: 1, backoffFactor: 1, maxDelayMs: 2, jitterMs: 0 };

// Repositorio interceptado en memoria para TODO el archivo (cero MongoDB).
const capturedCreates: Array<Partial<IAiInteraction>> = [];
(aiInteractionRepository as unknown as Record<string, unknown>)['create'] = async (
  data: Partial<IAiInteraction>,
) => {
  capturedCreates.push(data);
  return { ...data, id: 'fake-interaction-id' } as unknown as IAiInteraction;
};

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    failed++;
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 P1.7.4-A — Gemini attempt traceability tests (MOCK ONLY)...\n');
  const client = GeminiClient.getInstance();

  // ── Escenario 1: respuesta vacía CON usageMetadata ──────────────────────
  console.log('— Escenario 1: respuesta vacía CON usageMetadata');
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: '', usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0, totalTokenCount: 500 } },
      { text: VALID_JSON, usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 10, totalTokenCount: 510 } },
    ]);
    try {
      const res = await client.generateStructuredWithUsage('prompt', SimpleSchema, FAST_RETRY);
      const a = res.attempts!;
      assert(a.length === 2, `1a. La invocación lógica registra 2 intentos físicos (obtenido: ${a?.length})`);
      assert(a[0].outcome === 'EMPTY_RESPONSE', `1b. Intento 1 = EMPTY_RESPONSE (obtenido: ${a[0].outcome})`);
      assert(a[0].usage !== null && a[0].usage.promptTokens === 500, `1c. El consumo REAL reportado por el proveedor en la respuesta vacía SÍ se captura (promptTokens=${a[0].usage?.promptTokens})`);
      assert(a[0].usageReported === true, '1d. usageReported=true: el dato vino de usageMetadata, no de estimación');
      assert(a[0].modelVersionEffective === null, '1e. Hubo respuesta pero sin modelVersion → null explícito (nunca el modelo solicitado)');
      assert(a[0].attemptNumber === 1 && a[1].attemptNumber === 2, '1f. Ordinales físicos 1 y 2');
      assert(a[1].outcome === 'SUCCESS', '1g. Intento 2 = SUCCESS');
      assert(res.retryAccounting?.attempts === 1, `1h. retryAccounting NO cambió de semántica: sigue excluyendo la respuesta vacía (attempts=${res.retryAccounting?.attempts}, solo el intento con texto)`);
      assert(res.usage.promptTokens === 500 && res.usage.outputTokens === 10, '1i. usage del resultado = intento final exitoso únicamente (sin cambios)');
      assert(a[0].modelRequested.length > 0, '1j. modelRequested (env.GEMINI_MODEL) presente en cada intento');
    } finally {
      stub.restore();
    }
  }

  // ── Escenario 2: respuesta vacía SIN usageMetadata ──────────────────────
  console.log('— Escenario 2: respuesta vacía SIN usageMetadata');
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: '' },
      { text: VALID_JSON, usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, totalTokenCount: 55 } },
    ]);
    try {
      const res = await client.generateStructuredWithUsage('prompt', SimpleSchema, FAST_RETRY);
      const a0 = res.attempts![0];
      assert(a0.outcome === 'EMPTY_RESPONSE', '2a. Intento 1 = EMPTY_RESPONSE');
      assert(a0.usage === null, '2b. Sin usageMetadata no hay dato real ni estimable → usage=null (nunca se inventa consumo)');
      assert(a0.usageReported === false, '2c. usageReported=false');
      assert(a0.modelVersionEffective === null, '2d. Respuesta presente sin modelVersion → null (distinto de ausente)');
    } finally {
      stub.restore();
    }
  }

  // ── Escenario 3: error del proveedor (sin objeto de respuesta) ─────────
  console.log('— Escenario 3: PROVIDER_ERROR y luego éxito');
  {
    const providerErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const stub = stubGeminiJsonResponses([providerErr, VALID_JSON]);
    try {
      const res = await client.generateStructuredWithUsage('prompt', SimpleSchema, FAST_RETRY);
      const a0 = res.attempts![0] as GeminiAttemptRecord;
      assert(a0.outcome === 'PROVIDER_ERROR', '3a. Intento 1 = PROVIDER_ERROR');
      assert(!('modelVersionEffective' in a0), '3b. Sin objeto de respuesta, modelVersionEffective queda AUSENTE (key no presente), nunca null');
      assert(a0.usage === null && a0.usageReported === false, '3c. usage=null y usageReported=false (nada que medir)');
      assert(!!a0.errorReason && a0.errorReason.includes('503'), `3d. errorReason conserva la clasificación real (${a0.errorReason})`);
      assert(res.attempts!.length === 2 && res.attempts![1].outcome === 'SUCCESS', '3e. El reintento exitoso queda registrado como intento 2');
      assert(res.retryAccounting?.attempts === 1, '3f. retryAccounting sigue excluyendo el error de transporte (sin cambios de semántica)');
    } finally {
      stub.restore();
    }
  }

  // ── Escenario 4: reintentos mixtos con éxito final ──────────────────────
  console.log('— Escenario 4: vacía + JSON inválido + Zod + éxito (4 intentos, 1 documento lógico)');
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: '' },
      { text: 'esto no es JSON' },
      { text: '{"ok":"no-es-boolean"}' },
      { text: VALID_JSON, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, totalTokenCount: 105 } },
    ]);
    try {
      const res = await client.generateStructuredWithUsage('prompt', SimpleSchema, FAST_RETRY);
      const a = res.attempts!;
      const outcomes = a.map((x) => x.outcome).join(',');
      assert(a.length === 4, `4a. 4 intentos físicos registrados (obtenido: ${a.length})`);
      assert(outcomes === 'EMPTY_RESPONSE,INVALID_JSON,SCHEMA_MISMATCH,SUCCESS', `4b. Secuencia de desenlaces fiel al orden real (${outcomes})`);
      assert(a.map((x) => x.attemptNumber).join(',') === '1,2,3,4', '4c. Ordinales físicos consecutivos 1-4');
      assert(a[1].usage !== null && a[1].usageReported === false, '4d. Intento INVALID_JSON sin usageMetadata conserva la estimación local existente, marcada usageReported=false');
      assert(a[3].usageReported === true, '4e. Intento final con usageMetadata real marcado usageReported=true');
      assert(res.usage.promptTokens === 100, '4f. usage del resultado = intento final (semántica intacta)');
      assert(res.retryAccounting?.attempts === 3, `4g. retryAccounting.attempts=3 (los 3 intentos CON texto, la vacía excluida) — semántica J3 preexistente intacta (obtenido: ${res.retryAccounting?.attempts})`);
    } finally {
      stub.restore();
    }
  }

  // ── Escenario 5: agotamiento total de reintentos ────────────────────────
  console.log('— Escenario 5: fallo total con persistencia FAILED');
  let totalFailureError: unknown;
  {
    const providerErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const stub = stubGeminiJsonResponses([providerErr]);
    try {
      await client.generateStructuredWithUsage('prompt', SimpleSchema, { ...FAST_RETRY, maxRetries: 2 });
      assert(false, '5a. La invocación debió lanzar tras agotar reintentos');
    } catch (err) {
      totalFailureError = err;
      assert(err instanceof GeminiInvocationError, '5a. El error final es GeminiInvocationError');
      assert(err instanceof AppError, '5b. ...y sigue siendo instanceof AppError (manejadores existentes intactos)');
      const gie = err as GeminiInvocationError;
      assert(gie.statusCode === 503, `5c. statusCode preservado (${gie.statusCode})`);
      assert(gie.attempts.length === 3, `5d. Los 3 intentos físicos (1 inicial + 2 reintentos) viajan adjuntos (obtenido: ${gie.attempts.length})`);
      assert(gie.attempts.every((x) => x.outcome === 'PROVIDER_ERROR'), '5e. Todos los intentos registrados como PROVIDER_ERROR');
      assert(typeof gie.executionTimeMs === 'number' && gie.executionTimeMs >= 0, `5e2. executionTimeMs real de la invocación completa (incluye los 2 reintentos con delay), medido desde el mismo startTime que el camino exitoso (obtenido: ${gie.executionTimeMs}ms)`);
    } finally {
      stub.restore();
    }
    // Persistencia del fallo total (repositorio interceptado en memoria).
    capturedCreates.length = 0;
    await aiInteractionService.logFailedInvocationFromError('eval-x', 'PROTOTYPE', undefined, totalFailureError);
    assert(capturedCreates.length === 1, '5f. La invocación FALLIDA SÍ se persiste (un documento)');
    const doc = capturedCreates[0] as any;
    assert(doc.phase === 'PROTOTYPE' && doc.invocationOutcome === 'FAILED', '5g. phase=PROTOTYPE, invocationOutcome=FAILED');
    assert(Array.isArray(doc.attempts) && doc.attempts.length === 3, '5h. El detalle completo de intentos queda persistido');
    assert(doc.requestTokens === 0 && doc.responseTokens === 0, '5i. requestTokens/responseTokens=0 (no hubo intento final exitoso) — semántica intacta');
    assert(!('iteration' in doc), '5j. PROTOTYPE sin iteration: la key ni siquiera se envía (sin sentinel)');
    assert(
      doc.executionTimeMs === (totalFailureError as GeminiInvocationError).executionTimeMs,
      `5k. executionTimeMs real (no 0) se propaga de GeminiInvocationError hasta el documento persistido (doc=${doc.executionTimeMs}, error=${(totalFailureError as GeminiInvocationError).executionTimeMs})`,
    );
  }

  // ── Escenario 5b (cierre, punto 2): fallo de la propia persistencia ─────
  console.log('— Escenario 5b: un fallo al persistir la traza nunca altera la propagación del error original de Gemini');
  {
    const originalCreate = (aiInteractionRepository as any).create;
    (aiInteractionRepository as any).create = async () => {
      throw new Error('Mongo write failed (simulado)');
    };
    try {
      // No debe lanzar: logFailedInvocationFromError traga su propio fallo de persistencia.
      await aiInteractionService.logFailedInvocationFromError('eval-x', 'PHASE_2', undefined, totalFailureError);
      assert(true, '5b-1. logFailedInvocationFromError no propaga un fallo de su propia escritura');
    } catch {
      assert(false, '5b-1. logFailedInvocationFromError no propaga un fallo de su propia escritura');
    } finally {
      (aiInteractionRepository as any).create = originalCreate;
    }
  }

  // ── Escenario 6: cero llamadas físicas → cero registro ─────────────────
  console.log('— Escenario 6: cero llamadas físicas → cero registro');
  {
    capturedCreates.length = 0;
    await aiInteractionService.logFailedInvocationFromError(
      'eval-x',
      'PHASE_1',
      3,
      new AppError('bloqueado antes de llamar', 502),
    );
    assert(capturedCreates.length === 0, '6a. Un error SIN intentos adjuntos (p. ej. bloqueo previo a la llamada) no registra nada');

    // Bloqueo J2-CRITICAL real de Phase 2: prompt > 1.000.000 chars.
    const stub = stubGeminiJsonResponses([VALID_JSON]);
    try {
      const res = await aiService.performAuditAnalysis({
        evaluationId: 'eval-j2',
        title: 'Test',
        url: 'https://ejemplo.com',
        archetype: { fullName: 'P', archetype: 'A', profession: 'Q', phrase: 'f', goals: [], frustrations: [] },
        completedSteps: [],
        previousActions: [],
        snapshotsCount: 1,
        evidencesSummary: [{
          iteration: 1, url: 'u', screenshotPath: 's',
          headings: [{ level: 1, text: 'X'.repeat(1_200_000), selector: 'h1' }],
          images: [], forms: [], computedStyles: [],
        }],
      });
      assert(stub.callCount() === 0, `6b. El bloqueo J2-CRITICAL no realizó NINGUNA llamada física (callCount=${stub.callCount()})`);
      assert(res.attempts === undefined, '6c. El retorno del bloqueo J2 no trae attempts (nada que registrar)');
      assert(res.result.findings.length === 0 && res.usage.totalTokens === 0, '6d. Fallback J2 intacto (findings vacíos, usage cero)');
    } finally {
      stub.restore();
    }
  }

  // ── Escenario 7: filtro histórico (protección de snapshotsCount) ────────
  console.log('— Escenario 7: isPhase1IterationRecord');
  {
    assert(isPhase1IterationRecord({}) === true, '7a. Histórico sin phase → incluido (comportamiento previo intacto)');
    assert(isPhase1IterationRecord({ phase: 'PHASE_1' }) === true, '7b. PHASE_1 sin outcome (iteración RuleEngine) → incluido');
    assert(isPhase1IterationRecord({ phase: 'PHASE_1', invocationOutcome: 'SUCCESS' }) === true, '7c. PHASE_1 SUCCESS → incluido');
    assert(isPhase1IterationRecord({ phase: 'PHASE_1', invocationOutcome: 'FAILED' }) === false, '7d. PHASE_1 FAILED → excluido (históricamente no dejaba registro)');
    assert(isPhase1IterationRecord({ phase: 'PHASE_2', invocationOutcome: 'SUCCESS' }) === false, '7e. PHASE_2 → excluido');
    assert(isPhase1IterationRecord({ phase: 'PROTOTYPE', invocationOutcome: 'SUCCESS' }) === false, '7f. PROTOTYPE → excluido');
  }

  // ── Escenario 8 se ejecuta aparte: suites J3 sin modificar ──────────────
  console.log('— Escenario 8: no-regresión J3 — se valida ejecutando j3-retry-accounting y j3-token-cost-accounting sin modificar (fuera de este archivo)');

  // ── Escenario 9: schema — iteration condicional, sin sentinels ──────────
  console.log('— Escenario 9: validación de schema (validateSync, sin MongoDB)');
  {
    const evaluationId = new Types.ObjectId();
    const validAttempt = {
      attemptNumber: 1, modelRequested: 'gemini-2.5-flash', modelVersionEffective: null,
      outcome: 'SUCCESS', usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
      usageReported: true, executedAt: new Date(),
    };

    const phase2 = new AiInteraction({ evaluationId, phase: 'PHASE_2', executionTimeMs: 5, invocationOutcome: 'SUCCESS', attempts: [validAttempt] });
    assert(phase2.validateSync() === undefined, '9a. PHASE_2 SIN iteration es válido (sin sentinel)');

    const prototype = new AiInteraction({ evaluationId, phase: 'PROTOTYPE', executionTimeMs: 5, invocationOutcome: 'FAILED', attempts: [{ ...validAttempt, outcome: 'PROVIDER_ERROR', usage: null, usageReported: false, errorReason: 'x' }] });
    assert(prototype.validateSync() === undefined, '9b. PROTOTYPE sin iteration, con intento PROVIDER_ERROR (usage null) es válido');

    const phase1NoIteration = new AiInteraction({ evaluationId, phase: 'PHASE_1', executionTimeMs: 5 });
    const err1 = phase1NoIteration.validateSync();
    assert(!!err1 && 'iteration' in (err1.errors || {}), '9c. PHASE_1 SIN iteration es rechazado al escribir');

    const historicalNoIteration = new AiInteraction({ evaluationId, executionTimeMs: 5 });
    const err2 = historicalNoIteration.validateSync();
    assert(!!err2 && 'iteration' in (err2.errors || {}), '9d. Un escritor sin phase (forma histórica) sigue obligado a proveer iteration');

    const historicalShape = new AiInteraction({ evaluationId, iteration: 2, executionTimeMs: 5, requestTokens: 10, responseTokens: 3, metadata: {} });
    assert(historicalShape.validateSync() === undefined, '9e. La forma histórica exacta (sin phase/outcome/attempts) sigue siendo válida — cero impacto en documentos existentes');
    assert((historicalShape as any).attempts === undefined, '9f. attempts no se materializa como [] en documentos que no lo traen');

    const badOutcome = new AiInteraction({ evaluationId, phase: 'PHASE_2', executionTimeMs: 5, attempts: [{ ...validAttempt, outcome: 'ALGO_INVENTADO' }] });
    assert(badOutcome.validateSync() !== undefined, '9g. Un outcome fuera del enum es rechazado');
  }

  // ── Extra: camino multimodal (PROTOTYPE) y passthrough de logInvocation ─
  console.log('— Extra: camino multimodal + passthrough de persistencia');
  {
    const stub = stubGeminiResponsesWithUsage([
      { text: VALID_JSON, usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2, totalTokenCount: 22 } },
    ]);
    try {
      const res = await client.generateMultimodalStructuredWithUsage(
        'prompt', { mimeType: 'image/png', data: 'ZmFrZQ==' }, SimpleSchema, FAST_RETRY,
      );
      assert(res.attempts!.length === 1 && res.attempts![0].outcome === 'SUCCESS', 'E1. El camino multimodal registra sus intentos con el mismo mecanismo');
    } finally {
      stub.restore();
    }

    capturedCreates.length = 0;
    await aiInteractionService.logInvocation({
      evaluationId: 'eval-y', phase: 'PHASE_1', iteration: 4, executionTimeMs: 99,
      requestTokens: 11, responseTokens: 7, invocationOutcome: 'SUCCESS',
      attempts: [{
        attemptNumber: 1, modelRequested: 'm', modelVersionEffective: 'm-002',
        outcome: 'SUCCESS', usage: { promptTokens: 11, outputTokens: 7, totalTokens: 18 },
        usageReported: true, executedAt: new Date(),
      }],
    });
    const doc = capturedCreates[0] as any;
    assert(doc.phase === 'PHASE_1' && doc.iteration === 4 && doc.invocationOutcome === 'SUCCESS', 'E2. logInvocation persiste phase/iteration/outcome tal cual');
    assert(doc.attempts?.[0]?.modelVersionEffective === 'm-002', 'E3. modelVersionEffective informado se persiste literal (nunca sustituido por modelRequested)');
    assert(doc.requestTokens === 11 && doc.responseTokens === 7, 'E4. requestTokens/responseTokens con su semántica actual');
  }

  console.log(`\n📊 Resultado: ${passed} ✅ / ${failed} ❌`);
  if (failed > 0) process.exit(1);
  console.log('🎉 P1.7.4-A attempt traceability tests passed.');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected test error:', err);
  process.exit(1);
});
