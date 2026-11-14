import { env } from '@/config/env';

/**
 * TokenUsage — J3 (Hardening Post-Fase H): campos base sin cambios
 * (compatibilidad hacia atrás garantizada), más campos OPCIONALES nuevos
 * que reflejan, uno a uno, el `GenerateContentResponseUsageMetadata` real
 * del SDK `@google/genai` (ver `node_modules/@google/genai/dist/genai.d.ts`,
 * clase `GenerateContentResponseUsageMetadata`). Nombres elegidos para ser
 * inequívocos en TypeScript/JS (`thinkingTokens`, no `thoughtsTokenCount`)
 * pero cada uno documenta explícitamente el campo SDK exacto del que
 * proviene — nunca se inventa un campo que el SDK no reporte.
 *
 * IMPORTANTE (ver auditoría J3): NINGUNO de estos campos opcionales implica
 * por sí mismo una tarifa de facturación confirmada. `thinkingTokens` en
 * particular es observable pero su tarifa NO está verificada en este
 * repositorio — ver `checkUsageConsistency` y `MetricsTracker.calculateCost`.
 */
export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** SDK: `thoughtsTokenCount` — tokens de razonamiento interno (Gemini 2.5 "thinking"), si el modelo lo reporta. */
  thinkingTokens?: number;
  /** SDK: `cachedContentTokenCount` — porción de promptTokenCount servida desde caché (subconjunto informativo, NO se suma para obtener el total). */
  cachedContentTokens?: number;
  /** SDK: `toolUsePromptTokenCount` — tokens de resultados de herramientas devueltos como input al modelo, si aplica (EvalUXIA no usa tool-calling hoy; se espera 0/ausente). */
  toolUsePromptTokens?: number;
}

/**
 * Resultado de contrastar `totalTokens` contra la suma de sus componentes
 * conocidos. Documentado explícitamente por la fórmula que el propio SDK
 * declara: `totalTokenCount = promptTokenCount + candidatesTokenCount +
 * toolUsePromptTokenCount + thoughtsTokenCount` (ver JSDoc de
 * `GenerateContentResponseUsageMetadata` en el SDK). `cachedContentTokens`
 * NO participa de esa suma — es un desglose informativo de qué porción de
 * `promptTokens` vino de caché, no un sumando adicional.
 */
export interface UsageConsistencyResult {
  /** `true` solo si había suficiente información para evaluar la suma; `false` si faltaban componentes necesarios (nunca se asume 0 por ausencia real). */
  evaluable: boolean;
  /** `true` cuando fue evaluable Y la suma coincide con totalTokens. `undefined` cuando no fue evaluable. */
  consistent?: boolean;
  expectedTotal?: number;
  actualTotal?: number;
  difference?: number;
  reason: string;
}

/**
 * Contrasta `usage.totalTokens` contra `promptTokens + outputTokens +
 * (toolUsePromptTokens ?? 0) + (thinkingTokens ?? 0)`, SOLO cuando
 * `promptTokens`, `outputTokens` y `totalTokens` están presentes (son los
 * únicos que EvalUXIA garantiza siempre, con o sin `usageMetadata` real —
 * ver gemini.client.ts). Si `thinkingTokens`/`toolUsePromptTokens` nunca
 * fueron reportados por el SDK (undefined, no 0), se tratan como 0 para la
 * suma — el propio SDK documenta su ausencia como "no aplica", no como
 * "desconocido". Nunca corrige `totalTokens`; solo reporta si coincide.
 */
