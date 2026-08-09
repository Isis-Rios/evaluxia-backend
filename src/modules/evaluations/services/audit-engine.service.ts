import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { evaluationRepository } from '../evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { aiService } from '@/modules/ai/ai.service';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { AUDIT_STATUS } from '@/config/constants';

export interface Phase1MetricsInput {
  phase1Calls: number;
  phase1PromptTokens: number;
  phase1OutputTokens: number;
  phase1ExecutionTimeMs: number;
}

/**
 * AuditEngine — Motor de Auditoría Asíncrona Especializada (Fase 2 de la Arquitectura V2).
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
      // 1. Obtener la evaluación por id directo (lectura interna del sistema)
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

      // 2. Obtener historial de interacciones y pasos ejecutados
      const interactions = await aiInteractionService.getInteractions(evaluationId);
      const completedSteps = evaluationDoc?.flowState?.completedSteps || [];
      const previousActions = evaluationDoc?.flowState?.previousActions || [];

      // 3. Invocar el prompt especializado de Fase 2 en AiService
      console.log(`[AuditEngine] 🤖 Invoking Phase 2 specialized audit prompt with Gemini...`);
      const auditResult = await aiService.performAuditAnalysis({
        evaluationId,
        title: title || evaluationDoc?.title || 'Evaluación Web',
        url: evaluationDoc?.url || 'https://ejemplo.com',
        archetype: profileData,
        completedSteps,
        previousActions,
        snapshotsCount: interactions.length || 1,
      });

      const { overallScore, executiveSummary, findings: aiAuditFindings } = auditResult.result;

      // 4. Persistir los hallazgos de la auditoría en la base de datos
      console.log(`[AuditEngine] 💾 Persisting ${aiAuditFindings.length} audit findings to DB...`);
      for (const f of aiAuditFindings) {
        await findingService.create({
          evaluationId: evaluationId as any,
          iteration: 1, // Phase 2 Audit step
          findingGroup: f.findingGroup,
          type: f.type || 'usability',
          severity: f.severity as any,
          description: f.description,
          heuristic: f.heuristic || undefined,
          wcagCriterion: f.wcagCriterion || undefined,
        });
      }

      // 5. Recopilar todos los hallazgos persistidos para conteos de severidad
      const allFindings = await findingService.findByEvaluationId(evaluationId);

      const criticalCount = allFindings.filter((f) => f.severity === 'critical').length;
      const highCount = allFindings.filter((f) => f.severity === 'high').length;
      const mediumCount = allFindings.filter((f) => f.severity === 'medium').length;
      const lowCount = allFindings.filter((f) => f.severity === 'low').length;
      const infoCount = allFindings.filter((f) => f.severity === 'info').length;

      // 6. Consolidar Métricas de Consumo de Tokens y Costos (Fase 1 + Fase 2)
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

      // 7. Crear/Actualizar el Reporte consolidado
      const report = await reportRepository.findByEvaluationId(evaluationId);
      const reportData = {
        evaluationId,
        title: `Reporte de Experiencia de Usuario y Accesibilidad: ${title}`,
        status: 'ready' as const,
        summary: executiveSummary,
        totalFindings: allFindings.length,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        infoCount,
        overallScore,
        metrics: evaluationMetrics,
        generatedAt: new Date(),
      };

      if (report) {
        await reportRepository.update(report.id, reportData);
      } else {
        await reportRepository.create(reportData as any);
      }

      // 8. Marcar auditStatus = COMPLETED ÚNICAMENTE DESPUÉS de guardar findings y reporte (Cero Race Condition)
      if (userIdStr) {
        await evaluationRepository.update(evaluationId, userIdStr, {
          auditStatus: AUDIT_STATUS.COMPLETED,
        });
      }

      console.log(
        `[AuditEngine] ✅ Phase 2 Async Audit completed for ${evaluationId}. Final Score: ${overallScore}/100 | Cost: $${evaluationMetrics.estimatedCostUsd} USD`,
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
