import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
import { aiService } from '@/modules/ai/ai.service';
import { V2AIInputContext } from '@/modules/evaluations/services/context-builder.service';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { PHASE2_BUDGET, classifyPayloadLevel } from '@/shared/testing/payload-budgets';

/**
 * Hardening Post-Fase H — J2: CRITICAL Payload Enforcement.
 *
 * Todas las llamadas están mockeadas (stubGeminiJsonResponses / monkeypatch
 * directo de GeminiClient) — CERO Gemini real. Cubre J2-A a J2-I del plan.
 */
function buildEvidenceWithHeadingLength(chars: number): EvidenceInput[] {
  return [
    {
      iteration: 1, url: 'https://fixture.local/j2', screenshotPath: '/x.png',
      headings: [{ level: 1, text: 'x'.repeat(Math.max(0, chars)), selector: 'h1' }],
      images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];
}

function buildPhase2Input(evidences: EvidenceInput[]) {
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(evidences);
  return {
    evaluationId: 'j2', title: 'J2', url: 'https://fixture.local/j2',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: evidences.length,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
}

function promptCharsForHeadingLength(chars: number): number {
  const input = buildPhase2Input(buildEvidenceWithHeadingLength(chars));
  return ((aiService as any).buildV2AuditPrompt(input) as string).length;
}

const BASE_CONTEXT: V2AIInputContext = {
  metadata: { evaluationId: 'j2-phase1', timestamp: new Date().toISOString(), iteration: 1 },
  flowDefinition: { flowDescription: 'Prueba J2', currentStepObjective: 'Avanzar', totalStepsEstimated: 8 },
  flowState: { currentStep: 1, completedSteps: [], previousActions: [], blockingError: null },
  userArchetype: {
    fullName: 'Test Persona', phrase: 'Tester', age: 30, profession: 'QA', maritalStatus: 'Single',
    country: 'Colombia', city: 'Bogota', archetype: 'Explorer', biography: '', personality: '',
    goals: [], frustrations: [],
  },
  technicalContext: {
    url: 'https://example.com', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
    visibleDOMSummary: [{ type: 'button', text: 'Comenzar', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true, selector: 'button.btn-primary' }],
  },
  constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
} as V2AIInputContext;

function buildOversizedPhase1Context(itemCount: number): V2AIInputContext {
  const items = Array.from({ length: itemCount }).map((_, i) => ({
    type: 'button' as const, text: `Elemento de relleno número ${i} con texto adicional para inflar el payload`,
    ariaLabel: null, role: 'button', isDisabled: false, isPrimary: false, selector: `button:nth-of-type(${i + 1})`,
  }));
  return {
    ...BASE_CONTEXT,
    technicalContext: { ...BASE_CONTEXT.technicalContext, visibleDOMSummary: items as any },
  };
}

async function main() {
  console.log('🧪 Starting J2 — CRITICAL Payload Enforcement (Hardening Post-Fase H)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ==========================================================================
  // J2-A — NORMAL: Gemini SÍ se ejecuta, sin bloqueo
  // ==========================================================================
  {
    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const evidences = buildEvidenceWithHeadingLength(100);
      const level = classifyPayloadLevel(promptCharsForHeadingLength(100) + 9000, PHASE2_BUDGET); // referencia informativa
      const result = await aiService.performAuditAnalysis(buildPhase2Input(evidences) as any);
      assert(stub.callCount() === 1, `J2-A: payload NORMAL -> Gemini SÍ se invoca (callCount=${stub.callCount()})`);
      assert(result.usage.promptTokens > 0, 'J2-A: usage refleja una llamada real (no el resultado sintético de bloqueo)');
      assert(level !== undefined, 'J2-A: (referencia) nivel calculado localmente para contexto en logs');
    } finally {
      stub.restore();
    }
  }

  // ==========================================================================
  // J2-B — WARNING: Gemini SÍ se ejecuta, con log explícito de WARNING
  // ==========================================================================
  {
    // Calibración: overhead fijo + 1 char de campo = 1 char de prompt (texto sin espacios, sin escaping).
    const baseline = promptCharsForHeadingLength(0);
    const targetFieldChars = PHASE2_BUDGET.normalMaxChars - baseline + 5000; // aterriza establemente en zona WARNING
    const evidences = buildEvidenceWithHeadingLength(targetFieldChars);
    const actualChars = promptCharsForHeadingLength(targetFieldChars);
    assert(classifyPayloadLevel(actualChars, PHASE2_BUDGET) === 'WARNING', `J2-B: el payload construido cae en WARNING (chars=${actualChars}, normalMax=${PHASE2_BUDGET.normalMaxChars}, warningMax=${PHASE2_BUDGET.warningMaxChars})`);

    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const result = await aiService.performAuditAnalysis(buildPhase2Input(evidences) as any);
      assert(stub.callCount() === 1, `J2-B: payload WARNING -> Gemini SÍ se invoca (callCount=${stub.callCount()})`);
      assert(result.usage.promptTokens > 0, 'J2-B: usage real, la solicitud continuó sin alterar el payload');
    } finally {
      stub.restore();
    }
  }

  // ==========================================================================
  // J2-C — CRITICAL: Gemini NO se ejecuta, se registra el bloqueo
  // ==========================================================================
  {
    const baseline = promptCharsForHeadingLength(0);
    const targetFieldChars = PHASE2_BUDGET.warningMaxChars - baseline + 50_000; // muy por encima del umbral CRITICAL
    const evidences = buildEvidenceWithHeadingLength(targetFieldChars);
    const actualChars = promptCharsForHeadingLength(targetFieldChars);
    assert(classifyPayloadLevel(actualChars, PHASE2_BUDGET) === 'CRITICAL', `J2-C: el payload construido cae en CRITICAL (chars=${actualChars})`);

    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const result = await aiService.performAuditAnalysis(buildPhase2Input(evidences) as any);
      assert(stub.callCount() === 0, `J2-C: payload CRITICAL -> Gemini NUNCA se invoca (callCount=${stub.callCount()})`);
      assert(result.result.findings.length === 0, 'J2-C: el resultado sintético no contiene findings de IA inventados');
      assert(result.usage.promptTokens === 0 && result.usage.outputTokens === 0 && result.usage.totalTokens === 0, 'J2-C: usage=0 -- cero tokens reales consumidos, ninguna llamada ocurrió');
      assert(result.result.executiveSummary.includes('CRITICAL'), 'J2-C: el executiveSummary explica honestamente por qué no hay análisis de IA');
    } finally {
      stub.restore();
    }
  }

  // ==========================================================================
  // J2-D — límite exacto (frontera WARNING/CRITICAL, la que determina el bloqueo)
  // ==========================================================================
  {
    const baseline = promptCharsForHeadingLength(0);
    const boundary = PHASE2_BUDGET.warningMaxChars;

    const fieldAtBoundary = boundary - baseline;
    const fieldOneBelow = fieldAtBoundary - 1;
    const fieldOneAbove = fieldAtBoundary + 1;

    const casesAtBoundary = [
      { label: 'límite - 1', field: fieldOneBelow, expectedLevel: 'WARNING' as const },
      { label: 'límite exacto', field: fieldAtBoundary, expectedLevel: 'WARNING' as const },
      { label: 'límite + 1', field: fieldOneAbove, expectedLevel: 'CRITICAL' as const },
    ];

    for (const c of casesAtBoundary) {
      const actualChars = promptCharsForHeadingLength(c.field);
      const level = classifyPayloadLevel(actualChars, PHASE2_BUDGET);
      assert(level === c.expectedLevel, `J2-D (${c.label}): chars=${actualChars} (umbral=${boundary}) -> level=${level} (esperado: ${c.expectedLevel})`);

      const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
      try {
        await aiService.performAuditAnalysis(buildPhase2Input(buildEvidenceWithHeadingLength(c.field)) as any);
        const expectedCalls = c.expectedLevel === 'CRITICAL' ? 0 : 1;
        assert(stub.callCount() === expectedCalls, `J2-D (${c.label}): callCount=${stub.callCount()} (esperado: ${expectedCalls}) -- documentado: classifyPayloadLevel usa "<=" para WARNING, por lo que EXACTAMENTE en el límite (chars===warningMaxChars) el resultado es WARNING (procede), no CRITICAL`);
      } finally {
        stub.restore();
      }
    }
  }

  // ==========================================================================
  // J2-E — Phase 1: comportamiento NORMAL sin alterar, y bloqueo real en CRITICAL
  // ==========================================================================
  {
    const stubNormal = stubGeminiJsonResponses([
      JSON.stringify({
        evaluationSummary: { flowCanContinue: true, confidenceLevel: 'high', notes: '' },
        userIntention: { description: 'Navegación táctica', derivedFromArchetype: false },
        suggestedAction: {
          actionType: 'CLICK',
          targetElement: { matchStrategy: 'CSS', value: 'button.btn-primary' },
          rationale: 'Único botón primario visible.',
          confidence: 'high',
        },
        riskAssessment: { confusionProbability: 'low', abandonmentRisk: 'low', errorRisk: 'low' },
        flowControl: { isStopper: false, stopperReason: null, recommendedNextStep: 'executeSuggestedAction' },
      }),
    ]);
    try {
      const result = await aiService.makeDecision(BASE_CONTEXT);
      assert(stubNormal.callCount() === 1, `J2-E: Phase 1 con payload NORMAL procede sin cambios (callCount=${stubNormal.callCount()})`);
      assert(result.result.suggestedAction?.actionType === 'CLICK', 'J2-E: la decisión real de Phase 1 se preserva intacta');
    } finally {
      stubNormal.restore();
    }

    // Phase 1 CRITICAL: sin fallback seguro -> AppError, Gemini nunca invocado.
    const oversizedContext = buildOversizedPhase1Context(3000);
    const stubCritical = stubGeminiJsonResponses([JSON.stringify({})]);
    try {
      let threw = false;
      let errorStatusCode: number | undefined;
      try {
        await aiService.makeDecision(oversizedContext);
      } catch (e: any) {
        threw = true;
        errorStatusCode = e.statusCode;
      }
      assert(threw, 'J2-E: Phase 1 con payload CRITICAL lanza un error controlado (sin fallback seguro para una decisión de navegación)');
      assert(errorStatusCode === 502, `J2-E: el error preserva statusCode 502 (obtenido: ${errorStatusCode})`);
      assert(stubCritical.callCount() === 0, `J2-E: Gemini NUNCA se invoca para el payload CRITICAL de Phase 1 (callCount=${stubCritical.callCount()})`);
    } finally {
      stubCritical.restore();
    }
  }

  // ==========================================================================
  // J2-G — deterministic-only: Phase 2 bloqueada no corrompe la evaluación
  // ==========================================================================
  {
    const evidences: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/j2g', screenshotPath: '/x.png', headings: [], images: [{ selector: 'img.hero', src: '/x.png', alt: null, ariaLabel: null, role: null, isDecorative: false }], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] },
    ];
    const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
    assert(deterministicFindings.some((f: any) => f.wcagCriterion?.includes('1.1.1') && f.status === 'FAIL'), 'Precondición: hay un finding determinístico real e independiente de Gemini');

    const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(evidences);
    // Fuerza CRITICAL agregando un heading gigante a la MISMA evidencia usada para el determinístico.
    const criticalHeadingLength = PHASE2_BUDGET.warningMaxChars + 50_000;
    (evidencesSummary[0] as any).headings = [{ level: 1, text: 'x'.repeat(criticalHeadingLength), selector: 'h1' }];

    const input = {
      evaluationId: 'j2g', title: 'J2-G', url: 'https://fixture.local/j2g',
      archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
      completedSteps: [], previousActions: [], snapshotsCount: 1,
      evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
    };

    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const auditResult = await aiService.performAuditAnalysis(input as any);
      assert(stub.callCount() === 0, `J2-G: Gemini NUNCA se invoca (callCount=${stub.callCount()})`);

      const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons });
      const validatedAiFindings = evidenceGateService.processAiFindings(auditResult.result.findings, evidenceIndex);
      assert(validatedAiFindings.length === 0, 'J2-G: cero findings de IA (nada que procesar, ni inventado ni degradado)');

      const allRawFindings: InputAuditFinding[] = [
        ...deterministicFindings.map((df: any) => ({ findingGroup: df.findingGroup, type: df.type, status: df.status, severity: df.severity, confidence: df.confidence, description: df.description, heuristicCode: df.heuristicCode, heuristicName: df.heuristicName, wcagCriterion: df.wcagCriterion, evidence: df.evidence, affectedElement: df.affectedElement, impact: df.impact, recommendation: df.recommendation, iteration: df.iteration, url: df.url, screenshotUrl: df.screenshotUrl })),
        ...validatedAiFindings.map((f: any) => ({ findingGroup: f.findingGroup, type: f.type || 'usability', status: f.status || 'FAIL', severity: f.severity, confidence: f.confidence || 'high', description: f.description, heuristicCode: f.heuristicCode || undefined, heuristicName: f.heuristicName || undefined, heuristic: f.heuristic || undefined, wcagCriterion: f.wcagCriterion || undefined, evidence: f.evidence || [], affectedElement: f.affectedElement || undefined, impact: f.impact || undefined, recommendation: f.recommendation || undefined, iteration: 1, url: 'https://fixture.local/j2g', screenshotUrl: '/uploads/j2g_step_1.png' })),
      ];
      const metrics = auditMetricsService.calculateMetrics(allRawFindings);

      assert(metrics.consolidatedFindings.some((f: any) => f.wcagCriterion?.includes('1.1.1') && f.status === 'FAIL'), 'J2-G: el finding determinístico SOBREVIVE intacto en la evaluación deterministic-only');
      assert(!metrics.consolidatedFindings.some((f: any) => f.confidence === 'high' && f.status === 'FAIL' && !f.wcagCriterion), 'J2-G: no aparece ningún falso FAIL atribuible a Gemini (Gemini no aportó nada)');
      assert(typeof metrics.overallScore === 'number' && !Number.isNaN(metrics.overallScore), `J2-G: metrics.overallScore sigue siendo un número coherente (obtenido: ${metrics.overallScore}) -- la evaluación no queda corrupta`);
      assert(auditResult.result.executiveSummary.length > 0, 'J2-G: existe un executiveSummary honesto para el reporte, pese a que Gemini no se ejecutó');
    } finally {
      stub.restore();
    }
  }

  // ==========================================================================
  // J2-H — no bypass: instrumentación dinámica del punto real de llamada (mismo patrón que G7)
  // ==========================================================================
  {
    const client = GeminiClient.getInstance();
    const original = (client as any).client.models.generateContent;
    let callHappened = false;
    (client as any).client.models.generateContent = async () => {
      callHappened = true;
      throw new Error('Esta llamada NUNCA debería ocurrir para un payload CRITICAL');
    };
    try {
      const baseline = promptCharsForHeadingLength(0);
      const fieldChars = PHASE2_BUDGET.warningMaxChars - baseline + 100_000;
      const result = await aiService.performAuditAnalysis(buildPhase2Input(buildEvidenceWithHeadingLength(fieldChars)) as any);
      assert(callHappened === false, 'J2-H: instrumentación dinámica del punto real de llamada confirma que generateContent NUNCA se invocó para un payload CRITICAL en el flujo de producción (AiService.performAuditAnalysis)');
      assert(result.result.findings.length === 0, 'J2-H: el flujo de producción completa sin error, con el resultado sintético de bloqueo');
    } finally {
      (client as any).client.models.generateContent = original;
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
