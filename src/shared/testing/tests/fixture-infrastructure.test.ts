import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { loadFixture, listFixtures } from '@/shared/testing/fixture-loader';
import { evaluateGroundTruth } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase 2.3 — Fase A: end-to-end proof of the fixture infrastructure.
 *
 * fixture-loader.ts (HTML + sibling Ground Truth JSON)
 *   -> attachTestSession (real Playwright, no network)
 *   -> extractCurrentSnapshot (real capture + getCssSelector)
 *   -> DeterministicAnalyzer (real, no Gemini)
 *   -> ground-truth-oracle (real comparator)
 *
 * Uses ONLY the `_infra/smoke-test` fixture — an infrastructure-proof
 * fixture, not a Fase B scenario fixture. No browser fixtures beyond this
 * one exist yet; Fase B will add the real scenario fixtures (login-good,
 * login-missing-label, etc.) against this same infrastructure.
 */
async function main() {
  console.log('🧪 Starting fixture infrastructure end-to-end proof (Fase 2.3, Fase A)...\n');

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
    // --- fixture-loader ---
    const fixtures = listFixtures('_infra');
    assert(fixtures.length === 1 && fixtures[0].endsWith('smoke-test.html'), `listFixtures("_infra") encuentra exactamente el fixture esperado (obtenido: ${JSON.stringify(fixtures)})`);

    const fixture = loadFixture('_infra/smoke-test.html');
    assert(fixture.groundTruth.fixture === '_infra/smoke-test.html', 'loadFixture() parsea correctamente el Ground Truth JSON hermano');
    assert(fixture.groundTruth.criteria.length === 1, 'El Ground Truth tiene exactamente 1 criterio definido');

    let threwOnMissingGroundTruth = false;
    try {
      loadFixture('_infra/does-not-exist.html');
    } catch {
      threwOnMissingGroundTruth = true;
    }
    assert(threwOnMissingGroundTruth, 'loadFixture() lanza un error claro para un fixture inexistente (en vez de fallar silenciosamente)');

    // --- attachTestSession + extractCurrentSnapshot (real Playwright) ---
    const evalId = 'fixture-infra-proof';
    await automationService.attachTestSession(evalId, fixture.html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);

    assert(snapshot.buttons.length === 1, 'extractCurrentSnapshot capturó el botón real del fixture');
    assert(snapshot.buttons[0].ariaLabel === 'Cerrar modal', 'El aria-label real se preservó correctamente en la captura');

    // --- DeterministicAnalyzer (real, sin Gemini) ---
    const detFindings = deterministicAnalyzer.analyzeSnapshots([
      {
        iteration: 1,
        url: 'https://fixture.local/_infra/smoke-test.html',
        screenshotPath: '/uploads/fixture.png',
        headings: snapshot.headings,
        images: snapshot.images,
        links: snapshot.links,
        buttons: snapshot.buttons,
        forms: snapshot.forms,
        landmarks: snapshot.landmarks,
        computedStyles: snapshot.computedStyles,
      } as any,
    ]);

    // --- ground-truth-oracle ---
    const report = evaluateGroundTruth(fixture.groundTruth, detFindings as any);
    console.log('  ℹ️  Reporte del oráculo:', JSON.stringify(report, null, 2));

    assert(report.overallPassed === true, 'El oráculo confirma overallPassed=true para el fixture de humo (pipeline completo sin Gemini)');
    assert(report.mustNotAppearViolations.length === 0, 'No hay violaciones de mustNotAppear (no se alucinó un WCAG 2.4.4 sin enlaces)');
    assert(report.duplicateViolations.length === 0, 'No hay findings duplicados por (criterio, selector)');

    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed.`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (e) {
    console.error('❌ Test suite crashed:', e);
    process.exit(1);
  }
}

main();
