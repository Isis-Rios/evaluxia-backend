import { auditEngine } from '@/modules/evaluations/services/audit-engine.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';

/**
 * Cierre del gap de cobertura identificado en la auditoría de integración
 * del resumen ejecutivo verificado (2026-11-14): confirma, usando el camino
 * REAL completo (`auditEngine.performAudit()` -> Evidence Gate -> J6
 * cardinalidad/claim-consistency -> `calculateMetrics` -> persistencia de
 * Finding -> `buildVerifiedResultsSection`/`composeVerifiedSummary` ->
 * `Report.summary`), que el resumen ejecutivo final:
 *
 *   1. Incluye el hallazgo FAIL determinístico (contraste, no generado por
 *      IA) bajo "RESULTADOS VERIFICADOS POR EVALUXIA".
 *   2. NUNCA presenta el NOT_EVALUABLE de IA como incumplimiento confirmado.
 *   3. Presenta el PASS de IA en su propia sección, no como incumplimiento.
 *   4. Conserva íntegra la narrativa original de Gemini -- deliberadamente
 *      contradictoria en este fixture (omite el FAIL real, describe el
 *      NOT_EVALUABLE como confirmado) -- bajo un encabezado explícito de
 *      "no autoritativo".
 *   5. Dejar explícita la regla de precedencia.
 *   6. El contenido verificado es exactamente `reportData.summary`
 *      (el mismo objeto que se entrega a `reportRepository.create`).
 *
 * Mismo arnés de mocks ya validado en
 * `audit-engine-not-evaluable-persistence.test.ts` (parchear el método en el
 * singleton real, restaurar al final) -- no hay MongoDB vivo en este
 * sandbox. El único dato no-mockeado es la llamada a Gemini, servida por
 * `stubGeminiJsonResponses` (cero red, cero costo). No se reutiliza el
 * helper `buildValidAuditOutputJson` porque hardcodea un `executiveSummary`
 * fijo -- este caso necesita una narrativa deliberadamente contradictoria,
 * así que se construye el mismo JSON a mano, con la misma forma exacta.
 */

const FAKE_EVALUATION_ID = 'fake-web-eval-verified-summary';
const FAKE_USER_ID = 'fake-web-user-verified-summary';

const LOW_CONTRAST_SELECTOR = 'a.low-contrast-link';
const LOW_CONTRAST_TEXT = 'Enlace de bajo contraste';
const BUTTON_SELECTOR = 'button.contact-submit';
const BUTTON_ARIA_LABEL = 'Enviar formulario';

