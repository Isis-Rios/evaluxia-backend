import {
  applyActionOutcomeToCompletedSteps,
  finalizeCompletedSteps,
  resolveActionOutcome,
  CompletedStepsTrackerState,
} from '../evaluation.service';

/**
 * P1.6.2 Parte B — reproduce el defecto confirmado en la auditoría
 * post-piloto P1.6.1 (evaluación real `6ae53c5ac54be00390d0ca8f`):
 * `previousActions` tenía 5 acciones (1 NAVIGATE + 4 CLICK, todas
 * exitosas), pero `completedSteps` nunca nombraba el objetivo propio del
 * último CLICK ("Launch Live Preview") -- su etiqueta quedaba calculada
 * (`nextObjective`) pero nunca empujada, porque el bucle terminó
 * (MAX_ITERATIONS_REACHED) antes de que una iteración siguiente la
 * consumiera.
 */
function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error(`❌ ${label}`);
    console.error('   expected:', JSON.stringify(expected));
    console.error('   actual:  ', JSON.stringify(actual));
    process.exit(1);
  }
  console.log(`✅ ${label}`);
}

function action(selector: string) {
  return { actionType: 'CLICK', rationale: `Click ${selector}`, targetElement: { value: selector } };
}

function runTests(): void {
  console.log('🧪 Starting completedSteps tracker (P1.6.2 Parte B) tests...');

  // ── Caso 1: reproducción exacta del piloto real -- 4 CLICK exitosos,
  //    el bucle termina justo después del último (MAX_ITERATIONS_REACHED).
  {
    let state: CompletedStepsTrackerState = {
      completedSteps: [],
      currentObjective: 'Navegar e iniciar exploración',
      hasUnrecordedCompletedStep: false,
    };

    const selectors = [
      'a:nth-of-type(2)',
      'div:nth-of-type(1) > a',
      'div:nth-of-type(2) > div:nth-of-type(3) > div > a',
      'a.launch-live-preview', // el CLICK real que faltaba, "Launch Live Preview"
    ];

    for (const selector of selectors) {
      const outcome = resolveActionOutcome({ success: true }, action(selector), state.currentObjective);
      state = applyActionOutcomeToCompletedSteps(state, outcome);
    }

    // Cada `completedStep` empujado describe el objetivo ACTIVO cuando esa
    // acción se decidió (el target del CLICK ANTERIOR) -- por eso, tras los
    // 4 CLICK, ya hay 4 entradas (una por cada outcome), pero NINGUNA de
    // ellas nombra todavía el propio target del 4º CLICK
    // ("a.launch-live-preview") -- esa etiqueta (`nextObjective` del 4º
    // CLICK) es precisamente la que queda pendiente sin consumir, igual que
    // en el piloto real (5 acciones totales -- 1 NAVIGATE + 4 CLICK -- pero
    // ninguna entrada de `completedSteps` nombraba "Launch Live Preview").
    assertEqual(state.completedSteps.length, 4, 'Tras los 4 CLICK, hay 4 entradas registradas (una por cada outcome), reproduciendo el piloto real');
    assertEqual(state.hasUnrecordedCompletedStep, true, 'El objetivo propio del 4º CLICK ("a.launch-live-preview") queda pendiente sin registrar -- el defecto confirmado en P1.6.1');

    const finalSteps = finalizeCompletedSteps(state);
    assertEqual(finalSteps.length, 5, 'finalizeCompletedSteps() añade la etiqueta pendiente del último CLICK -- ahora las 5 acciones reales quedan representadas, no solo 4');
    assertEqual(
      finalSteps[4],
      'Después de realizar CLICK en a.launch-live-preview',
      'La etiqueta añadida al final nombra el PROPIO target del 4º CLICK ("Launch Live Preview") -- antes del fix, ningún lugar de completedSteps mencionaba este elemento',
    );
  }

  // ── Caso 2: ninguna acción tuvo éxito nunca -- no debe inventarse
  //    ninguna entrada adicional al finalizar.
  {
    const state: CompletedStepsTrackerState = {
      completedSteps: [],
      currentObjective: 'Navegar e iniciar exploración',
      hasUnrecordedCompletedStep: false,
    };
    const finalSteps = finalizeCompletedSteps(state);
    assertEqual(finalSteps, [], 'Sin ninguna acción exitosa, finalizeCompletedSteps() no añade nada (no hay nada pendiente que registrar)');
  }

  // ── Caso 3: la última acción registrada fue un FALLO después de una
  //    acción exitosa previa -- la etiqueta de la acción exitosa anterior
  //    (genuinamente pendiente) SÍ debe registrarse; un fallo nunca
  //    "limpia" lo que ya estaba pendiente.
  {
    let state: CompletedStepsTrackerState = {
      completedSteps: [],
      currentObjective: 'Navegar e iniciar exploración',
      hasUnrecordedCompletedStep: false,
    };
    const successOutcome = resolveActionOutcome({ success: true }, action('#ok'), state.currentObjective);
    state = applyActionOutcomeToCompletedSteps(state, successOutcome);
    assertEqual(state.hasUnrecordedCompletedStep, true, 'Tras el CLICK exitoso, queda pendiente');
    const countAfterSuccess = state.completedSteps.length;

    const failureOutcome = resolveActionOutcome({ success: false, error: 'Timeout' }, action('#missing'), state.currentObjective);
    state = applyActionOutcomeToCompletedSteps(state, failureOutcome);
    assertEqual(state.completedSteps.length, countAfterSuccess, 'El fallo no añade ninguna entrada nueva (el conteo no cambia respecto al éxito anterior)');
    assertEqual(state.hasUnrecordedCompletedStep, true, 'El fallo NO limpia la bandera de pendiente -- la acción exitosa anterior sigue sin registrar');

    const finalSteps = finalizeCompletedSteps(state);
    assertEqual(finalSteps.length, countAfterSuccess + 1, 'finalizeCompletedSteps() SÍ registra la etiqueta pendiente de la acción exitosa anterior, aunque la última acción haya fallado');
  }

  // ── Caso 4: no duplicar -- llamar finalizeCompletedSteps() sobre un
  //    estado YA finalizado (hasUnrecordedCompletedStep ya en false) no
  //    debe añadir nada de nuevo.
  {
    let state: CompletedStepsTrackerState = {
      completedSteps: [],
      currentObjective: 'Navegar e iniciar exploración',
      hasUnrecordedCompletedStep: false,
    };
    const outcome = resolveActionOutcome({ success: true }, action('#ok'), state.currentObjective);
    state = applyActionOutcomeToCompletedSteps(state, outcome);
    const finalSteps = finalizeCompletedSteps(state);
    assertEqual(finalSteps.length, 2, 'Primera finalización: el objetivo inicial ya registrado + la etiqueta pendiente del CLICK = 2 entradas');

    // Simula el flujo real: tras finalizar, el código reasigna
    // `completedSteps = finalSteps`, pero NUNCA reinicia
    // `hasUnrecordedCompletedStep` por separado -- se confirma aquí que una
    // segunda llamada con el mismo `hasUnrecordedCompletedStep: true` SÍ
    // volvería a duplicar (documentando que `finalizeCompletedSteps()` se
    // llama una ÚNICA vez por evaluación, nunca dentro del bucle).
    const finalStepsAgain = finalizeCompletedSteps({ ...state, completedSteps: finalSteps });
    assertEqual(finalStepsAgain.length, 3, 'DOCUMENTADO (no un bug): llamar finalizeCompletedSteps() dos veces sobre el mismo estado pendiente SÍ duplica -- por eso runEvaluation la invoca una sola vez, justo al salir del bucle, nunca dentro de él');
  }

  // ── Caso 5: múltiples acciones exitosas consecutivas -- la secuencia
  //    completa de etiquetas sigue siendo exactamente la que el código
  //    anterior ya producía para las N-1 primeras (regresión: el fix no
  //    cambia nada del comportamiento histórico para pasos intermedios).
  {
    let state: CompletedStepsTrackerState = {
      completedSteps: [],
      currentObjective: 'Navegar e iniciar exploración',
      hasUnrecordedCompletedStep: false,
    };
    for (const selector of ['#a', '#b', '#c']) {
      const outcome = resolveActionOutcome({ success: true }, action(selector), state.currentObjective);
      state = applyActionOutcomeToCompletedSteps(state, outcome);
    }
    assertEqual(
      state.completedSteps,
      ['Navegar e iniciar exploración', 'Después de realizar CLICK en #a', 'Después de realizar CLICK en #b'],
      'Las etiquetas de los pasos intermedios son EXACTAMENTE las mismas que el código anterior a P1.6.2 ya producía (regresión histórica preservada)',
    );
  }

  console.log('🎉 All completedSteps tracker (P1.6.2 Parte B) tests passed successfully!');
  process.exit(0);
}

runTests();
