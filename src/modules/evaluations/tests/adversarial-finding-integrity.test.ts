import { V2AuditFindingSchema, V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { evidenceGateService } from '../services/evidence-gate.service';
import { buildEvidenceIndex } from '../services/evidence-traceability.service';
import { checkClaimConsistency } from '../services/evidence-claim-consistency.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { auditMetricsService, InputAuditFinding } from '../services/audit-metrics.service';
import { deterministicAnalyzer } from '../services/deterministic-analyzer.service';

/**
 * Fase K — Parte U: Adversarial Finding Integrity Suite.
 *
 * Objetivo: comprobar SEMÁNTICA real del sistema (qué pasa de verdad),
 * no solo que una función devuelve un objeto. Cada test documenta si el
 * comportamiento observado es (a) una protección ya existente, (b) una
 * protección NUEVA de esta fase (Gate Rule 0b, Parte B), o (c) un
 * comportamiento PERMITIDO hoy, documentado deliberadamente sin corregir
 * (Parte C -- el contrato semántico del schema no se endurece en esta fase
 * sin poder validarlo contra Gemini real).
 *
 * Gemini calls: 0. Todo sintético/determinístico.
 */

function index2Images() {
  return buildEvidenceIndex({
    evidencesSummary: [{
      iteration: 1, headings: [], forms: [],
      images: [
        { selector: '#img-A', src: '/a.png', alt: 'Alt real de A', ariaLabel: null, role: null, isDecorative: false } as any,
        { selector: '#img-B', src: '/b.png', alt: 'Alt real de B', ariaLabel: null, role: null, isDecorative: false } as any,
      ],
      computedStyles: [],
    }],
    dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
  });
}

function buildEvidenceIndexForB7() {
  return buildEvidenceIndex({
    evidencesSummary: [{ iteration: 1, headings: [], forms: [], images: [], computedStyles: [] }],
    dedupedLandmarks: [], dedupedLinks: [],
    dedupedButtons: [{ selector: '#btn-A', tag: 'button', text: null, ariaLabel: 'Guardar', role: null, isDisabled: false, isPrimary: false, iterations: [1] } as any],
  });
}

function finding(overrides: Partial<V2AuditFinding>): V2AuditFinding {
  return {
    findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
    description: 'desc', evidence: [], recommendation: 'fix it',
    ...overrides,
  } as V2AuditFinding;
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

function runAdversarialSuite() {
  console.log('🧪 Starting Fase K — Adversarial Finding Integrity Suite...\n');
  const index = index2Images();

  // Caso 1: affectedElement=A, evidence.selector=B (SIN grounding propio) -> degrada (Gate Rule 0b, NUEVO esta fase).
  {
    const f = finding({
      affectedElement: { tag: 'img', selector: '#img-A' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de B', selector: '#img-B' }],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 1: evidencia 100% de un elemento DISTINTO (sin grounding propio) -> degradado (Gate Rule 0b).', r);
  }

  // Caso 2: selector correcto (A), pero el VALOR citado es en realidad el de B -> INCONSISTENT (J6 YA existente, sin cambios esta fase).
  {
    const f = finding({
      affectedElement: { tag: 'img', selector: '#img-A' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de B', selector: '#img-A' }],
    });
    const [afterJ1] = evidenceGateService.processAiFindings([f], index);
    const j6 = checkClaimConsistency(afterJ1, index);
    expect(j6.overallStatus === 'INCONSISTENT', 'Caso 2: selector correcto, valor real de OTRO elemento -> INCONSISTENT (J6 ya lo detecta, sin cambios).', j6);
  }

  // Caso 3: selector inexistente -> no trazable (J1 YA existente).
  {
    const f = finding({ affectedElement: { tag: 'img', selector: '#no-existe' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'x', selector: '#no-existe' }] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 3: selector inexistente -> NOT_EVALUABLE (J1, ya existente).', r);
  }

  // Caso 4: selector correcto, propiedad inexistente -> PROPERTY_NOT_FOUND (J6 YA existente).
  {
    const f = finding({ affectedElement: { tag: 'img', selector: '#img-A' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'noExiste', value: 'x', selector: '#img-A' }] });
    const [afterJ1] = evidenceGateService.processAiFindings([f], index);
    const j6 = checkClaimConsistency(afterJ1, index);
    expect(j6.items[0].status === 'PROPERTY_NOT_FOUND', 'Caso 4: propiedad inexistente -> PROPERTY_NOT_FOUND (J6, ya existente).', j6);
  }

  // Caso 5: evidencia válida (selector+property+value correctos) -> pasa limpio.
  {
    const f = finding({ affectedElement: { tag: 'img', selector: '#img-A' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de A', selector: '#img-A' }] });
    const [afterJ1] = evidenceGateService.processAiFindings([f], index);
    const j6 = checkClaimConsistency(afterJ1, index);
    expect(afterJ1.status === 'FAIL' && j6.overallStatus === 'CONSISTENT', 'Caso 5: evidencia válida -> FAIL se conserva, J6 CONSISTENT.', { status: afterJ1.status, j6: j6.overallStatus });
  }

  // Caso 6: evidencia CONTEXTUAL legítima de varios elementos (comparación) -- al menos
  // un ítem SÍ corresponde al propio affectedElement (grounding real) + un ítem
  // comparativo de otro elemento -> Gate Rule 0b NO degrada (no rompe este caso real,
  // ya observado en Gemini Real #1: finding N-04 sobre los 2 enlaces "Leer más").
  {
    const f = finding({
      affectedElement: { tag: 'img', selector: '#img-A' },
      evidence: [
        { type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de A', selector: '#img-A' },
        { type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de B', selector: '#img-B' },
      ],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    expect(r.status === 'FAIL', 'Caso 6: evidencia comparativa de OTRO elemento, CON grounding propio real -> NO degrada (caso legítimo preservado).', r);
  }

  // Caso 7: PASS + evidence=[] -- el schema de ENTRADA lo permite (ningún
  // refine restringe PASS, a diferencia de FAIL). [ACTUALIZADO K.1, Parte
  // A]: Gate Rule 1b (nueva) ahora degrada esto simétricamente a como ya
  // degradaba FAIL+evidence=[] -- un PASS sin ninguna evidencia es una
  // afirmación tan infundada como un FAIL sin evidencia.
  {
    const parsed = V2AuditFindingSchema.safeParse({ findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', description: 'ok', evidence: [] });
    expect(parsed.success === true, 'Caso 7: PASS + evidence=[] -- el schema de entrada lo permite.', parsed);
    const [r] = evidenceGateService.processAiFindings([finding({ status: 'PASS', evidence: [] })], index);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 7b [ACTUALIZADO K.1]: Gate Rule 1b degrada PASS sin evidencia a NOT_EVALUABLE (tratamiento simétrico a FAIL+evidence=[]).', r);
  }

  // K.1.1 Parte A — auditoría de Gate Rule 1b: 5 tests de regresión mínimos
  // exigidos, confirmando que NINGÚN PASS legítimo se degrada incorrectamente.
  {
    // 1. PASS + evidence ESTRUCTURADA real -> permanece PASS.
    const f1 = finding({ status: 'PASS', affectedElement: { tag: 'img', selector: '#img-A' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de A', selector: '#img-A' }] });
    const [r1] = evidenceGateService.processAiFindings([f1], index);
    expect(r1.status === 'PASS', 'A2.1: PASS + evidence estructurada real -> permanece PASS.', r1);

    // 2. PASS + evidence=[] -> NOT_EVALUABLE (ya confirmado en Caso 7b, reconfirmado aquí explícitamente para la lista A2).
    const f2 = finding({ status: 'PASS', evidence: [] });
    const [r2] = evidenceGateService.processAiFindings([f2], index);
    expect(r2.status === 'NOT_EVALUABLE', 'A2.2: PASS + evidence=[] -> NOT_EVALUABLE.', r2);

    // 3. Deterministic PASS válido -> permanece PASS. Confirmado ARQUITECTÓNICAMENTE
    // (deterministicFindings NUNCA pasa por processAiFindings, ver audit-engine.service.ts
    // línea ~97 vs ~174) Y EMPÍRICAMENTE (los 7 branches PASS de deterministic-analyzer.service.ts
    // SIEMPRE citan evidencia, confirmado por conteo estático: 7 "status: 'PASS'" == 7 "evidence:").
    // Por eso, INCLUSO SI se pasaran por el gate (hipotéticamente), seguirían sobreviviendo.
    const detEv = { iteration: 1, url: 'https://fixture.local/a2', screenshotPath: '/x.png', headings: [], images: [{ selector: '#img-det', src: '/d.png', alt: 'Descripción real', ariaLabel: null, role: null, isDecorative: false }], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] };
    const detFindings = deterministicAnalyzer.analyzeSnapshots([detEv] as any);
    const detPass = detFindings.find((f) => f.status === 'PASS' && f.affectedElement?.selector === '#img-det');
    expect(detPass !== undefined && !!detPass.evidence?.length, 'A2.3: deterministic PASS real (analyzeImages) siempre cita evidencia -> sobreviviría Gate Rule 1b incluso si se le aplicara (no se le aplica hoy, por diseño arquitectónico).', detPass);

    // 4. AI PASS válido (con evidencia real) -> permanece PASS (mismo mecanismo que #1, confirmado con otro tipo de evidencia -- ariaLabel en vez de alt).
    const f4 = finding({ status: 'PASS', affectedElement: { tag: 'button', selector: '#btn-A' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Guardar', selector: '#btn-A' }] });
    const [r4] = evidenceGateService.processAiFindings([f4], buildEvidenceIndexForB7());
    expect(r4.status === 'PASS', 'A2.4: AI PASS con evidencia real (ariaLabel="Guardar", coincide con el dato real) -> permanece PASS.', r4);

    // 5. PASS page-level (sin affectedElement.selector) pero CON evidencia real -> no se degrada incorrectamente
    // solo por ser page-level (Gate Rule 1b solo mira evidence.length, nunca la presencia de selector).
    const f5 = finding({ status: 'PASS', affectedElement: {}, evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', value: 'Iniciar sesión', selector: 'h1' }] });
    const [r5] = evidenceGateService.processAiFindings([f5], index);
    expect(r5.status === 'PASS', 'A2.5: PASS page-level (sin affectedElement.selector) pero CON evidencia real -> no se degrada incorrectamente solo por ser page-level.', r5);
  }

  // Caso 8: FAIL + evidence=[] -> degrada (Gate Rule 1, ya existente).
  {
    const [r] = evidenceGateService.processAiFindings([finding({ status: 'FAIL', evidence: [] })], index);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 8: FAIL + evidence=[] -> NOT_EVALUABLE (Gate Rule 1, ya existente).', r);
  }

  // Caso 9: NOT_EVALUABLE + confidence=high -- el schema de ENTRADA lo permite.
  // [ACTUALIZADO K.1, Parte A]: Gate Rule 1c (nueva) ahora normaliza confidence='low'
  // para CUALQUIER NOT_EVALUABLE que llegue a la salida de J1, sin importar su origen
  // (una abstención con confidence alta es semánticamente incoherente).
  {
    const parsed = V2AuditFindingSchema.safeParse({ findingGroup: 'accessibility', status: 'NOT_EVALUABLE', severity: 'info', confidence: 'high', description: 'no se pudo evaluar', evidence: [], recommendation: 'sugerencia' });
    expect(parsed.success === true, 'Caso 9: NOT_EVALUABLE + confidence=high + recommendation -- el schema de entrada lo permite.', parsed);
    const [r] = evidenceGateService.processAiFindings([finding({ status: 'NOT_EVALUABLE', confidence: 'high', recommendation: 'sugerencia' })], index);
    expect(r.confidence === 'low', 'Caso 9b [ACTUALIZADO K.1]: Gate Rule 1c normaliza confidence="low" para TODO NOT_EVALUABLE, sin importar si llegó así desde Gemini o fue degradado por un gate.', r);
  }

  // Caso 10: NOT_EVALUABLE + recommendation -- descubierto durante esta prueba (no asumido):
  // el paso 4, preexistente, de `processAiFindings` ("Do not persist NOT_EVALUABLE or PASS as
  // negative FAIL findings") ya anula `recommendation` para CUALQUIER status distinto de FAIL,
  // sin importar si llegó así desde Gemini o fue degradado por un gate -- por lo tanto
  // `recommendation` NUNCA sobrevive hasta la salida de J1 para un NOT_EVALUABLE, aunque el
  // schema de ENTRADA sí lo permita. Esto es una protección ya existente (no nueva de esta
  // fase), ahora confirmada explícitamente en vez de asumida.
  {
    const [r] = evidenceGateService.processAiFindings([finding({ status: 'NOT_EVALUABLE', confidence: 'high', recommendation: 'sugerencia' })], index);
    expect(r.recommendation === null, 'Caso 10: recommendation SIEMPRE se anula para status != FAIL (paso 4, ya existente) -- NOT_EVALUABLE nunca persiste una recomendación, sin importar si llegó así desde Gemini.', r);
  }

  // Caso 11/12: WCAG + findingGroup=ux (o viceversa) -- PERMITIDO por el schema, ningún gate
  // valida la coherencia cruzada findingGroup<->heuristicCode/wcagCriterion. Documentado.
  {
    const parsed = V2AuditFindingSchema.safeParse({ findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', description: 'x', wcagCriterion: 'WCAG 1.1.1', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'null' }], recommendation: 'y' });
    expect(parsed.success === true, 'Caso 11/12: findingGroup="ux" con wcagCriterion set (o viceversa) -- el schema lo permite, sin superRefine cruzado (documentado, no corregido).', parsed);
  }

  // Caso 13: múltiples códigos WCAG en un mismo criterio -> degrada (cardinalidad, ya existente).
  {
    const f: any = { wcagCriterion: 'WCAG 1.3.1 + WCAG 4.1.2', status: 'FAIL', confidence: 'high', recommendation: 'y' };
    const { findings: [r] } = applyCardinalityEnforcement([f]);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 13: múltiples códigos WCAG combinados -> NOT_EVALUABLE (cardinalidad, ya existente).', r);
  }

  // K.1 Parte B7: selector CORRECTO (A), property correcta (ariaLabel), pero el VALOR
  // citado es el de otra propiedad/estado -- ejemplo literal del pedido: A.ariaLabel
  // real = "Guardar", el finding cita ariaLabel="Eliminar" para el MISMO selector A.
  // El selector es correcto; la evidencia NO lo es -- debe detectarse (J6, ya existente,
  // mecanismo idéntico a Caso 2, confirmado aquí con el ejemplo exacto solicitado).
  {
    const btnIndex = buildEvidenceIndexForB7();
    const f = finding({
      affectedElement: { tag: 'button', selector: '#btn-A' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Eliminar', selector: '#btn-A' }],
    });
    const [afterJ1] = evidenceGateService.processAiFindings([f], btnIndex);
    const j6 = checkClaimConsistency(afterJ1, btnIndex);
    expect(j6.overallStatus === 'INCONSISTENT', 'K.1 Parte B7: selector correcto (A), property correcta (ariaLabel), valor incorrecto ("Eliminar" cuando el real es "Guardar") -> INCONSISTENT, detectado por J6.', j6);
  }

  // K.1 Parte B6 (variante): evidence=[B,C] -- DOS ítems, AMBOS de elementos ajenos,
  // CERO grounding propio -> debe rechazarse/degradarse igual que con un solo ítem ajeno (Caso 1).
  {
    const f = finding({
      affectedElement: { tag: 'img', selector: '#img-A' },
      evidence: [
        { type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de A', selector: '#img-B' },
        { type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Alt real de A', selector: '#img-B' },
      ],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    expect(r.status === 'NOT_EVALUABLE', 'K.1 Parte B6: evidence=[B,C] (2 ítems, ambos de un elemento ajeno, cero grounding propio) -> degradado igual que con 1 solo ítem ajeno (Caso 1).', r);
  }

  // Casos 14-17, 20: política de consolidación determinístico/IA -- ya cubiertos
  // exhaustivamente en audit-metrics-consolidation-policy.test.ts (19 aserciones,
  // Fase de Hardening anterior). Se confirma aquí SOLO la combinación que faltaba
  // explícitamente en esta lista (deterministic PASS + AI NOT_EVALUABLE).
  {
    const det: InputAuditFinding = { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', description: 'det', wcagCriterion: 'WCAG 2.4.4', affectedElement: { selector: '#x' }, evidence: [], iteration: 1, origin: 'deterministic' };
    const ai: InputAuditFinding = { findingGroup: 'accessibility', status: 'NOT_EVALUABLE', severity: 'medium', confidence: 'low', description: 'ai abstiene', wcagCriterion: 'WCAG 2.4.4', affectedElement: { selector: '#x' }, evidence: [], iteration: 1, origin: 'ai' };
    const [c] = auditMetricsService.deduplicateFindings([det, ai]);
    expect(c.status === 'PASS' && c.discrepancy === undefined, 'Caso 17: deterministic PASS + AI NOT_EVALUABLE -> el decisivo (PASS) se conserva, sin discrepancy (abstención no es contra-afirmación). Casos 14-16/20 ya cubiertos en audit-metrics-consolidation-policy.test.ts.', c);
  }

  // Caso 18: evidencia de un elemento INVISIBLE (display:none/aria-hidden) -- NO existe
  // filtro de visibilidad en ninguna etapa (confirmado en la auditoría de extracción,
  // Fase de Hardening). Un finding sobre un elemento oculto se procesa EXACTAMENTE
  // igual que uno visible -- ningún gate lo distingue. Documentado como riesgo P1,
  // deliberadamente NO corregido esta fase (Parte D: "no implementar todavía solución
  // universal de visibilidad").
  {
    const hiddenIndex = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], forms: [], images: [{ selector: '#img-hidden', src: '/h.png', alt: null, ariaLabel: null, role: null, isDecorative: false } as any], computedStyles: [] }],
      dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
    });
    const f = finding({ affectedElement: { tag: 'img', selector: '#img-hidden' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'null', selector: '#img-hidden' }] });
    const [r] = evidenceGateService.processAiFindings([f], hiddenIndex);
    expect(r.status === 'FAIL', 'Caso 18: un finding sobre un elemento potencialmente invisible (ningún campo de visibilidad existe en la evidencia) se procesa IGUAL que uno visible -- riesgo documentado (P1), no corregido.', r);
  }

  // Caso 19: evidencia "fuera de cobertura" (ej. dentro de un iframe/shadow DOM que la
  // extracción nunca captura) es ESTRUCTURALMENTE INDISTINGUIBLE de un selector
  // simplemente inexistente -- ambos resultan en el MISMO status (NOT_EVALUABLE vía
  // J1 "no trazable"). No existe hoy un status distinto OUT_OF_COVERAGE/UNOBSERVABLE
  // (Parte Q) -- documentado como limitación conceptual, no corregido.
  {
    const f = finding({ affectedElement: { tag: 'div', selector: '#dentro-de-iframe-nunca-capturado' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'x', selector: '#dentro-de-iframe-nunca-capturado' }] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    expect(r.status === 'NOT_EVALUABLE', 'Caso 19: selector "fuera de cobertura" (iframe/shadow DOM no capturado) produce el MISMO NOT_EVALUABLE que un selector simplemente inexistente -- sin distinción OUT_OF_COVERAGE (documentado, Parte Q).', r);
  }

  console.log(`\n🎉 ALL Fase K — Adversarial Finding Integrity Suite tests passed (${passed} assertions).`);
  process.exit(0);
}

runAdversarialSuite();
