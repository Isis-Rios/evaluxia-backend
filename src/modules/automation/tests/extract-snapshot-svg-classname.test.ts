import { automationService } from '@/modules/automation/automation.service';

/**
 * Regression test for the real incident in evaluation `6ae14f36dbe3c4962b8bc614`
 * (`https://startbootstrap.com/previews/landing-page`, iteration 2):
 *
 *   TypeError: btn.className.toLowerCase is not a function
 *
 * Root cause: `extractCurrentSnapshot`'s interactive-elements and buttons
 * queries both include `[role="button"]`/`[role="link"]`/etc, which match
 * SVG elements as well as HTML ones. `SVGElement.prototype.className` is an
 * `SVGAnimatedString` object (not a string), so `.toLowerCase()` on it
 * throws — this is the type EvalUXIA actually hit when Gemini clicked an
 * SVG-based mobile toggle and the next snapshot tried to describe it.
 *
 * Uses the real production pipeline via `attachTestSession` (same seam as
 * attach-test-session.test.ts) against local, deterministic HTML fixtures —
 * no network, no MongoDB, no Gemini.
 */
async function main() {
  console.log('🧪 Starting extractCurrentSnapshot SVG className regression tests...\n');

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

  try {
    // -----------------------------------------------------------------
    // Caso 1: elemento HTML normal con className de texto (comportamiento
    // existente preservado: isPrimary se sigue calculando desde la clase).
    // -----------------------------------------------------------------
    console.log('--- Caso 1: botón HTML con className string (comportamiento preservado) ---');
    {
      const evalId = 'svg-classname-case1';
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html><body>
          <button class="btn btn-primary" id="html-btn">Enviar</button>
        </body></html>`,
      );
      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      assert(snapshot.buttons.length === 1, 'Se extrajo el botón HTML');
      assert(snapshot.buttons[0]?.isPrimary === true, 'isPrimary=true detectado correctamente desde la clase "btn-primary" (string className)');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 2: elemento SVG con role="button" — className NO es un string
    // (SVGAnimatedString). Antes del fix esto lanzaba el TypeError real.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 2: elemento SVG con role="button" (className no-string) ---');
    {
      const evalId = 'svg-classname-case2';
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html><body>
          <svg id="mobileToggle" role="button" class="icon-toggle primary" width="24" height="24">
            <rect width="24" height="2" />
          </svg>
        </body></html>`,
      );

      let snapshot;
      let threw = false;
      try {
        snapshot = await automationService.extractCurrentSnapshot(evalId);
      } catch (e) {
        threw = true;
        console.error('  Unexpected error:', e);
      }
      assert(!threw, 'extractCurrentSnapshot NO lanza TypeError ante un elemento SVG con role="button"');
      assert(!!snapshot && snapshot.buttons.length === 1, 'El elemento SVG con role="button" fue capturado como botón');
      assert(!!snapshot && snapshot.buttons[0]?.isPrimary === true, 'isPrimary=true detectado correctamente desde la clase del SVG ("primary"), probando que getAttribute(\'class\') sí lee el valor');
      assert(!!snapshot?.visibleDOMSummary?.some((el) => el.type === 'button'), 'El SVG también aparece en visibleDOMSummary (interactive elements) sin lanzar error');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 3: elemento sin atributo class en absoluto.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 3: botón sin atributo class ---');
    {
      const evalId = 'svg-classname-case3';
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html><body>
          <button id="no-class-btn">Sin clase</button>
        </body></html>`,
      );
      let threw = false;
      let snapshot;
      try {
        snapshot = await automationService.extractCurrentSnapshot(evalId);
      } catch (e) {
        threw = true;
        console.error('  Unexpected error:', e);
      }
      assert(!threw, 'extractCurrentSnapshot no lanza error con un botón sin atributo class');
      assert(!!snapshot && snapshot.buttons.length === 1 && snapshot.buttons[0]?.isPrimary === false, 'Botón sin class: isPrimary=false, sin error');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 4: combinación de elementos HTML y SVG en el mismo snapshot,
    // reproduciendo el escenario real (navbar con botón HTML normal +
    // toggle SVG) — ambos deben coexistir sin que uno rompa al otro.
    // -----------------------------------------------------------------
    console.log('\n--- Caso 4: HTML + SVG combinados en el mismo snapshot ---');
    {
      const evalId = 'svg-classname-case4';
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html><body>
          <nav>
            <a href="/" class="nav-link">Inicio</a>
            <svg id="mobileToggle" role="button" class="icon-toggle">
              <rect width="24" height="2" />
            </svg>
          </nav>
          <main>
            <button class="btn btn-primary">Enviar</button>
            <button>Secundario</button>
          </main>
        </body></html>`,
      );

      let threw = false;
      let snapshot;
      try {
        snapshot = await automationService.extractCurrentSnapshot(evalId);
      } catch (e) {
        threw = true;
        console.error('  Unexpected error:', e);
      }
      assert(!threw, 'extractCurrentSnapshot no lanza error con una mezcla real de HTML + SVG');
      assert(!!snapshot && snapshot.links.length === 1, 'El link HTML se capturó correctamente');
      assert(!!snapshot && snapshot.buttons.length === 3, 'Los 3 elementos tipo botón (2 HTML + 1 SVG) se capturaron (sin que el SVG rompa la extracción de los otros)');
      const primaryCount = snapshot?.buttons.filter((b) => b.isPrimary).length ?? 0;
      assert(primaryCount === 1, 'Solo el botón HTML con clase "btn-primary" se marca isPrimary (el SVG sin esa clase y el secundario no)');
      assert(!!snapshot && snapshot.visibleDOMSummary?.length === 4, 'visibleDOMSummary conserva los 4 elementos interactivos (1 link + 2 button + 1 svg role=button)');
      await automationService.closeSession(evalId);
    }

    console.log('\n========================================');
    console.log(`Results: ${passed} passed, ${failed} failed.`);
    console.log('========================================\n');

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (e) {
    console.error('❌ Test suite crashed:', e);
    process.exit(1);
  }
}

main();
