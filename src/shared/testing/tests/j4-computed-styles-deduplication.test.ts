import { ComputedStyleEvidence, ButtonEvidence } from '@/modules/snapshots/snapshot-evidence.model';
import {
  deduplicateComputedStyles,
  buildDeduplicatedEvidenceContext,
  EvidenceInput,
  IterationBucket,
} from '@/modules/evaluations/services/evidence-deduplication.service';
import { estimateTokensFromChars } from '@/shared/testing/payload-budgets';

/**
 * Hardening Post-Fase H — J4 Step 1: ComputedStyleEvidence Deduplication.
 *
 * Sigue exactamente el mismo patrón ya validado (T1-T3, F7) para
 * landmarks/links/buttons — mismo `groupIdenticalEvidence`, misma regla
 * "todos los campos participan en la clave, nunca un subconjunto". Cero
 * Gemini real, cero cambios a EvidenceGate/EvidenceTraceability/prompts/
 * payload-budgets/Ground Truth/fixtures.
 */
function cs(overrides: Partial<ComputedStyleEvidence> = {}): ComputedStyleEvidence {
  return {
    selector: 'p.intro', tag: 'p', text: 'Texto de párrafo', color: '#111111',
    backgroundColor: '#ffffff', fontSize: '16px', fontWeight: '400',
    lineHeight: '1.5', fontFamily: 'Arial, sans-serif',
    ...overrides,
  };
}

function bucket(iteration: number, items: ComputedStyleEvidence[]): IterationBucket<ComputedStyleEvidence> {
  return { iteration, items };
}

