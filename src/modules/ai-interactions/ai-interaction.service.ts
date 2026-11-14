import {
  IAiInteraction,
  AiInteractionPhase,
  AiInvocationOutcome,
  AiInteractionAttempt,
} from './ai-interaction.model';
import { aiInteractionRepository } from './ai-interaction.repository';
import { GeminiInvocationError } from '@/infrastructure/gemini/gemini.client';

/**
 * P1.7.4-A — Predicado del fallback `snapshotsCount` (audit-engine.service.ts):
 * cuenta exclusivamente los registros de iteración de Phase 1, preservando el
 * significado histórico exacto de ese fallback:
 * - Histórico sin `phase` → incluido (el único escritor histórico era el
 *   bucle de Phase 1).
 * - Nuevo `PHASE_1` no fallido (éxito Gemini o iteración RuleEngine) → incluido.
 * - Nueva invocación `PHASE_1` FALLIDA → excluida (históricamente un fallo de
 *   makeDecision no dejaba registro, así que no debe alterar el conteo).
 * - `PHASE_2` / `PROTOTYPE` → excluidos (no existían cuando se definió el
 *   fallback).
 */
export function isPhase1IterationRecord(interaction: {
  phase?: string;
  invocationOutcome?: string;
}): boolean {
  if (!interaction.phase) return true;
  return interaction.phase === 'PHASE_1' && interaction.invocationOutcome !== 'FAILED';
}

export interface LogInvocationParams {
  evaluationId: string;
  phase: AiInteractionPhase;
  /** Solo Phase 1; PHASE_2/PROTOTYPE la omiten (sin valores sentinel). */
  iteration?: number;
  executionTimeMs: number;
  metadata?: any;
  requestTokens?: number;
  responseTokens?: number;
  invocationOutcome?: AiInvocationOutcome;
  attempts?: AiInteractionAttempt[];
}

export class AiInteractionService {
  async logInteraction(
    evaluationId: string,
    iteration: number,
    executionTimeMs: number,
    metadata: any = {},
    requestTokens: number = 0,
    responseTokens: number = 0,
  ): Promise<IAiInteraction> {
    return aiInteractionRepository.create({
      evaluationId: evaluationId as any,
      iteration,
      executionTimeMs,
      metadata,
      requestTokens,
      responseTokens,
    });
  }

  /**
   * P1.7.4-A — Registro de una invocación lógica con su detalle de intentos
   * físicos. `requestTokens`/`responseTokens` conservan su semántica actual
   * (intento final exitoso; 0 cuando no lo hubo) — el detalle por intento
   * vive exclusivamente en `attempts[]`.
   */
  async logInvocation(params: LogInvocationParams): Promise<IAiInteraction> {
    return aiInteractionRepository.create({
      evaluationId: params.evaluationId as any,
      ...(params.iteration !== undefined ? { iteration: params.iteration } : {}),
      phase: params.phase,
      executionTimeMs: params.executionTimeMs,
      metadata: params.metadata ?? {},
      requestTokens: params.requestTokens ?? 0,
      responseTokens: params.responseTokens ?? 0,
      ...(params.invocationOutcome ? { invocationOutcome: params.invocationOutcome } : {}),
      ...(params.attempts && params.attempts.length > 0 ? { attempts: params.attempts } : {}),
    });
  }

  /**
   * P1.7.4-A — Persiste la traza de una invocación lógica FALLIDA a partir
   * del error propagado por GeminiClient.
   * - Si el error no trae intentos (p. ej. un bloqueo J2-CRITICAL lanzado
   *   ANTES de cualquier llamada física), NO se registra nada: cero llamadas
   *   físicas → cero registro.
   * - Un fallo de la propia persistencia se traga y se loguea: la traza
   *   nunca debe alterar la propagación del error original.
   */
  async logFailedInvocationFromError(
    evaluationId: string,
    phase: AiInteractionPhase,
    iteration: number | undefined,
    error: unknown,
  ): Promise<void> {
    const attempts = error instanceof GeminiInvocationError ? error.attempts : undefined;
    if (!attempts || attempts.length === 0) return;
    // P1.7.4-A: tiempo total real de la invocación lógica (incluidos todos
    // los reintentos), medido por GeminiClient desde el mismo `startTime`
    // que el camino exitoso usa para su propio `executionTimeMs` — nunca
    // recalculado aquí ni confundido con los `executedAt` por intento.
    const executionTimeMs = error instanceof GeminiInvocationError ? error.executionTimeMs : 0;
    try {
      await this.logInvocation({
        evaluationId,
        phase,
        ...(iteration !== undefined ? { iteration } : {}),
        executionTimeMs,
        requestTokens: 0,
        responseTokens: 0,
        invocationOutcome: 'FAILED',
        attempts,
        metadata: {
          failureMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        },
      });
    } catch (persistError) {
      // P1.7.4-A (punto 2): nunca silencioso y con contexto suficiente para
      // ubicar el registro perdido (evaluationId, phase, resultado de la
      // operación que se intentaba persistir) — sin reintentar la escritura
      // (ver restricción explícita: nada de infraestructura de logging ni
      // reintentos nuevos) y sin alterar en absoluto la propagación del
      // error original de Gemini, que ya ocurrió antes de este catch.
      console.error(
        `[AiInteractionService] ❌ Fallo al persistir AiInteraction (evaluationId=${evaluationId}, phase=${phase}, invocationOutcome=FAILED) — la traza de esta invocación se pierde; el error original de Gemini se propaga sin cambios:`,
        persistError,
      );
    }
  }

  async getInteractions(evaluationId: string): Promise<IAiInteraction[]> {
    return aiInteractionRepository.findByEvaluationId(evaluationId);
  }
}

export const aiInteractionService = new AiInteractionService();
