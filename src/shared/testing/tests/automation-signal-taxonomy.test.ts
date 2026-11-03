import {
  classifyActionFailure,
  classifyDomFact,
  canJustifyFail,
  recommendedStatusForEvidence,
  isAutomationSignalOnly,
} from '@/shared/testing/automation-signal-taxonomy';

/**
 * Fase D — unit validation of the automation-signal / dom-observation
 * taxonomy itself, with synthetic data (no browser, no Gemini).
 */
function runTests() {
  console.log('🧪 Starting automation-signal-taxonomy unit validation (Fase D)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  console.log('--- classifyActionFailure ---');
  assert(classifyActionFailure({ success: true }) === null, 'Una acción exitosa NO produce ningún ítem de evidencia (nada que clasificar)');
  {
    const item = classifyActionFailure({ success: false, error: 'page.click: Timeout 10000ms exceeded.' });
    assert(item !== null && item.origin === 'automation-signal', 'Una acción fallida se clasifica como automation-signal');
    assert(item!.description.includes('Timeout'), 'La descripción conserva el mensaje real del error de Playwright');
  }

  console.log('\n--- classifyDomFact ---');
  {
    const item = classifyDomFact('El botón tiene aria-label', { ariaLabel: 'Cerrar' });
    assert(item.origin === 'dom-observation', 'Un hecho del DOM siempre se clasifica como dom-observation');
  }

  console.log('\n--- canJustifyFail: la regla central ---');
  {
    const onlyAutomation = [classifyActionFailure({ success: false, error: 'timeout' })!];
    assert(canJustifyFail(onlyAutomation) === false, 'Evidencia SOLO automation-signal NUNCA justifica un FAIL, sin importar cuántos ítems haya');

    const manyAutomationSignals = [
      classifyActionFailure({ success: false, error: 'timeout 1' })!,
      classifyActionFailure({ success: false, error: 'timeout 2' })!,
      classifyActionFailure({ success: false, error: 'locator resolved to 5 elements' })!,
    ];
    assert(canJustifyFail(manyAutomationSignals) === false, 'NI SIQUIERA múltiples señales de automatización acumuladas justifican un FAIL por sí solas');

    const onlyDom = [classifyDomFact('alt vacío', { alt: '' })];
    assert(canJustifyFail(onlyDom) === true, 'Evidencia dom-observation por sí sola SÍ es suficiente para justificar un FAIL');

    const mixed = [classifyActionFailure({ success: false, error: 'timeout' })!, classifyDomFact('elemento no visible', { display: 'none' })];
    assert(canJustifyFail(mixed) === true, 'Evidencia mixta (automation-signal + dom-observation) SÍ justifica un FAIL — el dato real del DOM es lo que lo permite, no el fallo de automatización');

    assert(canJustifyFail([]) === false, 'Evidencia vacía no justifica un FAIL');
  }

  console.log('\n--- recommendedStatusForEvidence ---');
  {
    const onlyAutomation = [classifyActionFailure({ success: false, error: 'timeout' })!];
    assert(recommendedStatusForEvidence(onlyAutomation) === 'NOT_EVALUABLE', 'Solo automation-signal -> NOT_EVALUABLE (nunca FAIL)');
    const withDom = [classifyActionFailure({ success: false, error: 'timeout' })!, classifyDomFact('display:none confirmado', {})];
    assert(recommendedStatusForEvidence(withDom) === 'FAIL', 'Con al menos 1 dom-observation -> FAIL permitido');
  }

  console.log('\n--- isAutomationSignalOnly ---');
  {
    assert(isAutomationSignalOnly([classifyActionFailure({ success: false, error: 'x' })!]) === true, 'Detecta correctamente el caso "solo automation-signal"');
    assert(isAutomationSignalOnly([classifyDomFact('x', {})]) === false, 'No marca como "solo automation-signal" cuando hay dom-observation');
    assert(isAutomationSignalOnly([]) === false, 'Un array vacío no cuenta como "solo automation-signal" (no hay señal alguna que aislar)');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
