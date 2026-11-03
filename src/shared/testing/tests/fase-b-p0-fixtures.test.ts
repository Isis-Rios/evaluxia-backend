import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture, LoadedFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase B — P0 deterministic fixtures.
 *
 * For each fixture: real Playwright (via attachTestSession) -> real
 * extractCurrentSnapshot -> real DeterministicAnalyzer -> Ground Truth
 * oracle (filtered to `verifiableBy: 'deterministic'` criteria only — AI-
 * only criteria are reported as pending, never scored as pass/fail here) ->
 * a real Phase 2 prompt (buildDeduplicatedEvidenceContext +
 * sanitizeEvidenceForGemini + buildV2AuditPrompt) -> Payload Audit.
 *
 * No Gemini calls anywhere in this file.
 */

interface FixtureCase {
  path: string;
  purpose: string;
  fpRisk: string;
  fnRisk: string;
  budgetExpectation: string;
  /** For the automation-signal fixture: attempt a real Playwright action expected to fail. */
  triggerFailingAction?: { selector: string };
}

const CASES: FixtureCase[] = [
  {
    path: 'forms/login-good.html',
    purpose: 'Fixture control (0 defectos intencionales) — baseline anti-falso-positivo.',
    fpRisk: 'Que el pipeline invente un FAIL sobre una página correctamente implementada.',
    fnRisk: 'N/A (no hay defectos reales que omitir).',
    budgetExpectation: 'NORMAL — fixture mínimo, 1 snapshot, sin evidencia repetida.',
  },
  {
    path: 'forms/login-missing-label.html',
    purpose: 'Defecto intencional: inputs sin <label> asociado (WCAG 3.3.2).',
    fpRisk: 'Que se reporte FAIL en WCAG 4.1.2 sobre el botón (que sí está bien).',
    fnRisk: 'Que WCAG 3.3.2 quede indetectado — ESPERADO en Fase B (no hay regla determinística); riesgo real recae 100% en Gemini (Fase D).',
    budgetExpectation: 'NORMAL — idéntico en tamaño a login-good.html.',
  },
  {
    path: 'interactive/icon-button-no-name.html',
    purpose: 'Un botón solo-ícono sin nombre accesible (FAIL) junto a uno correcto (PASS) — confirma discriminación por elemento, no un veredicto global.',
    fpRisk: 'Que el botón CON aria-label también se marque FAIL (contaminación cruzada).',
    fnRisk: 'Que el botón SIN aria-label se marque PASS (omisión del defecto real).',
    budgetExpectation: 'NORMAL — 2 botones, evidencia mínima.',
  },
  {
    path: 'navigation/duplicate-link-text-diff-dest.html',
    purpose: '2 enlaces con el mismo texto ("Leer más") a destinos distintos — expone un gap real y documentado del DeterministicAnalyzer.',
    fpRisk: 'N/A a nivel determinístico (no hay regla que pueda generar un falso positivo aquí).',
    fnRisk: 'CONFIRMADO Y ESPERADO: DeterministicAnalyzer da PASS a ambos enlaces individualmente — la ambigüedad de destino solo es detectable por Gemini o por una regla nueva (Fase 2.2.2+).',
    budgetExpectation: 'NORMAL — 2 enlaces, evidencia mínima.',
  },
  {
    path: 'structure/missing-h1.html',
    purpose: 'Página sin <h1> — único caso en que analyzeHeadings emite un finding (siempre FAIL, nunca PASS).',
    fpRisk: 'Que se reporte FAIL de encabezados en una página que SÍ tiene h1 (no aplica aquí, pero es el control mental).',
    fnRisk: 'Que la ausencia de h1 no se detecte.',
    budgetExpectation: 'NORMAL — fixture mínimo.',
  },
  {
    path: 'visual/contrast-and-images.html',
    purpose: 'Combina WCAG 1.4.3 (contraste real calculado) y las 3 variantes de WCAG 1.1.1 (decorativa / informativa-con-alt / informativa-sin-alt) en un solo fixture.',
    fpRisk: 'Que la imagen decorativa o la informativa-con-alt se marquen FAIL por error.',
    fnRisk: 'Que la imagen informativa sin alt NO se marque FAIL, o que el contraste insuficiente no se detecte.',
    budgetExpectation: 'NORMAL — 3 imágenes, 1 párrafo, evidencia mínima.',
  },
  {
    path: 'automation-signal/click-timeout-does-not-leak.html',
    purpose: 'GT-05: un botón oculto (display:none) sobre el que se fuerza un intento de click real que debe fallar — confirma que el fallo de automatización NO contamina la evaluación determinística de NINGÚN botón (ni el que falló, ni el otro).',
    fpRisk: 'Que el fallo de `executeAction` genere o influya en algún finding WCAG/Nielsen (violaría "Automation-Signal ≠ Evidencia").',
    fnRisk: 'N/A a nivel determinístico — el riesgo real (Gemini interpretando el blockingError como WCAG 2.1.1/N-01 sin corroboración) es exclusivo de Fase D.',
    budgetExpectation: 'NORMAL — 2 botones, evidencia mínima.',
    triggerFailingAction: { selector: '[aria-label="Alternar menú"]' },
  },
];

