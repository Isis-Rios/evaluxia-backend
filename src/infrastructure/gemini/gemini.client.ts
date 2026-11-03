import { GoogleGenAI } from '@google/genai';
import { ZodType } from 'zod';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { TokenUsage, checkUsageConsistency } from '@/shared/infrastructure/metrics-tracker';
import { AI_RETRY_CONFIG } from '@/config/constants';

export interface GeminiStructuredResponse<T> {
  data: T;
  usage: TokenUsage;
  executionTimeMs: number;
  /**
   * J3-retry-accounting (Hardening Post-Fase H) — OPTIONAL, additive.
   * `usage` above is UNCHANGED and keeps meaning exactly what it always
   * meant: the token usage of the final, successful attempt only. This
   * field separately exposes the SUM across every attempt that reached a
   * real Gemini response with `usageMetadata` (whether that attempt
   * ultimately failed JSON/schema validation and got retried, or was the
   * final successful one) — see `executeWithRetry`/`generateStructuredWithUsage`
   * for exactly which attempts are captured. Existing consumers that only
   * read `usage` are entirely unaffected.
   */
  retryAccounting?: { attempts: number; cumulativeUsage: TokenUsage };
}

/**
 * Sums TokenUsage across every attempt that reached a real response (i.e.
 * every entry in the array). Required fields (promptTokens/outputTokens/
 * totalTokens) are always summed. Optional fields (thinkingTokens/
 * cachedContentTokens/toolUsePromptTokens) are summed ONLY across the
 * attempts that actually reported them — never defaulted to 0 for an
 * attempt that omitted them — and the resulting field stays `undefined`
 * if NO attempt in the array reported it at all.
 */
