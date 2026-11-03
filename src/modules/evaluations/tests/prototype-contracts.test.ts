import {
  VisualEvidenceItemSchema,
  PrototypeAuditFindingSchema,
  CreatePrototypeEvaluationSchema,
} from '@/modules/ai/contracts/prototype.contracts';

/**
 * P0 — Contratos de evaluación de prototipos visuales.
 */
function runTests() {
  console.log('🧪 Starting Prototype Contracts (P0) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 1. Input válido: CreatePrototypeEvaluationSchema
  const validInput = CreatePrototypeEvaluationSchema.safeParse({
    evaluatorProfileId: 'abc123',
    description: 'Pantalla de checkout ficticia con 2 problemas controlados.',
  });
  assert(validInput.success, 'Input válido (sin title) pasa CreatePrototypeEvaluationSchema');

  // 2. Descripción obligatoria
  const noDescription = CreatePrototypeEvaluationSchema.safeParse({ evaluatorProfileId: 'abc123' });
  assert(!noDescription.success, 'description ausente es rechazada (obligatoria)');

  const shortDescription = CreatePrototypeEvaluationSchema.safeParse({
    evaluatorProfileId: 'abc123',
    description: 'corta',
  });
  assert(!shortDescription.success, 'description demasiado corta es rechazada');

  // 3. Visual evidence schema — item válido
  const validEvidence = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'botón Guardar',
    region: 'middle-left',
    property: 'visibleText',
    value: 'Guardar',
  });
  assert(validEvidence.success, 'Ítem de evidencia visual válido (description+region+property+value) pasa el schema');

  // 4. elementDescription y context ambos ausentes -> rechazado
  const noIdentity = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    property: 'visibleText',
    value: 'Guardar',
  });
  assert(!noIdentity.success, 'Ítem sin elementDescription NI context es rechazado');

  // 5. context solo (sin elementDescription) -> válido
  const contextOnly = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    context: 'Observación a nivel de página sobre densidad visual.',
  });
  assert(contextOnly.success, 'Ítem con solo context (sin elementDescription ni property/value) es válido');

  // 6. property inválida (fuera de whitelist)
  const invalidProperty = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'botón Guardar',
    property: 'ariaLabel', // propiedad DOM, no visual -- no pertenece a la whitelist
    value: 'Guardar',
  });
  assert(!invalidProperty.success, 'property fuera de la whitelist visual es rechazada');

  // 7. region inválida
  const invalidRegion = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'botón Guardar',
    region: 'top-top-left',
  });
  assert(!invalidRegion.success, 'region fuera del enum de 9+1 valores es rechazada');

  // 8. property sin value (incompleto)
  const propWithoutValue = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'botón Guardar',
    property: 'visibleText',
  });
  assert(!propWithoutValue.success, 'property sin value es rechazada (deben ir juntos)');

  // 8b. value sin property (incompleto, dirección inversa)
  const valueWithoutProp = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'botón Guardar',
    value: 'Guardar',
  });
  assert(!valueWithoutProp.success, 'value sin property es rechazada (deben ir juntos)');

  // 9. Contraste — backstop de ratio numérica prohibida
  const numericContrast = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'texto de ayuda',
    property: 'visualContrast',
    value: '3.2:1',
  });
  assert(!numericContrast.success, 'visualContrast con ratio numérica ("3.2:1") es rechazada por el backstop regex');

  const qualitativeContrast = VisualEvidenceItemSchema.safeParse({
    type: 'VISUAL_OBSERVATION',
    elementDescription: 'texto de ayuda',
    property: 'visualContrast',
    value: 'appears-low',
  });
  assert(qualitativeContrast.success, 'visualContrast cualitativo ("appears-low") es aceptado');

  // 10. PrototypeAuditFindingSchema — FAIL sin evidencia/recomendación rechazado (barrera reutilizada)
  const failNoEvidence = PrototypeAuditFindingSchema.safeParse({
    findingGroup: 'ux',
    status: 'FAIL',
    description: 'Problema visual.',
    evidence: [],
  });
  assert(!failNoEvidence.success, 'FAIL sin evidencia ni recomendación es rechazado (barrera reutilizada de WEB)');

  // 11. FAIL válido con evidencia + recomendación
  const validFail = PrototypeAuditFindingSchema.safeParse({
    findingGroup: 'accessibility',
    status: 'FAIL',
    wcagCriterion: 'WCAG 2.4.6',
    description: 'El encabezado principal no es descriptivo.',
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', property: 'visibleText', value: 'Página' },
    ],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
    recommendation: 'Usar un encabezado que describa el contenido de la pantalla.',
  });
  assert(validFail.success, 'FAIL con evidencia visual + recomendación + visualReference es aceptado');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
