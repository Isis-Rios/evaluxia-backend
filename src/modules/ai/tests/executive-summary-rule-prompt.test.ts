import { aiService } from '../ai.service';

/**
 * Suite determinística de verificación de la "EXECUTIVE SUMMARY RULE" añadida
 * al prompt de auditoría WEB (`buildV2AuditPrompt`), motivada por la
 * divergencia real encontrada en la evaluación OpenCart
 * `6af7abf68f4fa0cf33ec332a` (dos hallazgos PASS narrados como problemas en
 * el resumen; tres FAIL reales de WCAG 1.4.3 omitidos).
 *
 * IMPORTANTE -- qué demuestra esta suite y qué NO demuestra:
 * Demuestra que el TEXTO de la instrucción está presente, en el lugar
 * correcto del prompt, y que el resto del prompt WEB (reglas previas,
 * estructura JSON) no se alteró, y que el prompt de PROTOTIPOS (que ya tenía
 * su propia regla equivalente) tampoco sufrió ninguna regresión.
 * NO demuestra, ni puede demostrar sin una llamada real a Gemini, que el
 * modelo vaya a obedecer esta instrucción de forma consistente -- la
 * coherencia semántica real del resumen frente a los hallazgos solo puede
 * confirmarse con una evaluación WEB real posterior (fuera del alcance de
 * esta suite, que es puramente de presencia/estructura de texto).
 *
 * Cero llamadas reales a Gemini, cero consumo de créditos, cero MongoDB.
 */
function assert(condition: boolean, msg: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    if (detail !== undefined) console.error('     detail:', detail);
    process.exit(1);
  }
}