function sumTokenUsages(usages: TokenUsage[]): TokenUsage {
  const sumOptional = (key: 'thinkingTokens' | 'cachedContentTokens' | 'toolUsePromptTokens'): number | undefined => {
    const reporting = usages.filter((u) => u[key] !== undefined);
    if (reporting.length === 0) return undefined;
    return reporting.reduce((sum, u) => sum + (u[key] as number), 0);
  };

  const thinkingTokens = sumOptional('thinkingTokens');
  const cachedContentTokens = sumOptional('cachedContentTokens');
  const toolUsePromptTokens = sumOptional('toolUsePromptTokens');

  return {
    promptTokens: usages.reduce((sum, u) => sum + u.promptTokens, 0),
    outputTokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
    totalTokens: usages.reduce((sum, u) => sum + u.totalTokens, 0),
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
    ...(cachedContentTokens !== undefined ? { cachedContentTokens } : {}),
    ...(toolUsePromptTokens !== undefined ? { toolUsePromptTokens } : {}),
  };
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export interface ClassifiedAiError {
  isRetryable: boolean;
  statusCode: number;
  reason: string;
}

/**
 * ── TEMPORARY DIAGNOSTIC INSTRUMENTATION (payload/quota audit) ──
 * Added to measure real Gemini request size/composition and to capture
 * Google's original 429 quota error detail without altering prompts, model,
 * retries, or the functional error contract. Logs metrics/counts/booleans
 * only — never the full request or response body. Meant to be removed once
 * the payload/quota audit is complete.
 */
export interface GeminiCallDiagnostics {
  phase: 1 | 2 | 'prototype';
  /**
   * Fase 3 traceability (contract-validation incident, evaluation
   * 6ae151a7c9e40a501f9cd885) — optional, additive. Populated only by
   * callers that already have it in scope (today: `performAuditAnalysis`,
   * Phase 2). Lets `[GeminiContractValidationAudit]` logs below be traced
   * back to a specific evaluation without requiring every call site to
   * supply it.
   */
  evaluationId?: string;
  visibleDOMSummaryItems?: number;
  snapshots?: number;
  ariaNodes?: number;
  computedStylesCount?: number;
  headingsCount?: number;
  imagesCount?: number;
  formsCount?: number;
  landmarksCount?: number;
  linksCount?: number;
  buttonsCount?: number;
  /**
   * Prototype visual evaluation (P2) — tamaño aproximado (bytes) del
   * payload base64 de la imagen adjunta. Puramente observacional: NO existe
   * hoy un motor de presupuesto/costo consciente de imágenes (confirmado en
   * el diseño K.1 -- `payload-budgets.ts`/`metrics-tracker.ts` son 100%
   * basados en caracteres de texto). Se loguea para visibilidad, nunca para
   * bloquear ni para estimar costo real.
   */
  imageBytesApprox?: number;
}

interface GeminiLogContext {
  phase?: 1 | 2 | 'prototype';
  model?: string;
}

/**
 * Rough, local character-based estimate — NOT a real tokenizer count.
 * Always reported alongside (never in place of) `usageMetadata` when the
 * SDK returns real token counts.
 */
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Real HTML tag names the fixed instruction template in buildV2AuditPrompt
 * never uses as response-format placeholders (which look like
 * "<ux|accessibility>", "<PASS|FAIL|NOT_EVALUABLE>", "<e.g. N-01>", etc — a
 * bare "<[a-zA-Z]...>" regex matches those too, producing a false positive
 * that has nothing to do with HTML/DOM content).
 */
const KNOWN_HTML_TAG_NAMES =
  /^(html|head|body|div|span|p|a|img|script|style|section|article|nav|header|footer|ul|ol|li|table|thead|tbody|tr|td|th|input|button|form|label|select|option|textarea|h[1-6]|svg|iframe|meta|link|title|br|hr|main|aside|figure|figcaption)$/i;

/**
 * Heuristic check for raw HTML/DOM content inside the final prompt string.
 * Counts substrings matching a real HTML-tag shape (a known tag name right
 * after "<", optionally with attributes) — a JSON.stringify of an object
 * containing real markup still preserves literal "<tag ...>" substrings
 * (JSON does not escape "<"), so this is a valid check even though the DOM
 * would arrive JSON-embedded rather than as raw HTML text.
 *
 * Deliberately requires a KNOWN_HTML_TAG_NAMES match (not just "<word>")
 * because the prompt's own fixed instruction template uses bare
 * "<placeholder|syntax>" markers to show Gemini the expected response
 * format — verified (2026-09-10 payload audit) that these placeholders
 * alone produce ~22 "<...>" matches with zero real HTML/DOM anywhere in
 * the prompt, which previously made this metric report false positives.
 */
function auditPromptComposition(prompt: string): {
  htmlTagLikeMatches: number;
  containsOuterHTML: boolean;
  containsFullDOM: boolean;
} {
  const allBracketMatches = [...prompt.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>\n]{0,200}>/g)];
  const tagMatches = allBracketMatches.filter((m) => KNOWN_HTML_TAG_NAMES.test(m[1]));
  return {
    htmlTagLikeMatches: tagMatches.length,
    containsOuterHTML: /outerHTML|<!DOCTYPE html>|<html[\s>]/i.test(prompt),
    containsFullDOM: tagMatches.length > 20,
  };
}

interface GoogleQuotaViolation {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string;
}

interface GoogleErrorDiagnostics {
  errorCode: number | string | null;
  errorStatus: string | null;
  quotaFailures: GoogleQuotaViolation[];
  retryDelay: string | null;
  rawGoogleErrorAvailable: boolean;
  rawMessagePreview: string | null;
}

/**
 * Best-effort, non-throwing extraction of Google's structured error body for
 * diagnostics only — does NOT influence classifyAiError's decision or the
 * message used in the thrown AppError (no functional change).
 *
 * The @google/genai SDK builds `ApiError.message` as
 * `JSON.stringify(rawGoogleErrorBody)` (see
 * node_modules/@google/genai/dist/node/index.mjs, throwErrorIfNotOK), so the
 * full `error.details[]` (google.rpc.QuotaFailure / google.rpc.RetryInfo)
 * usually lives inside this string — this function parses it back out.
 */
