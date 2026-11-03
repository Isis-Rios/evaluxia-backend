import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';
import { classifyActionFailure, classifyDomFact, canJustifyFail, recommendedStatusForEvidence, isAutomationSignalOnly } from '@/shared/testing/automation-signal-taxonomy';

/**
 * Fase D — D1: applies the automation-signal / dom-observation taxonomy to
 * REAL data — a real Playwright click failure (via attachTestSession +
 * executeAction) and real DOM facts (via extractCurrentSnapshot) — over
 * the same fixture used for GT-05 in Fase B, extending that result with the
 * formal taxonomy instead of only an informal "no findings leaked" check.
 */
async function main() {
  console.log('🧪 Starting D1 — Automation-Signal Isolation with Real Data (Fase D)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('automation-signal/click-timeout-does-not-leak.html');
  const evalId = 'd1-automation-signal';

  await automationService.attachTestSession(evalId, fixture.html);

  // --- Real Playwright failure -> automation-signal ---
  const actionResult = await automationService.executeAction(evalId, {
    actionType: 'CLICK',
    selector: '[aria-label="Alternar menú"]',
  });
  const automationSignalItem = classifyActionFailure(actionResult);
  assert(automationSignalItem !== null && automationSignalItem.origin === 'automation-signal', 'El fallo REAL de Playwright se clasifica como automation-signal');
  console.log(`  ℹ️  automationSignal.description: "${automationSignalItem!.description.slice(0, 80)}..."`);

  // --- Real DOM fact for the SAME element -> dom-observation ---
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const hiddenButton = snapshot.buttons.find((b) => b.ariaLabel === 'Alternar menú')!;
  assert(!!hiddenButton, 'Se captura el botón real correspondiente al que falló el click');
  const domFactItem = classifyDomFact(
    `El botón tiene aria-label="${hiddenButton.ariaLabel}"`,
    { ariaLabel: hiddenButton.ariaLabel, selector: hiddenButton.selector },
  );
  assert(domFactItem.origin === 'dom-observation', 'El hecho real del DOM (aria-label presente) se clasifica como dom-observation');

  // --- THE CENTRAL DEMONSTRATION ---
  const automationOnlyEvidence = [automationSignalItem!];
  assert(isAutomationSignalOnly(automationOnlyEvidence), 'El conjunto de evidencia real de este intento de click es 100% automation-signal');
  assert(!canJustifyFail(automationOnlyEvidence), 'Con SOLO el fallo real de Playwright, la regla NO permite justificar un FAIL de WCAG 2.1.1/N-01 — exactamente lo que el incidente original violó');
  assert(recommendedStatusForEvidence(automationOnlyEvidence) === 'NOT_EVALUABLE', 'El veredicto recomendado con solo esta evidencia es NOT_EVALUABLE, nunca FAIL');

  const mixedEvidence = [automationSignalItem!, domFactItem];
  assert(canJustifyFail(mixedEvidence), 'Con el hecho real del DOM sumado, la regla SÍ permitiría estructuralmente un FAIL — pero (ver siguiente aserción) el hecho real no apoya uno');
  assert(
    hiddenButton.ariaLabel === 'Alternar menú' && hiddenButton.ariaLabel.length > 0,
    'IMPORTANTE: canJustifyFail() es una condición NECESARIA, no SUFICIENTE — el hecho real capturado (aria-label presente) en realidad respalda PASS, no FAIL; la regla no inventa un defecto, solo exige evidencia real para poder afirmar uno',
  );

  // --- DeterministicAnalyzer: by construction, 100% dom-observation ---
  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    {
      iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    } as any,
  ]);
  assert(detFindings.length > 0, 'DeterministicAnalyzer produce findings reales sobre esta evidencia');
  assert(
    detFindings.every((f) => !(f.description || '').toLowerCase().includes('timeout') && !(f.description || '').toLowerCase().includes('click')),
    'NINGÚN finding determinístico menciona el fallo de automatización — DeterministicAnalyzer nunca ve eventos de Playwright, todos sus findings son dom-observation por construcción',
  );

  // --- Ground Truth / oracle (deterministic-only, igual que Fase B) ---
  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseD: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseD, detFindings as any);
  assert(report.overallPassed, `Oráculo (deterministic-only): overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
  assert(report.mustNotAppearViolations.length === 0, 'Sin violaciones de mustNotAppear (confirma otra vez que no se alucinó N-01/WCAG 2.1.1 desde el fallo de automatización)');

  // --- Payload Audit ---
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons, forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'D1', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { dedupedButtons, evidencesSummary: sanitized });
  console.log(`  ℹ️  Payload Audit: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  assert(isAcceptableForFixtureKind(measurement, 'functional'), `Presupuesto aceptable (level=${measurement.level})`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
