import { GeminiClient, RetryOptions } from '@/infrastructure/gemini/gemini.client';
import { TokenUsage } from '@/shared/infrastructure/metrics-tracker';
import {
  UxAnalysisInput,
  UxAnalysisInputSchema,
  UxAnalysisOutput,
  UxAnalysisOutputSchema,
  V2AIInputContext,
  V2AIInputContextSchema,
  V2AIOutputDecision,
  V2AIOutputDecisionSchema,
  V2AuditOutput,
  V2AuditOutputSchema,
} from './contracts/ai.contracts';
import { AppError } from '@/shared/errors/AppError';
import { measurePayload, shouldBlockBeforeSending, PayloadMeasurement } from '@/shared/testing/payload-budgets';
import {
  PrototypeAuditOutput,
  PrototypeAuditOutputSchema,
  VISUAL_PROPERTY_DEFINITIONS,
} from './contracts/prototype.contracts';
import { resolveApplicablePrototypeCriteria, PrototypeCriterionDefinition } from '@/modules/evaluations/services/prototype-criteria-resolver';
import type { Deduplicated } from '@/modules/evaluations/services/evidence-deduplication.service';
import type {
  LandmarkEvidence,
  LinkEvidence,
  ButtonEvidence,
  HeadingEvidence,
  ImageEvidence,
  FormEvidence,
  ComputedStyleEvidence,
} from '@/modules/snapshots/snapshot-evidence.model';

export interface V2AuditAnalysisInput {
  evaluationId: string;
  title: string;
  url: string;
  archetype: {
    fullName: string;
    archetype: string;
    profession: string;
    phrase: string;
    goals: string[];
    frustrations: string[];
  };
  completedSteps: string[];
  previousActions: Array<{ actionType: string; description: string; result: string }>;
  snapshotsCount: number;
  accessibilityTrees?: string[];
  evidencesSummary?: any[];
  /**
   * Phase C.2.1: landmarks/links/buttons observed across the session,
   * deduplicated to one entry per EXACT (field-by-field identical)
   * representation, each carrying its own `iterations` list — instead of
   * repeating the same nav/footer element once per iteration inside
   * `evidencesSummary`. See evidence-deduplication.service.ts.
   */
  dedupedLandmarks?: Array<Deduplicated<LandmarkEvidence>>;
  dedupedLinks?: Array<Deduplicated<LinkEvidence>>;
  dedupedButtons?: Array<Deduplicated<ButtonEvidence>>;
  /**
   * J4 Step 2 (Hardening Post-Fase H): the FINAL, budget-prioritized
   * computedStyles set (see evidence-prioritization.service.ts) — same
   * "deduplicated + iterations" shape as the three above. When present,
   * `buildV2AuditPrompt` renders these in their own section and OMITS
   * `computedStyles` from the per-iteration `evidencesSummary` block below
   * (to avoid sending the same evidence twice under two different shapes).
   */
  dedupedComputedStyles?: Array<Deduplicated<ComputedStyleEvidence>>;
  /**
   * P1.1, Parte D (integridad de la exploración) — opcional. Nota corta y
   * ya acotada (no el stack/mensaje completo de `blockingError`, que ya
   * viaja de todas formas dentro de `previousActions` sin señalizar) que
   * le indica a Gemini, en una sola línea, que la exploración se
   * interrumpió y por qué en términos generales — para que sea cauteloso
   * al atribuir un problema a la página si coincide con ese punto exacto,
   * sin duplicar información extensa que ya está presente en otra parte
   * del prompt.
   */
  explorationNote?: string;
}

/**
 * [P2 — Prototype visual evaluation] Input para
 * `AiService.performPrototypeAuditAnalysis`. Deliberadamente SIN ningún
 * campo DOM (url/snapshots/computedStyles/selectors) — la única evidencia
 * es la imagen adjunta + descripción + perfil del evaluador.
 */
export interface PrototypeAuditAnalysisInput {
  evaluationId: string;
  title?: string;
  description: string;
  /**
   * Campos del EvaluatorProfile a enviar (tabla definitiva K.2.1.1 §4):
   * archetype/profession/goals/frustrations/techSavviness/
   * accessibilityNeeds/preferredDevice siempre; biography solo si está
   * presente (se trunca aquí, no se omite por costo). maritalStatus/
   * country/city deliberadamente NUNCA incluidos.
   */
  archetype: {
    fullName: string;
    archetype: string;
    profession: string;
    phrase: string;
    goals: string[];
    frustrations: string[];
    techSavviness: string;
    accessibilityNeeds: string[];
    preferredDevice: string;
    biography?: string;
  };
  imageMimeType: string;
  /** Base64 puro (sin el prefijo `data:...;base64,`). */
  imageBase64: string;
}

/** Trunca `biography` para no inflar el prompt con texto libre de longitud no acotada (K.2.1.1 §4). */
const MAX_BIOGRAPHY_CHARS_IN_PROMPT = 400;

interface EvidenceSummarySnapshot {
  iteration: number;
  url: string;
  screenshotPath: string;
  headings: HeadingEvidence[];
  images: ImageEvidence[];
  forms: FormEvidence[];
  computedStyles: ComputedStyleEvidence[];
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Evidence Compression (Phase 2.1) — surgical optimization #1.
 *
 * SnapshotEvidence (Playwright/Mongo) keeps the full, original evidence
 * untouched — `ImageEvidence.src` still holds the real URL/data-URI there,
 * and `evidence-deduplication.service.ts` still passes it through unchanged
 * into `evidencesSummary`. This transformation happens ONLY here, as the
 * very last step before building the Gemini prompt, and produces a
 * *separate* representation — it never mutates the persisted evidence or
 * the objects evidence-deduplication.service.ts returned.
 *
 * Rationale (2026-09-10 payload/quota audit): a single `<img>` whose
 * resolved `.src` is a `data:` URI can be megabytes of base64 text that
 * carries zero evaluative signal for WCAG 1.1.1 (Gemini never dereferences
 * the URL — only presence/absence and alt/role/isDecorative matter). This
 * also strips the Mongoose-autogenerated `_id` every subdocument in
 * `headings`/`images`/`forms`/`computedStyles` carries (verified real:
 * SnapshotEvidence's sub-schemas never set `_id: false`), which is never
 * read anywhere downstream.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type ImageSrcType = 'external-url' | 'relative-url' | 'data-uri' | 'empty';

export interface ImageEvidenceForGemini {
  selector: string;
  alt: string | null;
  ariaLabel: string | null;
  role: string | null;
  isDecorative: boolean;
  srcType: ImageSrcType;
}

/**
 * Pure, local, deterministic classification of an image `src` — no network
 * resolution, no I/O. `new URL(value)` throws for anything without an
 * explicit scheme+host (relative paths, bare "logo.png", etc.), which is
 * exactly the "relative-url" case.
 */
export function classifySrcType(src: unknown): ImageSrcType {
  const value = typeof src === 'string' ? src : '';
  if (value === '') return 'empty';
  if (value.startsWith('data:')) return 'data-uri';
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return 'external-url';
  } catch {
    return 'relative-url';
  }
}

function toImageEvidenceForGemini(img: ImageEvidence): ImageEvidenceForGemini {
  return {
    selector: img.selector,
    alt: img.alt ?? null,
    ariaLabel: img.ariaLabel ?? null,
    role: img.role ?? null,
    isDecorative: !!img.isDecorative,
    srcType: classifySrcType(img.src),
  };
}

/**
 * Rebuilds each evidencesSummary snapshot as a clean plain object with an
 * explicit field whitelist — this is what naturally drops any Mongoose
 * `_id`/`__v` a subdocument may carry (they are simply never copied),
 * without needing `.lean()`/persistence changes upstream. Field selection
 * matches exactly what `buildV2AuditPrompt` already reads for each category
 * (see ai.contracts.ts / snapshot-evidence.model.ts) — nothing evaluative
 * is dropped, only `images[].src` is replaced by `srcType`.
 */
export function sanitizeEvidenceForGemini(
  evidencesSummary: EvidenceSummarySnapshot[],
): Array<Omit<EvidenceSummarySnapshot, 'images'> & { images: ImageEvidenceForGemini[] }> {
  return evidencesSummary.map((snap) => ({
    iteration: snap.iteration,
    url: snap.url,
    screenshotPath: snap.screenshotPath,
    headings: (snap.headings || []).map((h) => ({
      level: h.level,
      text: h.text,
      selector: h.selector,
    })),
    images: (snap.images || []).map(toImageEvidenceForGemini),
    forms: (snap.forms || []).map((f) => ({
      selector: f.selector,
      name: f.name ?? null,
      action: f.action ?? null,
      elements: (f.elements || []).map((el) => ({
        selector: el.selector,
        type: el.type,
        name: el.name ?? null,
        label: el.label ?? null,
        ariaLabel: el.ariaLabel ?? null,
        ariaLabelledBy: el.ariaLabelledBy ?? null,
        ariaDescribedBy: el.ariaDescribedBy ?? null,
        required: !!el.required,
        placeholder: el.placeholder ?? null,
        ariaInvalid: !!el.ariaInvalid,
      })),
    })),
    computedStyles: (snap.computedStyles || []).map((cs) => ({
      selector: cs.selector,
      tag: cs.tag,
      text: cs.text,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily,
    })),
  }));
}

/**
 * AiService — Orchestrates all AI reasoning (Decision Engine) through the model-neutral AI client.
 *
 * In V2 (Architectural Refactoring & Subetapa 3C Evidence-Based Audit):
 *   - Phase 1 (makeDecision): Ultra-lightweight navigation decision engine. 0 findings audit.
 *   - Phase 2 (performAuditAnalysis): Asynchronous evidence-based domain audit (Nielsen 10, WCAG 2.2, UX Writing).
 */
export class AiService {
  private client: GeminiClient;

