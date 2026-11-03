import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildEvidenceIndex, checkFindingTraceability, normalizeSelectorForComparison } from '@/modules/evaluations/services/evidence-traceability.service';
import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';

/**
 * Hardening Post-Fase H — J1: Evidence Traceability.
 *
 * Cubre la matriz de casos A-J del plan J1 (ver reporte de implementación
 * para la matriz completa). Todas las respuestas son mockeadas — cero
 * Gemini real. Principio rector verificado explícitamente: "selector
 * existe -> finding es TRAZABLE", nunca "selector existe -> finding es
 * CORRECTO" (Caso J).
 */
function buildFinding(overrides: Partial<V2AuditFinding>): V2AuditFinding {
  return {
    findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
    wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
    description: 'Descripción de prueba.',
    evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'aria-label', value: 'null' }],
    recommendation: 'Recomendación de prueba.',
    ...overrides,
  } as V2AuditFinding;
}

async function main() {
  console.log('🧪 Starting J1 — Evidence Traceability (Hardening Post-Fase H)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ==========================================================================
  // Caso A — selector legítimo
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [],
      dedupedLinks: [{ selector: 'a.real-link', text: 'Enlace real', href: '/real', ariaLabel: null, role: null, isExternal: false, iterations: [1] }],
      dedupedButtons: [],
    });
    const finding = buildFinding({ affectedElement: { tag: 'a', selector: 'a.real-link' } });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === true, `Caso A: selector legítimo -> traceable=true (obtenido: ${r.traceable}, razón: ${r.reason})`);
  }

  // ==========================================================================
  // Caso B — selector inventado
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedLinks: [{ selector: 'a.real-link', text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false, iterations: [1] }], dedupedButtons: [],
    });
    const finding = buildFinding({ affectedElement: { tag: 'button', selector: 'button.invented' } });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === false, `Caso B: selector inventado -> traceable=false (obtenido: ${r.traceable})`);
  }

  // ==========================================================================
  // Caso C — selector de otra iteración/llamada (no incluido en ESTA evidencia)
  // ==========================================================================
  {
    // Simula: el selector "a.iter2-only" existió en una iteración 2, pero
    // la evidencia REALMENTE construida/enviada para esta llamada proviene
    // solo de iteración 1 (el índice se construye estrictamente de lo enviado).
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedLinks: [{ selector: 'a.iter1-only', text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false, iterations: [1] }], dedupedButtons: [],
    });
    const finding = buildFinding({ affectedElement: { tag: 'a', selector: 'a.iter2-only' } });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === false, `Caso C: selector de una iteración/llamada NO incluida en ESTA evidencia -> traceable=false, indistinguible de un inventado (obtenido: ${r.traceable})`);
  }

  // ==========================================================================
  // Caso D — selector ambiguo (mismo selector, mismo tipo, contenido distinto)
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [],
      dedupedLinks: [
        { selector: 'a.dup', text: 'Producto A', href: '/a', ariaLabel: null, role: null, isExternal: false, iterations: [1] },
        { selector: 'a.dup', text: 'Producto B', href: '/b', ariaLabel: null, role: null, isExternal: false, iterations: [1] },
      ],
      dedupedButtons: [],
    });
    const finding = buildFinding({ affectedElement: { tag: 'a', selector: 'a.dup' } });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === false, `Caso D: selector ambiguo (2 elementos distintos, mismo selector) -> traceable=false (obtenido: ${r.traceable})`);
  }

  // ==========================================================================
  // Caso E — diferencia trivial de formato (espacio alrededor de combinador)
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedButtons: [],
      dedupedLinks: [{ selector: 'footer > a:nth-of-type(2)', text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false, iterations: [1] }],
    });
    const equivalent = buildFinding({ affectedElement: { tag: 'a', selector: 'footer>a:nth-of-type(2)' } });
    const rEquivalent = checkFindingTraceability(equivalent, index);
    assert(rEquivalent.traceable === true, `Caso E: "footer>a:nth-of-type(2)" (sin espacios) SÍ se reconoce equivalente a "footer > a:nth-of-type(2)" -- espacio alrededor de combinador es insignificante en CSS (obtenido: ${rEquivalent.traceable})`);

    const genuinelyDifferent = buildFinding({ affectedElement: { tag: 'a', selector: 'footer > a:nth-of-type(3)' } });
    const rDifferent = checkFindingTraceability(genuinelyDifferent, index);
    assert(rDifferent.traceable === false, `Caso E (control negativo): "nth-of-type(3)" NO se confunde con "nth-of-type(2)" -- la normalización NUNCA toca tokens semánticos (obtenido: ${rDifferent.traceable})`);

    assert(normalizeSelectorForComparison('a  >   b') === 'a>b', 'normalizeSelectorForComparison colapsa espacios alrededor de combinadores de forma determinista');
  }

  // ==========================================================================
  // Caso F — selector existente pero tipo incompatible
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedButtons: [],
      dedupedLinks: [{ selector: 'a.cta', text: 'Comprar', href: '/comprar', ariaLabel: null, role: null, isExternal: false, iterations: [1] }],
    });
    const incompatible = buildFinding({ affectedElement: { tag: 'img', selector: 'a.cta' } });
    const rIncompatible = checkFindingTraceability(incompatible, index);
    assert(rIncompatible.traceable === false, `Caso F: el selector existe (es un <a>), pero el finding declara tag="img" -> tipo incompatible, traceable=false (obtenido: ${rIncompatible.traceable})`);

    const compatible = buildFinding({ affectedElement: { tag: 'a', selector: 'a.cta' } });
    const rCompatible = checkFindingTraceability(compatible, index);
    assert(rCompatible.traceable === true, `Caso F (control positivo): mismo selector, tag="a" coincide con el tipo real -> traceable=true (obtenido: ${rCompatible.traceable})`);

    const noTagDeclared = buildFinding({ affectedElement: { selector: 'a.cta' } });
    const rNoTag = checkFindingTraceability(noTagDeclared, index);
    assert(rNoTag.traceable === true, 'Caso F (sin tag declarado): si Gemini no declara tag, NO se penaliza por tipo -- nunca se adivina');
  }

  // ==========================================================================
  // Caso G — finding sin selector
  // ==========================================================================
  {
    const index = buildEvidenceIndex({ evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }], dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [] });
    const pageLevel = buildFinding({ affectedElement: undefined, heuristicCode: 'N-08', wcagCriterion: undefined });
    const r = checkFindingTraceability(pageLevel, index);
    assert(r.traceable === true, `Caso G: finding sin affectedElement.selector (heurística a nivel de página) -> la validación no aplica, traceable=true (obtenido: ${r.traceable})`);
  }

  // ==========================================================================
  // Caso H — selector existe, pero evidencia insuficiente (Gate Rule 1 preexistente, NO J1)
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedButtons: [],
      dedupedLinks: [{ selector: 'a.real', text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false, iterations: [1] }],
    });
    const finding = buildFinding({ affectedElement: { tag: 'a', selector: 'a.real' }, evidence: [] }); // evidence VACÍO
    const traceability = checkFindingTraceability(finding, index);
    assert(traceability.traceable === true, 'Caso H: la trazabilidad del selector es independiente de si `evidence` está vacío -- J1 NO evalúa suficiencia (traceable=true aunque evidence=[])');

    const processed = evidenceGateService.processAiFindings([finding], index);
    assert(processed[0].status === 'NOT_EVALUABLE', `Caso H: el finding SÍ termina en NOT_EVALUABLE, pero por la Gate Rule 1 PREEXISTENTE (FAIL + evidence vacío), no por J1 (obtenido: ${processed[0].status})`);
  }

  // ==========================================================================
  // Caso I — selector repetido legítimamente (mismo elemento, 2 tipos de evidencia)
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [{ selector: 'button.cta', tag: 'button', text: 'Comprar', color: '#000', backgroundColor: '#fff', fontSize: '16px', fontWeight: '400', lineHeight: '1.5', fontFamily: 'Arial' }] }],
      dedupedLandmarks: [],
      dedupedButtons: [{ selector: 'button.cta', tag: 'button', text: 'Comprar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true, iterations: [1] }],
      dedupedLinks: [],
    });
    const finding = buildFinding({ affectedElement: { tag: 'button', selector: 'button.cta' } });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === true, `Caso I: el mismo selector aparece en dedupedButtons Y en computedStyles (mismo elemento real, 2 tipos de evidencia complementarios) -> NO es ambiguo, traceable=true (obtenido: ${r.traceable})`);
    assert(!index.get('button.cta')!.ambiguous, 'Caso I: el índice NO marca esto como ambiguo -- la cobertura complementaria entre tipos de evidencia es legítima');
  }

  // ==========================================================================
  // Caso J — selector correcto, pero claim NO sustentado (fuera del alcance de J1)
  // ==========================================================================
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
      dedupedLandmarks: [], dedupedLinks: [],
      dedupedButtons: [{ selector: 'button.well-labeled', tag: 'button', text: null, ariaLabel: 'Cerrar diálogo', role: null, isDisabled: false, isPrimary: false, iterations: [1] }],
    });
    // El botón SÍ tiene aria-label real -- pero Gemini afirma (incorrectamente) que carece de nombre accesible.
    const finding = buildFinding({ affectedElement: { tag: 'button', selector: 'button.well-labeled' }, description: 'El botón carece de nombre accesible.' });
    const r = checkFindingTraceability(finding, index);
    assert(r.traceable === true, 'Caso J: el selector ES trazable (el elemento existe) -- J1 NUNCA evalúa si el claim de Gemini es semánticamente correcto, eso queda deliberadamente fuera de su alcance');
    const processed = evidenceGateService.processAiFindings([finding], index);
    assert(processed[0].status === 'FAIL', 'Caso J: el finding pasa intacto como FAIL -- la corrección del claim NO es responsabilidad de J1 (documentado como límite deliberado, no un gap)');
  }

  // ==========================================================================
  // J1 solo afecta findings de IA — determinísticos permanecen intactos (pipeline completo)
  // ==========================================================================
  {
    const evidences: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/j1', screenshotPath: '/x.png', headings: [], images: [], links: [{ selector: 'a.real', text: 'Enlace real', href: '/real', ariaLabel: null, role: null, isExternal: false }], buttons: [], forms: [], landmarks: [], computedStyles: [] },
    ];
    const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
    assert(deterministicFindings.some((f: any) => f.wcagCriterion?.includes('2.4.4') && f.status === 'PASS'), 'Precondición: el determinístico produce un PASS real e independiente para a.real');

    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        { findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor', description: 'Botón inventado sin nombre.', evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'aria-label', value: 'null', selector: 'button.no-existe' }], affectedElement: { tag: 'button', selector: 'button.no-existe' }, recommendation: 'Agregar aria-label.' },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'j1-determ-isolation', url: 'https://fixture.local/j1' });
      const consolidatedDeterministic = result.metrics.consolidatedFindings.find((f: any) => f.wcagCriterion?.includes('2.4.4'));
      const consolidatedHallucinated = result.metrics.consolidatedFindings.find((f: any) => f.affectedElement?.selector === 'button.no-existe');
      assert(consolidatedDeterministic?.status === 'PASS', `El finding DETERMINÍSTICO permanece intacto (PASS) -- J1 nunca lo toca (obtenido: ${consolidatedDeterministic?.status})`);
      assert(consolidatedHallucinated?.status === 'NOT_EVALUABLE', `El finding de IA no trazable SÍ se degrada (obtenido: ${consolidatedHallucinated?.status})`);

      // Métricas: NOT_EVALUABLE nunca cuenta como FAIL.
      assert(result.metrics.failCount === 0, `metrics.failCount=0 -- el finding degradado NO cuenta como FAIL (obtenido: ${result.metrics.failCount})`);
      assert(result.metrics.notEvaluableCount >= 1, `metrics.notEvaluableCount incluye el finding degradado (obtenido: ${result.metrics.notEvaluableCount})`);
      assert(!result.metrics.consolidatedFindings.some((f: any) => f.affectedElement?.selector === 'button.no-existe' && f.status === 'FAIL'), 'Ningún finding no-trazable aparece como FAIL en consolidatedFindings');
    } finally {
      stub.restore();
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
