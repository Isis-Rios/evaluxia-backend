import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { evaluationRepository } from '../evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { aiService } from '@/modules/ai/ai.service';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { AUDIT_STATUS } from '@/config/constants';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { deterministicAnalyzer } from './deterministic-analyzer.service';
import { evidenceGateService } from './evidence-gate.service';
import { auditMetricsService, InputAuditFinding } from './audit-metrics.service';

export interface Phase1MetricsInput {
  phase1Calls: number;
  phase1PromptTokens: number;
  phase1OutputTokens: number;
  phase1ExecutionTimeMs: number;
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

      // 4. Preparar el resumen de evidencias estructuradas para el prompt de Gemini
      const evidencesSummary = evidences.map((ev) => ({
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
      }));

      const interactions = await aiInteractionService.getInteractions(evaluationId);
      const completedSteps = evaluationDoc?.flowState?.completedSteps || [];
      const previousActions = evaluationDoc?.flowState?.previousActions || [];

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
        accessibilityTrees: evidences.map((e) => e.accessibilityTree).filter(Boolean) as string[],
      });

      const { executiveSummary, findings: rawAiAuditFindings } = auditResult.result;

      // 6. Pasar los hallazgos de Gemini por la Barrera de Evidencia (Evidence Gate) para bloquear especulaciones
      const validatedAiFindings = evidenceGateService.processAiFindings(rawAiAuditFindings);
      console.log(`[AuditEngine] 🛡️ EvidenceGate processed AI findings: ${validatedAiFindings.length} valid findings.`);

      // 7. Unificar todos los hallazgos en un arreglo para cálculo determinístico de métricas
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
        })),
      ];

      // 8. Calcular Métricas Determinísticas en Backend mediante AuditMetricsService (Gemini score es 100% ignorado)
      const metrics = auditMetricsService.calculateMetrics(allRawFindings);
      console.log(
        `[AuditEngine] 📊 Calculated Deterministic Backend Metrics: Score=${metrics.overallScore}, Nielsen Compliance=${metrics.nielsenMetrics.compliance}%, WCAG Compliance=${metrics.wcagMetrics.compliance}%, Audit Coverage=${metrics.auditCoverage}%`,
      );

      // 9. Persistir Hallazgos Consolidados (FAIL) en BD
      for (const cf of metrics.consolidatedFindings) {
        if (cf.status === 'FAIL') {
          await findingService.create({
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
          });
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

      const evaluationMetrics = metricsTracker.recordEvaluation({
        evaluationId,
        phase1Calls: p1Calls,
        phase2Calls: p2Calls,
        totalExecutionTimeMs: p1Time + p2Time,
        promptTokens: p1Prompt + p2Prompt,
        outputTokens: p1Output + p2Output,
      });

      // 11. Crear/Actualizar el Reporte consolidado con métricas determinísticas
      const report = await reportRepository.findByEvaluationId(evaluationId);
      const reportData = {
        evaluationId,
        title: `Reporte de Experiencia de Usuario y Accesibilidad: ${title}`,
        status: 'ready' as const,
        summary: executiveSummary,
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
