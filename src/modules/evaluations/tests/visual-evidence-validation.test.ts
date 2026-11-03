import fs from 'fs';
import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { checkVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P3 — Visual Evidence Traceability (Gate Rule V0) + Visual Evidence
 * Consistency. Cubre los 10 casos obligatorios de la sección 27 del prompt
 * de implementación, directamente derivados de los casos A-F cerrados en
 * K.2.1.1.
 */
function finding(overrides: Partial<PrototypeAuditFinding> = {}): PrototypeAuditFinding {
  return {
    findingGroup: 'ux',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'Problema visual observado.',
    evidence: [],
    recommendation: 'Recomendación accionable.',
    ...overrides,
  } as PrototypeAuditFinding;
}

function runTests() {
  console.log('🧪 Starting Visual Evidence Validation (P3) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 1. Evidencia válida -- sobrevive el gate sin degradar
  const [valid] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' }],
      affectedElement: { visualReference: { description: 'botón Guardar', region: 'middle-left' } },
    }),
  ]);
  assert(valid.status === 'FAIL', 'Evidencia visual válida (con identidad + región coherente) sobrevive el gate como FAIL');

  // 2. Evidencia sin description/context -- degradada (Gate Rule V0, parte 1)
  const [noIdentity] = visualEvidenceGateService.processPrototypeFindings([
    finding({ evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Guardar' } as any] }),
  ]);
  assert(noIdentity.status === 'NOT_EVALUABLE', 'Finding con evidencia SIN elementDescription ni context es degradado a NOT_EVALUABLE');

  // 3. Region "inválida" llegada por algún camino que evadiera Zod -- el
  // gate no revalida el enum en sí (responsabilidad de Zod), pero SÍ
  // valida coherencia region-propia vs region-de-evidencia (caso 7 abajo).
  // Caso 3 del checklist se cubre ya en prototype-contracts.test.ts (P0).

  // 4. property inválida -- sanitizada por el gate (defensa adicional, redundante con Zod)
  const [invalidProp] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      status: 'PASS',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón', property: 'ariaLabel' as any, value: 'x' }],
    }),
  ]);
  assert(invalidProp.evidence![0].property === undefined, 'Una property fuera de whitelist es sanitizada (defensa adicional del gate, redundante con Zod)');

  // 5. property sin value -- ya bloqueado por Zod (P0); aquí confirmamos que
  // un ítem sin property/value es NOT_CHECKABLE en Consistency, no un crash.
  const consistencyNoPropValue = checkVisualEvidenceConsistency(
    finding({ evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar' } as any] }),
  );
  assert(consistencyNoPropValue.items[0].status === 'NOT_CHECKABLE', 'Ítem sin property/value es NOT_CHECKABLE en VisualEvidenceConsistency');

  // 6. Identidad inequívoca + mismo valor -> CONSISTENT (Caso A, K.2.1.1)
  const caseA = checkVisualEvidenceConsistency(
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' },
      ],
    }),
  );
  assert(caseA.overallStatus === 'CONSISTENT', 'Caso A: misma descripción específica + mismo valor -> CONSISTENT');

  // 7. Identidad inequívoca + valor diferente -> INCONSISTENT (Caso B, K.2.1.1)
  const caseB = checkVisualEvidenceConsistency(
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Cancelar' },
      ],
    }),
  );
  assert(caseB.overallStatus === 'INCONSISTENT', 'Caso B: misma descripción específica + valores distintos -> INCONSISTENT');

  // 8. Misma región + elementos diferentes (sin descripción) -> NOT_CHECKABLE,
  // NUNCA INCONSISTENT (Caso C, K.2.1.1 -- region nunca es identidad)
  const caseC = checkVisualEvidenceConsistency(
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', region: 'middle-left', property: 'visibleText', value: 'Guardar', context: 'barra de acciones' },
        { type: 'VISUAL_OBSERVATION', region: 'middle-left', property: 'visibleText', value: 'Cancelar', context: 'barra de acciones' },
      ],
    }),
  );
  assert(caseC.overallStatus !== 'INCONSISTENT', 'Caso C: misma región, SIN descripción específica -> nunca INCONSISTENT (region no es identidad)');
  assert(caseC.items.every((i) => i.status === 'NOT_CHECKABLE'), 'Caso C: ambos ítems quedan NOT_CHECKABLE (sin identidad suficiente)');

  // 9. Descripción genérica ("botón") -> NOT_CHECKABLE (Caso D, K.2.1.1)
  const caseD = checkVisualEvidenceConsistency(
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón', region: 'middle-left', property: 'visibleText', value: 'Guardar' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón', region: 'middle-left', property: 'visibleText', value: 'Cancelar' },
      ],
    }),
  );
  assert(caseD.overallStatus !== 'INCONSISTENT', 'Caso D: descripción genérica ("botón") -> nunca INCONSISTENT');
  assert(caseD.items.every((i) => i.status === 'NOT_CHECKABLE'), 'Caso D: ambos ítems con descripción genérica son NOT_CHECKABLE');

  // 10. Finding compuesto de dos elementos (Caso F, K.2.1.1: "2 enlaces Leer
  // más") -- descripciones específicas DISTINTAS, mismo property/value ->
  // nunca se comparan entre sí, no genera falsa inconsistencia.
  const caseF = checkVisualEvidenceConsistency(
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'enlace Leer más (tarjeta 1)', property: 'visibleText', value: 'Leer más' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'enlace Leer más (tarjeta 2)', property: 'visibleText', value: 'Leer más' },
      ],
    }),
  );
  assert(caseF.overallStatus === 'CONSISTENT', 'Caso F: 2 elementos con descripciones específicas distintas (mismo valor) -> CONSISTENT, sin falsa inconsistencia');

  // [Revisión MVP, post-P7.5.2] DEFECTO REAL encontrado en la revisión
  // funcional consolidada: un finding cuya evidencia es 100%
  // elementDescription/context (SIN ningún property+value en ningún ítem
  // -- exactamente el patrón que la regla 7 del prompt, ai.service.ts,
  // EXPLÍCITAMENTE le pide a Gemini usar cuando ninguna property de la
  // whitelist representa fielmente lo observado, ej. un problema de
  // usabilidad N-04/N-02/N-06 sin una property visual asociada) se
  // degradaba SIEMPRE a NOT_EVALUABLE en applyVisualEvidenceConsistency,
  // incluso con identidad específica y clara -- no por una contradicción
  // real, sino porque la función nunca distinguía "no hay ninguna
  // afirmación property=value que verificar" de "hay una afirmación sin
  // identidad suficiente". Combinado con que solo los findings FAIL se
  // persisten (prototype-evaluation.service.ts), esto hacía desaparecer
  // findings correctamente evidenciados sin ningún rastro.
  const { applyVisualEvidenceConsistency: applyConsistencyForContextOnly } = require('@/modules/evaluations/services/visual-evidence-consistency.service');

  // 1. 100% context-only, identidad específica -> YA NO degrada (CORRECCIÓN).
  const contextOnlyFinding = finding({
    status: 'FAIL',
    description: 'Dos botones distintos usan el mismo texto "Enviar" para acciones diferentes, sin ninguna propiedad visual de la whitelist que capture la ambigüedad semántica en sí.',
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar del formulario de contacto', context: 'Pertenece a la tarjeta del formulario de contacto.' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar de la sección de boletín', context: 'Pertenece a la sección de suscripción, fuera de la tarjeta principal.' },
    ],
  });
  const [contextOnlyGated] = visualEvidenceGateService.processPrototypeFindings([contextOnlyFinding]);
  const { findings: contextOnlyFinal } = applyConsistencyForContextOnly([contextOnlyGated]);
  assert(contextOnlyFinal[0].status === 'FAIL', '[CORRECCIÓN MVP] Finding 100% context-only (sin NINGÚN property+value) con identidad específica ya NO se degrada a NOT_EVALUABLE -- no hay ninguna afirmación property=value que esta función pueda contradecir');

  // 2. Caso mixto -- un ítem context-only + un ítem con property+value pero
  // descripción genérica -- SIGUE degradando (comportamiento existente
  // intacto: SÍ hay una afirmación property=value sin identidad suficiente).
  const mixedInsufficientFinding = finding({
    status: 'FAIL',
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'elemento con contexto', context: 'observación sin property citada' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón', property: 'visibleText', value: 'Guardar' },
    ],
  });
  const [mixedGated] = visualEvidenceGateService.processPrototypeFindings([mixedInsufficientFinding]);
  const { findings: mixedFinal } = applyConsistencyForContextOnly([mixedGated]);
  assert(mixedFinal[0].status === 'NOT_EVALUABLE', '[Regresión] Caso mixto (1 ítem context-only + 1 ítem con property+value pero descripción genérica) sigue degradando -- SÍ hay una afirmación property=value sin identidad suficiente, comportamiento existente intacto');

  // 3. Casos C/D (arriba, líneas ~90-113) ya confirman que property+value
  // con descripción genérica/ausente sigue siendo INSUFFICIENT/degradado --
  // no se duplican aquí, solo se referencian como regresión ya cubierta.

  // Gate Rule V0, parte 2 — evidencia "ajena": finding declara region propia
  // que NINGÚN ítem de evidencia corrobora (todos declaran otra región).
  const [foreignEvidence] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Cancelar', region: 'bottom-right', property: 'visibleText', value: 'Cancelar' }],
      affectedElement: { visualReference: { description: 'botón Guardar', region: 'top-left' } },
    }),
  ]);
  assert(foreignEvidence.status === 'NOT_EVALUABLE', 'Gate Rule V0: evidencia cuya región contradice TODA la región propia del finding es degradada (caso "ajeno")');

  // Gate Rule V0 — ausencia de región en cualquiera de los dos lados nunca penaliza
  const [missingRegionOk] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' }],
      affectedElement: { visualReference: { description: 'botón Guardar' } },
    }),
  ]);
  assert(missingRegionOk.status === 'FAIL', 'Gate Rule V0: ausencia de región (en evidencia o en affectedElement) nunca se trata como evidencia ajena');

  // [P7.5.2] Revisión de la excepción P7.4.3: se elimina el umbral numérico
  // ("≥2 ítems con ≥2 regiones distintas") por no estar justificado por el
  // contrato -- se usa en su lugar la distinción ya existente entre ALCANCE
  // ('full-screen' como unión de las 9 regiones puntuales) y UBICACIÓN de
  // cada ítem (siempre una región puntual, nunca 'full-screen'): cualquier
  // región puntual citada está, por construcción, contenida en 'full-screen'.

  // 1. full-screen + 3 regiones distintas (caso real observado en P7.3) -> NO degrada.
  const [fullScreenAccepted] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visualHierarchy', value: 'heading-looking-level-1' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'formulario de contacto', region: 'center', property: 'grouping', value: 'campos agrupados en una tarjeta' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'sección de newsletter', region: 'bottom-center', property: 'grouping', value: 'separada del formulario principal' },
      ],
      affectedElement: { visualReference: { description: 'estructura general de la página', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenAccepted.status === 'FAIL', '[P7.5.2] full-screen con 3 regiones de evidencia distintas (top-center/center/bottom-center) NO se degrada -- reproduce y corrige el caso real de P7.3 (requisito 1 y 3 de la tarea)');

  // 2. full-screen + 2 evidencias en LA MISMA región -> tampoco degrada: cada
  // una sigue siendo una región puntual contenida en 'full-screen'; exigir
  // regiones DISTINTAS era precisamente el umbral arbitrario descartado.
  const [fullScreenSameRegion] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'elemento A', region: 'center', property: 'visibleText', value: 'A' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'elemento B', region: 'center', property: 'visibleText', value: 'B' },
      ],
      affectedElement: { visualReference: { description: 'estructura general', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenSameRegion.status === 'FAIL', '[P7.5.2] full-screen con 2 evidencias en la misma región NO se degrada -- ya no se exige "regiones distintas" (ese conteo no demostraba pertinencia)');

  // 3. full-screen + 1 sola evidencia regional -> tampoco degrada por la
  // misma razón: "≥2 ítems" era el otro umbral numérico descartado.
  const [fullScreenSingleItem] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'elemento único', region: 'center', property: 'visibleText', value: 'X' }],
      affectedElement: { visualReference: { description: 'estructura general', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenSingleItem.status === 'FAIL', '[P7.5.2] full-screen con un único ítem de evidencia regional NO se degrada -- una región puntual sigue estando contenida en "full-screen"');

  // 3b. [Requisito 2 de la tarea] Un finding full-screen NUNCA se acepta
  // "automáticamente" solo por declarar el alcance agregado: la defensa
  // contra evidencia insuficiente sigue siendo la Gate Rule V0 parte 1
  // (identidad obligatoria), completamente independiente de la región.
  const [fullScreenInsufficientEvidence] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', region: 'center', property: 'visibleText', value: 'X' } as any],
      affectedElement: { visualReference: { description: 'estructura general', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenInsufficientEvidence.status === 'NOT_EVALUABLE', '[P7.5.2] full-screen con evidencia sin elementDescription/context sigue degradando (Gate Rule V0 parte 1) -- declarar alcance agregado nunca exime la identidad mínima, no se acepta "cualquier evidencia" automáticamente');

  // 4. full-screen SIN ninguna región de evidencia -> comportamiento actual preservado
  // (ausencia de región nunca penaliza; el chequeo ni siquiera se activa: itemsWithRegion.length===0).
  const [fullScreenNoEvidenceRegions] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'elemento sin región citada', property: 'visibleText', value: 'X' }],
      affectedElement: { visualReference: { description: 'estructura general', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenNoEvidenceRegions.status === 'FAIL', '[P7.5.2] full-screen sin ninguna región de evidencia preserva el comportamiento actual (no-verificable, nunca penaliza)');

  // 5. Región puntual CON coincidencia literal -> comportamiento existente preservado (requisito 3).
  const [punctualMatch] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', region: 'top-left', property: 'visibleText', value: 'Guardar' }],
      affectedElement: { visualReference: { description: 'botón Guardar', region: 'top-left' } },
    }),
  ]);
  assert(punctualMatch.status === 'FAIL', '[P7.5.2] Región puntual con coincidencia literal: comportamiento existente intacto (NO se trata como full-screen)');

  // 6. Región puntual SIN coincidencia literal -> SIGUE degradando (requisito 4: regresión explícita).
  const [punctualForeign] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Cancelar', region: 'bottom-right', property: 'visibleText', value: 'Cancelar' }],
      affectedElement: { visualReference: { description: 'botón Guardar', region: 'top-left' } },
    }),
  ]);
  assert(punctualForeign.status === 'NOT_EVALUABLE', '[P7.5.2] Región puntual SIN coincidencia literal sigue degradándose -- "full-screen" nunca se trata como equivalente a ninguna región puntual, y ninguna región puntual cambia de comportamiento');

  // 7. Evidencias sin región mezcladas con regiones válidas -- los ítems sin
  // región simplemente nunca cuentan para ningún chequeo.
  const [fullScreenMixedMissing] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'elemento con región', region: 'top-center', property: 'visibleText', value: 'A' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'elemento sin región', context: 'observación de contexto general sin región citada' },
      ],
      affectedElement: { visualReference: { description: 'estructura general', region: 'full-screen' } },
    }),
  ]);
  assert(fullScreenMixedMissing.status === 'FAIL', '[P7.5.2] full-screen con 1 ítem regional + 1 sin región: la región puntual citada está contenida en "full-screen", no degrada; el ítem sin región se ignora como siempre');

  const [punctualMixedMissing] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', region: 'top-left', property: 'visibleText', value: 'Guardar' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'contexto adicional', context: 'observación sin región citada' },
      ],
      affectedElement: { visualReference: { description: 'botón Guardar', region: 'top-left' } },
    }),
  ]);
  assert(punctualMixedMissing.status === 'FAIL', '[P7.5.2] Región puntual con coincidencia + un ítem sin región mezclado: el ítem sin región se ignora, comportamiento existente intacto');

  // [P7.5.2] REGRESIÓN CON DATO HISTÓRICO REAL -- reproduce el defecto real
  // documentado en la auditoría offline post-P7.3: el finding real #3 del
  // dump histórico de P7.3 (WCAG 1.3.1, "jerarquía visual general clara")
  // declara ownRegion='full-screen' con 3 ítems de evidencia en regiones
  // DISTINTAS (top-center/center/bottom-center) -- con el gate PRE-P7.4.3
  // (capturado en gatedFindings del dump real) esto se degradaba
  // incorrectamente a NOT_EVALUABLE. Confirma que el gate ACTUAL (P7.5.2)
  // ya no lo degrada, usando el finding real tal cual Gemini lo emitió
  // (nunca reconstruido a mano).
  const P73_DUMP_PATH = '/tmp/prototype-p7-experiment-2-result.json';
  if (fs.existsSync(P73_DUMP_PATH)) {
    const p73Dump = JSON.parse(fs.readFileSync(P73_DUMP_PATH, 'utf8'));
    const realVisualHierarchyFinding: PrototypeAuditFinding = p73Dump.rawFindings[3];
    assert(
      realVisualHierarchyFinding.affectedElement?.visualReference?.region === 'full-screen' &&
        (realVisualHierarchyFinding.evidence || []).length === 3,
      'Precondición: el finding real #3 de P7.3 efectivamente declara ownRegion="full-screen" con 3 ítems de evidencia (confirmado contra el dato histórico, no asumido)',
    );
    const [realReprocessed] = visualEvidenceGateService.processPrototypeFindings([realVisualHierarchyFinding]);
    assert(
      realReprocessed.status === 'PASS',
      `[P7.5.2] El finding real #3 de P7.3 (degradado a NOT_EVALUABLE por el gate pre-P7.4.3, ver gatedFindings[3] del dump histórico) ya NO se degrada con el gate actual -- status real: ${realReprocessed.status}`,
    );
  } else {
    console.log('  ⚠️  Dump histórico de P7.3 no encontrado en /tmp -- se omite la regresión con dato real (no bloqueante, cubierta igualmente por el caso sintético equivalente arriba)');
  }

  // Consistency -- degradación aplicada al batch completo (applyVisualEvidenceConsistency)
  const { applyVisualEvidenceConsistency } = require('@/modules/evaluations/services/visual-evidence-consistency.service');
  const { findings: degraded, summary } = applyVisualEvidenceConsistency([
    finding({
      evidence: [
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Guardar' },
        { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Guardar', property: 'visibleText', value: 'Cancelar' },
      ],
    }),
  ]);
  assert(degraded[0].status === 'NOT_EVALUABLE' && degraded[0].confidence === 'low' && degraded[0].recommendation === null, 'applyVisualEvidenceConsistency degrada un finding INCONSISTENT (status/confidence/recommendation), igual que J6 para WEB');
  assert(summary.inconsistent === 1, 'El resumen de applyVisualEvidenceConsistency cuenta correctamente la inconsistencia');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
