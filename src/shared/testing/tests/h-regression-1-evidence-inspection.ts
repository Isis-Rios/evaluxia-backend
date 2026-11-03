import { automationService } from '@/modules/automation/automation.service';
import { loadFixture } from '@/shared/testing/fixture-loader';

/**
 * Diagnóstico local, sin Gemini: reconstruye determinísticamente la MISMA
 * evidencia que se capturó y envió en H-REGRESSION-1 (mismo fixture, misma
 * lógica de captura, sin cambios desde entonces) — para inspeccionar
 * exactamente qué datos tenía Gemini disponibles para los findings N-06/N-04.
 */
async function main() {
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-1-inspection';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);
  console.log('FORMS:', JSON.stringify(snapshot.forms, null, 2));
  console.log('BUTTONS:', JSON.stringify(snapshot.buttons, null, 2));
  console.log('HEADINGS:', JSON.stringify(snapshot.headings, null, 2));
  console.log('COMPUTED STYLES:', JSON.stringify(snapshot.computedStyles, null, 2));
  console.log('LANDMARKS:', JSON.stringify(snapshot.landmarks, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
