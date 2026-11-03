import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { evaluationRepository } from '../evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { aiService } from '@/modules/ai/ai.service';
import { metricsTracker, buildMetricsAudit, buildExplorationIntegrity, appendSummaryDisclaimer } from '@/shared/infrastructure/metrics-tracker';
import { AUDIT_STATUS } from '@/config/constants';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { deterministicAnalyzer } from './deterministic-analyzer.service';
import { evidenceGateService } from './evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from './audit-metrics.service';
import { buildDeduplicatedEvidenceContext } from './evidence-deduplication.service';
import { buildEvidenceIndex } from './evidence-traceability.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from './evidence-prioritization.service';
import { applyClaimConsistency } from './evidence-claim-consistency.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';

/**
 * P1.2 — forma mínima de `IEvaluation.flowState` que esta función realmente
 * necesita (no el documento Mongoose completo), para poder probarla con un
 * objeto sintético, sin Mongo.
 */
export interface ExplorationFlowStateForAudit {
  blockingError?: string | null;
  currentStep?: number;
  terminationReason?: 'NATURAL_STOP' | 'MAX_ITERATIONS_REACHED' | 'ACTION_FAILED' | 'INVALID_ACTION_DECISION' | 'EXPLORATION_ERROR' | 'UNKNOWN';
  snapshotIntegrity?: {
    lastActionVerifiedBySnapshot?: boolean;
    persistenceFailures?: Array<{ iteration: number; error: string }>;
  };
}

export interface ExplorationAuditSignal {
  rawBlockingError: string | null;
  /** Texto corto enviado al prompt de Fase 2 (ver ai.service.ts, `explorationNote`); `undefined` cuando no hay nada que señalizar. */
  explorationNote: string | undefined;
  terminationReason: ExplorationFlowStateForAudit['terminationReason'];
  lastActionVerifiedBySnapshot: boolean | undefined;
  snapshotPersistenceFailureCount: number;
}

/**
 * P1.2 (investigación forense, pilotos 3/4 reales) — extraída de
 * `performAudit` (sin cambiar su resultado) para poder probar, sin Mongo,
 * que el `flowState` persistido en Fase 1 se traduce correctamente en (a) la
 * nota que recibe Gemini en Fase 2 y (b) los datos que alimentan
 * `buildExplorationIntegrity`. `performAudit` le pasa exactamente
 * `evaluationDoc?.flowState`, sin transformarlo antes de llamarla.
 *
 * Reutiliza el MISMO campo `explorationNote` que ya existía para
 * `blockingError` (P1.1, Parte D) — no introduce un mecanismo nuevo, solo
 * amplía qué lo dispara: un agotamiento de `maxIterations` justo tras una
 * última acción sin snapshot de verificación, o un fallo de persistencia de
 * snapshot, son tan relevantes para Gemini como un `blockingError` clásico,
 * aunque este último sea `null` en esos dos casos.
 */
export function deriveExplorationAuditSignal(
  flowState: ExplorationFlowStateForAudit | undefined,
): ExplorationAuditSignal {
  const rawBlockingError = flowState?.blockingError || null;
  const terminationReason = flowState?.terminationReason;
  const lastActionVerifiedBySnapshot = flowState?.snapshotIntegrity?.lastActionVerifiedBySnapshot;
  const snapshotPersistenceFailureCount = flowState?.snapshotIntegrity?.persistenceFailures?.length ?? 0;

  let explorationNote: string | undefined;
  if (rawBlockingError) {
    explorationNote = `The exploration session ended with an unresolved interruption at step ${flowState?.currentStep ?? '?'}: ${rawBlockingError.slice(0, 150)}${rawBlockingError.length > 150 ? '…' : ''}`;
  } else if (terminationReason === 'MAX_ITERATIONS_REACHED' && lastActionVerifiedBySnapshot === false) {
    explorationNote = `The exploration session reached its iteration limit immediately after executing its last action; no further snapshot was captured to confirm that action actually produced its intended effect.`;
  } else if (snapshotPersistenceFailureCount > 0) {
    explorationNote = `${snapshotPersistenceFailureCount} snapshot(s) failed to persist during this exploration session; some iterations may be missing from the evidence bundle below.`;
  }

  return {
    rawBlockingError,
    explorationNote,
    terminationReason,
    lastActionVerifiedBySnapshot,
    snapshotPersistenceFailureCount,
  };
}

