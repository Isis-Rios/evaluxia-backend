import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService } from '@/modules/evaluations/services/audit-metrics.service';
import { buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * P1.7.3.1-CORRECTION — Automation Signal Protection (Gate Rule 0d), WEB.
 * Camino REAL completo: `evidenceGateService.processAiFindings()`, ningún
 * mock de la propia regla, de `automation-signal-taxonomy.ts` ni de
 * `checkClaimConsistency` (J6) -- se reutilizan tal cual. `EvidenceIndex`
 * construido con `buildEvidenceIndex` real cuando el escenario exige
 * verificar valor (nunca un índice simulado a mano que aparente una
 * integración inexistente).
 *
 * Los 12 escenarios siguen exactamente la numeración de la auditoría
 * P1.7.3.1-CORRECTION, Fase 3.
 */

function finding(overrides: Partial<V2AuditFinding> = {}): V2AuditFinding {
  return {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    heuristicCode: 'N-01',
    heuristicName: 'Visibilidad del estado del sistema',
    description: 'El sistema no informa claramente del resultado de la acción.',
    evidence: [],
    affectedElement: { selector: 'button.contact-submit' },
    recommendation: 'Agregar retroalimentación visual tras la acción.',
    ...overrides,
  } as any;
}

/** Índice real con UN botón capturado (button.contact-submit), para los casos que exigen verificar property/value. */
function buildRealIndexWithSubmitButton() {
  return buildEvidenceIndex({
    evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [
      { selector: 'button.contact-submit', tag: 'button', text: 'Enviar', ariaLabel: 'Enviar formulario', role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any,
    ],
  });
}

/** Índice real con DOS botones distintos (para el escenario 8: evidencia real pero de OTRO elemento). */
function buildRealIndexWithTwoButtons() {
  return buildEvidenceIndex({
    evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [
      { selector: 'button.contact-submit', tag: 'button', text: 'Enviar', ariaLabel: 'Enviar formulario', role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any,
      { selector: 'button.newsletter-submit', tag: 'button', text: 'Suscribirme', ariaLabel: 'Suscribirme al boletín', role: 'button', isDisabled: false, isPrimary: false, iterations: [1] } as any,
    ],
  });
}

async function runTests() {
  console.log('🧪 Starting P1.7.3.1-CORRECTION — Automation Signal Protection (Gate Rule 0d) Adversarial Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ─── 1. Timeout + evidencia vacía -> NOT_EVALUABLE ──────────────────────
  {
    const f = finding({ description: 'La acción falló: Timeout 10000ms exceeded al intentar interactuar con el botón.', evidence: [] });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'NOT_EVALUABLE', '1. Timeout + evidencia vacía -> NOT_EVALUABLE (Gate Rule 0d, recommendedStatusForEvidence([])="NOT_EVALUABLE")');
  }

  // ─── 2. Selector inexistente + evidencia vacía -> NOT_EVALUABLE ─────────
  {
    const f = finding({ description: 'No fue posible localizar el elemento: selector not found durante la exploración.', evidence: [] });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'NOT_EVALUABLE', '2. "selector not found" + evidencia vacía -> NOT_EVALUABLE (Gate Rule 0d)');
  }

  // ─── 3. Error + evidencia incidental de `document` -> NOT_EVALUABLE ─────
  {
    const f = finding({
      description: 'El botón de enviar no respondió (timeout 10000ms exceeded).',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'document', attribute: 'title', value: 'Contacto - Mi Sitio' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'NOT_EVALUABLE', '3. Evidencia incidental de "document" ya NO basta -> NOT_EVALUABLE (isStrictlySelfGrounded excluye document/body, corrige P1.7.3.1-AUDIT hallazgo A)');
  }

  // ─── 4. Error + evidencia incidental de `body` -> NOT_EVALUABLE ─────────
  {
    const f = finding({
      description: 'El botón de enviar no respondió (timeout 10000ms exceeded).',
      evidence: [{ type: 'COMPUTED_STYLE', selector: 'body', property: 'fontFamily', value: 'Arial' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'NOT_EVALUABLE', '4. Evidencia incidental de "body" ya NO basta -> NOT_EVALUABLE (corrige hallazgo A)');
  }

  // ─── 5. Error + selector coincide, pero property/value NO observado -> NOT_EVALUABLE ──
  {
    const index = buildRealIndexWithSubmitButton();
    const f = finding({
      description: 'El botón no respondió (timeout); además, el DOM confirma que carece de aria-label.',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.contact-submit', attribute: 'ariaLabel', value: 'texto inventado que nunca existió' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '5. Selector correcto pero valor FABRICADO (no coincide con el real "Enviar formulario") -> NOT_EVALUABLE (checkClaimConsistency=INCONSISTENT, corrige hallazgo B)');
  }

  // ─── 6. Error + evidencia real, trazable y pertinente -> FAIL se conserva ──
  {
    const index = buildRealIndexWithSubmitButton();
    const f = finding({
      description: 'El botón no respondió (timeout); además, el DOM confirma su aria-label real.',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.contact-submit', attribute: 'ariaLabel', value: 'Enviar formulario' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '6. Valor citado coincide con el real (checkClaimConsistency=CONSISTENT) -> FAIL se conserva');
  }

  // ─── 7. Acción exitosa + evidencia DOM real que contradice el resultado esperado -> FAIL se conserva ──
  {
    const index = buildRealIndexWithSubmitButton();
    const f = finding({
      description: 'El botón de enviar carece de un nombre accesible programático adecuado.',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.contact-submit', attribute: 'ariaLabel', value: 'Enviar formulario' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '7. Sin lenguaje de automatización -> la Gate Rule 0d nunca se activa, FAIL se conserva por evidencia real');
  }

  // ─── 8. Evidencia DOM real, pero de OTRO elemento (no relacionada con la afirmación) -> NOT_EVALUABLE ──
  {
    const index = buildRealIndexWithTwoButtons();
    const f = finding({
      description: 'El botón de enviar no respondió (timeout 10000ms exceeded).',
      affectedElement: { selector: 'button.contact-submit' },
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.newsletter-submit', attribute: 'ariaLabel', value: 'Suscribirme al boletín' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '8. Evidencia real pero de OTRO botón (newsletter) no corrobora el problema del botón de enviar -> NOT_EVALUABLE (isStrictlySelfGrounded rechaza selector distinto)');
  }

  // ─── 9. PASS -> nunca se modifica ────────────────────────────────────────
  {
    const f = finding({
      status: 'PASS',
      description: 'A pesar de un timeout aislado, el botón muestra un estado de carga visible en las demás iteraciones.',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.contact-submit', attribute: 'aria-busy', value: 'true' } as any],
      recommendation: null,
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'PASS', '9. PASS con lenguaje de automatización en la descripción -> la Gate Rule 0d nunca actúa sobre PASS (guard `if (status === "FAIL")`)');
  }

  // ─── 10. NOT_EVALUABLE previo -> nunca se modifica ──────────────────────
  {
    const f = finding({
      status: 'NOT_EVALUABLE',
      confidence: 'high',
      description: 'No fue posible determinar el comportamiento: timeout durante la interacción.',
      evidence: [],
      recommendation: 'sugerencia',
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'NOT_EVALUABLE', '10a. NOT_EVALUABLE con lenguaje de automatización -> permanece NOT_EVALUABLE (la 0d solo evalúa FAIL)');
    assert(r.confidence === 'low', '10b. confidence se normaliza a low por la Gate Rule 1c preexistente, sin relación con la 0d');
  }

  // ─── 11. Hallazgo legítimo con "unknown error" pero con evidencia pertinente -> NO degradar ──
  {
    const index = buildRealIndexWithSubmitButton();
    const f = finding({
      heuristicCode: 'N-09',
      heuristicName: 'Ayudar a reconocer, diagnosticar y recuperarse de errores',
      description: 'El formulario muestra el mensaje genérico "unknown error" en el botón en vez de explicar qué campo falló.',
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.contact-submit', attribute: 'ariaLabel', value: 'Enviar formulario' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '11. "unknown error" citado en un hallazgo legítimo, con evidencia real y pertinente -> NO se degrada (falso positivo evitado)');
  }

  // ─── 12. El hallazgo no menciona ningún fallo de automatización -> nunca se degrada por ese motivo ──
  {
    // La Gate Rule 0d es ciega a `previousActions` (ver docstring del módulo
    // y el informe de auditoría): no puede saber si OTRO elemento falló
    // durante la exploración. Este caso confirma que un FAIL legítimo, cuya
    // propia `description` nunca menciona un fallo de automatización, nunca
    // se ve afectado por la 0d, sin importar qué haya ocurrido en otras
    // acciones de la misma evaluación.
    const index = buildRealIndexWithTwoButtons();
    const f = finding({
      description: 'El botón de suscripción al boletín carece de un nombre accesible programático.',
      affectedElement: { selector: 'button.newsletter-submit' },
      evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'button.newsletter-submit', attribute: 'ariaLabel', value: 'Suscribirme al boletín' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '12. FAIL sin lenguaje de automatización en su propia descripción -> nunca se degrada, aunque haya habido un fallo real en OTRO elemento durante la exploración (límite estructural documentado, no un bug)');
  }

  // ─── 13. Integración: orden correcto (0d antes de Gate Rule 1) y propagación a la consolidación de métricas ──
  {
    const findings: V2AuditFinding[] = [
      finding({ wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor', heuristicCode: undefined, heuristicName: undefined, description: 'Timeout al intentar verificar el estado del botón.', evidence: [] }),
      finding({ heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares', description: 'Los botones mantienen un estilo visual consistente.', status: 'PASS', evidence: [{ type: 'COMPUTED_STYLE', selector: 'button.contact-submit', property: 'backgroundColor', value: '#2e7d32' } as any], affectedElement: { selector: 'button.contact-submit' }, recommendation: null }),
    ];
    const gated = evidenceGateService.processAiFindings(findings);
    assert(gated[0].status === 'NOT_EVALUABLE', '13a. El FAIL basado en timeout llega degradado a la salida del Gate');
    assert(gated[1].status === 'PASS', '13b. El PASS legítimo no se ve afectado');

    const metrics = auditMetricsService.calculateMetrics(gated as any);
    assert(metrics.wcagMetrics.failCount === 0, `13c. La consolidación de métricas WEB NO cuenta el FAIL degradado como fallo real, obtenido=${metrics.wcagMetrics.failCount}`);
    assert(metrics.notEvaluableCount >= 1, `13d. El criterio degradado se refleja como NOT_EVALUABLE en el agregado final, obtenido=${metrics.notEvaluableCount}`);
  }

  // ─── 14. Gate Rule 0b conserva su comportamiento exacto (document/body siguen aceptados AHÍ) ──
  {
    // Caso ya cubierto por evidence-audit-engine.test.ts/adversarial-finding-integrity.test.ts
    // (regresión completa, sección de validación); aquí se confirma puntualmente
    // que la excepción contextual de 0b no fue tocada por este cambio.
    const f = finding({
      description: 'Los enlaces "Leer más" repiten el mismo texto sin distinguir su destino real.',
      evidence: [
        { type: 'DOM_ATTRIBUTE', selector: 'document', attribute: 'title', value: 'Blog - Mi Sitio' } as any, // contextual, sin lenguaje de automatización
      ],
      affectedElement: { selector: 'a.read-more-1' },
    });
    const [r] = evidenceGateService.processAiFindings([f]);
    assert(r.status === 'FAIL', '14. Gate Rule 0b (sin lenguaje de automatización) sigue aceptando evidencia contextual de "document" sin cambios -- la corrección de la 0d no afecta a 0b');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
