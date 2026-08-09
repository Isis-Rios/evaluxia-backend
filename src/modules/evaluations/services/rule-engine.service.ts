import { V2AIInputContext } from './context-builder.service';

export interface SuggestedAction {
  actionType: string;
  targetElement: {
    matchStrategy: 'CSS' | 'XPATH' | 'TEXT' | 'ROLE' | 'LABEL' | 'PLACEHOLDER' | 'ALT_TEXT' | 'TEST_ID';
    value: string;
  } | null;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * RuleEngine — Motor de reglas determinísticas encargado de evaluar el estado
 * de la interfaz en cada iteración. Si la acción para avanzar es lógica, secuencial
 * u obvia, la devuelve de forma directa evitando la consulta a la IA (ahorro de tokens).
 */
export class RuleEngine {
  private static instance: RuleEngine;

  private constructor() {}

  public static getInstance(): RuleEngine {
    if (!RuleEngine.instance) {
      RuleEngine.instance = new RuleEngine();
    }
    return RuleEngine.instance;
  }

  /**
   * Evalúa el contexto técnico y determina si se puede aplicar una regla determinística.
   * Si encuentra una coincidencia, devuelve la acción sugerida. De lo contrario, devuelve null.
   */
  public evaluate(context: V2AIInputContext): SuggestedAction | null {
    const elements = context.technicalContext.visibleDOMSummary || [];
    const prevActions = context.flowState.previousActions || [];

    // Regla 0: Detección determinística de fallos o ciclos repetitivos
    if (prevActions.length > 0) {
      const lastAction = prevActions[prevActions.length - 1];

      // Si la última acción falló explícitamente en Playwright
      if (lastAction.result === 'failure') {
        return {
          actionType: 'STOP_FLOW',
          targetElement: null,
          rationale: `Deterministic Rule: Intercepted failed previous action '${lastAction.actionType}'. Stopping exploration to avoid infinite loop.`,
          confidence: 'high',
        };
      }

      // Si se intentó realizar exactamente la misma acción en 2 iteraciones consecutivas
      if (prevActions.length >= 2) {
        const prev1 = prevActions[prevActions.length - 1];
        const prev2 = prevActions[prevActions.length - 2];
        if (prev1.actionType === prev2.actionType && prev1.description === prev2.description) {
          return {
            actionType: 'STOP_FLOW',
            targetElement: null,
            rationale: `Deterministic Rule: Intercepted repeated identical action '${prev1.actionType}' without state change. Halting exploration loop.`,
            confidence: 'high',
          };
        }
      }
    }

    // Regla 1: Si no hay elementos interactivos visibles en la página
    if (elements.length === 0) {
      return {
        actionType: 'STOP_FLOW',
        targetElement: null,
        rationale: 'Deterministic Rule: No interactive elements were found on the current page to continue the navigation.',
        confidence: 'high',
      };
    }

    // Regla 2: Formulario simple con un único botón de envío primario habilitado
    const activeButtons = elements.filter(el => el.type === 'button' && !el.isDisabled);
    const primaryButtons = activeButtons.filter(el => el.isPrimary);

    if (primaryButtons.length === 1 && activeButtons.length === 1 && elements.filter(el => el.type === 'input').length === 0) {
      const btn = primaryButtons[0];
      return {
        actionType: 'CLICK',
        targetElement: {
          matchStrategy: btn.ariaLabel ? 'LABEL' : 'TEXT',
          value: btn.ariaLabel || btn.text || 'button',
        },
        rationale: `Deterministic Rule: Detected only one active primary button (${btn.text || btn.ariaLabel}) with no other inputs or links to interact. Clicking to advance.`,
        confidence: 'high',
      };
    }

    // Regla 3: Si la página tiene un único elemento interactivo habilitado en total
    const enabledElements = elements.filter(el => !el.isDisabled);
    if (enabledElements.length === 1) {
      const singleEl = enabledElements[0];
      
      let actionType = 'CLICK';
      if (singleEl.type === 'input' || singleEl.type === 'textarea') {
        actionType = 'TYPE';
      }

      return {
        actionType,
        targetElement: {
          matchStrategy: singleEl.ariaLabel ? 'LABEL' : 'TEXT',
          value: singleEl.ariaLabel || singleEl.text || 'element',
        },
        rationale: `Deterministic Rule: Found exactly one enabled interactive element (${singleEl.type}: ${singleEl.text || singleEl.ariaLabel}) on the page.`,
        confidence: 'high',
      };
    }

    // Regla 4: Coincidencia de texto para botones obvios de navegación en el paso actual
    const objective = context.flowDefinition.currentStepObjective.toLowerCase();
    if (objective.includes('continuar') || objective.includes('siguiente') || objective.includes('avanzar')) {
      const nextButton = enabledElements.find(el => {
        const txt = (el.text || '').toLowerCase();
        const lbl = (el.ariaLabel || '').toLowerCase();
        return el.type === 'button' && (txt.includes('siguiente') || txt.includes('continuar') || txt.includes('aceptar') || lbl.includes('siguiente') || lbl.includes('continuar'));
      });

      if (nextButton) {
        return {
          actionType: 'CLICK',
          targetElement: {
            matchStrategy: nextButton.ariaLabel ? 'LABEL' : 'TEXT',
            value: nextButton.ariaLabel || nextButton.text || 'button',
          },
          rationale: `Deterministic Rule: Matched step objective with navigation button '${nextButton.text || nextButton.ariaLabel}'.`,
          confidence: 'high',
        };
      }
    }

    // Regla 5: Secuenciación determinística TYPE ➡️ Submit / Continuación
    if (prevActions.length > 0) {
      const lastAction = prevActions[prevActions.length - 1];
      const isLastActionType = lastAction.actionType === 'TYPE' || lastAction.actionType === 'TYPE_TEXT';
      const isLastActionSuccess = lastAction.result === 'success';

      if (isLastActionType && isLastActionSuccess) {
        const submitSignals = [
          'submit', 'search', 'continue', 'next', 'send', 'log in', 'login', 'sign in', 'signin', 'go', 'enter', 'confirm', 'ok', 'save',
          'enviar', 'buscar', 'continuar', 'siguiente', 'ingresar', 'entrar', 'iniciar sesión', 'iniciar sesion', 'guardar', 'confirmar', 'aceptar',
        ];

        const enabledActionables = elements.filter(
          el => !el.isDisabled && (el.type === 'button' || el.role === 'button' || el.role === 'search'),
        );

        const submitBtn = enabledActionables.find(el => {
          const txt = (el.text || '').toLowerCase().trim();
          const lbl = (el.ariaLabel || '').toLowerCase().trim();
          const role = (el.role || '').toLowerCase().trim();

          return submitSignals.some(signal =>
            txt.includes(signal) || lbl.includes(signal) || role === signal,
          );
        });

        if (submitBtn) {
          return {
            actionType: 'CLICK',
            targetElement: {
              matchStrategy: submitBtn.ariaLabel ? 'LABEL' : 'TEXT',
              value: submitBtn.ariaLabel || submitBtn.text || 'submit button',
            },
            rationale: `Deterministic Rule: Found enabled continuation/submit button '${submitBtn.text || submitBtn.ariaLabel}' after successful TYPE action.`,
            confidence: 'high',
          };
        }
      }
    }

    // No se pudo tomar una decisión determinística: requiere el Decision Engine
    return null;
  }
}

export const ruleEngine = RuleEngine.getInstance();