export function checkUsageConsistency(usage: TokenUsage): UsageConsistencyResult {
  if (
    typeof usage.promptTokens !== 'number' ||
    typeof usage.outputTokens !== 'number' ||
    typeof usage.totalTokens !== 'number'
  ) {
    return { evaluable: false, reason: 'Faltan promptTokens/outputTokens/totalTokens — no evaluable.' };
  }

  const expectedTotal = usage.promptTokens + usage.outputTokens + (usage.toolUsePromptTokens ?? 0) + (usage.thinkingTokens ?? 0);
  const actualTotal = usage.totalTokens;
  const consistent = expectedTotal === actualTotal;

  return {
    evaluable: true,
    consistent,
    expectedTotal,
    actualTotal,
    difference: actualTotal - expectedTotal,
    reason: consistent
      ? 'totalTokens coincide con promptTokens+outputTokens+toolUsePromptTokens+thinkingTokens.'
      : `ANOMALÍA: totalTokens=${actualTotal} no coincide con la suma esperada=${expectedTotal} (diferencia=${actualTotal - expectedTotal}). No se corrige automáticamente; se preserva el valor reportado por Gemini.`,
  };
}

export interface EvaluationMetrics {
  evaluationId: string;
  modelUsed: string;
  phase1Calls: number;
  phase2Calls: number;
  totalExecutionTimeMs: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  /**
   * P2-2 — Contador acumulado en memoria durante el tiempo de vida del proceso
   * backend (`MetricsTracker` singleton), NO por evaluación individual. Suma el
   * costo de todas las evaluaciones ejecutadas desde el arranque del servidor y
   * se reinicia a 0 al reiniciar el proceso. Para el costo de una evaluación
   * específica debe utilizarse siempre `estimatedCostUsd`.
   */
  cumulativeCostUsd: number;
  /** J3 — suma de thinkingTokens observados (Phase 1 + Phase 2), cuando el SDK los reportó. Puramente observacional. */
  thinkingTokens?: number;
  /**
   * J3 / Ronda 2 — Estado de verificación de la tarifa aplicada en `estimatedCostUsd`:
   * - `'confirmed'`: el modelo tiene tarifa oficial verificada en `VERIFIED_MODEL_PRICING`
   *   y los `thinkingTokens` (cuando existen) están incluidos una sola vez a la tarifa
   *   oficial de salida.
   * - `'confirmed-excludes-unverified-thinking-cost'`: mantenido por compatibilidad con
   *   reportes históricos anteriores a la verificación de tarifa de thinking tokens.
   * - `'unverified-model-rate'`: el identificador del modelo no pertenece a la tabla de
   *   tarifas verificadas; no se utiliza silenciosamente la tarifa de otro modelo (`0`)
   *   ni se marca como `'confirmed'`.
   */
  costStatus?: 'confirmed' | 'confirmed-excludes-unverified-thinking-cost' | 'unverified-model-rate';
  /**
   * P1.1, Parte B (trazabilidad de contadores) — opcional, aditivo,
   * calculado por `AuditEngine` (no por `MetricsTracker`, que solo conoce
   * tokens/costo) y añadido a este objeto antes de persistirlo en
   * `Report.metrics`. Desglosa TODOS los hallazgos consolidados de Fase 2
   * por `status` (bajo la política vigente `PASS_PERSISTED` de P1.7.2, se
   * persisten `FAIL`, `NOT_EVALUABLE` y `PASS`, ver `audit-engine.service.ts`).
   * Esto permite explicar `infoCount`/`evidenceCount` del Report y verificar
   * la integridad del conteo de persistencia en MongoDB.
   */
  metricsAudit?: {
    consolidatedByStatus: { FAIL: number; PASS: number; NOT_EVALUABLE: number };
    /**
     * P1.6.2 Parte A / P0-2 (actualizado a P1.7.2 `PASS_PERSISTED`) — calculado
     * a partir de `consolidatedByStatus` (FAIL + NOT_EVALUABLE + PASS), ANTES de
     * tocar MongoDB. Es una expectativa, nunca una verificación directa de
     * la base de datos — ver `persistedFindingsCount` para el dato real.
     */
    expectedPersistedFindingsCount: number;
    /**
     * P1.6.2 Parte A — conteo REAL de documentos `Finding` efectivamente
     * creados por `audit-engine.service.ts` en este mismo ciclo (un
     * incremento por cada `findingService.create()` que se completó sin
     * lanzar). `undefined` únicamente cuando el llamador no proveyó este
     * dato (compatibilidad con el único otro uso de esta función: los
     * tests, que ejercitan la lógica pura sin persistir nada). Cuando está
     * presente, SIEMPRE coincide con `expectedPersistedFindingsCount` salvo
     * que una creación individual haya fallado silenciosamente antes de
     * llegar al `catch` general — una discrepancia aquí sería, por tanto,
     * una señal real de persistencia parcial, no de un cálculo desactualizado.
     */
    persistedFindingsCount?: number;
    note: string;
  };
  /**
   * P1.1, Parte D (integridad de la exploración) — opcional, aditivo. No
   * cambia `status`/`auditStatus` de la evaluación ni ninguna política
   * existente: es una señal informativa para que el reporte distinga una
   * exploración completa de una interrumpida sin que quien lo lea tenga que
   * inferirlo del texto libre del resumen.
   *
   * P1.2 (investigación forense, pilotos 3/4 reales): `complete` ya NO
   * depende solo de `blockingError` -- dos evaluaciones reales demostraron
   * que una exploración puede agotar `maxIterations` ejecutando su última
   * acción con éxito técnico, sin que ninguna iteración posterior capture un
   * snapshot que verifique su efecto, y aun así `blockingError` quedaba
   * `null`. `terminationReason`/`evidenceFullyVerified` son los campos
   * nuevos; `'UNKNOWN'` (ausencia total de datos de P1.2, p. ej. reportes
   * históricos anteriores a este cambio) NUNCA se trata como "natural".
   */
  explorationIntegrity?: {
    complete: boolean;
    interruptionReason: string | null;
    terminationReason: 'NATURAL_STOP' | 'MAX_ITERATIONS_REACHED' | 'ACTION_FAILED' | 'INVALID_ACTION_DECISION' | 'EXPLORATION_ERROR' | 'UNKNOWN';
    /** `undefined` solo cuando no hay ningún dato de P1.2 disponible (reportes históricos). */
    evidenceFullyVerified?: boolean;
    snapshotPersistenceFailureCount?: number;
  };
}

