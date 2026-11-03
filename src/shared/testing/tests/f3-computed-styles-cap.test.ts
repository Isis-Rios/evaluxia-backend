import { automationService } from '@/modules/automation/automation.service';
import { buildStyledElementsHtml } from '@/shared/testing/stress-generators';

/**
 * Fase F — F3: Volumen extremo de computedStyles. A diferencia del plan
 * original (que asumía crecimiento sin control), la inspección del código
 * real (automation.service.ts) reveló que la captura de computedStyles YA
 * está acotada a los primeros 50 elementos en orden de DOM
 * (`querySelectorAll(...).slice(0, 50)`), confirmado también por T5. F3
 * reformula el riesgo: no es "crecimiento sin límite", sino "¿qué se
 * pierde silenciosamente cuando el elemento realmente importante (ej. un
 * CTA) queda fuera de los primeros 50?" — un riesgo de FALSO NEGATIVO de
 * captura, no de payload.
 *
 * AISLADA: un solo factor (posición del CTA relativo al tope de 50).
 *
 * PREDICCIÓN ANTES DE EJECUTAR: con N=500 párrafos + 1 CTA real,
 * `computedStyles.length` debe ser SIEMPRE 50 (nunca 51, nunca menos) sin
 * importar dónde esté el CTA; el CTA debe APARECER en la lista cuando está
 * en posición <50, y estar AUSENTE cuando está en posición >50 — el propio
 * elemento sigue existiendo en el DOM (capturable vía `links`/`buttons`),
 * solo su ENTRADA de computedStyles se pierde.
 */
async function measureCase(n: number, ctaPosition: 'within-cap' | 'beyond-cap') {
  const evalId = `f3-${ctaPosition}-${n}`;
  const html = buildStyledElementsHtml(n, ctaPosition);
  await automationService.attachTestSession(evalId, html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);
  return snapshot;
}

async function main() {
  console.log('🧪 Starting F3 — computedStyles Cap & Silent-Loss Risk (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const N = 500;

  const withinCap = await measureCase(N, 'within-cap');
  console.log(`  ℹ️  CTA en posición temprana (dentro del tope): computedStyles.length=${withinCap.computedStyles.length}`);
  assert(withinCap.computedStyles.length === 50, `El tope real de 50 se confirma a escala extrema (N=${N} párrafos candidatos): computedStyles.length=${withinCap.computedStyles.length}`);
  const ctaStyleWithin = withinCap.computedStyles.find((s) => s.selector.includes('cta') || s.tag === 'button');
  assert(!!ctaStyleWithin, 'Cuando el CTA está entre los primeros 50 elementos en orden de DOM, SÍ aparece en computedStyles (su estilo visual es evaluable)');

  const beyondCap = await measureCase(N, 'beyond-cap');
  console.log(`  ℹ️  CTA en posición tardía (más allá del tope): computedStyles.length=${beyondCap.computedStyles.length}`);
  assert(beyondCap.computedStyles.length === 50, `El tope se mantiene en 50 incluso cuando el elemento relevante queda excluido: computedStyles.length=${beyondCap.computedStyles.length}`);
  const ctaStyleBeyond = beyondCap.computedStyles.find((s) => s.selector.includes('cta') || s.tag === 'button');
  assert(!ctaStyleBeyond, 'GAP CONFIRMADO: cuando el CTA queda más allá de la posición 50 en el DOM, su computedStyle NO se captura — pérdida silenciosa, no reportada por ningún mecanismo');

  // El elemento sigue existiendo y siendo capturado por OTRAS vías
  // (buttons) — confirma que la pérdida es específica de computedStyles,
  // no una desaparición general del elemento de toda la evidencia.
  const ctaAsButton = beyondCap.buttons.find((b) => b.ariaLabel === 'Comprar ahora');
  assert(!!ctaAsButton, 'El mismo CTA SÍ aparece en `buttons` (nombre accesible evaluable) aunque su computedStyle se haya perdido — la pérdida es acotada a un tipo de evidencia, no total');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
