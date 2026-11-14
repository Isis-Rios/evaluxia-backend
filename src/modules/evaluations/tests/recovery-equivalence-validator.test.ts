import { validateRecoveryEquivalence, formatClickTargetHrefMarker } from '../services/recovery-equivalence-validator';
import { evaluateRecoveryGuard } from '../evaluation.service';

/**
 * Suite determinística del cierre de brecha Rule 0 -> Decision Engine
 * (auditoría 2026-11-13, posterior a los Riesgos 1/5 ya corregidos).
 *
 * Cubre, en orden, los 7 escenarios exigidos:
 * 1. Acción fallida sin alternativa semánticamente demostrable termina de forma segura.
 * 2. Una alternativa realmente equivalente puede continuar únicamente cuando existe
 *    evidencia suficiente para justificarla.
 * 3. Una alternativa no relacionada no se ejecuta.
 * 4. Una acción destructiva o transaccional no se ejecuta durante una recuperación.
 * 5. No se repite el selector fallido.
 * 6. Las decisiones normales sin blockingError siguen funcionando.
 * 7. El estado de terminación queda correctamente registrado (rejectionBlockingError).
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

function runValidatorTests() {
  console.log('🧪 validateRecoveryEquivalence — pruebas unitarias puras\n');

  // -----------------------------------------------------------------
  // Escenario 1: Sin alternativa semánticamente demostrable (selector no
  // resuelto a ningún elemento del snapshot) -> rechazo seguro.
  // -----------------------------------------------------------------
  console.log('--- Escenario 1: Sin evidencia estructurada verificable ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#custom-widget')" },
      { actionType: 'CLICK', selector: null, elementType: null, text: null, ariaLabel: null },
    );
    assert(result.isEquivalent === false, 'Sin selector resuelto, no hay equivalencia demostrable');
  }

  // -----------------------------------------------------------------
  // Escenario 2: Alternativa realmente equivalente (mismo campo de texto,
  // token compartido, tipo de elemento correcto) -> SÍ se acepta.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 2: Alternativa equivalente con evidencia suficiente ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'TYPE', description: "Failed to execute: Timeout 10000ms waiting for locator('#input-email-mobile')" },
      { actionType: 'TYPE', selector: '#input-email-desktop', elementType: 'input', text: null, ariaLabel: 'Correo electrónico' },
    );
    assert(result.isEquivalent === true, 'Mismo campo de texto (token "email" compartido) se acepta', result.reason);
  }

  // -----------------------------------------------------------------
  // Escenario 3: Alternativa no relacionada (categoría correcta, pero sin
  // token compartido) -> NO se ejecuta.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 3: Alternativa no relacionada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'TYPE', description: "Failed to execute: Timeout 10000ms waiting for locator('#input-email-mobile')" },
      { actionType: 'TYPE', selector: '#input-promo-code', elementType: 'input', text: null, ariaLabel: 'Código promocional' },
    );
    assert(result.isEquivalent === false, 'Campo de texto sin relación semántica (código promocional vs. email) se rechaza', result.reason);
  }

  // Caso adicional: navegación genuinamente equivalente (mismo patrón que
  // Requisito 4 de rule-engine-recovery.test.ts) SÍ se acepta aquí también.
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#nav-contact-mobile')" },
      { actionType: 'CLICK', selector: '#header-nav-contact', elementType: 'link', text: 'Contacto', ariaLabel: null },
    );
    assert(result.isEquivalent === true, 'Navegación genuinamente equivalente (mismo destino "contact") se acepta', result.reason);
  }

  // Caso adicional: navegación -> colisión de tag HTML "section" (Riesgo 1)
  // nunca debe producir una equivalencia de navegación válida aquí tampoco.
  {
    const result = validateRecoveryEquivalence(
      {
        actionType: 'CLICK',
        description:
          "Failed to execute: Timeout 10000ms exceeded waiting for locator('section:nth-of-type(1) > section > div > div > section > div > div > a:nth-of-type(1)')",
      },
      { actionType: 'CLICK', selector: 'section > section > p > a', elementType: 'link', text: 'Sign in to leave a review', ariaLabel: null },
    );
    assert(result.isEquivalent === false, 'Colisión de tag HTML "section" no produce una equivalencia de navegación falsa (consistente con Riesgo 1)', result.reason);
  }

  // -----------------------------------------------------------------
  // Escenario 4: Acción destructiva o transaccional durante recuperación ->
  // NUNCA se ejecuta, incluso si superficialmente comparte categoría/token.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 4: Acción destructiva/transaccional durante recuperación ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CHECK', description: "Failed to execute: Timeout 10000ms waiting for locator('#terms-checkbox')" },
      { actionType: 'CLICK', selector: '#btn-delete-account', elementType: 'button', text: 'Eliminar cuenta', ariaLabel: null },
    );
    assert(result.isEquivalent === false, 'Botón "Eliminar cuenta" nunca se acepta como recuperación', result.reason);
  }
  {
    // Caso límite: incluso si por accidente comparte token léxico con la
    // acción fallida, el lenguaje destructivo sigue bloqueando la aceptación
    // (la lista de palabras es una señal de RECHAZO adicional, no la única
    // base de aceptación -- pero sí puede vetar por sí sola).
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#nav-account-settings')" },
      { actionType: 'CLICK', selector: '#nav-account-delete', elementType: 'button', text: 'Eliminar cuenta', ariaLabel: null },
    );
    assert(result.isEquivalent === false, 'Lenguaje destructivo veta la aceptación incluso con token "account" potencialmente compartido', result.reason);
  }

  // -----------------------------------------------------------------
  // Escenario adicional: categoría no clasificable (p. ej. SELECT fallido)
  // -> sin criterio estructurado, se rechaza por seguridad.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario adicional: categoría no clasificable (SELECT) ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'SELECT', description: "Failed to execute: Timeout 10000ms waiting for locator('#dropdown-country')" },
      { actionType: 'SELECT', selector: '#dropdown-country-alt', elementType: 'select', text: null, ariaLabel: 'País' },
    );
    assert(result.isEquivalent === false, 'Sin criterio estructurado para SELECT, se rechaza por defecto (prioriza seguridad sobre profundidad de exploración)', result.reason);
  }

  console.log('\n✅ validateRecoveryEquivalence: todos los escenarios unitarios superados.\n');
}

function runGuardTests() {
  console.log('🧪 evaluateRecoveryGuard — pruebas de integración ligera (sin navegador/DB/Gemini)\n');

  const domWithEquivalentField = [
    { selector: '#input-email-desktop', type: 'input' as const, text: null, ariaLabel: 'Correo electrónico', role: null, isDisabled: false, isPrimary: false },
  ];

  // -----------------------------------------------------------------
  // Escenario 5: No se repite el selector fallido (guarda preexistente,
  // comportamiento sin cambios, ahora unificada en evaluateRecoveryGuard).
  // -----------------------------------------------------------------
  console.log('--- Escenario 5: No se repite el selector fallido ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#nav-help-broken')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#nav-help-broken' } },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#nav-help-broken')", result: 'failure' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === false, 'Repetir el selector exacto que acaba de fallar se bloquea');
    assert(!!decision.rejectionBlockingError?.includes('avoiding repetitive failure'), 'El motivo de rechazo documenta la repetición de selector', decision.rejectionBlockingError);
  }

  // -----------------------------------------------------------------
  // Escenario 6: Decisiones normales sin blockingError siguen funcionando
  // (la guarda nunca interfiere con exploración ordinaria).
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 6: Decisión normal sin blockingError (exploración ordinaria) ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: null,
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#btn-delete-account' } },
      lastAction: { actionType: 'TYPE', description: 'Texto ingresado exitosamente', result: 'success' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'Sin blockingError activo, la guarda de equivalencia NO se activa (no es una recuperación)');
  }
  console.log('\n--- Escenario 6b: Decisión de RuleEngine durante blockingError tampoco se revalida ---');
  {
    // RuleEngine ya validó equivalencia internamente (Riesgos 1/5, batería propia de pruebas);
    // esta guarda no debe volver a filtrarla ni rechazarla.
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#filter-shoes')",
      decisionCameFromRuleEngine: true,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#filter-shoes-alt' } },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#filter-shoes')", result: 'failure' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'Decisión ya resuelta por RuleEngine no se vuelve a filtrar en esta guarda');
  }

  // -----------------------------------------------------------------
  // Escenario 2 (integración): alternativa realmente equivalente propuesta
  // por el Decision Engine durante una recuperación SÍ se ejecuta.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 2b (integración): alternativa equivalente del Decision Engine se ejecuta ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#input-email-mobile')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'TYPE', targetElement: { value: '#input-email-desktop' } },
      lastAction: { actionType: 'TYPE', description: "Failed to execute: Timeout 10000ms waiting for locator('#input-email-mobile')", result: 'failure' },
      visibleDOMSummary: domWithEquivalentField,
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'Campo de texto equivalente verificable (mismo token) sí se ejecuta', decision.rejectionBlockingError);
  }

  // -----------------------------------------------------------------
  // Escenario 3 (integración): alternativa propuesta por Gemini sin
  // relación semántica demostrable durante una recuperación -> rechazo,
  // estado de terminación (blockingError) correctamente registrado.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 3b (integración): alternativa no relacionada propuesta por Gemini se rechaza ---');
  {
    const domWithUnrelatedButton = [
      { selector: '#btn-continue-generic', type: 'button' as const, text: 'Continuar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true },
    ];
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#custom-widget')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#btn-continue-generic' } },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#custom-widget')", result: 'failure' },
      visibleDOMSummary: domWithUnrelatedButton,
      knownLinks: [],
    });
    assert(decision.shouldExecute === false, 'Botón genérico sin relación semántica con el widget fallido se rechaza');
    assert(!!decision.rejectionBlockingError?.startsWith('Recovery action rejected:'), 'El estado de terminación (blockingError) documenta explícitamente el rechazo de la recuperación', decision.rejectionBlockingError);
  }

  // -----------------------------------------------------------------
  // Escenario 4 (integración): acción destructiva propuesta por Gemini
  // durante una recuperación -> NUNCA se ejecuta.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 4b (integración): acción destructiva propuesta por Gemini se rechaza ---');
  {
    const domWithDestructiveButton = [
      { selector: '#btn-delete-account', type: 'button' as const, text: 'Eliminar cuenta', ariaLabel: null, role: null, isDisabled: false, isPrimary: false },
    ];
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#terms-checkbox')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#btn-delete-account' } },
      lastAction: { actionType: 'CHECK', description: "Failed to execute: Timeout 10000ms waiting for locator('#terms-checkbox')", result: 'failure' },
      visibleDOMSummary: domWithDestructiveButton,
      knownLinks: [],
    });
    assert(decision.shouldExecute === false, 'Acción destructiva ("Eliminar cuenta") propuesta como recuperación nunca se ejecuta');
  }

  // -----------------------------------------------------------------
  // Escenario 7: STOP_FLOW explícito (recommendedNextStep !== 'executeSuggestedAction')
  // nunca es interceptado por esta guarda -- sin cambios respecto a antes.
  // (NAVIGATE, en cambio, SÍ es interceptado ahora cuando recommendedNextStep
  // es 'executeSuggestedAction' -- ver runNavigateTests, más abajo, para el
  // cierre de brecha NAVIGATE.)
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 7: STOP_FLOW explícito no es interceptado por esta guarda ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#custom-widget')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'stopFlow',
      currentAction: { actionType: 'STOP_FLOW', targetElement: null },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#custom-widget')", result: 'failure' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'STOP_FLOW explícito pasa intacto (lo gobierna el branch existente de stopFlow en runEvaluation, no esta guarda)');
  }

  console.log('\n✅ evaluateRecoveryGuard: todos los escenarios de integración ligera superados.\n');
}

/**
 * Cierre de brecha NAVIGATE (auditoría posterior 2026-11-13): cubre los 12
 * escenarios exigidos para la corrección de seguridad de NAVIGATE en
 * Rule 0 -> Decision Engine, y el no-op silencioso de `targetElement: null`.
 */