  constructor() {
    this.client = GeminiClient.getInstance();
  }

  /**
   * J2 (Hardening Post-Fase H) — CRITICAL Payload Enforcement.
   *
   * Punto único de decisión, compartido por Phase 1 (makeDecision) y
   * Phase 2 (performAuditAnalysis), invocado SIEMPRE justo después de
   * construir el prompt final y ANTES de cualquier llamada a
   * `this.client.generateStructuredWithUsage`. Reutiliza, sin modificar,
   * los presupuestos ya calibrados en `payload-budgets.ts` (Fase 2.3/F) —
   * NORMAL/WARNING proceden sin cambios; CRITICAL nunca llega a Gemini.
   * Esto es exclusivamente sobre el TAMAÑO/CONTEXTO del payload de
   * EvalUXIA — no tiene relación con la cuota de 1M tokens/minuto de
   * Google, rate limiting, ni con el retry existente (fuera del alcance
   * de J2).
   */
  private evaluatePayloadBudget(phase: 1 | 2, prompt: string): { measurement: PayloadMeasurement; block: boolean } {
    const measurement = measurePayload(phase, prompt);
    const block = shouldBlockBeforeSending(measurement);
    const action = block ? 'BLOCK' : measurement.level === 'WARNING' ? 'PROCEED_WITH_WARNING' : 'PROCEED';
    console.log(
      `[GeminiPayloadBudget] phase=${phase} status=${measurement.level} estimatedInputTokens=${measurement.estimatedTokens} ` +
      `chars=${measurement.chars} bytes=${measurement.bytes} action=${action}`,
    );
    return { measurement, block };
  }

  /**
   * [V2 - Phase 1] Ultra-lightweight AI Decision Engine for tactical exploration.
   */
  async makeDecision(inputContext: V2AIInputContext): Promise<{
    result: V2AIOutputDecision;
    usage: TokenUsage;
    executionTimeMs: number;
    /** J3-retry-accounting (Hardening Post-Fase H) — optional, additive passthrough from GeminiClient. See gemini.client.ts. */
    retryAccounting?: { attempts: number; cumulativeUsage: TokenUsage };
  }> {
    const inputValidation = V2AIInputContextSchema.safeParse(inputContext);
    if (!inputValidation.success) {
      throw new AppError(
        `Invalid AI Input Context schema: ${inputValidation.error.message}`,
        400,
      );
    }

    const prompt = this.buildV2DecisionPrompt(inputContext);

    // J2 — CRITICAL bloquea ANTES de la llamada real. Phase 1 no tiene un
    // fallback seguro (una decisión de navegación inventada sería peor que
    // detener el flujo) -- se lanza un AppError tipado, que el loop de
    // evaluation.service.ts YA captura y maneja exactamente igual que
    // cualquier otro error fatal de Phase 1 (mismo patrón que Caso G/K de
    // gemini-resilience.test.ts) -- ningún estado nuevo, ninguna ruta nueva.
    const { block } = this.evaluatePayloadBudget(1, prompt);
    if (block) {
      throw new AppError(
        'AI Service Unavailable: el payload de Phase 1 excede el presupuesto seguro (CRITICAL) — bloqueado antes de enviarse a Gemini.',
        502,
      );
    }

    // TEMPORARY diagnostics (payload/quota audit) — see gemini.client.ts GeminiCallDiagnostics.
    const { data: rawResult, usage, executionTimeMs, retryAccounting } = await this.client.generateStructuredWithUsage(
      prompt,
      V2AIOutputDecisionSchema,
      undefined,
      {
        phase: 1,
        visibleDOMSummaryItems: inputContext.technicalContext.visibleDOMSummary.length,
        snapshots: 1,
        ariaNodes: 0,
      },
    );

    const resultValidation = V2AIOutputDecisionSchema.safeParse(rawResult);
    if (!resultValidation.success) {
      throw new AppError(
        `Invalid AI Output Decision schema: ${resultValidation.error.message}`,
        502,
      );
    }

    return {
      result: resultValidation.data,
      usage,
      executionTimeMs,
      ...(retryAccounting ? { retryAccounting } : {}),
    };
  }

