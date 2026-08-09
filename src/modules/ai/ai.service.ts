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
}

/**
 * AiService — Orchestrates all AI reasoning (Decision Engine) through the model-neutral AI client.
 *
 * In V2 (Architectural Refactoring):
 *   - Phase 1 (makeDecision): Ultra-lightweight navigation decision engine. 0 findings audit.
 *   - Phase 2 (performAuditAnalysis): Asynchronous specialized domain audit (Nielsen, WCAG 2.2, UX Writing).
 */
export class AiService {
  private client: GeminiClient;

  constructor() {
    this.client = GeminiClient.getInstance();
  }

  /**
   * [V2 - Phase 1] Evaluates active navigation context for the NEXT STEP decision only.
   * Ultra-lightweight prompt: No UX or accessibility findings generated during exploration.
   */
  async makeDecision(context: V2AIInputContext): Promise<{
    result: V2AIOutputDecision;
    usage: TokenUsage;
    executionTimeMs: number;
  }> {
    const validated = V2AIInputContextSchema.safeParse(context);
    if (!validated.success) {
      throw new AppError(`Invalid AI input context: ${validated.error.message}`, 400);
    }

    const prompt = this.buildV2DecisionPrompt(validated.data);
    const { data: rawResult, usage, executionTimeMs } = await this.client.generateStructuredWithUsage(
      prompt,
      V2AIOutputDecisionSchema,
    );

    const result: V2AIOutputDecision = {
      ...rawResult,
      evaluationSummary: {
        ...rawResult.evaluationSummary,
        confidenceLevel: rawResult.evaluationSummary.confidenceLevel || 'high',
      },
      userIntention: {
        description: rawResult.userIntention?.description || 'Navegación táctica',
        derivedFromArchetype: rawResult.userIntention?.derivedFromArchetype ?? false,
      },
      riskAssessment: {
        confusionProbability: rawResult.riskAssessment?.confusionProbability || 'low',
        abandonmentRisk: rawResult.riskAssessment?.abandonmentRisk || 'low',
        errorRisk: rawResult.riskAssessment?.errorRisk || 'low',
      },
      uxFindings: rawResult.uxFindings || [],
      accessibilityFindings: rawResult.accessibilityFindings || [],
    };

    return { result, usage, executionTimeMs };
  }

  /**
   * [V2 - Phase 2] Specialized domain audit engine executed asynchronously after exploration completes.
   * Uses explicit definitions of Nielsen 10 Heuristics, WCAG 2.2 criteria, and UX Writing rules.
   */
  async performAuditAnalysis(input: V2AuditAnalysisInput): Promise<{
    result: V2AuditOutput;
    usage: TokenUsage;
    executionTimeMs: number;
  }> {
    const prompt = this.buildV2AuditPrompt(input);
    const { data: rawResult, usage, executionTimeMs } = await this.client.generateStructuredWithUsage(
      prompt,
      V2AuditOutputSchema,
    );

    const result: V2AuditOutput = {
      ...rawResult,
      findings: (rawResult.findings || []).map((f) => ({
        ...f,
        severity: f.severity || 'medium',
      })),
    };

    return { result, usage, executionTimeMs };
  }

