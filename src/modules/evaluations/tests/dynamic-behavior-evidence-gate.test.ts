import fs from 'fs';
import { visualEvidenceGateService, DYNAMIC_BEHAVIOR_ABSENCE_PHRASES } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { aiService } from '@/modules/ai/ai.service';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';
import { prototypeEvaluationService } from '@/modules/evaluations/services/prototype-evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';
import { buildValidPrototypeAuditOutputJson } from '@/shared/testing/prototype-gemini-mock-harness';

/**
 * P1.6.4 — fortalecimiento del contrato de evidencia visual en prototipos:
 * un criterio NUNCA debe pasar a FAIL cuando su conclusión depende de un
 * comportamiento DINÁMICO (validación, confirmación de envío, estados de
 * error) que solo se manifestaría DESPUÉS de una interacción que una imagen
 * estática sin interactuar, por construcción, nunca muestra.
 *
 * Caso real que motiva esta prueba (auditoría post-piloto P1.6.3,
 * evaluación `6ae548f689d540e053c65d34`): Gemini concluyó "el formulario
 * carece de validación en tiempo real" únicamente porque no se observaban
 * mensajes de error en la captura -- usado aquí como fixture de regresión
 * exacto (texto real, no inventado).
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

// Texto real del hallazgo N-05 del piloto auditado en P1.6.3 (Finding
// `6ae5493289d540e053c65d58`), usado verbatim como fixture de regresión.
const REAL_N05_FINDING_FROM_PILOT = finding({
  heuristicCode: 'N-05',
  heuristicName: 'Prevención de errores',
  severity: 'high',
  description:
    'El formulario carece de mecanismos visibles de prevención de errores o retroalimentación inmediata sobre la validez de la entrada del usuario.',
  evidence: [
    {
      type: 'VISUAL_OBSERVATION',
      context:
        'No se observan indicadores visuales como bordes de color, iconos de error o texto de advertencia que señalen errores en el formato de entrada, campos obligatorios o la validez del contenido antes del envío del formulario.',
      elementDescription: "Campos de texto del formulario ('Enter your full name', 'Enter your email', 'Write us your question here...')",
      region: 'middle-right',
    },
  ],
  recommendation: 'Implementar validación en tiempo real para los campos del formulario.',
});

async function runGateUnitTests(assert: (c: boolean, m: string) => void) {
  console.log('--- Sección A: Gate Rule V1 (unitario) ---');

  // 1. Fixture de regresión EXACTO del piloto real -- antes FAIL, ahora NOT_EVALUABLE.
  const [n05Result] = visualEvidenceGateService.processPrototypeFindings([REAL_N05_FINDING_FROM_PILOT]);
  assert(n05Result.status === 'NOT_EVALUABLE', '1. El hallazgo N-05 real del piloto (ausencia de validación) queda NOT_EVALUABLE, no FAIL');
  assert(n05Result.confidence === 'low', '1b. confidence se normaliza a "low" tras la degradación');
  assert(n05Result.recommendation === null, '1c. recommendation se limpia (null) igual que cualquier otra degradación del gate');

  // 2. Ausencia de ETIQUETA VISUAL, enmarcada como hallazgo Nielsen (N-06) --
  //    sigue produciendo FAIL (Regla D: no degradar hallazgos visuales
  //    legítimos). [P1.6.6.7: este caso usaba antes `wcagCriterion: 'WCAG
  //    3.3.2'`, pero la nueva Gate Rule V5 degrada correctamente cualquier
  //    FAIL/PASS sobre WCAG 3.3.2 por identidad de criterio (una ausencia
  //    VISUAL de etiqueta nunca demuestra la ausencia de su asociación
  //    programática) -- se sustituyó por un heurístico Nielsen (V5 solo lee
  //    `wcagCriterion`, nunca `heuristicCode`), para seguir aislando aquí
  //    específicamente el comportamiento de la Gate Rule V1, no el de V5
  //    (que ya se prueba en `gate-v5-non-demonstrable-criteria.test.ts`).
  //    evidence/description sin cambios.]
  const [labelResult] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-06',
      heuristicName: 'Reconocimiento antes que recuerdo',
      description: 'Los campos de entrada del formulario carecen de etiquetas visibles asociadas, dependiendo únicamente de placeholder.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: '', elementDescription: 'Campo de texto para nombre completo', region: 'middle-right' }],
    }),
  ]);
  assert(labelResult.status === 'FAIL', '2. Ausencia de etiqueta visual (hallazgo Nielsen N-06) SIGUE produciendo FAIL -- no degradada por la Gate Rule V1');

  // 3. Bajo contraste, enmarcado como hallazgo Nielsen (N-08) -- sigue
  //    produciendo FAIL. [P1.6.6.7: este caso usaba antes `wcagCriterion:
  //    'WCAG 1.4.3'`, pero la nueva Gate Rule V5 degrada categóricamente
  //    CUALQUIER FAIL/PASS sobre WCAG 1.4.3 (ninguna observación cualitativa
  //    de contraste demuestra conformidad NI incumplimiento objetivo de ese
  //    criterio) -- se sustituyó por un heurístico Nielsen, por la misma
  //    razón que el caso 2.]
  const [contrastResult] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-08',
      heuristicName: 'Diseño estético y minimalista',
      description: 'El contraste entre el texto y el fondo parece ser bajo para algunos elementos de texto pequeños.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto bajo "Call us"', region: 'middle-left' }],
    }),
  ]);
  assert(contrastResult.status === 'FAIL', '3. Un texto de bajo contraste (hallazgo Nielsen N-08) SIGUE produciendo FAIL');

  // 4. Mismo patrón bajo OTRO heurístico distinto (N-01, confirmación de
  //    envío) -- confirma que la regla NO está atada a un heuristicCode.
  const [confirmationResult] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-01',
      heuristicName: 'Visibilidad del estado del sistema',
      description: 'No se observa ninguna confirmación de envío después de completar el formulario.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No hay mensaje visible tras el botón Enviar.', elementDescription: 'Botón Enviar', region: 'middle-right' }],
    }),
  ]);
  assert(confirmationResult.status === 'NOT_EVALUABLE', '4. El mismo patrón bajo N-01 (no N-05) también degrada -- la regla es general, no un caso especial por código de heurística');

  // 5. Caso positivo de N-05: un indicio de advertencia SÍ está presente y
  //    visible -- la regla NO debe degradar esto (Regla A: evaluable
  //    cuando el indicio SÍ está presente, per la nota reforzada del
  //    resolver).
  const [n05PresentResult] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-05',
      heuristicName: 'Prevención de errores',
      description: 'Se observa un ícono de advertencia junto al campo de correo, pero sin ningún texto que explique el problema.',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'Ícono de advertencia junto al campo de correo', context: 'El ícono es visible pero no hay texto explicativo adyacente.', region: 'middle-right' }],
    }),
  ]);
  assert(n05PresentResult.status === 'FAIL', '5. Un indicio de advertencia REALMENTE VISIBLE (N-05 positivo) no se degrada -- la regla no sobre-actúa');

  // 6. Trazabilidad de evidencia preservada para un finding que sobrevive sin cambios.
  assert(
    JSON.stringify(labelResult.evidence) === JSON.stringify([{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: '', elementDescription: 'Campo de texto para nombre completo', region: 'middle-right' }]),
    '6. La evidencia de un finding que sobrevive el gate mantiene su estructura exacta, sin alteración',
  );
}

async function runPromptContentTests(assert: (c: boolean, m: string) => void) {
  console.log('\n--- Sección B: contenido del prompt (sin llamar a Gemini) ---');
  const applicableCriteria = resolveApplicablePrototypeCriteria();
  const prompt: string = (aiService as any).buildPrototypeAuditPrompt(
    {
      evaluationId: 'fake-eval',
      title: 'Prototipo de prueba',
      description: 'Formulario de contacto ficticio.',
      archetype: {
        fullName: 'Perfil de prueba', archetype: 'El Explorador', profession: 'QA', phrase: 'frase',
        goals: ['probar'], frustrations: ['confusión'], techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop',
      },
    },
    applicableCriteria,
  );

  assert(prompt.includes('DYNAMIC / INTERACTIVE BEHAVIOR RULE'), '7. El prompt incluye la nueva regla de comportamiento dinámico/interactivo');
  assert(/lacks validation|validation.*lacks/i.test(prompt) || prompt.toLowerCase().includes('the form lacks validation'), '7b. El prompt da el ejemplo concreto de validación prohibido como afirmación confirmada');
  assert(prompt.includes('EXECUTIVE SUMMARY RULE'), '8. El prompt incluye la nueva regla de coherencia del resumen ejecutivo con el status real de los hallazgos');
  assert(prompt.includes('ÚNICAMENTE cuando un indicio de confirmación/advertencia SÍ está presente'), '9. La nota reforzada de N-05 (prototype-criteria-resolver.ts) se renderiza en la lista de criterios del prompt real');
}

async function runEndToEndPersistenceTest(assert: (c: boolean, m: string) => void) {
  console.log('\n--- Sección C: extremo a extremo -- la degradación llega persistida correctamente (no rompe P1.5.2) ---');

  const FAKE_EVALUATION_ID = 'fake-prototype-eval-id-p1-6-4';
  const FAKE_USER_ID = 'fake-prototype-user-id-p1-6-4';

  const n05RawFromGemini = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    heuristicCode: 'N-05',
    heuristicName: 'Prevención de errores',
    description: 'El formulario carece de mecanismos visibles de prevención de errores o retroalimentación inmediata sobre la validez de la entrada del usuario.',
    evidence: [
      {
        type: 'VISUAL_OBSERVATION',
        context: 'No se observan indicadores visuales como bordes de color, iconos de error o texto de advertencia.',
        elementDescription: 'Campos de texto del formulario',
        region: 'middle-right',
      },
    ],
    recommendation: 'Implementar validación en tiempo real.',
  };

  // [P1.6.6.7: usaba antes `wcagCriterion: 'WCAG 1.4.3'`; sustituido por un
  // heurístico Nielsen por la misma razón documentada en la Sección A,
  // caso 3 -- la nueva Gate Rule V5 degrada categóricamente cualquier
  // FAIL/PASS sobre WCAG 1.4.3, y este test verifica específicamente que
  // la Gate Rule V1 (no V5) no sobre-actúa sobre un FAIL estático legítimo.]
  const contrastFinding = {
    findingGroup: 'accessibility',
    type: 'visual',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    heuristicCode: 'N-08',
    heuristicName: 'Diseño estético y minimalista',
    description: 'El contraste entre el texto y el fondo parece ser bajo.',
    evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto bajo "Call us"', region: 'middle-left' }],
    recommendation: 'Aumentar el contraste del texto.',
  };

  const passFinding = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'PASS',
    severity: 'info',
    confidence: 'high',
    heuristicCode: 'N-04',
    heuristicName: 'Consistencia y estándares',
    description: 'El estilo de los botones es consistente en toda la página.',
    evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualHierarchy', value: 'primary', elementDescription: 'Botón Enviar', region: 'middle-right' }],
    recommendation: null,
  };

  function fakeEvaluationDoc() {
    return {
      id: FAKE_EVALUATION_ID,
      title: 'Prototipo de prueba (P1.6.4)',
      description: 'Formulario de contacto ficticio.',
      imageUrl: '/uploads/prototypes/fake-p1-6-4.png',
      evaluatorProfileId: { toString: () => 'fake-profile-id' },
    } as any;
  }
  function fakeProfile() {
    return {
      fullName: 'Perfil de prueba', archetype: 'El Explorador', profession: 'QA', phrase: 'frase',
      goals: ['probar'], frustrations: ['confusión'], techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop', biography: undefined,
    } as any;
  }

  const originals = {
    findByIdAndUserId: evaluationRepository.findByIdAndUserId,
    update: evaluationRepository.update,
    profileFindById: evaluatorProfileService.findById,
    findingCreate: findingService.create,
    reportFindByEvaluationId: reportRepository.findByEvaluationId,
    reportCreate: reportRepository.create,
    readFileSync: fs.readFileSync,
  };

  const createdFindings: any[] = [];
  (evaluationRepository as any).findByIdAndUserId = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async () => fakeEvaluationDoc();
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (findingService as any).create = async (_userId: string, dto: any) => { createdFindings.push(dto); return dto; };
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async (dto: any) => dto;
  (fs as any).readFileSync = ((path: string, ...rest: any[]) => {
    if (typeof path === 'string' && path.includes('fake-p1-6-4.png')) return Buffer.from('fake-png-bytes');
    return originals.readFileSync(path, ...rest);
  }) as any;

  const stub = stubGeminiJsonResponses([
    buildValidPrototypeAuditOutputJson([n05RawFromGemini, contrastFinding, passFinding]),
  ]);

  try {
    await (prototypeEvaluationService as any).run(FAKE_EVALUATION_ID, FAKE_USER_ID, undefined);

    const persistedN05 = createdFindings.find((f) => f.heuristicCode === 'N-05');
    const persistedContrast = createdFindings.find((f) => f.heuristicCode === 'N-08');
    const persistedPass = createdFindings.find((f) => f.heuristicCode === 'N-04');

    assert(!!persistedN05 && persistedN05.status === 'NOT_EVALUABLE', '10. Extremo a extremo: el hallazgo N-05 (ausencia de validación) persiste como NOT_EVALUABLE, no FAIL');
    assert(!!persistedContrast && persistedContrast.status === 'FAIL', '11. El hallazgo de contraste legítimo persiste sin cambios como FAIL -- Regla D intacta');
    assert(!persistedPass, '12. El hallazgo PASS sigue sin persistirse -- P1.5.2 no se rompió');
    assert(persistedN05?.recommendation == null, '13. El Finding NOT_EVALUABLE persistido conserva recommendation null/undefined (misma regla de siempre)');
  } finally {
    stub.restore();
    (evaluationRepository as any).findByIdAndUserId = originals.findByIdAndUserId;
    (evaluationRepository as any).update = originals.update;
    (evaluatorProfileService as any).findById = originals.profileFindById;
    (findingService as any).create = originals.findingCreate;
    (reportRepository as any).findByEvaluationId = originals.reportFindByEvaluationId;
    (reportRepository as any).create = originals.reportCreate;
    (fs as any).readFileSync = originals.readFileSync;
  }
}

async function runTests() {
  console.log('🧪 Starting P1.6.4 — Dynamic Behavior Evidence Gate Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  assert(DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.length > 0, '0. DYNAMIC_BEHAVIOR_ABSENCE_PHRASES está definida y no vacía');

  await runGateUnitTests(assert);
  await runPromptContentTests(assert);
  await runEndToEndPersistenceTest(assert);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