  /**
   * [V2 - Phase 2] Specialized domain audit engine executed asynchronously after exploration completes.
   * Uses evidence-based rules, explicit Nielsen 10, WCAG 2.2 criteria, and UX Writing rules.
   */
  async performAuditAnalysis(input: V2AuditAnalysisInput): Promise<{
    result: V2AuditOutput;
    usage: TokenUsage;
    executionTimeMs: number;
    /** J3-retry-accounting (Hardening Post-Fase H) — optional, additive passthrough from GeminiClient. See gemini.client.ts. Omitted on the J2 CRITICAL-block early return (no call was made, nothing to account for). */
    retryAccounting?: { attempts: number; cumulativeUsage: TokenUsage };
  }> {
    const evidencesSummary = input.evidencesSummary || [];

    // Evidence Compression (Phase 2.1): build a Gemini-facing copy of the
    // input with images[].src replaced by srcType and Mongoose `_id`s
    // dropped from evidencesSummary — see sanitizeEvidenceForGemini above.
    // `input` itself (and evidence-deduplication.service.ts's output) is
    // never mutated; only this local copy feeds buildV2AuditPrompt.
    const promptInput: V2AuditAnalysisInput = {
      ...input,
      evidencesSummary: sanitizeEvidenceForGemini(evidencesSummary),
    };
    const prompt = this.buildV2AuditPrompt(promptInput);

    // J2 — CRITICAL bloquea ANTES de la llamada real. A diferencia de
    // Phase 1, Phase 2 SÍ tiene un fallback seguro: los findings de IA son
    // aditivos/opcionales frente a los determinísticos (AuditEngine ya
    // ignora el overallScore de Gemini y solo usa executiveSummary +
    // findings). Devolver `findings: []` reutiliza el contrato PÚBLICO
    // existente sin ningún estado nuevo -- los criterios AI-only
    // simplemente permanecen en su default NOT_EVALUABLE ya existente en
    // AuditMetricsService (nunca se inventa un estado). Cero tokens reales
    // se consumen (usage=0), porque no se realizó ninguna llamada.
    const { block } = this.evaluatePayloadBudget(2, prompt);
    if (block) {
      return {
        result: {
          overallScore: 0,
          executiveSummary:
            'El análisis de IA no pudo ejecutarse: el volumen de evidencia recopilado supera el presupuesto seguro de contexto (nivel CRITICAL). Se muestran únicamente los resultados del análisis determinístico.',
          findings: [],
        },
        usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
        executionTimeMs: 0,
      };
    }

    // TEMPORARY diagnostics (payload/quota audit) — real structural counts,
    // computed from the same (pre-transformation) objects, not re-derived
    // from the prompt string. Counts (array lengths) are unaffected by the
    // src→srcType transformation above.
    const computedStylesCount = evidencesSummary.reduce((sum, ev: any) => sum + (ev.computedStyles?.length || 0), 0);
    const headingsCount = evidencesSummary.reduce((sum, ev: any) => sum + (ev.headings?.length || 0), 0);
    const imagesCount = evidencesSummary.reduce((sum, ev: any) => sum + (ev.images?.length || 0), 0);
    const formsCount = evidencesSummary.reduce((sum, ev: any) => sum + (ev.forms?.length || 0), 0);
    const ariaNodes = (input.accessibilityTrees || []).reduce(
      (sum, tree) => sum + tree.split('\n').filter((line) => line.trim().length > 0).length,
      0,
    );

    // TEMPORARY: [GeminiImageAudit] — per-image diagnostic to confirm/deny
    // the "images[].src is a data: URI" hypothesis from the payload-size
    // audit (2026-09-10). Logs metadata and counts only — NEVER the full
    // src content (max 50-char preview) — and does not alter `input` or the
    // prompt built above, so the actual request to Gemini is unaffected.
    for (const snap of evidencesSummary as any[]) {
      (snap.images || []).forEach((img: any, idx: number) => {
        const src: string = typeof img.src === 'string' ? img.src : '';
        const isDataUri = src.startsWith('data:');
        const mimeMatch = isDataUri ? src.match(/^data:([^;,]*)/) : null;
        const hasBase64Marker = isDataUri && src.includes(';base64,');
        const approxSizeMB = (src.length / 1_000_000).toFixed(3);
        console.log(
          `[GeminiImageAudit] snapshot=${snap.iteration} index=${idx} selector=${img.selector ?? 'n/a'} ` +
          `alt=${JSON.stringify(img.alt ?? null)} role=${img.role ?? 'null'} isDecorative=${img.isDecorative ?? 'n/a'} ` +
          `srcLength=${src.length} isDataUri=${isDataUri} mimeType=${mimeMatch?.[1] || 'n/a'} ` +
          `hasBase64Marker=${hasBase64Marker} approxSizeMB=${approxSizeMB} srcPreview=${JSON.stringify(src.slice(0, 50))} ` +
          `srcTypeSentToGemini=${classifySrcType(img.src)}`,
        );
      });
    }

    const { data: rawResult, usage, executionTimeMs, retryAccounting } = await this.client.generateStructuredWithUsage<V2AuditOutput>(
      prompt,
      V2AuditOutputSchema,
      undefined,
      {
        phase: 2,
        evaluationId: input.evaluationId,
        snapshots: input.snapshotsCount,
        ariaNodes,
        computedStylesCount,
        headingsCount,
        imagesCount,
        formsCount,
        landmarksCount: input.dedupedLandmarks?.length ?? 0,
        linksCount: input.dedupedLinks?.length ?? 0,
        buttonsCount: input.dedupedButtons?.length ?? 0,
      },
    );

    const result: V2AuditOutput = rawResult;
    return { result, usage, executionTimeMs, ...(retryAccounting ? { retryAccounting } : {}) };
  }

  /**
   * [P2 — Prototype visual evaluation] Specialized multimodal audit for a
   * single static prototype image. Mirrors `performAuditAnalysis`'s shape
   * (payload budget gate -> prompt -> Gemini call -> return), but calls
   * `generateMultimodalStructuredWithUsage` (text + image) instead of the
   * text-only path, and validates against `PrototypeAuditOutputSchema`
   * (never `V2AuditOutputSchema` -- WEB's contract is untouched).
   *
   * J2 payload-budget gating here covers ONLY the TEXT portion of the
   * prompt (same `measurePayload`/`shouldBlockBeforeSending` thresholds
   * reused as-is) -- there is no image-aware budget model yet (confirmed
   * gap, documented in the K.1 design phase), so the image's own size is
   * never part of this gate's decision.
   */
  async performPrototypeAuditAnalysis(
    input: PrototypeAuditAnalysisInput,
    /**
     * [P7.0.1] OPCIONAL y aditivo — por defecto `undefined`, que preserva
     * EXACTAMENTE el comportamiento actual (política global
     * `AI_RETRY_CONFIG`, 3 reintentos, igual que WEB). Existe
     * ÚNICAMENTE para que un llamador explícito (ej. el runner de un
     * experimento real de bajo costo) pueda acotar el número de intentos
     * físicos para ESA llamada puntual -- nunca cambia el default de
     * `PrototypeEvaluationService` (que no lo pasa) ni la política de
     * `GeminiClient.executeWithRetry`/WEB.
     */
    retryOpts?: RetryOptions,
  ): Promise<{
    result: PrototypeAuditOutput;
    usage: TokenUsage;
    executionTimeMs: number;
    retryAccounting?: { attempts: number; cumulativeUsage: TokenUsage };
  }> {
    const applicableCriteria = resolveApplicablePrototypeCriteria();
    const prompt = this.buildPrototypeAuditPrompt(input, applicableCriteria);

    const { block } = this.evaluatePayloadBudget(2, prompt);
    if (block) {
      return {
        result: {
          overallScore: 0,
          executiveSummary:
            'El análisis de IA no pudo ejecutarse: el volumen de contexto textual supera el presupuesto seguro (nivel CRITICAL). No se envió ninguna llamada a Gemini.',
          findings: [],
        },
        usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
        executionTimeMs: 0,
      };
    }

    const { data: rawResult, usage, executionTimeMs, retryAccounting } =
      await this.client.generateMultimodalStructuredWithUsage<PrototypeAuditOutput>(
        prompt,
        { mimeType: input.imageMimeType, data: input.imageBase64 },
        PrototypeAuditOutputSchema,
        retryOpts,
        { phase: 'prototype', snapshots: 1 },
      );

    return { result: rawResult, usage, executionTimeMs, ...(retryAccounting ? { retryAccounting } : {}) };
  }

  /**
   * [V1 Legacy] Performs a full UX analysis of a page given its DOM snapshot and context.
   */
  async analyzeUx(input: UxAnalysisInput): Promise<{ result: UxAnalysisOutput; executionTimeMs: number }> {
    const inputValidation = UxAnalysisInputSchema.safeParse(input);
    if (!inputValidation.success) {
      throw new AppError(`Invalid UX Analysis Input: ${inputValidation.error.message}`, 400);
    }

    const prompt = this.buildUxAnalysisPrompt(input);
    const { data: rawResult, executionTimeMs } = await this.client.generateStructuredWithUsage(
      prompt,
      UxAnalysisOutputSchema,
    );

    const resultValidation = UxAnalysisOutputSchema.safeParse(rawResult);
    if (!resultValidation.success) {
      throw new AppError(`Invalid UX Analysis Output from AI: ${resultValidation.error.message}`, 502);
    }

    return {
      result: resultValidation.data,
      executionTimeMs,
    };
  }