function runNavigateTests() {
  console.log('🧪 Cierre de brecha NAVIGATE — pruebas unitarias y de integración ligera\n');

  const ORIGINAL_HREF = 'https://shop.example.com/products/contact-us';
  const EXTERNAL_HREF = 'https://partner-site.example.org/offers';

  // -----------------------------------------------------------------
  // 1a. NAVIGATE hacia el destino original EXACTO (la acción fallida fue
  // ella misma un NAVIGATE, con su URL conservada vía el marcador) -> aceptada.
  // -----------------------------------------------------------------
  console.log('--- Escenario 1a: NAVIGATE recupera NAVIGATE fallido hacia la MISMA URL original ---');
  {
    const result = validateRecoveryEquivalence(
      {
        actionType: 'NAVIGATE',
        description: `Failed to execute: Timeout 30000ms exceeded [NAVIGATE_TARGET_URL: ${ORIGINAL_HREF}]`,
      },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: ORIGINAL_HREF },
    );
    assert(result.isEquivalent === true, 'URL propuesta idéntica a la navegación original conservada se acepta', result.reason);
  }

  // 1b. NAVIGATE recupera un CLICK fallido sobre un enlace cuyo href real
  // (evidencia estructurada) coincide EXACTAMENTE con la URL propuesta -> aceptada.
  console.log('\n--- Escenario 1b: NAVIGATE recupera CLICK fallido hacia el href REAL verificado del enlace ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: ORIGINAL_HREF },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === true, 'URL propuesta idéntica al href real del enlace fallido se acepta', result.reason);
  }

  // -----------------------------------------------------------------
  // 2. NAVIGATE hacia OTRA página del MISMO dominio, sin evidencia de
  // equivalencia -> rechazada (nunca se acepta solo por compartir dominio).
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 2: Mismo dominio, sin evidencia de equivalencia -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      {
        actionType: 'NAVIGATE',
        selector: null,
        elementType: null,
        text: null,
        ariaLabel: null,
        navigateTargetUrl: 'https://shop.example.com/products/completely-unrelated-page',
      },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'Mismo dominio pero URL distinta a la verificada se rechaza (no se acepta solo por el dominio)', result.reason);
  }

  // -----------------------------------------------------------------
  // 3. NAVIGATE hacia un dominio externo, sin evidencia de equivalencia -> rechazada.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 3: Dominio externo sin evidencia de equivalencia -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: 'https://totally-unrelated-site.com/' },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'Dominio externo arbitrario sin respaldo de evidencia se rechaza', result.reason);
  }

  // -----------------------------------------------------------------
  // 4. NAVIGATE hacia un destino EXTERNO pero expresamente respaldado por el
  // href real del enlace original -> aceptada (política basada en evidencia,
  // no en si el destino es interno o externo).
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 4: Destino externo respaldado por el href real del enlace original -> aceptada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-partner')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: EXTERNAL_HREF },
      [{ selector: '#link-partner', href: EXTERNAL_HREF }],
    );
    assert(result.isEquivalent === true, 'Destino externo verificado contra el href real del enlace que falló se acepta (no se penaliza solo por ser externo)', result.reason);
  }

  // -----------------------------------------------------------------
  // 5. URL malformada -> rechazada.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 5: URL malformada -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: 'not-a-valid-url ::::' },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'URL malformada se rechaza sin lanzar excepción', result.reason);
  }

  // -----------------------------------------------------------------
  // 6. Esquema peligroso (no http/https) -> rechazada (independientemente de
  // assertSafeUrl, que sigue actuando como segunda capa en automation.service.ts).
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 6: Esquema peligroso (javascript:) -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: 'javascript:alert(1)' },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'Esquema javascript: nunca coincide con una evidencia http(s) verificada, se rechaza', result.reason);
  }

  // -----------------------------------------------------------------
  // 7. Sin evidencia suficiente de la acción original (NAVIGATE fallido sin
  // marcador conservado, o CLICK fallido sobre un selector no presente en
  // knownLinks) -> rechazada en ambos casos.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 7: Sin evidencia suficiente de la acción original -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'NAVIGATE', description: 'Failed to execute: net::ERR_CONNECTION_RESET' },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: ORIGINAL_HREF },
    );
    assert(result.isEquivalent === false, 'NAVIGATE fallido sin marcador de URL conservado no puede verificarse, se rechaza', result.reason);
  }
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-unknown')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: ORIGINAL_HREF },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'CLICK fallido sobre un selector sin evidencia de href conocida se rechaza', result.reason);
  }
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')" },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: null },
      [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    );
    assert(result.isEquivalent === false, 'NAVIGATE propuesto sin inputData (navigateTargetUrl null) se rechaza', result.reason);
  }

  console.log('\n✅ validateRecoveryEquivalence (NAVIGATE): todos los escenarios unitarios superados.\n');

  // -----------------------------------------------------------------
  // 8. NAVIGATE normal (sin blockingError) hacia un destino externo legítimo
  // -> comportamiento preservado (se ejecuta, sin ninguna validación de equivalencia).
  // -----------------------------------------------------------------
  console.log('--- Escenario 8: NAVIGATE normal sin blockingError hacia destino externo legítimo ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: null,
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'NAVIGATE', targetElement: null, inputData: 'https://totally-unrelated-site.com/' },
      lastAction: { actionType: 'CLICK', description: 'Click en enlace "Ver más"', result: 'success' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'NAVIGATE ordinario (sin blockingError) hacia cualquier destino externo sigue permitido, sin validar equivalencia');
  }

  // -----------------------------------------------------------------
  // 9. [Cierre de no-op silencioso] NAVIGATE con targetElement: null y SIN
  // blockingError -> debe poder ejecutarse según el contrato (inputData como URL).
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 9: NAVIGATE con targetElement: null y sin blockingError se ejecuta según el contrato ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: null,
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'NAVIGATE', targetElement: null, inputData: 'https://shop.example.com/catalog' },
      lastAction: { actionType: 'NAVIGATE', description: 'Navegar a https://shop.example.com', result: 'success' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'NAVIGATE con targetElement: null (su contrato normal) ya no se auto-excluye en esta guarda; el despacho en runEvaluation ahora lo ejecuta (ver widened execute-branch condition)');
  }

  // -----------------------------------------------------------------
  // 10. NAVIGATE de recuperación RECHAZADA -> no debe ejecutarse (verificado
  // aquí a nivel de guarda pura; el wiring en runEvaluation garantiza que
  // `shouldExecute: false` nunca llega a `automationService.executeAction`,
  // ver informe) y debe quedar registrada explícitamente para
  // classifyExplorationTermination -> ACTION_FAILED.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 10: NAVIGATE de recuperación rechazada -> no ejecuta, registra ACTION_FAILED ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#link-contact')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'NAVIGATE', targetElement: null, inputData: 'https://totally-unrelated-site.com/' },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')", result: 'failure' },
      visibleDOMSummary: [],
      knownLinks: [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    });
    assert(decision.shouldExecute === false, 'NAVIGATE de recuperación sin evidencia verificable se rechaza (nunca llega a ejecutarse)');
    assert(!!decision.rejectionBlockingError?.startsWith('Recovery action rejected:'), 'El rechazo queda registrado explícitamente como blockingError (classifyExplorationTermination lo clasifica ACTION_FAILED, sin cambios)', decision.rejectionBlockingError);
  }

  // Caso positivo simétrico: NAVIGATE de recuperación CON evidencia
  // verificable (mismo href real) sí se ejecuta.
  console.log('\n--- Escenario 10b: NAVIGATE de recuperación CON evidencia verificable sí se ejecuta ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms waiting for locator('#link-contact')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'NAVIGATE', targetElement: null, inputData: ORIGINAL_HREF },
      lastAction: { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('#link-contact')", result: 'failure' },
      visibleDOMSummary: [],
      knownLinks: [{ selector: '#link-contact', href: ORIGINAL_HREF }],
    });
    assert(decision.shouldExecute === true, 'NAVIGATE de recuperación con href real verificado coincidente sí se ejecuta', decision.rejectionBlockingError);
  }

  // -----------------------------------------------------------------
  // 11. Ninguna decisión NORMAL de Gemini (sin blockingError) se ve afectada
  // -- incluida una decisión normal que NO es NAVIGATE, para confirmar que
  // el nuevo chequeo `isNavigateCandidate` no introduce ningún efecto
  // colateral en acciones no-NAVIGATE ordinarias.
  // -----------------------------------------------------------------
  console.log('\n--- Escenario 11: Decisión normal de Gemini no-NAVIGATE tampoco se ve afectada ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: null,
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: '#btn-add-to-cart' } },
      lastAction: { actionType: 'TYPE', description: 'Texto ingresado exitosamente', result: 'success' },
      visibleDOMSummary: [],
      knownLinks: [],
    });
    assert(decision.shouldExecute === true, 'Decisión CLICK ordinaria sin blockingError sigue sin validación alguna');
  }

  console.log('\n✅ Cierre de brecha NAVIGATE: todos los escenarios de integración ligera superados.\n');
}