/**
 * P1.1, Parte B (trazabilidad de contadores) — desglosa TODOS los hallazgos
 * consolidados de Fase 2 por `status`, no solo los `FAIL` que
 * `audit-engine.service.ts` persiste como documento `Finding`. Pura y
 * extraída deliberadamente (sin cambiar su lugar de uso ni su resultado)
 * para poder probarla sin tocar MongoDB.
 */
export function buildMetricsAudit(
  consolidatedFindings: Array<{ status: string }>,
  /**
   * P1.6.2 Parte A — opcional: el conteo REAL de documentos `Finding`
   * creados en este mismo ciclo de persistencia. Cuando se omite (p. ej.
   * desde un test que ejercita la lógica pura sin persistir nada),
   * `persistedFindingsCount` queda `undefined` en vez de inventarse un
   * valor — nunca se presenta un cálculo como si fuera una verificación.
   */
  actualPersistedFindingsCount?: number,
): NonNullable<EvaluationMetrics['metricsAudit']> {
  const consolidatedByStatus = { FAIL: 0, PASS: 0, NOT_EVALUABLE: 0 };
  for (const cf of consolidatedFindings) {
    if (cf.status in consolidatedByStatus) {
      consolidatedByStatus[cf.status as keyof typeof consolidatedByStatus]++;
    }
  }
  // Política actual (P1.7.2 / PASS_PERSISTED, alineado en P0-2): se persisten
  // FAIL, NOT_EVALUABLE y PASS como documento `Finding`.
  const expectedPersistedFindingsCount =
    consolidatedByStatus.FAIL + consolidatedByStatus.NOT_EVALUABLE + consolidatedByStatus.PASS;

  const discrepancyNote =
    actualPersistedFindingsCount !== undefined && actualPersistedFindingsCount !== expectedPersistedFindingsCount
      ? ` ADVERTENCIA: el conteo real persistido (${actualPersistedFindingsCount}) no coincide con el esperado (${expectedPersistedFindingsCount}) — posible fallo parcial de persistencia.`
      : '';

  return {
    consolidatedByStatus,
    expectedPersistedFindingsCount,
    persistedFindingsCount: actualPersistedFindingsCount,
    note:
      'Política de persistencia actual (PASS_PERSISTED, P1.7.2): se guardan como documento Finding los hallazgos consolidados con status FAIL, NOT_EVALUABLE o PASS (ver audit-engine.service.ts paso 9). ' +
      'expectedPersistedFindingsCount es un cálculo derivado de consolidatedByStatus, previo a tocar MongoDB. ' +
      'persistedFindingsCount, cuando está presente, es el conteo real de documentos creados en este ciclo. ' +
      'infoCount y evidenceCount del Report se calculan sobre TODOS los hallazgos consolidados de Fase 2 (consolidatedByStatus).' +
      discrepancyNote,
  };
}

