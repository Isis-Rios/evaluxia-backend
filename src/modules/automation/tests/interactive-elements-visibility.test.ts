import { automationService } from '@/modules/automation/automation.service';

/**
 * Suite determinística de verificación de filtrado de visibilidad e interactividad
 * en `getInteractiveElements()` (visibleDOMSummary) en `automation.service.ts`.
 *
 * Se ejecuta contra un navegador Playwright real local vía `attachTestSession`,
 * sin red, sin MongoDB y sin llamadas a Gemini.
 */
async function main() {
  console.log('🧪 Iniciando pruebas de filtrado de visibilidad e interactividad en getInteractiveElements...\n');

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

  const evalId = 'visibility-filter-test-eval';

  try {
    // -----------------------------------------------------------------
    // Caso 1: Enlace de navegación móvil oculto en viewport de escritorio
    // (Reproducción exacta del fallo de Evaluación C con .mrd-tabbar__item)
    // -----------------------------------------------------------------
    console.log('--- Caso 1: Elementos móviles ocultos mediante media queries / display:none ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <head>
            <style>
              .mobile-only { display: none; }
              .desktop-nav { display: block; }
            </style>
          </head>
          <body>
            <header>
              <nav class="desktop-nav">
                <a href="/catalog" id="desktop-link">Catálogo</a>
              </nav>
              <nav class="mobile-only">
                <a href="/mobile-home" id="mobile-link" class="mrd-tabbar__item">Inicio Móvil</a>
              </nav>
            </header>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      assert(summary.some((el) => el.text === 'Catálogo'), 'Enlace visible de escritorio sí está presente en visibleDOMSummary');
      assert(!summary.some((el) => el.text === 'Inicio Móvil'), 'Enlace móvil con display:none está correctamente EXCLUIDO de visibleDOMSummary');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 2: Elementos con visibility: hidden y opacity: 0
    // -----------------------------------------------------------------
    console.log('\n--- Caso 2: Elementos con visibility: hidden y opacity: 0 ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <body>
            <button id="visible-btn">Botón Visible</button>
            <button id="hidden-btn" style="visibility: hidden;">Botón Oculto</button>
            <button id="transparent-btn" style="opacity: 0;">Botón Transparente</button>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      assert(summary.some((el) => el.text === 'Botón Visible'), 'Botón visible sí está presente');
      assert(!summary.some((el) => el.text === 'Botón Oculto'), 'Botón con visibility:hidden está EXCLUIDO');
      assert(!summary.some((el) => el.text === 'Botón Transparente'), 'Botón con opacity:0 está EXCLUIDO');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 3: Elementos sin dimensiones visibles (0x0, .sr-only / utility)
    // -----------------------------------------------------------------
    console.log('\n--- Caso 3: Elementos sin dimensiones visibles (0x0 y screen-reader-only) ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <head>
            <style>
              .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
              .zero-dim { display: inline-block; width: 0px; height: 0px; overflow: hidden; }
            </style>
          </head>
          <body>
            <a href="#main" class="sr-only">Saltar al contenido</a>
            <a href="/hidden-zero" class="zero-dim">Enlace Cero</a>
            <a href="/valid" id="valid-link" style="display: inline-block; width: 100px; height: 30px;">Enlace Válido</a>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      assert(summary.some((el) => el.text === 'Enlace Válido'), 'Enlace con dimensiones reales sí está presente');
      assert(!summary.some((el) => el.text === 'Saltar al contenido'), 'Enlace .sr-only de 1x1 está EXCLUIDO de visibleDOMSummary interactivo');
      assert(!summary.some((el) => el.text === 'Enlace Cero'), 'Enlace de 0x0 está EXCLUIDO de visibleDOMSummary');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 4: Contenedores con hidden, inert o aria-hidden="true"
    // -----------------------------------------------------------------
    console.log('\n--- Caso 4: Contenedores con hidden, inert o aria-hidden="true" ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <body>
            <div hidden>
              <button id="in-hidden">Botón en div hidden</button>
            </div>
            <div inert>
              <button id="in-inert">Botón en div inert</button>
            </div>
            <div aria-hidden="true">
              <button id="in-aria-hidden">Botón en div aria-hidden</button>
            </div>
            <div>
              <button id="normal-btn">Botón Normal</button>
            </div>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      assert(summary.some((el) => el.text === 'Botón Normal'), 'Botón en contenedor normal sí está presente');
      assert(!summary.some((el) => el.text === 'Botón en div hidden'), 'Botón en contenedor hidden está EXCLUIDO');
      assert(!summary.some((el) => el.text === 'Botón en div inert'), 'Botón en contenedor inert está EXCLUIDO');
      assert(!summary.some((el) => el.text === 'Botón en div aria-hidden'), 'Botón en contenedor aria-hidden="true" está EXCLUIDO');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 5: Evaluación de elementos deshabilitados (preservados con isDisabled=true)
    // -----------------------------------------------------------------
    console.log('\n--- Caso 5: Elementos deshabilitados (evaluados con isDisabled: true) ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <body>
            <button id="enabled-btn" class="btn btn-primary">Guardar</button>
            <button id="disabled-btn" disabled>Deshabilitado HTML</button>
            <button id="aria-disabled-btn" aria-disabled="true">Deshabilitado ARIA</button>
            <button id="pointer-none-btn" style="pointer-events: none;">Pointer None</button>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      const enabled = summary.find((el) => el.text === 'Guardar');
      const disabledHtml = summary.find((el) => el.text === 'Deshabilitado HTML');
      const disabledAria = summary.find((el) => el.text === 'Deshabilitado ARIA');
      const pointerNone = summary.find((el) => el.text === 'Pointer None');

      assert(enabled !== undefined && enabled.isDisabled === false, 'Botón habilitado tiene isDisabled: false');
      assert(disabledHtml !== undefined && disabledHtml.isDisabled === true, 'Botón disabled HTML tiene isDisabled: true');
      assert(disabledAria !== undefined && disabledAria.isDisabled === true, 'Botón aria-disabled="true" tiene isDisabled: true');
      assert(pointerNone !== undefined && pointerNone.isDisabled === true, 'Botón con pointer-events:none tiene isDisabled: true');
      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 6: Elementos que aparecen dinámicamente
    // -----------------------------------------------------------------
    console.log('\n--- Caso 6: Elementos que aparecen dinámicamente tras acción ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <body>
            <button id="toggle-btn" onclick="document.getElementById('dyn-modal').style.display='block'">Mostrar Menú</button>
            <div id="dyn-modal" style="display: none;">
              <a href="/checkout" id="checkout-link">Pagar Ahora</a>
            </div>
          </body>
        </html>`,
      );

      // Snapshot inicial: el modal está oculto
      const snap1 = await automationService.extractCurrentSnapshot(evalId);
      assert(!snap1.visibleDOMSummary?.some((el) => el.text === 'Pagar Ahora'), 'Antes de la acción, el enlace dinámico oculto NO aparece en visibleDOMSummary');

      // Ejecutar clic en el botón para mostrar el modal
      const clickRes = await automationService.executeAction(evalId, {
        actionType: 'CLICK',
        selector: '#toggle-btn',
      });
      assert(clickRes.success === true, 'Clic en #toggle-btn ejecutado exitosamente');

      // Snapshot posterior: el modal ahora es visible
      const snap2 = await automationService.extractCurrentSnapshot(evalId);
      assert(snap2.visibleDOMSummary?.some((el) => el.text === 'Pagar Ahora') === true, 'Tras la acción, el enlace dinámico visible SÍ aparece en visibleDOMSummary');

      await automationService.closeSession(evalId);
    }

    // -----------------------------------------------------------------
    // Caso 7: [RIESGO 5, auditoría 2026-11-13] Skip-link de accesibilidad
    // posicionado fuera del lienzo (patrón real: top/left muy negativos hasta
    // recibir foco, tamaño normal y positivo) debe excluirse como candidato
    // de clic ordinario, SIN excluir contenido legítimo bajo el pliegue ni
    // revertir el filtrado ya existente (display:none, elemento visible).
    // -----------------------------------------------------------------
    console.log('\n--- Caso 7: Skip-link fuera de lienzo excluido; elemento legítimo bajo el pliegue conservado ---');
    {
      await automationService.attachTestSession(
        evalId,
        `<!DOCTYPE html><html>
          <head>
            <style>
              .sf-skip-link {
                position: absolute;
                top: -9999px;
                left: -9999px;
                padding: 8px 16px;
                background: #000;
                color: #fff;
              }
              .sf-skip-link:focus { top: 0; left: 0; }
            </style>
          </head>
          <body style="margin:0;">
            <a href="#main" class="sf-skip-link">Skip to main content</a>
            <button id="hidden-display-btn" style="display: none;">Botón Oculto Display None</button>
            <button id="visible-top-btn">Botón Visible Superior</button>
            <div style="height: 3000px;">Espaciador</div>
            <button id="below-fold-btn">Suscribirse al boletín</button>
            <main id="main"></main>
          </body>
        </html>`,
      );

      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      const summary = snapshot.visibleDOMSummary || [];

      assert(!summary.some((el) => el.text === 'Skip to main content'), 'Skip-link posicionado fuera de lienzo (top/left muy negativos) está EXCLUIDO como candidato ordinario');
      assert(!summary.some((el) => el.text === 'Botón Oculto Display None'), 'Botón con display:none sigue EXCLUIDO (filtro preexistente no se rompió)');
      assert(summary.some((el) => el.text === 'Botón Visible Superior'), 'Botón visible normal sigue INCLUIDO');
      assert(summary.some((el) => el.text === 'Suscribirse al boletín'), 'Botón legítimo bajo el pliegue (scrolleable, coordenadas positivas) sigue INCLUIDO como candidato');
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
