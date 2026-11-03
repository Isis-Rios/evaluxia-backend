import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex, EvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { applyClaimConsistency } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * Fase G — Gemini Mock (testing-only module).
 *
 * Reuses the EXACT monkeypatch mechanism already validated in
 * gemini-resilience.test.ts (Casos H-K): stubs `client.models.generateContent`
 * on the real `GeminiClient` singleton (the actual Google GenAI SDK object
 * is never touched further than that one field) — no real network call,
 * cero cost, cero calls to Gemini. `GeminiClient.getInstance()` is the SAME
 * singleton `aiService` holds internally (`this.client = GeminiClient.
 * getInstance()`, ai.service.ts), so stubbing it here transparently affects
 * `aiService.performAuditAnalysis` without touching aiService itself.
 */
export function stubGeminiJsonResponses(responses: Array<string | Error>): { callCount: () => number; restore: () => void } {
  const client = GeminiClient.getInstance();
  let callCount = 0;
  const original = (client as any).client.models.generateContent;
  (client as any).client.models.generateContent = async () => {
    const next = responses[Math.min(callCount, responses.length - 1)];
    callCount++;
    if (next instanceof Error) throw next;
    return { text: next, usageMetadata: undefined };
  };
  return {
    callCount: () => callCount,
    restore: () => {
      (client as any).client.models.generateContent = original;
    },
  };
}

/**
 * J3 (Hardening Post-Fase H) — variante ADITIVA de `stubGeminiJsonResponses`
 * (esa función queda intacta, sin cambios, para no arriesgar ninguna
 * regresión en G1-G7/H0) que permite simular un `usageMetadata` completo o
 * parcial por respuesta -- necesario para probar la extracción de
 * thinkingTokens/cachedContentTokens/toolUsePromptTokens en
 * gemini.client.ts SIN ninguna llamada real. Los nombres de campo del
 * objeto `usageMetadata` simulado son EXACTAMENTE los del SDK real
 * (`GenerateContentResponseUsageMetadata`, @google/genai) -- nunca un
 * campo inventado.
 */
