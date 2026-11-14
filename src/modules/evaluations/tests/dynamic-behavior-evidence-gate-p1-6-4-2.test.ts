import fs from 'fs';
import {
  visualEvidenceGateService,
  DYNAMIC_BEHAVIOR_ABSENCE_PHRASES,
  DYNAMIC_BEHAVIOR_NOT_EVALUABLE_PREFIX,
} from '@/modules/evaluations/services/visual-evidence-gate.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { prototypeEvaluationService } from '@/modules/evaluations/services/prototype-evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';
import { buildValidPrototypeAuditOutputJson } from '@/shared/testing/prototype-gemini-mock-harness';

/**
 * P1.6.4.2 — corrige los dos defectos reproducibles que la auditoría
 * adversarial P1.6.4.1 encontró en la Gate Rule V1 de P1.6.4:
 *   - Caso A (falso positivo): un FAIL con evidencia visual estructurada
 *     real se degradaba igual que uno sin evidencia, solo por mencionar una
 *     frase de la lista como aclaración honesta.
 *   - Casos C/D (falso negativo): paráfrasis del hallazgo N-05 original
 *     evadían las 14 frases exactas de la lista.
 * Esta suite reproduce los 10 escenarios adversariales exigidos por
 * P1.6.4.2, con fixtures deterministas, sin ninguna llamada real a Gemini.
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

async function runTests() {
  console.log('🧪 Starting P1.6.4.2 — Dynamic Behavior Gate Rule V1 (corrección adversarial) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ------------------------------------------------------------------
  // Caso A — falso positivo corregido: evidencia estructurada real exime
  // de la degradación aunque la descripción mencione, como aclaración
  // honesta, una frase de la lista.
  // ------------------------------------------------------------------
  const [caseA] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      wcagCriterion: 'WCAG 1.4.1 Uso del color',
      description: 'El formulario presenta un mensaje de error rojo visible debajo del campo de correo electrónico, pero no se puede determinar si también dispone de validación en tiempo real.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'colorCoding', value: 'mensaje de error indicado solo por color rojo, sin ícono ni texto adicional', elementDescription: 'Mensaje de error bajo el campo de correo electrónico', region: 'middle-right' }],
    }),
  ]);
  assert(caseA.status === 'FAIL', '1. Caso A: evidencia estructurada real exime la degradación -- el hallazgo visual legítimo conserva FAIL (defecto corregido)');
  assert(caseA.description === 'El formulario presenta un mensaje de error rojo visible debajo del campo de correo electrónico, pero no se puede determinar si también dispone de validación en tiempo real.', '1b. La descripción no se altera cuando no hubo degradación');

  // ------------------------------------------------------------------
  // Caso B — estado dinámico realmente visible con evidencia.
  // ------------------------------------------------------------------
  const [caseB] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      wcagCriterion: 'WCAG 1.4.1 Uso del color',
      description: 'Se observa un mensaje de validación que indica que el correo electrónico es inválido, pero se comunica únicamente mediante color rojo, sin ícono ni texto alternativo.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'colorCoding', value: 'mensaje de validación en rojo, sin ícono', elementDescription: "Mensaje 'correo electrónico inválido' bajo el campo de correo", region: 'middle-right' }],
    }),
  ]);
  assert(caseB.status === 'FAIL', '2. Caso B: estado dinámico genuinamente visible y evidenciado conserva FAIL');

  // ------------------------------------------------------------------
  // Caso C — falso negativo corregido: las dos frases nuevas
  // ('validación automática', 'retroalimentación al usuario') detectan
  // esta variante que la v1 de P1.6.4 no detectaba.
  // ------------------------------------------------------------------
  const [caseC] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-05',
      heuristicName: 'Prevención de errores',
      description: 'El formulario carece de validación automática, no informa errores y no proporciona retroalimentación al usuario.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observa ningún indicio de error en la captura.', elementDescription: 'Formulario de contacto', region: 'middle-right' }],
    }),
  ]);
  assert(caseC.status === 'NOT_EVALUABLE', '3. Caso C: la variante semántica ahora SÍ se detecta (defecto corregido) gracias a "validación automática"/"retroalimentación al usuario"');
  assert(caseC.description!.startsWith(DYNAMIC_BEHAVIOR_NOT_EVALUABLE_PREFIX), '3b. La descripción degradada lleva el prefijo de aclaración, sin perder el texto original');
  assert(caseC.description!.includes('El formulario carece de validación automática'), '3c. El texto original de Gemini se preserva íntegro tras el prefijo');

  // ------------------------------------------------------------------
  // Caso D — variación semántica adicional: LIMITACIÓN ACEPTADA Y
  // DOCUMENTADA, no corregida -- ninguna frase (ni las originales ni las
  // 2 nuevas) coincide con esta redacción. Se documenta explícitamente
  // aquí como un gap conocido, no se fuerza una corrección ad hoc para
  // hacerlo pasar (eso violaría "no ampliar indiscriminadamente la lista
  // de frases").
  // ------------------------------------------------------------------
  const [caseD] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-05',
      heuristicName: 'Prevención de errores',
      description: 'El sistema no informa al usuario cuando introduce datos incorrectos.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observa ningún mecanismo de aviso en la captura.', elementDescription: 'Formulario de contacto', region: 'middle-right' }],
    }),
  ]);
  assert(caseD.status === 'FAIL', '4. Caso D: LIMITACIÓN ACEPTADA -- esta paráfrasis sigue evadiendo la regla (gap residual documentado, no corregido ad hoc)');

  // ------------------------------------------------------------------
  // Caso E — ausencia de etiqueta visual (Regla C, debe seguir FAIL).
  // [P1.6.6.7: usaba antes `wcagCriterion: 'WCAG 3.3.2'`; la nueva Gate
  // Rule V5 degrada correctamente cualquier FAIL/PASS sobre ese criterio
  // por identidad -- sustituido por un heurístico Nielsen (V5 solo lee
  // `wcagCriterion`) para seguir aislando aquí el comportamiento de la
  // Gate Rule V1, ya probada específicamente para V5 en
  // `gate-v5-non-demonstrable-criteria.test.ts`. evidence sin cambios.]
  // ------------------------------------------------------------------
  const [caseE] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-06',
      heuristicName: 'Reconocimiento antes que recuerdo',
      description: 'Los campos del formulario no presentan etiquetas visibles y solo muestran placeholders.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualLabel', value: '', elementDescription: 'Campo de texto para nombre completo', region: 'middle-right' }],
    }),
  ]);
  assert(caseE.status === 'FAIL', '5. Caso E: ausencia de etiqueta visual (hallazgo Nielsen N-06) conserva FAIL');

  // ------------------------------------------------------------------
  // Caso F — contraste (Regla C, debe seguir FAIL). [P1.6.6.7: usaba antes
  // `wcagCriterion: 'WCAG 1.4.3'`; sustituido por un heurístico Nielsen por
  // la misma razón que el Caso E -- V5 degrada categóricamente cualquier
  // FAIL/PASS sobre WCAG 1.4.3.]
  // ------------------------------------------------------------------
  const [caseF] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-08',
      heuristicName: 'Diseño estético y minimalista',
      description: 'El texto secundario blanco sobre el fondo morado presenta contraste visual insuficiente.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto secundario bajo "Get In Touch"', region: 'middle-left' }],
    }),
  ]);
  assert(caseF.status === 'FAIL', '6. Caso F: contraste insuficiente (hallazgo Nielsen N-08) conserva FAIL');

  // ------------------------------------------------------------------
  // Caso G — hallazgo mixto (observación visual + afirmación dinámica
  // independiente), con un criterio DISTINTO al de Caso A, para confirmar
  // que la corrección es general y no específica de un solo ejemplo.
  // [P1.6.6.7: usaba antes `wcagCriterion: 'WCAG 1.3.1'`, ahora también
  // alcanzado por la Gate Rule V5 -- sustituido por WCAG 2.4.6 (DIRECTLY_
  // EVALUABLE, distinto del WCAG 1.4.1 de los Casos A/B, fuera del alcance
  // de V5), preservando la intención original de "un criterio distinto".]
  // ------------------------------------------------------------------
  const [caseG] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
      description: 'El encabezado "Enviar" tiene menor peso visual que el texto circundante, lo que genera una jerarquía confusa; no es posible determinar si existe una confirmación de envío posterior.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualHierarchy', value: 'secondary', elementDescription: 'Encabezado "Enviar" sobre el botón', region: 'middle-right' }],
    }),
  ]);
  assert(caseG.status === 'FAIL', '7. Caso G: hallazgo mixto conserva el problema visual legítimo (jerarquía) sin perderlo por la afirmación dinámica independiente');

  // ------------------------------------------------------------------
  // Caso H — NOT_EVALUABLE con descripción afirmativa: el texto final ya
  // no debe presentar la ausencia funcional como un hecho comprobado.
  // ------------------------------------------------------------------
  const [caseH] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-05',
      heuristicName: 'Prevención de errores',
      description: 'El formulario carece de mecanismos visibles de prevención de errores o retroalimentación inmediata sobre la validez de la entrada del usuario.',
      evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observan indicadores visuales de error.', elementDescription: 'Campos del formulario', region: 'middle-right' }],
    }),
  ]);
  assert(caseH.status === 'NOT_EVALUABLE', '8. Caso H: el fixture real del piloto (N-05) sigue degradando correctamente');
  assert(caseH.description!.startsWith('No fue posible verificar con la imagen disponible'), '8b. La descripción final ya NO abre afirmando "El formulario carece de..." como hecho comprobado');
  assert(caseH.confidence === 'low', '8c. confidence se normaliza a low');
  assert(caseH.recommendation === null, '8d. recommendation se limpia a null (no presupone una funcionalidad inexistente)');

  // ------------------------------------------------------------------
  // Caso I — resumen ejecutivo: se cubre con un test de unidad directo de
  // appendNotEvaluableDisclaimer vía el flujo extremo a extremo (ver
  // runEndToEndTests abajo, Sección 9/10) -- la función en sí no se
  // exporta (uso interno de prototype-evaluation.service.ts), así que se
  // verifica a través del Report persistido real.
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Caso J — un FAIL legítimo que usa las palabras "validación"/"error"
  // sin reclamar su ausencia NO debe degradarse por vocabulario.
  // ------------------------------------------------------------------
  // [P1.6.6.7: usaba antes `wcagCriterion: 'WCAG 1.4.3'`; sustituido por un
  // heurístico Nielsen por la misma razón documentada en el Caso F.]
  const [caseJ1] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-08',
      heuristicName: 'Diseño estético y minimalista',
      description: 'El mensaje de error visible junto al campo de correo tiene un contraste insuficiente respecto al fondo.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Mensaje de error junto al campo de correo', region: 'middle-right' }],
    }),
  ]);
  assert(caseJ1.status === 'FAIL', '9. Caso J (variante 1): un FAIL legítimo que menciona "error" (mensaje VISIBLE con bajo contraste) no se degrada por vocabulario');

  const [caseJ2] = visualEvidenceGateService.processPrototypeFindings([
    finding({
      heuristicCode: 'N-06',
      heuristicName: 'Reconocimiento antes que recuerdo',
      description: 'El ícono de validación junto al campo de correo es visualmente indistinguible del ícono de error, ambos usan el mismo color y forma.',
      evidence: [{ type: 'VISUAL_OBSERVATION', property: 'colorCoding', value: 'mismo color y forma para ambos íconos', elementDescription: 'Íconos de validación y error junto al campo de correo', region: 'middle-right' }],
    }),
  ]);
  assert(caseJ2.status === 'FAIL', '10. Caso J (variante 2): un FAIL legítimo que menciona "validación" y "error" (íconos VISIBLES indistinguibles) no se degrada por vocabulario');

  // ------------------------------------------------------------------
  // Regresión P1.6.4 — las 16 frases (14 originales + 2 nuevas) siguen
  // definidas, nunca se eliminó ninguna.
  // ------------------------------------------------------------------
  assert(DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.length === 16, '11. Regresión P1.6.4: 14 frases originales + 2 nuevas = 16 (ninguna se eliminó)');
  assert(DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.includes('validación en tiempo real'), '11b. Frase original "validación en tiempo real" se conserva');
  assert(DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.includes('validación automática'), '11c. Frase nueva "validación automática" presente');
  assert(DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.includes('retroalimentación al usuario'), '11d. Frase nueva "retroalimentación al usuario" presente');

  await runEndToEndTests(assert);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

/**
 * Regresión extremo a extremo de P1.5.2/P1.7.2 (persistencia de
 * FAIL+NOT_EVALUABLE+PASS, los tres) + Caso I (disclaimer del resumen
 * ejecutivo), reutilizando el mismo mecanismo de mocks ya validado en
 * P1.5.2/P1.6.4.
 */