function fakeEvaluationDoc() {
  return {
    userId: FAKE_USER_ID,
    evaluatorProfileId: 'fake-profile-id',
    title: 'Sitio de prueba (resumen verificado)',
    url: 'https://fixture.local/verified-summary',
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

// Mismos ratios/colores que el caso real de OpenCart ya auditado (1.37:1,
// rgb(255,255,255) sobre rgb(228,219,205)) -- deliberado, para que el FAIL
// determinístico de esta prueba sea reconocible como el mismo patrón real.
const fixtureEvidence = [
  {
    iteration: 1,
    url: 'https://fixture.local/verified-summary',
    screenshotPath: '/uploads/verified-summary_step_1.png',
    computedStyles: [
      {
        selector: LOW_CONTRAST_SELECTOR,
        tag: 'a',
        text: LOW_CONTRAST_TEXT,
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(228, 219, 205)',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: 'normal',
        fontFamily: 'sans-serif',
      },
    ],
    // Mismo patrón ya validado en audit-engine-not-evaluable-persistence.test.ts:
    // un botón con ariaLabel real e indexado, citado como evidencia del
    // hallazgo PASS de IA, para que supere la barrera de "Positive
    // Compliance" del Evidence Gate (un PASS de IA sin evidencia citable
    // real no persiste como PASS -- comportamiento correcto, no un defecto).
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

const sharedEvidenceCitation = {
  type: 'DOM_ATTRIBUTE' as const,
  selector: BUTTON_SELECTOR,
  attribute: 'ariaLabel',
  value: BUTTON_ARIA_LABEL,
};

// Hallazgos de IA: un NOT_EVALUABLE y un PASS -- ninguno declara
// `affectedElement` propio, igual que el fixture ya validado en
// `audit-engine-not-evaluable-persistence.test.ts`, para no depender de
// ningún selector inventado ni rozar las Gates 0/0b.
const aiNotEvaluableFinding = {
  findingGroup: 'accessibility',
  type: 'wcag',
  status: 'NOT_EVALUABLE',
  severity: 'high',
  confidence: 'medium',
  wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
  description: 'No fue posible confirmar con certeza la consistencia de las reseñas mostradas en la ficha de producto.',
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
  description: 'El catálogo mantiene un diseño limpio y sin ruido visual innecesario.',
  evidence: [sharedEvidenceCitation],
  recommendation: null,
};

// Narrativa deliberadamente contradictoria: omite el FAIL determinístico de
// contraste y describe el NOT_EVALUABLE como un incumplimiento confirmado --
// el mismo patrón real auditado en la evaluación OpenCart
// `6af7c107d95c2b6563ab8705`.
const CONTRADICTORY_AI_NARRATIVE =
  'La sesión demostró un nivel excepcional de conformidad. ' +
  'Incumplimiento confirmado: inconsistencia en las reseñas del producto (WCAG 2.4.6).';

function buildContradictoryGeminiResponse(): string {
  return JSON.stringify({
    overallScore: 85,
    executiveSummary: CONTRADICTORY_AI_NARRATIVE,
    findings: [aiNotEvaluableFinding, aiPassFinding],
  });
}

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
  console.log('🧪 Starting audit-engine integration — verified executive summary tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const deps = patchDependencies();
  const stub = stubGeminiJsonResponses([buildContradictoryGeminiResponse()]);

  try {
    await auditEngine.performAudit(FAKE_EVALUATION_ID, 'Sitio de prueba (resumen verificado)');

    const { createdFindings, getReportData } = deps;
    const reportData = getReportData();
    const summary: string = reportData?.summary ?? '';

    // Confirma primero que el flujo real sí produjo los 3 estados
    // esperados (precondición de la prueba, no el objetivo final).
    const persistedFail = createdFindings.find((f) => f.wcagCriterion?.includes('1.4.3'));
    const persistedNotEvaluable = createdFindings.find((f) => f.wcagCriterion === 'WCAG 2.4.6 Encabezados y etiquetas');
    const persistedPass = createdFindings.find((f) => f.heuristicCode === 'N-08');
    assert(!!persistedFail && persistedFail.status === 'FAIL', 'Precondición: el FAIL determinístico de contraste persiste con status FAIL');
    assert(!!persistedNotEvaluable && persistedNotEvaluable.status === 'NOT_EVALUABLE', 'Precondición: el NOT_EVALUABLE de IA persiste con status NOT_EVALUABLE');
    assert(!!persistedPass && persistedPass.status === 'PASS', 'Precondición: el PASS de IA persiste con status PASS');

    // -----------------------------------------------------------------
    // 1. El FAIL determinístico aparece en la sección verificada.
    // -----------------------------------------------------------------
    assert(summary.includes('RESULTADOS VERIFICADOS POR EVALUXIA'), '1a. El summary final contiene la sección verificada');
    assert(summary.includes('WCAG 1.4.3'), '1b. El criterio del FAIL determinístico (WCAG 1.4.3) aparece en el summary');
    assert(summary.includes(LOW_CONTRAST_TEXT) || summary.includes(LOW_CONTRAST_SELECTOR), '1c. El elemento afectado del FAIL determinístico aparece en el summary');

    // -----------------------------------------------------------------
    // 2. El NOT_EVALUABLE nunca aparece como incumplimiento confirmado --
    // debe estar en la sub-sección "Observaciones no evaluables" y NUNCA
    // dentro del bloque "Incumplimientos confirmados (FAIL)".
    // -----------------------------------------------------------------
    const failBlockStart = summary.indexOf('Incumplimientos confirmados (FAIL)');
    const notEvalBlockStart = summary.indexOf('Observaciones no evaluables');
    const passBlockStart = summary.indexOf('Cumplimientos confirmados (PASS)');
    assert(failBlockStart !== -1 && notEvalBlockStart !== -1 && passBlockStart !== -1, '2a. Las tres sub-secciones deterministas están presentes y en orden');
    const failBlockText = summary.slice(failBlockStart, notEvalBlockStart);
    assert(!failBlockText.includes('WCAG 2.4.6'), '2b. El NOT_EVALUABLE (WCAG 2.4.6) NUNCA aparece dentro del bloque de incumplimientos confirmados');
    const notEvalBlockText = summary.slice(notEvalBlockStart, passBlockStart);
    assert(notEvalBlockText.includes('WCAG 2.4.6'), '2c. El NOT_EVALUABLE SÍ aparece, correctamente, bajo "Observaciones no evaluables"');

    // -----------------------------------------------------------------
    // 3. El PASS aparece en su sección, no como incumplimiento.
    // -----------------------------------------------------------------
    assert(!failBlockText.includes('N-08') && !failBlockText.includes('Diseño estético'), '3a. El PASS (N-08) NUNCA aparece dentro del bloque de incumplimientos confirmados');
    const passBlockText = summary.slice(passBlockStart);
    assert(passBlockText.includes('N-08') || passBlockText.includes('Diseño estético') || /Cumplimientos confirmados \(PASS\) -- \d+ en total/.test(passBlockText), '3b. El PASS queda representado en la sección de cumplimientos confirmados');

    // -----------------------------------------------------------------
    // 4. La narrativa original de Gemini se conserva íntegra, bajo el
    // encabezado de "no autoritativo".
    // -----------------------------------------------------------------
    assert(summary.includes('ANÁLISIS NARRATIVO COMPLEMENTARIO (IA, NO AUTORITATIVO)'), '4a. El encabezado "no autoritativo" está presente');
    assert(summary.includes(CONTRADICTORY_AI_NARRATIVE), '4b. La narrativa original y contradictoria de Gemini se conserva íntegra, sin editarla ni eliminarla');

    // -----------------------------------------------------------------
    // 5. La declaración de precedencia es explícita.
    // -----------------------------------------------------------------
    assert(/prevalece esta última/.test(summary), '5. La declaración de precedencia ("prevalece esta última") está presente');

    // -----------------------------------------------------------------
    // 6. El contenido corresponde EXACTAMENTE a reportData.summary -- ya
    // verificado por construcción (todas las aserciones anteriores leen
    // directamente `reportData.summary`, el mismo objeto entregado a
    // `reportRepository.create`), se confirma aquí explícitamente el orden:
    // sección verificada ANTES que la narrativa de IA.
    assert(summary.indexOf('RESULTADOS VERIFICADOS POR EVALUXIA') < summary.indexOf('ANÁLISIS NARRATIVO COMPLEMENTARIO'), '6. La sección verificada precede a la narrativa de IA dentro de reportData.summary (el mismo string entregado al repositorio)');

    // Confirma que no hay contradicción posible para un lector: el resumen
    // narrativo SIGUE afirmando "nivel excepcional de conformidad" (texto
    // original conservado), pero la sección verificada, que aparece antes y
    // está marcada como autoritativa, ya contiene el FAIL real.
    assert(summary.includes('nivel excepcional de conformidad'), 'Control: el texto contradictorio original de Gemini sigue literalmente presente (no se censura, solo se subordina)');
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
