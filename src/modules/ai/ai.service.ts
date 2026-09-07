import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
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
   * [V2 - Phase 1] Ultra-lightweight AI Decision Engine for tactical exploration.
   */
  async makeDecision(inputContext: V2AIInputContext): Promise<{
    result: V2AIOutputDecision;
    usage: TokenUsage;
    executionTimeMs: number;
  }> {
    const inputValidation = V2AIInputContextSchema.safeParse(inputContext);
    if (!inputValidation.success) {
      throw new AppError(
        `Invalid AI Input Context schema: ${inputValidation.error.message}`,
        400,
      );
    }

    const prompt = this.buildV2DecisionPrompt(inputContext);
    const { data: rawResult, usage, executionTimeMs } = await this.client.generateStructuredWithUsage(
      prompt,
      V2AIOutputDecisionSchema,
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
  }> {
    const prompt = this.buildV2AuditPrompt(input);
    const { data: rawResult, usage, executionTimeMs } = await this.client.generateStructuredWithUsage<V2AuditOutput>(
      prompt,
      V2AuditOutputSchema,
    );

    const result: V2AuditOutput = rawResult;
    return { result, usage, executionTimeMs };
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
   */
  private buildV2AuditPrompt(input: V2AuditAnalysisInput): string {
    return `
You are EvalUXIA's Evidence-Based Specialized Domain Audit Engine (Phase 2).
Your task is to conduct a rigorous, formal UX and Accessibility Audit on the full navigation session executed by a user persona.

---

### ABSOLUTE AUDIT RULE: NO EVIDENCE = NO FAIL
1. Every "FAIL" status finding MUST be grounded in direct, verifiable technical evidence provided below (DOM attributes, computed styles, headings hierarchy, or ARIA tree).
2. If evidence for a criterion is insufficient or absent, classify the status as "NOT_EVALUABLE" or "PASS". Do NOT generate speculative, hypothetical conditional findings using words like "might", "could", "may", "if implemented".
3. Every "FAIL" finding MUST include a concrete, actionable recommendation explaining exactly what the developer or designer should fix. NEVER use the heuristic code or name as the recommendation.

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
- Total Snapshots Analyzed: ${input.snapshotsCount}

---

### STRUCTURED TECHNICAL EVIDENCE BUNDLE FOR ALL SESSION ITERATIONS:
\`\`\`json
${JSON.stringify(input.evidencesSummary || [], null, 2)}
\`\`\`

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
   - **WCAG 1.4.3 Contraste mínimo** (Color texto/fondo)
   - **WCAG 2.1.1 Teclado** (Navegación exclusivamente por teclado)
   - **WCAG 2.4.4 Propósito de los enlaces** (Nombres accesibles de links)
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
      "wcagCriterion": "<e.g. WCAG 1.4.3 Contraste (Mínimo)>",
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