/**
 * Corrección de integridad del marcador NAVIGATE_TARGET_URL (auditoría
 * posterior 2026-11-13): el extractor anterior usaba una regex no anclada
 * con captura perezosa, que devolvía la PRIMERA coincidencia de
 * `[NAVIGATE_TARGET_URL: ...]` en la descripción -- un `rationale` de Gemini
 * (texto libre, concatenado ANTES del marcador real) que por cualquier
 * motivo contuviera un patrón similar podía ser aceptado como si fuera la
 * URL original. Esta suite reproduce exactamente el caso demostrado en la
 * auditoría y los 7 escenarios exigidos para la corrección (anclaje `$` +
 * clase de caracteres que excluye `]`).
 */
function runNavigateMarkerIntegrityTests() {
  console.log('🧪 Corrección de integridad del marcador NAVIGATE_TARGET_URL — pruebas de regresión\n');

  function checkNavigate(description: string, proposedUrl: string): boolean {
    return validateRecoveryEquivalence(
      { actionType: 'NAVIGATE', description },
      { actionType: 'NAVIGATE', selector: null, elementType: null, text: null, ariaLabel: null, navigateTargetUrl: proposedUrl },
    ).isEquivalent;
  }

  // -----------------------------------------------------------------
  // 1. Rationale sin marcadores falsos + marcador legítimo al final ->
  // recupera la URL original.
  // -----------------------------------------------------------------
  console.log('--- 1. Sin marcadores falsos, marcador legítimo al final ---');
  {
    const description = 'Navigating per plan. [NAVIGATE_TARGET_URL: https://real.example/]';
    assert(checkNavigate(description, 'https://real.example/') === true, 'Recupera la URL legítima cuando no hay marcadores falsos');
  }

  // -----------------------------------------------------------------
  // 2. Rationale con UN marcador falso + marcador legítimo al final ->
  // recupera EXCLUSIVAMENTE la URL legítima. Reproduce EXPRESAMENTE el caso
  // demostrado en la auditoría (debe fallar con la implementación anterior
  // y pasar con la corrección).
  // -----------------------------------------------------------------
  console.log('\n--- 2. Un marcador falso + marcador legítimo al final (caso de la auditoría) ---');
  {
    const description =
      'Navigating per plan. [NAVIGATE_TARGET_URL: https://attacker.example/payload] [NAVIGATE_TARGET_URL: https://totally-unrelated-site.com/]';
    assert(checkNavigate(description, 'https://totally-unrelated-site.com/') === true, 'La URL legítima (al final) SÍ se acepta');
    assert(checkNavigate(description, 'https://attacker.example/payload') === false, 'La URL falsa (marcador anterior, no anclado al final) NUNCA se acepta -- este es el caso exacto reproducido en la auditoría');
  }

  // -----------------------------------------------------------------
  // 3. Rationale con VARIOS marcadores falsos + marcador legítimo al final ->
  // recupera EXCLUSIVAMENTE el último marcador legítimo.
  // -----------------------------------------------------------------
  console.log('\n--- 3. Varios marcadores falsos + marcador legítimo al final ---');
  {
    const description =
      'x [NAVIGATE_TARGET_URL: https://fake1.example/] y [NAVIGATE_TARGET_URL: https://fake2.example/] [NAVIGATE_TARGET_URL: https://real.example/final]';
    assert(checkNavigate(description, 'https://real.example/final') === true, 'Recupera exclusivamente el último marcador (el legítimo)');
    assert(checkNavigate(description, 'https://fake1.example/') === false, 'El primer marcador falso nunca se acepta');
    assert(checkNavigate(description, 'https://fake2.example/') === false, 'El segundo marcador falso nunca se acepta');
  }

  // -----------------------------------------------------------------
  // 4. Marcador falso SIN marcador legítimo al final -> rechazada (no hay
  // ninguna evidencia anclada al final que verificar).
  // -----------------------------------------------------------------
  console.log('\n--- 4. Marcador falso sin marcador legítimo al final ---');
  {
    const description = 'Navigating per plan. [NAVIGATE_TARGET_URL: https://attacker.example/payload] some trailing text';
    assert(checkNavigate(description, 'https://attacker.example/payload') === false, 'Sin ningún marcador anclado al final de la cadena, se rechaza');
  }

  // -----------------------------------------------------------------
  // 5. Marcador legítimo seguido de texto adicional -> rechazada (ese
  // formato no corresponde al contrato de persistencia: resolveActionOutcome
  // SIEMPRE añade el marcador como lo último de la descripción).
  // -----------------------------------------------------------------
  console.log('\n--- 5. Marcador legítimo seguido de texto adicional (formato ajeno al contrato) ---');
  {
    const description = '[NAVIGATE_TARGET_URL: https://real.example/] extra trailing text';
    assert(checkNavigate(description, 'https://real.example/') === false, 'Un marcador no anclado al final (aunque "parezca" legítimo) se rechaza');
  }

  // -----------------------------------------------------------------
  // 6. Marcador malformado -> rechazada.
  // -----------------------------------------------------------------
  console.log('\n--- 6. Marcador malformado ---');
  {
    const noClosingBracket = '[NAVIGATE_TARGET_URL: https://real.example/';
    assert(checkNavigate(noClosingBracket, 'https://real.example/') === false, 'Marcador sin corchete de cierre se rechaza');

    const noColon = '[NAVIGATE_TARGET_URL https://real.example/]';
    assert(checkNavigate(noColon, 'https://real.example/') === false, 'Marcador sin los dos puntos del formato se rechaza');
  }

  // -----------------------------------------------------------------
  // 7. URL legítima con caracteres especiales válidos -> se conserva
  // correctamente y pasa por la validación/normalización existente.
  // -----------------------------------------------------------------
  console.log('\n--- 7. URL con caracteres especiales válidos ---');
  {
    const specialUrl = 'https://example.com/path?query=value&foo=bar%20baz#section';
    const description = `Navigating. [NAVIGATE_TARGET_URL: ${specialUrl}]`;
    assert(checkNavigate(description, specialUrl) === true, 'URL con query string, encoding y fragmento se conserva y se acepta correctamente');
  }

  console.log('\n✅ Corrección de integridad del marcador NAVIGATE_TARGET_URL: todos los escenarios superados.\n');
}