function extractGoogleErrorDiagnostics(error: unknown): GoogleErrorDiagnostics {
  const empty: GoogleErrorDiagnostics = {
    errorCode: null,
    errorStatus: null,
    quotaFailures: [],
    retryDelay: null,
    rawGoogleErrorAvailable: false,
    rawMessagePreview: null,
  };
  if (!error) return empty;

  const err = error as any;
  const rawMessage: string | undefined = typeof err.message === 'string' ? err.message : undefined;
  if (!rawMessage) return empty;

  let parsed: any;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return { ...empty, rawMessagePreview: rawMessage.slice(0, 500) };
  }

  const googleError = parsed?.error ?? parsed;
  const details: any[] = Array.isArray(googleError?.details) ? googleError.details : [];

  const quotaFailures: GoogleQuotaViolation[] = details
    .filter((d) => typeof d?.['@type'] === 'string' && d['@type'].includes('QuotaFailure'))
    .flatMap((d) => (Array.isArray(d.violations) ? d.violations : []))
    .map((v) => ({ quotaMetric: v?.quotaMetric, quotaId: v?.quotaId, quotaValue: v?.quotaValue }));

  const retryInfo = details.find(
    (d) => typeof d?.['@type'] === 'string' && d['@type'].includes('RetryInfo'),
  );

  return {
    errorCode: googleError?.code ?? err.status ?? null,
    errorStatus: googleError?.status ?? null,
    quotaFailures,
    retryDelay: retryInfo?.retryDelay ?? null,
    rawGoogleErrorAvailable: true,
    rawMessagePreview: rawMessage.slice(0, 500),
  };
}

/**
 * Thrown when Gemini's response cannot be turned into a valid decision:
 * empty text, JSON that fails to parse, or JSON that does not match the
 * expected Zod contract. Distinguished from network/transport errors so
 * `classifyAiError` can classify it deterministically via `instanceof`
 * rather than by inspecting error text (which could otherwise misfire if
 * the malformed payload itself happens to contain a string like "429").
 */
export class InvalidAiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAiResponseError';
    Object.setPrototypeOf(this, InvalidAiResponseError.prototype);
  }
}

/**
 * Classifies an error from the AI provider or network transport.
 * Prioritizes structured error codes and statuses from SDK / API over text inspection.
 */
export function classifyAiError(error: unknown): ClassifiedAiError {
  if (!error) {
    return { isRetryable: false, statusCode: 500, reason: 'Unknown error' };
  }

  // 0. Malformed/contract-invalid Gemini response — retried like any other
  // transient failure (bounded by the same maxRetries), since a fresh
  // generation has a real chance of producing a well-formed response for a
  // non-deterministic model.
  if (error instanceof InvalidAiResponseError) {
    return { isRetryable: true, statusCode: 502, reason: `Invalid Gemini response: ${error.message}` };
  }

  const err = error as any;

  // 1. Structured status/code properties from Google GenAI SDK or API error payload
  const rawStatus = err.status || err.error?.status;
  const rawCode = err.code || err.statusCode || err.error?.code;

  if (rawStatus === 'UNAVAILABLE' || rawCode === 503 || rawStatus === 503) {
    return { isRetryable: true, statusCode: 503, reason: 'AI model service unavailable (503 UNAVAILABLE)' };
  }

  if (rawStatus === 'RESOURCE_EXHAUSTED' || rawCode === 429 || rawStatus === 429) {
    return { isRetryable: true, statusCode: 429, reason: 'AI quota/rate limit exceeded (429 RESOURCE_EXHAUSTED)' };
  }

  if (rawCode === 502 || rawStatus === 502) {
    return { isRetryable: true, statusCode: 502, reason: 'Bad Gateway connecting to AI service (502)' };
  }

  if (rawCode === 504 || rawStatus === 504 || rawStatus === 'DEADLINE_EXCEEDED') {
    return { isRetryable: true, statusCode: 504, reason: 'AI request deadline exceeded (504 DEADLINE_EXCEEDED)' };
  }

  // 2. Network socket / connection errors
  if (
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    err.name === 'FetchError' ||
    err.name === 'ConnectTimeoutError'
  ) {
    return { isRetryable: true, statusCode: 503, reason: `Network transient connection failure (${err.code || err.name})` };
  }

  // 3. Non-retryable client errors (4xx)
  if (rawCode === 400 || rawStatus === 'INVALID_ARGUMENT') {
    return { isRetryable: false, statusCode: 400, reason: 'Invalid argument in AI request' };
  }
  if (rawCode === 401 || rawStatus === 'UNAUTHENTICATED') {
    return { isRetryable: false, statusCode: 401, reason: 'Invalid or missing AI API Key' };
  }
  if (rawCode === 403 || rawStatus === 'PERMISSION_DENIED') {
    return { isRetryable: false, statusCode: 403, reason: 'Permission denied for AI model' };
  }
  if (rawCode === 404 || rawStatus === 'NOT_FOUND') {
    return { isRetryable: false, statusCode: 404, reason: 'AI model not found' };
  }

  // 4. Secondary fallback: inspection of error message text when code is not structured
  const msg = (err.message || String(err)).toLowerCase();

  if (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('spikes in demand') ||
    msg.includes('overloaded')
  ) {
    return { isRetryable: true, statusCode: 503, reason: 'AI model currently experiencing high demand (503)' };
  }

  if (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded')
  ) {
    return { isRetryable: true, statusCode: 429, reason: 'AI rate limit exceeded (429)' };
  }

  if (msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('etimedout')) {
    return { isRetryable: true, statusCode: 503, reason: 'Network fetch failed communicating with AI API' };
  }

  return { isRetryable: false, statusCode: err.statusCode || 500, reason: err.message || 'AI generation failed' };
}