export interface MockGeminiResponseWithUsage {
  text: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    toolUsePromptTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function stubGeminiResponsesWithUsage(
  responses: Array<MockGeminiResponseWithUsage | Error>,
): { callCount: () => number; restore: () => void } {
  const client = GeminiClient.getInstance();
  let callCount = 0;
  const original = (client as any).client.models.generateContent;
  (client as any).client.models.generateContent = async () => {
    const next = responses[Math.min(callCount, responses.length - 1)];
    callCount++;
    if (next instanceof Error) throw next;
    return { text: next.text, usageMetadata: next.usageMetadata };
  };
  return {
    callCount: () => callCount,
    restore: () => {
      (client as any).client.models.generateContent = original;
    },
  };
}

export interface Phase2PipelineResult {
  deterministicFindings: any[];
  rawAiFindings: V2AuditFinding[];
  /**
   * J6 (Hardening Post-Fase H): findings de IA tras las 3 defensas, en el
   * MISMO orden que producción -- EvidenceGate/J1 -> cardinality enforcement
   * -> J6 (evidence claim consistency). Ya NO es solo el resultado de
   * EvidenceGate (ver `gatedAiFindings`/`cardinalityCheckedFindings` más
   * abajo si se necesita inspeccionar un paso intermedio).
   */
  validatedAiFindings: V2AuditFinding[];
  allRawFindings: InputAuditFinding[];
  metrics: ReturnType<typeof auditMetricsService.calculateMetrics>;
  prompt: string;
  usage: any;
  /** J4 Step 2 — the final, budget-prioritized computedStyles set actually sent (same one used to build the traceability index). */
  dedupedComputedStyles: any[];
  /** J4 Step 2 — prioritization stats (candidate/final counts, per-group sizes/retained), for assertions and telemetry inspection in tests. */
  computedStylesPrioritization: { candidateCount: number; finalCount: number; groupSizes: Record<string, number>; groupRetained: Record<string, number> };
  /** J6 (Hardening Post-Fase H) — resultado intermedio, solo EvidenceGate/J1 (antes de cardinality/J6), para tests que necesiten inspeccionar ese paso específico. */
  gatedAiFindings: V2AuditFinding[];
  /** H-REGRESSION-4 — resultado intermedio, tras cardinality enforcement, ANTES de J6 (lo que J6 realmente recibe como input). */
  cardinalityCheckedFindings: V2AuditFinding[];
  /** J6 (Hardening Post-Fase H) — resumen de `applyCardinalityEnforcement` (total/violations). */
  cardinalitySummary: { total: number; violations: number };
  /** J6 (Hardening Post-Fase H) — resumen de `applyClaimConsistency` (total/consistent/inconsistent/insufficient). */
  j6Summary: { total: number; consistent: number; inconsistent: number; insufficient: number };
  /** H-REGRESSION-4 — el mismo EvidenceIndex ya construido para esta corrida, expuesto para análisis externo (ej. buildH4FindingsReport) sin tener que reconstruirlo. */
  evidenceIndex: EvidenceIndex;
}

/**
 * Reproduces AuditEngine.performAudit's steps 3-8 (deterministic analysis
 * through metrics consolidation — see audit-engine.service.ts) WITHOUT any
 * DB dependency. Steps 1/2/9+ of the real method (load Evaluation, load
 * SnapshotEvidence from Mongo, persist FAIL findings) are out of scope here,
 * exactly as they were out of scope for every Fase A-F test — this harness
 * exercises ONLY the pure consolidation logic, using the REAL production
 * functions at every step (nothing reimplemented): deterministicAnalyzer,
 * buildDeduplicatedEvidenceContext, aiService.performAuditAnalysis (which
 * internally calls the mocked GeminiClient), evidenceGateService, and
 * auditMetricsService — in the SAME order and with the SAME
 * deterministic-precedes-AI invariant documented in audit-engine.service.ts.
 */
export async function runMockedPhase2Pipeline(
  evidences: EvidenceInput[],
  meta: { evaluationId: string; url?: string; explorationNote?: string } = { evaluationId: 'g-mock' },
): Promise<Phase2PipelineResult> {
  const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDedupedComputedStyles } = buildDeduplicatedEvidenceContext(evidences);

  // J4 Step 2 (Hardening Post-Fase H): mismo wiring que audit-engine.
  // service.ts en producción -- prioriza el conjunto completo deduplicado a
  // un presupuesto final, usando las mismas señales (otra evidencia +
  // findings determinísticos independientes de contraste).
  const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
  const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
  const { final: dedupedComputedStyles, candidateCount, finalCount, groupSizes, groupRetained } = prioritizeComputedStyles(
    allDedupedComputedStyles,
    { otherEvidenceSelectors, independentFindingSelectors },
  );

  const input: any = {
    evaluationId: meta.evaluationId,
    title: 'G-mock',
    url: meta.url || 'https://fixture.local/g-mock',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [],
    previousActions: [],
    snapshotsCount: evidences.length,
    evidencesSummary,
    dedupedLandmarks,
    dedupedLinks,
    dedupedButtons,
    dedupedComputedStyles,
    accessibilityTrees: [],
    explorationNote: meta.explorationNote,
  };

  // Captura el prompt EXACTO que se envía: performAuditAnalysis aplica
  // internamente el mismo sanitizeEvidenceForGemini antes de construirlo
  // (ver ai.service.ts, performAuditAnalysis) -- se reproduce aquí solo
  // para poder inspeccionar el string, sin alterar lo que se envía realmente.
  const sanitizedForPromptCapture = sanitizeEvidenceForGemini(evidencesSummary as any);
  const prompt: string = (aiService as any).buildV2AuditPrompt({ ...input, evidencesSummary: sanitizedForPromptCapture });

