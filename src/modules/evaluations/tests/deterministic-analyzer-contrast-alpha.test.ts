import {
  parseCssColor,
  getSRGBColorLuminance,
  calculateContrastRatio,
  computeContrastFailure,
} from '@/modules/evaluations/services/deterministic-analyzer.service';

/**
 * P1.1 — regression + new-behavior tests for alpha-aware contrast
 * calculation, motivated by the real incident in evaluation
 * `6ae15b04ce94179ae8ad199b` (`#desktopToggle`): `rgba(33,40,50,0.5)` text
 * over `rgba(33,40,50,0.2)` background was previously reported as a
 * degenerate "1:1" because the old `parseCssColor` discarded the alpha
 * channel entirely, making both colors parse to the identical {r,g,b}.
 *
 * Gemini calls: 0. Pure function tests, no network, no DB.
 */
function main() {
  console.log('🧪 Starting P1.1 — alpha-aware contrast calculation tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // -----------------------------------------------------------------
  // 1. Colores opacos con ratio conocido -- REGRESIÓN, debe ser
  // byte-idéntico al comportamiento anterior a este fix. Caso real
  // verificado en la auditoría: a:nth-of-type(2) de la misma evaluación.
  // -----------------------------------------------------------------
  console.log('--- Caso 1: colores opacos (regresión, sin cambios) ---');
  {
    const ratio = calculateContrastRatio('rgb(220, 57, 45)', 'rgb(240, 227, 231)');
    assert(ratio === 3.61, `Opaco/opaco real (rgb(220,57,45) sobre rgb(240,227,231)) sigue dando 3.61:1 exacto (obtenido: ${ratio})`);

    const failure = computeContrastFailure({ color: 'rgb(220, 57, 45)', backgroundColor: 'rgb(240, 227, 231)', fontSize: '16px', fontWeight: '400' });
    assert(!!failure && !failure.inconclusive && failure.ratio === 3.61 && failure.minRequiredRatio === 4.5, 'computeContrastFailure: opaco/opaco -- determinable, umbral 4.5 para texto normal, sin cambios');
  }

  // -----------------------------------------------------------------
  // 2. Alfa parcial en el PRIMER PLANO con fondo efectivo CONOCIDO
  // (fondo opaco) -- caso nuevo que el fix SÍ puede resolver de forma
  // honesta, verificado independientemente componiendo a mano con las
  // mismas primitivas exportadas (no se reimplementa la fórmula desde
  // cero, pero tampoco se confía ciegamente en la función bajo prueba).
  // -----------------------------------------------------------------
  console.log('\n--- Caso 2: alfa parcial en texto, fondo opaco conocido -> ratio definitivo ---');
  {
    const fgRaw = 'rgba(0, 0, 0, 0.5)'; // negro 50% opacidad
    const bgRaw = 'rgb(255, 255, 255)'; // blanco opaco
    const ratio = calculateContrastRatio(fgRaw, bgRaw);

    // Verificación independiente: blend manual (mismo álgebra documentada)
    // + las mismas primitivas de luminancia/ratio ya exportadas.
    const blended = { r: 0 * 0.5 + 255 * 0.5, g: 0 * 0.5 + 255 * 0.5, b: 0 * 0.5 + 255 * 0.5 };
    const lFg = getSRGBColorLuminance(blended.r, blended.g, blended.b);
    const lBg = getSRGBColorLuminance(255, 255, 255);
    const expected = parseFloat(((Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05)).toFixed(2));

    assert(ratio !== null, 'Texto translúcido sobre fondo opaco produce un ratio DEFINITIVO (no null)');
    assert(ratio === expected, `Ratio coincide con el blend manual independiente (obtenido ${ratio}, esperado ${expected})`);
    assert(!!ratio && ratio > 1, 'El ratio no es el degenerado 1:1 que producía el código anterior (alfa ignorada)');
  }

  // -----------------------------------------------------------------
  // 3. Alfa parcial en AMBOS colores (fondo con transparencia parcial) --
  // reproducción EXACTA del incidente real. El fondo efectivo es
  // desconocido -- debe ser no concluyente, nunca un ratio inventado ni
  // un FAIL.
  // -----------------------------------------------------------------
  console.log('\n--- Caso 3: fondo con transparencia parcial -> no concluyente (incidente real) ---');
  {
    const fgRaw = 'rgba(33, 40, 50, 0.5)';
    const bgRaw = 'rgba(33, 40, 50, 0.2)';

    const ratio = calculateContrastRatio(fgRaw, bgRaw);
    assert(ratio === null, 'calculateContrastRatio devuelve null (fondo efectivo desconocido, no se inventa)');
    assert(ratio !== 1, 'Ya NO reproduce el "1:1" engañoso del incidente real');

    const failure = computeContrastFailure({ color: fgRaw, backgroundColor: bgRaw, fontSize: '16px', fontWeight: '400' });
    assert(failure !== null, 'computeContrastFailure SÍ reporta algo (no desaparece silenciosamente) cuando hay un fondo declarado, aunque sea no concluyente');
    assert(!!failure && failure.inconclusive === true && failure.ratio === null, 'El resultado se marca explícitamente como inconclusive, con ratio null (no un número inventado)');
    assert(!!failure && failure.inconclusive && typeof failure.reason === 'string' && failure.reason.length > 0, 'El resultado inconcluso incluye una razón legible (no solo un flag booleano)');
  }

  // -----------------------------------------------------------------
  // 4. Fondo totalmente transparente (alpha=0) -- comportamiento YA
  // existente, debe seguir sin generar ningún resultado (ni finding ni
  // "inconclusive" explícito) -- sin cambios respecto a antes del fix.
  // -----------------------------------------------------------------
  console.log('\n--- Caso 4: fondo totalmente transparente -> sin cambios (null, no "inconclusive") ---');
  {
    const failure = computeContrastFailure({ color: 'rgb(0,0,0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', fontWeight: '400' });
    assert(failure === null, 'Fondo totalmente transparente sigue devolviendo null directamente (comportamiento preexistente intacto)');
  }

  // -----------------------------------------------------------------
  // 5. Umbral WCAG según tamaño/peso de fuente -- regresión, sin cambios.
  // -----------------------------------------------------------------
  console.log('\n--- Caso 5: umbrales de texto normal vs. grande/negrita (regresión) ---');
  {
    const normal = computeContrastFailure({ color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', fontSize: '16px', fontWeight: '400' });
    assert(!!normal && !normal.inconclusive && normal.minRequiredRatio === 4.5, 'Texto normal (16px/400) exige 4.5:1');

    const large = computeContrastFailure({ color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', fontSize: '24px', fontWeight: '400' });
    assert(!!large && !large.inconclusive && large.minRequiredRatio === 3.0, 'Texto grande (24px) exige 3.0:1');

    const bold = computeContrastFailure({ color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', fontSize: '19px', fontWeight: '700' });
    assert(!!bold && !bold.inconclusive && bold.minRequiredRatio === 3.0, 'Texto 19px negrita (>=18.5px bold) exige 3.0:1');
  }

  // -----------------------------------------------------------------
  // 6. parseCssColor expone alfa correctamente (unit básica de la
  // primitiva que hizo posible todo lo anterior).
  // -----------------------------------------------------------------
  console.log('\n--- Caso 6: parseCssColor expone el canal alfa ---');
  {
    assert(parseCssColor('rgba(33, 40, 50, 0.5)')?.a === 0.5, 'parseCssColor captura alfa=0.5 de una rgba() explícita');
    assert(parseCssColor('rgb(33, 40, 50)')?.a === 1, 'parseCssColor asume alfa=1 para rgb() sin canal alfa (opaco por defecto)');
    assert(parseCssColor('rgba(33, 40, 50, 0)')?.a === 0, 'parseCssColor captura alfa=0 (totalmente transparente)');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main();
