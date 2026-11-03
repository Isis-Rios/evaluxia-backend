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
 * P1.6.2 Parte B — bookkeeping puro de `completedSteps` a través de las
 * iteraciones del bucle, extraído de `runEvaluation` por el mismo motivo que
 * `resolveActionOutcome`: poder probar la lógica sin un navegador real.
 *
 * `resolveActionOutcome(...).completedStep` siempre describe el objetivo
 * ANTERIOR (el que estaba activo cuando la acción actual se decidió), nunca
 * la acción que la propia iteración acaba de ejecutar — ese texto queda en
 * `nextObjective`, y solo se empuja a `completedSteps` si una iteración
 * SIGUIENTE también tiene éxito. Si el bucle termina justo después de una
 * acción exitosa (MAX_ITERATIONS_REACHED, stopFlow, un blockingError
 * posterior, etc. — el caso real confirmado en la auditoría post-piloto
 * P1.6.1, evaluación `6ae53c5ac54be00390d0ca8f`), esa última etiqueta nunca
 * llega a registrarse en ningún lado.
 *
 * `applyActionOutcomeToCompletedSteps` reproduce el único efecto real que
 * `runEvaluation` aplicaba en cada iteración exitosa; `finalizeCompletedSteps`
 * es la corrección: se llama UNA VEZ, justo al salir del bucle, y solo añade
 * la etiqueta pendiente si de verdad quedó sin consumir -- nunca duplica
 * (una vez consumida, `hasUnrecordedCompletedStep` es falsa) y nunca marca
 * nada como "verificado por snapshot" (eso sigue siendo responsabilidad
 * exclusiva de `classifyExplorationTermination`/`lastActionVerifiedBySnapshot`,
 * que no se tocan aquí).
 */
export interface CompletedStepsTrackerState {
  completedSteps: string[];
  currentObjective: string;
  /** `true` cuando `currentObjective` describe una acción exitosa que todavía no fue registrada en `completedSteps`. */
  hasUnrecordedCompletedStep: boolean;
}

export function applyActionOutcomeToCompletedSteps(
  state: CompletedStepsTrackerState,
  outcome: Pick<ActionExecutionOutcome, 'completedStep' | 'nextObjective'>,
): CompletedStepsTrackerState {
  const completedSteps =
    outcome.completedStep !== null ? [...state.completedSteps, outcome.completedStep] : state.completedSteps;
  if (outcome.nextObjective === null) {
    // Acción fallida (o cualquier outcome sin avance): ni el objetivo ni la
    // bandera de pendiente cambian -- lo que ya estaba pendiente (si lo
    // había) sigue exactamente igual de pendiente.
    return { ...state, completedSteps };
  }
  return {
    completedSteps,
    currentObjective: outcome.nextObjective,
    hasUnrecordedCompletedStep: true,
  };
}

export function finalizeCompletedSteps(state: CompletedStepsTrackerState): string[] {
  return state.hasUnrecordedCompletedStep ? [...state.completedSteps, state.currentObjective] : state.completedSteps;
}

export type ExplorationTerminationReason =
  | 'NATURAL_STOP'
  | 'MAX_ITERATIONS_REACHED'
  | 'ACTION_FAILED'
  /**
   * P1.2.2 — la decisión de IA/Regla pedía `executeSuggestedAction` para un
   * `actionType` que SÍ requiere `targetElement` (todos excepto `NAVIGATE`/
   * `STOP_FLOW`, ver `SuggestedActionSchema` y `automation.service.ts`), pero
   * llegó sin él. Nunca se ejecutó nada en Playwright -- no es un fallo de
   * acción, es una decisión no ejecutable.
   */
  | 'INVALID_ACTION_DECISION'
  /**
   * P1.2.2 — una excepción no controlada interrumpió `runEvaluation` (catch
   * externo) cuyo origen NO puede atribuirse a una acción de Playwright
   * (p. ej. perfil de evaluador, repositorio, inicio de sesión del
   * navegador). Antes se etiquetaba, incorrectamente, como `ACTION_FAILED`.
   */
  | 'EXPLORATION_ERROR'
  | 'UNKNOWN';

export interface ExplorationTerminationInfo {
  terminationReason: ExplorationTerminationReason;
  /**
   * `false` cuando la última acción registrada fue técnicamente exitosa
   * (`result: 'success'`) pero el bucle terminó por agotamiento de
   * `maxIterations` antes de que una iteración siguiente pudiera capturar un
   * snapshot reflejando su efecto (`NAVIGATE` nunca cuenta: su snapshot,
   * iteración 1, se captura en la MISMA iteración en que se registra), o
   * cuando la terminación fue `INVALID_ACTION_DECISION` (nunca se ejecutó
   * nada que un snapshot pudiera verificar -- no se afirma evidencia de una
   * acción que nunca ocurrió).
   */
  lastActionVerifiedBySnapshot: boolean;
}