/**
 * Cierre del falso rechazo CLICK→CLICK (auditoría de ejecución real
 * OpenCart, evaluación 6af7abf68f4fa0cf33ec332a, 2026-11-14): un enlace
 * fallido y uno alternativo apuntaban exactamente al mismo `href`
 * ("Oxford Tailored Tee"), pero el validador solo comparaba categoría+token,
 * sin consultar la evidencia estructurada de enlaces -- se rechazó una
 * recuperación realmente equivalente. Cubre los 9 escenarios exigidos para
 * la corrección (verificación por `href` real, complementaria al token).
 */
function runClickHrefEquivalenceTests() {
  console.log('🧪 Cierre de falso rechazo CLICK→CLICK (href real) — pruebas de regresión\n');

  function failedClickDescription(href: string | null): string {
    const base = 'Failed to execute: page.click: Timeout 10000ms exceeded.';
    return href ? `${base} ${formatClickTargetHrefMarker(href)}` : base;
  }

  // -----------------------------------------------------------------
  // 1. Caso A: mismo href verificado en ambos lados -> ACEPTAR.
  // -----------------------------------------------------------------
  console.log('--- 1. CLICK fallido y alternativo con el MISMO href -> aceptada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#alt-link', elementType: 'link', text: 'Product X (catálogo)', ariaLabel: null },
      [{ selector: '#alt-link', href: 'https://shop.example.com/p/product-x' }],
    );
    assert(result.isEquivalent === true, 'Mismo href real verificado en ambos snapshots se acepta', result.reason);
  }

  // -----------------------------------------------------------------
  // 2. Caso B: ambos resuelven a href, pero DISTINTOS -> RECHAZAR, incluso
  // con texto/categoría similares.
  // -----------------------------------------------------------------
  console.log('\n--- 2. CLICK fallido y alternativo con hrefs DIFERENTES -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#alt-link', elementType: 'link', text: 'Product X (catálogo)', ariaLabel: null },
      [{ selector: '#alt-link', href: 'https://shop.example.com/p/product-y' }],
    );
    assert(result.isEquivalent === false, 'Hrefs verificados pero distintos se rechaza, aunque el texto sea casi idéntico', result.reason);
  }

  // -----------------------------------------------------------------
  // 3. CLICK fallido SIN enlace verificable (sin marcador de href -- p. ej.
  // era un botón, no un <a>, o no se pudo resolver en su momento) -> rechazada
  // (cae al camino de token existente, que tampoco encuentra equivalencia).
  // -----------------------------------------------------------------
  console.log('\n--- 3. CLICK fallido sin enlace verificable (sin marcador) -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: "Failed to execute: Timeout 10000ms waiting for locator('section:nth-of-type(2) > button')" },
      { actionType: 'CLICK', selector: '#alt-link', elementType: 'link', text: 'Product X', ariaLabel: null },
      [{ selector: '#alt-link', href: 'https://shop.example.com/p/product-x' }],
    );
    assert(result.isEquivalent === false, 'Sin evidencia de que la acción original fuera un enlace verificable, se rechaza', result.reason);
  }

  // -----------------------------------------------------------------
  // 4. CLICK alternativo SIN enlace verificable: el original SÍ era
  // verificable, pero el selector propuesto no resuelve a ningún enlace
  // conocido en el snapshot actual -> rechazada (conservador, no cae al token).
  // -----------------------------------------------------------------
  console.log('\n--- 4. CLICK alternativo sin enlace verificable en el snapshot actual -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#unknown-selector', elementType: 'link', text: 'Product X', ariaLabel: null },
      [{ selector: '#other-link', href: 'https://shop.example.com/p/some-other-product' }],
    );
    assert(result.isEquivalent === false, 'El candidato no resuelve a ningún enlace conocido en el snapshot actual -> rechazo conservador', result.reason);
  }
  // Variante: el candidato ni siquiera es un elemento de tipo link (botón) -- el
  // chequeo de href no aplica en absoluto, y el camino de token tampoco encuentra evidencia.
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#some-button', elementType: 'button', text: 'Product X', ariaLabel: null },
      [],
    );
    assert(result.isEquivalent === false, 'Candidato de tipo "button" (no "link") no puede verificarse por href -> rechazada', result.reason);
  }

  // -----------------------------------------------------------------
  // 5. Selector ambiguo: más de un enlace conocido comparte el mismo selector
  // del candidato -> rechazada (nunca se elige "el primero" arbitrariamente).
  // -----------------------------------------------------------------
  console.log('\n--- 5. Selector ambiguo (más de una coincidencia) -> rechazada ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#ambiguous-link', elementType: 'link', text: 'Product X', ariaLabel: null },
      [
        { selector: '#ambiguous-link', href: 'https://shop.example.com/p/product-x' },
        { selector: '#ambiguous-link', href: 'https://shop.example.com/p/product-z' },
      ],
    );
    assert(result.isEquivalent === false, 'Más de una coincidencia para el mismo selector -> ambigüedad, se rechaza sin elegir arbitrariamente', result.reason);
  }

  // -----------------------------------------------------------------
  // 6. Caso real de OpenCart: selectores profundos basados en nth-of-type,
  // sin NINGÚN identificador semántico -- extractNavigationToken solo
  // extraería el tag HTML "section" (bloqueado por el denylist del Riesgo
  // 1), por lo que el camino de token NUNCA podría validar esto. La
  // verificación por href permite aceptarlo igualmente, con evidencia real.
  // -----------------------------------------------------------------
  console.log('\n--- 6. Selectores profundos nth-of-type (caso real OpenCart) -> validados por href ---');
  {
    const PRODUCT_HREF = 'https://opencart-demo.smartfront.io/p/oxford-tailored-tee';
    const failedSelector = 'section:nth-of-type(4) > div > div > section > div > div:nth-of-type(1) > a';
    const candidateSelector = 'div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > a';
    const result = validateRecoveryEquivalence(
      {
        actionType: 'CLICK',
        description: `Failed to execute: page.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('${failedSelector}') ${formatClickTargetHrefMarker(PRODUCT_HREF)}`,
      },
      {
        actionType: 'CLICK',
        selector: candidateSelector,
        elementType: 'link',
        text: 'Bestseller-25%Oxford Tailored Tee(142)€48.00€64.00',
        ariaLabel: null,
      },
      [{ selector: candidateSelector, href: PRODUCT_HREF }],
    );
    assert(result.isEquivalent === true, 'Caso real OpenCart: mismo producto, distinta ruta de página -> ahora se acepta por href verificado', result.reason);

    // Confirma, además, que sin el marcador de href (como ocurrió en la
    // ejecución real antes de esta corrección) el camino de token SIGUE sin
    // poder validar este selector -- la mejora es aditiva, no reemplaza el
    // comportamiento anterior quando no hay evidencia de href.
    const resultWithoutMarker = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: `Failed to execute: page.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('${failedSelector}')` },
      { actionType: 'CLICK', selector: candidateSelector, elementType: 'link', text: 'Oxford Tailored Tee', ariaLabel: null },
      [{ selector: candidateSelector, href: PRODUCT_HREF }],
    );
    assert(resultWithoutMarker.isEquivalent === false, 'Sin el marcador de href, el camino de token (heredado del Riesgo 1) sigue rechazando este selector -- comportamiento previo preservado', resultWithoutMarker.reason);
  }

  // -----------------------------------------------------------------
  // 7. Enlace externo: la coincidencia textual/de dominio NUNCA autoriza por
  // sí sola -- solo la igualdad EXACTA de href verificado.
  // -----------------------------------------------------------------
  console.log('\n--- 7. Enlace externo con href distinto -> sigue rechazándose ---');
  {
    const result = validateRecoveryEquivalence(
      { actionType: 'CLICK', description: failedClickDescription('https://shop.example.com/p/product-x') },
      { actionType: 'CLICK', selector: '#external-link', elementType: 'link', text: 'Product X (partner store)', ariaLabel: null },
      [{ selector: '#external-link', href: 'https://partner-site.example.org/p/product-x' }],
    );
    assert(result.isEquivalent === false, 'Dominio externo con href distinto (aunque el texto "Product X" coincida) se rechaza -- nunca se autoriza por similitud textual o de dominio', result.reason);
  }

  console.log('\n✅ Cierre de falso rechazo CLICK→CLICK: todos los escenarios superados.\n');
}

