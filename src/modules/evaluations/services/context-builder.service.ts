import { PageSnapshot, InteractiveElement } from '@/modules/automation/automation.service';
import { IEvaluatorProfile } from '@/modules/evaluator-profiles/evaluator-profile.model';

export interface EvaluationMetadata {
  evaluationId: string;
  timestamp: string;
  iteration: number;
}

export interface FlowDefinition {
  flowDescription: string;
  currentStepObjective: string;
  totalStepsEstimated: number;
}

export interface FlowState {
  currentStep: number;
  completedSteps: string[];
  previousActions: Array<{
    actionType: string;
    description: string;
    result: 'success' | 'failure';
  }>;
  blockingError: string | null;
}

export interface UserArchetype {
  fullName: string;
  phrase: string;
  age: number;
  profession: string;
  maritalStatus: string;
  country: string;
  city: string;
  archetype: string;
  biography: string;
  personality: string;
  goals: string[];
  frustrations: string[];
}

export interface TechnicalContext {
  url: string;
  requiresAuthentication: boolean;
  authenticationStatus: 'authenticated' | 'unauthenticated';
  visibleDOMSummary: InteractiveElement[];
}

export interface ContextConstraints {
  doNotAssumeHiddenElements: boolean;
  doNotInventActions: boolean;
  maxOneActionPerIteration: boolean;
}

export interface V2AIInputContext {
  metadata: EvaluationMetadata;
  flowDefinition: FlowDefinition;
  flowState: FlowState;
  userArchetype: UserArchetype;
  technicalContext: TechnicalContext;
  constraints: ContextConstraints;
}

/**
 * ContextBuilder — Componente especializado encargado de construir el contexto estructurado
 * y optimizado para el Decision Engine en cada iteración del flujo EvalUXIA V2.
 */
export class ContextBuilder {
  private static instance: ContextBuilder;

  private constructor() {}

  public static getInstance(): ContextBuilder {
    if (!ContextBuilder.instance) {
      ContextBuilder.instance = new ContextBuilder();
    }
    return ContextBuilder.instance;
  }

  /**
   * Genera el contexto mínimo requerido a partir del estado de Playwright y metadatos.
   */
  public buildContext(params: {
    evaluationId: string;
    iteration: number;
    goal: string;
    currentObjective: string;
    totalStepsEstimated: number;
    completedSteps: string[];
    previousActions: any[];
    blockingError: string | null; // P-02 fix: propagate real blocking errors to AI context
    profile: IEvaluatorProfile;
    snapshot: PageSnapshot;
  }): V2AIInputContext {
    const {
      evaluationId,
      iteration,
      goal,
      currentObjective,
      totalStepsEstimated,
      completedSteps,
      previousActions,
      profile,
      snapshot,
    } = params;

    return {
      metadata: {
        evaluationId,
        timestamp: new Date().toISOString(),
        iteration,
      },
      flowDefinition: {
        flowDescription: goal,
        currentStepObjective: currentObjective,
        totalStepsEstimated,
      },
      flowState: {
        currentStep: iteration,
        completedSteps: completedSteps || [],
        previousActions: (previousActions || []).slice(-3),
        blockingError: params.blockingError, // P-02 fix: use real error instead of hardcoded null
      },
      userArchetype: {
        fullName: profile.fullName,
        phrase: profile.phrase,
        age: profile.age,
        profession: profile.profession,
        maritalStatus: profile.maritalStatus || 'Single',
        country: profile.country || 'Colombia',
        city: profile.city || 'Bogotá',
        archetype: profile.archetype,
        biography: profile.biography || '',
        personality: profile.personality || '',
        goals: profile.goals || [],
        frustrations: profile.frustrations || [],
      },
      technicalContext: {
        url: snapshot.url,
        requiresAuthentication: false,
        authenticationStatus: 'unauthenticated',
        visibleDOMSummary: snapshot.visibleDOMSummary || [],
      },
      constraints: {
        doNotAssumeHiddenElements: true,
        doNotInventActions: true,
        maxOneActionPerIteration: true,
      },
    };
  }
}

export const contextBuilder = ContextBuilder.getInstance();
