import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';
import { classifyActionFailure, canJustifyFail } from '@/shared/testing/automation-signal-taxonomy';

/**
 * Fase E — E4: Dropdown revelado por :hover REAL de CSS (`.dropdown:hover
 * .submenu`), a diferencia de E1/E2 que usaban JS onclick. Confirma que un
 * `executeAction(HOVER)` real sobre el trigger efectivamente activa el
 * pseudo-estado :hover del navegador (no solo un evento JS simulado), y que
 * el submenú pasa de presente-no-visible a visible en consecuencia.
 */
async function main() {
  console.log('🧪 Starting E4 — Dropdown Hover Reveal (Fase E)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('components/dropdown-hover-reveal.html');
  const evalId = 'e4-dropdown-hover';
  await automationService.attachTestSession(evalId, fixture.html);

  const before = await automationService.extractCurrentSnapshot(evalId);
  assert(before.links.length === 3, `Se capturan los 3 enlaces (trigger + 2 del submenú) pese a que el submenú está oculto por CSS (obtenido: ${before.links.length})`);

  const hoverSub1Before = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/productos/software"]' });
  assert(!hoverSub1Before.success, 'ANTES de activar el hover del trigger: el enlace del submenú NO es interactuable (oculto por CSS :hover no activo)');
  const automationSignal = classifyActionFailure(hoverSub1Before);
  assert(automationSignal !== null && !canJustifyFail([automationSignal]), 'Este fallo de hover se clasifica como automationSignal y no justifica, por sí solo, ningún finding de accesibilidad');

  // Activar el :hover REAL sobre el trigger (mueve el cursor virtual de
  // Playwright, dispara el pseudo-estado CSS, no un evento JS simulado).
  const hoverTrigger = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: '[aria-label="Productos"]' });
  assert(hoverTrigger.success, 'El hover real sobre el trigger tiene éxito (elemento visible)');

  // Con el cursor aún sobre el trigger, el submenú debe estar revelado.
  const hoverSub1After = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/productos/software"]' });
  const hoverSub2After = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/productos/hardware"]' });
  assert(hoverSub1After.success, 'DESPUÉS de activar el hover del trigger: el primer enlace del submenú SÍ es interactuable — el :hover real de CSS reveló el submenú');
  assert(hoverSub2After.success, 'DESPUÉS: el segundo enlace del submenú también es interactuable');

  const after = await automationService.extractCurrentSnapshot(evalId);
  assert(after.links.length === 3, 'El conteo de enlaces capturados no cambia (3) — el DOM no se modificó, solo su visibilidad vía CSS');

  await automationService.closeSession(evalId);

  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles } as any,
  ]);
  assert(detFindings.every((f) => !(f.description || '').toLowerCase().match(/hover|timeout|automatiz/)), 'Ningún finding determinístico menciona el evento de hover/automatización');

  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseE: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseE, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'E4', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { evidencesSummary: sanitized, dedupedLinks });
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
