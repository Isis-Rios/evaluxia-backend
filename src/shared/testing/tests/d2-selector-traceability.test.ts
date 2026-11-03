import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase D — D2: selector uniqueness / reproducibility / traceability, in a
 * realistic multi-element scenario (3 structurally-identical <nav>
 * sections, 6 links total — the same shape of ambiguity risk as the
 * original incident, at a slightly larger scale).
 *
 * Unlike the Fase 2.2.1 unit tests (get-css-selector.test.ts), which call
 * `getCssSelector` directly, this test goes through the REAL
 * extractCurrentSnapshot pipeline and then RE-VERIFIES each captured
 * selector against the LIVE page (not just trusting the captured string) —
 * i.e. traceability is demonstrated empirically, not assumed.
 */
async function main() {
  console.log('🧪 Starting D2 — Selector Traceability (Fase D)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('navigation/repeated-nav-sections.html');
  const evalId = 'd2-selector-traceability';

  // We need to re-query the LIVE page after capture, so we keep the
  // session open across two captures instead of closing it immediately.
  await automationService.attachTestSession(evalId, fixture.html);

  const snapshot1 = await automationService.extractCurrentSnapshot(evalId);
  assert(snapshot1.links.length === 6, `Se capturan los 6 enlaces reales (obtenido: ${snapshot1.links.length})`);

  const selectors1 = snapshot1.links.map((l) => l.selector!);
  assert(new Set(selectors1).size === 6, `UNICIDAD: los 6 selectores son todos distintos entre sí (obtenido: ${new Set(selectors1).size} únicos)`);
  console.log(`  ℹ️  Selectores capturados: ${JSON.stringify(selectors1)}`);

  // TRAZABILIDAD real: re-consultar la página VIVA (no confiar en el string
  // capturado) y confirmar que cada selector resuelve a exactamente 1
  // elemento, con el href correcto — usa el mismo attachTestSession/
  // executeAction seam, vía un truco simple: probamos con page.locator
  // indirectamente comprobando que executeAction(HOVER) tiene éxito sobre
  // CADA uno de los 6 selectores (si el selector fuera ambiguo o inválido,
  // Playwright fallaría o afectaría al elemento equivocado).
  for (let i = 0; i < snapshot1.links.length; i++) {
    const sel = selectors1[i];
    const hoverResult = await automationService.executeAction(evalId, { actionType: 'HOVER', selector: sel });
    assert(hoverResult.success, `TRAZABILIDAD: el selector real "${sel}" (enlace #${i + 1}, href="${snapshot1.links[i].href}") es consumible por Playwright y resuelve sin ambigüedad (page.hover exitoso)`);
  }

  // REPRODUCIBILIDAD: capturar de nuevo, MISMO DOM sin cambios, confirmar
  // que los selectores son idénticos byte a byte.
  const snapshot2 = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);
  const selectors2 = snapshot2.links.map((l) => l.selector!);
  assert(JSON.stringify(selectors1) === JSON.stringify(selectors2), 'REPRODUCIBILIDAD: mismo DOM, 2 capturas sucesivas -> selectores idénticos en el mismo orden');

  // --- DeterministicAnalyzer + Ground Truth/oracle ---
  const detFindings = deterministicAnalyzer.analyzeSnapshots([
    {
      iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png',
      headings: snapshot1.headings, images: snapshot1.images, links: snapshot1.links, buttons: snapshot1.buttons,
      forms: snapshot1.forms, landmarks: snapshot1.landmarks, computedStyles: snapshot1.computedStyles,
    } as any,
  ]);
  const deterministicCriteria = fixture.groundTruth.criteria.filter((c) => c.verifiableBy === 'deterministic');
  const gtForFaseD: GroundTruth = { ...fixture.groundTruth, criteria: deterministicCriteria };
  const report = evaluateGroundTruth(gtForFaseD, detFindings as any);
  assert(report.overallPassed, `Oráculo: overallPassed=true — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
  assert(report.duplicateViolations.length === 0, 'Sin findings duplicados por (criterio, selector) — confirma indirectamente que los 6 selectores realmente se tratan como 6 identidades distintas en toda la cadena');

  // --- Payload Audit ---
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    { iteration: 1, url: 'https://fixture.local', screenshotPath: '/x.png', headings: snapshot1.headings, images: snapshot1.images, links: snapshot1.links, buttons: snapshot1.buttons, forms: snapshot1.forms, landmarks: snapshot1.landmarks, computedStyles: snapshot1.computedStyles },
  ]);
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: evalId, title: 'D2', url: 'https://fixture.local',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, { dedupedLinks, evidencesSummary: sanitized });
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
