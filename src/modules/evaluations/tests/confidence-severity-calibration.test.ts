import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { aiService } from '@/modules/ai/ai.service';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';

/**
 * P1.6.5.1 — calibración determinista de `confidence` (Ajuste 2) y
 * `severity` (Ajuste 3) en el flujo de prototipos, motivada por la
 * auditoría P1.6.5: 10/10 hallazgos reales de contraste cualitativo
 * (`visualContrast: appears-low`) llevaban `confidence: high` sin
 * excepción, y 4/7 hallazgos `NOT_EVALUABLE` reales llevaban severidad
 * no-neutral (`medium`/`high`).
 *
 * TODOS los fixtures de este archivo son SINTÉTICOS, construidos
 * específicamente para esta prueba -- ninguno reutiliza ni modifica un
 * resultado histórico real.
 */
function finding(overrides: Partial<PrototypeAuditFinding> = {}): PrototypeAuditFinding {
  return {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'Hallazgo sintético de prueba.',
    evidence: [],
    recommendation: 'Recomendación accionable.',
    ...overrides,
  } as PrototypeAuditFinding;
}

async function runTests() {
  console.log('🧪 Starting P1.6.5.1 — Confidence/Severity Calibration Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ==================================================================
  // SECCIÓN 0 — Ajuste 1: contenido del prompt (sin llamar a Gemini)
  // ==================================================================
  console.log('--- Sección 0: contenido del prompt (Ajuste 1) ---');
  {
    const applicableCriteria = resolveApplicablePrototypeCriteria();
    const prompt: string = (aiService as any).buildPrototypeAuditPrompt(
      {
        evaluationId: 'fake-eval', title: 'Prototipo de prueba', description: 'Formulario de contacto ficticio.',
        archetype: { fullName: 'Perfil de prueba', archetype: 'El Explorador', profession: 'QA', phrase: 'frase', goals: ['probar'], frustrations: ['confusión'], techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop' },
      },
      applicableCriteria,
    );
    assert(prompt.includes('CONFIDENCE AND SEVERITY CALIBRATION RULE'), 'Ajuste 1: el prompt incluye la nueva sección de calibración');
    assert(prompt.includes('the MAXIMUM confidence you may assign is "medium"'), 'Ajuste 1: la regla de techo de confianza para contraste cualitativo está presente textualmente');
    assert(prompt.includes('Do not assign "critical" or "high" automatically'), 'Ajuste 1: la regla de severidad no automática por criterio WCAG/Nielsen está presente');
    assert(prompt.includes('DYNAMIC / INTERACTIVE BEHAVIOR RULE'), 'Ajuste 1: las reglas existentes de P1.6.4 NO fueron eliminadas, siguen presentes');
    assert(prompt.includes('EXECUTIVE SUMMARY RULE'), 'Ajuste 1: la regla de resumen ejecutivo de P1.6.4 NO fue eliminada');
    assert(prompt.includes('STRICTLY FORBIDDEN from stating or calculating a numeric WCAG contrast'), 'Ajuste 1: la CONTRAST RULE original no fue eliminada ni contradicha');
  }

  // ==================================================================
  // SECCIÓN A — Calibración de contraste (Ajuste 2)
  // ==================================================================
  console.log('--- Sección A: calibración de contraste cualitativo ---');

  // A1: appears-low + high -> medium
  const [a1] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto de prueba', region: 'center' }] }),
  ]);
  assert(a1.confidence === 'medium', 'A1: visualContrast=appears-low + confidence=high -> degrada a medium');
  assert(a1.status === 'FAIL', 'A1: status no se modifica');
  assert(a1.severity === 'medium', 'A1: severity no se modifica (sigue medium, el valor del fixture)');

  // A2: appears-low + medium -> medium (sin cambio, no hay nada que degradar)
  const [a2] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'medium', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto de prueba', region: 'center' }] }),
  ]);
  assert(a2.confidence === 'medium', 'A2: visualContrast=appears-low + confidence=medium -> permanece medium');

  // A3: appears-low + low -> low (la regla nunca ELEVA confidence)
  const [a3] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'low', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto de prueba', region: 'center' }] }),
  ]);
  assert(a3.confidence === 'low', 'A3: visualContrast=appears-low + confidence=low -> permanece low (la regla nunca eleva)');

  // A4: visualContrast con valor DISTINTO de appears-low + high -> high (sin cambio)
  const [a4] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-sufficient', elementDescription: 'Texto de prueba', region: 'center' }] }),
  ]);
  assert(a4.confidence === 'high', 'A4: visualContrast con valor distinto de "appears-low" (ej. "appears-sufficient") -> NO se degrada');

  // A5: otra propiedad visual (no visualContrast) + high -> high (sin cambio)
  const [a5] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: '', elementDescription: 'Campo de prueba', region: 'center' }] }),
  ]);
  assert(a5.confidence === 'high', 'A5: otra propiedad visual (visualLabel) -> NO se degrada, la regla es exclusiva de visualContrast');

  // A6: descripción menciona "contraste" pero SIN evidencia estructurada -> high (sin cambio, regla basada en evidencia, nunca en texto)
  const [a6] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      confidence: 'high',
      description: 'El contraste de este texto parece insuficiente respecto al fondo.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'El contraste visual es bajo.', elementDescription: 'Texto de prueba', region: 'center' }],
    }),
  ]);
  assert(a6.confidence === 'high', 'A6: la palabra "contraste" en la descripción, sin evidencia estructurada (property/value), NO activa la regla -- basada en evidencia, nunca en texto');

  // A7: visualContrast=appears-low junto a OTRAS evidencias -> medium, conservando TODAS las evidencias
  const multiEvidence = [
    { type: 'VISUAL_OBSERVATION' as const, property: 'visualContrast' as const, value: 'appears-low', elementDescription: 'Texto A', region: 'center' as const },
    { type: 'VISUAL_OBSERVATION' as const, property: 'visibleText' as const, value: 'Enviar', elementDescription: 'Botón B', region: 'bottom-center' as const },
  ];
  const [a7] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'high', evidence: multiEvidence as any }),
  ]);
  assert(a7.confidence === 'medium', 'A7: visualContrast=appears-low combinado con otra evidencia -> degrada igual a medium');
  assert(a7.evidence!.length === 2, 'A7: se conservan las DOS evidencias originales, ninguna se elimina');
  assert(a7.evidence!.some((e) => e.property === 'visualContrast' && e.value === 'appears-low'), 'A7: la evidencia de contraste original se conserva intacta');
  assert(a7.evidence!.some((e) => e.property === 'visibleText' && e.value === 'Enviar'), 'A7: la segunda evidencia (visibleText) se conserva intacta, sin alteración');

  // Caso cruzado: un finding de OTRA criterio/hallazgo con evidencia de
  // contraste "appears-low" en un contexto distinto NO debe afectar a un
  // SEGUNDO finding del mismo batch que no tiene esa evidencia -- confirma
  // que la regla se evalúa por hallazgo individual, nunca de forma cruzada.
  const [crossA, crossB] = visualEvidenceGateService.processPrototypeFindings([
    finding({ confidence: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto A', region: 'center' }] }),
    finding({ confidence: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Enviar', elementDescription: 'Botón B', region: 'bottom-center' }] }),
  ]);
  assert(crossA.confidence === 'medium', 'Cruzado: el primer hallazgo (con contraste) sí degrada');
  assert(crossB.confidence === 'high', 'Cruzado: el segundo hallazgo (sin contraste) NO se ve afectado por la evidencia del primero -- evaluación por hallazgo, nunca compartida');

  // ==================================================================
  // SECCIÓN B — Normalización NOT_EVALUABLE (Ajuste 3)
  // ==================================================================
  console.log('\n--- Sección B: normalización de severity en NOT_EVALUABLE ---');

  // B1-B5: NOT_EVALUABLE con cualquier severidad inicial -> info
  for (const initialSeverity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    const [b] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        status: 'NOT_EVALUABLE',
        severity: initialSeverity,
        confidence: 'low',
        evidence: [{ type: 'VISUAL_OBSERVATION', context: 'Evidencia de prueba.', elementDescription: 'Elemento de prueba', region: 'center' }],
      }),
    ]);
    assert(b.severity === 'info', `B (severity inicial=${initialSeverity}): NOT_EVALUABLE normaliza severity a 'info'`);
    assert(b.status === 'NOT_EVALUABLE', `B (severity inicial=${initialSeverity}): status permanece NOT_EVALUABLE, nunca cambia a FAIL/PASS`);
  }

  // B6: FAIL con severity=critical -> critical (sin cambio)
  const [b6] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      status: 'FAIL',
      severity: 'critical',
      confidence: 'high',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: '', elementDescription: 'Elemento de prueba', region: 'center' }],
    }),
  ]);
  assert(b6.severity === 'critical', 'B6: FAIL con severity=critical conserva su severidad -- la normalización es exclusiva de NOT_EVALUABLE');

  // B7: FAIL con severity=medium -> medium (sin cambio)
  const [b7] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      status: 'FAIL',
      severity: 'medium',
      confidence: 'high',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: '', elementDescription: 'Elemento de prueba', region: 'center' }],
    }),
  ]);
  assert(b7.severity === 'medium', 'B7: FAIL con severity=medium conserva su severidad');

  // B8: PASS con severity=medium -> medium (sin cambio)
  const [b8] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      status: 'PASS',
      severity: 'medium',
      confidence: 'high',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Guardar', elementDescription: 'Botón de prueba', region: 'center' }],
    }),
  ]);
  assert(b8.severity === 'medium', 'B8: PASS con severity=medium conserva su severidad -- la normalización es exclusiva de NOT_EVALUABLE');

  // Integridad adicional: description/evidence/recommendation/confidence
  // permanecen intactos tras la normalización de severity.
  const originalDescription = 'Descripción original del hallazgo NOT_EVALUABLE.';
  const [bIntegrity] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      status: 'NOT_EVALUABLE',
      severity: 'high',
      confidence: 'low',
      description: originalDescription,
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'Contexto original.', elementDescription: 'Elemento original', region: 'center' }],
      recommendation: null,
    }),
  ]);
  assert(bIntegrity.severity === 'info', 'Integridad: severity normalizada a info');
  assert(bIntegrity.description === originalDescription, 'Integridad: description permanece intacta (este NOT_EVALUABLE no proviene de la Gate Rule V1, no lleva prefijo)');
  assert(bIntegrity.confidence === 'low', 'Integridad: confidence sigue determinada por la Gate Rule 1c existente, sin alterar');
  assert(bIntegrity.recommendation === null, 'Integridad: recommendation permanece null');
  assert(bIntegrity.evidence!.length === 1 && bIntegrity.evidence![0].context === 'Contexto original.', 'Integridad: evidence permanece intacta');

  // ==================================================================
  // SECCIÓN C — No regresión / integración en el orden real del pipeline
  // ==================================================================
  console.log('\n--- Sección C: no regresión e interacción entre reglas ---');

  // C1: Gate V0 (sin identidad) sigue degradando a NOT_EVALUABLE, y la
  // nueva Gate V3 normaliza su severity a 'info' -- confirma que V0 y V3
  // cooperan correctamente en el orden real.
  const [c1] = visualEvidenceGateService.processPrototypeFindings([
    finding({ status: 'FAIL', severity: 'high', evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'x' } as any] }),
  ]);
  assert(c1.status === 'NOT_EVALUABLE', 'C1: Gate V0 (sin elementDescription/context) sigue degradando a NOT_EVALUABLE sin cambios');
  assert(c1.severity === 'info', 'C1: la nueva Gate V3 normaliza correctamente la severity de un hallazgo degradado por V0 (no solo por V1)');

  // C2: Gate V1 (comportamiento dinámico) sigue funcionando -- fixture real
  // de P1.6.3/P1.6.4, con severity no-neutral, ahora normalizada por V3 además.
  const [c2] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-05',
      heuristicName: 'Prevención de errores',
      severity: 'high',
      confidence: 'high',
      description: 'El formulario carece de mecanismos visibles de prevención de errores o retroalimentación inmediata sobre la validez de la entrada del usuario.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observan indicadores visuales de error.', elementDescription: 'Campos del formulario', region: 'middle-right' }],
      recommendation: 'Implementar validación en tiempo real.',
    }),
  ]);
  assert(c2.status === 'NOT_EVALUABLE', 'C2: Gate Rule V1 (P1.6.4.2) sigue degradando correctamente el fixture real de N-05');
  assert(c2.confidence === 'low', 'C2: confidence sigue normalizada a low por la Gate Rule 1c, sin cambios');
  assert(c2.severity === 'info', 'C2: severity ahora también normalizada a info por la nueva Gate Rule V3 -- las dos correcciones conviven correctamente');
  assert(c2.description!.startsWith('No fue posible verificar con la imagen disponible'), 'C2: el prefijo de descripción de P1.6.4.2 sigue aplicándose sin cambios');
  assert(c2.recommendation === null, 'C2: recommendation sigue null');

  // C3: Caso A de la auditoría adversarial P1.6.4.1/.2 -- evidencia
  // estructurada exime la degradación de Gate V1; la nueva Gate V2 (contraste)
  // SÍ debe seguir aplicando sobre esa misma evidencia si corresponde.
  const [c3] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      wcagCriterion: 'WCAG 1.4.1 Uso del color',
      severity: 'high',
      confidence: 'high',
      description: 'El formulario presenta un mensaje de error rojo visible debajo del campo de correo electrónico, pero no se puede determinar si también dispone de validación en tiempo real.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'colorCoding', value: 'mensaje de error indicado solo por color rojo, sin ícono ni texto adicional', elementDescription: 'Mensaje de error bajo el campo de correo electrónico', region: 'middle-right' }],
    }),
  ]);
  assert(c3.status === 'FAIL', 'C3: Gate Rule V1 sigue sin degradar este hallazgo (evidencia estructurada independiente, P1.6.4.2) -- sin regresión');
  assert(c3.confidence === 'high', 'C3: al no ser evidencia de contraste (es colorCoding), la nueva Gate V2 tampoco se activa -- confidence intacta');
  assert(c3.severity === 'high', 'C3: severity intacta (status=FAIL, la Gate V3 no aplica)');

  // C4: Gate Rule 1 (lenguaje especulativo) sigue degradando correctamente.
  const [c4] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      description: 'El botón podría ser confuso para algunos usuarios.',
      confidence: 'high',
      severity: 'medium',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Enviar', elementDescription: 'Botón', region: 'center' }],
    }),
  ]);
  assert(c4.status === 'NOT_EVALUABLE', 'C4: Gate Rule 1 (lenguaje especulativo "podría") sigue degradando correctamente');
  assert(c4.severity === 'info', 'C4: severity normalizada a info tras la degradación por lenguaje especulativo');

  // C5: Gate Rule 1b (PASS sin evidencia) sigue funcionando.
  const [c5] = visualEvidenceGateService.processPrototypeFindings([
    finding({ status: 'PASS', evidence: [] }),
  ]);
  assert(c5.status === 'NOT_EVALUABLE', 'C5: Gate Rule 1b (PASS sin evidencia) sigue degradando correctamente');
  assert(c5.severity === 'info', 'C5: severity normalizada a info también en este camino de degradación');

  // C6: Evidencia "ajena" (foreign evidence, Gate V0 parte 2) sigue funcionando.
  const [c6] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      affectedElement: { visualReference: { description: 'Elemento propio', region: 'top-left' } },
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'Otro elemento', region: 'bottom-right' }],
    }),
  ]);
  assert(c6.status === 'NOT_EVALUABLE', 'C6: Gate V0 parte 2 (evidencia ajena a la región propia) sigue degradando correctamente');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