/**
 * GeminiClient — Typed wrapper around the Google GenAI SDK with token usage metrics
 * and resilient exponential backoff retry for transient provider errors.
 */
export class GeminiClient {
  private static instance: GeminiClient;
  private client: GoogleGenAI;

  private constructor() {
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  public static getInstance(): GeminiClient {
    if (!GeminiClient.instance) {
      GeminiClient.instance = new GeminiClient();
    }
    return GeminiClient.instance;
  }

  /**
   * Executes an asynchronous operation with exponential backoff and jitter for transient errors.
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryOpts: RetryOptions = {},
    logContext?: GeminiLogContext,
  ): Promise<T> {
    const maxRetries = retryOpts.maxRetries ?? AI_RETRY_CONFIG.maxRetries;
    const initialDelayMs = retryOpts.initialDelayMs ?? AI_RETRY_CONFIG.initialDelayMs;
    const backoffFactor = retryOpts.backoffFactor ?? AI_RETRY_CONFIG.backoffFactor;
    const maxDelayMs = retryOpts.maxDelayMs ?? AI_RETRY_CONFIG.maxDelayMs;
    const jitterMs = retryOpts.jitterMs ?? AI_RETRY_CONFIG.jitterMs;

    let attempt = 0;
    let currentDelay = initialDelayMs;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        attempt++;
        const classification = classifyAiError(error);

        // ── TEMPORARY: [GeminiQuotaAudit] — diagnostic-only extraction of
        // Google's original 429 error detail. Does not affect classification
        // or the error thrown below.
        const googleDiag = classification.statusCode === 429 ? extractGoogleErrorDiagnostics(error) : null;
        if (googleDiag) {
          console.warn(
            `[GeminiQuotaAudit] phase=${logContext?.phase ?? 'unknown'} model=${logContext?.model ?? 'unknown'} ` +
            `attempt=${attempt} httpStatus=429 errorCode=${googleDiag.errorCode ?? 'no presente'} ` +
            `errorStatus=${googleDiag.errorStatus ?? 'no presente'} ` +
            `quotaFailures=${googleDiag.quotaFailures.length ? JSON.stringify(googleDiag.quotaFailures) : 'no presente'} ` +
            `retryDelay=${googleDiag.retryDelay ?? 'no presente'} rawGoogleErrorAvailable=${googleDiag.rawGoogleErrorAvailable}`,
          );
          if (googleDiag.rawMessagePreview) {
            console.warn(`[GeminiQuotaAudit] rawMessagePreview="${googleDiag.rawMessagePreview}"`);
          }
        }

        if (!classification.isRetryable || attempt > maxRetries) {
          if (attempt > maxRetries && classification.isRetryable) {
            console.error(
              `[GeminiClient] ❌ Max retries (${maxRetries}) exhausted for transient error: ${classification.reason}`,
            );
            throw new AppError(
              `AI Service Unavailable: ${classification.reason}. Failed after ${maxRetries} retries.`,
              classification.statusCode,
            );
          }

          if (error instanceof AppError) {
            throw error;
          }
          throw new AppError(
            `AI Request Failed (${classification.statusCode}): ${classification.reason} — ${error.message || String(error)}`,
            classification.statusCode,
          );
        }

        // Calculate backoff delay with random jitter
        const jitter = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
        const delayWithJitter = Math.min(Math.max(100, currentDelay + jitter), maxDelayMs);

        console.warn(
          `[GeminiClient] ⚠️ Transient AI error (${classification.reason}) on attempt ${attempt}/${maxRetries}. Retrying in ${delayWithJitter}ms...`,
        );

        // ── TEMPORARY: [GeminiRetryAudit] — per-attempt trace distinguishing
        // our own configured backoff from Google's suggested RetryInfo delay
        // (recorded only, not used by the retry algorithm itself).
        console.log(
          `[GeminiRetryAudit] phase=${logContext?.phase ?? 'unknown'} model=${logContext?.model ?? 'unknown'} ` +
          `attempt=${attempt}/${maxRetries} status=${classification.statusCode} ` +
          `retryDelayConfigured=${delayWithJitter}ms googleRetryDelay=${googleDiag?.retryDelay ?? 'no presente'}`,
        );

        await new Promise((resolve) => setTimeout(resolve, delayWithJitter));
        currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs);
      }
    }
  }

  /**
   * Core "call Gemini → parse → validate" cycle, shared by the text-only
   * (`generateStructuredWithUsage`) and multimodal
   * (`generateMultimodalStructuredWithUsage`) entrypoints — P2 (prototype
   * visual evaluation): extracted WITHOUT behavior changes from what used
   * to be `generateStructuredWithUsage`'s retry callback, so the existing
   * WEB path is byte-for-byte unchanged (still passes a plain string as
   * `contents`). `contents` accepts whatever the @google/genai SDK's
   * `generateContent({contents})` already accepts (a string, or an array of
   * Parts) — a `{text}`/`{inlineData}` Part array is how the image attaches
   * for the multimodal case (sección 16: "Extender el cliente... PERO no
   * ejecutar Gemini real" — esto es la extensión estructural; sigue siendo
   * 100% mockeable con el MISMO monkeypatch de `generateContent` que ya usa
   * `gemini-mock-harness.ts`, sin ninguna infraestructura de mock nueva).
   *
   * `auditText` is the text-only portion used for the existing char-based
   * size/composition diagnostics (never the image bytes — no payload-budget
   * model exists for images, see GeminiCallDiagnostics.imageBytesApprox).
   */
  private async executeAndValidate<TOutput>(
    contents: string | Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
    schema: ZodType<TOutput, any, any>,
    diagnostics: GeminiCallDiagnostics | undefined,
    attemptUsages: TokenUsage[],
    auditText: string,
  ): Promise<{ data: TOutput; usage: TokenUsage }> {
    // ── TEMPORARY: [GeminiPayloadAudit] — real request size/composition,
    // logged right before every actual call to generateContent (including
    // each retry attempt). Metrics/counts/booleans only — never the
    // request or response body itself.
    const requestChars = auditText.length;
    const requestBytes = Buffer.byteLength(auditText, 'utf8');
    const estimatedInputTokens = estimateTokensFromChars(requestChars);
    const composition = auditPromptComposition(auditText);
    console.log(
      `[GeminiPayloadAudit] phase=${diagnostics?.phase ?? 'unknown'} model=${env.GEMINI_MODEL} ` +
      `requestChars=${requestChars} requestBytes=${requestBytes} estimatedInputTokens=${estimatedInputTokens} ` +
      `visibleDOMSummaryItems=${diagnostics?.visibleDOMSummaryItems ?? 'n/a'} snapshots=${diagnostics?.snapshots ?? 'n/a'} ` +
      `ariaNodes=${diagnostics?.ariaNodes ?? 'n/a'} computedStyles=${diagnostics?.computedStylesCount ?? 'n/a'} ` +
      `headings=${diagnostics?.headingsCount ?? 'n/a'} images=${diagnostics?.imagesCount ?? 'n/a'} forms=${diagnostics?.formsCount ?? 'n/a'} ` +
      `landmarks=${diagnostics?.landmarksCount ?? 'n/a'} links=${diagnostics?.linksCount ?? 'n/a'} buttons=${diagnostics?.buttonsCount ?? 'n/a'} ` +
      `imageBytesApprox=${diagnostics?.imageBytesApprox ?? 'n/a'} ` +
      `htmlTagLikeMatches=${composition.htmlTagLikeMatches} containsOuterHTML=${composition.containsOuterHTML} containsFullDOM=${composition.containsFullDOM}`,
    );

    const response = await this.client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const rawText = response.text;
    if (!rawText) {
      throw new InvalidAiResponseError('Gemini returned an empty response');
    }

    // Extract real usage metadata from API response if present, or estimate based on length
    const usageMetadata = (response as any).usageMetadata;

    // ── TEMPORARY: [GeminiPayloadAudit] — explicitly distinguishes actual
    // SDK-reported usageMetadata (when present) from the char-based
    // estimate computed above. Never presented as equivalent.
    if (usageMetadata) {
      console.log(
        `[GeminiPayloadAudit] phase=${diagnostics?.phase ?? 'unknown'} actualUsageMetadata: ` +
        `promptTokens=${usageMetadata.promptTokenCount ?? 'n/a'} outputTokens=${usageMetadata.candidatesTokenCount ?? 'n/a'} ` +
        `totalTokens=${usageMetadata.totalTokenCount ?? 'n/a'} (estimatedInputTokens era ${estimatedInputTokens})`,
      );
    } else {
      console.log(
        `[GeminiPayloadAudit] phase=${diagnostics?.phase ?? 'unknown'} actualUsageMetadata=no presente ` +
        `(solo estimación local disponible: ${estimatedInputTokens} tokens)`,
      );
    }

    const promptTokens = usageMetadata?.promptTokenCount ?? Math.ceil(auditText.length / 4);
    const outputTokens = usageMetadata?.candidatesTokenCount ?? Math.ceil(rawText.length / 4);
    const totalTokens = usageMetadata?.totalTokenCount ?? (promptTokens + outputTokens);

    // ── J3 (Hardening Post-Fase H): campos adicionales del mismo
    // usageMetadata ya disponible — nombres 1:1 con
    // GenerateContentResponseUsageMetadata del SDK (@google/genai).
    // Solo se asignan cuando el SDK realmente los reporta (nunca se
    // inventa un valor por ausencia) — de ahí `?? undefined` explícito
    // en vez de `?? 0`, para preservar la distinción entre "no
    // reportado" y "reportado como cero" (Caso 4 de la suite J3).
    const thinkingTokens: number | undefined = usageMetadata?.thoughtsTokenCount ?? undefined;
    const cachedContentTokens: number | undefined = usageMetadata?.cachedContentTokenCount ?? undefined;
    const toolUsePromptTokens: number | undefined = usageMetadata?.toolUsePromptTokenCount ?? undefined;

    const usage: TokenUsage = {
      promptTokens,
      outputTokens,
      totalTokens,
      ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
      ...(cachedContentTokens !== undefined ? { cachedContentTokens } : {}),
      ...(toolUsePromptTokens !== undefined ? { toolUsePromptTokens } : {}),
    };

    // J3-retry-accounting: captured HERE, immediately after `usage` is
    // built from the real API response, and BEFORE any JSON/schema
    // validation below that could throw and cause this attempt to be
    // retried. This is what lets a failed-but-billed attempt (e.g. a
    // schema-contract mismatch) still be accounted for in
    // `retryAccounting.cumulativeUsage`, even though `data`/`usage`
    // (the single-attempt fields) only ever reflect the final success.
    attemptUsages.push(usage);

    // ── J3: chequeo de consistencia, puramente observacional — nunca
    // corrige `usage.totalTokens` ni afecta el resultado de la llamada.
    // Solo se loguea cuando hay suficiente información para evaluarlo Y
    // resulta inconsistente (ver checkUsageConsistency) — evita ruido en
    // el caso normal/consistente.
    if (usageMetadata) {
      const consistency = checkUsageConsistency(usage);
      if (consistency.evaluable && !consistency.consistent) {
        console.warn(
          `[GeminiTokenConsistencyAudit] phase=${diagnostics?.phase ?? 'unknown'} ⚠️ ${consistency.reason}`,
        );
      }
      if (thinkingTokens !== undefined || cachedContentTokens !== undefined || toolUsePromptTokens !== undefined) {
        console.log(
          `[GeminiTokenUsageAudit] phase=${diagnostics?.phase ?? 'unknown'} thinkingTokens=${thinkingTokens ?? 'n/a'} ` +
          `cachedContentTokens=${cachedContentTokens ?? 'n/a'} toolUsePromptTokens=${toolUsePromptTokens ?? 'n/a'}`,
        );
      }
    }

    // Strip markdown code fences if wrapped
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new InvalidAiResponseError(`Gemini response is not valid JSON. Raw: ${cleaned.slice(0, 200)}`);
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      // Fase 3 traceability (contract-validation incident, evaluation
      // 6ae151a7c9e40a501f9cd885, 2026-10-28): before this, a rejection only
      // ever surfaced Zod's path+message (e.g. "findings.6.evidence.0.value:
      // DOM_ATTRIBUTE evidence must specify observed value.") with NO way to
      // tell whether the real field was absent, null, an empty string, or
      // the wrong type — the raw `parsed` object was discarded right here,
      // never logged anywhere. This walks each issue's path back into
      // `parsed` and classifies what was actually there, bounded (first 10
      // issues, each value preview capped at 60 chars, objects/arrays never
      // dumped) — console.error only (existing logging convention, no new
      // logging system), never included in the thrown error message, so
      // none of this reaches the frontend or `blockingError`.
      const issueDetails = validated.error.issues.slice(0, 10).map((issue) => {
        let rawValue: unknown;
        try {
          rawValue = issue.path.reduce<unknown>(
            (acc, key) => (acc == null ? undefined : (acc as any)[key as any]),
            parsed,
          );
        } catch {
          rawValue = undefined;
        }
        const kind =
          rawValue === undefined
            ? 'ausente'
            : rawValue === null
              ? 'null'
              : typeof rawValue === 'string' && rawValue.trim().length === 0
                ? 'cadena vacía'
                : typeof rawValue;
        const preview =
          rawValue !== null && typeof rawValue === 'object'
            ? '[object]'
            : JSON.stringify(rawValue)?.slice(0, 60);
        return `path=${issue.path.join('.')} kind=${kind} preview=${preview} message="${issue.message}"`;
      });
      console.error(
        `[GeminiContractValidationAudit] evaluationId=${diagnostics?.evaluationId ?? 'n/a'} ` +
        `phase=${diagnostics?.phase ?? 'unknown'} issueCount=${validated.error.issues.length} ` +
        `(mostrando hasta 10):\n${issueDetails.map((d) => `  - ${d}`).join('\n')}`,
      );
      throw new InvalidAiResponseError(
        `Gemini response does not match expected contract: ${validated.error.message}`,
      );
    }

    return { data: validated.data, usage };
  }

