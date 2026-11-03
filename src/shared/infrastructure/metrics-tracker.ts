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
  cumulativeCostUsd: number;
  /** J3 — suma de thinkingTokens observados (Phase 1 + Phase 2), cuando el SDK los reportó. Puramente observacional. */
  thinkingTokens?: number;
  /**
   * J3 — `estimatedCostUsd` (sin cambios) siempre representa el costo
   * calculado SOLO con promptTokens/outputTokens a las tarifas ya
   * configuradas (tarifa confirmada). `costStatus` indica si, además,
   * hubo thinkingTokens observados cuya tarifa NO está verificada en este
   * repositorio — en cuyo caso el costo real podría ser mayor al reportado.
   */
  costStatus?: 'confirmed' | 'confirmed-excludes-unverified-thinking-cost';
  /**
   * P1.1, Parte B (trazabilidad de contadores) — opcional, aditivo,
   * calculado por `AuditEngine` (no por `MetricsTracker`, que solo conoce
   * tokens/costo) y añadido a este objeto antes de persistirlo en
   * `Report.metrics`. Desglosa TODOS los hallazgos consolidados de Fase 2
   * por `status`, incluyendo los que nunca se persisten como documento
   * `Finding` (solo `FAIL` se persiste, ver `audit-engine.service.ts`).
   * Esto es lo que permite explicar `infoCount`/`evidenceCount` del Report
   * (que SÍ se calculan sobre el conjunto completo) a partir de un dato
   * recuperable, sin guardar cada hallazgo PASS/NOT_EVALUABLE individual.
   */
  metricsAudit?: {
    consolidatedByStatus: { FAIL: number; PASS: number; NOT_EVALUABLE: number };
    /**
     * P1.6.2 Parte A — calculado a partir de `consolidatedByStatus`
     * (FAIL + NOT_EVALUABLE, la política de persistencia actual), ANTES de
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
  // Política actual (P1.5.2/Opción B): se persisten FAIL y NOT_EVALUABLE
  // como documento `Finding`; PASS nunca se persiste.
  const expectedPersistedFindingsCount = consolidatedByStatus.FAIL + consolidatedByStatus.NOT_EVALUABLE;

  const discrepancyNote =
    actualPersistedFindingsCount !== undefined && actualPersistedFindingsCount !== expectedPersistedFindingsCount
      ? ` ADVERTENCIA: el conteo real persistido (${actualPersistedFindingsCount}) no coincide con el esperado (${expectedPersistedFindingsCount}) — posible fallo parcial de persistencia.`
      : '';

  return {
    consolidatedByStatus,
    expectedPersistedFindingsCount,
    persistedFindingsCount: actualPersistedFindingsCount,
    note:
      'Política de persistencia actual: se guardan como documento Finding los hallazgos consolidados con status FAIL o NOT_EVALUABLE; PASS nunca se persiste (ver audit-engine.service.ts paso 9). ' +
      'expectedPersistedFindingsCount es un cálculo derivado de consolidatedByStatus, previo a tocar MongoDB. ' +
      'persistedFindingsCount, cuando está presente, es el conteo real de documentos creados en este ciclo. ' +
      'infoCount y evidenceCount del Report se calculan sobre TODOS los hallazgos consolidados de Fase 2 (consolidatedByStatus), incluyendo los PASS que nunca se persisten individualmente.' +
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

/**
 * MetricsTracker — Singleton in-memory metric collector for LLM token consumption and costs.
 *
 * Pricing rates (USD per 1,000,000 tokens):
 * - gemini-2.5-flash: $0.30 input / $2.50 output
 * - gemini-2.0-flash: $0.10 input / $0.40 output
 * - default fallback: $0.30 input / $2.50 output
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
  /** J3 — aditivo: observacional únicamente, nunca incluido en cumulativeCostUsd (tarifa no verificada). */
  private cumulativeThinkingTokens = 0;

  private constructor() {}

  public static getInstance(): MetricsTracker {
    if (!MetricsTracker.instance) {
      MetricsTracker.instance = new MetricsTracker();
    }
    return MetricsTracker.instance;
  }

  /**
   * Calculates the estimated cost in USD based on model and token counts.
   */
  public calculateCost(modelName: string, promptTokens: number, outputTokens: number): number {
    const model = modelName.toLowerCase();

    let inputRatePerMillion = 0.30;
    let outputRatePerMillion = 2.50;

    if (model.includes('2.0-flash')) {
      inputRatePerMillion = 0.10;
      outputRatePerMillion = 0.40;
    } else if (model.includes('2.5-flash')) {
      inputRatePerMillion = 0.30;
      outputRatePerMillion = 2.50;
    }

    const inputCost = (promptTokens / 1_000_000) * inputRatePerMillion;
    const outputCost = (outputTokens / 1_000_000) * outputRatePerMillion;

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
    // NOTA (J3): totalTokens sigue calculándose aquí como promptTokens+outputTokens,
    // EXACTAMENTE como antes — este comportamiento NO cambia (compatibilidad
    // hacia atrás). Es un valor distinto y deliberadamente separado del
    // `totalTokenCount` que Gemini reporta por llamada (que sí puede incluir
    // thinkingTokens) — ver gemini.client.ts/checkUsageConsistency para ese
    // contraste a nivel de llamada individual. Aquí, a nivel de evaluación
    // completa, `thinkingTokens` se reporta aparte, nunca sumado en silencio.
    const totalTokens = promptTokens + outputTokens;

    const estimatedCostUsd = this.calculateCost(modelUsed, promptTokens, outputTokens);
    const costStatus: EvaluationMetrics['costStatus'] =
      params.thinkingTokens && params.thinkingTokens > 0 ? 'confirmed-excludes-unverified-thinking-cost' : 'confirmed';

    // Update cumulative state
    this.cumulativeCostUsd = Number((this.cumulativeCostUsd + estimatedCostUsd).toFixed(6));
    this.cumulativePromptTokens += promptTokens;
    this.cumulativeOutputTokens += outputTokens;
    this.cumulativeTotalTokens += totalTokens;
    this.cumulativePhase1Calls += params.phase1Calls;
    this.cumulativePhase2Calls += params.phase2Calls;
    this.cumulativeEvaluationsCount += 1;
    if (params.thinkingTokens) {
      this.cumulativeThinkingTokens += params.thinkingTokens;
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
      /** J3 — aditivo, observacional; no forma parte de cumulativeCostUsd. */
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
      console.log(`• Thinking Tokens (obs.)  : ${metrics.thinkingTokens.toLocaleString()} tokens (tarifa NO verificada, no incluida en el costo)`);
    }
    console.log(`• Total Execution Time    : ${metrics.totalExecutionTimeMs} ms`);
    console.log(`• Estimated Eval Cost     : $${metrics.estimatedCostUsd.toFixed(6)} USD${metrics.costStatus === 'confirmed-excludes-unverified-thinking-cost' ? ' (excluye costo de thinking, no verificado)' : ''}`);
    console.log(`• CUMULATIVE BACKEND COST : $${metrics.cumulativeCostUsd.toFixed(6)} USD (since startup)`);
    console.log(`================================================================================\n`);
  }
}

export const metricsTracker = MetricsTracker.getInstance();
