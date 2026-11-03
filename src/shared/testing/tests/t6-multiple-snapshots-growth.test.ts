import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput, SyntheticLink, SyntheticLandmark } from '@/shared/testing/synthetic-mongoose-evidence';
import { measurePayload } from '@/shared/testing/payload-budgets';

/**
 * Fase C — T6: growth curve across multiple, mostly-repeated snapshots.
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: la evidencia de la PRIMERA iteración
 * (líneas base de navegación/landmarks) y cualquier cambio real entre
 * iteraciones (el elemento que varía en cada captura).
 *
 * EVIDENCIA QUE SE COMPRIME (Y POR QUÉ ES SEGURO): repeticiones idénticas
 * de landmarks/links entre iteraciones se colapsan a 1 entrada +
 * `iterations: number[]` — no se pierde CUÁNDO cada elemento estuvo
 * presente (la lista de iteraciones lo preserva), solo se evita repetir el
 * mismo objeto una vez por iteración.
 */
function buildLinksForIteration(iteration: number): SyntheticLink[] {
  const links: SyntheticLink[] = [];
  for (let i = 0; i < 50; i++) {
    links.push({ selector: `nav a:nth-of-type(${i})`, text: `Nav ${i}`, href: `/nav-${i}`, ariaLabel: null, role: null, isExternal: false });
  }
  // 1 element that genuinely changes every iteration (simulates a real,
  // legitimate change worth preserving per-iteration — e.g. a breadcrumb).
  links.push({ selector: 'nav a.current', text: `Página actual: paso ${iteration}`, href: `/paso-${iteration}`, ariaLabel: null, role: null, isExternal: false });
  return links;
}

function buildLandmarksForIteration(): SyntheticLandmark[] {
  return [
    { type: 'header', selector: 'header', ariaLabel: null },
    { type: 'nav', selector: 'nav', ariaLabel: 'Principal' },
    { type: 'main', selector: 'main', ariaLabel: null },
    { type: 'footer', selector: 'footer', ariaLabel: null },
  ];
}

function buildPromptForIterations(count: number): { prompt: string; dedupedLinksCount: number } {
  const docs = Array.from({ length: count }).map((_, i) =>
    buildSyntheticMongooseEvidence({ iteration: i + 1, links: buildLinksForIteration(i + 1), landmarks: buildLandmarksForIteration() }),
  );
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(
    docs.map((d) => toEvidenceInput(d)),
  );
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: `t6-${count}`, title: 'T6', url: 'https://example.com',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: count,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  return { prompt, dedupedLinksCount: dedupedLinks.length };
}

function runTests() {
  console.log('🧪 Starting T6 — Growth Across Multiple Snapshots (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const forCounts = [1, 2, 3, 5];
  const results = forCounts.map((count) => ({ count, ...buildPromptForIterations(count), measurement: measurePayload(2, buildPromptForIterations(count).prompt) }));

  results.forEach((r) => {
    console.log(`  ℹ️  iteraciones=${r.count} chars=${r.prompt.length} dedupedLinks=${r.dedupedLinksCount} level=${r.measurement.level}`);
  });

  // 50 links repetidos idénticos siempre se fusionan a 50 entradas; el 51º
  // (el que cambia cada vez) nunca se fusiona -> dedupedLinks.length debe
  // ser 50 + count (nunca 51*count).
  results.forEach((r) => {
    const expected = 50 + r.count;
    assert(r.dedupedLinksCount === expected, `Con ${r.count} iteraciones: dedupedLinks.length=${r.dedupedLinksCount} (esperado ${expected} = 50 fusionados + ${r.count} versiones del elemento que cambia cada vez)`);
  });

  // Growth ratio: chars(5 iteraciones) / chars(1 iteración) debe ser MUY
  // inferior a 5x (crecimiento lineal ingenuo sin deduplicación).
  const chars1 = results.find((r) => r.count === 1)!.prompt.length;
  const chars5 = results.find((r) => r.count === 5)!.prompt.length;
  const ratio = chars5 / chars1;
  console.log(`  ℹ️  Ratio de crecimiento 1->5 iteraciones: ${ratio.toFixed(3)}x (lineal ingenuo sería 5.0x)`);
  assert(ratio < 1.3, `El crecimiento de 1 a 5 iteraciones es MUY sub-lineal (ratio=${ratio.toFixed(3)}x, lejos de 5.0x) — confirma que la deduplicación escala correctamente con más iteraciones, no solo con 2`);

  // Ningún nivel de payload debería salir de NORMAL en este escenario —
  // es un fixture funcional-repetitivo, no un stress deliberadamente extremo.
  assert(results.every((r) => r.measurement.level === 'NORMAL'), 'Todos los niveles de payload (1 a 5 iteraciones) permanecen NORMAL');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