  const auditResult = await aiService.performAuditAnalysis(input);
  const rawAiFindings = auditResult.result.findings;

  // J1 (Hardening Post-Fase H): mismo wiring que audit-engine.service.ts en
  // producción -- el índice se construye a partir de EXACTAMENTE los
  // mismos objetos ya usados para construir el prompt (arriba). J4 Step 2:
  // computedStyles se indexa desde el FINAL SET priorizado.
  const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });
  const gatedAiFindings = evidenceGateService.processAiFindings(rawAiFindings, evidenceIndex);

  // J6 (Hardening Post-Fase H): mismo wiring que audit-engine.service.ts en
  // producción -- EvidenceGate (J1 incluido) -> cardinality enforcement ->
  // J6 (evidence claim consistency). Mismas funciones de producción, sin
  // reimplementar nada. `validatedAiFindings` ahora representa el resultado
  // FINAL tras las 3 defensas (igual que en producción), no solo EvidenceGate.
  const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } = applyCardinalityEnforcement(gatedAiFindings);
  const { findings: validatedAiFindings, summary: j6Summary } = applyClaimConsistency(cardinalityCheckedFindings, evidenceIndex);

  // Orden reflejado de audit-engine.service.ts (determinístico antes que IA,
  // por convención/legibilidad); el `origin` explícito en cada finding
  // (abajo) es lo que realmente arbitra una colisión de criterio+selector
  // con `status` distinto -- ver AuditMetricsService.applyStatusConsolidationPolicy.
  const allRawFindings: InputAuditFinding[] = [
    ...deterministicFindings.map((df: any) => ({
      findingGroup: df.findingGroup,
      type: df.type,
      status: df.status,
      severity: df.severity,
      confidence: df.confidence,
      description: df.description,
      heuristicCode: df.heuristicCode,
      heuristicName: df.heuristicName,
      wcagCriterion: df.wcagCriterion,
      evidence: df.evidence,
      affectedElement: df.affectedElement,
      impact: df.impact,
      recommendation: df.recommendation,
      iteration: df.iteration,
      url: df.url,
      screenshotUrl: df.screenshotUrl,
      origin: 'deterministic' as const,
    })),
    ...validatedAiFindings.map((f: any) => ({
      findingGroup: f.findingGroup,
      type: f.type || 'usability',
      status: f.status || 'FAIL',
      severity: f.severity,
      confidence: f.confidence || 'high',
      description: f.description,
      heuristicCode: f.heuristicCode || undefined,
      heuristicName: f.heuristicName || undefined,
      heuristic: f.heuristic || undefined,
      wcagCriterion: f.wcagCriterion || undefined,
      evidence: f.evidence || [],
      affectedElement: f.affectedElement || undefined,
      impact: f.impact || undefined,
      recommendation: f.recommendation || undefined,
      iteration: 1,
      url: meta.url,
      screenshotUrl: `/uploads/${meta.evaluationId}_step_1.png`,
      origin: 'ai' as const,
    })),
  ];

  const metrics = auditMetricsService.calculateMetrics(allRawFindings);

  return {
    deterministicFindings, rawAiFindings, validatedAiFindings, allRawFindings, metrics, prompt,
    usage: auditResult.usage,
    dedupedComputedStyles,
    computedStylesPrioritization: { candidateCount, finalCount, groupSizes, groupRetained },
    gatedAiFindings,
    cardinalityCheckedFindings,
    cardinalitySummary,
    j6Summary,
    evidenceIndex,
  };
}

/** Builds a minimal, schema-valid V2AuditOutput JSON string, for scenarios that only need "a valid response". */
export function buildValidAuditOutputJson(findings: any[], overallScore = 80): string {
  return JSON.stringify({
    overallScore,
    executiveSummary: 'Resumen ejecutivo de prueba (Fase G, mock).',
    findings,
  });
}
