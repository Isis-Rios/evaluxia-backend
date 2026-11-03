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
 * Fase E — E1: Modal trigger. Distingue 3 estados reales:
 *   1. trigger        -> SIEMPRE presente + visible (línea base)
 *   2. backdrop (<p>)  -> presente en el DOM desde el inicio, NO visible
 *                         (display:none) -> visible tras el click
 *   3. contenido diálogo (h2+botón) -> AUSENTE del DOM -> presente+visible
 *
 * "Visible" vs "presente-no-visible" se verifica SIN ningún cambio de
 * producción: se reutiliza `executeAction` (ya existente) como sonda —
 * Playwright falla con timeout de actionability sobre un elemento
 * `display:none` (mismo mecanismo ya usado en Fase B/D para el botón
 * oculto), y tiene éxito cuando el elemento es realmente interactuable.
 */
async function main() {
  console.log('🧪 Starting E1 — Modal Trigger (Fase E)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('components/modal-trigger.html');
  const evalId = 'e1-modal-trigger';
  await automationService.attachTestSession(evalId, fixture.html);

  // --- ANTES del click ---
  const before = await automationService.extractCurrentSnapshot(evalId);
  assert(before.buttons.length === 1, `ANTES: solo el botón trigger está presente (obtenido: ${before.buttons.length})`);
  assert(before.headings.length === 1, `ANTES: solo el <h1> de la página está presente (obtenido: ${before.headings.length}) — el <h2> del diálogo AÚN NO EXISTE en el DOM`);
  const backdropInStylesBefore = before.computedStyles.some((s) => s.tag === 'p');
  assert(backdropInStylesBefore, 'ANTES: el <p id="backdrop"> SÍ se captura en computedStyles (presente en el DOM) pese a estar display:none — presencia ≠ visibilidad');

  // Sonda de visibilidad real ANTES (sin cambios de producción: reutiliza executeAction).
  const hoverBefore = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: '#backdrop' });
  assert(!hoverBefore.success, 'ANTES: el hover real sobre el backdrop FALLA (display:none) — confirma "presente pero NO visible", no solo "presente"');
  const automationSignalBefore = classifyActionFailure(hoverBefore);
  assert(automationSignalBefore !== null && !canJustifyFail([automationSignalBefore]), 'Este fallo de hover se clasifica como automationSignal y, por sí solo, NO justificaría ningún finding WCAG/Nielsen');

  // --- CLICK real sobre el trigger (visible, debe tener éxito) ---
  const clickResult = await automationService.executeAction(evalId, { actionType: 'CLICK', selector: '[aria-label="Abrir modal"]' });
  assert(clickResult.success, 'El click real sobre el trigger (visible) tiene éxito — no se confunde con un fallo de automatización');

  // --- DESPUÉS del click ---
  const after = await automationService.extractCurrentSnapshot(evalId);
  assert(after.buttons.length === 2, `DESPUÉS: el botón "Cerrar modal" pasó de AUSENTE a PRESENTE (obtenido: ${after.buttons.length} botones, esperado 2)`);
  assert(after.headings.length === 2, `DESPUÉS: el <h2> "Confirmar acción" pasó de AUSENTE a PRESENTE (obtenido: ${after.headings.length} headings, esperado 2)`);

  const hoverAfter = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: '#backdrop' });
  assert(hoverAfter.success, 'DESPUÉS: el mismo hover sobre el backdrop AHORA tiene éxito — pasó de "presente-no-visible" a "visible", confirmado por interacción real, no solo inferido');

  // --- Confirmar que ningún efecto de CLICK/HOVER se filtra como evidencia de accesibilidad ---
  const detFindingsAfter = deterministicAnalyzer.analyzeSnapshots([
    {
      iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png',
      headings: after.headings, images: after.images, links: after.links, buttons: after.buttons,
      forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles,
    } as any,
  ]);
  assert(
    detFindingsAfter.every((f) => !(f.description || '').toLowerCase().match(/hover|click|timeout|automatiza/)),
    'Ningún finding determinístico menciona el click/hover ni fallos de automatización — la interacción real permanece separada de la evidencia de accesibilidad',
  );

  // --- Ground Truth / oracle (deterministic-only) ---
  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseE: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseE, detFindingsAfter as any);
  assert(report.overallPassed, `Oráculo (deterministic-only): overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
  console.log(`  ℹ️  Criterio MODAL-FOCUS-TRAP queda marcado verifiableBy='ai' — no evaluado en esta fase (gap de CAPTURA, no solo de análisis: document.activeElement no existe en ningún campo hoy).`);

  await automationService.closeSession(evalId);

  // --- Payload Audit ---
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'E1', url: 'https://fixture.local',
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
