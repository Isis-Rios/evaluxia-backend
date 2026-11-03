import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput, SyntheticLink, SyntheticButton } from '@/shared/testing/synthetic-mongoose-evidence';

/**
 * Fase C — T3: Repeated-looking but genuinely DIFFERENT elements (the
 * "100 tarjetas de producto" scenario from the source research document,
 * D-11 "Deduplicación agresiva" — a card's broken link lost inside an
 * otherwise-identical-looking second card).
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: las 100 tarjetas son productos
 * DISTINTOS (mismo texto de botón "Ver producto", mismo estilo, pero
 * `href` único por producto) — cada una debe seguir siendo una entrada
 * separada en `dedupedLinks`/`dedupedButtons`, nunca fusionada con otra
 * tarjeta solo porque "se ven iguales".
 *
 * EVIDENCIA QUE SE COMPRIME (Y POR QUÉ ES SEGURO): cuando la MISMA tarjeta
 * (mismo selector+href) aparece sin cambios en una 2ª iteración, esa
 * repetición SÍ se colapsa — es la misma tarjeta real, no una nueva.
 */
function buildCards(count: number): { links: SyntheticLink[]; buttons: SyntheticButton[] } {
  const links: SyntheticLink[] = [];
  const buttons: SyntheticButton[] = [];
  for (let i = 0; i < count; i++) {
    links.push({
      selector: `article:nth-of-type(${i + 1}) > a`,
      text: 'Ver producto',
      href: `/productos/${i + 1}`,
      ariaLabel: null, role: null, isExternal: false,
    });
    buttons.push({
      selector: `article:nth-of-type(${i + 1}) > button`,
      tag: 'button', text: 'Añadir al carrito', ariaLabel: null, role: null, isDisabled: false, isPrimary: false,
    });
  }
  return { links, buttons };
}

function runTests() {
  console.log('🧪 Starting T3 — Similar-but-Different Elements / "100 cards" (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const CARD_COUNT = 100;
  const iter1 = buildCards(CARD_COUNT);
  const iter2 = buildCards(CARD_COUNT); // identical cards, unchanged page on 2nd capture

  const docs = [
    buildSyntheticMongooseEvidence({ iteration: 1, links: iter1.links, buttons: iter1.buttons }),
    buildSyntheticMongooseEvidence({ iteration: 2, links: iter2.links, buttons: iter2.buttons }),
  ];
  const { dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(docs.map((d) => toEvidenceInput(d)));

  console.log(`  ℹ️  dedupedLinks.length=${dedupedLinks.length} dedupedButtons.length=${dedupedButtons.length} (esperado: 100 y 100 — 1 por producto, no 200)`);
  assert(dedupedLinks.length === CARD_COUNT, `Los 100 productos (con href únicos) NO se fusionan entre sí: dedupedLinks.length=${dedupedLinks.length}`);
  assert(dedupedButtons.length === CARD_COUNT, `Los 100 botones "Añadir al carrito" (mismo texto, distinto selector real) NO se fusionan entre sí: dedupedButtons.length=${dedupedButtons.length}`);

  const allLinksMergedAcrossIterations = dedupedLinks.every((l: any) => JSON.stringify(l.iterations) === JSON.stringify([1, 2]));
  assert(allLinksMergedAcrossIterations, 'Cada uno de los 100 links SÍ se fusiona correctamente consigo mismo entre iteración 1 y 2 (iterations=[1,2]) — es el mismo producto, sin cambios');

  // Verify hrefs are all genuinely distinct in the deduplicated output —
  // i.e. no information about WHICH product a link points to was lost.
  const uniqueHrefs = new Set(dedupedLinks.map((l: any) => l.href));
  assert(uniqueHrefs.size === CARD_COUNT, `Los 100 hrefs distintos se preservan íntegros en la salida deduplicada (${uniqueHrefs.size} valores únicos)`);

  // Now the D-11 scenario precisely: ONE card's link breaks in iteration 2
  // (href changes) while the OTHER 99 remain unchanged — the broken one
  // must NOT be silently absorbed/lost.
  const iter2WithBreak = buildCards(CARD_COUNT);
  iter2WithBreak.links[41] = { ...iter2WithBreak.links[41], href: '/productos/broken-link' };
  const docsWithBreak = [
    buildSyntheticMongooseEvidence({ iteration: 1, links: iter1.links, buttons: iter1.buttons }),
    buildSyntheticMongooseEvidence({ iteration: 2, links: iter2WithBreak.links, buttons: iter2WithBreak.buttons }),
  ];
  const { dedupedLinks: dedupedWithBreak } = buildDeduplicatedEvidenceContext(docsWithBreak.map((d) => toEvidenceInput(d)));
  const brokenEntry = dedupedWithBreak.find((l: any) => l.href === '/productos/broken-link');
  console.log(`  ℹ️  dedupedLinks.length con 1 enlace roto en iteración 2 = ${dedupedWithBreak.length} (esperado: 101 = 99 fusionados + 2 versiones del que cambió)`);
  assert(dedupedWithBreak.length === CARD_COUNT + 1, `Con 1 producto cuyo link cambia en iter 2, se preservan 101 entradas (99 fusionadas + 2 versiones separadas del producto #42) — NUNCA se "pierde" el enlace roto por deduplicación agresiva`);
  assert(!!brokenEntry && JSON.stringify(brokenEntry.iterations) === JSON.stringify([2]), `El enlace roto aparece como su PROPIA entrada, marcado solo en iteración 2, no fusionado con la versión "buena" de iteración 1`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
