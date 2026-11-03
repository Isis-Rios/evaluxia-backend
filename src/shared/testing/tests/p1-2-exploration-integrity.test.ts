import { classifyExplorationTermination } from '@/modules/evaluations/evaluation.service';
import { buildExplorationIntegrity } from '@/shared/infrastructure/metrics-tracker';
import { deriveExplorationAuditSignal } from '@/modules/evaluations/services/audit-engine.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * P1.2 — regresión de la corrección mínima descrita en la investigación
 * forense P1.2 (pilotos 3 y 4 reales, evaluaciones `6ae1e886ee35fe6d003e4931`
 * y `6ae21765ee35fe6d003e5796`): ambas terminaron con `blockingError: null` y
 * `explorationIntegrity.complete: true`, pero su última acción (técnicamente
 * exitosa) nunca tuvo un snapshot posterior que confirmara su efecto —
 * consistente con agotamiento de `maxIterations`, indistinguible antes de
 * este cambio de una parada natural.
 *
 * Gemini calls: 0. Todo determinístico/sintético; la propagación al prompt
 * real se prueba vía el pipeline mockeado ya validado (G1-G8).
 */
async function main() {
  console.log('🧪 Starting P1.2 — exploration termination/integrity regression...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // -----------------------------------------------------------------
  // classifyExplorationTermination (evaluation.service.ts) — pura.
  // -----------------------------------------------------------------
  console.log('--- classifyExplorationTermination ---');

  // 1. El agente solicita stopFlow tras una iteración válida.
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: false,
      currentIteration: 3,
      maxIterations: 8,
      previousActions: [{ actionType: 'NAVIGATE', result: 'success' }, { actionType: 'CLICK', result: 'success' }],
    });
    assert(r.terminationReason === 'NATURAL_STOP', 'Caso 1: stopFlow natural (sin blockingError, flowCanContinue=false, iteraciones no agotadas) -> NATURAL_STOP');
    assert(r.lastActionVerifiedBySnapshot === true, 'Caso 1: una parada natural no deja ninguna acción sin verificar');
  }

  // 2. El límite se alcanza justo después de ejecutar una acción exitosa
  // (reproduce EXACTAMENTE la forma real de los pilotos 3 y 4).
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: true, // el bucle nunca puso esto en false -- salió por conteo de iteración
      currentIteration: 5, // ya incrementado tras procesar la iteración 4
      maxIterations: 4,
      previousActions: [
        { actionType: 'NAVIGATE', result: 'success' },
        { actionType: 'CLICK', result: 'success' },
        { actionType: 'CLICK', result: 'success' },
        { actionType: 'CLICK', result: 'success' },
        { actionType: 'TYPE', result: 'success' }, // la última acción real (piloto 4: TYPE email; piloto 3: CLICK Launch Live Preview)
      ],
    });
    assert(r.terminationReason === 'MAX_ITERATIONS_REACHED', 'Caso 2: currentIteration > maxIterations con flowCanContinue aún true -> MAX_ITERATIONS_REACHED');
    assert(r.lastActionVerifiedBySnapshot === false, 'Caso 2: la última acción (TYPE, exitosa) NO queda verificada por snapshot -- reproduce el piloto 4 real');
  }

  // 2b. El mismo caso, pero la última acción fue NAVIGATE (nunca cuenta como "colgante": su snapshot es el de la iteración 1, capturado en la misma iteración).
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: true,
      currentIteration: 2,
      maxIterations: 1,
      previousActions: [{ actionType: 'NAVIGATE', result: 'success' }],
    });
    assert(r.terminationReason === 'MAX_ITERATIONS_REACHED', 'Caso 2b: agotamiento con una sola iteración (solo NAVIGATE) -> MAX_ITERATIONS_REACHED');
    assert(r.lastActionVerifiedBySnapshot === true, 'Caso 2b: NAVIGATE nunca se trata como acción colgante sin verificar (su snapshot ya existe)');
  }

  // 3. Una acción falla y se detiene la exploración (Regla 0 del RuleEngine, iteración siguiente).
  {
    const r = classifyExplorationTermination({
      blockingError: 'Action failed: Timeout 10000ms exceeded.',
      flowCanContinue: false,
      currentIteration: 3,
      maxIterations: 8,
      previousActions: [
        { actionType: 'NAVIGATE', result: 'success' },
        { actionType: 'CLICK', result: 'failure' },
      ],
    });
    assert(r.terminationReason === 'ACTION_FAILED', 'Caso 3: blockingError presente (aunque flowCanContinue ya sea false) -> ACTION_FAILED, nunca NATURAL_STOP');
  }

  // 5. El motivo de terminación no puede determinarse (caso defensivo: ni blockingError, ni flowCanContinue=false, ni iteraciones agotadas -- no debería ocurrir en la práctica, pero nunca se etiqueta como natural).
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: true,
      currentIteration: 3,
      maxIterations: 8,
      previousActions: [],
    });
    assert(r.terminationReason === 'UNKNOWN', 'Caso 5: ningún criterio aplica -> UNKNOWN, nunca se asume NATURAL_STOP por defecto');
  }

  // -----------------------------------------------------------------
  // buildExplorationIntegrity (metrics-tracker.ts).
  // -----------------------------------------------------------------
  console.log('\n--- buildExplorationIntegrity ---');

  // 6. Exploración natural con capturas correctas -> mantiene el comportamiento válido actual.
  {
    const r = buildExplorationIntegrity(null, {
      terminationReason: 'NATURAL_STOP',
      lastActionVerifiedBySnapshot: true,
      snapshotPersistenceFailureCount: 0,
    });
    assert(r.complete === true, 'Caso 6: NATURAL_STOP + sin blockingError + evidencia íntegra -> complete=true (comportamiento preexistente preservado)');
    assert(r.evidenceFullyVerified === true, 'Caso 6: evidenceFullyVerified=true cuando no hay fallos y la última acción está verificada');
  }

  // 7. Documento histórico sin los nuevos campos (llamada de 1 solo argumento) -> sigue siendo compatible, y NO se etiqueta como natural confirmada.
  {
    const r = buildExplorationIntegrity(null);
    assert(r.complete === true, 'Caso 7: llamada de compatibilidad (1 argumento) preserva EXACTAMENTE el cálculo anterior a P1.2 para `complete`');
    assert(r.terminationReason === 'UNKNOWN', 'Caso 7: pero `terminationReason` se declara explícitamente UNKNOWN -- la ausencia de dato de P1.2 nunca se presenta como "natural confirmada"');

    const withError = buildExplorationIntegrity('algún error');
    assert(withError.complete === false && withError.interruptionReason === 'algún error', 'Caso 7b: la rama de compatibilidad con blockingError también es idéntica a la de antes de P1.2');
  }

  // Reproducción directa del defecto real: MAX_ITERATIONS_REACHED con blockingError=null (exactamente como en los pilotos 3 y 4) ya NO se presenta como completado.
  {
    const r = buildExplorationIntegrity(null, {
      terminationReason: 'MAX_ITERATIONS_REACHED',
      lastActionVerifiedBySnapshot: false,
      snapshotPersistenceFailureCount: 0,
    });
    assert(r.complete === false, 'Reproducción pilotos 3/4: MAX_ITERATIONS_REACHED con blockingError=null YA NO da complete=true (antes de P1.2 esto era el bug real)');
    assert(r.evidenceFullyVerified === false, 'Reproducción pilotos 3/4: evidenceFullyVerified=false porque la última acción no quedó verificada');
    assert(r.terminationReason === 'MAX_ITERATIONS_REACHED', 'Reproducción pilotos 3/4: terminationReason se preserva y expone el motivo real');
  }

  // UNKNOWN con termination explícito (no solo el fallback de 1 argumento) tampoco se etiqueta como natural.
  {
    const r = buildExplorationIntegrity(null, {
      terminationReason: 'UNKNOWN',
      lastActionVerifiedBySnapshot: true,
      snapshotPersistenceFailureCount: 0,
    });
    assert(r.complete === false, 'UNKNOWN explícito -> complete=false (nunca se asume natural aunque la evidencia disponible luzca íntegra)');
  }

  // ACTION_FAILED sigue distinguible (sin cambios respecto al comportamiento ya validado).
  {
    const r = buildExplorationIntegrity('Action failed: boom', {
      terminationReason: 'ACTION_FAILED',
      lastActionVerifiedBySnapshot: true,
      snapshotPersistenceFailureCount: 0,
    });
    assert(r.complete === false && r.interruptionReason === 'Action failed: boom', 'ACTION_FAILED sigue dando complete=false con el mensaje real preservado');
  }

  // -----------------------------------------------------------------
  // 4. Falla el guardado de SnapshotEvidence -- se propaga sin confundirse
  // con un agotamiento de iteraciones ni con un fallo de acción.
  // -----------------------------------------------------------------
  console.log('\n--- Falla de persistencia de snapshot (deriveExplorationAuditSignal + buildExplorationIntegrity) ---');
  {
    const signal = deriveExplorationAuditSignal({
      blockingError: null,
      currentStep: 3,
      terminationReason: 'NATURAL_STOP',
      snapshotIntegrity: {
        lastActionVerifiedBySnapshot: true,
        persistenceFailures: [{ iteration: 2, error: 'Mongo write timeout' }],
      },
    });
    assert(signal.snapshotPersistenceFailureCount === 1, 'Un fallo de persistencia se cuenta correctamente');
    assert(!!signal.explorationNote && signal.explorationNote.includes('1 snapshot(s) failed to persist'), 'El fallo de persistencia genera un explorationNote propio, sin necesitar blockingError');
    assert(signal.terminationReason === 'NATURAL_STOP', 'El fallo de persistencia NO se reclasifica como agotamiento de iteraciones ni como fallo de acción -- son dimensiones separadas');

    const integrity = buildExplorationIntegrity(signal.rawBlockingError, {
      terminationReason: signal.terminationReason!,
      lastActionVerifiedBySnapshot: signal.lastActionVerifiedBySnapshot ?? false,
      snapshotPersistenceFailureCount: signal.snapshotPersistenceFailureCount,
    });
    assert(integrity.complete === false, 'Una terminación NATURAL_STOP con un fallo de persistencia de snapshot ya NO se reporta como íntegramente completada');
    assert(integrity.evidenceFullyVerified === false, 'evidenceFullyVerified refleja el fallo de captura, no solo el motivo de terminación');
  }

  // -----------------------------------------------------------------
  // 8. El estado calculado llega correctamente a buildExplorationIntegrity
  // Y al contexto real enviado a la Fase 2 -- extremo a extremo, vía el
  // pipeline mockeado real (sin red, sin Gemini).
  // -----------------------------------------------------------------
  console.log('\n--- Extremo a extremo: propagación real al prompt de Fase 2 ---');
  {
    const signal = deriveExplorationAuditSignal({
      blockingError: null,
      currentStep: 4,
      terminationReason: 'MAX_ITERATIONS_REACHED',
      snapshotIntegrity: { lastActionVerifiedBySnapshot: false, persistenceFailures: [] },
    });
    assert(!!signal.explorationNote && signal.explorationNote.includes('reached its iteration limit immediately after executing its last action'), 'deriveExplorationAuditSignal produce la nota esperada para el caso real de los pilotos 3/4');

    const emptyResponse = buildValidAuditOutputJson([]);
    const stub = stubGeminiJsonResponses([emptyResponse]);
    try {
      const result = await runMockedPhase2Pipeline(
        [{ iteration: 1, url: 'https://fixture.local/p12', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] }],
        { evaluationId: 'p12-max-iterations', explorationNote: signal.explorationNote },
      );
      assert(result.prompt.includes('EXPLORATION STATUS'), 'El prompt REAL de Fase 2 incluye la sección de estado de exploración para el caso de agotamiento de iteraciones');
      assert(result.prompt.includes('no further snapshot was captured'), 'El prompt real incluye el texto específico de "acción sin verificar", no un mensaje genérico');
    } finally {
      stub.restore();
    }
  }

  // =====================================================================
  // P1.2.2 — corrección de la auditoría P1.2.1: (A) decisión
  // `executeSuggestedAction` sin `targetElement` cuando el actionType lo
  // requiere ya no avanza silenciosamente; (B) el catch externo ya no
  // etiqueta cualquier excepción como ACTION_FAILED.
  // =====================================================================
  console.log('\n--- P1.2.2: decisión no ejecutable (INVALID_ACTION_DECISION) ---');

  // 2. executeSuggestedAction sin targetElement, actionType que SÍ lo
  // requiere (p. ej. CLICK) -> anomalía real, nunca se ejecuta nada.
  {
    const r = classifyExplorationTermination({
      blockingError: "Invalid action decision: actionType 'CLICK' requires a targetElement, but none was provided.",
      flowCanContinue: false,
      currentIteration: 3,
      maxIterations: 8,
      previousActions: [
        { actionType: 'NAVIGATE', result: 'success' },
        { actionType: 'CLICK', result: 'failure' }, // la entrada que runEvaluation registra para la anomalía (nunca se ejecutó, result:'failure' por diseño)
      ],
      invalidActionDecision: true,
    });
    assert(r.terminationReason === 'INVALID_ACTION_DECISION', 'Caso 2: decisión executeSuggestedAction sin targetElement (CLICK) -> INVALID_ACTION_DECISION, nunca ACTION_FAILED aunque blockingError esté presente');
    assert(r.lastActionVerifiedBySnapshot === false, 'Caso 2: nunca se afirma evidencia de una acción que nunca se ejecutó');
  }

  // 1. executeSuggestedAction con currentAction ausente -- esto SIGUE
  // resolviéndose por la rama existente (stopFlow || !currentAction), NUNCA
  // por la nueva rama de anomalía (que exige `currentAction` truthy). Se
  // prueba por contrato: con invalidActionDecision=false/omitido (como
  // produciría esa rama preexistente), la clasificación es NATURAL_STOP,
  // no INVALID_ACTION_DECISION.
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: false, // la rama "!currentAction" pone esto en false, como antes de P1.2.2
      currentIteration: 2,
      maxIterations: 8,
      previousActions: [{ actionType: 'NAVIGATE', result: 'success' }],
      // invalidActionDecision omitido: currentAction ausente nunca entra en la nueva rama (ver evaluation.service.ts, la condición exige `currentAction` truthy)
    });
    assert(r.terminationReason === 'NATURAL_STOP', 'Caso 1: currentAction ausente sigue clasificándose como NATURAL_STOP (rama preexistente), no se confunde con la nueva anomalía');
  }

  // 4 (parte 2, NAVIGATE/STOP_FLOW legítimamente sin targetElement): la
  // nueva rama de anomalía EXCLUYE explícitamente estos dos actionType
  // (contrato real: SuggestedActionSchema permite targetElement:null; solo
  // NAVIGATE/STOP_FLOW no lo necesitan, ver automation.service.ts). No hay
  // forma de probar la rama del bucle sin ejecutarlo, pero se documenta
  // aquí la garantía de diseño: con invalidActionDecision=false (como
  // produciría el código real para estos dos actionType), NUNCA se
  // clasifica como INVALID_ACTION_DECISION.
  {
    const r = classifyExplorationTermination({
      blockingError: null,
      flowCanContinue: true,
      currentIteration: 2,
      maxIterations: 8,
      previousActions: [{ actionType: 'NAVIGATE', result: 'success' }],
      invalidActionDecision: false,
    });
    assert(r.terminationReason !== 'INVALID_ACTION_DECISION', 'NAVIGATE/STOP_FLOW sin targetElement nunca producen INVALID_ACTION_DECISION (excluidos explícitamente en evaluation.service.ts)');
  }

  // 3. Clasificación y persistencia coherente de la anomalía -- la
  // combinación exacta que runEvaluation construiría (blockingError
  // reutilizado para el frontend + invalidActionDecision=true) produce un
  // flowState internamente coherente.
  {
    const r = classifyExplorationTermination({
      blockingError: "Invalid action decision: actionType 'TYPE' requires a targetElement, but none was provided.",
      flowCanContinue: false,
      currentIteration: 2,
      maxIterations: 8,
      previousActions: [
        { actionType: 'NAVIGATE', result: 'success' },
        { actionType: 'TYPE', result: 'failure' },
      ],
      invalidActionDecision: true,
    });
    const integrity = buildExplorationIntegrity(r.terminationReason === 'INVALID_ACTION_DECISION' ? "Invalid action decision: actionType 'TYPE' requires a targetElement, but none was provided." : null, {
      terminationReason: r.terminationReason,
      lastActionVerifiedBySnapshot: r.lastActionVerifiedBySnapshot,
      snapshotPersistenceFailureCount: 0,
    });
    assert(integrity.complete === false, 'Caso 3: una exploración detenida por decisión no ejecutable nunca se reporta como completada');
    assert(integrity.terminationReason === 'INVALID_ACTION_DECISION', 'Caso 3: el motivo persistido/propagado es el específico, no un genérico ACTION_FAILED');
  }

  // 4. Propagación al contexto real de Fase 2 (reutilizando el MISMO
  // mecanismo de blockingError, sin un campo nuevo) -- extremo a extremo.
  {
    const signal = deriveExplorationAuditSignal({
      blockingError: "Invalid action decision: actionType 'CLICK' requires a targetElement, but none was provided.",
      currentStep: 2,
      terminationReason: 'INVALID_ACTION_DECISION',
      snapshotIntegrity: { lastActionVerifiedBySnapshot: false, persistenceFailures: [] },
    });
    assert(!!signal.explorationNote && signal.explorationNote.includes("actionType 'CLICK' requires a targetElement"), 'deriveExplorationAuditSignal propaga el mensaje real de la anomalía (vía el mecanismo existente de blockingError), sin inventar uno genérico');

    const emptyResponse = buildValidAuditOutputJson([]);
    const stub = stubGeminiJsonResponses([emptyResponse]);
    try {
      const result = await runMockedPhase2Pipeline(
        [{ iteration: 1, url: 'https://fixture.local/p122', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] }],
        { evaluationId: 'p122-invalid-decision', explorationNote: signal.explorationNote },
      );
      assert(result.prompt.includes("actionType 'CLICK' requires a targetElement"), 'El prompt REAL de Fase 2 recibe el motivo específico de la decisión no ejecutable');
    } finally {
      stub.restore();
    }
  }

  // 7. Un fallo real de acción (resolveActionOutcome) sigue dando
  // ACTION_FAILED -- regresión explícita tras añadir la comprobación de
  // invalidActionDecision ANTES en el orden de prioridad.
  {
    const r = classifyExplorationTermination({
      blockingError: 'Action failed: Timeout 10000ms exceeded.',
      flowCanContinue: false,
      currentIteration: 3,
      maxIterations: 8,
      previousActions: [
        { actionType: 'NAVIGATE', result: 'success' },
        { actionType: 'CLICK', result: 'failure' },
      ],
      invalidActionDecision: false,
    });
    assert(r.terminationReason === 'ACTION_FAILED', 'Caso 7 (regresión): un fallo real de acción sigue clasificándose ACTION_FAILED, no INVALID_ACTION_DECISION, cuando invalidActionDecision=false');
  }

  console.log('\n--- P1.2.2: EXPLORATION_ERROR (catch externo) — límite de lo probable sin integración completa ---');
  // 5 y 6 (excepción general de repositorio / de inicialización): el valor
  // `terminationReason: 'EXPLORATION_ERROR'` del catch externo de
  // `runEvaluation` está hardcodeado en código no exportado (el catch de un
  // método privado) -- no es una función pura invocable de forma aislada,
  // y ejercitarlo de verdad requeriría una sesión de navegador real o una
  // refactorización amplia del método privado, fuera del alcance
  // autorizado. NO se declara cobertura de este camino: se verificó
  // ÚNICAMENTE por lectura directa del código (evaluation.service.ts, el
  // bloque `catch (error: any)` tras el `while`), confirmando que
  // `terminationReason: 'EXPLORATION_ERROR'` se asigna de forma
  // incondicional ahí, sin depender de si el error se originó en una
  // acción de Playwright.
  console.log('  ℹ️  NO CUBIERTO POR TEST: requiere ejecutar runEvaluation real (sesión de navegador). Verificado solo por lectura de código.');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