async function main() {
  console.log('🧪 Starting J4 Step 1 — ComputedStyles Deduplication (Hardening Post-Fase H)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ==========================================================================
  // J4-A — dos iteraciones idénticas -> 1 entrada, iterations=[1,2]
  // ==========================================================================
  {
    const result = deduplicateComputedStyles([bucket(1, [cs()]), bucket(2, [cs()])]);
    assert(result.length === 1, `J4-A: 2 iteraciones idénticas -> 1 entrada (obtenido: ${result.length})`);
    assert(JSON.stringify(result[0].iterations) === JSON.stringify([1, 2]), `J4-A: iterations=[1,2] (obtenido: ${JSON.stringify(result[0].iterations)})`);
  }

  // ==========================================================================
  // J4-B — cinco iteraciones idénticas -> 1 entrada, iterations=[1..5]
  // ==========================================================================
  {
    const buckets = [1, 2, 3, 4, 5].map((i) => bucket(i, [cs()]));
    const result = deduplicateComputedStyles(buckets);
    assert(result.length === 1, `J4-B: 5 iteraciones idénticas -> 1 entrada (obtenido: ${result.length})`);
    assert(JSON.stringify(result[0].iterations) === JSON.stringify([1, 2, 3, 4, 5]), `J4-B: iterations=[1,2,3,4,5] (obtenido: ${JSON.stringify(result[0].iterations)})`);
  }

  // ==========================================================================
  // J4-C — mismo selector, estilos diferentes -> 2 entradas, NUNCA fusionadas
  // ==========================================================================
  {
    const result = deduplicateComputedStyles([
      bucket(1, [cs({ color: '#111111' })]),
      bucket(2, [cs({ color: '#ff0000' })]),
    ]);
    assert(result.length === 2, `J4-C: mismo selector, color distinto -> 2 entradas (obtenido: ${result.length})`);
    assert(result.every((r) => JSON.stringify(r.iterations) !== JSON.stringify([1, 2])), 'J4-C: ninguna entrada aparece fusionada con iterations=[1,2] -- cada color es su propia observación');
  }

  // ==========================================================================
  // J4-D — selectores diferentes, estilos idénticos -> 2 entradas
  // ==========================================================================
  {
    const result = deduplicateComputedStyles([
      bucket(1, [cs({ selector: 'p.intro' }), cs({ selector: 'p.outro' })]),
    ]);
    assert(result.length === 2, `J4-D: selectores distintos con estilos idénticos NO se fusionan (obtenido: ${result.length})`);
  }

  // ==========================================================================
  // J4-E — una sola propiedad cambia entre iteraciones -> entradas separadas
  // ==========================================================================
  {
    const properties: Array<keyof ComputedStyleEvidence> = ['tag', 'text', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'fontFamily'];
    for (const prop of properties) {
      const base = cs();
      const changed = cs({ [prop]: `__changed__${String(base[prop])}` } as any);
      const result = deduplicateComputedStyles([bucket(1, [base]), bucket(2, [changed])]);
      assert(result.length === 2, `J4-E: un cambio aislado en "${prop}" entre iteraciones produce 2 entradas separadas (obtenido: ${result.length})`);
    }
  }

  // ==========================================================================
  // J4-F — selector + estilo + otro campo distinto -> no fusionar
  // ==========================================================================
  {
    const result = deduplicateComputedStyles([
      bucket(1, [cs({ selector: 'button.cta', color: '#000', text: 'Comprar' })]),
      bucket(2, [cs({ selector: 'button.cta', color: '#000', text: 'Comprar ahora' })]), // mismo selector+color, texto visible distinto
    ]);
    assert(result.length === 2, `J4-F: selector y color iguales, pero "text" distinto (afecta semántica -- es contenido visible real) -> NO se fusiona (obtenido: ${result.length})`);
  }

  // ==========================================================================
  // J4-G — preservación completa de campos (antes/después)
  // ==========================================================================
  {
    const original = cs({ selector: 'h1.title', tag: 'h1', text: 'Bienvenido', color: '#222', backgroundColor: '#eee', fontSize: '32px', fontWeight: '700', lineHeight: '1.2', fontFamily: 'Georgia' });
    const result = deduplicateComputedStyles([bucket(1, [original])]);
    const dedup = result[0];
    const allFieldsPreserved = (Object.keys(original) as Array<keyof ComputedStyleEvidence>).every((k) => dedup[k] === original[k]);
    assert(allFieldsPreserved, 'J4-G: los 9 campos originales de ComputedStyleEvidence se preservan exactamente (selector/tag/text/color/backgroundColor/fontSize/fontWeight/lineHeight/fontFamily)');
    assert(Array.isArray(dedup.iterations) && dedup.iterations.length === 1, 'J4-G: el único campo NUEVO añadido es "iterations" -- ningún campo original se pierde ni se renombra');
  }

  // ==========================================================================
  // J4-H — integración con payload Phase 2: raw > deduplicated > medición, sin perder trazabilidad
  // ==========================================================================
  {
    // Sesión realista: 30 estilos computados IDÉNTICOS a través de 6
    // iteraciones (ej. header/nav/footer estático) + 1 que cambia (ej. un
    // estado de error que aparece solo en la iteración 4).
    const STATIC_COUNT = 30;
    const ITERATIONS = 6;
    function buildStaticStyles(): ComputedStyleEvidence[] {
      return Array.from({ length: STATIC_COUNT }).map((_, i) => cs({ selector: `p:nth-of-type(${i + 1})`, text: `Párrafo estático ${i}` }));
    }
    const evidences: EvidenceInput[] = Array.from({ length: ITERATIONS }).map((_, i) => {
      const iteration = i + 1;
      const styles = buildStaticStyles();
      if (iteration === 4) {
        styles.push(cs({ selector: 'p.error-banner', text: 'Ha ocurrido un error', color: '#b00020' }));
      }
      return {
        iteration, url: 'https://fixture.local/j4h', screenshotPath: '/x.png',
        headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
        computedStyles: styles,
      };
    });

    const { dedupedComputedStyles } = buildDeduplicatedEvidenceContext(evidences);

    // Trazabilidad: los 30 estáticos -> 1 entrada c/u con iterations=[1..6]; el de error -> 1 entrada con iterations=[4].
    assert(dedupedComputedStyles.length === STATIC_COUNT + 1, `J4-H: ${STATIC_COUNT} estilos estáticos + 1 que cambió = ${STATIC_COUNT + 1} entradas deduplicadas (obtenido: ${dedupedComputedStyles.length})`);
    const errorEntry = dedupedComputedStyles.find((d: any) => d.selector === 'p.error-banner');
    assert(!!errorEntry && JSON.stringify(errorEntry.iterations) === JSON.stringify([4]), `J4-H: el estilo que solo apareció en la iteración 4 queda registrado con iterations=[4], no se pierde ni se confunde con los estáticos (obtenido: ${JSON.stringify(errorEntry?.iterations)})`);
    const staticEntry = dedupedComputedStyles.find((d: any) => d.selector === 'p:nth-of-type(1)');
    assert(!!staticEntry && JSON.stringify(staticEntry.iterations) === JSON.stringify([1, 2, 3, 4, 5, 6]), `J4-H: un estilo estático real queda con iterations=[1..6] (obtenido: ${JSON.stringify(staticEntry?.iterations)})`);

    // Medición: RAW (como se sirve HOY, repetido íntegro por iteración dentro de evidencesSummary) vs. DEDUPLICATED.
    const rawComputedStylesPerIteration = evidences.map((ev) => ev.computedStyles);
    const rawJson = JSON.stringify(rawComputedStylesPerIteration, null, 2);
    const dedupJson = JSON.stringify(dedupedComputedStyles, null, 2);

    const rawChars = rawJson.length;
    const dedupChars = dedupJson.length;
    const reductionAbs = rawChars - dedupChars;
    const reductionPercent = Number(((reductionAbs / rawChars) * 100).toFixed(1));
    const rawTokens = estimateTokensFromChars(rawChars);
    const dedupTokens = estimateTokensFromChars(dedupChars);

    console.log(`  ℹ️  RAW (repetido por iteración): ${rawChars} chars (~${rawTokens} tokens est.)`);
    console.log(`  ℹ️  DEDUPLICATED: ${dedupChars} chars (~${dedupTokens} tokens est.)`);
    console.log(`  ℹ️  Reducción: ${reductionAbs} chars (${reductionPercent}%)`);

    assert(dedupChars < rawChars, `J4-H: el payload deduplicado es estrictamente menor que el raw (raw=${rawChars}, dedup=${dedupChars})`);
    assert(reductionPercent > 50, `J4-H: con 30/31 elementos repetidos 6 veces, la reducción es sustancial (obtenido: ${reductionPercent}%) -- no es una reducción artificial, es la misma repetición ya cuantificada en F8 para otros tipos de evidencia`);

    // Trazabilidad preservada: la suma de entradas y sus "iterations" reconstruye exactamente el conteo original por iteración.
    for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
      const expectedCountThisIteration = evidences[iteration - 1].computedStyles.length;
      const reconstructedCount = dedupedComputedStyles.filter((d: any) => d.iterations.includes(iteration)).length;
      assert(reconstructedCount === expectedCountThisIteration, `J4-H: la iteración ${iteration} reconstruida desde dedupedComputedStyles tiene ${reconstructedCount} elementos (esperado: ${expectedCountThisIteration}) -- cero pérdida de trazabilidad por iteración`);
    }
  }

  // ==========================================================================
  // J4-I — 50+ elementos (el cap real de producción), sin modificar el límite
  // ==========================================================================
  {
    const N = 80; // > 50, simula lo que automation.service.ts YA capturaría antes del .slice(0,50) -- J4 Step 1 no toca ese límite
    const styles = Array.from({ length: N }).map((_, i) => cs({ selector: `el:nth-of-type(${i + 1})`, text: `Elemento ${i}` }));
    const result = deduplicateComputedStyles([bucket(1, styles), bucket(2, styles)]); // misma página, 2 capturas idénticas
    assert(result.length === N, `J4-I: con ${N} elementos (> 50) distintos entre sí, ninguno se pierde ni se fusiona incorrectamente -- ${N} entradas (obtenido: ${result.length})`);
    assert(result.every((r: any) => JSON.stringify(r.iterations) === JSON.stringify([1, 2])), 'J4-I: los 80 elementos, repetidos idénticos en 2 iteraciones, se deduplican correctamente uno a uno sin pérdida adicional -- J4 Step 1 no introduce ningún nuevo límite ni pérdida más allá del .slice(0,50) ya existente (no tocado aquí)');
  }

  // ==========================================================================
  // J4-J — no contaminación entre tipos de evidencia
  // ==========================================================================
  {
    const SHARED_SELECTOR = 'div.card';
    const evidences: EvidenceInput[] = [
      {
        iteration: 1, url: 'https://fixture.local/j4j', screenshotPath: '/x.png',
        headings: [{ level: 1, text: 'x', selector: SHARED_SELECTOR }],
        images: [{ selector: SHARED_SELECTOR, src: '/x.png', alt: null, ariaLabel: null, role: null, isDecorative: false }],
        links: [{ selector: SHARED_SELECTOR, text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false }],
        buttons: [{ selector: SHARED_SELECTOR, tag: 'button', text: 'x', ariaLabel: null, role: null, isDisabled: false, isPrimary: false } as ButtonEvidence],
        forms: [], landmarks: [{ type: 'nav', selector: SHARED_SELECTOR, ariaLabel: null }],
        computedStyles: [cs({ selector: SHARED_SELECTOR })],
      },
    ];
    const { dedupedComputedStyles, dedupedLinks, dedupedButtons, dedupedLandmarks } = buildDeduplicatedEvidenceContext(evidences);
    assert(dedupedComputedStyles.length === 1 && dedupedComputedStyles[0].selector === SHARED_SELECTOR, 'J4-J: el computedStyle con el selector compartido se registra correctamente en dedupedComputedStyles');
    assert(dedupedLinks.length === 1 && dedupedButtons.length === 1 && dedupedLandmarks.length === 1, 'J4-J: los OTROS tipos de evidencia con el MISMO selector se registran cada uno en su propio array, sin fusionarse entre sí ni con computedStyles');
    assert(
      (dedupedComputedStyles[0] as any).tag === 'p' && (dedupedButtons[0] as any).tag === 'button',
      'J4-J: el campo "tag" de computedStyles (p, heredado del generador) y el de buttons (button) permanecen independientes -- ninguna propiedad se mezcló entre tipos',
    );
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
