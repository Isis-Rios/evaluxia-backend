import { automationService } from '@/modules/automation/automation.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase D — D3: selector cost AS A SHARE OF THE FULL REAL PAYLOAD (not just
 * raw string-length comparison like T7) — uses the same deeply-nested,
 * worst-case fixture from T7, now embedded in a real Phase 2 prompt, to
 * answer: "even in the worst case for selector length, what % of the total
 * payload do selectors actually represent?"
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: unicidad de los 8 selectores (no se
 * sacrifica aquí tampoco — este test solo mide costo relativo).
 */
async function main() {
  console.log('🧪 Starting D3 — Selector Cost In Context (Fase D)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('stress/deeply-nested-noisy-dom.html');
  const evalId = 'd3-selector-cost-in-context';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  assert(new Set(snapshot.links.map((l) => l.selector)).size === 8, 'Unicidad preservada: los 8 selectores del DOM profundamente anidado siguen siendo distintos entre sí en este escenario');

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons, forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'D3', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { dedupedLinks, evidencesSummary: sanitized });

  // Isolate JUST the `selector` field's contribution within dedupedLinks —
  // i.e. `"selector": "<value>"` for each of the 8 entries, as opposed to
  // href/text/ariaLabel/role/isExternal/iterations, which carry the actual
  // evaluative content.
  const selectorOnlyChars = dedupedLinks.reduce((sum: number, l: any) => sum + JSON.stringify(l.selector).length, 0);
  const dedupedLinksChars = JSON.stringify(dedupedLinks).length;
  const selectorShareOfLinks = (selectorOnlyChars / dedupedLinksChars) * 100;
  const selectorShareOfTotal = (selectorOnlyChars / prompt.length) * 100;

  console.log(`  ℹ️  Payload total: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log(`  ℹ️  Composición: ${breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', ')}`);
  console.log(`  ℹ️  Solo los VALORES de "selector" en dedupedLinks: ${selectorOnlyChars} chars de ${dedupedLinksChars} chars de esa categoría (${selectorShareOfLinks.toFixed(1)}%)`);
  console.log(`  ℹ️  Esos mismos ${selectorOnlyChars} chars representan el ${selectorShareOfTotal.toFixed(2)}% del payload TOTAL (${measurement.chars} chars)`);

  assert(selectorShareOfTotal < 10, `En el peor caso de anidamiento (T7), los selectores representan menos del 10% del payload TOTAL (obtenido: ${selectorShareOfTotal.toFixed(2)}%) — el costo de la unicidad verificada es marginal en contexto real, no el factor dominante`);
  assert(isAcceptableForFixtureKind(measurement, 'functional'), `Presupuesto aceptable incluso en este escenario de anidamiento profundo (level=${measurement.level})`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
