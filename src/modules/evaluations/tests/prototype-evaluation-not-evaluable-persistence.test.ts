import fs from 'fs';
import { prototypeEvaluationService } from '@/modules/evaluations/services/prototype-evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { Report } from '@/modules/reports/report.model';
import { aiService } from '@/modules/ai/ai.service';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';
import { buildValidPrototypeAuditOutputJson } from '@/shared/testing/prototype-gemini-mock-harness';

/**
 * P1.5.2 (Opción B autorizada), actualizado en P1.7.2 — análogo de
 * `audit-engine-not-evaluable-persistence.test.ts` para el pipeline de
 * prototipos, usando el mismo mecanismo de mocks ya validado en
 * `prototype-evaluation-retry-override.test.ts` (camino REAL completo:
 * `prototypeEvaluationService.run()` -> `AiService.
 * performPrototypeAuditAnalysis` -> `GeminiClient` interceptado -- Gate V0,
 * cardinalidad y consistencia visual NINGUNO mockeado).
 *
 * Tres criterios aplicables distintos (WCAG 1.4.1 FAIL, WCAG 1.1.1
 * NOT_EVALUABLE, N-04 PASS) para no colisionar entre sí en
 * `calculatePrototypeMetrics` (que, a diferencia de WEB, no deduplica por
 * selector -- cuenta hallazgos crudos directamente).
 *
 * P1.6.6.7 — el criterio del `failFinding` se cambió de WCAG 1.4.3 a WCAG
 * 1.4.1. Motivo: la nueva Gate Rule V5 (`visual-evidence-gate.service.ts`)
 * degrada CUALQUIER FAIL/PASS sobre WCAG 1.4.3 a NOT_EVALUABLE por
 * identidad de criterio (una observación cualitativa de contraste nunca
 * demuestra ni cumplimiento ni incumplimiento objetivo) -- seguir usando
 * 1.4.3 aquí habría invalidado el propósito original de este archivo (P1.5.2:
 * verificar la política de persistencia de FAIL/NOT_EVALUABLE/PASS, no el
 * comportamiento específico de contraste, que ya se cubre en
 * `confidence-severity-calibration.test.ts` y `gate-v5-non-demonstrable-
 * criteria.test.ts`). WCAG 1.4.1 (Uso del color) es DIRECTLY_EVALUABLE y
 * queda fuera del alcance de V5, por lo que el FAIL vuelve a persistir y a
 * contabilizarse exactamente como este archivo siempre pretendió probar.
 *
 * P1.7.2 — la política de persistencia cambió: PASS AHORA SÍ se persiste
 * (motivo: sin el Finding individual, un criterio "silencioso" era
 * indistinguible entre "Gemini lo marcó PASS y se descartó" y "nunca se
 * evaluó", violando la regla metodológica de no inferir PASS por ausencia
 * de Finding -- auditoría P1.7.1/P1.7.2). Este archivo se actualiza para
 * reflejar el nuevo contrato en vez de eliminarse, porque sigue siendo la
 * prueba de referencia para la política de persistencia completa
 * (FAIL+NOT_EVALUABLE+PASS) de este pipeline.
 */

const FAKE_EVALUATION_ID = 'fake-prototype-eval-id-p1-5-2';
const FAKE_USER_ID = 'fake-prototype-user-id-p1-5-2';

const sharedEvidence = {
  type: 'VISUAL_OBSERVATION',
  elementDescription: 'botón "Enviar" del formulario',
  region: 'bottom-center',
};

const failFinding = {
  findingGroup: 'accessibility',
  type: 'visual',
  status: 'FAIL',
  severity: 'high',
  confidence: 'high',
  wcagCriterion: 'WCAG 1.4.1 Uso del color',
  description: 'El campo requerido se indica únicamente mediante un borde de color rojo, sin ningún ícono o texto adicional.',
  evidence: [{ ...sharedEvidence, property: 'colorCoding', value: 'borde rojo sin ícono ni texto acompañante' }],
  recommendation: 'Agregar un ícono o texto que no dependa únicamente del color para indicar el campo requerido.',
};