  /**
   * Builds Phase 1 Decision Prompt.
   */
  private buildV2DecisionPrompt(ctx: V2AIInputContext): string {
    return `
You are EvalUXIA's AI Navigation Agent (Phase 1).
Your task is to propose the SINGLE MOST LOGICAL next browser action to explore the target webpage based ONLY on the user persona's goals and visible DOM elements.

---

### EVALUATION CONTEXT:
- Evaluation ID: "${ctx.metadata.evaluationId}"
- Iteration: ${ctx.metadata.iteration}
- Current Target URL: "${ctx.technicalContext.url}"
- Overall Flow Description: "${ctx.flowDefinition.flowDescription}"
- Current Step Objective: "${ctx.flowDefinition.currentStepObjective}"
- Evaluated Persona Archetype: ${ctx.userArchetype.fullName} (${ctx.userArchetype.archetype}, ${ctx.userArchetype.profession})
  - Phrase: "${ctx.userArchetype.phrase}"
  - Personality: "${ctx.userArchetype.personality}"
  - Goals: ${ctx.userArchetype.goals.join(', ')}
  - Frustrations: ${ctx.userArchetype.frustrations.join(', ')}

---

### PREVIOUS ACTIONS EXECUTED:
${JSON.stringify(ctx.flowState.previousActions, null, 2)}
${ctx.flowState.blockingError ? `\n⚠️ BLOCKING ERROR IN LAST ACTION: "${ctx.flowState.blockingError}". Pick an alternative element or STOP_FLOW.\n` : ''}

---

### VISIBLE INTERACTIVE DOM ELEMENTS AVAILABLE ON CURRENT PAGE:
\`\`\`json
${JSON.stringify(ctx.technicalContext.visibleDOMSummary, null, 2)}
\`\`\`

---

### AVAILABLE ACTIONS CONSTRAINTS:
1. You may ONLY choose ONE action:
   - "CLICK" (selector required, e.g. "button#submit", "a.link-class")
   - "TYPE" (selector + inputData required, e.g. selector "input[type='number']", inputData "12345")
   - "SELECT" (selector + inputData required, e.g. selector "select#dropdown", inputData "2")
   - "CHECK" (selector required)
   - "UNCHECK" (selector required)
   - "HOVER" (selector required)
   - "FOCUS" (selector required)
   - "CLEAR" (selector required)
   - "NAVIGATE" (inputData URL required)
   - "STOP_FLOW" (no selector, indicates goal achieved or page unnavigable)

2. Absolute Rule: Do NOT invent hidden or non-existent selectors. Use exact CSS selectors matching the elements provided above.

---

Respond ONLY with valid JSON matching this exact structure:
{
  "evaluationSummary": {
    "flowCanContinue": true
  },
  "suggestedAction": {
    "actionType": "<CLICK|TYPE|SELECT|CHECK|UNCHECK|HOVER|FOCUS|CLEAR|NAVIGATE|STOP_FLOW>",
    "targetElement": {
      "matchStrategy": "CSS",
      "value": "<exact css selector from provided elements, null for STOP_FLOW>"
    },
    "inputData": "<text to type, option value to select, or null>",
    "rationale": "<brief tactical justification>",
    "confidence": "<high|medium|low>"
  },
  "flowControl": {
    "isStopper": false,
    "stopperReason": null,
    "recommendedNextStep": "<executeSuggestedAction|requestMoreContext|stopFlow>"
  }
}
`.trim();
  }

