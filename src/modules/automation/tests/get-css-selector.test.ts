import { chromium, Browser, Page } from 'playwright';
import { getCssSelector } from '@/modules/automation/automation.service';

/**
 * Phase 2.2.1 — getCssSelector() regression tests.
 *
 * Runs against a REAL Playwright/Chromium page (not jsdom, not a
 * reimplementation) — `getCssSelector` is imported directly from
 * automation.service.ts and its exact source is reconstructed inside the
 * page context the same way `extractCurrentSnapshot` does in production,
 * so these tests exercise the real, shipped algorithm.
 *
 * No real EvalUXIA evaluation session, no network, no Gemini calls.
 * `data-t="..."` attributes exist only in these synthetic test fixtures to
 * let assertions locate elements independently of the selector under test
 * — they are never injected into a real audited page (that page-mutation
 * approach was explicitly rejected in the Phase 2.2.1 design).
 */

async function runGetCssSelectorInPage(
  page: Page,
  markerAttr: string,
): Promise<{ selector: string; matchCount: number; isSameElement: boolean }> {
  const fnSource = getCssSelector.toString();
  return page.evaluate(
    ({ src, markerAttr }) => {
      // eslint-disable-next-line no-new-func
      const fn: (el: Element) => string = new Function(`return (${src});`)();
      const el = document.querySelector(`[${markerAttr}]`);
      if (!el) throw new Error(`Marker element [${markerAttr}] not found`);
      const selector = fn(el);
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        // leave matches empty — surfaced as a failed assertion below
      }
      return {
        selector,
        matchCount: matches.length,
        isSameElement: matches.length > 0 && matches[0] === el,
      };
    },
    { src: fnSource, markerAttr },
  );
}

