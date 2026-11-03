import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { runMockedPhase2Pipeline, Phase2PipelineResult } from '@/shared/testing/gemini-mock-harness';
import { measurePayload, estimateTokensFromChars, PayloadLevel } from '@/shared/testing/payload-budgets';
import { evaluateGroundTruth, GroundTruth, OracleReport } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase H — Gemini REAL CONTROLADO (harness/orquestador, testing-only).
 *
 * IMPORTANTE: este módulo NO decide por sí mismo si golpea Gemini real o
 * mockeado -- `runMockedPhase2Pipeline` (reutilizado sin cambios desde
 * Fase G) simplemente llama a `aiService.performAuditAnalysis`, que a su
 * vez usa el singleton `GeminiClient.getInstance()`. Si el LLAMADOR de este
 * harness instaló un stub (`stubGeminiJsonResponses`, Fase G) antes de
 * invocar estas funciones, todo corre en modo mock (cero red, cero costo) --
 * así es como se verifica este harness en h0-harness-self-check.test.ts,
 * SIN ninguna llamada real. Si nadie instaló un stub, la llamada es REAL.
 * Por eso el script que efectivamente ejecuta Fase H
 * (h-real-controlled-runner.ts) requiere autorización explícita separada
 * antes de correrse -- este archivo, por sí solo, no dispara nada.
 */

/** Tope duro para toda la Fase H — no un objetivo, un límite que el orquestador hace cumplir. */
export const MAX_REAL_CALLS_PHASE_H = 6;

/**
 * Aproximación pública de precio de gemini-2.5-flash, SOLO para fines de
 * reporte/calibración -- no es un contrato de facturación ni una fuente
 * autoritativa. Documentada con fecha de referencia para poder detectar si
 * queda desactualizada.
 */
export const GEMINI_2_5_FLASH_PRICING_USD_PER_MILLION_TOKENS = {
  input: 0.30,
  output: 2.50,
  referenceDate: '2026-09',
};

export function estimateCostUsd(promptTokens: number, outputTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * GEMINI_2_5_FLASH_PRICING_USD_PER_MILLION_TOKENS.input;
  const outputCost = (outputTokens / 1_000_000) * GEMINI_2_5_FLASH_PRICING_USD_PER_MILLION_TOKENS.output;
  return inputCost + outputCost;
}

export interface FixtureCase {
  name: string;
  evidences: EvidenceInput[];
  /** Ground Truth COMPLETO (sin filtrar a verifiableBy:'deterministic') — primera vez en toda la sesión que esto ocurre. */
  groundTruth: GroundTruth;
  url?: string;
}

export interface PreflightBudgetCheck {
  fixtureName: string;
  chars: number;
  level: PayloadLevel;
  proceed: boolean;
}

/**
 * Construye el prompt SIN llamar a Gemini (mismo camino que
 * performAuditAnalysis usa internamente: sanitizeEvidenceForGemini +
 * buildV2AuditPrompt), para poder medir el presupuesto ANTES de decidir si
 * se envía.
 */
function buildPhase2PromptOnly(evidences: EvidenceInput[], meta: { evaluationId: string; url?: string }): string {
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(evidences);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: meta.evaluationId,
    title: 'H-real-controlled',
    url: meta.url || 'https://fixture.local/h',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [],
    previousActions: [],
    snapshotsCount: evidences.length,
    evidencesSummary: sanitized,
    dedupedLandmarks,
    dedupedLinks,
    dedupedButtons,
    accessibilityTrees: [],
  };
  return (aiService as any).buildV2AuditPrompt(input);
}

/**
 * Regla dura de la Fase H (compensación MANUAL/de proceso del gap ya
 * confirmado en F8/G7: shouldBlockBeforeSending() nunca se invoca en
 * producción). El propio orquestador rehúsa proceder si el nivel no es
 * NORMAL — nunca asume que "probablemente esté bien".
 */
export function preflightCheck(fixtureName: string, prompt: string): PreflightBudgetCheck {
  const measurement = measurePayload(2, prompt);
  return {
    fixtureName,
    chars: measurement.chars,
    level: measurement.level,
    proceed: measurement.level === 'NORMAL',
  };
}

