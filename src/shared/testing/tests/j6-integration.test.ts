import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * J6 + cardinality — integration test through the FULL mocked pipeline
 * (runMockedPhase2Pipeline, now wired EvidenceGate/J1 -> cardinality
 * enforcement -> J6, exactly mirroring audit-engine.service.ts). Unlike
 * evidence-claim-consistency.test.ts (service-level, calls checkClaimConsistency/
 * applyClaimConsistency directly), this exercises the real production
 * functions end-to-end from a mocked Gemini response through to the
 * consolidated finding — closing the integration-coverage gap identified
 * during H-REGRESSION-3 analysis (runMockedPhase2Pipeline previously only
 * wired up through EvidenceGate, never cardinality/J6).
 *
 * Gemini calls: 0.
 */
async function main() {
  console.log('🧪 Starting J6 + cardinality integration tests (full mocked pipeline)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/j6-integration', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [],
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [
          { selector: '#email', type: 'email', name: 'email', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: true, placeholder: 'Email', ariaInvalid: false },
        ],
      }],
      landmarks: [], computedStyles: [],
    },
  ];

  // ===== Caso 1: INCONSISTENT — Gemini cita ariaLabel="Correo válido" cuando el real es null =====
  const stubInconsistent = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
        wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
        description: 'El input de email tiene un ariaLabel descriptivo pero sigue siendo confuso.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Correo válido', selector: '#email' }],
        affectedElement: { tag: 'input', selector: '#email' },
        recommendation: 'Mejorar el texto del aria-label.',
      },
    ]),
  ]);
  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'j6-inconsistent', url: 'https://fixture.local/j6-integration' });
    const gated = result.gatedAiFindings.find((f: any) => f.affectedElement?.selector === '#email');
    assert(gated?.status === 'FAIL', `Caso 1: J1/EvidenceGate NO degrada este finding (selector trazable) -- sigue FAIL justo después del gate (obtenido: ${gated?.status})`);
    const finding = result.validatedAiFindings.find((f: any) => f.affectedElement?.selector === '#email');
    assert(!!finding, 'Caso 1 (INCONSISTENT): el finding sobre #email llega hasta el resultado final del pipeline.');
    assert(finding?.status === 'NOT_EVALUABLE', `Caso 1: J6 degrada el finding a NOT_EVALUABLE (obtenido: status=${finding?.status})`);
    assert(finding?.confidence === 'low', `Caso 1: confidence degradado a 'low' (obtenido: ${finding?.confidence})`);
    assert(finding?.recommendation === null, `Caso 1: recommendation anulado (obtenido: ${JSON.stringify(finding?.recommendation)})`);
    assert(result.j6Summary.inconsistent === 1, `Caso 1: j6Summary.inconsistent === 1 (obtenido: ${result.j6Summary.inconsistent})`);
    assert(result.cardinalitySummary.violations === 0, `Caso 1: sin violaciones de cardinalidad (un solo código WCAG), obtenido=${result.cardinalitySummary.violations}`);
    // Fase I.2 (analyzeForms, WCAG 3.3.2 determinístico): la evidencia de
    // #email en este fixture (label=null, ariaLabel=null) ahora TAMBIÉN
    // produce, correcta e independientemente, un finding determinístico
    // propio bajo WCAG 3.3.2 para el mismo selector -- 2 findings legítimos
    // e independientes bajo criterios DISTINTOS, no una "resurrección" del
    // finding degradado. Se escoge la assertion por criterio específico
    // (WCAG 4.1.2, el que esta prueba realmente ejercita) en vez de "único
    // finding para el selector", que ya no es la invariante correcta ahora
    // que existe más de una regla capaz de evaluar el mismo elemento.
    const consolidatedFor412 = result.metrics.consolidatedFindings.filter(
      (f: any) => f.affectedElement?.selector === '#email' && f.wcagCriterion === 'WCAG 4.1.2 Nombre, función y valor',
    );
    assert(consolidatedFor412.length === 1, `Caso 1: exactamente 1 finding consolidado para #email bajo WCAG 4.1.2 (el criterio que esta prueba ejercita) -- no hay una segunda entrada FAIL "revivida" en paralelo bajo ESE criterio (obtenido: ${consolidatedFor412.length})`);
    assert(consolidatedFor412[0]?.status === 'NOT_EVALUABLE', `Caso 1: la consolidación final (AuditMetricsService) también refleja NOT_EVALUABLE para WCAG 4.1.2, nunca reinterpretado como FAIL (obtenido: ${consolidatedFor412[0]?.status})`);
  } finally {
    stubInconsistent.restore();
  }

  // ===== Caso 2 (control): CONSISTENT — Gemini cita ariaLabel=null (el valor real) =====
  const stubConsistent = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
        wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
        description: 'El input de email no tiene ariaLabel.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: null, selector: '#email' }],
        affectedElement: { tag: 'input', selector: '#email' },
        recommendation: 'Agregar un aria-label descriptivo.',
      },
    ]),
  ]);
  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'j6-consistent', url: 'https://fixture.local/j6-integration' });
    const gated = result.gatedAiFindings.find((f: any) => f.affectedElement?.selector === '#email');
    assert(gated?.status === 'FAIL', `Caso 2: J1/EvidenceGate confirma selector trazable -- sigue FAIL justo después del gate (obtenido: ${gated?.status})`);
    const finding = result.validatedAiFindings.find((f: any) => f.affectedElement?.selector === '#email');
    assert(!!finding, 'Caso 2 (CONSISTENT/control): el finding sobre #email llega hasta el resultado final del pipeline.');
    assert(finding?.status === 'FAIL', `Caso 2: J6 NO degrada un finding consistente -- conserva status='FAIL' (obtenido: ${finding?.status})`);
    assert(finding?.confidence === 'high', `Caso 2: confidence original conservado (obtenido: ${finding?.confidence})`);
    assert(finding?.recommendation === 'Agregar un aria-label descriptivo.', `Caso 2: recommendation original conservado (obtenido: ${JSON.stringify(finding?.recommendation)})`);
    assert(result.j6Summary.consistent === 1 && result.j6Summary.inconsistent === 0, `Caso 2: j6Summary confirma CONSISTENT, 0 inconsistencias (obtenido: ${JSON.stringify(result.j6Summary)})`);
  } finally {
    stubConsistent.restore();
  }

  // ===== Caso 3: cardinalidad combinada — degradado por applyCardinalityEnforcement, no por J6 =====
  // Selector deliberadamente distinto de '#email' (usa el landmark 'form'
  // en su lugar): Fase I.2 agregó analyzeForms (WCAG 3.3.2 determinístico)
  // sobre form.elements[] -- si este caso usara '#email', su finding
  // degradado por cardinalidad (normalizeCriterionKey del string combinado
  // -> "WCAG 3.3.2") colisionaría en el MISMO key de deduplicación
  // ("WCAG 3.3.2_#email") con el finding determinístico real de #email,
  // y la prioridad determinística ya existente (documentada en
  // audit-metrics.service.ts) haría que la consolidación mostrara el
  // status del finding determinístico, no del degradado -- un confound
  // real del fixture, no un bug de analyzeForms ni de cardinalidad. 'form'
  // es un selector real y trazable (indexado por J1 vía `forms[].selector`)
  // que analyzeForms nunca evalúa (solo itera form.elements[]).
  const COMBINED = 'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones';
  const stubCombined = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
        wcagCriterion: COMBINED,
        description: 'El formulario no tiene un nombre accesible (landmark sin aria-label).',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'name', value: null, selector: 'form' }],
        affectedElement: { tag: 'form', selector: 'form' },
        recommendation: 'Agregar un aria-label descriptivo al formulario.',
      },
    ]),
  ]);
  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'j6-cardinality', url: 'https://fixture.local/j6-integration' });
    const gated = result.gatedAiFindings.find((f: any) => f.affectedElement?.selector === 'form');
    assert(gated?.status === 'FAIL', `Caso 3: J1/EvidenceGate NO degrada esto (selector trazable, evidencia real) -- sigue FAIL justo después del gate, confirma que quien degrada es cardinalidad, no J1 (obtenido: ${gated?.status})`);
    const finding = result.validatedAiFindings.find((f: any) => f.affectedElement?.selector === 'form');
    assert(result.cardinalitySummary.violations === 1, `Caso 3: applyCardinalityEnforcement detecta 1 violación (obtenido: ${result.cardinalitySummary.violations})`);
    assert(finding?.status === 'NOT_EVALUABLE', `Caso 3: el enforcement de cardinalidad degrada el finding a NOT_EVALUABLE (obtenido: ${finding?.status})`);
    assert(finding?.confidence === 'low', `Caso 3: confidence degradado a 'low' (obtenido: ${finding?.confidence})`);
    assert(finding?.recommendation === null, `Caso 3: recommendation anulado (obtenido: ${JSON.stringify(finding?.recommendation)})`);
    // El finding ya llega degradado a J6 -- J6 no debería reportarlo como su propia
    // inconsistencia, ni "revivirlo" a FAIL, ni volver a interpretarlo.
    assert(result.j6Summary.inconsistent === 0, `Caso 3: J6 no reporta esto como su propia inconsistencia -- ya llegó degradado por cardinalidad (obtenido: j6Summary.inconsistent=${result.j6Summary.inconsistent})`);
    assert(result.j6Summary.consistent === 1, `Caso 3: J6 evalúa la evidencia citada (name=null, real) como CONSISTENT en sí misma, pero eso NO revierte la degradación de cardinalidad ya aplicada (obtenido j6Summary.consistent=${result.j6Summary.consistent}, status final sigue NOT_EVALUABLE)`);
    const consolidatedForSelector = result.metrics.consolidatedFindings.filter((f: any) => f.affectedElement?.selector === 'form');
    assert(consolidatedForSelector.length === 1 && consolidatedForSelector[0]?.status === 'NOT_EVALUABLE', `Caso 3: la consolidación final también refleja NOT_EVALUABLE, una sola vez, sin reinterpretación (obtenido: ${JSON.stringify(consolidatedForSelector.map((f: any) => f.status))})`);
  } finally {
    stubCombined.restore();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