function runTests() {
  console.log('🧪 Iniciando pruebas de la EXECUTIVE SUMMARY RULE (prompt WEB)...\n');

  const mockV2AuditInput: any = {
    evaluationId: 'test-eval-exec-summary-rule',
    title: 'Evaluación de prueba',
    url: 'https://example.com',
    archetype: {
      fullName: 'Laura Martínez',
      archetype: 'El amigo',
      profession: 'Administradora de empresas',
      phrase: 'Quiero terminar mi tarea rápido y sin complicaciones.',
      goals: ['Completar tareas rápidamente'],
      frustrations: ['Formularios largos'],
    },
    completedSteps: ['Navegar a la URL objetivo'],
    previousActions: [{ actionType: 'NAVIGATE', description: 'Navegar a https://example.com', result: 'success' }],
    snapshotsCount: 1,
    evidencesSummary: [],
  };

  const webPrompt: string = (aiService as any).buildV2AuditPrompt(mockV2AuditInput);

  // -----------------------------------------------------------------
  // 1. La sección existe, en el lugar esperado (antes de la estructura JSON).
  // -----------------------------------------------------------------
  console.log('--- 1. La sección "EXECUTIVE SUMMARY RULE" existe en el prompt WEB ---');
  {
    assert(webPrompt.includes('### EXECUTIVE SUMMARY RULE:'), 'El prompt WEB contiene el encabezado de la nueva regla');
    const ruleIndex = webPrompt.indexOf('### EXECUTIVE SUMMARY RULE:');
    const jsonStructureIndex = webPrompt.indexOf('Respond ONLY with valid JSON matching this exact structure:');
    assert(ruleIndex !== -1 && jsonStructureIndex !== -1 && ruleIndex < jsonStructureIndex, 'La regla aparece ANTES de la estructura JSON de respuesta (mismo patrón que el prompt de prototipos)');
  }

  // -----------------------------------------------------------------
  // 2. Cubre los 6 puntos exigidos (verificación de presencia textual, no de
  // comprensión semántica del modelo -- ver docstring del archivo).
  // -----------------------------------------------------------------
  console.log('\n--- 2. La regla cubre los 6 requisitos exigidos (presencia textual) ---');
  {
    assert(/ONLY when the corresponding finding's 'status' is "FAIL"/.test(webPrompt), 'Punto 1: un problema confirmado exige status FAIL');
    assert(/"PASS".+finding must NEVER be described.+as a violation, non-compliance, incumplimiento, or confirmed issue/.test(webPrompt), 'Punto 2: un PASS nunca se describe como incumplimiento/violación');
    assert(/"NOT_EVALUABLE".+must NEVER be presented as a confirmed, demonstrated problem/.test(webPrompt), 'Punto 3: un NOT_EVALUABLE nunca se presenta como problema confirmado');
    assert(/keep it explicitly and visibly separate from confirmed non-compliances/.test(webPrompt), 'Punto 4: oportunidades de mejora sin FAIL deben diferenciarse de incumplimientos confirmados');
    assert(/Do not selectively omit the "FAIL" findings/.test(webPrompt), 'Punto 5: no omitir selectivamente los FAIL reales');
    assert(/Do not invent criteria, evidence, affected elements, or non-compliances/.test(webPrompt), 'Punto 6: prohibición explícita de inventar criterios/evidencia/elementos/incumplimientos');
    assert(/Keep the summary concise, clear, and useful/.test(webPrompt), 'Punto 7: redacción concisa, clara y útil preservada como requisito');
  }

  // -----------------------------------------------------------------
  // 3. Regresión: el resto del prompt WEB (reglas previas y estructura JSON)
  // no se alteró.
  // -----------------------------------------------------------------
  console.log('\n--- 3. Regresión: el prompt WEB conserva sus instrucciones y estructura previas ---');
  {
    assert(webPrompt.includes('### ABSOLUTE AUDIT RULE: NO EVIDENCE = NO FAIL'), 'La regla de evidencia obligatoria para FAIL sigue presente, sin cambios');
    assert(webPrompt.includes('N-08 (Diseño estético y minimalista / CRI-18)'), 'La calibración de N-08 (heredada de la calibración previa) sigue presente');
    assert(webPrompt.includes('WCAG 1.3.1 (Heading Structure and Multiple H1 Elements)'), 'La calibración de WCAG 1.3.1 (múltiples H1) sigue presente');
    assert(webPrompt.includes('"findings": ['), 'La estructura JSON de salida (findings) sigue presente');
    assert(webPrompt.includes('"overallScore": <number 0-100>'), 'La estructura JSON de salida (overallScore) sigue presente');
  }

  // -----------------------------------------------------------------
  // 4. El prompt de PROTOTIPOS no presenta regresiones -- no fue tocado en
  // esta corrección, y conserva su propia EXECUTIVE SUMMARY RULE previa.
  // -----------------------------------------------------------------
  console.log('\n--- 4. El prompt de PROTOTIPOS no presenta regresiones ---');
  {
    const { resolveApplicablePrototypeCriteria } = require('@/modules/evaluations/services/prototype-criteria-resolver');
    const applicableCriteria = resolveApplicablePrototypeCriteria();
    const mockPrototypeInput: any = {
      title: 'Prototipo de prueba',
      description: 'Prototipo de pantalla de contacto',
      archetype: {
        fullName: 'Laura Martínez',
        archetype: 'El amigo',
        profession: 'Administradora de empresas',
        phrase: 'Quiero terminar mi tarea rápido y sin complicaciones.',
        age: 32,
        biography: 'Usuaria con conocimientos tecnológicos intermedios.',
        goals: ['Completar tareas rápidamente'],
        frustrations: ['Formularios largos'],
        techSavviness: 'medium',
        accessibilityNeeds: [],
        preferredDevice: 'desktop',
      },
    };
    const prototypePrompt: string = (aiService as any).buildPrototypeAuditPrompt(mockPrototypeInput, applicableCriteria);

    assert(
      prototypePrompt.includes(
        "Your 'executiveSummary' MUST be consistent with the 'status' of your own findings",
      ),
      'El prompt de PROTOTIPOS conserva textualmente su propia EXECUTIVE SUMMARY RULE previa, sin cambios',
    );
    assert(
      !prototypePrompt.includes('### EXECUTIVE SUMMARY RULE:\nYour \'executiveSummary\' MUST be strictly consistent with the \'status\' of the \'findings\' you are producing in this SAME response'),
      'El prompt de PROTOTIPOS NO recibió la redacción nueva del prompt WEB (son reglas independientes, adaptadas a cada contexto)',
    );
  }

  console.log('\n✅ EXECUTIVE SUMMARY RULE: todas las pruebas de presencia/estructura superadas.\n');
  console.log('🎉 Resultado: 100% presencia/estructura verificada. La obediencia semántica del modelo requiere validación con una evaluación WEB real.');
  process.exit(0);
}

runTests();