/**
 * [Corrección de cableado, auditoría pre-cierre MVP 2026-11-14] Las 53
 * aserciones anteriores de CLICK→CLICK invocan `validateRecoveryEquivalence`
 * DIRECTAMENTE, entregando `knownLinks` explícitamente en cada llamada --
 * eso probó la lógica del validador, pero NUNCA el cableado real de
 * `evaluation.service.ts`, que es donde estaba el defecto real de
 * producción: la rama CLICK (no NAVIGATE) de `evaluateRecoveryGuard` nunca
 * entregaba `params.knownLinks` a `validateRecoveryEquivalence` (quedaba en
 * su valor por defecto `[]`), así que TODA recuperación CLICK→CLICK se
 * rechazaba sin importar la evidencia real -- confirmado en la evaluación
 * OpenCart real `6af7bafc9f984355779c076c` (href idéntico verificado en el
 * snapshot persistido, recuperación rechazada igualmente).
 *
 * Esta suite llama a `evaluateRecoveryGuard` (la función real y exportada
 * de `evaluation.service.ts`, el mismo punto de entrada que usa
 * `runEvaluation`) -- NO reimplementa ni simula el resultado del validador.
 * Es el nivel de integración más pequeño posible sin reescribir
 * `runEvaluation` completo (que requeriría un navegador Playwright real y
 * queda fuera de alcance): exactamente la frontera donde el argumento
 * faltante vivía.
 */