/**
 * P1.1, Parte D (integridad de la exploración) — señal informativa, no
 * cambia `status`/`auditStatus` ni ninguna política existente. Pura y
 * extraída por el mismo motivo que `buildMetricsAudit`.
 *
 * P1.2 — el segundo parámetro (`termination`) es OPCIONAL y aditivo, para
 * mantener compatible el llamado de 1 solo argumento (usado por reportes
 * históricos y por los tests preexistentes de P1.1, que siguen pasando sin
 * cambios):
 * - Omitido (`undefined`): preserva EXACTAMENTE el cálculo anterior a P1.2
 *   para `complete`/`interruptionReason`, y declara `terminationReason:
 *   'UNKNOWN'` en vez de dar a entender que se verificó una terminación
 *   natural (nunca se interpreta la ausencia de dato como "natural").
 * - Provisto (uso real, `audit-engine.service.ts`): `complete` ahora exige
 *   ADEMÁS que la terminación haya sido `NATURAL_STOP` y que la evidencia
 *   esté íntegra (última acción verificada por snapshot Y cero fallos de
 *   persistencia) — un `MAX_ITERATIONS_REACHED`/`ACTION_FAILED`/`UNKNOWN`
 *   nunca se presenta como completado y verificado, aunque `blockingError`
 *   sea `null` (el caso real de los pilotos 3 y 4, ver investigación P1.2).
 */
export function buildExplorationIntegrity(
  blockingError: string | null | undefined,
  termination?: {
    terminationReason: 'NATURAL_STOP' | 'MAX_ITERATIONS_REACHED' | 'ACTION_FAILED' | 'INVALID_ACTION_DECISION' | 'EXPLORATION_ERROR' | 'UNKNOWN';
    lastActionVerifiedBySnapshot: boolean;
    snapshotPersistenceFailureCount: number;
  },
): NonNullable<EvaluationMetrics['explorationIntegrity']> {
  if (!termination) {
    return {
      complete: !blockingError,
      interruptionReason: blockingError || null,
      terminationReason: 'UNKNOWN',
    };
  }

  const evidenceFullyVerified =
    termination.lastActionVerifiedBySnapshot && termination.snapshotPersistenceFailureCount === 0;
  const complete = termination.terminationReason === 'NATURAL_STOP' && !blockingError && evidenceFullyVerified;

  return {
    complete,
    interruptionReason: blockingError || null,
    terminationReason: termination.terminationReason,
    evidenceFullyVerified,
    snapshotPersistenceFailureCount: termination.snapshotPersistenceFailureCount,
  };
}

/**
 * P1.1, Parte C (resumen narrativo) — `executiveSummary` viene directo de
 * Gemini, generado ANTES de EvidenceGate/cardinalidad/J6 y sin ninguna
 * reconciliación posterior contra los hallazgos finales: puede mencionar
 * observaciones que no sobrevivieron como hallazgo persistido. Solución
 * determinista y acotada (sin segunda llamada a Gemini, sin validador
 * semántico): marca el resumen como orientativo, distinto de la lista de
 * hallazgos verificados. No modifica reportes históricos ya persistidos —
 * solo aplica al texto de un reporte que se está generando ahora.
 */