/**
 * Investigación forense P1.2 (y corrección P1.2.2) — clasifica, a partir
 * ÚNICAMENTE del estado que `runEvaluation` ya tiene disponible justo al
 * salir de su bucle `while`, por qué terminó la exploración. Pura y
 * extraída (mismo patrón que `resolveActionOutcome`) para poder probarla
 * sin navegador/DB/Gemini real.
 *
 * Orden de comprobación (no intercambiable):
 * 1. `invalidActionDecision` -- señalizado explícitamente por el llamador
 *    (runEvaluation) cuando detectó una decisión no ejecutable; se
 *    comprueba ANTES que `blockingError` porque ese mismo caso también deja
 *    `blockingError` no nulo (para que el frontend/`IncompleteExplorationNotice`
 *    lo muestre, reutilizando ese mecanismo existente), pero NO es un fallo
 *    de acción de Playwright -- clasificarlo como `ACTION_FAILED` sería
 *    incorrecto (ver investigación P1.2.1, hallazgo 3).
 * 2. `blockingError` (sin el caso anterior) -- un fallo de acción deja
 *    `blockingError` Y `flowCanContinue=false` simultáneamente (RuleEngine
 *    Regla 0 detiene el flujo en la iteración SIGUIENTE a la fallida).
 * 3. `!flowCanContinue` -- parada natural.
 * 4. `currentIteration > maxIterations` -- agotamiento de iteraciones.
 */
