import { auditMetricsService, InputAuditFinding } from '../services/audit-metrics.service';

/**
 * Fase K (Parte H) -> Fase K.1 (Parte C): identidad de elementos entre
 * iteraciones.
 *
 * Fase K confirmó el riesgo: un selector posicional (`nth-of-type`) es
 * ÚNICO dentro de UN snapshot, pero nada garantiza que la MISMA string de
 * selector señale al MISMO elemento real entre iteraciones si el DOM
 * cambió. `AuditMetricsService.deduplicateFindings` agrupaba
 * exclusivamente por `criterioNormalizado_selector` (string), sin ninguna
 * verificación -- a diferencia de J1 (Caso D), que SÍ detecta esto para
 * findings de IA vía el EvidenceIndex.
 *
 * Fase K.1 implementa una corrección LOCAL (sin EvidenceIndex externo,
 * sin rediseño): cuando dos findings con la misma clave, de iteraciones
 * DISTINTAS, citan evidencia para la MISMA propiedad con valores
 * DISTINTOS, eso es una contradicción demostrable con los datos YA
 * presentes en el propio array -- se trata como señal de identidad
 * incierta y NO se fusionan silenciosamente (ver
 * `hasCrossIterationEvidenceConflict`, audit-metrics.service.ts).
 *
 * [ACTUALIZADO K.1.1, Parte B]: K.1 dejó un límite honesto sin resolver --
 * si ambos lados citan propiedades DISTINTAS (sin superposición), el
 * sistema no podía demostrar divergencia, y fusionaba SIN avisar que la
 * identidad combinada nunca fue confirmada. K.1.1 cierra esa brecha de
 * VISIBILIDAD (no de fusión): `hasUnprovenCrossIterationIdentity` marca
 * `crossIterationIdentityUncertain=true` en ese caso también -- la fusión
 * sigue ocurriendo (fragmentar rompería el caso común y legítimo de
 * evidencia ausente en un lado), pero YA NUNCA se presenta con una certeza
 * que los datos no respaldan. Ver Escenario 2b y la matriz B1/B2 abajo.
 *
 * Gemini calls: 0.
 */

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function runSelectorStabilityTest() {
  console.log('🧪 Starting cross-iteration identity (Fase K.1, Parte C) tests...\n');

  // Escenario 1 (CORREGIDO): ambos findings citan la MISMA propiedad
  // ("text") con valores DISTINTOS para el mismo selector -- contradicción
  // demostrable. `div:nth-of-type(3)` era "Guardar" en iteración 1 y
  // "Eliminar" en iteración 2 -- evidencia real de que son elementos
  // DISTINTOS, no el mismo botón cambiando de estado.
  {
    const iter1: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
      description: 'El botón <div:nth-of-type(3)> posee un nombre accesible: "Guardar".',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'div:nth-of-type(3)' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Guardar', selector: 'div:nth-of-type(3)' }],
      iteration: 1, origin: 'deterministic',
    };
    const iter2: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
      description: 'El botón <div:nth-of-type(3)> posee un nombre accesible: "Eliminar".',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'div:nth-of-type(3)' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Eliminar', selector: 'div:nth-of-type(3)' }],
      iteration: 2, origin: 'deterministic',
    };
    const result = auditMetricsService.deduplicateFindings([iter1, iter2]);
    expect(result.length === 2, 'Escenario 1 (CORREGIDO): misma propiedad ("text"), valores distintos ("Guardar" vs "Eliminar") entre iteraciones -> NO se fusionan, quedan como 2 findings consolidados separados.', result);
    const uncertain = result.find((r) => r.crossIterationIdentityUncertain === true);
    expect(uncertain !== undefined && uncertain.iteration === 2, 'Escenario 1b: el finding de la iteración en conflicto queda marcado explícitamente con crossIterationIdentityUncertain=true (nunca oculto).', uncertain);
    expect(result.some((r) => r.description.includes('Guardar')) && result.some((r) => r.description.includes('Eliminar')), 'Escenario 1c: ambas descripciones reales se preservan íntegras (ninguna se pierde ni se sobrescribe).', result.map((r) => r.description));
  }

  // Escenario 2 [ACTUALIZADO K.1.1, Parte B]: propiedades DISTINTAS citadas
  // en cada iteración ("text" vs "ariaLabel") -- sin superposición
  // comparable, el sistema SIGUE sin poder demostrar divergencia (no
  // bloquea la fusión -- fragmentar aquí rompería el caso común y legítimo
  // de evidencia simplemente ausente en un lado). PERO, a diferencia de
  // K.1, la identidad combinada ahora se marca explícitamente como NUNCA
  // confirmada (`crossIterationIdentityUncertain=true`) -- ni refutada
  // (no hay conflicto) ni corroborada (no hay superposición). Responde
  // directamente la pregunta B2: la consolidación SÍ puede combinar
  // evidencia de dos elementos potencialmente distintos bajo un único
  // finding -- pero ya NUNCA lo presenta con una certeza que los datos no
  // respaldan.
  {
    const iter1: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
      description: 'El botón <div:nth-of-type(3)> posee un nombre accesible: "Guardar".',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'div:nth-of-type(3)' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Guardar', selector: 'div:nth-of-type(3)' }],
      iteration: 1, origin: 'deterministic',
    };
    const iter2: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'El botón <div:nth-of-type(3)> carece de nombre accesible.',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'div:nth-of-type(3)' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: 'div:nth-of-type(3)' }],
      iteration: 2, origin: 'deterministic',
    };
    const result = auditMetricsService.deduplicateFindings([iter1, iter2]);
    expect(result.length === 1, 'Escenario 2: propiedades distintas citadas ("text" vs "ariaLabel") -> sin superposición comparable, se fusionan (fragmentar rompería el caso común de evidencia ausente en un lado).', result);
    expect(result[0].crossIterationIdentityUncertain === true, 'Escenario 2b [NUEVO K.1.1]: la fusión SIN superposición comparable ahora se marca crossIterationIdentityUncertain=true -- la identidad combinada nunca fue confirmada, y eso ya no se oculta.', result[0]);
  }

  // K.1.1 Parte B1/B2: matriz adversarial explícita con el ejemplo literal
  // del pedido (ariaLabel="Guardar" en iteración 1, href="/otra-ruta" en
  // iteración 2, MISMO selector X, MISMO criterio). Pregunta B2: ¿puede la
  // consolidación combinar evidencia de dos elementos distintos y
  // presentarla como si fuera uno? Respuesta demostrada: SÍ puede
  // combinarla (no se puede demostrar que NO sean el mismo elemento con
  // estos datos) -- pero ya NUNCA lo hace con falsa certeza
  // (crossIterationIdentityUncertain=true, ver Escenario 2b). No se
  // requiere resolver identidad completa (B3): la corrección mínima es
  // visibilidad, no bloqueo universal.
  {
    const iter1: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
      description: 'El control X posee un nombre accesible: "Guardar".',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'X' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Guardar', selector: 'X' }],
      iteration: 1, origin: 'deterministic',
    };
    const iter2: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high',
      description: 'El control X enlaza a "/otra-ruta".',
      wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
      affectedElement: { selector: 'X' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'href', value: '/otra-ruta', selector: 'X' }],
      iteration: 2, origin: 'deterministic',
    };
    const result = auditMetricsService.deduplicateFindings([iter1, iter2]);
    expect(result.length === 1 && result[0].crossIterationIdentityUncertain === true, 'B1/B2 (ejemplo literal del pedido): ariaLabel="Guardar" (iter 1) + href="/otra-ruta" (iter 2), mismo selector X -> se combinan en 1 finding, marcado explícitamente como identidad NO confirmada (ni A+A ni A+B puede distinguirse con estos datos -- B4 satisfecho: nunca se presenta como certeza falsa).', result[0]);
  }

  // Escenario 3 (NO REGRESIÓN): mismo selector, misma iteración registrada
  // dos veces con evidencia CONSISTENTE (mismo valor) -> sigue fusionando
  // normalmente, sin falsos positivos de "identidad incierta".
  {
    const iter1a: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'Contraste insuficiente', wcagCriterion: 'WCAG 1.4.3',
      affectedElement: { selector: '#p1' },
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '2.1:1', selector: '#p1' }],
      iteration: 1, origin: 'deterministic',
    };
    const iter2a: InputAuditFinding = { ...iter1a, iteration: 2 };
    const result = auditMetricsService.deduplicateFindings([iter1a, iter2a]);
    expect(result.length === 1 && result[0].crossIterationIdentityUncertain === undefined, 'Escenario 3 (no regresión): evidencia CONSISTENTE entre iteraciones -> fusiona normalmente, sin marcar identidad incierta.', result);
  }

  console.log(`\n🎉 Cross-iteration identity tests completados (${passed} aserciones: K.1 conflicto demostrable + K.1.1 visibilidad de identidad no confirmada + no-regresión).`);
  process.exit(0);
}

runSelectorStabilityTest();