const notEvaluableFinding = {
  findingGroup: 'accessibility',
  type: 'visual',
  status: 'NOT_EVALUABLE',
  severity: 'medium',
  confidence: 'high',
  wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
  description: 'No fue posible determinar si el ícono junto al botón tiene un texto alternativo programático equivalente.',
  evidence: [{ ...sharedEvidence, property: 'colorCoding', value: 'ícono sin texto visible acompañante' }],
  recommendation: null,
};

const passFinding = {
  findingGroup: 'ux',
  type: 'usability',
  status: 'PASS',
  severity: 'info',
  confidence: 'high',
  heuristicCode: 'N-04',
  heuristicName: 'Consistencia y estándares',
  description: 'El estilo del botón "Enviar" es consistente con el resto de los controles del formulario.',
  evidence: [{ ...sharedEvidence, property: 'visualHierarchy', value: 'primary' }],
  recommendation: null,
};

function fakeEvaluationDoc() {
  return {
    id: FAKE_EVALUATION_ID,
    title: 'Prototipo de prueba (P1.5.2)',
    description: 'Formulario de contacto ficticio para pruebas de persistencia NOT_EVALUABLE.',
    imageUrl: '/uploads/prototypes/fake-p1-5-2.png',
    evaluatorProfileId: { toString: () => 'fake-profile-id' },
  } as any;
}

function fakeProfile() {
  return {
    fullName: 'Perfil de prueba',
    archetype: 'El Explorador',
    profession: 'QA',
    phrase: 'frase',
    goals: ['probar'],
    frustrations: ['confusión'],
    techSavviness: 'medium',
    accessibilityNeeds: [],
    preferredDevice: 'desktop',
    biography: undefined,
  } as any;
}

function patchDependencies() {
  const originals = {
    findByIdAndUserId: evaluationRepository.findByIdAndUserId,
    update: evaluationRepository.update,
    profileFindById: evaluatorProfileService.findById,
    findingCreate: findingService.create,
    reportFindByEvaluationId: reportRepository.findByEvaluationId,
    reportCreate: reportRepository.create,
    readFileSync: fs.readFileSync,
    logInvocation: aiInteractionService.logInvocation,
  };

  const createdFindings: any[] = [];
  let capturedReportData: any = null;

  (evaluationRepository as any).findByIdAndUserId = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async () => fakeEvaluationDoc();
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (findingService as any).create = async (_userId: string, dto: any) => {
    createdFindings.push(dto);
    return dto;
  };
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async (dto: any) => {
    capturedReportData = dto;
    return dto;
  };
  // P1.7.4-A: la traza de invocación PROTOTYPE (éxito o fallo) se captura en memoria (sin MongoDB vivo en este sandbox).
  (aiInteractionService as any).logInvocation = async (params: any) => params;
  (fs as any).readFileSync = ((path: string, ...rest: any[]) => {
    if (typeof path === 'string' && path.includes('fake-p1-5-2.png')) {
      return Buffer.from('fake-png-bytes');
    }
    return originals.readFileSync(path, ...rest);
  }) as any;

  return {
    createdFindings,
    getReportData: () => capturedReportData,
    restore: () => {
      (evaluationRepository as any).findByIdAndUserId = originals.findByIdAndUserId;
      (evaluationRepository as any).update = originals.update;
      (evaluatorProfileService as any).findById = originals.profileFindById;
      (findingService as any).create = originals.findingCreate;
      (reportRepository as any).findByEvaluationId = originals.reportFindByEvaluationId;
      (reportRepository as any).create = originals.reportCreate;
      (fs as any).readFileSync = originals.readFileSync;
      (aiInteractionService as any).logInvocation = originals.logInvocation;
    },
  };
}

