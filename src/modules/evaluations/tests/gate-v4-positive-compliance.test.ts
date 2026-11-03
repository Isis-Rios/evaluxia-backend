import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P1.6.6.3 — Gate Rule V4: enforcement determinístico de la POSITIVE
 * COMPLIANCE RULE incorporada al prompt. Un hallazgo PASS solo sobrevive
 * cuando AL MENOS un ítem de `evidence` aporta, en el MISMO objeto, tanto
 * `property` como `value` -- nunca basta con evidencia no vacía (eso ya lo
 * cubre la Gate Rule 1b preexistente) ni con `property`/`value` repartidos
 * entre ítems distintos. Prueba la función REAL `processPrototypeFindings`
 * directamente (mismo patrón que `dynamic-behavior-evidence-gate*.test.ts`),
 * sin ninguna llamada real a Gemini.
 *
 * P1.6.6.7 — el criterio por defecto de este archivo se cambió de
 * `WCAG 3.3.2` a `WCAG 2.4.6` (ambos "de etiquetas", para minimizar deriva
 * semántica en los textos de los casos). Motivo: la nueva Gate Rule V5
 * degrada CUALQUIER PASS/FAIL sobre WCAG 3.3.2 a NOT_EVALUABLE por
 * identidad de criterio, sin importar la estructura de la evidencia --
 * siguiera usando 3.3.2 aquí habría hecho que TODOS los casos de este
 * archivo (que prueban específicamente la lógica ESTRUCTURAL de V4, no la
 * de V5) terminaran en NOT_EVALUABLE por V5 antes de que V4 pudiera
 * decidir nada, invalidando el propósito original del archivo. WCAG 2.4.6
 * (Encabezados y etiquetas) es DIRECTLY_EVALUABLE y queda fuera del
 * alcance exacto de V5 (ver `NON_DEMONSTRABLE_FROM_IMAGE_WCAG_CRITERIA` en
 * `visual-evidence-gate.service.ts`), por lo que vuelve a aislar
 * correctamente el comportamiento de V4. La cobertura de V5 sobre WCAG
 * 3.3.2 específicamente ya se prueba en
 * `gate-v5-non-demonstrable-criteria.test.ts` (P1.6.6.7).
 */
function finding(overrides: Partial<PrototypeAuditFinding> = {}): PrototypeAuditFinding {
  return {
    findingGroup: 'ux',
    status: 'PASS',
    severity: 'info',
    confidence: 'high',
    wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
    description: 'El campo presenta una etiqueta visible persistente.',
    evidence: [],
    recommendation: null,
    ...overrides,
  } as PrototypeAuditFinding;
}