export interface RealControlledCallRecord {
  fixtureName: string;
  // --- Dimensión A: validez técnica de la respuesta/schema ---
  schemaValid: boolean;
  errorMessage?: string;
  // --- Telemetría de tokens/costo (para calibración, no como techo duro) ---
  estimatedInputTokens: number;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  // --- Dimensión B: correcto procesamiento por el pipeline ---
  pipelineCompletedWithoutError: boolean;
  consolidatedFindingsCount?: number;
  // --- Dimensión C: calidad del juicio de Gemini frente al Ground Truth ---
  // Puramente informativa -- NUNCA determina pipelineCompletedWithoutError
  // ni aborta la fase. Un mismatch aquí es una limitación/calidad del
  // modelo, no un bug del pipeline (instrucción explícita del usuario).
  oracleReport?: OracleReport;
  aborted?: boolean;
}

/**
 * Orquestador de Fase H. Aplica, EN ESTE ORDEN, para cada fixture:
 *   1. Construye el prompt (sin llamar a Gemini).
 *   2. Preflight de presupuesto -- si no es NORMAL, ABORTA TODA la fase
 *      (no solo esa fixture) y no se envía esa llamada ni las siguientes.
 *   3. Llamada real/mockeada (según lo que el llamador haya stubbeado)
 *      vía runMockedPhase2Pipeline (reutilizado sin cambios de Fase G).
 *   4. Si lanza excepción (schema agotó retries, red, 429, etc.) -- ABORTA
 *      TODA la fase de inmediato, no continúa con las fixtures restantes.
 *   5. Si tiene éxito -- corre el oráculo COMPLETO (Dimensión C, informativa)
 *      y registra telemetría de tokens/costo.
 *
 * Nunca decide "seguir intentando" más allá de los reintentos YA
 * configurados dentro de GeminiClient -- ninguna llamada extra por fixture.
 */
export async function runPhase2RealControlled(
  fixtures: FixtureCase[],
  opts: { maxCalls?: number } = {},
): Promise<RealControlledCallRecord[]> {
  const maxCalls = opts.maxCalls ?? MAX_REAL_CALLS_PHASE_H;
  if (fixtures.length > maxCalls) {
    throw new Error(
      `Fase H: se pasaron ${fixtures.length} fixtures pero el tope duro configurado es ${maxCalls}. ` +
      `Reduce el conjunto o eleva maxCalls explícitamente solo con aprobación previa del usuario.`,
    );
  }

  const records: RealControlledCallRecord[] = [];

  for (const fixture of fixtures) {
    const prompt = buildPhase2PromptOnly(fixture.evidences, { evaluationId: fixture.name, url: fixture.url });
    const preflight = preflightCheck(fixture.name, prompt);

    console.log(`[FaseH] Preflight "${fixture.name}": chars=${preflight.chars} level=${preflight.level} proceed=${preflight.proceed}`);

    if (!preflight.proceed) {
      records.push({
        fixtureName: fixture.name,
        schemaValid: false,
        errorMessage: `PREFLIGHT ABORT: nivel=${preflight.level} (se exige NORMAL) — la llamada real NO se envió`,
        estimatedInputTokens: estimateTokensFromChars(preflight.chars),
        pipelineCompletedWithoutError: false,
        aborted: true,
      });
      console.warn(`[FaseH] ⛔ Preflight rechazó "${fixture.name}" (level=${preflight.level}). ABORTANDO el resto de la Fase H.`);
      break;
    }

    try {
      const result: Phase2PipelineResult = await runMockedPhase2Pipeline(fixture.evidences, { evaluationId: fixture.name, url: fixture.url });
      const oracleReport = evaluateGroundTruth(fixture.groundTruth, result.metrics.consolidatedFindings as any);

      records.push({
        fixtureName: fixture.name,
        schemaValid: true,
        estimatedInputTokens: estimateTokensFromChars(prompt.length),
        promptTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
        estimatedCostUsd: estimateCostUsd(result.usage?.promptTokens ?? 0, result.usage?.outputTokens ?? 0),
        pipelineCompletedWithoutError: true,
        consolidatedFindingsCount: result.metrics.consolidatedFindings.length,
        oracleReport,
      });
    } catch (err: any) {
      records.push({
        fixtureName: fixture.name,
        schemaValid: false,
        errorMessage: err?.message || String(err),
        estimatedInputTokens: estimateTokensFromChars(prompt.length),
        pipelineCompletedWithoutError: false,
        aborted: true,
      });
      console.error(`[FaseH] ❌ Error real/de pipeline en "${fixture.name}": ${err?.message || err}. ABORTANDO el resto de la Fase H (sin reintentos adicionales más allá de la política ya configurada en GeminiClient).`);
      break;
    }
  }

  return records;
}
