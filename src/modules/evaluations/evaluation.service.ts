import { IEvaluation } from './evaluation.model';
import { evaluationRepository } from './evaluation.repository';
import {
  CreateEvaluationDto,
  UpdateEvaluationDto,
  GetEvaluationsQuery,
} from './dto/evaluation.dto';
import { HttpError } from '@/shared/errors/HttpError';
import { AppError } from '@/shared/errors/AppError';
import { EVALUATION_STATUS, AUDIT_STATUS } from '@/config/constants';

import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiService } from '@/modules/ai/ai.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { jobRunner } from '@/shared/infrastructure/job-runner';

// V2 Imports
import { automationService } from '@/modules/automation/automation.service';
import { contextBuilder } from './services/context-builder.service';
import { ruleEngine } from './services/rule-engine.service';
import { auditEngine } from './services/audit-engine.service';
import { V2AIOutputDecision } from '@/modules/ai/contracts/ai.contracts';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { calculateDynamicMaxIterations } from './services/dynamic-iterations.service';

export interface ActionExecutionOutcome {
  previousAction: { actionType: string; description: string; result: 'success' | 'failure' };
  blockingError: string | null;
  /** Non-null only on success: the step description to append to completedSteps. */
  completedStep: string | null;
  /** Non-null only on success: the objective for the next iteration. */
  nextObjective: string | null;
}

/**
 * Pure mapping from an AutomationService.executeAction() result to the
 * flow-state bookkeeping for the current iteration.
 *
 * executeAction() reports failures via `{ success: false, error }` rather
 * than throwing (see automation.service.ts), so this MUST be based on
 * `actionResult.success` — recording a failed action as `result: 'success'`
 * would silently defeat RuleEngine's Rule 0 (stop on failed previous action)
 * and let the loop continue as if the page had actually changed.
 *
 * Extracted as a standalone pure function so this specific mapping is unit
 * testable without a live browser/DB/Gemini.
 */
export function resolveActionOutcome(
  actionResult: { success: boolean; error?: string },
  currentAction: { actionType: string; rationale: string; targetElement: { value?: string } | null },
  currentObjective: string,
): ActionExecutionOutcome {
  if (actionResult.success) {
    return {
      previousAction: {
        actionType: currentAction.actionType,
        description: currentAction.rationale,
        result: 'success',
      },
      blockingError: null,
      completedStep: currentObjective,
      nextObjective: `Después de realizar ${currentAction.actionType} en ${currentAction.targetElement?.value}`,
    };
  }

  return {
    previousAction: {
      actionType: currentAction.actionType,
      description: `Failed to execute: ${actionResult.error || 'unknown error'}`,
      result: 'failure',
    },
    blockingError: `Action failed: ${actionResult.error || 'unknown error'}`,
    completedStep: null,
    nextObjective: null,
  };
}

/**
 * EvaluationService — Business logic for evaluation lifecycle management.
 *
 * Orchestrates the V2 loop (stateful browser interaction, ContextBuilder, RuleEngine, Gemini AI, persistence).
 */
export class EvaluationService {
  constructor() {
    // Registramos el manejador asíncrono para el tipo 'evaluation'
    jobRunner.registerHandler<{ userId: string; dto: CreateEvaluationDto }>('evaluation', async (job) => {
      const { userId, dto } = job.data;
      await this.runEvaluation(userId, job.id, dto);
    });
  }

