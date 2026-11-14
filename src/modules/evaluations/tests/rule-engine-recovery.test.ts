import { ruleEngine } from '../services/rule-engine.service';
import { V2AIInputContext } from '../services/context-builder.service';

/**
 * Suite determinística de verificación para la Regla 0 del RuleEngine (recuperación segura).
 *
 * Valida los 8 requisitos de seguridad semántica post-auditoría:
 * 1. Un campo de texto falla y existe un botón primario "Pagar ahora": no debe pulsarlo.
 * 2. Un checkbox falla y existe un botón "Eliminar cuenta": no debe pulsarlo.
 * 3. Un filtro falla y existe un botón "Confirmar compra": no debe pulsarlo.
 * 4. Una acción de navegación falla y existe una alternativa inequívocamente equivalente: puede utilizarla.
 * 5. No existe alternativa segura: el sistema no ejecuta ningún botón genérico.
 * 6. El selector que falló no se reutiliza.
 * 7. Se conserva el límite actual de reintentos (2 fallos consecutivos terminan con STOP_FLOW).
 * 8. Se registra correctamente la causa de recuperación no exitosa.
 * 9. [RIESGO 1, auditoría 2026-11-13] Un selector fallido que menciona el tag HTML
 *    "section" (p. ej. `locator('section:nth-of-type(1) > ... > a')`) nunca se
 *    interpreta como un destino de navegación real, ni siquiera cuando existe un
 *    elemento no relacionado cuyo selector CSS también contiene "section".
 *
 * Cero llamadas a Gemini, cero red, cero MongoDB.
 */
function assert(condition: boolean, msg: string, actual?: unknown, expected?: unknown) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    if (actual !== undefined) console.error('     actual:  ', actual);
    if (expected !== undefined) console.error('     expected:', expected);
    process.exit(1);
  }
}

function makeContext(overrides: Partial<any> = {}): V2AIInputContext {
  return {
    metadata: { evaluationId: 'eval-recovery-test', timestamp: new Date().toISOString(), iteration: 2 },
    flowDefinition: { flowDescription: 'Flujo de compra y registro', currentStepObjective: 'Completar datos', totalStepsEstimated: 5 },
    flowState: {
      currentStep: 2,
      completedSteps: ['Paso 1'],
      previousActions: [],
      blockingError: null,
      ...overrides.flowState,
    },
    userArchetype: {
      fullName: 'Laura Martínez', phrase: 'Eficiencia', age: 32, profession: 'Arquitecta', maritalStatus: 'Soltera',
      country: 'CO', city: 'Bogotá', archetype: 'Profesional Orientada a Resultados', biography: '', personality: '',
      goals: ['Comprar rápido'], frustrations: ['Esperas'],
    },
    technicalContext: {
      url: 'https://example.com/checkout', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
      visibleDOMSummary: [],
      ...overrides.technicalContext,
    },
    constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
    ...overrides,
  } as any;
}