function runTests() {
  console.log('🧪 Starting Gate Rule V4 — Positive Compliance (P1.6.6.3) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- Caso 1: PASS con property y value válidos en el MISMO elemento -> sobrevive ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: 'Correo electrónico', elementDescription: 'etiqueta sobre el campo de correo electrónico', region: 'middle-right' }],
      }),
    ]);
    assert(result.status === 'PASS', 'Caso 1: PASS con property+value en el mismo ítem SOBREVIVE');
    assert(result.confidence === 'high', 'Caso 1: confidence no se altera cuando el PASS sobrevive');
  }

  // --- Caso 2: PASS con evidencia exclusivamente context -> se degrada ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'El formulario se ve correctamente etiquetado en general.', elementDescription: 'formulario de contacto' }],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 2: PASS respaldado solo por context narrativo (sin property/value) SE DEGRADA');
  }

  // --- Caso 3: PASS con property sin value -> se degrada ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', elementDescription: 'botón "Guardar"', region: 'bottom-right' } as any],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 3: PASS con property sin value SE DEGRADA');
  }

  // --- Caso 4: PASS con value sin property -> se degrada ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [{ type: 'VISUAL_OBSERVATION', value: 'Guardar cambios', elementDescription: 'botón principal del formulario', region: 'bottom-right' } as any],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 4: PASS con value sin property SE DEGRADA');
  }

  // --- Caso 5: PASS con property y value repartidos entre DOS elementos -> se degrada ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [
          { type: 'VISUAL_OBSERVATION', property: 'visibleText', elementDescription: 'botón principal del formulario', region: 'bottom-right' } as any,
          { type: 'VISUAL_OBSERVATION', value: 'Guardar cambios', elementDescription: 'texto dentro del botón principal', region: 'bottom-right' } as any,
        ],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 5: property en un ítem y value en OTRO ítem distinto NO cuentan juntos -- SE DEGRADA');
  }

  // --- Caso 6: PASS con varios elementos, uno de ellos estructurado correctamente -> sobrevive ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        evidence: [
          { type: 'VISUAL_OBSERVATION', context: 'El diseño general del formulario luce ordenado.', elementDescription: 'formulario de contacto' },
          { type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: 'Correo electrónico', elementDescription: 'etiqueta sobre el campo de correo electrónico', region: 'middle-right' },
        ],
      }),
    ]);
    assert(result.status === 'PASS', 'Caso 6: basta con QUE UN SOLO ítem sea estructurado -- no se exige que todos lo sean -- SOBREVIVE');
  }

  // --- Caso 7: PASS sin evidencia -> se degrada (ya cubierto por Gate Rule 1b, V4 no debe romperlo) ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({ evidence: [] }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 7: PASS sin ningún ítem de evidencia SE DEGRADA (Gate Rule 1b sigue intacta)');
  }

  // --- Caso 8: FAIL con evidencia narrativa (context-only) conserva el comportamiento previo (V4 nunca toca FAIL) ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        status: 'FAIL',
        severity: 'medium',
        recommendation: 'Agregar una etiqueta visible persistente.',
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observa ninguna etiqueta visible junto al campo.', elementDescription: 'campo de correo electrónico', region: 'middle-right' }],
      }),
    ]);
    assert(result.status === 'FAIL', 'Caso 8: un FAIL con evidencia 100% context (sin property/value) NO es tocado por Gate Rule V4 -- comportamiento previo intacto');
  }

  // --- Caso 9: NOT_EVALUABLE conserva el comportamiento previo (V4 nunca lo toca, ya está degradado) ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        status: 'NOT_EVALUABLE',
        confidence: 'low',
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se puede determinar desde esta imagen.', elementDescription: 'formulario de contacto' }],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 9: un hallazgo ya NOT_EVALUABLE permanece NOT_EVALUABLE -- Gate Rule V4 no lo afecta');
  }

  // --- Caso 10: las reglas V0-V3 continúan funcionando junto a V4 ---
  {
    // V0 (identidad): ningún ítem con elementDescription/context -> NOT_EVALUABLE, incluso si hubiera property+value.
    const [v0] = visualEvidenceGateService.processPrototypeFindings([
      finding({ evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Guardar' } as any] }),
    ]);
    assert(v0.status === 'NOT_EVALUABLE', 'Caso 10a: Gate Rule V0 (identidad) sigue degradando evidencia sin elementDescription/context, incluso con property+value');

    // V2 (tope de confianza en contraste cualitativo bajo) sigue aplicando, status-agnóstico, a un FAIL.
    const [v2] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        status: 'FAIL',
        confidence: 'high',
        recommendation: 'Aumentar el contraste.',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'texto del encabezado', region: 'top-center' }],
      }),
    ]);
    assert(v2.confidence === 'medium', 'Caso 10b: Gate Rule V2 (tope de confianza en contraste cualitativo) sigue activa sin interferencia de V4');

    // V3 (severidad -> info en NOT_EVALUABLE) sigue aplicando sobre un NOT_EVALUABLE genuino de Gemini.
    const [v3] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        status: 'NOT_EVALUABLE',
        severity: 'high',
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No es posible determinarlo.', elementDescription: 'formulario' }],
      }),
    ]);
    assert(v3.severity === 'info', 'Caso 10c: Gate Rule V3 (severidad -> info en NOT_EVALUABLE) sigue activa sin interferencia de V4');
  }

  // --- Caso 11: la degradación de V4 conserva el resto de la información del hallazgo ---
  {
    const original = finding({
      wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
      description: 'El campo de correo electrónico presenta una etiqueta visible situada encima del control.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'Se ve bien etiquetado en general.', elementDescription: 'campo de correo electrónico' }],
    });
    const [result] = visualEvidenceGateService.processPrototypeFindings([original]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 11 (precondición): el hallazgo efectivamente se degrada');
    assert(result.wcagCriterion === original.wcagCriterion, 'Caso 11: wcagCriterion se conserva intacto tras la degradación');
    assert(result.description === original.description, 'Caso 11: description se conserva intacta -- Gate Rule V4 nunca reescribe ni antepone un prefijo (a diferencia de la Gate Rule V1)');
    assert(JSON.stringify(result.evidence) === JSON.stringify(original.evidence.map((e) => ({ ...e }))), 'Caso 11: evidence se conserva intacta (mismo contenido, sin propiedades fuera de whitelist que sanear en este caso)');
    assert(result.recommendation === null, 'Caso 11: recommendation queda null para un status final distinto de FAIL (comportamiento preexistente del return final de la función)');
  }

  // --- Caso 12: la severidad de NOT_EVALUABLE sigue normalizándose según Gate V3 tras una degradación de V4 ---
  {
    const [result] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        severity: 'critical', // Gemini asignó una severidad no-neutral a un PASS mal evidenciado
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'Parece estar perfectamente etiquetado.', elementDescription: 'formulario completo' }],
      }),
    ]);
    assert(result.status === 'NOT_EVALUABLE', 'Caso 12 (precondición): el PASS mal evidenciado se degrada');
    assert(result.severity === 'info', 'Caso 12: la severidad se normaliza a "info" por Gate Rule V3, incluso cuando la degradación la disparó Gate Rule V4 (no V1)');
    assert(result.confidence === 'low', 'Caso 12: la confianza se normaliza a "low" por Gate Rule 1c/V4');
  }

  // ------------------------------------------------------------------
  // Integración: Gate V4 -> calculatePrototypeMetrics (sección 5 del
  // encargo P1.6.6.3). Nunca se modifica `prototype-metrics.service.ts`
  // en esta fase -- se prueba su comportamiento REAL, sin cambios,
  // alimentado con la salida REAL del gate ya corregido.
  // ------------------------------------------------------------------

  // --- Un PASS genuino con evidencia estructurada llega intacto a calculatePrototypeMetrics y cuenta como cumplimiento ---
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: 'Correo electrónico', elementDescription: 'etiqueta sobre el campo de correo electrónico', region: 'middle-right' }],
      }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(gated[0].status === 'PASS', 'Integración: el PASS genuino sigue siendo PASS tras pasar por el gate');
    assert(metrics.passCount === 1 && metrics.failCount === 0, 'Integración: un PASS genuino con evidencia estructurada SÍ se contabiliza como cumplimiento en calculatePrototypeMetrics (passCount=1)');
    // 1/13 criterios evaluados, 100% de cumplimiento, 0 penalización ->
    // overallScore=54, idéntico al escenario 8 ya validado con la función
    // real en la auditoría P1.6.6.
    assert(metrics.overallScore === 54, `Integración: overallScore=54 (1/13 evaluado, 100% cumplimiento), igual que el escenario 8 de P1.6.6 (obtenido: ${metrics.overallScore})`);
  }

  // --- Un PASS degradado a NOT_EVALUABLE por Gate V4 NUNCA se contabiliza como cumplimiento ---
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'El formulario se ve correctamente etiquetado en general.', elementDescription: 'formulario de contacto' }],
      }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(gated[0].status === 'NOT_EVALUABLE', 'Integración: el PASS sin evidencia estructurada fue degradado por Gate V4 antes de llegar a las métricas');
    assert(metrics.passCount === 0 && metrics.failCount === 0, 'Integración: un PASS degradado a NOT_EVALUABLE NO se contabiliza como cumplimiento (passCount=0)');
    assert(metrics.overallScore === null, `Integración: con el único criterio mencionado en NOT_EVALUABLE, evaluated=0 -> overallScore=null, nunca un número que sugiera cumplimiento (obtenido: ${metrics.overallScore})`);
  }

  // --- La consolidación FAIL > PASS > NOT_EVALUABLE de P1.6.6.1 sigue funcionando con salida real del gate ---
  {
    // Mismo criterio: un PASS genuino (sobrevive el gate) + un FAIL genuino -- FAIL debe dominar, igual que antes de esta fase.
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: 'Correo electrónico', elementDescription: 'etiqueta sobre el campo de correo electrónico', region: 'middle-right' }],
      }),
      finding({
        status: 'FAIL',
        severity: 'high',
        recommendation: 'Agregar una etiqueta visible persistente al campo de nombre.',
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: '', elementDescription: 'campo de nombre', region: 'middle-right' }],
      }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(metrics.failCount === 1 && metrics.passCount === 0, 'Integración: PASS genuino + FAIL genuino en el MISMO criterio -- FAIL domina (política FAIL > PASS > NOT_EVALUABLE de P1.6.6.1 intacta)');
    assert(metrics.highCount === 1, 'Integración: la severidad del FAIL consolidado se preserva correctamente');
  }

  // --- La política de persistencia P1.5.2 no cambia: un PASS genuino que sobrevive el gate sigue cumpliendo
  // exactamente la condición que `prototype-evaluation.service.ts` usa para excluirlo de la persistencia
  // de Finding (`if (f.status === 'PASS') continue;`, no modificada en esta fase) ---
  {
    const survivingPass = visualEvidenceGateService.processPrototypeFindings([
      finding({ evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: 'Correo electrónico', elementDescription: 'etiqueta sobre el campo', region: 'middle-right' }] }),
    ])[0];
    assert(survivingPass.status === 'PASS', 'Integración: un PASS genuino que sobrevive Gate Rule V4 sigue satisfaciendo `status === \'PASS\'`, la misma condición -- no modificada en esta fase -- por la que P1.5.2 lo excluye de la persistencia de Finding');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