  async findById(userId: string, id: string): Promise<IEvaluation> {
    const evaluation = await evaluationRepository.findByIdAndUserId(id, userId);
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation '${id}' not found`);
    }
    return evaluation;
  }

  async findAll(userId: string, query: GetEvaluationsQuery): Promise<{ data: IEvaluation[]; total: number }> {
    return evaluationRepository.findAll(userId, query);
  }

  /**
   * Registra e inicia una nueva evaluación.
   * Retorna inmediatamente el registro de la evaluación en estado 'pending'.
   */
  async create(userId: string, dto: CreateEvaluationDto): Promise<IEvaluation> {
    // 1. Validar Perfil Evaluador
    await evaluatorProfileService.findById(userId, dto.evaluatorProfileId);

    // 2. Crear la evaluación inicial (PENDING)
    const evaluation = await evaluationRepository.create(userId, dto);

    // 3. Encolar en el JobRunner de forma asíncrona no bloqueante
    await jobRunner.add('evaluation', evaluation.id, { userId, dto });

    return evaluation;
  }

  /**
   * Ejecución real asíncrona de fondo coordinada por el JobRunner (Bucle Iterativo V2).
   */
  private async runEvaluation(userId: string, evaluationId: string, dto: CreateEvaluationDto): Promise<void> {
    let currentIteration = 1;
    let completedSteps: string[] = [];
    let previousActions: Array<{ actionType: string; description: string; result: 'success' | 'failure' }> = [];
    let blockingError: string | null = null;

    try {
      // 1. Validar y obtener Perfil
      const profile = await evaluatorProfileService.findById(userId, dto.evaluatorProfileId);

      // 2. Marcar como RUNNING
      await evaluationRepository.update(evaluationId, userId, { status: EVALUATION_STATUS.RUNNING });

      // 3. Iniciar sesión en el navegador (Playwright session)
      console.log(`[EvaluationService] Starting browser session for evaluation ${evaluationId} at ${dto.url}`);
      await automationService.startSession(evaluationId, dto.url);

      let maxIterations = 8;
      let flowCanContinue = true;
      let currentObjective = 'Navegar e iniciar exploración';

      // Metrics tracking for Phase 1
      let phase1Calls = 0;
      let phase1PromptTokens = 0;
      let phase1OutputTokens = 0;
      let phase1ExecutionTimeMs = 0;

      while (currentIteration <= maxIterations && flowCanContinue) {
        console.log(`[EvaluationService] Starting loop iteration ${currentIteration} (max: ${maxIterations}) for evaluation ${evaluationId}`);

        // 3.1. Extraer Snapshot de la página actual
        const snapshot = await automationService.extractCurrentSnapshot(evaluationId);

        // 3.1.b. Calcular maxIterations dinámico en la iteración 1 basado en el snapshot inicial
        if (currentIteration === 1) {
          maxIterations = calculateDynamicMaxIterations(snapshot.visibleDOMSummary || []);
          console.log(`[EvaluationService] Calculated dynamic maxIterations: ${maxIterations} for evaluation ${evaluationId}`);
          previousActions.push({
            actionType: 'NAVIGATE',
            description: `Navegar a ${snapshot.url}`,
            result: 'success',
          });
          completedSteps.push('Navegar a la URL objetivo');
        }

        // 3.2. Guardar Captura de Pantalla Física (PNG)
        const screenshotUrl = await automationService.captureAndSaveScreenshot(evaluationId, currentIteration);

        // 3.2.b. Guardar Snapshot Evidence
        try {
          await snapshotEvidenceService.saveEvidence({
            evaluationId: evaluationId as any,
            iteration: currentIteration,
            url: snapshot.url,
            timestamp: new Date(),
            screenshotPath: screenshotUrl,
            headings: snapshot.headings || [],
            images: snapshot.images || [],
            links: snapshot.links || [],
            buttons: snapshot.buttons || [],
            forms: snapshot.forms || [],
            landmarks: snapshot.landmarks || [],
            accessibilityTree: snapshot.accessibilityTree,
            computedStyles: snapshot.computedStyles || [],
          });
        } catch (evErr) {
          console.warn(`[EvaluationService] Could not save snapshot evidence for iteration ${currentIteration}:`, evErr);
        }

        // 3.3. Construir Contexto Mínimo a través de ContextBuilder
        const context = contextBuilder.buildContext({
          evaluationId,
          iteration: currentIteration,
          goal: dto.description || dto.title,
          currentObjective,
          totalStepsEstimated: maxIterations,
          completedSteps,
          previousActions,
          blockingError, // P-02 fix: pass current blocking error to AI context
          profile,
          snapshot,
        });

        // 3.4. Evaluar a través del Motor de Reglas Determinísticas (RuleEngine)
        let suggestedAction = ruleEngine.evaluate(context);
        let executionTimeMs = 0;
        let decisionResult: V2AIOutputDecision | null = null;

        if (suggestedAction) {
          console.log(`[EvaluationService] RuleEngine intercepted and proposed action:`, suggestedAction);
          // Create a mock decision result based on the rule engine choice
          decisionResult = {
            evaluationSummary: {
              flowCanContinue: suggestedAction.actionType !== 'STOP_FLOW',
              confidenceLevel: 'high',
              notes: suggestedAction.rationale,
            },
            userIntention: {
              description: `Deterministically resolved: ${suggestedAction.rationale}`,
              derivedFromArchetype: false,
            },
            suggestedAction: {
              actionType: suggestedAction.actionType,
              targetElement: suggestedAction.targetElement,
              rationale: suggestedAction.rationale,
              confidence: suggestedAction.confidence,
            },
            uxFindings: [],
            accessibilityFindings: [],
            riskAssessment: {
              confusionProbability: 'low',
              abandonmentRisk: 'low',
              errorRisk: 'low',
            },
            flowControl: {
              isStopper: suggestedAction.actionType === 'STOP_FLOW',
              stopperReason: suggestedAction.actionType === 'STOP_FLOW' ? suggestedAction.rationale : null,
              recommendedNextStep: suggestedAction.actionType === 'STOP_FLOW' ? 'stopFlow' : 'executeSuggestedAction',
            },
          };
        } else {
          // 3.5. Invocar Decision Engine (AI Decision Service)
          console.log(`[EvaluationService] RuleEngine could not decide. Invoking AI Decision Service...`);
          const aiCall = await aiService.makeDecision(context);
          decisionResult = aiCall.result;
          executionTimeMs = aiCall.executionTimeMs;

          phase1Calls += 1;
          phase1PromptTokens += aiCall.usage.promptTokens;
          phase1OutputTokens += aiCall.usage.outputTokens;
          phase1ExecutionTimeMs += aiCall.executionTimeMs;
        }

        // 3.6. En Fase 1 (Exploración) no se procesan ni persisten hallazgos.
        // La auditoría de usabilidad y accesibilidad fue desacoplada a la Fase 2 (AuditEngine).

        // 3.7. Registrar Interacción de IA / Log de la iteración
        await aiInteractionService.logInteraction(
          evaluationId,
          currentIteration,
          executionTimeMs,
          {
            screenshotUrl,
            url: snapshot.url,
            title: snapshot.title,
            suggestedAction: decisionResult.suggestedAction,
            notes: decisionResult.evaluationSummary.notes,
            confidenceLevel: decisionResult.evaluationSummary.confidenceLevel,
            confusionProbability: decisionResult.riskAssessment.confusionProbability,
            abandonmentRisk: decisionResult.riskAssessment.abandonmentRisk,
            errorRisk: decisionResult.riskAssessment.errorRisk,
          }
        );

        // 3.8. Ejecutar Acción en Playwright si corresponde
        const currentAction = decisionResult.suggestedAction;

        if (decisionResult.flowControl.recommendedNextStep === 'executeSuggestedAction' && currentAction && currentAction.targetElement) {
          console.log(`[EvaluationService] Executing browser action: ${currentAction.actionType} on selector ${currentAction.targetElement.value}`);
          const actionResult = await automationService.executeAction(evaluationId, {
            actionType: currentAction.actionType,
            selector: currentAction.targetElement.value,
            value: currentAction.inputData ?? '',
            targetElement: currentAction.targetElement,
          });

          if (!actionResult.success) {
            console.error(`[EvaluationService] Action execution failed:`, actionResult.error);
          }

          const outcome = resolveActionOutcome(actionResult, currentAction, currentObjective);
          previousActions.push(outcome.previousAction);
          blockingError = outcome.blockingError;
          if (outcome.completedStep !== null) {
            completedSteps.push(outcome.completedStep);
          }
          if (outcome.nextObjective !== null) {
            currentObjective = outcome.nextObjective;
          }
        } else if (decisionResult.flowControl.recommendedNextStep === 'stopFlow' || !currentAction) {
          flowCanContinue = false;
          console.log(`[EvaluationService] Decided to STOP_FLOW:`, decisionResult.flowControl.stopperReason);
        }

        // Actualizar el estado en MongoDB
        await evaluationRepository.update(evaluationId, userId, {
          flowState: {
            currentStep: currentIteration,
            completedSteps,
            previousActions,
            blockingError,
          }
        });

        // 3.9. Avanzar iteración
        currentIteration++;
      }

      // 4. Marcar exploración como COMPLETED y la auditoría de Fase 2 como RUNNING
      await evaluationRepository.update(evaluationId, userId, {
        status: EVALUATION_STATUS.COMPLETED,
        auditStatus: AUDIT_STATUS.RUNNING,
      });

      // 5. Disparar Auditoría Asíncrona Final (AuditEngine) — desacoplada del hilo principal
      const capturedTitle = dto.title;
      const phase1Metrics = {
        phase1Calls,
        phase1PromptTokens,
        phase1OutputTokens,
        phase1ExecutionTimeMs,
      };

      setImmediate(async () => {
        console.log(`[EvaluationService] Triggering background audit engine for evaluation ${evaluationId}`);
        try {
          await auditEngine.performAudit(evaluationId, capturedTitle, phase1Metrics);
        } catch (auditError) {
          console.error(`[EvaluationService] ⚠️ Background audit failed for evaluation ${evaluationId}:`, auditError);
        }
      });

    } catch (error: any) {
      console.error(`[EvaluationService] ❌ Evaluation ${evaluationId} failed:`, error);
      
      const statusCode = error instanceof AppError ? error.statusCode : (error?.statusCode || 500);
      const isAiError = statusCode === 503 || statusCode === 429 || statusCode === 502 || statusCode === 504 || (error?.message || '').toLowerCase().includes('ai');
      const errorPrefix = isAiError ? `[AI_PROVIDER_ERROR ${statusCode}]` : `[EVALUATION_ERROR ${statusCode}]`;
      const formattedErrorMessage = `${errorPrefix} ${error?.message || String(error)} (failed at iteration ${currentIteration})`;

      await evaluationRepository.update(evaluationId, userId, {
        status: EVALUATION_STATUS.FAILED,
        auditStatus: AUDIT_STATUS.FAILED,
        flowState: {
          currentStep: currentIteration,
          completedSteps,
          previousActions,
          blockingError: formattedErrorMessage,
        },
      });
    } finally {
      // 6. Cerrar sesión del navegador de forma garantizada independientemente del resultado
      console.log(`[EvaluationService] Closing browser session for evaluation ${evaluationId}`);
      try {
        await automationService.closeSession(evaluationId);
      } catch (closeErr) {
        console.warn(`[EvaluationService] Error closing session for ${evaluationId} in cleanup:`, closeErr);
      }
    }
  }

  async update(userId: string, id: string, dto: UpdateEvaluationDto): Promise<IEvaluation> {
    const evaluation = await evaluationRepository.update(id, userId, dto);
    if (!evaluation) {
      throw HttpError.notFound(`Evaluation '${id}' not found`);
    }
    return evaluation;
  }

  async delete(userId: string, id: string): Promise<void> {
    const evaluation = await this.findById(userId, id);
    if (evaluation.status === EVALUATION_STATUS.RUNNING) {
      throw HttpError.conflict('Cannot delete an evaluation that is currently running');
    }
    await evaluationRepository.delete(id, userId);
  }
}

export const evaluationService = new EvaluationService();