async function runEndToEndTests(assert: (c: boolean, m: string) => void) {
  console.log('\n--- Extremo a extremo: persistencia (P1.5.2) + disclaimer del resumen (Caso I) ---');

  const FAKE_EVALUATION_ID = 'fake-prototype-eval-id-p1-6-4-2';
  const FAKE_USER_ID = 'fake-prototype-user-id-p1-6-4-2';

  const n05RawFromGemini = {
    findingGroup: 'ux', type: 'usability', status: 'FAIL', severity: 'high', confidence: 'high',
    heuristicCode: 'N-05', heuristicName: 'Prevención de errores',
    description: 'El formulario carece de validación automática, no informa errores y no proporciona retroalimentación al usuario.',
    evidence: [{ type: 'VISUAL_OBSERVATION', context: 'No se observa ningún indicio de error en la captura.', elementDescription: 'Formulario de contacto', region: 'middle-right' }],
    recommendation: 'Implementar validación en tiempo real.',
  };
  // [P1.6.6.7: usaba antes `wcagCriterion: 'WCAG 1.4.3'`; sustituido por un
  // heurístico Nielsen por la misma razón documentada en el Caso F -- la
  // nueva Gate Rule V5 degrada categóricamente cualquier FAIL/PASS sobre
  // WCAG 1.4.3, y este test verifica específicamente la Gate Rule V1.]
  const contrastFinding = {
    findingGroup: 'accessibility', type: 'visual', status: 'FAIL', severity: 'high', confidence: 'high',
    heuristicCode: 'N-08', heuristicName: 'Diseño estético y minimalista',
    description: 'El contraste entre el texto y el fondo parece ser bajo.',
    evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualContrast', value: 'appears-low', elementDescription: 'Texto bajo "Call us"', region: 'middle-left' }],
    recommendation: 'Aumentar el contraste del texto.',
  };
  const passFinding = {
    findingGroup: 'ux', type: 'usability', status: 'PASS', severity: 'info', confidence: 'high',
    heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
    description: 'El estilo de los botones es consistente en toda la página.',
    evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visualHierarchy', value: 'primary', elementDescription: 'Botón Enviar', region: 'middle-right' }],
    recommendation: null,
  };

  function fakeEvaluationDoc() {
    return {
      id: FAKE_EVALUATION_ID, title: 'Prototipo de prueba (P1.6.4.2)', description: 'Formulario de contacto ficticio.',
      imageUrl: '/uploads/prototypes/fake-p1-6-4-2.png', evaluatorProfileId: { toString: () => 'fake-profile-id' },
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
  let capturedReport: any = null;
  (evaluationRepository as any).findByIdAndUserId = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async () => fakeEvaluationDoc();
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (findingService as any).create = async (_userId: string, dto: any) => { createdFindings.push(dto); return dto; };
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async (dto: any) => { capturedReport = dto; return dto; };
  (fs as any).readFileSync = ((path: string, ...rest: any[]) => {
    if (typeof path === 'string' && path.includes('fake-p1-6-4-2.png')) return Buffer.from('fake-png-bytes');
    return originals.readFileSync(path, ...rest);
  }) as any;

  // JSON construido a mano (no vía buildValidPrototypeAuditOutputJson, que
  // no admite un executiveSummary personalizado) para controlar el texto
  // exacto del resumen y poder verificar el Caso I (disclaimer determinista).
  const stub = stubGeminiJsonResponses([
    JSON.stringify({
      overallScore: 40,
      executiveSummary: 'El formulario carece de validación en tiempo real y presenta bajo contraste en algunos textos.',
      findings: [n05RawFromGemini, contrastFinding, passFinding],
    }),
  ]);

  try {
    await (prototypeEvaluationService as any).run(FAKE_EVALUATION_ID, FAKE_USER_ID, undefined);

    const persistedN05 = createdFindings.find((f) => f.heuristicCode === 'N-05');
    const persistedContrast = createdFindings.find((f) => f.heuristicCode === 'N-08');
    const persistedPass = createdFindings.find((f) => f.heuristicCode === 'N-04');

    assert(!!persistedN05 && persistedN05.status === 'NOT_EVALUABLE', '12. Regresión P1.5.2 extremo a extremo: N-05 (variante corregida) persiste NOT_EVALUABLE');
    assert(!!persistedContrast && persistedContrast.status === 'FAIL', '13. Regresión P1.5.2 extremo a extremo: contraste persiste FAIL sin cambios');
    assert(!!persistedPass && persistedPass.status === 'PASS', '14. Regresión P1.7.2 extremo a extremo: PASS (N-04) AHORA TAMBIÉN persiste con status PASS');

    assert(!!capturedReport, '15. Caso I: el Report se generó');
    assert(capturedReport.summary.includes('no pudieron verificarse con la imagen disponible'), '16. Caso I: el resumen incluye la aclaración determinista sobre criterios NOT_EVALUABLE (al existir al menos uno)');
    assert(capturedReport.summary.includes('Prevención de errores'), '17. Caso I: la aclaración identifica el criterio NOT_EVALUABLE concreto (N-05), no un aviso genérico vacío');
    assert(capturedReport.summary.startsWith('El formulario carece de validación en tiempo real'), '18. Caso I: el resumen original de Gemini se preserva íntegro al inicio (no se elimina ni se reemplaza)');
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

  // ------------------------------------------------------------------
  // Regresión: sin ningún NOT_EVALUABLE, el resumen NO lleva ninguna
  // aclaración nueva (no convertir el resumen en advertencias innecesarias).
  // ------------------------------------------------------------------
  const originals2 = {
    findByIdAndUserId: evaluationRepository.findByIdAndUserId,
    update: evaluationRepository.update,
    profileFindById: evaluatorProfileService.findById,
    findingCreate: findingService.create,
    reportFindByEvaluationId: reportRepository.findByEvaluationId,
    reportCreate: reportRepository.create,
    readFileSync: fs.readFileSync,
  };
  let capturedReport2: any = null;
  (evaluationRepository as any).findByIdAndUserId = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async () => fakeEvaluationDoc();
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (findingService as any).create = async (_userId: string, dto: any) => dto;
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async (dto: any) => { capturedReport2 = dto; return dto; };
  (fs as any).readFileSync = ((path: string, ...rest: any[]) => {
    if (typeof path === 'string' && path.includes('fake-p1-6-4-2.png')) return Buffer.from('fake-png-bytes');
    return originals2.readFileSync(path, ...rest);
  }) as any;

  const stub2 = stubGeminiJsonResponses([
    buildValidPrototypeAuditOutputJson([contrastFinding], 40),
  ]);
  try {
    await (prototypeEvaluationService as any).run('fake-prototype-eval-id-p1-6-4-2-b', FAKE_USER_ID, undefined);
    assert(!capturedReport2.summary.includes('no pudieron verificarse con la imagen disponible'), '19. Sin ningún NOT_EVALUABLE, el resumen NO lleva la aclaración nueva (no se convierte en advertencias innecesarias)');
  } finally {
    stub2.restore();
    (evaluationRepository as any).findByIdAndUserId = originals2.findByIdAndUserId;
    (evaluationRepository as any).update = originals2.update;
    (evaluatorProfileService as any).findById = originals2.profileFindById;
    (findingService as any).create = originals2.findingCreate;
    (reportRepository as any).findByEvaluationId = originals2.reportFindByEvaluationId;
    (reportRepository as any).create = originals2.reportCreate;
    (fs as any).readFileSync = originals2.readFileSync;
  }
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
