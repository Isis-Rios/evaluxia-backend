import { stubGeminiJsonResponses, stubGeminiResponsesWithUsage } from '@/shared/testing/gemini-mock-harness';
import { aiService } from '@/modules/ai/ai.service';
import { buildValidPrototypeAuditOutputJson } from '@/shared/testing/prototype-gemini-mock-harness';

/**
 * P2 — Gemini multimodal, SOLO MOCK. Cero llamadas reales: ambos stubs
 * reutilizados aquí (`stubGeminiJsonResponses`/`stubGeminiResponsesWithUsage`)
 * interceptan `client.models.generateContent` directamente, exactamente
 * igual que para el pipeline WEB -- nada en este archivo contacta la red.
 */
async function runTests() {
  console.log('🧪 Starting Prototype Multimodal (P2, MOCK ONLY) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const baseInput = {
    evaluationId: 'proto-p2',
    title: 'Prototipo de prueba',
    description: 'Pantalla de login ficticia con un botón de acceso.',
    archetype: {
      fullName: 'Perfil Mock', archetype: 'El Explorador', profession: 'QA', phrase: 'frase',
      goals: ['entrar'], frustrations: ['confusión'], techSavviness: 'medium', accessibilityNeeds: [],
      preferredDevice: 'desktop',
    },
    imageMimeType: 'image/png',
    imageBase64: 'ZmFrZS1iYXNlNjQtcGF5bG9hZA==',
  };

  // 1. Llamada exitosa -- valida prompt/output schema/usage end-to-end
  const stub1 = stubGeminiJsonResponses([
    buildValidPrototypeAuditOutputJson([
      {
        findingGroup: 'ux',
        status: 'FAIL',
        severity: 'medium',
        confidence: 'high',
        heuristicCode: 'N-04',
        heuristicName: 'Consistencia y estándares',
        description: 'El botón principal usa un estilo distinto al resto de la pantalla.',
        evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón de acceso', property: 'visibleText', value: 'Entrar' }],
        affectedElement: { visualReference: { description: 'botón de acceso', region: 'center' } },
        recommendation: 'Unificar el estilo visual de los botones principales.',
      },
    ]),
  ]);
  try {
    const result = await aiService.performPrototypeAuditAnalysis(baseInput as any);
    assert(stub1.callCount() === 1, 'Exactamente 1 llamada (mockeada) a generateContent');
    assert(result.result.findings.length === 1, 'El resultado contiene el finding esperado, parseado y validado contra PrototypeAuditOutputSchema');
    assert(result.usage.promptTokens >= 0, 'usage.promptTokens está presente (estimado localmente, sin usageMetadata real en este stub)');
  } finally {
    stub1.restore();
  }

  // 2. Verifica que el PROMPT construido nunca referencia selector/tag/DOM
  const capturedPrompt = (aiService as any).buildPrototypeAuditPrompt(
    { ...baseInput, archetype: { ...baseInput.archetype, biography: 'Bio larga '.repeat(100) } },
    [{ code: 'WCAG 2.4.6', name: 'Encabezados y etiquetas', framework: 'WCAG', coverage: 'DIRECTLY_EVALUABLE', note: 'nota' }],
  );
  assert(typeof capturedPrompt === 'string' && capturedPrompt.length > 0, 'buildPrototypeAuditPrompt produce un prompt de texto');
  assert(capturedPrompt.includes("Do NOT include a 'selector'"), 'El prompt prohíbe explícitamente inventar un selector/tag/DOM-only field');
  assert(capturedPrompt.includes('VISUAL_OBSERVATION'), 'El prompt exige type="VISUAL_OBSERVATION" en la evidencia');
  assert(capturedPrompt.includes('WCAG 2.4.6'), 'El prompt incluye solo los criterios aplicables pasados (nunca todos)');
  assert(!capturedPromptContainsOutOfCoverage(capturedPrompt), 'El prompt NUNCA menciona un criterio OUT_OF_COVERAGE (ej. WCAG 4.1.2/2.1.1) cuando no se pasó en la lista aplicable');
  // P1.6.4: el umbral se amplió de 12000 a 16000 para absorber las nuevas
  // reglas DYNAMIC/INTERACTIVE BEHAVIOR y EXECUTIVE SUMMARY (contenido
  // metodológico legítimo, no relleno).
  // P1.6.5.1: ampliado de nuevo a 19000 para absorber la nueva sección
  // CONFIDENCE AND SEVERITY CALIBRATION RULE -- sigue siendo un techo real,
  // no un valor vaciado de sentido: con biography truncada + 1 solo
  // criterio aplicable, el prompt real mide ~17200 caracteres.
  // P1.6.6.3: ampliado a 25000 para absorber la nueva sección POSITIVE
  // COMPLIANCE RULE (contenido metodológico legítimo -- las 7 precisiones
  // específicas por criterio son las que más caracteres añaden): con
  // biography truncada + 1 solo criterio aplicable, el prompt real mide
  // ~24100 caracteres.
  // P1.6.6.7: el umbral de 25000 se mantiene sin cambios -- el refuerzo
  // simétrico (PASS+FAIL) de las precisiones de 1.1.1/1.3.1/1.4.3/2.4.4/
  // 3.3.2 añadió contenido, pero el prompt real medido con este mismo
  // fixture sigue en ~23400 caracteres, dentro del techo ya aprobado.
  assert(capturedPrompt.length < 25000, 'El prompt permanece compacto incluso con biography presente (truncada a MAX_BIOGRAPHY_CHARS_IN_PROMPT)');

  // 2a-bis. [P1.6.6.3] POSITIVE COMPLIANCE RULE -- habilita PASS con evidencia
  // estructurada positiva, prohibiendo explícitamente un PASS fabricado por
  // mera ausencia de problemas.
  assert(capturedPrompt.includes('### POSITIVE COMPLIANCE RULE'), 'El prompt incluye la nueva sección POSITIVE COMPLIANCE RULE');
  assert(
    capturedPrompt.indexOf('### ABSTENTION RULE') < capturedPrompt.indexOf('### POSITIVE COMPLIANCE RULE') &&
    capturedPrompt.indexOf('### POSITIVE COMPLIANCE RULE') < capturedPrompt.indexOf('### DYNAMIC / INTERACTIVE BEHAVIOR RULE'),
    'POSITIVE COMPLIANCE RULE aparece exactamente entre ABSTENTION RULE y DYNAMIC / INTERACTIVE BEHAVIOR RULE, sin desplazar ninguna regla existente',
  );
  assert(
    capturedPrompt.includes('NOT finding evidence of a violation is NOT the same as finding evidence of compliance'),
    'El prompt prohíbe explícitamente fabricar PASS por mera ausencia de problemas (regla fundamental del encargo)',
  );
  assert(
    capturedPrompt.includes('Do not aim for a minimum number of PASS findings') && capturedPrompt.includes('do not treat a higher PASS count as a better outcome'),
    'El prompt prohíbe explícitamente perseguir una cantidad mínima o premiar un mayor número de PASS',
  );
  assert(
    capturedPrompt.includes('STRUCTURED EVIDENCE IS MANDATORY') && capturedPrompt.includes("MUST include at least one evidence item that has, in\n   the SAME item"),
    'El prompt exige evidencia estructurada (property+value en el MISMO ítem) como condición obligatoria para PASS',
  );
  assert(
    capturedPrompt.includes("do NOT count together") || capturedPrompt.includes('do NOT count together'),
    'El prompt aclara explícitamente que property y value en ítems distintos no cuentan como evidencia estructurada conjunta',
  );
  assert(
    capturedPrompt.includes('NARROW SCOPE') && capturedPrompt.includes('never generalize to the full criterion'),
    'El prompt restringe explícitamente el alcance de un PASS al aspecto visual verificado, nunca al criterio completo',
  );
  assert(
    capturedPrompt.includes('VISUAL VS. NON-VISUAL DIMENSIONS'),
    'El prompt incluye la distinción explícita entre la dimensión visual observable y la dimensión semántica/programática/comportamental no observable',
  );
  assert(
    capturedPrompt.includes('WCAG 1.1.1: visible text next to a non-text element does NOT by itself demonstrate') &&
    capturedPrompt.includes('WCAG 1.3.1: a correct VISUAL hierarchy does NOT demonstrate') &&
    capturedPrompt.includes('WCAG 1.4.3: a qualitative visual impression of contrast does NOT demonstrate') &&
    capturedPrompt.includes('WCAG 2.4.4: a generic-sounding link text is NOT automatically a violation') &&
    capturedPrompt.includes('WCAG 3.3.2: a label\'s visual proximity to a field does NOT demonstrate') &&
    capturedPrompt.includes('N-03: not observing an exit/cancel control') &&
    capturedPrompt.includes('N-05: the absence of a visible error-prevention indicator does NOT demonstrate'),
    'El prompt incluye las 7 precisiones específicas por criterio exigidas (1.1.1, 1.3.1, 1.4.3, 2.4.4, 3.3.2, N-03, N-05)',
  );
  assert(
    // P1.6.6.7 -- el texto original de P1.6.5.1/P1.6.6.3 solo cubría PASS
    // explícitamente ("exactly like its FAIL counterpart" lo mencionaba de
    // pasada); se reforzó a una redacción simétrica explícita (PASS y FAIL
    // por igual) para alinear el prompt con la nueva Gate Rule V5
    // (determinística, degrada ambos a NOT_EVALUABLE para WCAG 1.4.3).
    capturedPrompt.includes('neither a "PASS" nor a "FAIL" built on a qualitative contrast') &&
    capturedPrompt.includes('conformity, and neither may ever be assigned "high" confidence.'),
    'El prompt exige la calibración de confianza para contraste cualitativo de forma SIMÉTRICA (ni PASS ni FAIL de WCAG 1.4.3 puede llevar confidence "high")',
  );

  // 2b. [P7.3.3] Nuevas reglas 6-8 de VISUAL EVIDENCE RULES -- instruyen citar
  // property+value (incluyendo value:"" para ausencias) cuando sea
  // genuinamente observable, sin forzarlo, y sin permitir que la ausencia de
  // texto visible se use como prueba de algo invisible (DOM/teclado/
  // comportamiento/tecnología asistiva).
  assert(capturedPrompt.includes('value: "" (empty string)'), 'El prompt instruye explícitamente el uso de value:"" para documentar una ausencia de texto visible');
  assert(capturedPrompt.includes('Do NOT force a property/value pair'), 'El prompt prohíbe explícitamente forzar property/value cuando no hay una representación fiel');
  assert(capturedPrompt.includes('NEVER proves') && capturedPrompt.includes('DOM accessible name'), 'El prompt prohíbe explícitamente interpretar una ausencia visual como prueba de ausencia de nombre accesible en el DOM');
  assert(capturedPrompt.includes('keyboard/focus problem') && capturedPrompt.includes('assistive technology'), 'El prompt prohíbe explícitamente inferir problemas de teclado/foco o de tecnología asistiva desde una observación visual');

  // 2c. [P7.4.1] CRITERION ASSIGNMENT RULE -- Objetivo A: un criterio
  // principal por finding, separación justificada en 2 findings cuando
  // corresponda, sin duplicar para multiplicar criterios.
  assert(capturedPrompt.includes('### CRITERION ASSIGNMENT RULE'), 'El prompt incluye la nueva sección CRITERION ASSIGNMENT RULE');
  assert(capturedPrompt.includes('EXACTLY ONE principal criterion') && capturedPrompt.includes('NEVER both on the same finding object'), 'El prompt exige exactamente un criterio principal por finding (Nielsen XOR WCAG, nunca ambos)');
  assert(capturedPrompt.includes('emit TWO SEPARATE findings'), 'El prompt instruye emitir 2 findings separados cuando ambas clasificaciones estén genuinamente sustentadas');
  assert(capturedPrompt.includes('Do NOT emit a second') && capturedPrompt.includes('finding for a criterion that is merely related, plausible, or inferable'), 'El prompt prohíbe explícitamente duplicar hallazgos solo para multiplicar criterios sin sustento independiente');

  // 2d. [P7.4.1] Objetivo B: no forzar WCAG 1.1.1 para ausencia de texto
  // visible -- preferir el criterio de usabilidad (Nielsen) que sí encaja
  // con lo observable.
  assert(capturedPrompt.includes('Do NOT force a WCAG classification when the image only supports a usability/visual-clarity observation'), 'El prompt prohíbe explícitamente forzar una clasificación WCAG cuando solo hay sustento de usabilidad visual');
  assert(capturedPrompt.includes('prefer the') && capturedPrompt.includes('applicable Nielsen usability criteria that address recognizability') && capturedPrompt.includes('over WCAG 1.1.1'), 'El prompt redirige explícitamente hacia Nielsen (N-02/N-06) en vez de WCAG 1.1.1 para controles icon-only sin texto visible');

  // 2e. [P7.4.1] Confirma que las reglas nuevas NO contradicen las reglas
  // existentes de evidencia/abstención/cobertura (coexistencia textual, no
  // solo ausencia de errores de build).
  assert(capturedPrompt.indexOf('### CRITERION ASSIGNMENT RULE') < capturedPrompt.indexOf('### VISUAL EVIDENCE RULES'), 'CRITERION ASSIGNMENT RULE aparece ANTES de VISUAL EVIDENCE RULES -- el modelo decide el criterio antes de estructurar su evidencia, sin reordenar ni remover ninguna regla existente');
  assert(capturedPrompt.includes('### ABSTENTION RULE') && capturedPrompt.includes('### CONTRAST RULE') && capturedPrompt.includes('### IDENTITY RULE'), 'Las secciones existentes (abstención, contraste, identidad) permanecen intactas junto a la nueva sección');

  // 3. Usage real (con usageMetadata simulado) — confirma extracción de tokens
  const stub2 = stubGeminiResponsesWithUsage([
    {
      text: buildValidPrototypeAuditOutputJson([]),
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 120, totalTokenCount: 620, thoughtsTokenCount: 30 },
    },
  ]);
  try {
    const result2 = await aiService.performPrototypeAuditAnalysis(baseInput as any);
    assert(result2.usage.promptTokens === 500 && result2.usage.outputTokens === 120, 'usage real extraído correctamente del usageMetadata simulado del SDK');
    assert(result2.usage.thinkingTokens === 30, 'thinkingTokens (J3) también se extrae para la llamada multimodal, igual que para WEB');
  } finally {
    stub2.restore();
  }

  // 4. Retry ante una primera respuesta inválida (reutiliza el mismo mecanismo de retry que WEB)
  const stub3 = stubGeminiJsonResponses([
    'esto no es JSON válido',
    buildValidPrototypeAuditOutputJson([]),
  ]);
  try {
    const result3 = await aiService.performPrototypeAuditAnalysis(baseInput as any);
    assert(stub3.callCount() === 2, 'Se reintentó exactamente 1 vez tras una respuesta JSON inválida (mismo mecanismo de retry de GeminiClient, reutilizado)');
    assert(result3.result.findings.length === 0, 'El resultado final proviene de la respuesta válida (segundo intento)');
  } finally {
    stub3.restore();
  }

  // 5. [P7.0.1] COST CONTROL -- retryOpts:{maxRetries:0} (exclusivo del
  // runner del experimento real) impide CUALQUIER segundo intento físico,
  // incluso ante una primera respuesta inválida que SÍ se reintentaría con
  // la política global (ver test 4 arriba, mismo escenario, sin el
  // override). Confirma que el override es efectivo y que, al omitirlo
  // (como hacen todos los demás llamadores, incluido PrototypeEvaluationService
  // en producción), el comportamiento NO cambia (test 4 sigue en 2 intentos).
  const stub4 = stubGeminiJsonResponses([
    'esto tampoco es JSON válido',
    buildValidPrototypeAuditOutputJson([]),
  ]);
  try {
    let threw = false;
    try {
      await aiService.performPrototypeAuditAnalysis(baseInput as any, { maxRetries: 0 });
    } catch {
      threw = true;
    }
    assert(threw, 'Con maxRetries:0, una primera respuesta inválida se propaga como error en vez de reintentarse');
    assert(stub4.callCount() === 1, 'Con maxRetries:0, NUNCA ocurre un segundo intento físico (callCount permanece en 1, aunque existía una segunda respuesta válida disponible para servir)');
  } finally {
    stub4.restore();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

function capturedPromptContainsOutOfCoverage(prompt: string): boolean {
  return prompt.includes('WCAG 4.1.2') || prompt.includes('WCAG 2.1.1');
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