async function main() {
  console.log('🧪 Starting getCssSelector() — Phase 2.2.1 Uniqueness & Traceability Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${msg}`);
      failed++;
    }
  }

  const browser: Browser = await chromium.launch({ headless: true });

  try {
    // -----------------------------------------------------------------
    // Caso 1: 5 <a> que con el algoritmo ANTERIOR colapsaban al mismo
    // string "a:nth-of-type(1)" (o "a" bare) porque el índice se calculaba
    // solo contra el padre inmediato, sin contexto de ancestros — el
    // patrón exacto encontrado en la evaluación real que motivó esta fase.
    // -----------------------------------------------------------------
    console.log('--- Caso 1: 5 <a> que antes colisionaban en el mismo selector ambiguo ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <div><a href="https://bootstrapmade.com/" data-t="m1">Home</a></div>
        <div><a href="https://bootstrapmade.com/bootstrap-one-page-templates/" data-t="m2">One Page</a></div>
        <div><a href="https://builder.bootstrapmade.com/demo/Siimple/" data-t="m3">Demo</a></div>
        <div><a href="https://bootstrapmade.com/vlava-free-bootstrap-one-page-template/" data-t="m4">Vlava</a></div>
        <div><a href="https://twitter.com/BootstrapMade" data-t="m5">Twitter</a></div>
      </body></html>`);

      const results = await Promise.all(
        ['m1', 'm2', 'm3', 'm4', 'm5'].map((m) => runGetCssSelectorInPage(page, `data-t="${m}"`)),
      );

      const selectors = results.map((r) => r.selector);
      const uniqueSelectors = new Set(selectors);
      assert(uniqueSelectors.size === 5, `Los 5 elementos producen 5 selectores DISTINTOS (obtenidos: ${JSON.stringify(selectors)})`);

      results.forEach((r, i) => {
        assert(r.matchCount === 1, `Elemento m${i + 1}: el selector "${r.selector}" resuelve a exactamente 1 elemento (obtuvo ${r.matchCount})`);
        assert(r.isSameElement, `Elemento m${i + 1}: el elemento resuelto es el elemento original`);
      });

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 2: <a> que hoy producen selector bare "a" (único <a> hijo de
    // padres distintos) — el patrón más extremo de no-unicidad observado
    // (110 ocurrencias reales en una sola evaluación).
    // -----------------------------------------------------------------
    console.log('\n--- Caso 2: <a> que antes producían selector bare "a" ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <nav><a href="/about" data-t="n1">About</a></nav>
        <footer><a href="/terms" data-t="n2">Terms</a></footer>
        <aside><a href="/privacy" data-t="n3">Privacy</a></aside>
      </body></html>`);

      const results = await Promise.all(
        ['n1', 'n2', 'n3'].map((m) => runGetCssSelectorInPage(page, `data-t="${m}"`)),
      );
      const selectors = results.map((r) => r.selector);
      assert(new Set(selectors).size === 3, `Los 3 elementos "a" (antes bare) producen selectores distintos: ${JSON.stringify(selectors)}`);
      assert(!selectors.includes('a'), 'Ningún selector generado es el bare ambiguo "a"');
      results.forEach((r, i) => {
        assert(r.matchCount === 1 && r.isSameElement, `Elemento n${i + 1}: único y correcto (selector="${r.selector}")`);
      });

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 3: patrón exacto del incidente real — 2 padres distintos, cada
    // uno con 2 <a>, que antes colisionaban en "a:nth-of-type(1)" y
    // "a:nth-of-type(2)" respectivamente entre sí.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 3: colisión real nav vs. footer (nth-of-type local) ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <nav>
          <a href="/nav1" data-t="nav1">Nav1</a>
          <a href="/nav2" data-t="nav2">Nav2</a>
        </nav>
        <footer>
          <a href="/foot1" data-t="foot1">Foot1</a>
          <a href="/foot2" data-t="foot2">Foot2</a>
        </footer>
      </body></html>`);

      const [nav1, nav2, foot1, foot2] = await Promise.all(
        ['nav1', 'nav2', 'foot1', 'foot2'].map((m) => runGetCssSelectorInPage(page, `data-t="${m}"`)),
      );

      assert(nav1.selector !== foot1.selector, `nav1 (${nav1.selector}) y foot1 (${foot1.selector}) ya NO comparten selector`);
      assert(nav2.selector !== foot2.selector, `nav2 (${nav2.selector}) y foot2 (${foot2.selector}) ya NO comparten selector`);
      [nav1, nav2, foot1, foot2].forEach((r) => {
        assert(r.matchCount === 1 && r.isSameElement, `Selector "${r.selector}" único y correcto`);
      });

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 4: compatibilidad real con Playwright — el selector generado
    // debe funcionar con page.click()/page.locator(), no solo con
    // document.querySelectorAll nativo.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 4: compatibilidad con Playwright (page.click real) ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <div><button data-t="btn1" onclick="document.title='clicked-1'">Uno</button></div>
        <div><button data-t="btn2" onclick="document.title='clicked-2'">Dos</button></div>
      </body></html>`);

      const btn2 = await runGetCssSelectorInPage(page, 'data-t="btn2"');
      assert(btn2.matchCount === 1 && btn2.isSameElement, `Selector de btn2 ("${btn2.selector}") único y correcto antes de usarlo con Playwright`);

      await page.click(btn2.selector, { timeout: 5000 });
      const title = await page.title();
      assert(title === 'clicked-2', `page.click("${btn2.selector}") activó el botón CORRECTO (title="${title}")`);

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 5: estabilidad — mismo DOM, mismo elemento, dos "capturas"
    // (llamadas) sucesivas → mismo selector.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 5: estabilidad entre snapshots (mismo DOM) ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <nav><a href="/x" data-t="stable">Enlace estable</a></nav>
      </body></html>`);

      const capture1 = await runGetCssSelectorInPage(page, 'data-t="stable"');
      const capture2 = await runGetCssSelectorInPage(page, 'data-t="stable"');
      assert(capture1.selector === capture2.selector, `Selector idéntico entre 2 capturas sucesivas sin cambios de DOM ("${capture1.selector}")`);

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 6: elemento con id NO único en el documento (HTML inválido
    // pero real) — no debe asumirse que #id es suficiente sin verificar.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 6: id duplicado (HTML inválido) — no debe asumirse único ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <div><span id="dup" data-t="dup1">Uno</span></div>
        <div><span id="dup" data-t="dup2">Dos</span></div>
      </body></html>`);

      const dup1 = await runGetCssSelectorInPage(page, 'data-t="dup1"');
      const dup2 = await runGetCssSelectorInPage(page, 'data-t="dup2"');
      assert(dup1.selector !== '#dup', 'El primer elemento con id duplicado NO usa el #id (no verificado como único)');
      assert(dup2.selector !== '#dup', 'El segundo elemento con id duplicado NO usa el #id (no verificado como único)');
      assert(dup1.selector !== dup2.selector, `Ambos elementos con id duplicado reciben selectores distintos (${dup1.selector} vs ${dup2.selector})`);
      assert(dup1.matchCount === 1 && dup1.isSameElement, 'dup1: selector único y correcto');
      assert(dup2.matchCount === 1 && dup2.isSameElement, 'dup2: selector único y correcto');

      await page.close();
    }

    // -----------------------------------------------------------------
    // Caso 7: id genuinamente único SÍ se usa (camino feliz preservado).
    // -----------------------------------------------------------------
    console.log('\n--- Caso 7: id único se usa correctamente (comportamiento preservado) ---');
    {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
        <div><span id="only-one" data-t="u1">Único</span></div>
      </body></html>`);
      const u1 = await runGetCssSelectorInPage(page, 'data-t="u1"');
      assert(u1.selector === '#only-one', `id único se usa directamente como selector (obtuvo "${u1.selector}")`);
      assert(u1.matchCount === 1 && u1.isSameElement, 'Selector por id único resuelve correctamente');
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