async function runTests() {
  console.log('🧪 Iniciando pruebas determinísticas de seguridad semántica en RuleEngine (Regla 0)...\n');

  // -----------------------------------------------------------------
  // Requisito 1: Campo de texto falla y existe botón primario "Pagar ahora" -> NO pulsarlo
  // -----------------------------------------------------------------
  console.log('--- Requisito 1: Un campo de texto falla y existe un botón primario "Pagar ahora" ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'TYPE', description: 'Failed to execute: Timeout 10000ms waiting for locator("#input-card-number")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'input', text: '', ariaLabel: 'Número de tarjeta', selector: '#input-card-number', isDisabled: false, isPrimary: false },
          { type: 'button', text: 'Pagar ahora', selector: '#btn-pay-primary', isDisabled: false, isPrimary: true },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision === null, 'No debe pulsar el botón primario "Pagar ahora" ante fallo de campo de texto (retorna null para delegar a IA)');
    assert(decision?.targetElement?.value !== '#btn-pay-primary', 'El selector del botón de pago jamás debe ser ejecutado como alternativa');
  }

  // -----------------------------------------------------------------
  // Requisito 2: Checkbox falla y existe botón "Eliminar cuenta" -> NO pulsarlo
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 2: Un checkbox falla y existe un botón "Eliminar cuenta" ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CHECK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#terms-checkbox")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'checkbox', text: 'Acepto términos', selector: '#terms-checkbox', isDisabled: false, isPrimary: false },
          { type: 'button', text: 'Eliminar cuenta', selector: '#btn-delete-account', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision === null, 'No debe pulsar el botón "Eliminar cuenta" ante fallo de checkbox (retorna null)');
    assert(decision?.targetElement?.value !== '#btn-delete-account', 'El botón destructor nunca debe ser seleccionado');
  }

  // -----------------------------------------------------------------
  // Requisito 3: Filtro falla y existe botón "Confirmar compra" -> NO pulsarlo
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 3: Un filtro falla y existe un botón "Confirmar compra" ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#filter-category-shoes")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'button', text: 'Confirmar compra', selector: '#btn-confirm-purchase', isDisabled: false, isPrimary: true },
          { type: 'link', text: 'Ver carrito', selector: '#link-cart', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision === null, 'No debe pulsar el botón "Confirmar compra" ante fallo de filtro (retorna null)');
    assert(decision?.targetElement?.value !== '#btn-confirm-purchase', 'El botón de compra no es una alternativa válida de filtro');
  }

  // -----------------------------------------------------------------
  // Requisito 4: Acción de navegación falla y existe alternativa inequívocamente equivalente -> Puede utilizarla
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 4: Navegación falla y existe alternativa inequívocamente equivalente ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#nav-contact-mobile")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'link', text: 'Contacto', selector: '#nav-contact-mobile', isDisabled: false, isPrimary: false },
          { type: 'link', text: 'Contacto', selector: '#header-nav-contact', isDisabled: false, isPrimary: false },
          { type: 'button', text: 'Pagar ahora', selector: '#btn-pay', isDisabled: false, isPrimary: true },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision !== null, 'Encuentra alternativa equivalente para navegación');
    assert(decision?.actionType === 'CLICK', 'Emite acción CLICK de navegación');
    assert(decision?.targetElement?.value === '#header-nav-contact', 'Selecciona el enlace equivalente "#header-nav-contact"', decision?.targetElement?.value, '#header-nav-contact');
    assert(decision?.rationale.includes('Semantic Recovery') === true, 'Rationale documenta recuperación semántica');
  }

  // -----------------------------------------------------------------
  // Requisito 5: No existe alternativa segura -> el sistema no ejecuta ningún botón genérico
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 5: No existe alternativa segura -> no ejecuta botón genérico ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#custom-widget")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'button', text: 'Continuar', selector: '#btn-continue-generic', isDisabled: false, isPrimary: true },
          { type: 'button', text: 'Siguiente', selector: '#btn-next-generic', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision === null, 'Sin relación semántica con el widget fallido, no selecciona botones genéricos de continuar/siguiente (retorna null)');
  }

  // -----------------------------------------------------------------
  // Requisito 6: El selector que falló no se reutiliza
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 6: El selector que falló no se reutiliza ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#nav-help-broken")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'link', text: 'Ayuda', selector: '#nav-help-broken', isDisabled: false, isPrimary: false },
          { type: 'link', text: 'Ayuda', selector: '#nav-help-working', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision !== null && decision.targetElement?.value !== '#nav-help-broken', 'El selector fallido #nav-help-broken es rigurosamente excluido');
    assert(decision?.targetElement?.value === '#nav-help-working', 'Selecciona la alternativa sana #nav-help-working');
  }

  // -----------------------------------------------------------------
  // Requisito 7: Se conserva el límite actual de reintentos (2 fallos consecutivos)
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 7: Límite estricto de reintentos (2 fallos consecutivos activan STOP_FLOW) ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#step-1-btn")', result: 'failure' },
          { actionType: 'CLICK', description: 'Failed to execute: Timeout 10000ms waiting for locator("#step-1-alt")', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'link', text: 'Contacto', selector: '#header-contact', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision !== null && decision.actionType === 'STOP_FLOW', '2 fallos consecutivos activan incondicionalmente STOP_FLOW', decision?.actionType, 'STOP_FLOW');
    assert(decision?.rationale.includes('Maximum consecutive action failures reached (2)') === true, 'Rationale documenta límite de reintentos alcanzado');
  }

  // -----------------------------------------------------------------
  // Requisito 8: Registro correcto de causa de recuperación no exitosa
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 8: Registro correcto de la causa de recuperación no exitosa ---');
  {
    // A. Fallo fatal de sesión o navegador cerrado
    const fatalCtx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Target page, context or browser has been closed', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'button', text: 'Continuar', selector: '#btn-continue', isDisabled: false, isPrimary: true },
        ],
      },
    });
    const fatalDecision = ruleEngine.evaluate(fatalCtx);
    assert(fatalDecision !== null && fatalDecision.actionType === 'STOP_FLOW', 'Fallo fatal de sesión retorna STOP_FLOW');
    assert(fatalDecision?.rationale.includes('unrecoverable failure') === true, 'Rationale registra explícitamente fallo irrecuperable');

    // B. Sin elementos interactivos en página
    const emptyCtx = makeContext({
      flowState: {
        previousActions: [
          { actionType: 'CLICK', description: 'Failed to execute: Timeout on #missing', result: 'failure' },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'button', text: 'Missing', selector: '#missing', isDisabled: false, isPrimary: false },
        ],
      },
    });
    const emptyDecision = ruleEngine.evaluate(emptyCtx);
    assert(emptyDecision !== null && emptyDecision.actionType === 'STOP_FLOW', 'Sin alternativas seguras retorna STOP_FLOW');
    assert(emptyDecision?.rationale.includes('No alternative enabled interactive elements available') === true, 'Rationale registra ausencia de alternativas seguras');
  }

  // -----------------------------------------------------------------
  // Requisito 9: El tag HTML "section" en un selector fallido no se confunde
  // con un destino de navegación real (caso real detectado en auditoría:
  // "Sign in to leave a review" seleccionado por colisión de subcadena "section").
  // -----------------------------------------------------------------
  console.log('\n--- Requisito 9: Tag HTML "section" en selector fallido no se trata como destino semántico ---');
  {
    const ctx = makeContext({
      flowState: {
        previousActions: [
          {
            actionType: 'CLICK',
            description:
              "Failed to execute: Timeout 10000ms exceeded waiting for locator('section:nth-of-type(1) > section > div > div > section > div > div > a:nth-of-type(1)')",
            result: 'failure',
          },
        ],
      },
      technicalContext: {
        visibleDOMSummary: [
          { type: 'link', text: 'Sign in to leave a review', selector: 'section > section > p > a', isDisabled: false, isPrimary: false },
        ],
      },
    });

    const decision = ruleEngine.evaluate(ctx);
    assert(decision === null, 'No debe declarar equivalencia semántica con "Sign in to leave a review" por coincidencia del tag "section" (retorna null para delegar a IA)');
  }

  console.log('\n========================================');
  console.log('Results: All 9 semantic recovery test scenarios passed successfully!');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Error en test suite de recuperación:', err);
  process.exit(1);
});
