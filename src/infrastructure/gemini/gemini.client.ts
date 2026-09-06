import { GoogleGenAI } from '@google/genai';
import { ZodType } from 'zod';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { TokenUsage } from '@/shared/infrastructure/metrics-tracker';
import { AI_RETRY_CONFIG } from '@/config/constants';

export interface GeminiStructuredResponse<T> {
  data: T;
  usage: TokenUsage;
  executionTimeMs: number;
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

        await new Promise((resolve) => setTimeout(resolve, delayWithJitter));
        currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs);
      }
    }
  }

  /**
   * Sends a prompt to Gemini and parses + validates the response against a Zod schema.
   * Employs exponential backoff retry for transient errors and extracts token usage metadata.
   */
  public async generateStructuredWithUsage<TOutput>(
    prompt: string,
    schema: ZodType<TOutput, any, any>,
    retryOpts?: RetryOptions,
  ): Promise<GeminiStructuredResponse<TOutput>> {
    const startTime = Date.now();

    // The full "call Gemini → parse → validate" cycle runs inside
    // executeWithRetry as a single unit: an empty response, malformed JSON,
    // or a contract-schema mismatch throws InvalidAiResponseError, which
    // classifyAiError marks retryable — so a bad response triggers a fresh
    // Gemini call (up to the same maxRetries as network/5xx errors), instead
    // of being fatal for the whole iteration on the first bad reply.
    const { data, usage } = await this.executeWithRetry(async () => {
      const response = await this.client.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: prompt,
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
      const promptTokens = usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
      const outputTokens = usageMetadata?.candidatesTokenCount ?? Math.ceil(rawText.length / 4);
      const totalTokens = usageMetadata?.totalTokenCount ?? (promptTokens + outputTokens);

      const usage: TokenUsage = {
        promptTokens,
        outputTokens,
        totalTokens,
      };

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
        throw new InvalidAiResponseError(
          `Gemini response does not match expected contract: ${validated.error.message}`,
        );
      }

      return { data: validated.data, usage };
    }, retryOpts);

    const executionTimeMs = Date.now() - startTime;

    return {
      data,
      usage,
      executionTimeMs,
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
