import { buildVerifiedResultsSection, composeVerifiedSummary } from '../services/verified-summary-builder';
import { ConsolidatedFinding } from '../services/audit-metrics.service';

/**
 * Suite determinística del cierre de inconsistencia del resumen ejecutivo
 * (auditoría post-fix CLICK→CLICK, 2026-11-14): verifica que la sección
 * "RESULTADOS VERIFICADOS POR EVALUXIA" se construye exclusivamente desde
 * `ConsolidatedFinding[]` (el mismo arreglo usado para las métricas del
 * Report), nunca desde el texto narrativo de Gemini, y que ambos bloques
 * quedan explícitamente diferenciados y sin contradicción posible.
 *
 * Cero llamadas a Gemini, cero red, cero MongoDB.
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

function makeFinding(overrides: Partial<ConsolidatedFinding> = {}): ConsolidatedFinding {
  return {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'Descripción de prueba.',
    iteration: 1,
    observedIterations: [1],
    screenshotUrls: [],
    ...overrides,
  } as ConsolidatedFinding;
}

function runTests() {
  console.log('🧪 Cierre de inconsistencia del resumen ejecutivo (verified-summary-builder) — pruebas\n');

  // -----------------------------------------------------------------
  // 1. Caso real OpenCart (6af7c107d95c2b6563ab8705) reproducido con las
  // cantidades exactas: 3 FAIL high, 1 NOT_EVALUABLE high, 1 NOT_EVALUABLE
  // medium, 232 PASS info, 2 NOT_EVALUABLE info. El resumen narrativo de
  // prueba describe deliberadamente contradicciones (un NOT_EVALUABLE como
  // confirmado, omite los FAIL reales) -- la sección verificada debe seguir
  // siendo correcta y quedar claramente diferenciada.
  // -----------------------------------------------------------------
  console.log('--- 1. Caso real OpenCart (cantidades exactas) con narrativa contradictoria ---');
  {
    const failFindings: ConsolidatedFinding[] = [
      makeFinding({ status: 'FAIL', severity: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'Contraste insuficiente de 1.37:1 en "Apparel".', affectedElement: { tag: 'a', text: 'Apparel' } as any, recommendation: 'Ajustar el color del texto o del fondo.' }),
      makeFinding({ status: 'FAIL', severity: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'Contraste insuficiente de 1.33:1 en "Audio".', affectedElement: { tag: 'a', text: 'Audio' } as any, recommendation: 'Ajustar el color del texto o del fondo.' }),
      makeFinding({ status: 'FAIL', severity: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'Contraste insuficiente de 1.38:1 en "Home".', affectedElement: { tag: 'a', text: 'Home' } as any, recommendation: 'Ajustar el color del texto o del fondo.' }),
    ];
    const notEvaluableFindings: ConsolidatedFinding[] = [
      makeFinding({ status: 'NOT_EVALUABLE', severity: 'high', heuristicCode: 'N-04', wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas', description: 'Contradicción de reseñas: "No reviews yet" vs. 142 reseñas con 4.7.' }),
      makeFinding({ status: 'NOT_EVALUABLE', severity: 'medium', wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor', description: 'Landmark aria-label="Previous" contiene solo un enlace "Next".' }),
      makeFinding({ status: 'NOT_EVALUABLE', severity: 'info', wcagCriterion: 'WCAG 1.3.1 Información y relaciones', description: 'Jerarquía visual no determinable con certeza.' }),
      makeFinding({ status: 'NOT_EVALUABLE', severity: 'info', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'Contraste de placeholder no determinable con certeza.' }),
    ];
    const passFindings: ConsolidatedFinding[] = [];
    const passCriteria = [
      ['WCAG 2.4.4 Propósito de los enlaces', 96],
      ['WCAG 4.1.2 Nombre, función y valor', 60],
      ['WCAG 1.1.1 Contenido no textual', 38],
      ['WCAG 1.4.3 Contraste (Mínimo)', 31],
      ['WCAG 3.3.2 Etiquetas o instrucciones', 7],
    ] as const;
    for (const [criterion, count] of passCriteria) {
      for (let i = 0; i < count; i++) {
        passFindings.push(makeFinding({ status: 'PASS', severity: 'info', wcagCriterion: criterion, description: `Elemento conforme #${i + 1}.` }));
      }
    }
    assert(passFindings.length === 232, 'Fixture de prueba: 232 PASS construidos correctamente', passFindings.length);

    const allFindings = [...failFindings, ...notEvaluableFindings, ...passFindings];
    assert(allFindings.length === 239, 'Fixture de prueba: 239 hallazgos totales (coincide con la evaluación real)', allFindings.length);

    const contradictoryAiNarrative =
      'La sesión demostró un nivel excepcional de conformidad. Incumplimientos confirmados: ' +
      '(1) Contradicción de contenido en reseñas (N-04/WCAG 2.4.6). ' +
      '(2) Etiqueta ARIA discordante en navegación (WCAG 4.1.2).';

    const verifiedSection = buildVerifiedResultsSection(allFindings);
    const finalSummary = composeVerifiedSummary(verifiedSection, contradictoryAiNarrative);

    // Los 3 FAIL reales SÍ aparecen, con su criterio y descripción real.
    assert(verifiedSection.includes('Incumplimientos confirmados (FAIL)'), 'Incluye el encabezado de incumplimientos confirmados');
    assert(verifiedSection.includes('Contraste insuficiente de 1.37:1 en "Apparel"'), 'FAIL real #1 (Apparel) presente en la sección verificada');
    assert(verifiedSection.includes('Contraste insuficiente de 1.33:1 en "Audio"'), 'FAIL real #2 (Audio) presente en la sección verificada');
    assert(verifiedSection.includes('Contraste insuficiente de 1.38:1 en "Home"'), 'FAIL real #3 (Home) presente en la sección verificada');

    // Los 4 NOT_EVALUABLE aparecen en SU propia sección, nunca en la de FAIL.
    assert(verifiedSection.includes('Observaciones no evaluables (NOT_EVALUABLE)'), 'Incluye el encabezado de observaciones no evaluables');
    assert(verifiedSection.includes('Contradicción de reseñas'), 'El hallazgo de reseñas aparece, pero en la sección NOT_EVALUABLE');
    assert(verifiedSection.includes('Landmark aria-label="Previous"'), 'El hallazgo de aria-label aparece, pero en la sección NOT_EVALUABLE');

    // severity se conserva tal cual (impacto potencial), sin reinterpretarse por status.
    const failSectionStart = verifiedSection.indexOf('Incumplimientos confirmados (FAIL)');
    const notEvalSectionStart = verifiedSection.indexOf('Observaciones no evaluables');
    const failSectionText = verifiedSection.slice(failSectionStart, notEvalSectionStart);
    assert(!failSectionText.includes('Contradicción de reseñas') && !failSectionText.includes('Landmark aria-label'), 'Ningún NOT_EVALUABLE aparece dentro de la sección de FAIL (Regla 1)');

    // Los 232 PASS quedan representados (agrupados, con el total exacto).
    assert(verifiedSection.includes('Cumplimientos confirmados (PASS) -- 232 en total'), 'Los 232 PASS quedan representados con su conteo exacto');
    assert(verifiedSection.includes('WCAG 2.4.4 Propósito de los enlaces: 96 elementos conformes'), 'Agrupación PASS por criterio correcta (ejemplo: WCAG 2.4.4 = 96)');

    // El texto narrativo de IA SIGUE presente, pero claramente separado y etiquetado.
    assert(finalSummary.includes('ANÁLISIS NARRATIVO COMPLEMENTARIO (IA, NO AUTORITATIVO)'), 'El texto de IA queda bajo un encabezado explícito de "no autoritativo"');
    assert(finalSummary.includes(contradictoryAiNarrative), 'El texto original de Gemini se conserva íntegro (no se elimina ni se reescribe)');
    assert(finalSummary.indexOf('RESULTADOS VERIFICADOS POR EVALUXIA') < finalSummary.indexOf('ANÁLISIS NARRATIVO COMPLEMENTARIO'), 'La sección verificada aparece ANTES del texto narrativo de IA');
    assert(finalSummary.includes('prevalece esta última'), 'Se establece explícitamente que los resultados verificados prevalecen ante cualquier discrepancia');
  }

  // -----------------------------------------------------------------
  // 2. Colecciones vacías.
  // -----------------------------------------------------------------
  console.log('\n--- 2. Colecciones vacías ---');
  {
    const section = buildVerifiedResultsSection([]);
    assert(section.includes('No se encontraron incumplimientos confirmados en esta evaluación.'), 'Mensaje claro cuando no hay FAIL');
    assert(section.includes('No se registraron observaciones no evaluables en esta evaluación.'), 'Mensaje claro cuando no hay NOT_EVALUABLE');
    assert(section.includes('No se registraron cumplimientos confirmados en esta evaluación.'), 'Mensaje claro cuando no hay PASS');
  }

  // -----------------------------------------------------------------
  // 3. Solo FAIL.
  // -----------------------------------------------------------------
  console.log('\n--- 3. Solo FAIL ---');
  {
    const section = buildVerifiedResultsSection([makeFinding({ status: 'FAIL', severity: 'critical', description: 'Único FAIL.' })]);
    assert(section.includes('Único FAIL.'), 'El único FAIL aparece');
    assert(section.includes('No se registraron observaciones no evaluables'), 'NOT_EVALUABLE vacío se representa correctamente');
    assert(section.includes('No se registraron cumplimientos confirmados'), 'PASS vacío se representa correctamente');
  }

  // -----------------------------------------------------------------
  // 4. Solo PASS.
  // -----------------------------------------------------------------
  console.log('\n--- 4. Solo PASS ---');
  {
    const section = buildVerifiedResultsSection([
      makeFinding({ status: 'PASS', severity: 'info', wcagCriterion: 'WCAG 1.1.1 Contenido no textual' }),
      makeFinding({ status: 'PASS', severity: 'info', wcagCriterion: 'WCAG 1.1.1 Contenido no textual' }),
    ]);
    assert(section.includes('Cumplimientos confirmados (PASS) -- 2 en total'), 'Conteo total de PASS correcto');
    assert(section.includes('WCAG 1.1.1 Contenido no textual: 2 elementos conformes'), 'Agrupación por criterio correcta para un único criterio');
  }

  // -----------------------------------------------------------------
  // 5. Solo NOT_EVALUABLE.
  // -----------------------------------------------------------------
  console.log('\n--- 5. Solo NOT_EVALUABLE ---');
  {
    const section = buildVerifiedResultsSection([makeFinding({ status: 'NOT_EVALUABLE', severity: 'low', description: 'Único NOT_EVALUABLE.' })]);
    assert(section.includes('Único NOT_EVALUABLE.'), 'El único NOT_EVALUABLE aparece en su sección');
    assert(section.includes('No se encontraron incumplimientos confirmados'), 'FAIL vacío se representa correctamente');
  }

  // -----------------------------------------------------------------
  // 6. Mezcla de los tres estados + severidades distintas (ya cubierto en
  // el caso 1, se repite aquí en miniatura para una prueba independiente y
  // más legible).
  // -----------------------------------------------------------------
  console.log('\n--- 6. Mezcla de los tres estados con severidades distintas ---');
  {
    const section = buildVerifiedResultsSection([
      makeFinding({ status: 'FAIL', severity: 'critical', description: 'FAIL crítico.' }),
      makeFinding({ status: 'NOT_EVALUABLE', severity: 'high', description: 'NOT_EVALUABLE con severidad alta heredada.' }),
      makeFinding({ status: 'PASS', severity: 'info', wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones' }),
    ]);
    assert(section.includes('FAIL crítico.') && section.includes('Severidad: critical'), 'FAIL crítico presente con su severidad real');
    assert(section.includes('NOT_EVALUABLE con severidad alta heredada.') && section.includes('Severidad: high'), 'NOT_EVALUABLE conserva su severidad heredada tal cual (no se reinterpreta a "info")');
  }

  // -----------------------------------------------------------------
  // 7. Ausencia de evidencia/recomendación/elemento afectado (campos
  // opcionales) -- no debe fallar ni inventar contenido.
  // -----------------------------------------------------------------
  console.log('\n--- 7. Ausencia de evidencia, recomendación y elemento afectado ---');
  {
    const section = buildVerifiedResultsSection([
      makeFinding({ status: 'FAIL', severity: 'medium', description: 'FAIL sin evidencia ni recomendación ni elemento.', evidence: undefined, recommendation: null, affectedElement: undefined }),
    ]);
    assert(section.includes('FAIL sin evidencia ni recomendación ni elemento.'), 'El hallazgo se representa igualmente sin esos campos opcionales');
    assert(!section.includes('Recomendación: null') && !section.includes('Recomendación: undefined'), 'No se inventa ni se imprime un valor nulo/indefinido para la recomendación ausente');
  }

  // -----------------------------------------------------------------
  // 8. Hallazgo con evidencia presente -- se incluye correctamente.
  // -----------------------------------------------------------------
  console.log('\n--- 8. Hallazgo con evidencia estructurada presente ---');
  {
    const section = buildVerifiedResultsSection([
      makeFinding({
        status: 'FAIL',
        severity: 'high',
        description: 'FAIL con evidencia.',
        evidence: [{ property: 'contrastRatio', value: '1.37:1' } as any],
      }),
    ]);
    assert(section.includes('contrastRatio: 1.37:1'), 'La evidencia estructurada se incluye en el texto');
  }

  console.log('\n✅ Cierre de inconsistencia del resumen ejecutivo: todos los escenarios superados.\n');
}

runTests();
console.log('========================================');
console.log('Results: All verified-summary-builder scenarios passed successfully!');
console.log('========================================\n');
process.exit(0);