export interface Phase1MetricsInput {
  phase1Calls: number;
  phase1PromptTokens: number;
  phase1OutputTokens: number;
  phase1ExecutionTimeMs: number;
  /** J3 (Hardening Post-Fase H) — opcional, aditivo: observacional, tarifa no verificada. */
  phase1ThinkingTokens?: number;
}

/**
 * AuditEngine — Motor de Auditoría Asíncrona Especializada Basado en Evidencia (Fase 2 Subetapa 3D).
 */
export class AuditEngine {
  private static instance: AuditEngine;

  private constructor() {}

  public static getInstance(): AuditEngine {
    if (!AuditEngine.instance) {
      AuditEngine.instance = new AuditEngine();
    }
    return AuditEngine.instance;
  }

  /**
   * Ejecuta la auditoría de dominio de la Fase 2 sobre la evaluación completada.
   */
  public async performAudit(
    evaluationId: string,
    title: string,
    phase1Metrics?: Phase1MetricsInput,
  ): Promise<void> {
    console.log(`[AuditEngine] 🔍 Starting Phase 2 specialized async audit for evaluation ${evaluationId}...`);

    let userIdStr = '';

    try {
      // 1. Obtener la evaluación por id directo
      const evaluationDoc = await evaluationRepository.findById(evaluationId);
      if (evaluationDoc) {
        userIdStr = evaluationDoc.userId.toString();
      }

      let profileData = {
        fullName: 'Usuario Simulado',
        archetype: 'El Inocente',
        profession: 'General',
        phrase: 'Buscando una experiencia simple',
        goals: ['Navegar sin complicaciones'],
        frustrations: ['Interfaces sobrecargadas'],
      };

      if (evaluationDoc) {
        try {
          const fetchedProfile = await evaluatorProfileService.findById(
            evaluationDoc.userId.toString(),
            evaluationDoc.evaluatorProfileId.toString(),
          );
          if (fetchedProfile) {
            profileData = {
              fullName: fetchedProfile.fullName,
              archetype: fetchedProfile.archetype,
              profession: fetchedProfile.profession,
              phrase: fetchedProfile.phrase,
              goals: fetchedProfile.goals || [],
              frustrations: fetchedProfile.frustrations || [],
            };
          }
        } catch (profileErr) {
          console.warn(`[AuditEngine] Could not load full profile for audit, using defaults:`, profileErr);
        }
      }

      // 2. Recuperar la secuencia completa de SnapshotEvidence de todas las iteraciones
      const evidences = await snapshotEvidenceService.getEvidencesForEvaluation(evaluationId);
      console.log(`[AuditEngine] 📦 Retrieved ${evidences.length} SnapshotEvidence records from DB for evaluation ${evaluationId}`);

      // 3. Ejecutar Análisis Determinístico Programático (WCAG 1.4.3 Contraste, WCAG 1.1.1 Alt, Botones, Links, Headings)
      const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences);
      console.log(`[AuditEngine] ⚙️ Deterministic analysis completed: ${deterministicFindings.length} criteria evaluated.`);

      // 4. Preparar el resumen de evidencias estructuradas para el prompt de Gemini.
      // Phase C.2.1: landmarks/links/buttons are pulled out and deduplicated
      // across iterations (exact field-by-field match only, see
      // evidence-deduplication.service.ts) — headings/images/forms remain
      // untouched, one full copy per iteration. computedStyles (J4 Step 2)
      // is fed from `computedStylesCandidates` (the wider, bounded capture
      // pool) instead of the small `computedStyles` field --
      // DeterministicAnalyzer above already ran on the RAW `evidences`
      // (with the small, unchanged `computedStyles`), so this substitution
      // has zero effect on deterministic findings/statuses/scores.
      const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDedupedComputedStyles } =
        buildDeduplicatedEvidenceContext(
          evidences.map((ev) => ({
            iteration: ev.iteration,
            url: ev.url,
            screenshotPath: ev.screenshotPath,
            headings: ev.headings,
            images: ev.images,
            links: ev.links,
            buttons: ev.buttons,
            forms: ev.forms,
            landmarks: ev.landmarks,
            computedStyles: ev.computedStyles,
            computedStylesCandidates: ev.computedStylesCandidates,
          })),
        );

