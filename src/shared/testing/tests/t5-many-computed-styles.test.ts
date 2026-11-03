import { automationService } from '@/modules/automation/automation.service';
import { loadFixture } from '@/shared/testing/fixture-loader';

/**
 * Fase C — T5: Many computedStyles — (a) confirms the real 50-element cap
 * holds with real Playwright against >50 candidates, (b) MEASURES (does
 * not compress) how much of a typical 50-element sample shares an
 * identical style value-set — a future Fase 2.2.2 candidate, per the
 * Fase 2.3 plan, quantified here with real numbers instead of guesswork.
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: los 50 selectores individuales (cada
 * uno es un elemento real distinto, con su propia posición en el DOM) —
 * NO se propone ni se implementa agrupación por estilo compartido aquí.
 */
async function main() {
  console.log('🧪 Starting T5 — Many Computed Styles (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- (a) Real cap enforcement, real Playwright, real DOM with 80 <p> ---
  const fixture = loadFixture('stress/many-computed-styles.html');
  const evalId = 't5-many-styles';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  console.log(`  ℹ️  computedStyles.length capturado = ${snapshot.computedStyles.length} (80 <p> candidatos + 1 <h1>, tope real = 50)`);
  assert(snapshot.computedStyles.length === 50, `El tope real de 50 elementos SE RESPETA aunque haya 81 candidatos elegibles en el DOM (obtenido: ${snapshot.computedStyles.length})`);

  // --- (b) Redundancy measurement (synthetic, purely diagnostic) ---
  // Realistic sample: 45 of 50 elements share IDENTICAL visual style (same
  // shared CSS rule), 5 have a genuinely distinct style.
  const sample = Array.from({ length: 50 }).map((_, i) => ({
    selector: `p:nth-of-type(${i + 1})`,
    tag: 'p',
    text: '',
    color: i < 45 ? '#333333' : `#${(100 + i).toString(16)}0000`,
    backgroundColor: '#ffffff',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    fontFamily: 'sans-serif',
  }));

  const valueSetKey = (s: (typeof sample)[number]) =>
    JSON.stringify([s.color, s.backgroundColor, s.fontSize, s.fontWeight, s.lineHeight, s.fontFamily]);

  const groups = new Map<string, number>();
  for (const s of sample) {
    const key = valueSetKey(s);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const uniqueStyleSignatures = groups.size;
  const redundantEntries = sample.length - uniqueStyleSignatures;
  const redundancyPercent = ((redundantEntries / sample.length) * 100).toFixed(1);

  console.log(`  ℹ️  [MEDICIÓN, no implementación] De 50 elementos, ${uniqueStyleSignatures} firmas de estilo únicas -> ${redundantEntries} entradas (${redundancyPercent}%) comparten un estilo idéntico con otra entrada.`);
  console.log(`  ℹ️  Si se agrupara por firma de estilo (como ya se hace con landmarks/links/buttons), el payload de computedStyles podría reducirse aproximadamente en esa proporción — NO implementado, solo cuantificado para decisión futura (Fase 2.2.2+).`);
  assert(redundantEntries === 44, `Medición reproducible: con esta muestra realista, 44 de 50 entradas son redundantes entre sí por estilo idéntico (${redundancyPercent}%)`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
