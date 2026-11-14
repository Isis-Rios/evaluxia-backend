import { V2AIInputContext } from './context-builder.service';
import { InteractiveElement } from '@/modules/automation/automation.service';

/**
 * RIESGO 1 (auditoría 2026-11-13): nombres de etiqueta HTML genéricos que
 * `extractNavigationTarget` puede capturar accidentalmente desde un mensaje
 * de error de Playwright (p. ej. `locator('section:nth-of-type(1)...')`)
 * confundiendo el tag con un destino de navegación real. Ninguno de estos
 * términos, por sí solo, constituye jamás una intención semántica válida.
 */
const GENERIC_HTML_TAG_DENYLIST = new Set([
  'section', 'div', 'span', 'p', 'a', 'button', 'nav', 'header', 'footer', 'main', 'article', 'ul', 'li', 'form',
]);

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

    // Regla 0: Detección determinística de fallos, recuperación acotada y ciclos repetitivos
    if (prevActions.length > 0) {
      const lastAction = prevActions[prevActions.length - 1];

      // Si la última acción falló explícitamente en Playwright
      if (lastAction.result === 'failure') {
        // A. Contar fallos consecutivos para limitar estrictamente a 1 reintento/recuperación
        let consecutiveFailures = 0;
        for (let i = prevActions.length - 1; i >= 0; i--) {
          if (prevActions[i].result === 'failure') {
            consecutiveFailures++;
          } else {
            break;
          }
        }

        // Si ya ocurrieron 2 o más fallos consecutivos, detener el flujo definitivamente (evita bucles infinitos)
        if (consecutiveFailures >= 2) {
          return {
            actionType: 'STOP_FLOW',
            targetElement: null,
            rationale: `Deterministic Rule: Maximum consecutive action failures reached (${consecutiveFailures}). Halting exploration loop.`,
            confidence: 'high',
          };
        }

        const lastError = (lastAction.description || '').toLowerCase();

        // B. Identificar errores irrecuperables (sesión cerrada, fallo de navegador, o sin elementos)
        const isFatalError =
          lastError.includes('session') ||
          lastError.includes('closed') ||
          lastError.includes('crash') ||
          lastError.includes('unsupported action type') ||
          elements.length === 0;

        if (isFatalError) {
          return {
            actionType: 'STOP_FLOW',
            targetElement: null,
            rationale: `Deterministic Rule: Intercepted unrecoverable failure. Stopping exploration.`,
            confidence: 'high',
          };
        }

        // C. Extraer selector fallido si está disponible en la descripción del error
        const selectorMatch = lastAction.description.match(/(?:waiting for locator\(['"]|waiting for selector\s*['"]?|on\s+selector\s*['"]?|selector\s*['"]?|on\s+['"]?)([^'"\)\s\n]+)/i);
        const failedSelector = selectorMatch ? selectorMatch[1].trim() : null;

        // D. Buscar alternativas habilitadas y seguras que tengan selector CSS válido y NO repitan el fallido
        const safeAlternatives = elements.filter((el) => {
          if (el.isDisabled) return false;
          if (failedSelector && el.selector === failedSelector) return false;
          return !!el.selector;
        });

        // Si no existen alternativas válidas habilitadas, mantener STOP_FLOW
        if (safeAlternatives.length === 0) {
          return {
            actionType: 'STOP_FLOW',
            targetElement: null,
            rationale: `Deterministic Rule: No alternative enabled interactive elements available after action failure (${lastAction.actionType}). Stopping exploration.`,
            confidence: 'high',
          };
        }

        // E. Si hay alternativas seguras, buscar si existe una alternativa semánticamente coherente
        // No se permite fallback a botones primarios genéricos o palabras genéricas de navegación.
        const compatibleRecovery = this.findSemanticallyCompatibleAlternative(lastAction, failedSelector, safeAlternatives);
        if (compatibleRecovery) {
          return compatibleRecovery;
        }

        // Si no existe una alternativa semánticamente compatible que conserve la intención original,
        // no inventar acciones sustitutas arbitrarias. Registrar de forma explícita y retornar null
        // para permitir que el Decision Engine (Gemini) decida según el arquetipo y contexto de error.
        console.log(
          `[RuleEngine] Previous action (${lastAction.actionType}) failed on '${failedSelector || 'unspecified locator'}'. No semantically compatible safe alternative found in DOM. Delegating to Decision Engine without substitute action.`,
        );
        return null;
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
        targetElement: btn.selector
          ? { matchStrategy: 'CSS', value: btn.selector }
          : {
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
        targetElement: singleEl.selector
          ? { matchStrategy: 'CSS', value: singleEl.selector }
          : {
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
          targetElement: nextButton.selector
            ? { matchStrategy: 'CSS', value: nextButton.selector }
            : {
                matchStrategy: nextButton.ariaLabel ? 'LABEL' : 'TEXT',
                value: nextButton.ariaLabel || nextButton.text || 'button',
              },
          rationale: `Deterministic Rule: Matched step objective with navigation button '${nextButton.text || nextButton.ariaLabel}'.`,
          confidence: 'high',
        };
      }
    }

    // Regla 5: Secuenciación determinística TYPE ➡️ Submit / Continuación contextual
    if (prevActions.length > 0) {
      const lastAction = prevActions[prevActions.length - 1];
      const isLastActionType = lastAction.actionType === 'TYPE' || lastAction.actionType === 'TYPE_TEXT';
      const isLastActionSuccess = lastAction.result === 'success';

      if (isLastActionType && isLastActionSuccess) {
        // Detección contextual: ¿El input anterior era de búsqueda o un formulario general (ej. email, login, registro)?
        const lastActionDesc = (lastAction.description || '').toLowerCase();
        const isSearchContext = /search|buscar|query|búsqueda|busqueda|find/i.test(lastActionDesc);

        const generalSubmitSignals = [
          'submit', 'continue', 'next', 'send', 'log in', 'login', 'sign in', 'signin', 'go', 'enter', 'confirm', 'ok', 'save',
          'enviar', 'continuar', 'siguiente', 'ingresar', 'entrar', 'iniciar sesión', 'iniciar sesion', 'guardar', 'confirmar', 'aceptar',
          'subscribe', 'suscribir', 'download', 'descargar',
        ];
        const searchSubmitSignals = ['search', 'buscar'];

        const activeSignals = isSearchContext
          ? [...generalSubmitSignals, ...searchSubmitSignals]
          : generalSubmitSignals;

        const enabledActionables = elements.filter(
          el => !el.isDisabled && (el.type === 'button' || el.role === 'button' || (isSearchContext && el.role === 'search')),
        );

        const submitBtn = enabledActionables.find(el => {
          const txt = (el.text || '').toLowerCase().trim();
          const lbl = (el.ariaLabel || '').toLowerCase().trim();
          const role = (el.role || '').toLowerCase().trim();

          // Si no es contexto de búsqueda, ignorar explícitamente elementos cuyo único rol/texto sea Search
          if (!isSearchContext && (role === 'search' || txt === 'search' || txt === 'buscar' || lbl === 'search' || lbl === 'buscar')) {
            return false;
          }

          return activeSignals.some(signal =>
            txt.includes(signal) || lbl.includes(signal) || (isSearchContext && role === signal),
          );
        });

        if (submitBtn) {
          return {
            actionType: 'CLICK',
            targetElement: submitBtn.selector
              ? { matchStrategy: 'CSS', value: submitBtn.selector }
              : {
                  matchStrategy: submitBtn.ariaLabel ? 'LABEL' : 'TEXT',
                  value: submitBtn.ariaLabel || submitBtn.text || 'submit button',
                },
            rationale: `Deterministic Rule: Found enabled continuation/submit button '${submitBtn.text || submitBtn.ariaLabel}' after successful TYPE action (${isSearchContext ? 'search' : 'form'} context).`,
            confidence: 'high',
          };
        }
      }
    }

    // No se pudo tomar una decisión determinística: requiere el Decision Engine
    return null;
  }

  /**
   * Determina si existe una alternativa en safeAlternatives que sea semánticamente compatible
   * con la acción que falló, preservando estrictamente la intención original y evitando clics
   * arbitrarios en botones no relacionados (e.g. "Pagar ahora" ante fallo de campo, o
   * "Eliminar cuenta" ante fallo de checkbox).
   */
  private findSemanticallyCompatibleAlternative(
    lastAction: { actionType: string; description: string },
    failedSelector: string | null,
    safeAlternatives: InteractiveElement[],
  ): SuggestedAction | null {
    const rawActionType = (lastAction.actionType || '').toUpperCase();
    const actionDesc = (lastAction.description || '').toLowerCase();
    const selectorLower = (failedSelector || '').toLowerCase();

    // 1. Si la acción fallida fue de escritura o edición en un campo (TYPE, FILL, CLEAR o input/textarea)
    const isTextInputAction =
      rawActionType === 'TYPE' ||
      rawActionType === 'FILL' ||
      rawActionType === 'CLEAR' ||
      selectorLower.includes('input') ||
      selectorLower.includes('textarea') ||
      actionDesc.includes('input') ||
      actionDesc.includes('textarea') ||
      actionDesc.includes('typed');

    if (isTextInputAction) {
      // Una alternativa para completar un campo SOLO puede ser otro control de entrada (input/textarea)
      // que comparta la misma semántica (mismo nombre/etiqueta/propósito).
      // NUNCA puede ser un botón de envío, pago, confirmación o navegación.
      const targetToken = this.extractFieldToken(failedSelector, actionDesc);
      if (targetToken) {
        const matchingInput = safeAlternatives.find((el) => {
          if (el.type !== 'input' && el.type !== 'textarea') return false;
          const elSelector = (el.selector || '').toLowerCase();
          const elText = (el.text || '').toLowerCase();
          const elLabel = (el.ariaLabel || '').toLowerCase();
          return (
            elSelector.includes(targetToken) ||
            elText.includes(targetToken) ||
            elLabel.includes(targetToken)
          );
        });

        if (matchingInput && matchingInput.selector) {
          return {
            actionType: rawActionType === 'CLEAR' ? 'CLEAR' : 'TYPE',
            targetElement: { matchStrategy: 'CSS', value: matchingInput.selector },
            rationale: `Deterministic Rule (Semantic Recovery): Previous input action failed on '${failedSelector || rawActionType}'. Attempting semantically compatible alternative field '${matchingInput.selector}'.`,
            confidence: 'high',
          };
        }
      }

      // No existe un mecanismo equivalente seguro para el mismo campo: no ejecutar botones arbitrarios.
      return null;
    }

    // 2. Si la acción fallida fue sobre un checkbox o radio
    const isCheckAction =
      rawActionType === 'CHECK' ||
      rawActionType === 'UNCHECK' ||
      selectorLower.includes('checkbox') ||
      selectorLower.includes('radio') ||
      actionDesc.includes('checkbox') ||
      actionDesc.includes('radio');

    if (isCheckAction) {
      // Una alternativa para un checkbox o radio SOLO puede ser otro checkbox o radio
      // que modifique el mismo estado o acuerdo (e.g. selector alternativo de label/input asociado).
      // NUNCA un botón destructor ("Eliminar cuenta") ni de envío.
      const targetToken = this.extractFieldToken(failedSelector, actionDesc);
      if (targetToken) {
        const matchingCheck = safeAlternatives.find((el) => {
          if (el.type !== 'checkbox' && el.type !== 'radio') return false;
          const elSelector = (el.selector || '').toLowerCase();
          const elText = (el.text || '').toLowerCase();
          const elLabel = (el.ariaLabel || '').toLowerCase();
          return (
            elSelector.includes(targetToken) ||
            elText.includes(targetToken) ||
            elLabel.includes(targetToken)
          );
        });

        if (matchingCheck && matchingCheck.selector) {
          return {
            actionType: rawActionType === 'UNCHECK' ? 'UNCHECK' : 'CHECK',
            targetElement: { matchStrategy: 'CSS', value: matchingCheck.selector },
            rationale: `Deterministic Rule (Semantic Recovery): Previous check action failed. Attempting equivalent alternative control '${matchingCheck.selector}'.`,
            confidence: 'high',
          };
        }
      }

      return null;
    }

    // 3. Si la acción fallida fue aplicar un filtro o búsqueda
    const isFilterAction =
      actionDesc.includes('filter') ||
      actionDesc.includes('filtro') ||
      selectorLower.includes('filter') ||
      selectorLower.includes('filtro') ||
      selectorLower.includes('sort') ||
      selectorLower.includes('ordenar') ||
      actionDesc.includes('sort') ||
      actionDesc.includes('ordenar');

    if (isFilterAction) {
      // Un filtro NO puede tener como alternativa un botón de compra ("Confirmar compra", "Pagar")
      const filterToken = this.extractFieldToken(failedSelector, actionDesc);
      if (filterToken) {
        const matchingFilter = safeAlternatives.find((el) => {
          const elSelector = (el.selector || '').toLowerCase();
          const elText = (el.text || '').toLowerCase();
          const elLabel = (el.ariaLabel || '').toLowerCase();
          const isFilterControl =
            elSelector.includes('filter') ||
            elSelector.includes('filtro') ||
            elText.includes('filter') ||
            elText.includes('filtro');
          return isFilterControl && (elSelector.includes(filterToken) || elText.includes(filterToken) || elLabel.includes(filterToken));
        });

        if (matchingFilter && matchingFilter.selector) {
          return {
            actionType: 'CLICK',
            targetElement: { matchStrategy: 'CSS', value: matchingFilter.selector },
            rationale: `Deterministic Rule (Semantic Recovery): Previous filter action failed. Attempting equivalent filter control '${matchingFilter.selector}'.`,
            confidence: 'high',
          };
        }
      }

      return null;
    }

    // 4. Si la acción fallida fue de navegación (NAVIGATE o CLICK sobre un enlace o botón de navegación)
    const isNavigationAction = rawActionType === 'NAVIGATE' || rawActionType === 'CLICK';

    if (isNavigationAction) {
      // Extraer la intención de destino de la acción original (e.g. "contacto", "perfil", "ayuda", "carrito")
      const navTarget = this.extractNavigationTarget(failedSelector, actionDesc);
      if (navTarget) {
        // Buscar un control alternativo de navegación (link o botón) que conduzca inequívocamente a la MISMA sección o destino
        const matchingNav = safeAlternatives.find((el) => {
          if (el.type !== 'link' && el.type !== 'button') return false;

          const elText = (el.text || '').trim().toLowerCase();
          const elLabel = (el.ariaLabel || '').trim().toLowerCase();
          const elSelector = (el.selector || '').toLowerCase();

          // Excluir terminantemente botones con semántica destructiva o de transacción financiera no solicitada
          if (
            elText.includes('eliminar') ||
            elText.includes('delete') ||
            elText.includes('pagar') ||
            elText.includes('comprar') ||
            elText.includes('checkout') ||
            elLabel.includes('eliminar') ||
            elLabel.includes('delete') ||
            elLabel.includes('pagar') ||
            elLabel.includes('comprar')
          ) {
            return false;
          }

          // Verificar equivalencia inequívoca:
          const targetLower = navTarget.toLowerCase();
          const targetStem = targetLower.slice(0, Math.min(targetLower.length, 5));
          const textMatches =
            elText === targetLower ||
            (elText.length >= 3 && elText.includes(targetLower)) ||
            (targetLower.length >= 4 && elText.startsWith(targetStem));
          const labelMatches =
            elLabel === targetLower ||
            (elLabel.length >= 3 && elLabel.includes(targetLower)) ||
            (targetLower.length >= 4 && elLabel.startsWith(targetStem));
          const selectorMatches =
            elSelector.includes(targetLower) ||
            (targetLower.length >= 4 && elSelector.includes(targetStem));

          return textMatches || labelMatches || selectorMatches;
        });

        if (matchingNav && matchingNav.selector) {
          return {
            actionType: 'CLICK',
            targetElement: { matchStrategy: 'CSS', value: matchingNav.selector },
            rationale: `Deterministic Rule (Semantic Recovery): Navigation to '${navTarget}' failed on previous selector. Attempting semantically equivalent alternative '${matchingNav.text || matchingNav.ariaLabel || matchingNav.selector}'.`,
            confidence: 'high',
          };
        }
      }
    }

    // Si no se encuentra una alternativa semánticamente compatible, retornar null
    return null;
  }

  private extractFieldToken(failedSelector: string | null, description: string): string | null {
    const raw = `${failedSelector || ''} ${description}`.toLowerCase();
    const idMatch = raw.match(/#([a-z0-9_-]+)/i);
    if (idMatch && idMatch[1].length >= 3) {
      return idMatch[1]
        .toLowerCase()
        .replace(/^(?:btn|input|field|txt|chk|chkbox|opt)-?/, '')
        .replace(/-?(?:input|field|txt|chk|chkbox|opt)$/, '');
    }
    const nameMatch = raw.match(/name=['"]?([a-z0-9_-]+)['"]?/i);
    if (nameMatch && nameMatch[1].length >= 3) {
      return nameMatch[1].toLowerCase();
    }
    return null;
  }

  private extractNavigationTarget(failedSelector: string | null, description: string): string | null {
    const raw = `${failedSelector || ''} ${description}`.toLowerCase();
    const match = raw.match(/(?:navegar\s+a\s+|goto\s+|secci[oó]n\s+|tab\s+|enlace\s+|locator\(['"]?[#.]?|selector\s*['"]?[#.]?)([a-z0-9_-]+)/i);
    if (match && match[1].length >= 3) {
      const cleaned = match[1]
        .toLowerCase()
        .replace(/^(?:nav|btn|header|footer|tab|menu|link|item)-?/, '')
        .replace(/-?(?:mobile|desktop|responsive|btn|link|icon|tab)$/, '');
      if (cleaned.length >= 3 && !GENERIC_HTML_TAG_DENYLIST.has(cleaned)) return cleaned;
    }
    return null;
  }
}

export const ruleEngine = RuleEngine.getInstance();
