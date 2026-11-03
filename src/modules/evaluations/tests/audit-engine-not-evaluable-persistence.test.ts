import { auditEngine } from '@/modules/evaluations/services/audit-engine.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * P1.5.2 (Opción B autorizada) — confirma, usando el camino REAL completo
 * (`auditEngine.performAudit()` -> `aiService.performAuditAnalysis()` ->
 * `GeminiClient` interceptado, ninguno de los pasos intermedios mockeado:
 * EvidenceGate/J1, cardinalidad J6, consolidación), que:
 *
 *   1. Un hallazgo FAIL sigue persistiendo (comportamiento intacto).
 *   2. Un hallazgo NOT_EVALUABLE (generado explícitamente por Gemini, no
 *      sintetizado) AHORA persiste -- antes de P1.5.2 se perdía en silencio.
 *   3. Un hallazgo PASS NUNCA persiste (sin cambios respecto a antes).
 *   4. El documento `Finding` persistido para NOT_EVALUABLE conserva status,
 *      descripción, evidencia y criterio originales intactos.
 *   5. Las métricas del Report (failCount/passCount/notEvaluableCount/
 *      totalFindings/evidenceCount) son EXACTAMENTE las esperadas según
 *      `calculateMetrics` -- ese cálculo ocurre ANTES del loop de
 *      persistencia modificado, así que estos números no pueden haber
 *      cambiado por este fix (verificado aquí, no solo asumido).
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

    assert(!!persistedFail && persistedFail.status === 'FAIL', '1. El hallazgo FAIL (N-03) persiste con status FAIL (comportamiento intacto)');
    assert(!!persistedNotEvaluable && persistedNotEvaluable.status === 'NOT_EVALUABLE', '2. El hallazgo NOT_EVALUABLE (WCAG 1.3.1) AHORA persiste con status NOT_EVALUABLE');
    assert(!persistedPass, '3. El hallazgo PASS (N-08) NUNCA persiste (sin cambios respecto a antes de P1.5.2)');

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