/**
 * P1.6.2 Parte C — mensajes específicos por `terminationReason`, uno por
 * cada valor que `ExplorationTerminationReason` admite salvo `NATURAL_STOP`
 * (que, cuando además `complete === true`, nunca produce ninguna nota — ver
 * `appendSummaryDisclaimer`). Deliberadamente en el mismo espíritu que los
 * mensajes ya existentes en `IncompleteExplorationNotice.tsx` (frontend,
 * P1.3) pero redactados para texto narrativo de Report, no para un
 * componente de alerta -- ambos describen el mismo hecho, nunca deben
 * contradecirse entre sí.
 */
const EXPLORATION_INCOMPLETE_MESSAGES: Record<string, string> = {
  MAX_ITERATIONS_REACHED:
    'la exploración automática alcanzó su límite de iteraciones. La última acción ejecutada puede no haber sido verificada mediante una captura posterior que confirmara su efecto.',
  ACTION_FAILED:
    'la exploración automática se interrumpió antes de completar la secuencia prevista, por un problema de interacción con la página.',
  INVALID_ACTION_DECISION:
    'la exploración automática se detuvo porque el siguiente paso sugerido no pudo ejecutarse (no se identificó un elemento válido de la página).',
  EXPLORATION_ERROR:
    'la exploración automática se interrumpió por un error general del sistema, no por un problema de interacción con un elemento específico de la página.',
  UNKNOWN:
    'la exploración automática terminó de una forma que no se puede clasificar con la información disponible.',
};

export function appendSummaryDisclaimer(
  executiveSummary: string,
  /**
   * P1.6.2 Parte C — opcional y aditivo: cuando se omite, el comportamiento
   * es EXACTAMENTE el de antes de este cambio (solo el disclaimer de P1.1,
   * ver `p1-1-report-integrity-traceability.test.ts`, que sigue pasando sin
   * modificaciones). Se espera el mismo objeto que produce
   * `buildExplorationIntegrity` -- nunca se recalcula nada aquí.
   */
  explorationIntegrity?: NonNullable<EvaluationMetrics['explorationIntegrity']>,
): string {
  // Texto plano, sin sintaxis Markdown: EvaluationSummary.tsx (frontend)
  // renderiza `report.summary` como texto literal (`whiteSpace: 'pre-wrap'`,
  // sin parser de Markdown) -- un énfasis tipo `_texto_` se vería tal cual,
  // con los guiones bajos incluidos, en vez de en cursiva.
  let summary =
    `${executiveSummary}\n\n` +
    'Nota: este resumen es generado por IA a partir de la exploración y puede mencionar observaciones adicionales a los hallazgos verificados listados a continuación. Para problemas confirmados con evidencia trazable, consulte la lista de hallazgos, no este resumen por sí solo.';

  // Requisito 5 (P1.6.2 Parte C): nunca se añade nada cuando la exploración
  // SÍ terminó de forma completa y verificada -- ni cuando no se provee
  // ningún dato de integridad (compatibilidad con llamadas de 1 argumento).
  if (explorationIntegrity && !explorationIntegrity.complete) {
    const specificMessage = EXPLORATION_INCOMPLETE_MESSAGES[explorationIntegrity.terminationReason];
    // Requisito 7: nunca se afirma que la evaluación/auditoría falló -- esta
    // nota es exclusivamente sobre el ALCANCE de la exploración automática,
    // nunca sobre el resultado de la auditoría (que, si llegó hasta aquí, se
    // completó correctamente sobre la evidencia disponible).
    summary +=
      '\n\nNota sobre el alcance de la exploración: la auditoría se completó correctamente sobre la evidencia disponible, pero ' +
      (specificMessage ||
        'la exploración automática no pudo confirmarse como completa y verificada (motivo no clasificado con la información disponible).') +
      ' Esto no invalida los hallazgos ya confirmados, pero el sitio pudo tener pasos adicionales que esta evaluación no llegó a cubrir.';
  }

  return summary;
}