export function classifyExplorationTermination(params: {
  blockingError: string | null;
  flowCanContinue: boolean;
  currentIteration: number;
  maxIterations: number;
  previousActions: Array<{ actionType: string; result: 'success' | 'failure' }>;
  /** P1.2.2 — `true` cuando `runEvaluation` detectó una decisión `executeSuggestedAction` sin `targetElement` para un `actionType` que lo requiere. */
  invalidActionDecision?: boolean;
}): ExplorationTerminationInfo {
  const { blockingError, flowCanContinue, currentIteration, maxIterations, previousActions, invalidActionDecision } = params;

  let terminationReason: ExplorationTerminationReason;
  if (invalidActionDecision) {
    terminationReason = 'INVALID_ACTION_DECISION';
  } else if (blockingError) {
    terminationReason = 'ACTION_FAILED';
  } else if (!flowCanContinue) {
    terminationReason = 'NATURAL_STOP';
  } else if (currentIteration > maxIterations) {
    terminationReason = 'MAX_ITERATIONS_REACHED';
  } else {
    // Defensivo: no debería alcanzarse en la práctica (el bucle solo sale
    // por una de las condiciones anteriores), pero nunca se etiqueta
    // como natural un caso que no se pueda explicar con los datos en mano.
    terminationReason = 'UNKNOWN';
  }

  const lastAction = previousActions[previousActions.length - 1];
  const lastActionVerifiedBySnapshot =
    terminationReason === 'INVALID_ACTION_DECISION'
      ? false // nunca se ejecutó nada -- no hay acción que un snapshot pudiera verificar
      : !(
          terminationReason === 'MAX_ITERATIONS_REACHED' &&
          !!lastAction &&
          lastAction.result === 'success' &&
          lastAction.actionType !== 'NAVIGATE'
        );

  return { terminationReason, lastActionVerifiedBySnapshot };
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
    // P1.2.2 — `true` únicamente cuando se detecta la anomalía de la
    // sección 2 (decisión `executeSuggestedAction` sin `targetElement` para
    // un `actionType` que lo requiere). Se comprueba ANTES que
    // `blockingError` en `classifyExplorationTermination` para no
    // clasificar esto como un fallo de acción de Playwright real.
    let invalidActionDecision = false;
    // P1.2 — dimensión separada de `blockingError`/terminación: fallos reales
    // al persistir un SnapshotEvidence, antes solo visibles en un
    // `console.warn` sin ningún rastro persistido (ver investigación
    // forense P1.2, sección 7).
    const snapshotPersistenceFailures: Array<{ iteration: number; error: string }> = [];

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
      // P1.6.2 Parte B — `currentObjective` describe la acción que ACABA de
      // tener éxito (ver `resolveActionOutcome`'s `nextObjective`), pero solo
      // se empuja a `completedSteps` cuando una iteración SIGUIENTE también
      // tiene éxito (el push ocurre con el valor ANTERIOR de
      // `currentObjective`, no con el nuevo). Si el bucle termina justo
      // después de una acción exitosa -- el caso real confirmado en la
      // auditoría post-piloto P1.6.1, MAX_ITERATIONS_REACHED, pero también
      // válido para stopFlow/blockingError -- esa última etiqueta queda sin
      // registrar en ningún lado. Esta bandera indica si el valor ACTUAL de
      // `currentObjective` ya fue registrado en `completedSteps` o sigue
      // pendiente; se resuelve una sola vez al salir del bucle (más abajo).
      // No tiene ninguna relación con `lastActionVerifiedBySnapshot` (P1.2):
      // esta bandera es puramente sobre el REGISTRO narrativo de acciones
      // ejecutadas, nunca sobre si fueron verificadas por un snapshot.
      let hasUnrecordedCompletedStep = false;

      // Metrics tracking for Phase 1
      let phase1Calls = 0;
      let phase1PromptTokens = 0;
      let phase1OutputTokens = 0;
      let phase1ExecutionTimeMs = 0;
      // J3 (Hardening Post-Fase H) — observacional, aditivo: acumula
      // thinkingTokens cuando el SDK los reporta; nunca se asume 0 por
      // ausencia real (ver TokenUsage/checkUsageConsistency).
      let phase1ThinkingTokens = 0;

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
            computedStylesCandidates: snapshot.computedStylesCandidates || [],
          });
        } catch (evErr) {
          console.warn(`[EvaluationService] Could not save snapshot evidence for iteration ${currentIteration}:`, evErr);
          // P1.2 — registrado de forma persistible, nunca solo en consola:
          // esta es una dimensión de integridad de EVIDENCIA, distinta de
          // por qué terminó el bucle (terminationReason) o de si la acción
          // de Playwright falló (blockingError). No se confunde con ninguna
          // de las otras dos.
          snapshotPersistenceFailures.push({
            iteration: currentIteration,
            error: evErr instanceof Error ? evErr.message : String(evErr),
          });
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
        // Real per-iteration Gemini token usage — stays {0, 0} when RuleEngine
        // resolves the decision (genuinely zero Gemini tokens spent that
        // iteration), populated from aiCall.usage only on the Gemini path.
        let iterationTokenUsage = { promptTokens: 0, outputTokens: 0 };

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
          iterationTokenUsage = { promptTokens: aiCall.usage.promptTokens, outputTokens: aiCall.usage.outputTokens };

          phase1Calls += 1;
          phase1PromptTokens += aiCall.usage.promptTokens;
          phase1OutputTokens += aiCall.usage.outputTokens;
          phase1ExecutionTimeMs += aiCall.executionTimeMs;
          phase1ThinkingTokens += aiCall.usage.thinkingTokens ?? 0;
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
          },
          iterationTokenUsage.promptTokens,
          iterationTokenUsage.outputTokens,
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
          // P1.6.2 Parte B — delega en la función pura probada en
          // `completed-steps-tracker.test.ts` (ver su docstring en este
          // mismo archivo, justo después de `resolveActionOutcome`).
          const completedStepsState = applyActionOutcomeToCompletedSteps(
            { completedSteps, currentObjective, hasUnrecordedCompletedStep },
            outcome,
          );
          completedSteps = completedStepsState.completedSteps;
          currentObjective = completedStepsState.currentObjective;
          hasUnrecordedCompletedStep = completedStepsState.hasUnrecordedCompletedStep;
        } else if (decisionResult.flowControl.recommendedNextStep === 'stopFlow' || !currentAction) {
          flowCanContinue = false;
          console.log(`[EvaluationService] Decided to STOP_FLOW:`, decisionResult.flowControl.stopperReason);
        } else if (
          decisionResult.flowControl.recommendedNextStep === 'executeSuggestedAction' &&
          currentAction &&
          !currentAction.targetElement &&
          // P1.2.2 — `NAVIGATE` (usa `inputData` como URL, no `targetElement`,
          // ver automation.service.ts) y `STOP_FLOW` (no-op, no requiere
          // selector) son los únicos `actionType` que el contrato
          // (`SuggestedActionSchema`) permite legítimamente sin
          // `targetElement`. Para cualquier otro, su ausencia es una
          // decisión no ejecutable, no un caso normal -- investigación
          // P1.2.1, hallazgo 2.
          currentAction.actionType !== 'NAVIGATE' &&
          currentAction.actionType !== 'STOP_FLOW'
        ) {
          // P1.2.2 — anomalía real: nunca se ejecuta nada en Playwright, se
          // detiene la exploración de forma controlada (en vez de avanzar
          // silenciosamente a la siguiente iteración) y se deja un registro
          // explícito, reutilizando `blockingError` (para que
          // `IncompleteExplorationNotice`, ya existente en el frontend, lo
          // muestre) sin inventar que la acción sí se ejecutó.
          const invalidDecisionMessage = `Invalid action decision: actionType '${currentAction.actionType}' requires a targetElement, but none was provided.`;
          console.warn(`[EvaluationService] ${invalidDecisionMessage} Stopping exploration (iteration ${currentIteration}).`);
          invalidActionDecision = true;
          blockingError = invalidDecisionMessage;
          previousActions.push({
            actionType: currentAction.actionType,
            description: `Invalid decision (no targetElement): ${currentAction.rationale || 'no rationale provided'}`,
            result: 'failure',
          });
          flowCanContinue = false;
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

      // P1.6.2 Parte B — registra, una sola vez, la etiqueta de la última
      // acción exitosa si el bucle terminó antes de que una iteración
      // siguiente la consumiera (ver declaración de `hasUnrecordedCompletedStep`
      // arriba). Esto SOLO completa el historial narrativo
      // (`completedSteps`) -- nunca marca la acción como verificada por un
      // snapshot posterior (`lastActionVerifiedBySnapshot`, calculado abajo
      // por `classifyExplorationTermination`, sigue siendo la única fuente
      // de esa distinción, sin alterar). Tampoco puede duplicar una entrada
      // ya registrada: la bandera solo es verdadera cuando el valor actual
      // de `currentObjective` nunca fue empujado a `completedSteps`.
      completedSteps = finalizeCompletedSteps({ completedSteps, currentObjective, hasUnrecordedCompletedStep });

      // 4. P1.2 — clasificar UNA VEZ, aquí, por qué terminó el bucle y si la
      // última acción quedó verificada por un snapshot posterior. Nunca se
      // infiere esto más tarde (Fase 2, frontend): es el único punto del
      // código que conoce `flowCanContinue`/`maxIterations`/`currentIteration`
      // reales en el momento exacto de la salida.
      const termination = classifyExplorationTermination({
        blockingError,
        flowCanContinue,
        currentIteration,
        maxIterations,
        previousActions,
        invalidActionDecision,
      });

      // `currentIteration` ya fue incrementado al salir del bucle (línea
      // anterior) -- `currentIteration - 1` es la última iteración
      // realmente procesada, la misma que ya se persistió como `currentStep`
      // en la última pasada del bucle. `evaluationRepository.update` sobre
      // `flowState` reemplaza el subdocumento completo (no usa `$set` con
      // notación de punto), así que hay que repetir TODOS sus campos, no
      // solo los nuevos -- omitir alguno lo resetearía a su default.
      await evaluationRepository.update(evaluationId, userId, {
        flowState: {
          currentStep: currentIteration - 1,
          completedSteps,
          previousActions,
          blockingError,
          terminationReason: termination.terminationReason,
          maxIterationsUsed: maxIterations,
          snapshotIntegrity: {
            persistenceFailures: snapshotPersistenceFailures,
            lastActionVerifiedBySnapshot: termination.lastActionVerifiedBySnapshot,
          },
        },
      });

      // 5. Marcar exploración como COMPLETED y la auditoría de Fase 2 como RUNNING
      await evaluationRepository.update(evaluationId, userId, {
        status: EVALUATION_STATUS.COMPLETED,
        auditStatus: AUDIT_STATUS.RUNNING,
      });

      // 6. Disparar Auditoría Asíncrona Final (AuditEngine) — desacoplada del hilo principal
      const capturedTitle = dto.title;
      const phase1Metrics = {
        phase1Calls,
        phase1PromptTokens,
        phase1OutputTokens,
        phase1ExecutionTimeMs,
        phase1ThinkingTokens,
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
          // P1.2.2 — una excepción no manejada aquí puede venir de
          // CUALQUIER parte de la exploración (perfil de evaluador,
          // repositorio, inicio de sesión del navegador, etc.), no
          // necesariamente de una acción de Playwright -- `resolveActionOutcome`
          // ya captura ESE caso específico por separado, sin pasar nunca por
          // este `catch` (automationService.executeAction nunca lanza, ver
          // automation.service.ts). Por eso se clasifica como
          // `EXPLORATION_ERROR` (genérico, con el mensaje real adjunto en
          // `blockingError`), nunca como `ACTION_FAILED` (que implicaría,
          // incorrectamente, que se identificó un fallo de acción
          // específico). No se usa `classifyExplorationTermination` aquí
          // porque `flowCanContinue`/`maxIterations` pueden no estar en un
          // estado significativo si la excepción ocurrió antes de que la
          // iteración 1 los calculara.
          terminationReason: 'EXPLORATION_ERROR',
          snapshotIntegrity: {
            persistenceFailures: snapshotPersistenceFailures,
            lastActionVerifiedBySnapshot: false,
          },
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
