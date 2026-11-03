import { automationService } from '@/modules/automation/automation.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { measurePayload } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase C — T4: Large text (real Playwright capture, real DOM).
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: el texto completo de heading/link/
 * button es potencialmente relevante para Gemini (p.ej. para juzgar N-08
 * "diseño estético y minimalista" o la calidad de redacción UX) — no se
 * propone truncarlo en esta fase, solo MEDIR si hoy se captura sin límite.
 *
 * Este test no valida "compresión segura" — al contrario, documenta un
 * GAP REAL (sin solución implementada) para que la decisión de si conviene
 * truncar se tome con datos, no por intuición.
 */
async function main() {
  console.log('🧪 Starting T4 — Large Text (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('stress/large-heading-and-link-text.html');
  const evalId = 't4-large-text';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const headingText = snapshot.headings[0]?.text ?? '';
  const linkText = snapshot.links[0]?.text ?? '';
  const buttonText = snapshot.buttons[0]?.text ?? '';

  console.log(`  ℹ️  heading.text.length=${headingText.length} link.text.length=${linkText.length} button.text.length=${buttonText.length}`);

  // GAP REAL confirmado: ninguno de los 3 se trunca (el HTML fuente tiene
  // > 100 chars en cada uno; si hubiera un .slice(0,100)/.slice(0,80) como
  // el que SÍ existe en visibleDOMSummary/computedStyles, veríamos el
  // length exacto en ese tope).
  assert(headingText.length > 300, `GAP CONFIRMADO: headings[].text NO se trunca — longitud real capturada: ${headingText.length} chars (el HTML fuente supera los 400 chars)`);
  assert(linkText.length > 250, `GAP CONFIRMADO: links[].text NO se trunca — longitud real capturada: ${linkText.length} chars`);
  assert(buttonText.length > 200, `GAP CONFIRMADO: buttons[].text NO se trunca — longitud real capturada: ${buttonText.length} chars`);

  // Contraste: visibleDOMSummary (Phase 1) SÍ trunca a 100 — confirma que
  // el gap es específico de headings/links/buttons de Phase 2, no general.
  const linkInSummary = snapshot.visibleDOMSummary?.find((el) => el.type === 'link');
  if (linkInSummary) {
    assert((linkInSummary.text?.length ?? 0) <= 100, `Contraste: visibleDOMSummary SÍ trunca a 100 chars (obtenido: ${linkInSummary.text?.length}) — confirma que el gap es específico de headings/links/buttons en la evidencia de Phase 2, no un problema general de captura`);
  }

  // Impacto real en el payload de Phase 2 con esta única página (sin
  // repetición ni volumen — el "costo" aquí es puramente el texto largo).
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    {
      iteration: 1, url: 'https://fixture.local/large-text', screenshotPath: '/x.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'T4', url: 'https://fixture.local/large-text',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { evidencesSummary: sanitized, dedupedLinks });

  console.log(`  ℹ️  Payload: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  // Con 1 sola página (sin repetición), incluso texto largo sin truncar
  // se mantiene NORMAL — el riesgo real de este gap es MULTIPLICATIVO
  // (muchos elementos con texto largo, o el mismo texto largo repetido sin
  // deduplicar entre iteraciones), no catastrófico en un caso aislado.
  assert(measurement.level === 'NORMAL', `Con 1 sola instancia de texto largo, el payload total sigue siendo NORMAL (level=${measurement.level}) — el gap es real pero su impacto es multiplicativo, no catastrófico por sí solo`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