export interface VerifiedModelPricing {
  canonicalModel: string;
  pattern: RegExp;
  /** USD per 1,000,000 input tokens (`promptTokenCount` / `promptTokens`). */
  inputRatePerMillion: number;
  /** USD per 1,000,000 output tokens (`candidatesTokenCount` + `thoughtsTokenCount`). */
  outputRatePerMillion: number;
  /**
   * `true` cuando la documentación oficial de Gemini Developer API establece que
   * los `thinkingTokens` (`thoughtsTokenCount`) se facturan a la tarifa de salida.
   * En `@google/genai`, `candidatesTokenCount` (`outputTokens`) y `thoughtsTokenCount`
   * (`thinkingTokens`) son campos disjuntos (`totalTokenCount = promptTokenCount +
   * candidatesTokenCount + toolUsePromptTokenCount + thoughtsTokenCount`), por lo que
   * sumar `outputTokens + thinkingTokens` los contabiliza exactamente una vez.
   */
  thinkingBilledAsOutput: boolean;
  /** Fecha de verificación / vigencia de la tarifa registrada. */
  effectiveDate: string;
  /** Fecha límite de vigencia cuando existe un cambio programado por el proveedor. */
  effectiveUntil?: string;
  /** Unidad de facturación oficial. */
  unit: 'USD per 1,000,000 tokens';
}

/**
 * Tabla oficial de tarifas verificadas (Gemini Developer API — Standard Paid Tier).
 *
 * IMPORTANTE:
 * - Cada patrón utiliza anclaje estricto para impedir que variantes distintas
 *   (p. ej. `gemini-3.8-flash-lite`, `gemini-3.5-flash`, `gemini-2.5-flash-lite`)
 *   coincidan silenciosamente con otro modelo.
 * - `gemini-3.8-flash`: USD 0.75 / 1M tokens de entrada y USD 3.75 / 1M tokens de
 *   salida (incluyendo thinking tokens). Tarifa introductoria oficial vigente hasta
 *   el 31 de diciembre de 2026 (a partir del 1 de enero de 2027 pasa a USD 1.50 /
 *   USD 7.50 por 1M tokens).
 * - `gemini-3.5-flash-lite`: USD 0.30 / 1M tokens de entrada y USD 2.50 / 1M tokens
 *   de salida (incluyendo thinking tokens), modalidad estándar.
 * - `gemini-2.5-flash`: USD 0.30 / 1M tokens de entrada y USD 2.50 / 1M tokens de
 *   salida (incluyendo thinking tokens), retiro programado 2026-12-01.
 * - `gemini-2.0-flash`: USD 0.10 / 1M tokens de entrada y USD 0.40 / 1M tokens de
 *   salida.
 */
export const VERIFIED_MODEL_PRICING: readonly VerifiedModelPricing[] = [
  {
    canonicalModel: 'gemini-3.8-flash',
    pattern: /^gemini-3\.8-flash(?:-(?!lite\b)[a-z0-9._-]+)?$/i,
    inputRatePerMillion: 0.75,
    outputRatePerMillion: 3.75,
    thinkingBilledAsOutput: true,
    effectiveDate: '2026-11-12',
    effectiveUntil: '2026-12-31',
    unit: 'USD per 1,000,000 tokens',
  },
  {
    canonicalModel: 'gemini-3.5-flash-lite',
    pattern: /^gemini-3\.5-flash-lite(?:-[a-z0-9._-]+)?$/i,
    inputRatePerMillion: 0.30,
    outputRatePerMillion: 2.50,
    thinkingBilledAsOutput: true,
    effectiveDate: '2026-11-11',
    unit: 'USD per 1,000,000 tokens',
  },
  {
    canonicalModel: 'gemini-2.5-flash',
    pattern: /^gemini-2\.5-flash(?:-(?!lite\b)[a-z0-9._-]+)?$/i,
    inputRatePerMillion: 0.30,
    outputRatePerMillion: 2.50,
    thinkingBilledAsOutput: true,
    effectiveDate: '2026-11-11',
    effectiveUntil: '2026-12-01',
    unit: 'USD per 1,000,000 tokens',
  },
  {
    canonicalModel: 'gemini-2.0-flash',
    pattern: /^gemini-2\.0-flash(?:-(?!lite\b)[a-z0-9._-]+)?$/i,
    inputRatePerMillion: 0.10,
    outputRatePerMillion: 0.40,
    thinkingBilledAsOutput: true,
    effectiveDate: '2026-11-11',
    unit: 'USD per 1,000,000 tokens',
  },
];