      // J4 Step 2b: select the final, budget-bounded computedStyles subset
      // from the full deduplicated candidate pool above. Signals reuse data
      // already computed in this same function — no new Playwright query,
      // no re-derivation.
      const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
      const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings);
      const { final: dedupedComputedStyles, candidateCount, finalCount, groupSizes, groupRetained } = prioritizeComputedStyles(
        allDedupedComputedStyles,
        { otherEvidenceSelectors, independentFindingSelectors },
      );
      console.log(
        `[AuditEngine] 🎯 computedStyles prioritization: candidates=${candidateCount} final=${finalCount} ` +
        `groups(size/retained)=finding:${groupSizes.finding}/${groupRetained.finding} evidenced:${groupSizes.evidenced}/${groupRetained.evidenced} unbacked:${groupSizes.unbacked}/${groupRetained.unbacked}`,
      );

      // J1 (Hardening Post-Fase H): índice de trazabilidad construido a
      // partir de EXACTAMENTE los mismos objetos que se envían a Gemini a
      // continuación (paso 5) -- nunca desde el DOM/Playwright. J4 Step 2:
      // computedStyles se indexa desde el FINAL SET priorizado, no desde el
      // conjunto completo ni desde evidencesSummary.
      const evidenceIndex = buildEvidenceIndex({ evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles });

      const interactions = await aiInteractionService.getInteractions(evaluationId);
      const completedSteps = evaluationDoc?.flowState?.completedSteps || [];
      const previousActions = evaluationDoc?.flowState?.previousActions || [];

      // P1.1, Parte D / P1.2 — ver docstring de `deriveExplorationAuditSignal`
      // (arriba en este mismo archivo) para el detalle completo.
      const {
        rawBlockingError,
        explorationNote,
        terminationReason,
        lastActionVerifiedBySnapshot,
        snapshotPersistenceFailureCount,
      } = deriveExplorationAuditSignal(evaluationDoc?.flowState);

      // 5. Invocar el prompt de auditoría de Fase 2 en AiService enviando el paquete de evidencias
      console.log(`[AuditEngine] 🤖 Invoking Phase 2 specialized evidence-based audit prompt with Gemini...`);
      const auditResult = await aiService.performAuditAnalysis({
        evaluationId,
        title: title || evaluationDoc?.title || 'Evaluación Web',
        url: evaluationDoc?.url || 'https://ejemplo.com',
        archetype: profileData,
        completedSteps,
        previousActions,
        snapshotsCount: evidences.length || interactions.length || 1,
        evidencesSummary,
        dedupedLandmarks,
        dedupedLinks,
        dedupedButtons,
        dedupedComputedStyles,
        accessibilityTrees: evidences.map((e) => e.accessibilityTree).filter(Boolean) as string[],
        explorationNote,
      });

      const { executiveSummary, findings: rawAiAuditFindings } = auditResult.result;

      // [Revisión MVP] Mismos árboles de accesibilidad ya enviados a Gemini
      // arriba (accessibilityTrees), concatenados como texto plano para que
      // la Gate Rule 0c verifique la procedencia de evidencia
      // ACCESSIBILITY_TREE -- nunca una fuente distinta a la que el modelo
      // realmente vio.
      const accessibilityTreeText = evidences
        .map((e) => e.accessibilityTree)
        .filter(Boolean)
        .join('\n---\n');

      // 6. Pasar los hallazgos de Gemini por la Barrera de Evidencia (Evidence Gate) para bloquear especulaciones
      const gatedAiFindings = evidenceGateService.processAiFindings(rawAiAuditFindings, evidenceIndex, accessibilityTreeText);
      console.log(`[AuditEngine] 🛡️ EvidenceGate processed AI findings: ${gatedAiFindings.length} valid findings.`);

      // 6a. J6 (Hardening Post-Fase H) — Cardinality enforcement: "1 finding
      // = 1 WCAG criterion" es responsabilidad del prompt (prevención); esto
      // es el enforcement determinista del backend. Nunca elige un código
      // "ganador" ni separa el finding -- solo degrada a NOT_EVALUABLE.
      const { findings: cardinalityCheckedFindings } = applyCardinalityEnforcement(gatedAiFindings);

      // 6b. J6 (Hardening Post-Fase H) — Evidence Claim Consistency: a
      // diferencia de J1 (¿el selector existe?), esto verifica que los
      // pares property/value citados en evidence[] correspondan realmente
      // al dato capturado para ese selector. Nunca corrige el valor citado
      // ni el criterio elegido -- solo degrada a NOT_EVALUABLE.
      const { findings: validatedAiFindings } = applyClaimConsistency(cardinalityCheckedFindings, evidenceIndex);

      // 7. Unificar todos los hallazgos en un arreglo para cálculo determinístico de métricas.
      // INVARIANT (histórico, Hardening post Gemini Real #1 ya no depende de
      // él para decidir ganador ante discrepancia -- ver
      // AuditMetricsService.applyStatusConsolidationPolicy): deterministicFindings
      // sigue precediendo a validatedAiFindings por convención/legibilidad,
      // pero el `origin` explícito en cada finding (abajo) es ahora lo que
      // realmente arbitra una colisión de criterio+selector con `status`
      // distinto -- el orden del array ya no decide eso por sí solo.
      const allRawFindings: InputAuditFinding[] = [
        ...deterministicFindings.map((df) => ({
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
        ...validatedAiFindings.map((f) => ({
          findingGroup: f.findingGroup,
          type: f.type || 'usability',
          status: f.status || 'FAIL',
          severity: f.severity as any,
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
          url: evaluationDoc?.url,
          screenshotUrl: `/uploads/evaluation_${evaluationId}_step_1.png`,
          origin: 'ai' as const,
        })),
      ];

      // 8. Calcular Métricas Determinísticas en Backend mediante AuditMetricsService (Gemini score es 100% ignorado)
      const metrics = auditMetricsService.calculateMetrics(allRawFindings);
      console.log(
        `[AuditEngine] 📊 Calculated Deterministic Backend Metrics: Score=${metrics.overallScore}, Nielsen Compliance=${metrics.nielsenMetrics.compliance}%, WCAG Compliance=${metrics.wcagMetrics.compliance}%, Audit Coverage=${metrics.auditCoverage}%`,
      );

      // 9. Persistir Hallazgos Consolidados (FAIL y NOT_EVALUABLE) en BD —
      // P1.5.2/Opción B: PASS nunca se persiste (no aporta evidencia nueva,
      // el Report ya resume compliance); NOT_EVALUABLE SÍ se persiste
      // porque, a diferencia de un criterio simplemente nunca tocado, es un
      // objeto real generado explícitamente por Gemini o por
      // deterministic-analyzer.service (ver P1.1: contraste RGBA inconcluso
      // y aria-labelledby no resoluble) -- antes se perdía en silencio pese
      // a ya estar correctamente contado en metrics.notEvaluableCount.
      // P1.6.2 Parte A — contador real de documentos efectivamente
      // persistidos en este bucle (no un recálculo posterior): alimenta
      // `buildMetricsAudit`'s `persistedFindingsCount`, que antes de este
      // cambio nunca reflejaba una cifra verificada, solo una suposición.
      let actualPersistedFindingsCount = 0;
      for (const cf of metrics.consolidatedFindings) {
        if (cf.status === 'FAIL' || cf.status === 'NOT_EVALUABLE') {
          await findingService.create(userIdStr, {
            evaluationId: evaluationId as any,
            iteration: cf.iteration,
            findingGroup: cf.findingGroup,
            type: cf.type,
            status: cf.status,
            severity: cf.severity as any,
            confidence: cf.confidence,
            description: cf.description,
            heuristicCode: cf.heuristicCode,
            heuristicName: cf.heuristicName,
            heuristic: cf.heuristic,
            wcagCriterion: cf.wcagCriterion,
            evidence: cf.evidence,
            affectedElement: cf.affectedElement,
            impact: cf.impact,
            recommendation: cf.recommendation,
            screenshotUrl: cf.screenshotUrl,
            discrepancy: cf.discrepancy,
          });
          actualPersistedFindingsCount++;
        }
      }

      // 10. Consolidar Métricas de Consumo de Tokens y Costos (Fase 1 + Fase 2)
      const p1Calls = phase1Metrics?.phase1Calls || 0;
      const p1Prompt = phase1Metrics?.phase1PromptTokens || 0;
      const p1Output = phase1Metrics?.phase1OutputTokens || 0;
      const p1Time = phase1Metrics?.phase1ExecutionTimeMs || 0;

      const p2Calls = 1;
      const p2Prompt = auditResult.usage.promptTokens;
      const p2Output = auditResult.usage.outputTokens;
      const p2Time = auditResult.executionTimeMs;
      // J3 — opcional, aditivo: observacional, tarifa no verificada.
      const p1Thinking = phase1Metrics?.phase1ThinkingTokens || 0;
      const p2Thinking = auditResult.usage.thinkingTokens || 0;

      // J3-retry-accounting (Hardening Post-Fase H) — puramente observacional
      // (mismo patrón que los demás logs [GeminiXAudit] ya existentes).
      // metricsTracker.recordEvaluation (abajo) sigue usando exclusivamente
      // auditResult.usage (último intento exitoso) -- decisión deliberada de
      // NO migrar el costo/consumo "oficial" persistido a la cifra
      // acumulada, que sería una decisión de producto, no técnica, fuera de
      // alcance de este cambio.
      if (auditResult.retryAccounting) {
        console.log(
          `[RetryAccountingAudit] phase=2 attempts=${auditResult.retryAccounting.attempts} ` +
          `cumulativePromptTokens=${auditResult.retryAccounting.cumulativeUsage.promptTokens} ` +
          `cumulativeOutputTokens=${auditResult.retryAccounting.cumulativeUsage.outputTokens} ` +
          `cumulativeTotalTokens=${auditResult.retryAccounting.cumulativeUsage.totalTokens} ` +
          `(final-attempt-only usage.promptTokens=${p2Prompt} outputTokens=${p2Output} -- ver metricsTracker.recordEvaluation abajo, sin cambios)`,
        );
      }

      const evaluationMetrics = metricsTracker.recordEvaluation({
        evaluationId,
        phase1Calls: p1Calls,
        phase2Calls: p2Calls,
        totalExecutionTimeMs: p1Time + p2Time,
        promptTokens: p1Prompt + p2Prompt,
        outputTokens: p1Output + p2Output,
        thinkingTokens: p1Thinking + p2Thinking,
      });

      // P1.1 — Partes B, C y D: ver `buildMetricsAudit`/`buildExplorationIntegrity`/
      // `appendSummaryDisclaimer` (metrics-tracker.ts) para el detalle y la
      // justificación de cada una; extraídas como funciones puras para
      // poder probarlas sin tocar MongoDB. Llamadas aquí sin cambiar el
      // resultado ni el punto donde se usan.
      //
      // P1.2 — `terminationReason` solo existe en `flowState` para
      // evaluaciones ejecutadas DESPUÉS de este cambio (campo opcional, ver
      // evaluation.model.ts). Para documentos históricos anteriores queda
      // `undefined`, y `buildExplorationIntegrity` cae a su forma de 1 solo
      // argumento (nunca se interpreta esa ausencia como "terminación
      // natural confirmada" -- ver su propio docstring).
      evaluationMetrics.metricsAudit = buildMetricsAudit(metrics.consolidatedFindings, actualPersistedFindingsCount);
      evaluationMetrics.explorationIntegrity = buildExplorationIntegrity(
        rawBlockingError,
        terminationReason
          ? {
              terminationReason,
              lastActionVerifiedBySnapshot: lastActionVerifiedBySnapshot ?? false,
              snapshotPersistenceFailureCount: snapshotPersistenceFailureCount,
            }
          : undefined,
      );
      // P1.6.2 Parte C — se reutiliza `evaluationMetrics.explorationIntegrity`
      // ya calculado arriba, nunca se recalcula nada aparte.
      const summaryWithDisclaimer = appendSummaryDisclaimer(executiveSummary, evaluationMetrics.explorationIntegrity);

      // 11. Crear/Actualizar el Reporte consolidado con métricas determinísticas
      const report = await reportRepository.findByEvaluationId(evaluationId);
      const reportData = {
        evaluationId,
        title: `Reporte de Experiencia de Usuario y Accesibilidad: ${title}`,
        status: 'ready' as const,
        summary: summaryWithDisclaimer,
        totalFindings: metrics.totalFindings,
        criticalCount: metrics.criticalCount,
        highCount: metrics.highCount,
        mediumCount: metrics.mediumCount,
        lowCount: metrics.lowCount,
        infoCount: metrics.infoCount,
        passCount: metrics.passCount,
        failCount: metrics.failCount,
        notEvaluableCount: metrics.notEvaluableCount,
        nielsenCompliance: metrics.nielsenMetrics.compliance,
        wcagCompliance: metrics.wcagMetrics.compliance,
        auditCoverage: metrics.auditCoverage,
        nielsenCoverage: metrics.nielsenMetrics.coverage,
        wcagCoverage: metrics.wcagMetrics.coverage,
        evaluatedCriteria: metrics.evaluatedCriteria,
        totalCriteria: metrics.totalCriteria,
        evidenceCount: metrics.evidenceCount,
        screenshotsCount: evidences.filter((e) => Boolean(e.screenshotPath)).length || 1,
        iterationsEvaluated: evidences.length || 1,
        overallScore: metrics.overallScore,
        metrics: evaluationMetrics,
        generatedAt: new Date(),
      };

      if (report) {
        await reportRepository.update(report.id, reportData);
      } else {
        await reportRepository.create(reportData as any);
      }

      // 12. Marcar auditStatus = COMPLETED ÚNICAMENTE DESPUÉS de guardar hallazgos y reporte
      if (userIdStr) {
        await evaluationRepository.update(evaluationId, userIdStr, {
          auditStatus: AUDIT_STATUS.COMPLETED,
        });
      }

      console.log(
        `[AuditEngine] ✅ Phase 2 Async Audit completed for ${evaluationId}. Deterministic Score: ${metrics.overallScore}/100 | Coverage: ${metrics.auditCoverage}% | Cost: $${evaluationMetrics.estimatedCostUsd} USD`,
      );
    } catch (error) {
      console.error(`[AuditEngine] ❌ Phase 2 Async audit failed for evaluation ${evaluationId}:`, error);
      if (userIdStr) {
        await evaluationRepository.update(evaluationId, userIdStr, {
          auditStatus: AUDIT_STATUS.FAILED,
        });
      }
    }
  }
}

export const auditEngine = AuditEngine.getInstance();
