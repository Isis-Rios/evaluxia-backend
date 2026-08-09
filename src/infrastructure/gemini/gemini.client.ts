import { GoogleGenAI } from '@google/genai';
import { ZodSchema } from 'zod';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { TokenUsage } from '@/shared/infrastructure/metrics-tracker';

export interface GeminiStructuredResponse<T> {
  data: T;
  usage: TokenUsage;
  executionTimeMs: number;
}

/**
 * GeminiClient — Typed wrapper around the Google GenAI SDK with token usage metrics instrumentation.
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
   * Sends a prompt to Gemini and parses + validates the response against a Zod schema.
   * Extracts real token usage metadata provided by Google AI API.
   */
  public async generateStructuredWithUsage<T>(
    prompt: string,
    schema: ZodSchema<T>,
  ): Promise<GeminiStructuredResponse<T>> {
    const startTime = Date.now();

    const response = await this.client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const executionTimeMs = Date.now() - startTime;
    const rawText = response.text;

    if (!rawText) {
      throw new AppError('Gemini returned an empty response', 502);
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
      throw new AppError(`Gemini response is not valid JSON. Raw: ${cleaned.slice(0, 200)}`, 502);
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AppError(
        `Gemini response does not match expected contract: ${validated.error.message}`,
        502,
      );
    }

    return {
      data: validated.data,
      usage,
      executionTimeMs,
    };
  }

  /**
   * Backward-compatible helper.
   */
  public async generateStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
  ): Promise<T> {
    const res = await this.generateStructuredWithUsage(prompt, schema);
    return res.data;
  }
}