  /**
   * Sends a prompt to Gemini and parses + validates the response against a Zod schema.
   * Employs exponential backoff retry for transient errors and extracts token usage metadata.
   */
  public async generateStructuredWithUsage<TOutput>(
    prompt: string,
    schema: ZodType<TOutput, any, any>,
    retryOpts?: RetryOptions,
    diagnostics?: GeminiCallDiagnostics,
  ): Promise<GeminiStructuredResponse<TOutput>> {
    const startTime = Date.now();

    // J3-retry-accounting (Hardening Post-Fase H) — captured OUTSIDE the
    // retry closure below so a push survives even if that same attempt
    // later throws (JSON parse / schema validation failure) and gets
    // retried. See sumTokenUsages/GeminiStructuredResponse.retryAccounting.
    const attemptUsages: TokenUsage[] = [];

    // The full "call Gemini → parse → validate" cycle runs inside
    // executeWithRetry as a single unit: an empty response, malformed JSON,
    // or a contract-schema mismatch throws InvalidAiResponseError, which
    // classifyAiError marks retryable — so a bad response triggers a fresh
    // Gemini call (up to the same maxRetries as network/5xx errors), instead
    // of being fatal for the whole iteration on the first bad reply.
    const { data, usage } = await this.executeWithRetry(
      () => this.executeAndValidate(prompt, schema, diagnostics, attemptUsages, prompt),
      retryOpts,
      { phase: diagnostics?.phase, model: env.GEMINI_MODEL },
    );

    const executionTimeMs = Date.now() - startTime;

    // J3-retry-accounting: additive only. `attemptUsages` always has at
    // least 1 entry when this point is reached (the final successful
    // attempt) unless that attempt itself never got a real usageMetadata
    // response (see the "no attempt reached usage computation" case in the
    // retry-accounting analysis) -- in that rare case `attemptUsages` stays
    // empty and `retryAccounting` is simply omitted rather than reporting a
    // misleading zeroed-out cumulative.
    const retryAccounting = attemptUsages.length > 0
      ? { attempts: attemptUsages.length, cumulativeUsage: sumTokenUsages(attemptUsages) }
      : undefined;

    return {
      data,
      usage,
      executionTimeMs,
      ...(retryAccounting ? { retryAccounting } : {}),
    };
  }