async function runTests() {
  console.log('🧪 Starting P1.5.2 — PROTOTYPE NOT_EVALUABLE persistence Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const deps = patchDependencies();
  const stub = stubGeminiJsonResponses([
    buildValidPrototypeAuditOutputJson([failFinding, notEvaluableFinding, passFinding]),
  ]);

  try {
    await (prototypeEvaluationService as any).run(FAKE_EVALUATION_ID, FAKE_USER_ID, undefined);

    const { createdFindings, getReportData } = deps;
    const reportData = getReportData();

    const persistedFail = createdFindings.find((f) => f.wcagCriterion === 'WCAG 1.4.1 Uso del color');
    const persistedNotEvaluable = createdFindings.find((f) => f.wcagCriterion === 'WCAG 1.1.1 Contenido no textual');
    const persistedPass = createdFindings.find((f) => f.heuristicCode === 'N-04');

    assert(!!persistedFail && persistedFail.status === 'FAIL', '1. El hallazgo FAIL (WCAG 1.4.1) persiste con status FAIL (comportamiento intacto)');
    assert(!!persistedNotEvaluable && persistedNotEvaluable.status === 'NOT_EVALUABLE', '2. El hallazgo NOT_EVALUABLE (WCAG 1.1.1) AHORA persiste con status NOT_EVALUABLE');
    assert(!!persistedPass && persistedPass.status === 'PASS', '3. El hallazgo PASS (N-04) AHORA SÍ persiste con status PASS (P1.7.2, corrige P1.5.2)');
    assert(
      persistedPass?.description === passFinding.description,
      '3b. El Finding PASS persistido conserva la descripción original de Gemini',
    );
    assert(
      Array.isArray(persistedPass?.evidence) && persistedPass.evidence.length === 1,
      '3c. El Finding PASS persistido conserva su evidencia original intacta',
    );

    assert(
      persistedNotEvaluable?.description === notEvaluableFinding.description,
      '4a. El Finding NOT_EVALUABLE persistido conserva la descripción original de Gemini',
    );
    assert(
      persistedNotEvaluable?.wcagCriterion === notEvaluableFinding.wcagCriterion,
      '4b. El Finding NOT_EVALUABLE persistido conserva el wcagCriterion original',
    );
    assert(
      Array.isArray(persistedNotEvaluable?.evidence) && persistedNotEvaluable.evidence.length === 1 &&
        persistedNotEvaluable.evidence[0].value === notEvaluableFinding.evidence[0].value,
      '4c. El Finding NOT_EVALUABLE persistido conserva su evidencia original intacta',
    );
    assert(
      persistedNotEvaluable?.recommendation == null,
      '4d. El Finding NOT_EVALUABLE persistido conserva recommendation null/undefined',
    );

    // 5. Métricas del Report: calculatePrototypeMetrics se ejecuta ANTES del
    // loop de persistencia modificado -- a diferencia de WEB, PROTOTYPE
    // cuenta hallazgos CRUDOS directamente (sin deduplicar por selector), así
    // que aquí SÍ se espera notEvaluableCount=1 (1 hallazgo NOT_EVALUABLE
    // crudo), totalFindings=3 (los 3 hallazgos crudos, cualquiera sea su
    // status -- ver P1.5.1 sección 3).
    assert(!!reportData, '5a. El Report se generó correctamente');
    assert(reportData?.failCount === 1, `5b. failCount=1 (criterio WCAG 1.4.1 FAIL), obtenido=${reportData?.failCount}`);
    assert(reportData?.notEvaluableCount === 1, `5c. notEvaluableCount=1 (1 hallazgo crudo NOT_EVALUABLE), obtenido=${reportData?.notEvaluableCount}`);
    assert(reportData?.passCount === 1, `5d. passCount=1 (criterio N-04 PASS), obtenido=${reportData?.passCount}`);
    assert(reportData?.totalFindings === 3, `5e. totalFindings=3 (los 3 hallazgos crudos: FAIL+NOT_EVALUABLE+PASS), obtenido=${reportData?.totalFindings}`);

    // 6. P1.7.2 -- sin duplicación introducida por el cambio: exactamente 1
    // Finding persistido por hallazgo crudo (3 crudos -> 3 persistidos),
    // nunca más de uno por criterio (los 3 criterios de este fixture son
    // distintos entre sí, ver docstring).
    assert(createdFindings.length === 3, `6a. Se persisten exactamente 3 Findings (uno por hallazgo crudo, sin duplicación), obtenido=${createdFindings.length}`);

    // 7. P1.7.2 -- nuevos campos de política/modelo en el Report.
    assert(reportData?.findingPersistencePolicy === 'PASS_PERSISTED', `7a. findingPersistencePolicy='PASS_PERSISTED', obtenido=${reportData?.findingPersistencePolicy}`);
    assert(typeof reportData?.geminiModel === 'string' && reportData.geminiModel.length > 0, `7b. geminiModel se asigna como string no vacío, obtenido=${JSON.stringify(reportData?.geminiModel)}`);

    // 8. P1-1 -- integridad de Report en PROTOTIPO y serialización de Mongoose:
    // - conserva `report.coverage` completo;
    // - NO inyecta artificialmente valores 0 o 20 en los campos exclusivos de WEB;
    // - conserva todos los campos requeridos por el frontend (EvaluationSummary).
    const serializedProtoReport = new Report(reportData).toJSON();
    assert(
      serializedProtoReport.coverage?.applicableCriteria === 13 &&
        serializedProtoReport.coverage?.evaluatedCriteria === 2 &&
        serializedProtoReport.coverage?.notEvaluableCriteria === 11 &&
        serializedProtoReport.coverage?.outOfCoverageCriteria === 6,
      '8a. P1-1 (PROTOTIPO): report.coverage se conserva íntegro tras serialización Mongoose (13 aplicables, 2 evaluados, 11 no evaluables, 6 fuera de cobertura)',
    );
    assert(
      serializedProtoReport.auditCoverage === undefined &&
        serializedProtoReport.nielsenCoverage === undefined &&
        serializedProtoReport.wcagCoverage === undefined &&
        serializedProtoReport.evaluatedCriteria === undefined &&
        serializedProtoReport.totalCriteria === undefined,
      '8b. P1-1 (PROTOTIPO): los campos de cobertura exclusivos de WEB quedan undefined (nunca se generan artificialmente con 0 o 20)',
    );
    assert(
      typeof serializedProtoReport.overallScore === 'number' &&
        serializedProtoReport.passCount === 1 &&
        serializedProtoReport.failCount === 1 &&
        serializedProtoReport.notEvaluableCount === 1 &&
        serializedProtoReport.totalFindings === 3 &&
        !!serializedProtoReport.metrics,
      '8c. P1-1 (PROTOTIPO): la serialización conserva overallScore, passCount, failCount, notEvaluableCount, totalFindings y metrics requeridos por el frontend',
    );

    // 9. P1-2 y P0-1 -- verificación determinística del prompt de prototipo
    // generado por buildPrototypeAuditPrompt (regla de paridad property/value y
    // ejemplo explícito con prefijo "WCAG " en la plantilla JSON).
    const capturedPrompt: string = (aiService as any).buildPrototypeAuditPrompt(
      {
        evaluationId: FAKE_EVALUATION_ID,
        title: 'Prototipo de prueba (P1.5.2)',
        description: 'Formulario de contacto ficticio para pruebas de persistencia NOT_EVALUABLE.',
        archetype: fakeProfile(),
      },
      resolveApplicablePrototypeCriteria(),
    );
    assert(
      capturedPrompt.includes('NEVER set a non-null') && capturedPrompt.includes('NEVER null when property is present'),
      '9a. P1-2: buildPrototypeAuditPrompt incluye la regla explícita y el recordatorio en plantilla JSON de que property y value deben ser ambos cadenas no vacías o ambos null',
    );
    assert(
      capturedPrompt.includes('e.g. WCAG 1.4.3 Contraste mínimo') && capturedPrompt.includes('e.g. visualLabel'),
      '9b. P0-1/P1-2: la plantilla JSON de buildPrototypeAuditPrompt incluye ejemplos explícitos con prefijo "WCAG " y par property/value',
    );
  } finally {
    stub.restore();
    deps.restore();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