  /**
   * Builds Phase 2 Evidence-Based Domain Audit Prompt (Subetapa 3C).
   *
   * Hardening (post Gemini Real #1): la lista de criterios WCAG de este
   * prompt listaba solo 7 de los 10 códigos de `SUPPORTED_WCAG_CRITERIA`
   * (audit-metrics.service.ts) -- WCAG 1.4.1, 2.4.6 y 3.2.2 nunca se le
   * pedían a Gemini, por lo que esos 3 slots quedaban permanentemente en
   * NOT_EVALUABLE sin importar el contenido real de la página. Se agregaron
   * 1.4.1 (Uso del color) y 2.4.6 (Encabezados y etiquetas) porque la
   * evidencia ya enviada (computedStyles, headings, labels) es suficiente
   * para que Gemini razone sobre ellos sin inventar nada. WCAG 3.2.2 (On
   * Input: un cambio de valor en un control no debe disparar un cambio de
   * contexto automático) NO se agregó deliberadamente: requiere evidencia
   * de comportamiento dinámico (antes/después de una interacción específica
   * ligada a un control) que el bundle de evidencia actual no captura de
   * forma estructurada (ver auditoría de extracción) -- agregarlo
   * incentivaría a Gemini a especular desde narrativa, violando la regla
   * "NO EVIDENCE = NO FAIL" ya establecida en este mismo prompt. Queda
   * documentado como gap aceptable del MVP, no como corrección de esta fase.
   *
   * Hardening K.1, Parte E: por la misma razón, WCAG 2.1.1 (Teclado) se
   * ELIMINÓ de esta lista (antes listado sin evidencia real que lo
   * respalde). Confirmado en la auditoría de extracción (Fase K): no existe
   * ningún campo estructurado de evidencia para navegación por teclado
   * (sin tabindex, sin simulación de teclado, sin registro de foco/orden).
   * Pedirle a Gemini que evalúe esto solo podría producir un FAIL/PASS
   * imaginado, nunca trazable a datos reales -- 100% en contra del
   * principio "Gemini no debe ser instruido para evaluar algo que EvalUXIA
   * no puede observar". `WCAG 2.1.1` permanece en `SUPPORTED_WCAG_CRITERIA`
   * (audit-metrics.service.ts) únicamente para que el slot exista en la
   * matriz de 10 criterios y se reporte, correcta y honestamente, como
   * `NOT_EVALUABLE` -- nunca como un PASS/FAIL fabricado.
   */
  private buildV2AuditPrompt(input: V2AuditAnalysisInput): string {
    // J4 Step 2 (Hardening Post-Fase H): when the caller provides the new
    // prioritized `dedupedComputedStyles`, that becomes the SOLE source for
    // computedStyles in the prompt — `computedStyles` is stripped from the
    // per-iteration evidencesSummary block below to avoid sending the same
    // evidence twice under two shapes. When absent (every caller predating
    // J4 Step 2), behavior is 100% unchanged: computedStyles still travels
    // inline per iteration, exactly as before.
    const usesPrioritizedComputedStyles = !!input.dedupedComputedStyles;
    const evidencesSummaryForPrompt = usesPrioritizedComputedStyles
      ? (input.evidencesSummary || []).map(({ computedStyles, ...rest }: any) => rest)
      : (input.evidencesSummary || []);

    return `
You are EvalUXIA's Evidence-Based Specialized Domain Audit Engine (Phase 2).
Your task is to conduct a rigorous, formal UX and Accessibility Audit on the full navigation session executed by a user persona.

---

### ABSOLUTE AUDIT RULE: NO EVIDENCE = NO FAIL
1. Every "FAIL" status finding MUST be grounded in direct, verifiable technical evidence provided below (DOM attributes, computed styles, headings hierarchy, or ARIA tree).
2. If evidence for a criterion is insufficient or absent, classify the status as "NOT_EVALUABLE" or "PASS". Do NOT generate speculative, hypothetical conditional findings using words like "might", "could", "may", "if implemented".
3. Every "FAIL" finding MUST include a concrete, actionable recommendation explaining exactly what the developer or designer should fix. NEVER use the heuristic code or name as the recommendation.
4. Each finding's 'wcagCriterion' MUST contain EXACTLY ONE WCAG code (e.g. "WCAG 3.3.2 Etiquetas o instrucciones"). NEVER combine multiple WCAG codes into a single 'wcagCriterion' string. If the same element/problem is independently supported by evidence for more than one WCAG criterion, emit ONE SEPARATE finding per criterion (same 'affectedElement', its own 'evidence' and 'recommendation' for that specific criterion). Do NOT create an additional finding for a criterion that is merely plausible, related, or inferable — only for a criterion whose own evidence meets the same bar as rule 1 above.

---

### EVALUATION SESSION CONTEXT:
- Title: "${input.title}"
- Target URL: "${input.url}"
- Evaluated Archetype: ${input.archetype.fullName} (${input.archetype.archetype}, ${input.archetype.profession})
  - Phrase: "${input.archetype.phrase}"
  - User Goals: ${input.archetype.goals.join(', ')}
  - User Frustrations: ${input.archetype.frustrations.join(', ')}
- Completed Steps Sequence: ${input.completedSteps.join(' -> ') || 'None'}
- Executed Actions History:
${JSON.stringify(input.previousActions, null, 2)}
- Total Snapshots Analyzed: ${input.snapshotsCount}${input.explorationNote ? `
- ⚠️ EXPLORATION STATUS: ${input.explorationNote} Be cautious about attributing a UX/accessibility problem to the page's own design if it coincides with this specific interruption point — verify it is actually observable in the evidence below, independent of the interruption.` : ''}

---

### STRUCTURED TECHNICAL EVIDENCE BUNDLE FOR ALL SESSION ITERATIONS:
Each iteration below includes headings/images/forms${usesPrioritizedComputedStyles ? '' : '/computedStyles'} observed at that step.
Landmarks, links and buttons are NOT repeated here — see the deduplicated section right after
this one, which covers those three element types for the entire session.${usesPrioritizedComputedStyles ? ' computedStyles are ALSO not repeated here — see that same deduplicated section for a prioritized, session-wide computedStyles set.' : ''}
\`\`\`json
${JSON.stringify(evidencesSummaryForPrompt, null, 2)}
\`\`\`

${(input.dedupedLandmarks?.length || input.dedupedLinks?.length || input.dedupedButtons?.length) ? `
### SHARED STRUCTURAL ELEMENTS (LANDMARKS, LINKS, BUTTONS) OBSERVED ACROSS THE SESSION:
Each item below carries an "iterations" array listing every iteration (snapshot) in which that
EXACT element (same selector, text/href/role and state) was observed. This replaces repeating
identical landmarks/links/buttons once per iteration above. An element whose "iterations" list
does NOT cover every iteration in the session (see "Total Snapshots Analyzed" above) means it
was only present, or only had that exact state, during those specific iterations — treat that
as meaningful evidence of a state or content change between iterations, not as missing data. If
the SAME selector appears with a different state (e.g. isDisabled changes) in different
iterations, it appears here as TWO separate entries, each with its own "iterations" list.

Landmarks:
\`\`\`json
${JSON.stringify(input.dedupedLandmarks || [], null, 2)}
\`\`\`

Links:
\`\`\`json
${JSON.stringify(input.dedupedLinks || [], null, 2)}
\`\`\`

Buttons:
\`\`\`json
${JSON.stringify(input.dedupedButtons || [], null, 2)}
\`\`\`
` : ''}

${input.dedupedComputedStyles?.length ? `
### COMPUTED STYLES OBSERVED ACROSS THE SESSION (prioritized subset):
Same "iterations" convention as the section above. This is a PRIORITIZED subset of all the
visual/text elements observed this session (bounded to keep the prompt within budget) — elements
already covered by another evidence type above (a link, button, heading, image or form field)
were favored, along with elements already flagged by a deterministic finding, but a guaranteed
minimum of plain text/label elements is always included too, specifically so contrast issues in
ordinary body text are never systematically overlooked just because there were many other
elements on the page.
\`\`\`json
${JSON.stringify(input.dedupedComputedStyles, null, 2)}
\`\`\`
` : ''}

${input.accessibilityTrees && input.accessibilityTrees.length > 0 ? `\n### ACCESSIBILITY ARIA SNAPSHOTS:\n${input.accessibilityTrees.join('\n---\n')}\n` : ''}

---

### DOMAIN EVALUATION FRAMEWORKS & EXPLICIT RULES:

1. **JAKOB NIELSEN'S 10 USABILITY HEURISTICS (UX Domain)**:
   - **N-01: Visibilidad del estado del sistema**
   - **N-02: Coincidencia entre el sistema y el mundo real**
   - **N-03: Control y libertad del usuario**
   - **N-04: Consistencia y estándares**
   - **N-05: Prevención de errores**
   - **N-06: Reconocimiento antes que recuerdo**
   - **N-07: Flexibilidad y eficiencia de uso**
   - **N-08: Diseño estético y minimalista**
   - **N-09: Ayudar a reconocer, diagnosticar y recuperarse de errores**
   - **N-10: Ayuda y documentación**

2. **WCAG 2.2 CORE ACCESSIBILITY CRITERIA (Accessibility Domain)**:
   - **WCAG 1.1.1 Contenido no textual** (Imágenes, iconos)
   - **WCAG 1.3.1 Información y relaciones** (Headings h1-h6, estructuras semánticas)
   - **WCAG 1.4.1 Uso del color** (El color NO debe ser el único medio visual para transmitir información -- evalúa solo a partir del texto/computedStyles entregados, nunca infieras significado de color que no esté acompañado de texto/ícono descrito en la evidencia)
   - **WCAG 1.4.3 Contraste mínimo** (Color texto/fondo)
   - **WCAG 2.4.4 Propósito de los enlaces** (Nombres accesibles de links)
   - **WCAG 2.4.6 Encabezados y etiquetas** (Los headings y labels de formulario deben describir su tema o propósito, no ser genéricos -- evalúa solo a partir del texto de headings/labels entregado en la evidencia)
   - **WCAG 3.3.2 Etiquetas o instrucciones** (Labels visibles en formularios)
   - **WCAG 4.1.2 Nombre, función y valor** (Name, Role y Value accesibles en botones/controles)

---

Respond ONLY with valid JSON matching this exact structure:
{
  "overallScore": <number 0-100>,
  "executiveSummary": "<Markdown formatted executive summary analyzing the session UX and WCAG compliance for the archetype>",
  "findings": [
    {
      "findingGroup": "<ux|accessibility>",
      "type": "<usability|content|interaction|visual|wcag>",
      "status": "<PASS|FAIL|NOT_EVALUABLE>",
      "severity": "<critical|high|medium|low|info>",
      "confidence": "<high|medium|low>",
      "heuristicCode": "<e.g. N-01>",
      "heuristicName": "<e.g. Visibilidad del estado del sistema>",
      "wcagCriterion": "<exactly one code, e.g. WCAG 1.4.3 Contraste (Mínimo) — never combine multiple codes here>",
      "description": "<detailed problem description grounded in evidence>",
      "evidence": [
        {
          "type": "<DOM_ATTRIBUTE|COMPUTED_STYLE|ACCESSIBILITY_TREE|SCREENSHOT|INTERACTION|HEADING_STRUCTURE>",
          "property": "<property name or null>",
          "value": "<observed value>",
          "selector": "<css selector>"
        }
      ],
      "affectedElement": {
        "tag": "<tag>",
        "text": "<text>",
        "selector": "<selector>",
        "role": "<role or null if element has no ARIA role>"
      },
      "impact": "<user impact explanation>",
      "recommendation": "<actionable fix recommendation for developer>",
      "affectedArchetypeTraits": ["<trait1>"]
    }
  ]
}

CRITICAL RULE FOR EVIDENCE:
Each item in the 'evidence' array MUST use EXCLUSIVELY one of these 6 exact string values for 'type':
- DOM_ATTRIBUTE (for HTML attributes like alt, href, aria-label, role, disabled)
- COMPUTED_STYLE (for CSS styles like color, background-color, contrastRatio)
- ACCESSIBILITY_TREE (for ARIA node names, roles, screen reader tree)
- SCREENSHOT (for visual screenshot evidence)
- INTERACTION (for URL location, navigation steps, form actions)
- HEADING_STRUCTURE (for document heading hierarchy)

Do NOT invent custom type names such as CURRENT_URL or BUTTON_PROPERTIES. Use 'property' to specify the concrete attribute observed (e.g. type: "INTERACTION", property: "url", value: "...").

Note for affectedElement: fields like tag, text, selector, role, ariaLabel, href, id can be omitted or set to null if not available for the target element.

---

DETERMINISTIC EVIDENCE PRIORITY:
The computedStyles[] bundle already contains backend-calculated contrast ratios computed with the
W3C sRGB formula. These are authoritative measurements. You MUST NOT re-calculate or estimate
contrast ratios yourself. If you reference color contrast in a finding, use ONLY the values
already present in the evidence bundle (contrastRatio field). Do not introduce your own numeric
ratio estimate.

EVIDENCE SELECTOR COHERENCE:
Each item in the 'evidence[]' array for a given finding MUST reference ONLY the element identified
by that finding's 'affectedElement.selector'. Do NOT include evidence items whose selector
corresponds to a different DOM element. If you observe a problem on element A, do not add evidence
from element B to the same finding, even if both share the same WCAG criterion.

---

N-01 SPECIFIC CONSTRAINT (Visibilidad del estado del sistema):
Report FAIL for N-01 ONLY when ALL of the following conditions are confirmed from the evidence:
  1. A user action (CLICK, SUBMIT, or TYPE+CLICK) was executed on an interactive element.
  2. The interactive element explicitly indicated navigation to a different resource (href to a
     different path, a submit button, or a form action).
  3. The URL remained unchanged across snapshots AND no visible DOM content change (new headings,
     new sections, new form results) is observable between the before/after snapshots.
  4. No loading indicator, spinner, disabled state, or transition feedback is visible in the DOM.

Do NOT declare FAIL for N-01 solely because the URL did not change. Client-side routing, hash
navigation, SPA content injection, and AJAX updates are all valid patterns that do not change the
URL. If it cannot be determined whether the page is a SPA or uses dynamic content updates,
classify as NOT_EVALUABLE instead of FAIL.
`.trim();
  }

  /**
   * [P2 — Prototype visual evaluation] Builds the text portion of the
   * prototype audit prompt (sección 17). The image itself is NEVER embedded
   * in this string -- it travels as a separate multimodal Part (see
   * `performPrototypeAuditAnalysis`). Covers the 10 required points:
   * description, evaluator profile, applicable criteria, visual evidence
   * rules, identity rules, abstention rule, contrast rule, output contract,
   * no-invented-properties rule, no-DOM/behavioral-inference rule.
   */
  private buildPrototypeAuditPrompt(
    input: PrototypeAuditAnalysisInput,
    applicableCriteria: PrototypeCriterionDefinition[],
  ): string {
    const criteriaList = applicableCriteria
      .map((c) => `   - **${c.code} ${c.name}** (${c.coverage}): ${c.note}`)
      .join('\n');

    const propertyList = Object.entries(VISUAL_PROPERTY_DEFINITIONS)
      .map(([key, def]) => `   - **${key}** (${def.valueType}): ${def.meaning} Ejemplo: ${def.example}. NO permite afirmar: ${def.doesNotConfirm}`)
      .join('\n');

    const biography = input.archetype.biography
      ? input.archetype.biography.slice(0, MAX_BIOGRAPHY_CHARS_IN_PROMPT)
      : undefined;

    return `
You are EvalUXIA's Evidence-Based Prototype Visual Audit Engine.
Your task is to evaluate a SINGLE STATIC PROTOTYPE IMAGE for UX and accessibility problems, from the
perspective of a specific user persona, using ONLY what is visually observable in the attached image.

---

### ABSOLUTE RULE: THE IMAGE IS YOUR ONLY SOURCE OF TRUTH
1. You may use ONLY: the attached image, the prototype description below, and the evaluator persona below.
2. If the image does not provide enough evidence to evaluate a criterion for a specific element, return
   status "NOT_EVALUABLE" for that finding (or omit the finding entirely). Do NOT guess.
3. Do NOT infer DOM semantics, accessibility tree properties, keyboard behavior, focus behavior, screen
   reader behavior, hidden states, or any implementation detail that cannot be seen in a static image.
4. Do NOT invent a CSS selector, an HTML tag, or any DOM-only property. This is an image, not a webpage.
5. Every "FAIL" finding MUST include a concrete, actionable recommendation. NEVER use the heuristic code
   or name as the recommendation.

---

### PROTOTYPE CONTEXT:
- Title: "${input.title || 'Prototipo sin título'}"
- Description (provided by the user, explains the screen/context): "${input.description}"

---

### EVALUATED PERSONA (context for interpretation, NOT a real person, NOT an autonomous agent):
- ${input.archetype.fullName} (${input.archetype.archetype}, ${input.archetype.profession})
- Phrase: "${input.archetype.phrase}"
- Goals: ${input.archetype.goals.join(', ') || 'None declared'}
- Frustrations: ${input.archetype.frustrations.join(', ') || 'None declared'}
- Tech savviness: ${input.archetype.techSavviness}
- Accessibility needs: ${input.archetype.accessibilityNeeds.join(', ') || 'None declared'}
- Preferred device: ${input.archetype.preferredDevice}
${biography ? `- Biography (context only): "${biography}"` : ''}

---

### APPLICABLE CRITERIA FOR THIS EVALUATION (evaluate ONLY these -- never any other WCAG/Nielsen code):
${criteriaList}

---

### CRITERION ASSIGNMENT RULE (one principal criterion per finding):
1. Each finding MUST have EXACTLY ONE principal criterion: either ONE Nielsen heuristic code ('heuristicCode')
   OR ONE WCAG code ('wcagCriterion') -- NEVER both on the same finding object.
2. If the same visual situation independently supports a genuine Nielsen usability problem AND a genuine,
   separately-evidenced WCAG problem, emit TWO SEPARATE findings -- one per criterion, each with its own
   'evidence' and its own 'recommendation' grounded specifically in that criterion. Do NOT emit a second
   finding for a criterion that is merely related, plausible, or inferable from the first -- only when that
   second criterion's own evidence independently meets the same evidentiary bar as any other finding.
3. Do NOT force a WCAG classification when the image only supports a usability/visual-clarity observation.
   When a control lacks a visible textual indicator of its purpose (e.g. an icon-only button), prefer the
   applicable Nielsen usability criteria that address recognizability (e.g. N-02, N-06) over WCAG 1.1.1 --
   WCAG 1.1.1 concerns a programmatic text alternative, which a static image cannot demonstrate. Only invoke
   a WCAG criterion for this kind of element when its own definition matches something you can actually see
   (e.g. WCAG 2.4.6 for a label whose VISIBLE text is present but non-descriptive -- never for an absent one).

---

### VISUAL EVIDENCE RULES:
1. Every item in a finding's 'evidence' array MUST have 'type': "VISUAL_OBSERVATION".
2. Every evidence item MUST include 'elementDescription' (a specific, concrete description of the element
   you are observing, e.g. "botón Guardar en la esquina inferior derecha") AND/OR 'context' (narrative
   context for a page-level observation).
3. If you cite a 'property', you MUST use EXCLUSIVELY one of these exact whitelisted names, together with
   a 'value':
${propertyList}
4. Do NOT invent a property name not in this list.
5. Declare 'region' (one of: top-left, top-center, top-right, middle-left, center, middle-right,
   bottom-left, bottom-center, bottom-right, full-screen) whenever you can identify where the element is.
6. When your observation concerns the PRESENCE OR ABSENCE of a property (e.g. no visible text next to an
   icon, no visible label near a field), still cite the relevant whitelisted property together with its
   'value' whenever it is genuinely observable and applicable to the described element -- this makes the
   observation structurally verifiable, in addition to any 'context' you provide. For an absence of visible
   text, you may use property: "visibleText" with value: "" (empty string), but ONLY when the image actually
   supports that absence for that specific element.
7. Do NOT force a property/value pair when no whitelisted property can faithfully represent what you
   observed -- inventing a value is worse than leaving it out. In that case, describe the limitation using
   'context' only, and explain why it cannot be stated more precisely.
8. An absence of visible text is a purely VISUAL observation. It NEVER proves, and must NEVER be described
   as proving, the absence of a DOM accessible name (aria-label, alt), a keyboard/focus problem, dynamic
   behavior, or anything about assistive technology -- all of those are invisible to a static image.

---

### IDENTITY RULE (CRITICAL -- avoid false contradictions):
When multiple elements share the same region (e.g. three buttons in a row), a generic 'elementDescription'
like "botón" or "enlace" is NOT enough to distinguish them. If several similar elements are visible in the
same area, your 'elementDescription' MUST be specific enough to distinguish them (e.g. "botón Guardar
(segundo de tres en la barra de acciones)" instead of just "botón"). Region alone is spatial context, NEVER
element identity.

---

### ABSTENTION RULE:
If you cannot determine, from the image alone, whether a criterion is met for a specific element, do NOT
fabricate a FAIL or PASS. Omit the finding, or mark it NOT_EVALUABLE.

---

### POSITIVE COMPLIANCE RULE (PASS -- read together with the ABSTENTION RULE above):
A finding may have status "PASS" ONLY when the image itself provides POSITIVE, STRUCTURED evidence that the
specific element you examined actually satisfies the visual aspect of the criterion -- never merely because
you found no problem. NOT finding evidence of a violation is NOT the same as finding evidence of compliance.
Do not aim for a minimum number of PASS findings, and do not treat a higher PASS count as a better outcome --
if you did not specifically find a concrete, positive instance of the criterion being met, omit the finding,
or use "NOT_EVALUABLE" instead.

1. STRUCTURED EVIDENCE IS MANDATORY: a "PASS" finding MUST include at least one evidence item that has, in
   the SAME item, 'type': "VISUAL_OBSERVATION", a whitelisted 'property' (see VISUAL EVIDENCE RULES above), a
   concrete 'value' describing what you actually saw, AND a specific 'elementDescription' identifying that
   element (same specificity bar as the IDENTITY RULE above). A 'property' cited in one evidence item and a
   'value' cited in a different item do NOT count together -- both must appear in the SAME item. A "PASS"
   supported ONLY by a narrative 'context' sentence, with no item carrying both 'property' and 'value', is
   NOT acceptable -- omit it, or use "NOT_EVALUABLE" instead, exactly as you would for an unsupported FAIL.
   You do not need every evidence item on a PASS finding to be structured this way -- only at least one.

2. NARROW SCOPE -- say only what the image shows: describe exclusively the specific visual aspect you
   verified, never generalize to the full criterion. For example:
     - Correct: "El campo de correo electrónico presenta una etiqueta visible situada encima del control."
     - Incorrect: "El campo de correo electrónico tiene una asociación semántica correcta."
     - Correct: "El botón presenta el texto visible 'Guardar cambios'."
     - Incorrect: "El botón funciona correctamente y ejecuta la acción esperada."
   When your observation only covers a partial aspect of a broader criterion, say so explicitly in the
   description -- never let a partial PASS be read as full compliance with the WCAG or Nielsen criterion.

3. VISUAL VS. NON-VISUAL DIMENSIONS: when a criterion has both a visual dimension and a semantic,
   programmatic, or behavioral dimension that a static image cannot show, you MAY still emit "PASS" for the
   visual dimension alone when you have sufficient evidence for it -- this is not forbidden. What you must
   NEVER do is use that visual observation to also claim the non-visual dimension is satisfied. For four of
   these criteria (1.1.1, 1.3.1, 1.4.3, 3.3.2) this asymmetry runs in BOTH directions, not just toward PASS:
   a NEGATIVE visual observation (an absence, a mismatch, a qualitative impression) is just as unable to
   demonstrate the non-visual dimension as a positive one is -- for these four, this system will always
   record the evaluation as "NOT_EVALUABLE" for conformity purposes regardless of whether you write "PASS" or
   "FAIL", precisely because neither can ever be objectively demonstrated from a static image alone. You may,
   and should, still describe exactly what you observed (favorable or not) as a grounded visual observation --
   that description and evidence are valuable and are preserved -- but never word it as if it settled the
   criterion's compliance or violation. In particular:
     - WCAG 1.1.1: visible text next to a non-text element does NOT by itself demonstrate that the element
       has an adequate programmatic text alternative -- and, symmetrically, the ABSENCE of visible text next
       to it does NOT by itself demonstrate the absence of one either (a programmatic alt/aria-label can exist
       with zero visible indicator, by design).
     - WCAG 1.3.1: a correct VISUAL hierarchy does NOT demonstrate the document's real semantic structure --
       and, symmetrically, an inconsistent or flat VISUAL hierarchy does NOT demonstrate that the underlying
       semantic structure (h1-h6, landmarks) is actually wrong.
     - WCAG 1.4.3: a qualitative visual impression of contrast does NOT demonstrate a numeric WCAG contrast
       ratio in EITHER direction -- keep applying the CONTRAST RULE and the confidence cap from the CONFIDENCE
       AND SEVERITY CALIBRATION RULE below; neither a "PASS" nor a "FAIL" built on a qualitative contrast
       impression (e.g. "appears-sufficient" or "appears-low") is ever an objective verification of WCAG 1.4.3
       conformity, and neither may ever be assigned "high" confidence.
     - WCAG 2.4.4: a generic-sounding link text is NOT automatically a violation if its purpose can genuinely
       be determined from the visible surrounding context -- do not force a FAIL here either, just because
       the text alone looks generic in isolation. Separately: when multiple links share identical or
       near-identical visible text, you can NEVER determine from a static image whether they actually lead to
       the same destination or to different ones -- never conclude, state, or imply that such links share a
       destination, point to different destinations, or are therefore inconsistent; if this specific aspect is
       not visually determinable, omit it or mark it "NOT_EVALUABLE" instead of guessing.
     - WCAG 3.3.2: a label's visual proximity to a field does NOT demonstrate its programmatic association
       (e.g. <label for>) -- and, symmetrically, the ABSENCE of a visually proximate label does NOT
       demonstrate the absence of that association either (a visually-hidden label or an aria-label with no
       visible text can satisfy it without being visible at all).
     - N-03: not observing an exit/cancel control in a single captured screen does NOT by itself demonstrate
       that no alternative way to navigate back or recover exists elsewhere.
     - N-05: the absence of a visible error-prevention indicator does NOT demonstrate that the prevention
       behavior itself is incorrect -- keep applying the DYNAMIC / INTERACTIVE BEHAVIOR RULE below for this
       criterion exactly as already stated there.

---

### DYNAMIC / INTERACTIVE BEHAVIOR RULE (CRITICAL -- static image, single frame, no interaction ever occurred):
This image is a single, static, UNTOUCHED frame. No field was ever typed into, no button was ever clicked, no
form was ever submitted. Before concluding a FAIL, classify what your conclusion actually depends on:
  A. A direct visual observation (a text, a label, a color, a layout, a static control that is or isn't
     rendered right now) -- this is normally gradable as FAIL when genuinely unsupported.
  B. The VISUAL ABSENCE of an element in this single frame -- this proves only that the element is not
     rendered in THIS frame. It never proves that the underlying mechanism or functionality does not exist
     elsewhere, through another means, or in a different state of the same screen.
  C. A behavior that, by its own nature, only becomes visible AFTER an interaction this image never shows
     (typing, submitting, hovering, focusing, an invalid input, a successful/failed action) -- a static,
     untouched frame can NEVER demonstrate the absence of this kind of behavior, because it would look
     IDENTICAL whether the behavior exists or not (nothing has happened yet to trigger it either way).
  D. DOM/accessibility-tree information (an aria-label, a programmatic association, keyboard/focus behavior)
     -- already covered by the rules above: never infer this from pixels.
For category C specifically -- real-time validation, inline error messages, warning states, a confirmation
screen/message after submission, any "success" or "error" state of a form or action -- you MUST mark the
corresponding finding "NOT_EVALUABLE", never "FAIL", no matter how heuristically relevant the criterion is.
Examples of claims you must NEVER make as a confirmed FAIL from this single image alone:
  - "No error messages are visible" does NOT prove "the form lacks validation."
  - "No confirmation message is visible" does NOT prove "the form lacks a confirmation after submission."
  - "No warning indicator is visible" does NOT prove "the system has no error states."
  - "No dedicated cancel/clear button is visible" does NOT by itself prove the user has no way at all to
    abandon or revert the action (the user could still navigate away or manually clear a field) -- you MAY
    still note the visual absence of a dedicated control (that part IS directly observable), but phrase it
    precisely as "no visible dedicated control for X was observed", never as "the user cannot X".
When your own reasoning falls into category B or C, set 'status' to "NOT_EVALUABLE", set 'confidence' to
"low", and word the 'description' to state ONLY what you actually observed (or failed to observe) -- never
phrase it as a confirmed capability gap (e.g. write "no se observó ningún indicador de validación en esta
captura" instead of "el formulario carece de validación").

---

### CONTRAST RULE (WCAG 1.4.3 -- VISUAL_OBSERVATION_ONLY):
You MAY observe that text "appears to have low contrast" (property: "visualContrast", value: a qualitative
string like "appears-low"). You are STRICTLY FORBIDDEN from stating or calculating a numeric WCAG contrast
ratio (e.g. "3.2:1", "4.5:1") for a prototype image -- you cannot measure real pixel colors reliably from a
screenshot the way a deterministic tool can. Any numeric ratio you provide will be rejected.

---

### CONFIDENCE AND SEVERITY CALIBRATION RULE (CRITICAL -- these are two independent dimensions, never confuse them):

CONFIDENCE represents how solid the EVIDENCE is that backs the finding -- NOT how serious the problem looks.
  - "high": the evidence is direct, clear, specific, and solid enough to fully support the observation on its own.
  - "medium": the evidence is visible or a reasonable indication, but has limitations that prevent a fully
    solid conclusion.
  - "low": the evidence is weak, ambiguous, indirect, or mostly based on inference.

Qualitative contrast (reinforces the CONTRAST RULE above):
  - When your evidence is property: "visualContrast" with a qualitative value like "appears-low" (a visual
    impression, not a measurement), the MAXIMUM confidence you may assign is "medium" -- never "high". Do not
    present a visual impression as if it were a measurement, and do not imply you calculated a WCAG ratio when
    no verifiable numeric measurement exists for a prototype image.
  - This cap applies ONLY to a qualitative contrast impression. Do NOT generalize it to every WCAG 1.4.3
    finding or to every finding that merely mentions contrast -- a genuinely verifiable, quantitative
    measurement (if one were ever actually available to you) would justify "high" for that measurement
    specifically.

Direct visual evidence:
  - A directly visible, specific observation (e.g. a concrete visible text, an absent label, a visible layout
    overlap) CAN justify high confidence when the criterion itself can genuinely be judged from a static
    image. Do not automatically lower the confidence of every visual observation -- only qualitative or
    inferential ones.

Inferences about dynamic behavior:
  - A static image alone can never demonstrate the ABSENCE of a dynamic behavior. Keep applying the
    DYNAMIC / INTERACTIVE BEHAVIOR RULE above for these cases exactly as already stated there.

SEVERITY represents the POTENTIAL IMPACT of the problem on the user -- NOT your certainty that it exists.
  - "critical": exceptionally severe impact, with a clear justification for why it is exceptional.
  - "high": an important impact.
  - "medium": a moderate impact.
  - "low": a minor impact.
  - "info": an informative observation that should NOT be counted as a severity penalty.
  Do not assign "critical" or "high" automatically just because the criterion itself is an important WCAG or
  Nielsen criterion -- the abstract importance of a criterion is not the same as the severity of this
  specific, concrete instance of non-compliance. Justify severity by the observable (or reasonably supported)
  impact on the user, never by the criterion's label alone.

MANDATORY DISTINCTIONS -- never confuse:
  - Confidence with severity (a finding can be high-severity and medium-confidence, or low-severity and
    high-confidence -- they are independent dimensions).
  - Qualitative evidence with a quantitative measurement.
  - A visual observation with a demonstrated non-compliance.
  - Absence of evidence with evidence of absence.
  - "NOT_EVALUABLE" with a confirmed defect.

---

### EXECUTIVE SUMMARY RULE:
Your 'executiveSummary' MUST be consistent with the 'status' of your own findings. Present a finding's
problem as a confirmed issue ONLY when its own 'status' is "FAIL". If you mention a "NOT_EVALUABLE" finding
in the summary at all, phrase it explicitly as an open question or a limitation of this single-image
evaluation (e.g. "no fue posible determinar si..."), never as a confirmed defect. Do not turn the summary
into a long list of caveats -- keep it concise and useful; this rule only affects HOW any NOT_EVALUABLE
observation is worded, not how many you must mention.

---

Respond ONLY with valid JSON matching this exact structure:
{
  "overallScore": <number 0-100>,
  "executiveSummary": "<Markdown formatted executive summary>",
  "findings": [
    {
      "findingGroup": "<ux|accessibility>",
      "type": "<usability|content|interaction|visual|wcag>",
      "status": "<PASS|FAIL|NOT_EVALUABLE>",
      "severity": "<critical|high|medium|low|info>",
      "confidence": "<high|medium|low>",
      "heuristicCode": "<e.g. N-04, or null if this is a WCAG finding>",
      "heuristicName": "<e.g. Consistencia y estándares, or null>",
      "wcagCriterion": "<exactly one code from the applicable list above, or null if this is a Nielsen finding>",
      "description": "<detailed problem description grounded in what is visible in the image>",
      "evidence": [
        {
          "type": "VISUAL_OBSERVATION",
          "elementDescription": "<specific description of the observed element, or null if using context>",
          "region": "<one of the 10 allowed region values, or null>",
          "property": "<one of the whitelisted property names, or null>",
          "value": "<observed value for that property, or null>",
          "context": "<page-level narrative context, or null>"
        }
      ],
      "affectedElement": {
        "visualReference": {
          "description": "<specific description, or null>",
          "region": "<one of the 10 allowed region values, or null>"
        }
      },
      "impact": "<user impact explanation>",
      "recommendation": "<actionable fix recommendation, required when status is FAIL>"
    }
  ]
}

Do NOT include a 'selector', 'tag', 'href', or any DOM-only field anywhere in your response -- this is an
image, not a webpage.
`.trim();
  }

  /**
   * [V1 Legacy] Builds the structured prompt for UX analysis.
   */
  private buildUxAnalysisPrompt(input: UxAnalysisInput): string {
    return `
You are an expert UX and accessibility evaluator. Analyze the following web page and return a structured UX evaluation.

**Simulated User Profile (Evaluator):**
- Name: ${input.evaluatorProfile.fullName}
- Age: ${input.evaluatorProfile.age} (${input.evaluatorProfile.profession})
- Archetype: ${input.evaluatorProfile.archetype}
- Mantra: "${input.evaluatorProfile.phrase}"
- Tech Savviness: ${input.evaluatorProfile.techSavviness}
- Accessibility Needs: ${input.evaluatorProfile.accessibilityNeeds.length ? input.evaluatorProfile.accessibilityNeeds.join(', ') : 'None'}
- Goals: ${input.evaluatorProfile.goals.join(', ')}
- Frustrations: ${input.evaluatorProfile.frustrations.join(', ')}

Please evaluate the page strictly from the perspective of this user.

**Page URL:** ${input.url}
**Page Title:** ${input.pageTitle}
${input.evaluationContext ? `**Evaluation Context:** ${input.evaluationContext}` : ''}

**DOM Snapshot:**
\`\`\`html
${input.domSnapshot.slice(0, 8000)}
\`\`\`

Respond ONLY with a valid JSON object matching this exact structure (no markdown, no explanation):
{
  "overallScore": <number 0-100>,
  "summary": "<brief overall assessment>",
  "findings": [
    {
      "id": "<unique-id>",
      "title": "<finding title>",
      "description": "<detailed explanation>",
      "type": "<usability|accessibility|clarity|navigation|interaction>",
      "severity": "<critical|high|medium|low>",
      "heuristic": "<optional Nielsen heuristic>",
      "wcagCriterion": "<optional WCAG criterion>",
      "recommendation": "<actionable fix>"
    }
  ]
}
`.trim();
  }
}

export const aiService = new AiService();
