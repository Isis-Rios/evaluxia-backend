import { auditMetricsService, InputAuditFinding } from '../services/audit-metrics.service';

/**
 * Hardening post Gemini Real #1 — hallazgo A: política de consolidación
 * ante discrepancia de `status` entre un finding determinístico y uno de
 * IA para el mismo criterio+selector. Ver docstring de
 * `applyStatusConsolidationPolicy` (audit-metrics.service.ts).
 *
 * Gemini calls: 0. Todo determinístico/sintético.
 */

function det(overrides: Partial<InputAuditFinding>): InputAuditFinding {
  return {
    findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
    description: 'det', wcagCriterion: 'WCAG 2.4.4', affectedElement: { selector: '#x' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'href', value: '/x' }],
    iteration: 1, origin: 'deterministic',
    ...overrides,
  };
}

function ai(overrides: Partial<InputAuditFinding>): InputAuditFinding {
  return {
    findingGroup: 'accessibility', status: 'FAIL', severity: 'medium', confidence: 'high',
    description: 'ai', wcagCriterion: 'WCAG 2.4.4', affectedElement: { selector: '#x' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más' }],
    iteration: 1, origin: 'ai',
    ...overrides,
  };
}

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function runConsolidationPolicyTests() {
  console.log('🧪 Starting consolidation-policy (hallazgo A) tests...\n');

  // Test 1: det PASS + AI FAIL -> det gana el status externo; el FAIL de IA se preserva en discrepancy.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'PASS' }),
      ai({ status: 'FAIL', description: 'Gemini dice FAIL' }),
    ]);
    expect(c.status === 'PASS', 'Test 1: det PASS + AI FAIL -> status consolidado PASS (determinístico gana).', c.status);
    expect(c.discrepancy?.origin === 'ai' && c.discrepancy?.status === 'FAIL' && c.discrepancy?.description === 'Gemini dice FAIL', 'Test 1b: el FAIL de IA se preserva íntegro en discrepancy, nunca se descarta.', c.discrepancy);
  }

  // Test 2: det FAIL + AI PASS -> det gana el status externo; el PASS de IA se preserva en discrepancy.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'FAIL', description: 'det dice FAIL' }),
      ai({ status: 'PASS', description: 'Gemini dice PASS' }),
    ]);
    expect(c.status === 'FAIL', 'Test 2: det FAIL + AI PASS -> status consolidado FAIL (determinístico gana).', c.status);
    expect(c.discrepancy?.origin === 'ai' && c.discrepancy?.status === 'PASS', 'Test 2b: el PASS de IA se preserva en discrepancy.', c.discrepancy);
  }

  // Test 2c: el determinístico gana AUNQUE llegue en SEGUNDO lugar en el array (ya no depende del orden de inserción, solo del origin).
  {
    const [c] = auditMetricsService.deduplicateFindings([
      ai({ status: 'PASS', description: 'Gemini dice PASS, llega primero' }),
      det({ status: 'FAIL', description: 'det dice FAIL, llega después' }),
    ]);
    expect(c.status === 'FAIL' && c.origin === 'deterministic', 'Test 2c: determinístico gana el status aunque llegue SEGUNDO en el array (arbitraje por origin, no por orden de inserción).', c);
    expect(c.discrepancy?.origin === 'ai' && c.discrepancy?.status === 'PASS' && c.discrepancy?.description === 'Gemini dice PASS, llega primero', 'Test 2d: el veredicto de IA perdedor se preserva correctamente aunque haya sido el primero insertado.', c.discrepancy);
  }

  // Test 3: det FAIL + AI FAIL (acuerdo) -> sin discrepancy, comportamiento de fusión estándar sin cambios.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'FAIL' }),
      ai({ status: 'FAIL' }),
    ]);
    expect(c.status === 'FAIL' && c.discrepancy === undefined, 'Test 3: det FAIL + AI FAIL (acuerdo) -> sin discrepancy.', c);
  }

  // Test 4: det PASS + AI PASS (acuerdo) -> sin discrepancy.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'PASS' }),
      ai({ status: 'PASS' }),
    ]);
    expect(c.status === 'PASS' && c.discrepancy === undefined, 'Test 4: det PASS + AI PASS (acuerdo) -> sin discrepancy.', c);
  }

  // Test 5: det NOT_EVALUABLE + AI FAIL -> el veredicto decisivo (FAIL de IA) gana, nunca lo silencia la abstención, sin importar orden.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'NOT_EVALUABLE', confidence: 'low' }),
      ai({ status: 'FAIL' }),
    ]);
    expect(c.status === 'FAIL' && c.origin === 'ai', 'Test 5: det NOT_EVALUABLE + AI FAIL -> el decisivo (FAIL) gana, la abstención nunca lo silencia.', c);
    expect(c.discrepancy === undefined, 'Test 5b: una abstención perdedora NO se registra como discrepancy (no es una contra-afirmación, es "no sé").', c.discrepancy);
  }

  // Test 6: det FAIL + AI NOT_EVALUABLE -> el veredicto decisivo (FAIL determinístico) se conserva, la abstención de IA no lo contamina.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'FAIL' }),
      ai({ status: 'NOT_EVALUABLE', confidence: 'low' }),
    ]);
    expect(c.status === 'FAIL' && c.origin === 'deterministic', 'Test 6: det FAIL + AI NOT_EVALUABLE -> el decisivo (FAIL) se conserva.', c);
    expect(c.discrepancy === undefined, 'Test 6b: sin discrepancy (abstención no es contra-afirmación).', c.discrepancy);
  }

  // Test 6c: orden invertido (NOT_EVALUABLE insertado primero) -> mismo resultado, confirma que Regla 1 no depende del orden.
  {
    const [c] = auditMetricsService.deduplicateFindings([
      ai({ status: 'NOT_EVALUABLE', confidence: 'low' }),
      det({ status: 'FAIL' }),
    ]);
    expect(c.status === 'FAIL', 'Test 6c: NOT_EVALUABLE insertado PRIMERO, decisivo insertado después -> el decisivo igual gana (Regla 1 no depende del orden).', c);
  }

  // Test 7: evidencia consistente en ambos lados (ambos decisivos, status distinto) -> discrepancy documenta evidencia real de la IA.
  {
    const aiEvidence = [{ type: 'DOM_ATTRIBUTE' as const, property: 'text', value: 'Leer más' }];
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'PASS' }),
      ai({ status: 'FAIL', evidence: aiEvidence }),
    ]);
    expect(JSON.stringify(c.discrepancy?.evidence) === JSON.stringify(aiEvidence), 'Test 7: discrepancy preserva la evidencia real citada por el lado perdedor.', c.discrepancy);
  }

  // Test 8: un finding de IA que J6 YA degradó a NOT_EVALUABLE antes de llegar aquí (simulando evidencia inconsistente upstream) nunca contamina ni genera un discrepancy -- Regla 1 lo trata como abstención, no como veredicto decisivo.
  {
    const degradedByJ6 = ai({ status: 'NOT_EVALUABLE', confidence: 'low', recommendation: null, description: 'Degradado por J6 (evidencia INCONSISTENT upstream)' });
    const [c] = auditMetricsService.deduplicateFindings([
      det({ status: 'FAIL' }),
      degradedByJ6,
    ]);
    expect(c.status === 'FAIL' && c.discrepancy === undefined, 'Test 8: finding de IA ya degradado a NOT_EVALUABLE por J6 (evidencia inconsistente) -> tratado como abstención, no contamina ni genera discrepancy falso.', c);
  }

  // Test 9: selectores distintos -> NO colisionan (claves de dedup distintas), ambos sobreviven independientes.
  {
    const result = auditMetricsService.deduplicateFindings([
      det({ status: 'PASS', affectedElement: { selector: '#a' } }),
      ai({ status: 'FAIL', affectedElement: { selector: '#b' } }),
    ]);
    expect(result.length === 2, 'Test 9: selectores distintos -> 2 findings consolidados independientes, sin colisión.', result.length);
  }

  // Test 10: criterios distintos -> NO colisionan.
  {
    const result = auditMetricsService.deduplicateFindings([
      det({ status: 'PASS', wcagCriterion: 'WCAG 2.4.4' }),
      ai({ status: 'FAIL', wcagCriterion: 'WCAG 1.1.1' }),
    ]);
    expect(result.length === 2, 'Test 10: criterios distintos (mismo selector) -> 2 findings consolidados independientes.', result.length);
  }

  // Test 11/12: mismo problema bajo WCAG y Nielsen -> NUNCA colisionan (claves de dedup distintas por diseño,
  // normalizeCriterionKey extrae códigos de espacios distintos) -- comportamiento esperado, documentado como
  // redundancia multi-ángulo intencional, NO como fusión indebida. Ambos deben sobrevivir, sin fusionar sus
  // descripciones/evidencia entre sí (findings complementarios que no deben fusionarse).
  {
    const wcagFinding = det({ status: 'FAIL', wcagCriterion: 'WCAG 1.3.1 Información y relaciones', description: 'Falta un h1 (WCAG)' });
    const nielsenFinding: InputAuditFinding = {
      findingGroup: 'ux', status: 'FAIL', severity: 'medium', confidence: 'high',
      description: 'Falta un h1 (Nielsen N-04)', heuristicCode: 'N-04', affectedElement: { selector: 'body' },
      evidence: [], iteration: 1, origin: 'deterministic',
    };
    const result = auditMetricsService.deduplicateFindings([wcagFinding, nielsenFinding]);
    expect(result.length === 2, 'Test 11: mismo problema real bajo WCAG y Nielsen -> 2 findings consolidados (claves de dedup distintas por diseño), nunca se fusionan en 1.', result.length);
    const wcagOut = result.find((r) => r.wcagCriterion);
    const nielsenOut = result.find((r) => r.heuristicCode);
    expect(wcagOut?.description === 'Falta un h1 (WCAG)' && nielsenOut?.description === 'Falta un h1 (Nielsen N-04)', 'Test 12: cada uno conserva su propia descripción/evidencia -- no se fusionan entre sí (findings complementarios, no duplicados).', { wcagOut, nielsenOut });
  }

  // -----------------------------------------------------------------------
  // P1.1.1 — regresión del defecto A (auditoría P1.1): det NOT_EVALUABLE con
  // evidencia sentinel `{property:'contrastRatio', value:'no determinable'}`
  // (la que ahora produce `analyzeContrast` para fondos con transparencia
  // parcial) colisionando con un `FAIL` decisivo de IA para el MISMO
  // selector+criterio WCAG 1.4.3. A diferencia del Test 5 (evidencia
  // genérica `href`/`text`), esto reproduce el shape REAL que causaba la
  // contaminación -- por la ruta real de consolidación
  // (`deduplicateFindings`), no una función aislada.
  // -----------------------------------------------------------------------

  function detContrastNotEvaluable(overrides: Partial<InputAuditFinding> = {}): InputAuditFinding {
    return det({
      status: 'NOT_EVALUABLE',
      confidence: 'high',
      wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
      description: 'No se pudo determinar el contraste del elemento <button>: fondo parcialmente transparente.',
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: 'no determinable', selector: '#x', context: 'color: rgba(33,40,50,0.5), backgroundColor: rgba(33,40,50,0.2)' }],
      ...overrides,
    });
  }

  // Test 13: det NOT_EVALUABLE (sentinel) + AI FAIL con contrastRatio numérico real -> el
  // sentinel se retira y la medición real de IA sobrevive en la evidencia consolidada.
  {
    const aiFail = ai({
      status: 'FAIL',
      wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
      description: 'Contraste insuficiente de 2.10:1 según la IA.',
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '2.10:1', selector: '#x' }],
    });
    const [c] = auditMetricsService.deduplicateFindings([detContrastNotEvaluable(), aiFail]);
    expect(c.status === 'FAIL' && c.origin === 'ai', 'Test 13: det NOT_EVALUABLE (contraste) + AI FAIL -> el decisivo de IA gana el status, sin cambios en la política de consolidación.', c);
    const contrastEvidence = c.evidence?.filter((e: any) => (e.property ?? e.attribute) === 'contrastRatio') || [];
    expect(contrastEvidence.length === 1, `Test 13b: solo queda UNA entrada de evidencia contrastRatio en el finding consolidado (obtenido: ${contrastEvidence.length}), no dos contradictorias.`, contrastEvidence);
    expect(contrastEvidence[0]?.value === '2.10:1', `Test 13c: la medición numérica REAL de la IA (2.10:1) sobrevive -- ya NO se pierde (defecto A corregido). Obtenido: ${contrastEvidence[0]?.value}`, contrastEvidence);
    expect(!contrastEvidence.some((e: any) => e.value === 'no determinable'), 'Test 13d: el sentinel "no determinable" ya NO queda en el finding persistido una vez hay una medición real que lo reemplaza.', contrastEvidence);
  }

  // Test 14: det NOT_EVALUABLE (sentinel) + AI FAIL SIN ninguna medición numérica de
  // contraste -> no se inventa ningún número; el sentinel se conserva tal cual, y la
  // evidencia útil de la IA para otra propiedad SÍ se fusiona (no se descarta nada útil).
  {
    const aiFailNoRatio = ai({
      status: 'FAIL',
      wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
      description: 'La IA reporta FAIL sin citar un contrastRatio propio.',
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: '#x' }],
    });
    const [c] = auditMetricsService.deduplicateFindings([detContrastNotEvaluable(), aiFailNoRatio]);
    expect(c.status === 'FAIL' && c.origin === 'ai', 'Test 14: det NOT_EVALUABLE (contraste) + AI FAIL sin contrastRatio propio -> el decisivo de IA sigue ganando el status.', c);
    const contrastEvidence = c.evidence?.filter((e: any) => (e.property ?? e.attribute) === 'contrastRatio') || [];
    expect(contrastEvidence.length === 1 && contrastEvidence[0]?.value === 'no determinable', 'Test 14b: sin una medición numérica real que lo reemplace, el sentinel "no determinable" se conserva tal cual -- nunca se inventa ni se convierte en un número.', contrastEvidence);
    const ariaEvidence = c.evidence?.find((e: any) => (e.property ?? e.attribute) === 'ariaLabel');
    expect(!!ariaEvidence, 'Test 14c: la evidencia útil de la IA para otra propiedad (ariaLabel) SÍ se fusiona -- no se descarta nada ajeno al contraste.', c.evidence);
  }

  // Test 15: regresión explícita -- det con medición REAL (no sentinel) sigue protegida
  // frente a un re-estimado de IA, exactamente como antes del cambio (Guard 2 sin alterar
  // su prioridad para el caso real/real).
  {
    const detReal = det({
      status: 'FAIL',
      wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '2.32:1', selector: '#x' }],
    });
    const aiReal = ai({
      status: 'FAIL',
      wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '3.12:1', selector: '#x' }],
    });
    const [c] = auditMetricsService.deduplicateFindings([detReal, aiReal]);
    const contrastEvidence = c.evidence?.filter((e: any) => (e.property ?? e.attribute) === 'contrastRatio') || [];
    expect(contrastEvidence.length === 1 && contrastEvidence[0]?.value === '2.32:1', `Test 15: det con medición REAL (2.32:1) sigue protegida frente al re-estimado de IA (3.12:1) -- Guard 2 sin cambios de prioridad para el caso real/real. Obtenido: ${contrastEvidence[0]?.value}`, contrastEvidence);
  }

  console.log(`\n🎉 ALL consolidation-policy (hallazgo A) tests passed (${passed} assertions).`);
  process.exit(0);
}

runConsolidationPolicyTests();
