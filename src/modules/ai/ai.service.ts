import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
import {
  UxAnalysisInput,
  UxAnalysisInputSchema,
  UxAnalysisOutput,
  UxAnalysisOutputSchema,
} from './contracts/ai.contracts';
import { AppError } from '@/shared/errors/AppError';

/**
 * AiService — Orchestrates all AI reasoning through the Gemini API.
 *
 * EvalUXIA Architecture:
 *   1. Playwright extracts DOM snapshot + screenshots (AutomationService)
 *   2. Backend builds a structured prompt with context (this service)
 *   3. Gemini reasons and returns structured JSON
 *   4. Response is validated against Zod contract
 *   5. Backend orchestrator uses the result to create findings, schedule next steps
 *
 * The AI never directly interacts with the browser or database.
 */
export class AiService {
  private client: GeminiClient;

  constructor() {
    this.client = GeminiClient.getInstance();
  }

  /**
   * Performs a full UX analysis of a page given its DOM snapshot and context.
   */
  async analyzeUx(input: UxAnalysisInput): Promise<{ result: UxAnalysisOutput; executionTimeMs: number }> {
    // Validate input contract
    const validated = UxAnalysisInputSchema.safeParse(input);
    if (!validated.success) {
      throw new AppError(`Invalid AI input: ${validated.error.message}`, 400);
    }

    const prompt = this.buildUxAnalysisPrompt(validated.data);

    const startTime = Date.now();
    const result = await this.client.generateStructured<UxAnalysisOutput>(
      prompt,
      UxAnalysisOutputSchema,
    );
    const executionTimeMs = Date.now() - startTime;

    return { result, executionTimeMs };
  }

  /**
   * Builds the structured prompt for UX analysis.
   * Instructs the model to respond ONLY with valid JSON matching the contract.
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
      "severity": "<critical|high|medium|low|info>",
      "category": "<accessibility|usability|performance|content|navigation|visual>",
      "title": "<short finding title>",
      "description": "<detailed description>",
      "affectedElement": "<CSS selector or element description, optional>",
      "recommendation": "<specific actionable recommendation>",
      "wcagCriteria": "<WCAG criterion if applicable, optional>"
    }
  ],
  "nextActions": ["<suggested next evaluation step>"]
}
`.trim();
  }
}

export const aiService = new AiService();