async function runFixtureCase(testCase: FixtureCase, evalIdSeed: number): Promise<{ name: string; passed: boolean }> {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`FIXTURE: ${testCase.path}`);
  console.log(`Propósito: ${testCase.purpose}`);
  console.log(`Riesgo FP: ${testCase.fpRisk}`);
  console.log(`Riesgo FN: ${testCase.fnRisk}`);
  console.log(`Presupuesto esperado: ${testCase.budgetExpectation}`);
  console.log('='.repeat(78));

  let localPassed = 0;
  let localFailed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      localPassed++;
    } else {
      console.error(`  ❌ FAILED: ${msg}`);
      localFailed++;
    }
  }

  const fixture: LoadedFixture = loadFixture(testCase.path);
  const evalId = `fase-b-${evalIdSeed}`;

  await automationService.attachTestSession(evalId, fixture.html);

  if (testCase.triggerFailingAction) {
    const actionResult = await automationService.executeAction(evalId, {
      actionType: 'CLICK',
      selector: testCase.triggerFailingAction.selector,
    });
    assert(actionResult.success === false, `executeAction sobre el elemento oculto falla correctamente (success=false), NO lanza excepción: error="${actionResult.error}"`);
  }

  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    {
      iteration: 1,
      url: `https://fixture.local/${testCase.path}`,
      screenshotPath: '/uploads/fixture.png',
      headings: snapshot.headings,
      images: snapshot.images,
      links: snapshot.links,
      buttons: snapshot.buttons,
      forms: snapshot.forms,
      landmarks: snapshot.landmarks,
      computedStyles: snapshot.computedStyles,
    } as any,
  ]);

  // Oracle: only `verifiableBy: 'deterministic'` criteria are scored in
  // Fase B. AI-only criteria are reported as pending, never as pass/fail.
  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const aiPendingCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy !== 'deterministic');
  const gtForFaseB: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseB, detFindings as any);

  console.log(`  ℹ️  Findings determinísticos: ${detFindings.length}`);
  console.log(`  ℹ️  Criterios evaluados en Fase B (deterministic): ${deterministicCriteria.length}`);
  console.log(`  ℹ️  Criterios pendientes de Gemini (Fase D, no evaluados ahora): ${aiPendingCriteria.map((c) => c.code).join(', ') || 'ninguno'}`);

  assert(report.overallPassed, `Oráculo (solo criterios deterministic): overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
  assert(report.mustNotAppearViolations.length === 0, `Sin violaciones de mustNotAppear (${JSON.stringify(report.mustNotAppearViolations)})`);
  assert(report.duplicateViolations.length === 0, `Sin findings duplicados por (criterio, selector)`);

  // Real Phase 2 prompt + Payload Audit — every fixture gets measured, not just "stress" ones.
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    {
      iteration: 1, url: `https://fixture.local/${testCase.path}`, screenshotPath: '/uploads/fixture.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const promptInput: any = {
    evaluationId: evalId, title: testCase.path, url: `https://fixture.local/${testCase.path}`,
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: ['Navegar a la URL objetivo'], previousActions: [],
    snapshotsCount: 1, evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons,
    accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary: sanitized });

  console.log(`  ℹ️  Payload Audit: chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  assert(isAcceptableForFixtureKind(measurement, 'functional'), `Presupuesto aceptable para fixture funcional (level=${measurement.level}, nunca CRITICAL)`);

  const name = testCase.path;
  const passed = localFailed === 0;
  console.log(`  --- ${passed ? '✅ FIXTURE OK' : '❌ FIXTURE CON FALLOS'} (${localPassed} passed, ${localFailed} failed) ---`);
  return { name, passed };
}

async function main() {
  console.log('🧪 Starting Fase B — P0 Deterministic Fixtures...');

  const results: Array<{ name: string; passed: boolean }> = [];
  let seed = 1;
  for (const testCase of CASES) {
    try {
      const result = await runFixtureCase(testCase, seed++);
      results.push(result);
    } catch (e) {
      console.error(`❌ CRASHED on ${testCase.path}:`, e);
      results.push({ name: testCase.path, passed: false });
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('RESUMEN FASE B');
  console.log('='.repeat(78));
  results.forEach((r) => console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`));
  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`\n${totalPassed}/${results.length} fixtures OK.\n`);

  if (totalPassed !== results.length) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Fase B suite crashed:', e);
  process.exit(1);
});