  /**
   * [V1 Legacy] Performs a full UX analysis of a page given its DOM snapshot and context.
   */
  async analyzeUx(input: UxAnalysisInput): Promise<{ result: UxAnalysisOutput; executionTimeMs: number }> {
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
   * Builds Phase 1 Navigation Decision Prompt (Ultra-Lightweight, 0 Audit overhead).
   */
  private buildV2DecisionPrompt(input: V2AIInputContext): string {
    return `
You are EvalUXIA's AI Decision Engine (Navigation Only).
You simulate a specific user persona navigating a web application to fulfill a flow goal step-by-step.

**Task**:
Analyze the current navigation context, compare it with the user persona traits and step goals, and suggest ONLY the NEXT tactical browser action to execute.

---

### INPUT CONTEXT:

1. **Metadata**:
- Evaluation ID: ${input.metadata.evaluationId}
- Iteration: ${input.metadata.iteration}

2. **Flow Goal & Current Step**:
- Goal: "${input.flowDefinition.flowDescription}"
- Current Step Objective: "${input.flowDefinition.currentStepObjective}"

3. **Flow State**:
- Completed Steps: ${input.flowState.completedSteps.join(', ') || 'None'}
- Previous Actions: ${JSON.stringify(input.flowState.previousActions)}
- Blocking Error: ${input.flowState.blockingError || 'None'}

4. **User Archetype Profile**:
- Name: ${input.userArchetype.fullName} (${input.userArchetype.profession}, Age: ${input.userArchetype.age})
- Archetype: ${input.userArchetype.archetype}
- Phrase: "${input.userArchetype.phrase}"
- Goals: ${input.userArchetype.goals.join(', ')}
- Frustrations: ${input.userArchetype.frustrations.join(', ')}

5. **Technical Context**:
- Current URL: ${input.technicalContext.url}
- Visible Interactive Elements:
${JSON.stringify(input.technicalContext.visibleDOMSummary)}

---

### CONSTRAINTS & RULES:
- Do not assume elements are clickable or visible unless present in 'visibleDOMSummary'.
- Do not invent actions or selectors. Use CSS selectors, role labels, alt texts, or text values directly corresponding to elements in 'visibleDOMSummary'.
- Suggest a maximum of ONE browser action per iteration.
- Supported Action Types: CLICK, TYPE, HOVER, FOCUS, CLEAR, CHECK, UNCHECK, WAIT, NAVIGATE, SELECT.
- For SELECT actions, set 'inputData' to the target option value or text.
- If the flow goal is met or you hit an unresolvable blocker, set suggestedAction to null and recommendedNextStep to 'stopFlow'.
- DO NOT generate UX findings, Nielsen audit codes, or WCAG accessibility reports during this step.

---

Respond ONLY with valid JSON matching this exact structure:
{
  "evaluationSummary": {
    "flowCanContinue": <boolean>,
    "notes": "<short explanation of current state>"
  },
  "suggestedAction": {
    "actionType": "<CLICK|TYPE|HOVER|FOCUS|CLEAR|CHECK|UNCHECK|WAIT|NAVIGATE|SELECT>",
    "targetElement": {
      "matchStrategy": "<CSS|XPATH|TEXT|ROLE|LABEL|PLACEHOLDER|ALT_TEXT|TEST_ID>",
      "value": "<selector value>"
    },
    "inputData": "<text to type for TYPE, option value for SELECT, otherwise omit>",
    "rationale": "<action reasoning>",
    "confidence": "<low|medium|high>"
  } (or null),
  "flowControl": {
    "isStopper": <boolean>,
    "stopperReason": "<reason text or null>",
    "recommendedNextStep": "<executeSuggestedAction|requestMoreContext|stopFlow>"
  }
}
`.trim();
  }

  /**
   * Builds Phase 2 Specialized Domain Audit Prompt (Explicit Heuristics, WCAG 2.2 & UX Writing).
   */
  private buildV2AuditPrompt(input: V2AuditAnalysisInput): string {
    return `
You are EvalUXIA's Specialized Domain Audit Engine (Phase 2).
Your task is to conduct a rigorous, formal UX and Accessibility Audit on the full navigation session executed by a user persona.

---

### EVALUATION CONTEXT:
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
${input.accessibilityTrees && input.accessibilityTrees.length > 0 ? `- Accessibility ARIA Snapshots:\n${input.accessibilityTrees.join('\n---\n')}` : ''}

---

### DOMAIN EVALUATION FRAMEWORKS & EXPLICIT RULES:

1. **JAKOB NIELSEN'S 10 USABILITY HEURISTICS (UX Domain)**:
   - **N-01: Visibilidad del estado del sistema**: Feedback claro e inmediato de las acciones.
   - **N-02: Coincidencia entre el sistema y el mundo real**: Lenguaje y conceptos familiares al usuario.
   - **N-03: Control y libertad del usuario**: Salidas de emergencia, deshacer/rehacer sin frustración.
   - **N-04: Consistencia y estándares**: Mismos términos, iconos y layouts en todo el flujo.
   - **N-05: Prevención de errores**: Diseño defensivo que evita fallos antes de que ocurran.
   - **N-06: Reconocimiento antes que recuerdo**: Opciones e instrucciones visibles sin exigir memorización.
   - **N-07: Flexibilidad y eficiencia de uso**: Atajos para expertos sin entorpecer novatos.
   - **N-08: Diseño estético y minimalista**: Diálogos sin información irrelevante o sobrecarga visual.
   - **N-09: Ayudar a reconocer, diagnosticar y recuperarse de errores**: Mensajes de error claros en lenguaje llano.
   - **N-10: Ayuda y documentación**: Instrucciones fáciles de buscar y orientadas a tareas.

2. **WCAG 2.2 CORE ACCESSIBILITY CRITERIA (Accessibility Domain)**:
   - **WCAG 1.1.1 Contenido no textual**: Alternativas de texto para imágenes, iconos y elementos gráficos.
   - **WCAG 1.3.1 Información y relaciones**: Estructura semántica correcta (encabezados h1-h6, roles ARIA, labels de form).
   - **WCAG 1.4.3 Contraste mínimo**: Ratio de contraste texto/fondo adecuado.
   - **WCAG 2.1.1 Teclado**: Toda la funcionalidad accesible exclusivamente con teclado.
   - **WCAG 2.4.4 Propósito de los enlaces**: Texto de enlace claro por sí solo.
   - **WCAG 3.3.2 Etiquetas o instrucciones**: Labels visibles e instrucciones en campos requeridos.
   - **WCAG 4.1.2 Nombre, función y valor**: Name, Role y Value accesibles en componentes interactivos.

3. **UX WRITING & COGNITIVE FRICTION (Content Domain)**:
   - Evalúa claridad, jerarquía textual, tono emocional y sobrecarga cognitiva orientada al arquetipo '${input.archetype.archetype}'.

4. **SEVERITY CLASSIFICATION & SCORE FORMULA**:
   - **critical** (Penalización: -20 ptos): Impide completar la tarea principal o bloquea la navegación.
   - **high** (Penalización: -12 ptos): Causa seria confusión o frustración alta al arquetipo.
   - **medium** (Penalización: -6 ptos): Molestia o retraso menor en la experiencia.
   - **low** (Penalización: -2 ptos): Detalle cosmético o mejora menor.
   - **info** (Penalización: 0 ptos): Observación informativa.
   - **overallScore**: Inicia en 100 y resta las penalizaciones según los findings identificados (mínimo 0, máximo 100).

---

Respond ONLY with valid JSON matching this exact structure:
{
  "overallScore": <number 0-100>,
  "executiveSummary": "<Markdown formatted executive summary analyzing the session UX and WCAG compliance for the archetype>",
  "findings": [
    {
      "findingGroup": "<ux|accessibility>",
      "type": "<usability|content|interaction|visual|wcag>",
      "heuristic": "<e.g. N-01: Visibilidad del estado del sistema (for UX findings, null if accessibility)>",
      "wcagCriterion": "<e.g. WCAG 1.1.1 Contenido no textual (for accessibility findings, null if UX)>",
      "description": "<detailed problem description tailored to the archetype>",
      "recommendation": "<actionable, clear fix recommendation>",
      "affectedArchetypeTraits": ["<trait1>", "<trait2>"]
    }
  ]
}
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
export const aiDecisionService = aiService;
