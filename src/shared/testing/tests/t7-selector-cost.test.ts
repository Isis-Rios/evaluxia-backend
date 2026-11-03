import { chromium } from 'playwright';
import { automationService } from '@/modules/automation/automation.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { estimateTokensFromChars } from '@/shared/testing/payload-budgets';

/**
 * Fase C — T7: cost of the Fase 2.2.1 unique ancestor-chain selectors on a
 * deeply nested, structurally-repetitive DOM (8 branches, 5 levels of
 * single-child wrapper divs each) — the worst realistic case for a
 * position-based selector, since every intermediate level is a bare tag
 * (only 1 child) and only the outermost level actually distinguishes the
 * 8 branches.
 *
 * Measures REAL selectors from the REAL, current `getCssSelector`
 * (via attachTestSession + extractCurrentSnapshot — the actual production
 * path), and compares them against what the PRE-2.2.1 algorithm would have
 * produced for the SAME real elements — reconstructed here, in this test
 * file ONLY, exactly as it existed before Fase 2.2.1 (single-level
 * `tag:nth-of-type(n)`, no ancestor chain, no verification), purely for
 * comparison. Production code (automation.service.ts) is not touched or
 * re-implemented for real use — this is a measurement, not a rollback.
 *
 * EVIDENCIA QUE SE ESPERA CONSERVAR: unicidad verificada de cada uno de
 * los 8 selectores (no se sacrifica por costo — este test NO propone
 * volver al algoritmo anterior, que era más corto pero ambiguo).
 */
async function main() {
  console.log('🧪 Starting T7 — Selector Cost on Deeply Nested DOM (Fase C)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const fixture = loadFixture('stress/deeply-nested-noisy-dom.html');

  // --- REAL selectors, via the REAL production path (2.2.1, current) ---
  const evalId = 't7-selector-cost';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  assert(snapshot.links.length === 8, `Se capturan los 8 enlaces reales (obtenido: ${snapshot.links.length})`);

  const newSelectors = snapshot.links.map((l) => l.selector!);
  const uniqueNewSelectors = new Set(newSelectors);
  assert(uniqueNewSelectors.size === 8, `Los 8 selectores actuales (2.2.1) son TODOS distintos entre sí (obtenido: ${uniqueNewSelectors.size} únicos) — la unicidad NO se sacrifica`);

  // --- OLD (pre-2.2.1) algorithm, reconstructed HERE ONLY for comparison —
  // reproduced verbatim from the code as it existed before Fase 2.2.1, run
  // via a completely separate, raw Playwright page against the identical
  // static HTML (never touches automation.service.ts). ---
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fixture.html);

  const oldSelectors: string[] = await page.evaluate(() => {
    const oldGetCssSelector = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
      const name = el.getAttribute('name');
      if (name) return `[name="${name.replace(/"/g, '\\"')}"]`;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return `${tag}:nth-of-type(${index})`;
      }
      return tag;
    };
    return Array.from(document.querySelectorAll('a[href]')).map(oldGetCssSelector);
  });
  await browser.close();

  console.log(`  ℹ️  Selectores ANTIGUOS (pre-2.2.1) para las 8 ramas: ${JSON.stringify(oldSelectors)}`);
  console.log(`  ℹ️  Selectores ACTUALES (2.2.1) para las 8 ramas: ${JSON.stringify(newSelectors)}`);

  const uniqueOldSelectors = new Set(oldSelectors);
  assert(uniqueOldSelectors.size === 1, `CONFIRMA EL BUG ORIGINAL: el algoritmo anterior producía el MISMO selector ambiguo ("${oldSelectors[0]}") para las 8 ramas distintas (obtenido: ${uniqueOldSelectors.size} valor único para 8 elementos reales)`);

  const oldTotalChars = oldSelectors.join('').length;
  const newTotalChars = newSelectors.join('').length;
  const oldTokens = estimateTokensFromChars(oldTotalChars);
  const newTokens = estimateTokensFromChars(newTotalChars);
  const extraCharsPerElement = (newTotalChars - oldTotalChars) / 8;

  console.log(`  ℹ️  Costo total: antiguo=${oldTotalChars} chars (${oldTokens} tokens est.) vs. actual=${newTotalChars} chars (${newTokens} tokens est.)`);
  console.log(`  ℹ️  Costo adicional promedio por elemento: +${extraCharsPerElement.toFixed(1)} chars/selector (por la cadena de ancestros necesaria para desambiguar)`);
  assert(newTotalChars > oldTotalChars, 'El algoritmo actual (correcto) cuesta más caracteres que el anterior (ambiguo) — costo esperado y aceptado a cambio de unicidad real');
  assert(extraCharsPerElement < 100, `El costo adicional por elemento es pequeño en términos absolutos (+${extraCharsPerElement.toFixed(1)} chars/selector) — no representa un riesgo de payload por sí solo`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