function runClickHrefWiringIntegrationTest() {
  console.log('🧪 Cableado real CLICK→CLICK en evaluateRecoveryGuard — prueba de integración (defecto de producción)\n');

  const PRODUCT_HREF = 'https://opencart-demo.smartfront.io/p/oxford-tailored-tee';
  const FAILED_SELECTOR = 'section:nth-of-type(4) > div > div > section > div > div:nth-of-type(1) > a';
  const CANDIDATE_SELECTOR = 'div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > a';

  function failedClickWithMarker(href: string) {
    return {
      actionType: 'CLICK',
      description: `Failed to execute: page.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('${FAILED_SELECTOR}') ${formatClickTargetHrefMarker(href)}`,
      result: 'failure' as const,
    };
  }

  // -----------------------------------------------------------------
  // 1. Caso real de OpenCart reproducido EXACTAMENTE a través del cableado
  // real: CLICK fallido con marcador + snapshot de recuperación con
  // EXACTAMENTE un enlace coincidente (mismo href) -> evaluateRecoveryGuard
  // debe aceptar. Esta es la aserción que habría fallado con el defecto
  // original (knownLinks vacío por el argumento faltante habría forzado
  // shouldExecute:false aquí, incorrectamente).
  // -----------------------------------------------------------------
  console.log('--- 1. Caso real OpenCart a través del cableado real -> ACEPTA (params.knownLinks sí llega) ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms exceeded waiting for locator('...')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: CANDIDATE_SELECTOR } },
      lastAction: failedClickWithMarker(PRODUCT_HREF),
      visibleDOMSummary: [
        { selector: CANDIDATE_SELECTOR, type: 'link', text: 'Bestseller-25%Oxford Tailored Tee', ariaLabel: null, role: null, isDisabled: false, isPrimary: false },
      ],
      knownLinks: [{ selector: CANDIDATE_SELECTOR, href: PRODUCT_HREF }],
    });
    assert(
      decision.shouldExecute === true,
      'Reproduce el caso real OpenCart a través de evaluateRecoveryGuard (no del validador en aislamiento): con el cableado corregido, la recuperación con href real coincidente SÍ se acepta',
      decision.rejectionBlockingError,
    );
  }

  // -----------------------------------------------------------------
  // 2. Mismo cableado real, pero href VERIFICABLEMENTE DISTINTO -> sigue
  // rechazada. Confirma que la corrección de cableado no relajó ninguna
  // validación de seguridad (no se "abrió la puerta" de más).
  // -----------------------------------------------------------------
  console.log('\n--- 2. Cableado real + href DISTINTO -> sigue rechazada (sin relajar seguridad) ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms exceeded waiting for locator('...')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: CANDIDATE_SELECTOR } },
      lastAction: failedClickWithMarker(PRODUCT_HREF),
      visibleDOMSummary: [
        { selector: CANDIDATE_SELECTOR, type: 'link', text: 'Otro producto no relacionado', ariaLabel: null, role: null, isDisabled: false, isPrimary: false },
      ],
      knownLinks: [{ selector: CANDIDATE_SELECTOR, href: 'https://opencart-demo.smartfront.io/p/otro-producto-distinto' }],
    });
    assert(decision.shouldExecute === false, 'A través del cableado real, un href verificablemente distinto sigue rechazándose');
  }

  // -----------------------------------------------------------------
  // 3. Mismo cableado real, pero SIN evidencia (el snapshot de recuperación
  // no contiene ese enlace) -> rechazo conservador preservado -- idéntico
  // al comportamiento (correcto) de antes del fix para este caso.
  // -----------------------------------------------------------------
  console.log('\n--- 3. Cableado real + sin evidencia en el snapshot -> rechazo conservador preservado ---');
  {
    const decision = evaluateRecoveryGuard({
      blockingError: "Action failed: Timeout 10000ms exceeded waiting for locator('...')",
      decisionCameFromRuleEngine: false,
      recommendedNextStep: 'executeSuggestedAction',
      currentAction: { actionType: 'CLICK', targetElement: { value: CANDIDATE_SELECTOR } },
      lastAction: failedClickWithMarker(PRODUCT_HREF),
      visibleDOMSummary: [
        { selector: CANDIDATE_SELECTOR, type: 'link', text: 'Producto', ariaLabel: null, role: null, isDisabled: false, isPrimary: false },
      ],
      knownLinks: [],
    });
    assert(decision.shouldExecute === false, 'Sin evidencia real en el snapshot de recuperación, el rechazo conservador se mantiene sin cambios');
  }

  console.log('\n✅ Cableado real CLICK→CLICK en evaluateRecoveryGuard: integración verificada end-to-end (no solo el validador aislado).\n');
}

console.log('🧪 Iniciando pruebas del cierre de brecha Rule 0 -> Decision Engine...\n');
runValidatorTests();
runGuardTests();
runNavigateTests();
runNavigateMarkerIntegrityTests();
runClickHrefEquivalenceTests();
runClickHrefWiringIntegrationTest();
console.log('========================================');
console.log('Results: All recovery-equivalence scenarios passed successfully!');
console.log('========================================\n');
process.exit(0);