export function resolveVerifiedModelPricing(modelName: string): VerifiedModelPricing | null {
  const normalized = (modelName || '').trim().replace(/^models\//i, '');
  if (!normalized) return null;
  return VERIFIED_MODEL_PRICING.find((entry) => entry.pattern.test(normalized)) ?? null;
}

/**
 * MetricsTracker — Singleton in-memory metric collector for LLM token consumption and costs.
 */
export class MetricsTracker {
  private static instance: MetricsTracker;

  // Cumulative in-memory counters since backend startup
  private cumulativeCostUsd = 0;
  private cumulativePromptTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeTotalTokens = 0;
  private cumulativePhase1Calls = 0;
  private cumulativePhase2Calls = 0;
  private cumulativeEvaluationsCount = 0;
  private cumulativeThinkingTokens = 0;

  private constructor() {}

  public static getInstance(): MetricsTracker {
    if (!MetricsTracker.instance) {
      MetricsTracker.instance = new MetricsTracker();
    }
    return MetricsTracker.instance;
  }

  /**
   * Calculates the estimated cost in USD based on verified model pricing and token counts.
   *
   * - If `modelName` does not match an entry in `VERIFIED_MODEL_PRICING`, returns `0`
   *   instead of silently applying another model's rate.
   * - `thinkingTokens` (`thoughtsTokenCount`) are disjoint from `outputTokens`
   *   (`candidatesTokenCount`) in `@google/genai` (`GenerateContentResponseUsageMetadata`),
   *   and are billed once at `outputRatePerMillion` when `thinkingBilledAsOutput` is true.
   */
  public calculateCost(
    modelName: string,
    promptTokens: number,
    outputTokens: number,
    thinkingTokens = 0,
  ): number {
    const pricing = resolveVerifiedModelPricing(modelName);
    if (!pricing) {
      return 0;
    }

    const safeThinkingTokens = typeof thinkingTokens === 'number' && thinkingTokens > 0 ? thinkingTokens : 0;
    const billableOutputTokens = outputTokens + (pricing.thinkingBilledAsOutput ? safeThinkingTokens : 0);

    const inputCost = (promptTokens / 1_000_000) * pricing.inputRatePerMillion;
    const outputCost = (billableOutputTokens / 1_000_000) * pricing.outputRatePerMillion;

    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Records completed evaluation metrics and updates cumulative counters.
   */
  public recordEvaluation(params: {
    evaluationId: string;
    modelUsed?: string;
    phase1Calls: number;
    phase2Calls: number;
    totalExecutionTimeMs: number;
    promptTokens: number;
    outputTokens: number;
    /** J3 — opcional, aditivo: suma de thinkingTokens (Phase1+Phase2) cuando el SDK los reportó. */
    thinkingTokens?: number;
  }): EvaluationMetrics {
    const modelUsed = params.modelUsed || env.GEMINI_MODEL;
    const promptTokens = params.promptTokens;
    const outputTokens = params.outputTokens;
    const safeThinkingTokens =
      typeof params.thinkingTokens === 'number' && params.thinkingTokens > 0 ? params.thinkingTokens : 0;
    // NOTA (J3): totalTokens sigue calculándose aquí como promptTokens+outputTokens,
    // EXACTAMENTE como antes — este comportamiento NO cambia (compatibilidad
    // hacia atrás). Es un valor distinto y deliberadamente separado del
    // `totalTokenCount` que Gemini reporta por llamada (que sí puede incluir
    // thinkingTokens) — ver gemini.client.ts/checkUsageConsistency para ese
    // contraste a nivel de llamada individual. Aquí, a nivel de evaluación
    // completa, `thinkingTokens` se reporta aparte en su propio campo, mientras
    // que `calculateCost` lo contabiliza exactamente una vez a la tarifa de salida.
    const totalTokens = promptTokens + outputTokens;

    const pricing = resolveVerifiedModelPricing(modelUsed);
    const estimatedCostUsd = this.calculateCost(modelUsed, promptTokens, outputTokens, safeThinkingTokens);
    const costStatus: EvaluationMetrics['costStatus'] = !pricing
      ? 'unverified-model-rate'
      : pricing.thinkingBilledAsOutput || safeThinkingTokens === 0
        ? 'confirmed'
        : 'confirmed-excludes-unverified-thinking-cost';

    // Update cumulative state
    this.cumulativeCostUsd = Number((this.cumulativeCostUsd + estimatedCostUsd).toFixed(6));
    this.cumulativePromptTokens += promptTokens;
    this.cumulativeOutputTokens += outputTokens;
    this.cumulativeTotalTokens += totalTokens;
    this.cumulativePhase1Calls += params.phase1Calls;
    this.cumulativePhase2Calls += params.phase2Calls;
    this.cumulativeEvaluationsCount += 1;
    if (safeThinkingTokens > 0) {
      this.cumulativeThinkingTokens += safeThinkingTokens;
    }

    const metrics: EvaluationMetrics = {
      evaluationId: params.evaluationId,
      modelUsed,
      phase1Calls: params.phase1Calls,
      phase2Calls: params.phase2Calls,
      totalExecutionTimeMs: params.totalExecutionTimeMs,
      promptTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      cumulativeCostUsd: this.cumulativeCostUsd,
      thinkingTokens: params.thinkingTokens,
      costStatus,
    };

    this.logConsoleReport(metrics);

    return metrics;
  }

  /**
   * Returns current cumulative metrics since backend startup.
   */
  public getCumulativeStats() {
    return {
      modelConfigured: env.GEMINI_MODEL,
      evaluationsEvaluated: this.cumulativeEvaluationsCount,
      totalPhase1Calls: this.cumulativePhase1Calls,
      totalPhase2Calls: this.cumulativePhase2Calls,
      totalCalls: this.cumulativePhase1Calls + this.cumulativePhase2Calls,
      totalPromptTokens: this.cumulativePromptTokens,
      totalOutputTokens: this.cumulativeOutputTokens,
      totalTokens: this.cumulativeTotalTokens,
      cumulativeCostUsd: this.cumulativeCostUsd,
      totalThinkingTokens: this.cumulativeThinkingTokens,
    };
  }

  /**
   * Prints an elegant terminal summary card for each completed evaluation.
   */
  private logConsoleReport(metrics: EvaluationMetrics): void {
    console.log(`\n================================================================================`);
    console.log(`📊 EVALUXIA COST & CONSUMPTION REPORT — Evaluation ${metrics.evaluationId}`);
    console.log(`================================================================================`);
    console.log(`• Model Used              : ${metrics.modelUsed}`);
    console.log(`• Phase 1 Calls (Nav)     : ${metrics.phase1Calls}`);
    console.log(`• Phase 2 Calls (Audit)   : ${metrics.phase2Calls}`);
    console.log(`• Prompt Tokens (Input)   : ${metrics.promptTokens.toLocaleString()} tokens`);
    console.log(`• Candidate Tokens (Output): ${metrics.outputTokens.toLocaleString()} tokens`);
    console.log(`• Total Tokens            : ${metrics.totalTokens.toLocaleString()} tokens`);
    if (metrics.thinkingTokens) {
      console.log(`• Thinking Tokens (output): ${metrics.thinkingTokens.toLocaleString()} tokens (facturados como salida)`);
    }
    console.log(`• Total Execution Time    : ${metrics.totalExecutionTimeMs} ms`);
    console.log(
      `• Estimated Eval Cost     : $${metrics.estimatedCostUsd.toFixed(6)} USD (${metrics.costStatus ?? 'confirmed'})`,
    );
    console.log(`• CUMULATIVE BACKEND COST : $${metrics.cumulativeCostUsd.toFixed(6)} USD (since startup)`);
    console.log(`================================================================================\n`);
  }
}

export const metricsTracker = MetricsTracker.getInstance();
