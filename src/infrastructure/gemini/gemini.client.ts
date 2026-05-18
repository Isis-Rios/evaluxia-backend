import { GoogleGenAI } from '@google/genai';
import { ZodSchema } from 'zod';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';

/**
 * GeminiClient — Typed wrapper around the Google GenAI SDK.
 *
 * Design decisions:
 * - The AI does NOT execute actions directly. It only receives context and returns structured JSON.
 * - All responses are validated against a Zod schema to enforce strict contracts.
 * - The backend orchestrator (Express services) interprets the AI response and decides next actions.
 *
 * Usage:
 *   const client = GeminiClient.getInstance();
 *   const result = await client.generateStructured(prompt, MyZodSchema);
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
   * Sends a prompt to Gemini and returns the raw text response.
   */
  public async generate(prompt: string): Promise<string> {
    const response = await this.client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
    });

    const text = response.text;
    if (!text) {
      throw new AppError('Gemini returned an empty response', 502);
    }

    return text;
  }

  /**
   * Sends a prompt to Gemini and parses + validates the response
   * against a Zod schema. Enforces strict JSON contracts.
   *
   * @param prompt - The instruction sent to the AI
   * @param schema - Zod schema to validate the AI's JSON response
   * @returns Validated and typed response object
   */
  public async generateStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
  ): Promise<T> {
    const rawText = await this.generate(prompt);

    // Strip markdown code fences if the model wraps the JSON
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new AppError(
        `Gemini response is not valid JSON. Raw: ${cleaned.slice(0, 200)}`,
        502,
      );
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AppError(
        `Gemini response does not match expected contract: ${validated.error.message}`,
        502,
      );
    }

    return validated.data;
  }
}
