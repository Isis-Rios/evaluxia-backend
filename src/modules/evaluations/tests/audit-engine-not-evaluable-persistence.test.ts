import { auditEngine } from '@/modules/evaluations/services/audit-engine.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { Report } from '@/modules/reports/report.model';
import { stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * P1.5.2 (Opción B autorizada), actualizado en P1.7.2 — confirma, usando el
 * camino REAL completo (`auditEngine.performAudit()` ->
 * `aiService.performAuditAnalysis()` -> `GeminiClient` interceptado, ninguno
 * de los pasos intermedios mockeado: EvidenceGate/J1, cardinalidad J6,
 * consolidación), que:
 *
 *   1. Un hallazgo FAIL sigue persistiendo (comportamiento intacto).
 *   2. Un hallazgo NOT_EVALUABLE (generado explícitamente por Gemini, no
 *      sintetizado) AHORA persiste -- antes de P1.5.2 se perdía en silencio.
 *   3. Un hallazgo PASS AHORA TAMBIÉN persiste (P1.7.2, corrige P1.5.2):
 *      sin el Finding individual, un criterio "silencioso" era
 *      indistinguible entre "Gemini lo marcó PASS y se descartó" y "nunca
 *      se evaluó", violando la regla metodológica de no inferir PASS por
 *      ausencia de Finding (auditoría P1.7.1/P1.7.2).
 *   4. El documento `Finding` persistido para NOT_EVALUABLE conserva status,
 *      descripción, evidencia y criterio originales intactos.
 *   5. Las métricas del Report (failCount/passCount/notEvaluableCount/
 *      totalFindings/evidenceCount) son EXACTAMENTE las esperadas según
 *      `calculateMetrics` -- ese cálculo ocurre ANTES del loop de
 *      persistencia modificado, así que estos números no pueden haber
 *      cambiado por este fix (verificado aquí, no solo asumido).
 *   6. `findingPersistencePolicy`/`geminiModel` quedan asignados en el
 *      Report (P1.7.2).
 *
 * Mocks: mismo mecanismo ya validado en
 * `prototype-evaluation-retry-override.test.ts` (parchear el método en el
 * singleton real, restaurar al final) -- no hay MongoDB vivo en este
 * sandbox. El único dato real no-mockeado es la llamada a Gemini, servida
 * por `stubGeminiJsonResponses` (cero red, cero costo).
 *
 * El botón `button.contact-submit` (único elemento en el SnapshotEvidence
 * fixture) tiene un `ariaLabel` válido -> el analizador determinístico lo
 * evalúa como PASS por su cuenta (WCAG 4.1.2) -- esto es deliberado: deja
 * evidencia REAL e indexada para que los 3 hallazgos de IA (que citan ese
 * mismo selector/ariaLabel con heurísticas DISTINTAS, nunca relacionadas
 * con el nombre accesible del botón) pasen la Gate 0/J6 de trazabilidad sin
 * depender de ningún selector inventado. Ninguno de los 3 define
 * `affectedElement` propio -- evita por completo las Gates 0/0b (que solo
 * aplican cuando el finding declara su propio selector), y confirma que la
 * identidad de dedup (`selectorKey = affectedElement?.selector ?? tag ??
 * 'global'`) los mantiene en 3 cubetas separadas entre sí y separadas del
 * PASS determinístico del botón.
 */

const FAKE_EVALUATION_ID = 'fake-web-eval-id';
const FAKE_USER_ID = 'fake-web-user-id';

const BUTTON_SELECTOR = 'button.contact-submit';
const BUTTON_ARIA_LABEL = 'Enviar formulario';

const sharedEvidenceCitation = {
  type: 'DOM_ATTRIBUTE' as const,
  selector: BUTTON_SELECTOR,
  attribute: 'ariaLabel',
  value: BUTTON_ARIA_LABEL,
};

const aiFailFinding = {
  findingGroup: 'ux',
  type: 'usability',
  status: 'FAIL',
  severity: 'medium',
  confidence: 'high',
  heuristicCode: 'N-03',
  heuristicName: 'Control y libertad del usuario',
  description: 'El formulario de contacto no ofrece una forma visible de cancelar o deshacer el envío.',
  evidence: [sharedEvidenceCitation],
  recommendation: 'Agregar un botón de cancelar junto al de enviar.',
};

const aiNotEvaluableFinding = {
  findingGroup: 'accessibility',
  type: 'wcag',
  status: 'NOT_EVALUABLE',
  severity: 'medium',
  confidence: 'high',
  wcagCriterion: 'WCAG 1.3.1 Información y relaciones',
  description: 'No fue posible confirmar si la jerarquía de encabezados del formulario refleja su estructura semántica real.',
  evidence: [sharedEvidenceCitation],
  recommendation: null,
};

const aiPassFinding = {
  findingGroup: 'ux',
  type: 'usability',
  status: 'PASS',
  severity: 'info',
  confidence: 'high',
  heuristicCode: 'N-08',
  heuristicName: 'Diseño estético y minimalista',
  description: 'El formulario mantiene un diseño limpio y sin ruido visual innecesario.',
  evidence: [sharedEvidenceCitation],
  recommendation: null,
};

function fakeEvaluationDoc() {
  return {
    userId: FAKE_USER_ID,
    evaluatorProfileId: 'fake-profile-id',
    title: 'Sitio de prueba (P1.5.2)',
    url: 'https://fixture.local/p1-5-2',
    flowState: { completedSteps: [], previousActions: [], blockingError: null },
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
  } as any;
}

const fixtureEvidence = [
  {
    iteration: 1,
    url: 'https://fixture.local/p1-5-2',
    screenshotPath: '/uploads/p1-5-2_step_1.png',
    buttons: [
      {
        selector: BUTTON_SELECTOR,
        tag: 'button',
        text: 'Enviar',
        ariaLabel: BUTTON_ARIA_LABEL,
        role: 'button',
        isDisabled: false,
        isPrimary: true,
      },
    ],
  },
] as any;

function patchDependencies() {
  const originals = {
    findById: evaluationRepository.findById,
    update: evaluationRepository.update,
    profileFindById: evaluatorProfileService.findById,
    getEvidencesForEvaluation: snapshotEvidenceService.getEvidencesForEvaluation,
    getInteractions: aiInteractionService.getInteractions,
    logInvocation: aiInteractionService.logInvocation,
    findingCreate: findingService.create,
    reportFindByEvaluationId: reportRepository.findByEvaluationId,
    reportCreate: reportRepository.create,
  };

  const createdFindings: any[] = [];
  let capturedReportData: any = null;

  (evaluationRepository as any).findById = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async () => fakeEvaluationDoc();
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (snapshotEvidenceService as any).getEvidencesForEvaluation = async () => fixtureEvidence;
  (aiInteractionService as any).getInteractions = async () => [];
  // P1.7.4-A: la traza de invocación PHASE_2 se captura en memoria (sin MongoDB vivo en este sandbox).
  (aiInteractionService as any).logInvocation = async (params: any) => params;
  (findingService as any).create = async (_userId: string, dto: any) => {
    createdFindings.push(dto);
    return dto;
  };
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async (dto: any) => {
    capturedReportData = dto;
    return dto;
  };

  return {
    createdFindings,
    getReportData: () => capturedReportData,
    restore: () => {
      (evaluationRepository as any).findById = originals.findById;
      (evaluationRepository as any).update = originals.update;
      (evaluatorProfileService as any).findById = originals.profileFindById;
      (snapshotEvidenceService as any).getEvidencesForEvaluation = originals.getEvidencesForEvaluation;
      (aiInteractionService as any).getInteractions = originals.getInteractions;
      (aiInteractionService as any).logInvocation = originals.logInvocation;
      (findingService as any).create = originals.findingCreate;
      (reportRepository as any).findByEvaluationId = originals.reportFindByEvaluationId;
      (reportRepository as any).create = originals.reportCreate;
    },
  };
}

async function runTests() {
  console.log('🧪 Starting P1.5.2 — WEB NOT_EVALUABLE persistence (audit-engine.service.ts) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const deps = patchDependencies();
  const stub = stubGeminiJsonResponses([
    buildValidAuditOutputJson([aiFailFinding, aiNotEvaluableFinding, aiPassFinding]),
  ]);

  try {
    await auditEngine.performAudit(FAKE_EVALUATION_ID, 'Sitio de prueba (P1.5.2)');

    const { createdFindings, getReportData } = deps;
    const reportData = getReportData();

    const persistedFail = createdFindings.find((f) => f.heuristicCode === 'N-03');
    const persistedNotEvaluable = createdFindings.find((f) => f.wcagCriterion === 'WCAG 1.3.1 Información y relaciones');
    const persistedPass = createdFindings.find((f) => f.heuristicCode === 'N-08');
    const persistedDeterministicPass = createdFindings.find((f) => f.wcagCriterion === 'WCAG 4.1.2 Nombre, función y valor');

    assert(!!persistedFail && persistedFail.status === 'FAIL', '1. El hallazgo FAIL (N-03) persiste con status FAIL (comportamiento intacto)');
    assert(!!persistedNotEvaluable && persistedNotEvaluable.status === 'NOT_EVALUABLE', '2. El hallazgo NOT_EVALUABLE (WCAG 1.3.1) AHORA persiste con status NOT_EVALUABLE');
    assert(!!persistedPass && persistedPass.status === 'PASS', '3. El hallazgo PASS de IA (N-08) AHORA SÍ persiste con status PASS (P1.7.2, corrige P1.5.2)');
    assert(!!persistedDeterministicPass && persistedDeterministicPass.status === 'PASS', '3b. El hallazgo PASS determinístico (WCAG 4.1.2) AHORA TAMBIÉN persiste con status PASS');

    assert(
      persistedNotEvaluable?.description === aiNotEvaluableFinding.description,
      '4a. El Finding NOT_EVALUABLE persistido conserva la descripción original de Gemini',
    );
    assert(
      persistedNotEvaluable?.wcagCriterion === aiNotEvaluableFinding.wcagCriterion,
      '4b. El Finding NOT_EVALUABLE persistido conserva el wcagCriterion original',
    );
    assert(
      Array.isArray(persistedNotEvaluable?.evidence) && persistedNotEvaluable.evidence.length === 1 &&
        persistedNotEvaluable.evidence[0].value === BUTTON_ARIA_LABEL,
      '4c. El Finding NOT_EVALUABLE persistido conserva su evidencia original intacta',
    );
    assert(
      persistedNotEvaluable?.recommendation == null,
      '4d. El Finding NOT_EVALUABLE persistido conserva recommendation null/undefined (regla de EvidenceGate/J1, sin cambios)',
    );

    // 5. Métricas del Report: deben reflejar EXACTAMENTE lo mismo que antes
    // de P1.5.2, porque `calculateMetrics` se ejecuta ANTES del loop de
    // persistencia modificado -- el cambio de persistencia no puede haberlas
    // tocado. En WEB, `failCount`/`passCount`/`notEvaluableCount` cuentan
    // CRITERIOS sobre un espacio FIJO de 20 (10 Nielsen + 10 WCAG), no
    // hallazgos crudos (ver P1.5.1 sección 3): FAIL=1 (N-03), PASS=2 (N-08
    // de IA + WCAG 4.1.2 determinístico del botón). El hallazgo
    // NOT_EVALUABLE de IA (WCAG 1.3.1) NO mueve `notEvaluableCount` -- ese
    // criterio YA estaba en su default NOT_EVALUABLE antes de que Gemini lo
    // citara explícitamente; `calculateMetrics` no tiene una rama que
    // reaccione a `status === 'NOT_EVALUABLE'` (solo a FAIL/PASS), así que
    // persistir ahora ese hallazgo como `Finding` no cambia ni un número del
    // Report: notEvaluableCount sigue siendo "20 - evaluados" = 17 (9 WCAG +
    // 8 Nielsen nunca tocados), exactamente igual que antes de este fix.
    assert(!!reportData, '5a. El Report se generó correctamente');
    assert(reportData?.failCount === 1, `5b. failCount=1 (criterio N-03 FAIL), obtenido=${reportData?.failCount}`);
    assert(reportData?.notEvaluableCount === 17, `5c. notEvaluableCount=17 (criterios nunca tocados; el NOT_EVALUABLE de IA no incrementa este número, solo ahora SÍ se persiste como Finding), obtenido=${reportData?.notEvaluableCount}`);
    assert(reportData?.passCount === 2, `5d. passCount=2 (N-08 de IA + WCAG 4.1.2 determinístico del botón), obtenido=${reportData?.passCount}`);
    assert(reportData?.totalFindings === 1, `5e. totalFindings=1 (único criterio consolidado en FAIL), obtenido=${reportData?.totalFindings}`);

    // 6. P1.7.2 -- sin duplicación introducida por el cambio: exactamente 1
    // Finding persistido por cada uno de los 4 criterios distintos de este
    // fixture (FAIL N-03, NOT_EVALUABLE WCAG 1.3.1, PASS N-08, PASS WCAG
    // 4.1.2) -- 4 documentos en total, ninguno repetido.
    assert(createdFindings.length === 4, `6a. Se persisten exactamente 4 Findings (uno por criterio consolidado, sin duplicación), obtenido=${createdFindings.length}`);

    // 7. P1.7.2 -- nuevos campos de política/modelo en el Report.
    assert(reportData?.findingPersistencePolicy === 'PASS_PERSISTED', `7a. findingPersistencePolicy='PASS_PERSISTED', obtenido=${reportData?.findingPersistencePolicy}`);
    assert(typeof reportData?.geminiModel === 'string' && reportData.geminiModel.length > 0, `7b. geminiModel se asigna como string no vacío, obtenido=${JSON.stringify(reportData?.geminiModel)}`);

    // 8. P1-1 -- tras retirar los defaults numéricos en ReportSchema, el flujo
    // WEB sigue poblando explícitamente todos sus campos de cobertura y
    // cumplimiento, y la serialización de Mongoose (`new Report(reportData).toJSON()`)
    // conserva intactas todas las métricas que consume el frontend.
    const serializedWebReport = new Report(reportData).toJSON();
    assert(serializedWebReport.totalCriteria === 20, `8a. P1-1 (WEB): totalCriteria=20 conservado explícitamente tras retirar default, obtenido=${serializedWebReport.totalCriteria}`);
    assert(serializedWebReport.evaluatedCriteria === 3, `8b. P1-1 (WEB): evaluatedCriteria=3 (1 FAIL + 2 PASS), obtenido=${serializedWebReport.evaluatedCriteria}`);
    assert(serializedWebReport.auditCoverage === 15, `8c. P1-1 (WEB): auditCoverage=15% (3/20), obtenido=${serializedWebReport.auditCoverage}`);
    assert(serializedWebReport.nielsenCoverage === 20, `8d. P1-1 (WEB): nielsenCoverage=20% (2/10), obtenido=${serializedWebReport.nielsenCoverage}`);
    assert(serializedWebReport.wcagCoverage === 10, `8e. P1-1 (WEB): wcagCoverage=10% (1/10), obtenido=${serializedWebReport.wcagCoverage}`);
    assert(serializedWebReport.nielsenCompliance === 50 && serializedWebReport.wcagCompliance === 100, '8f. P1-1 (WEB): nielsenCompliance (50%) y wcagCompliance (100%) intactos tras serialización Mongoose');
    assert(typeof serializedWebReport.overallScore === 'number', '8g. P1-1 (WEB): overallScore numérico presente para EvaluationSummary');
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
