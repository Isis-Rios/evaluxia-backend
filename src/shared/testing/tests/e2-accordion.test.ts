import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase E — E2: Accordion. Confirma (con datos reales, no suposición) si el
 * cambio de `aria-expanded` (false -> true) se refleja en algún campo de la
 * evidencia capturada. Distingue el panel revelado: presente-no-visible
 * (display:none) -> visible, verificado vía executeAction (sin cambios de
 * producción).
 */
async function main() {
  console.log('🧪 Starting E2 — Accordion (Fase E)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('components/accordion.html');
  const evalId = 'e2-accordion';
  await automationService.attachTestSession(evalId, fixture.html);

  const before = await automationService.extractCurrentSnapshot(evalId);
  assert(before.buttons.length === 1, 'ANTES: el botón del acordeón está presente');
  assert(before.computedStyles.some((s) => s.tag === 'p'), 'ANTES: el panel <p> está presente en computedStyles pese a estar display:none');

  const hoverBefore = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: '#panel' });
  assert(!hoverBefore.success, 'ANTES: hover real sobre el panel FALLA (display:none) — confirma presente-no-visible');

  // GAP CONFIRMADO CON DATOS REALES: ningún campo de ButtonEvidence expone
  // aria-expanded, ni antes (false) ni después (true) del cambio de estado.
  const buttonFieldsBefore = JSON.stringify(before.buttons[0]);
  assert(!buttonFieldsBefore.includes('expanded'), `GAP DE CAPTURA CONFIRMADO: ningún campo del botón capturado contiene "expanded" -> aria-expanded="false" no se refleja en la evidencia. Campos reales capturados: ${buttonFieldsBefore}`);

  const clickResult = await automationService.executeAction(evalId, { actionType: 'CLICK', selector: '[aria-label="Ver más detalles"]' });
  assert(clickResult.success, 'El click real sobre el trigger tiene éxito');

  const after = await automationService.extractCurrentSnapshot(evalId);
  const hoverAfter = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: '#panel' });
  assert(hoverAfter.success, 'DESPUÉS: hover real sobre el panel AHORA tiene éxito — pasó a visible');

  const buttonFieldsAfter = JSON.stringify(after.buttons[0]);
  assert(!buttonFieldsAfter.includes('expanded'), `GAP PERSISTE TRAS LA INTERACCIÓN: tampoco aria-expanded="true" (el nuevo estado) llega a la evidencia. Campos reales: ${buttonFieldsAfter}`);
  assert(buttonFieldsBefore === buttonFieldsAfter, 'La representación capturada del botón es IDÉNTICA antes y después del cambio de aria-expanded — el pipeline es ciego a este cambio de estado real');

  await automationService.closeSession(evalId);

  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles } as any,
  ]);
  assert(detFindings.every((f) => !(f.description || '').toLowerCase().match(/hover|click|expand/)), 'Ningún finding determinístico menciona el click/hover ni "expand" — sin contaminación');

  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseE: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseE, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'E2', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { evidencesSummary: sanitized });
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
