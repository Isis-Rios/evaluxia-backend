import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput, SyntheticLink } from '@/shared/testing/synthetic-mongoose-evidence';
import { measurePayload, isAcceptableForFixtureKind } from '@/shared/testing/payload-budgets';

/**
 * Fase C — T2: Repeated elements (mostly identical across iterations).
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: los 5 enlaces que SÍ cambian de
 * contenido (href distinto) entre iteración 1 y 2 deben permanecer como
 * entradas SEPARADAS — fusionarlas perdería la evidencia de que el enlace
 * cambió (relevante, p.ej., para N-01/detección de cambios de estado).
 *
 * EVIDENCIA QUE SE COMPRIME (Y POR QUÉ ES SEGURO): los 295 enlaces
 * IDÉNTICOS entre iteraciones se colapsan a 1 entrada + `iterations:[1,2]`
 * — es seguro porque la clave de agrupación (`linkKey`) exige coincidencia
 * exacta en selector+text+href+ariaLabel+role+isExternal; ningún campo se
 * pierde, solo se evita repetir el MISMO objeto dos veces.
 */
function buildLinks(iteration: 1 | 2): SyntheticLink[] {
  const links: SyntheticLink[] = [];
  // 295 links IDENTICAL across both iterations (same real element, unchanged page).
  for (let i = 0; i < 295; i++) {
    links.push({ selector: `a:nth-of-type(${i})`, text: `Enlace ${i}`, href: `/page-${i}`, ariaLabel: null, role: null, isExternal: false });
  }
  // 5 links at the SAME selector/position, but whose content genuinely
  // CHANGED between iterations (simulates real content change, not noise).
  for (let i = 295; i < 300; i++) {
    const href = iteration === 1 ? `/page-${i}-before` : `/page-${i}-after`;
    links.push({ selector: `a:nth-of-type(${i})`, text: `Enlace ${i}`, href, ariaLabel: null, role: null, isExternal: false });
  }
  return links;
}

function buildPromptFor(iterations: number[]): { prompt: string; dedupedLinksCount: number } {
  const docs = iterations.map((it) => buildSyntheticMongooseEvidence({ iteration: it, links: buildLinks(it as 1 | 2) }));
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(
    docs.map((d) => toEvidenceInput(d)),
  );
  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: 't2', title: 'T2', url: 'https://example.com',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: iterations.length,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  return { prompt, dedupedLinksCount: dedupedLinks.length };
}

function runTests() {
  console.log('🧪 Starting T2 — Repeated Elements (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const docs = [
    buildSyntheticMongooseEvidence({ iteration: 1, links: buildLinks(1) }),
    buildSyntheticMongooseEvidence({ iteration: 2, links: buildLinks(2) }),
  ];
  const { dedupedLinks } = buildDeduplicatedEvidenceContext(docs.map((d) => toEvidenceInput(d)));

  console.log(`  ℹ️  dedupedLinks.length = ${dedupedLinks.length} (esperado: 305 = 295 fusionados + 5×2 no fusionados)`);
  assert(dedupedLinks.length === 305, 'Los 295 enlaces idénticos se fusionan en 295 entradas; los 5 que cambiaron producen 10 entradas separadas (5×2) = 305 total');

  const merged = dedupedLinks.filter((l: any) => (l.iterations as number[]).length === 2);
  const unmerged = dedupedLinks.filter((l: any) => (l.iterations as number[]).length === 1);
  assert(merged.length === 295, `Exactamente 295 entradas fusionadas con iterations=[1,2] (obtenido: ${merged.length})`);
  assert(unmerged.length === 10, `Exactamente 10 entradas NO fusionadas, una por cada versión distinta de los 5 enlaces cambiados (obtenido: ${unmerged.length})`);

  // Confirm no cross-contamination: a "before" and "after" version of the
  // same changed link must never end up merged into one entry.
  const changedLinkHrefs = dedupedLinks
    .filter((l: any) => l.href.includes('page-295') || l.href.includes('page-296'))
    .map((l: any) => ({ href: l.href, iterations: l.iterations }));
  assert(
    changedLinkHrefs.every((l: any) => l.iterations.length === 1),
    `Los enlaces cambiados nunca aparecen fusionados con su propia versión anterior/posterior: ${JSON.stringify(changedLinkHrefs)}`,
  );

  // Growth measurement: 1 iteración vs. 2 iteraciones — debe ser MUY sub-lineal.
  const oneIteration = buildPromptFor([1]);
  const twoIterations = buildPromptFor([1, 2]);
  const growthRatio = twoIterations.prompt.length / oneIteration.prompt.length;
  console.log(`  ℹ️  chars(1 iteración)=${oneIteration.prompt.length} chars(2 iteraciones)=${twoIterations.prompt.length} ratio=${growthRatio.toFixed(3)}`);
  assert(growthRatio < 1.2, `El crecimiento de 1->2 iteraciones es sub-lineal (ratio=${growthRatio.toFixed(3)} < 1.2, muy lejos de 2.0x)`);

  const measurement = measurePayload(2, twoIterations.prompt);
  assert(isAcceptableForFixtureKind(measurement, 'stress'), `Presupuesto: level=${measurement.level} (fixture de estrés — aceptable en cualquier nivel, lo que importa es que se detecte, no que sea NORMAL)`);
  console.log(`  ℹ️  Payload final (2 iteraciones): chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
