import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase E — E3: Tabs con contenido inactivo. Ambos paneles (h2 + enlace)
 * están SIEMPRE presentes en el DOM; solo 1 es display:block a la vez.
 * Confirma que el contenido "inactivo" se captura completo (mismo peso en
 * la evidencia que el activo) y que solo la sonda de interacción real
 * (executeAction) distingue cuál está genuinamente visible en cada momento
 * — la evidencia capturada por sí sola NO distingue "pestaña activa".
 */
async function main() {
  console.log('🧪 Starting E3 — Tabs Inactive Content (Fase E)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('components/tabs-inactive-content.html');
  const evalId = 'e3-tabs';
  await automationService.attachTestSession(evalId, fixture.html);

  // --- Estado inicial: panel1 activo, panel2 inactivo ---
  const before = await automationService.extractCurrentSnapshot(evalId);
  assert(before.headings.length === 3, `Se capturan los 3 headings (h1 + AMBOS h2, activo e inactivo) — obtenido: ${before.headings.length}`);
  assert(before.links.length === 2, `Se capturan AMBOS enlaces (el de la pestaña activa Y el de la inactiva) — obtenido: ${before.links.length}`);

  const hoverPanel1Before = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/docs/instalacion"]' });
  const hoverPanel2Before = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/docs/configuracion"]' });
  assert(hoverPanel1Before.success, 'Estado inicial: el enlace de la pestaña ACTIVA (panel1) es realmente interactuable (hover exitoso)');
  assert(!hoverPanel2Before.success, 'Estado inicial: el enlace de la pestaña INACTIVA (panel2) NO es interactuable (hover falla, display:none) — la evidencia por sí sola no distinguía esto, solo la sonda real');

  // --- Cambiar de pestaña ---
  const clickTab2 = await automationService.executeAction(evalId, { actionType: 'CLICK', selector: '[aria-label="Pestaña Configuración"]' });
  assert(clickTab2.success, 'El click real para cambiar de pestaña tiene éxito');

  const after = await automationService.extractCurrentSnapshot(evalId);
  assert(after.headings.length === 3 && after.links.length === 2, 'Tras el cambio de pestaña, los CONTEOS de headings/links NO cambian (3 y 2) — la evidencia capturada es idéntica en volumen, cambia solo cuál está visible');

  const hoverPanel1After = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/docs/instalacion"]' });
  const hoverPanel2After = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: 'a[href="/docs/configuracion"]' });
  assert(!hoverPanel1After.success, 'DESPUÉS del cambio: el enlace de panel1 (ahora inactivo) deja de ser interactuable');
  assert(hoverPanel2After.success, 'DESPUÉS del cambio: el enlace de panel2 (ahora activo) SÍ es interactuable — la reversión se refleja correctamente vía interacción real');

  await automationService.closeSession(evalId);

  // --- Sin contaminación de accessibility findings por el cambio de pestaña ---
  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles } as any,
  ]);
  // Nota: no se busca la palabra "pestaña" en las descripciones — los
  // propios aria-label reales de los botones LEGÍTIMAMENTE dicen "Pestaña
  // Instalación"/"Pestaña Configuración", así que esa palabra aparecería
  // de forma correcta y esperada. Lo que se busca es contaminación por el
  // EVENTO de interacción/automatización en sí (hover, click, timeout).
  assert(detFindings.every((f) => !(f.description || '').toLowerCase().match(/hover|timeout|automatiz/)), 'Ningún finding determinístico menciona el evento de hover/click/automatización — solo hechos del DOM (los aria-label mencionan "Pestaña ..." legítimamente, como parte real del nombre accesible del botón, no como contaminación)');

  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseE: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseE, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);

  // --- Payload Audit: cuánto "cuesta" el contenido de la pestaña que
  // nunca se ve al mismo tiempo que la otra. ---
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: after.headings, images: after.images, links: after.links, buttons: after.buttons, forms: after.forms, landmarks: after.landmarks, computedStyles: after.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'E3', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { evidencesSummary: sanitized, dedupedLinks });
  console.log(`  ℹ️  Payload Audit: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  console.log('  ℹ️  Nota: el contenido de la pestaña inactiva (nunca visible simultáneamente con la activa) viaja íntegro en el payload — no es un defecto nuevo, es la misma característica de captura "presencia en DOM, independiente de display" ya confirmada en Fase B/D para otros elementos, ahora cuantificada para el caso de tabs.');
  assert(isAcceptableForFixtureKind(measurement, 'functional'), `Presupuesto aceptable (level=${measurement.level})`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
