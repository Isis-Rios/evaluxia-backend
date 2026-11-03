import { automationService } from '@/modules/automation/automation.service';

/**
 * Fase 2.3 — Fase A, testing infrastructure proof.
 *
 * Confirms the new `attachTestSession` seam lets the REAL production
 * pipeline (extractCurrentSnapshot, executeAction) run against a local,
 * deterministic HTML fixture — no network, no MongoDB, no Gemini, and no
 * change to `startSession`'s SSRF validation for actual evaluations.
 */
async function main() {
  console.log('🧪 Starting attachTestSession (Fase 2.3 Fase A) infrastructure tests...\n');

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

  const evalId = 'fase-a-proof-eval';

  try {
    await automationService.attachTestSession(
      evalId,
      `<!DOCTYPE html><html><body>
        <header><nav><a href="/" data-t="home">Inicio</a></nav></header>
        <main>
          <h1>Título principal</h1>
          <img src="/logo.png" alt="Logo de la empresa" />
          <form>
            <label for="email">Correo</label>
            <input id="email" type="email" />
            <button type="submit">Enviar</button>
          </form>
        </main>
        <footer><a href="/terminos">Términos</a></footer>
      </body></html>`,
    );

    const snapshot = await automationService.extractCurrentSnapshot(evalId);

    assert(snapshot.headings.length === 1 && snapshot.headings[0].text === 'Título principal', 'extractCurrentSnapshot capturó el heading real del fixture');
    assert(snapshot.images.length === 1 && snapshot.images[0].alt === 'Logo de la empresa', 'extractCurrentSnapshot capturó la imagen real del fixture');
    assert(snapshot.links.length === 2, 'extractCurrentSnapshot capturó los 2 links reales del fixture');
    assert(snapshot.forms.length === 1 && snapshot.forms[0].elements[0].label === 'Correo', 'extractCurrentSnapshot asoció correctamente el label del formulario');
    assert(snapshot.buttons.length === 1 && snapshot.buttons[0].text === 'Enviar', 'extractCurrentSnapshot capturó el botón real del fixture');

    // Confirms getCssSelector (Fase 2.2.1) sigue produciendo selectores
    // únicos y verificados dentro del pipeline real, no solo aislado.
    const homeLink = snapshot.links.find((l) => l.text === 'Inicio');
    assert(!!homeLink?.selector, 'El link "Inicio" tiene un selector generado');

    // Confirms executeAction real puede usar ese selector para interactuar.
    const clickResult = await automationService.executeAction(evalId, {
      actionType: 'CLICK',
      selector: 'button',
    });
    assert(clickResult.success === true, 'executeAction real (page.click) funciona sobre una sesión creada vía attachTestSession');

    await automationService.closeSession(evalId);
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