  /**
   * [P2 — Prototype visual evaluation] Multimodal variant of
   * `generateStructuredWithUsage`: sends a text prompt PLUS a single inline
   * image (base64) to Gemini. Reuses 100% of the retry/schema-validation/
   * usage-accounting machinery via `executeAndValidate` — nothing about the
   * real Gemini call path is duplicated. Mockable with the EXACT same
   * `stubGeminiJsonResponses`/`stubGeminiResponsesWithUsage` harness already
   * used for WEB (both stub `client.models.generateContent`, which this
   * method still calls under the hood via `executeAndValidate`) — no new
   * mock surface required.
   *
   * NEVER called against the real Gemini API during P0-P6 implementation
   * (no test/flow in this phase sets a real GEMINI_API_KEY call path for
   * this method) — exists purely as a structurally-correct, mockable
   * abstraction, per the explicit "Gemini real = 0" rule of this phase.
   */
  public async generateMultimodalStructuredWithUsage<TOutput>(
    textPrompt: string,
    image: { mimeType: string; data: string },
    schema: ZodType<TOutput, any, any>,
    retryOpts?: RetryOptions,
    diagnostics?: GeminiCallDiagnostics,
  ): Promise<GeminiStructuredResponse<TOutput>> {
    const startTime = Date.now();
    const attemptUsages: TokenUsage[] = [];
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: textPrompt },
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ];

    const resolvedDiagnostics: GeminiCallDiagnostics = {
      ...diagnostics,
      phase: diagnostics?.phase ?? 'prototype',
      imageBytesApprox: image.data.length,
    };
    const { data, usage } = await this.executeWithRetry(
      () => this.executeAndValidate(contents, schema, resolvedDiagnostics, attemptUsages, textPrompt),
      retryOpts,
      { phase: resolvedDiagnostics.phase, model: env.GEMINI_MODEL },
    );

    const executionTimeMs = Date.now() - startTime;
    const retryAccounting = attemptUsages.length > 0
      ? { attempts: attemptUsages.length, cumulativeUsage: sumTokenUsages(attemptUsages) }
      : undefined;

    return {
      data,
      usage,
      executionTimeMs,
      ...(retryAccounting ? { retryAccounting } : {}),
    };
  }

  /**
   * Backward-compatible helper.
   */
  public async generateStructured<T>(
    prompt: string,
    schema: ZodType<T, any, any>,
    retryOpts?: RetryOptions,
  ): Promise<T> {
    const res = await this.generateStructuredWithUsage<T>(prompt, schema, retryOpts);
    return res.data;
  }
}
