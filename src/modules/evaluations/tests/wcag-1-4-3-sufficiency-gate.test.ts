import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { auditMetricsService } from '@/modules/evaluations/services/audit-metrics.service';
import { buildEvidenceIndex, EvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { checkClaimConsistency, applyClaimConsistency } from '@/modules/evaluations/services/evidence-claim-consistency.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * P1.7.3.2 — WCAG 1.4.3 Evidence Sufficiency Gate (Gate Rule 0e).
 * Camino REAL completo: `evidenceGateService.processAiFindings()`, sin
 * mocks de la propia regla ni de `computeContrastFailure`
 * (`deterministic-analyzer.service.ts`) -- se reutiliza tal cual.
 * `EvidenceIndex` construido con `buildEvidenceIndex` real en todos los
 * casos que exigen verificar el dato de estilo contra el índice, nunca un
 * índice fabricado a mano que aparente una integración inexistente.
 *
 * Pares de color reales (ratios verificados con la misma fórmula sRGB que
 * `calculateContrastRatio` implementa, calculados independientemente):
 *   rgb(200,200,200) sobre blanco -> 1.67:1 (ya usado en
 *     deterministic-analyzer-forms.test.ts:216, fixture "p.low-contrast")
 *   rgb(130,130,130) sobre blanco -> 3.84:1 (insuficiente bajo el umbral
 *     normal 4.5:1, pero SUFICIENTE bajo el umbral de texto grande 3.0:1)
 *   negro sobre blanco -> 21:1 (contraste máximo, siempre suficiente)
 */

function finding(overrides: Partial<V2AuditFinding> = {}): V2AuditFinding {
  return {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
    description: 'El texto no cumple con la relación de contraste mínima requerida.',
    evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.low-contrast' } as any],
    affectedElement: { tag: 'p', selector: 'p.low-contrast' },
    recommendation: 'Aumentar el contraste entre el texto y el fondo.',
    ...overrides,
  } as any;
}

function buildIndexWithStyle(
  selector: string,
  style: Partial<{ color: string; backgroundColor: string; fontSize: string; fontWeight: string }> = {},
): EvidenceIndex {
  return buildEvidenceIndex({
    evidencesSummary: [
      {
        iteration: 1,
        headings: [],
        images: [],
        forms: [],
        computedStyles: [
          {
            selector,
            tag: 'p',
            text: 'texto de ejemplo',
            color: style.color ?? 'rgb(200,200,200)',
            backgroundColor: style.backgroundColor ?? 'rgb(255,255,255)',
            fontSize: style.fontSize ?? '14px',
            fontWeight: style.fontWeight ?? '400',
            lineHeight: 'normal',
            fontFamily: 'Arial',
          } as any,
        ],
      },
    ],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [],
  });
}

/** Índice con el elemento afectado indexado SOLO como botón (sin computedStyle alguno) -- para el caso "0 ocurrencias computedStyle". */
function buildIndexWithButtonOnly(selector: string): EvidenceIndex {
  return buildEvidenceIndex({
    evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [] }],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [{ selector, tag: 'button', text: 'Enviar', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any],
  });
}

/** Índice con DOS registros computedStyle de contenido distinto para el MISMO selector -- entry.ambiguous = true. */
function buildAmbiguousIndex(selector: string): EvidenceIndex {
  return buildEvidenceIndex({
    evidencesSummary: [
      {
        iteration: 1,
        headings: [],
        images: [],
        forms: [],
        computedStyles: [
          { selector, tag: 'p', text: 'texto A', color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)', fontSize: '14px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any,
          { selector, tag: 'p', text: 'texto B (distinto)', color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', fontSize: '20px', fontWeight: '700', lineHeight: 'normal', fontFamily: 'Arial' } as any,
        ],
      },
    ],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [],
  });
}

async function runTests() {
  console.log('🧪 Starting P1.7.3.2 — WCAG 1.4.3 Evidence Sufficiency Gate (Gate Rule 0e) Adversarial Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ─── 1. Contraste real insuficiente, grounding correcto, estilos válidos -> FAIL se conserva ──
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const [r] = evidenceGateService.processAiFindings([finding()], index);
    assert(r.status === 'FAIL', '1. Ratio real 1.67:1 < umbral 4.5:1, grounding correcto -> FAIL confirmado (Caso A)');
  }

  // ─── 2. Contraste real suficiente -> NOT_EVALUABLE ──────────────────────
  {
    const index = buildIndexWithStyle('p.high-contrast', { color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)' });
    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '2.8:1', selector: 'p.high-contrast' } as any], affectedElement: { tag: 'p', selector: 'p.high-contrast' } });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '2. Ratio real 21:1 >= umbral -> NOT_EVALUABLE pese a que Gemini citó "2.8:1" (Caso B, el dato real contradice la afirmación, nunca se invierte a PASS)');
  }

  // ─── 3. computeContrastFailure devuelve null (color no parseable) -> NOT_EVALUABLE ──
  {
    const index = buildIndexWithStyle('p.unparseable', { color: 'not-a-color', backgroundColor: 'rgb(255,255,255)' });
    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.unparseable' } as any], affectedElement: { tag: 'p', selector: 'p.unparseable' } });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '3. color no parseable -> computeContrastFailure=null -> NOT_EVALUABLE (Caso C)');
  }

  // ─── 4. Resultado inconcluso (fondo con transparencia parcial) -> NOT_EVALUABLE ──
  {
    const index = buildIndexWithStyle('p.translucent-bg', { color: 'rgb(0,0,0)', backgroundColor: 'rgba(255,255,255,0.5)' });
    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '21:1', selector: 'p.translucent-bg' } as any], affectedElement: { tag: 'p', selector: 'p.translucent-bg' } });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '4. Fondo con transparencia parcial -> inconclusive=true -> NOT_EVALUABLE (Caso C)');
  }

  // ─── 5. Ausencia de evidencia contrastRatio -> NOT_EVALUABLE ────────────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'texto de ejemplo', selector: 'p.low-contrast' } as any] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '5. Ningún ítem con property==="contrastRatio" -> NOT_EVALUABLE (Caso D)');
  }

  // ─── 6. Evidencia contrastRatio sin selector propio -> NOT_EVALUABLE ────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1' } as any] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '6. Evidencia "contrastRatio" sin selector explícito -> NOT_EVALUABLE (Caso E -- a diferencia de isStrictlySelfGrounded, esta política NO trata la ausencia como "el propio elemento")');
  }

  // ─── 7. Selector de evidencia contrastRatio de OTRO elemento -> NOT_EVALUABLE ──
  // (caso adversarial exacto de la ronda de diseño: supera Gate Rule 0b por tener
  // OTRO ítem self-grounded, pero el ítem de contraste pertenece a otro elemento real)
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [
        {
          iteration: 1, headings: [], images: [], forms: [],
          computedStyles: [{ selector: '.footer-text', tag: 'p', text: 'footer', color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)', fontSize: '14px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any],
        },
      ],
      dedupedLandmarks: [], dedupedLinks: [],
      dedupedButtons: [{ selector: '.button-primary', tag: 'button', text: 'Guardar', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any],
    });
    const f = finding({
      affectedElement: { tag: 'button', selector: '.button-primary' },
      evidence: [
        { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Guardar', selector: '.button-primary' } as any, // self-grounded -> ya basta para superar la Gate Rule 0b
        { type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: '.footer-text' } as any, // real, pero de OTRO elemento
      ],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '7. La evidencia "contrastRatio" real pertenece a ".footer-text", no a ".button-primary" -> NOT_EVALUABLE (Caso E; confirma que Gate Rule 0b por sí sola NO habría degradado este finding)');
  }

  // ─── 8. Selector document/body como evidencia primaria -> NOT_EVALUABLE ──
  {
    const index = buildIndexWithStyle('body', { color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)' });
    const f = finding({
      affectedElement: { tag: 'p', selector: 'p.low-contrast' },
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'body' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '8. Evidencia "contrastRatio" citada sobre "body" -> NOT_EVALUABLE (Caso E, document/body nunca válidos como evidencia primaria de contraste)');
  }

  // ─── 9. affectedElement.selector ausente -> NOT_EVALUABLE ───────────────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ affectedElement: undefined });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '9. Sin affectedElement.selector -> no hay identidad de elemento que confirmar -> NOT_EVALUABLE (Caso E)');
  }

  // ─── 10. Selectores que normalizan a cadena vacía -> NOT_EVALUABLE ──────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({
      affectedElement: { tag: 'p', selector: '   ' },
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: '   ' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '10. Ambos selectores son solo-espacios (normalizeSelectorForComparison los reduce a "") -> NOT_EVALUABLE (Caso E, verificado el comportamiento real del normalizador)');
  }

  // ─── 11. fontSize ausente / inherit / 0px / NaN -> NOT_EVALUABLE ────────
  {
    const cases: Array<[string, string]> = [['', 'ausente/vacío'], ['inherit', "'inherit'"], ['0px', "'0px'"], ['NaN', "'NaN'"]];
    for (const [fontSize, label] of cases) {
      const index = buildIndexWithStyle('p.bad-fontsize', { fontSize });
      const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.bad-fontsize' } as any], affectedElement: { tag: 'p', selector: 'p.bad-fontsize' } });
      const [r] = evidenceGateService.processAiFindings([f], index);
      assert(r.status === 'NOT_EVALUABLE', `11. fontSize ${label} -> no interpretable -> NOT_EVALUABLE (Caso F), sin usar el default interno de computeContrastFailure`);
    }
  }

  // ─── 12. fontWeight ausente / vacío / inherit -> NOT_EVALUABLE ──────────
  {
    const cases: Array<[string, string]> = [['', 'ausente/vacío'], ['inherit', "'inherit'"]];
    for (const [fontWeight, label] of cases) {
      const index = buildIndexWithStyle('p.bad-fontweight', { fontWeight });
      const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.bad-fontweight' } as any], affectedElement: { tag: 'p', selector: 'p.bad-fontweight' } });
      const [r] = evidenceGateService.processAiFindings([f], index);
      assert(r.status === 'NOT_EVALUABLE', `12. fontWeight ${label} -> no interpretable -> NOT_EVALUABLE (Caso F)`);
    }
  }

  // ─── 13. fontWeight=700, fontSize=20px: interpretables -> se aplica el umbral real (texto grande, 3.0:1) ──
  {
    // Ratio real 3.84:1: INSUFICIENTE bajo el umbral normal (4.5:1) pero
    // SUFICIENTE bajo el umbral de texto grande/negrita (3.0:1) -- si la
    // política ignorara fontSize/fontWeight y asumiera siempre 4.5:1, este
    // caso se conservaría incorrectamente como FAIL.
    const index = buildIndexWithStyle('p.large-bold', { color: 'rgb(130,130,130)', backgroundColor: 'rgb(255,255,255)', fontSize: '20px', fontWeight: '700' });
    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '3.84:1', selector: 'p.large-bold' } as any], affectedElement: { tag: 'p', selector: 'p.large-bold' } });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '13. fontSize=20px + fontWeight=700 (texto grande) -> umbral real 3.0:1; ratio real 3.84:1 >= 3.0:1 -> NOT_EVALUABLE (confirma que se usa el umbral correcto, no siempre 4.5:1)');
  }

  // ─── 14. Entrada EvidenceIndex inexistente -> NOT_EVALUABLE (vía Gate Rule 0/J1, NO vía la rama propia de Rule 0e) ──
  // AUDITORÍA ADVERSARIAL (P1.7.3.2: ADVERSARIAL IMPLEMENTATION AUDIT):
  // `checkFindingTraceability` (Gate Rule 0/J1) ya degrada CUALQUIER
  // `affectedElement.selector` no trazable bajo la MISMA precondición
  // (`evidenceIndex && affectedElement.selector`) que exige Rule 0e para
  // intentar su propia recuperación del registro. Por construcción, cuando
  // Rule 0e llega a consultar `evidenceIndex.get(...)`, Gate Rule 0 YA
  // garantizó que ese selector es trazable -- el chequeo `!entry` dentro de
  // Rule 0e es código defensivo correcto pero, con el orden actual del
  // pipeline, efectivamente INALCANZABLE en la práctica. Este test confirma
  // la INTERACCIÓN correcta con Gate Rule 0 (ya probada en otros archivos,
  // ej. `evidence-audit-engine.test.ts`), NO una rama interna independiente
  // de Rule 0e -- no se afirma lo contrario.
  {
    const index = buildIndexWithStyle('p.some-other-element');
    const f = finding({ affectedElement: { tag: 'p', selector: 'p.never-captured' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.never-captured' } as any] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '14. Selector no trazable -> NOT_EVALUABLE por Gate Rule 0 (J1), ANTES de que Rule 0e pueda intervenir -- confirma la integración, no una rama propia de 0e');
  }

  // ─── 15 y 16. Entrada ambigua Y más de una ocurrencia computedStyle -> NOT_EVALUABLE (vía Gate Rule 0/J1, NO vía Rule 0e) ──
  // AUDITORÍA ADVERSARIAL: `checkFindingTraceability` también degrada
  // cuando `entry.ambiguous === true` (Caso D de J1), bajo la misma
  // precondición -- Gate Rule 0 intercepta este caso ANTES de que Rule 0e
  // llegue a su propio chequeo `entry.ambiguous`. Además, por construcción
  // de `addOccurrence` (evidence-traceability.service.ts), `ambiguous=true`
  // para kind='computedStyle' SOLO ocurre cuando ya existen >=2 ocurrencias
  // de ese mismo kind con contenido distinto -- no es posible construir un
  // caso real donde una condición se dé sin la otra. Este test confirma la
  // interacción con Gate Rule 0, no una rama independiente de Rule 0e.
  {
    const index = buildAmbiguousIndex('p.ambiguous');
    const entry = index.get('p.ambiguous');
    assert(!!entry?.ambiguous, '15/16-precondición: el índice de prueba realmente produce entry.ambiguous=true');
    assert((entry?.occurrences.filter((o) => o.kind === 'computedStyle').length ?? 0) > 1, '15/16-precondición: el índice de prueba realmente produce >1 ocurrencia computedStyle');

    const f = finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.ambiguous' } as any], affectedElement: { tag: 'p', selector: 'p.ambiguous' } });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '15/16. Selector ambiguo -> NOT_EVALUABLE por Gate Rule 0 (J1), ANTES de que Rule 0e pueda intervenir -- confirma la integración, no una rama propia de 0e');
  }

  // ─── Regresión B (sí alcanza la rama propia de Rule 0e): selector trazable vía OTRO tipo de evidencia (botón), pero con 0 ocurrencias computedStyle -> NOT_EVALUABLE ──
  // A diferencia de 14/15-16, Gate Rule 0 (J1) SOLO exige trazabilidad a
  // CUALQUIER tipo de evidencia -- este selector SÍ es trazable (vía
  // "button"), por lo que Gate Rule 0 NO degrada. La degradación observada
  // aquí proviene genuinamente de la comprobación propia de Rule 0e
  // (`computedStyleOccurrences.length !== 1`, con longitud 0).
  {
    const index = buildIndexWithButtonOnly('button.no-style-captured');
    const f = finding({ affectedElement: { tag: 'button', selector: 'button.no-style-captured' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'button.no-style-captured' } as any] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', 'Regresión B. El selector SÍ es trazable (vía "button"), Gate Rule 0 no degrada, pero 0 ocurrencias computedStyle -> NOT_EVALUABLE por la rama propia de Rule 0e');
  }

  // ─── 17. Criterio "WCAG 1.4.3" con prefijo -> política aplicada ─────────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)' });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '17. "WCAG 1.4.3 Contraste (Mínimo)" (con prefijo) -> política aplicada, FAIL confirmado por ratio real insuficiente');
  }

  // ─── 18. Criterio "1.4.3" sin prefijo -> política aplicada ──────────────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ wcagCriterion: '1.4.3 Contraste (Mínimo)' });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '18. "1.4.3 Contraste (Mínimo)" (sin prefijo "WCAG", formato confirmado válido por finding-contracts.test.ts) -> política igualmente aplicada');
  }

  // ─── 19. Código de cuatro partes "1.4.3.1" -> política NO aplicada ──────
  {
    const index = buildIndexWithStyle('p.low-contrast');
    // Evidencia deliberadamente insuficiente (sin contrastRatio) para que,
    // SI la política se aplicara incorrectamente, degradaría a
    // NOT_EVALUABLE -- la prueba demuestra que NO se aplica dejando el FAIL
    // original intacto exactamente como llegó del resto del Gate.
    const f = finding({ wcagCriterion: 'WCAG 1.4.3.1 Variante inexistente', evidence: [] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '19a. "WCAG 1.4.3.1" no coincide con isWcag143 -> Rule 0e no actúa, pero Gate Rule 1 SÍ degrada igualmente por evidencia vacía (sin relación con 0e)');
  }
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({
      wcagCriterion: 'WCAG 1.4.3.1 Variante inexistente',
      evidence: [
        { type: 'DOM_ATTRIBUTE', property: 'text', value: 'texto de ejemplo', selector: 'p.low-contrast' } as any, // self-grounded -> satisface la Gate Rule 0b genérica
        { type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.67:1', selector: 'p.wrong-element-entirely' } as any, // de OTRO elemento -- solo la Rule 0e lo detectaría, SI se aplicara
      ],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '19b. "WCAG 1.4.3.1" -> Rule 0e NO se aplica (código de 4 partes correctamente excluido) -> el FAIL sobrevive pese a que la evidencia de contraste citada es de otro elemento (eso solo lo detectaría 0e si se aplicara; 0b ya está satisfecha por el ítem "text" self-grounded)');
  }

  // ─── 20. Otros criterios y findings que no son FAIL -> sin cambios ──────
  {
    // Ajuste de fixture: el ejemplo original usaba "WCAG 4.1.2" para probar
    // que Rule 0e (exclusiva de 1.4.3) no lo toca. Se usa "WCAG 2.1.1"
    // (sin analizador determinístico propio) para mantener el caso como lo
    // que realmente debe probar: ningún criterio ajeno a 1.4.3 es tocado
    // por Rule 0e.
    const index = buildEvidenceIndex({
      evidencesSummary: [
        { iteration: 1, headings: [], images: [], forms: [], computedStyles: [{ selector: 'p.low-contrast', tag: 'p', text: 'texto', color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)', fontSize: '14px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any] },
      ],
      dedupedLandmarks: [],
      dedupedLinks: [],
      dedupedButtons: [{ selector: 'button.x', tag: 'button', text: 'Enviar', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any],
    });
    const f = finding({
      wcagCriterion: 'WCAG 2.1.1 Teclado',
      description: 'El control no es operable únicamente con teclado.',
      affectedElement: { tag: 'button', selector: 'button.x' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'role', value: 'button', selector: 'button.x' } as any],
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'FAIL', '20a. wcagCriterion="WCAG 2.1.1" (no es 1.4.3) -> Rule 0e no se aplica, FAIL sin cambios');
  }
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ status: 'PASS', evidence: [], recommendation: null });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'PASS' || r.status === 'NOT_EVALUABLE', '20b. status="PASS" sin evidencia -> degradado por Gate Rule 1b (preexistente, sin relación con 0e), nunca por 0e (0e solo actúa sobre FAIL)');
  }
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ status: 'PASS', evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '21:1', selector: 'p.low-contrast' } as any] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'PASS', '20c. status="PASS" con evidencia real -> Rule 0e nunca actúa sobre PASS, permanece PASS sin recalcular nada');
  }
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({ status: 'NOT_EVALUABLE', evidence: [] });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '20d. status="NOT_EVALUABLE" de origen -> Rule 0e nunca actúa (solo opera sobre FAIL), permanece NOT_EVALUABLE');
  }

  // ─── 21. Integración: orden correcto (0e después de 0d, antes de Rule 1) y propagación a métricas ──
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [
        { iteration: 1, headings: [], images: [], forms: [], computedStyles: [{ selector: 'p.low-contrast', tag: 'p', text: 'texto', color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)', fontSize: '14px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any] },
      ],
      dedupedLandmarks: [],
      dedupedLinks: [],
      dedupedButtons: [{ selector: 'button.x', tag: 'button', text: 'Enviar', ariaLabel: 'Enviar', role: 'button', isDisabled: false, isPrimary: true, iterations: [1] } as any],
    });
    const findings: V2AuditFinding[] = [
      finding({ evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '21:1', selector: 'p.low-contrast' } as any] }), // Gemini citó 21:1, el real es 1.67:1 -- igual se confirma FAIL porque el real también es insuficiente
      finding({
        wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
        heuristicCode: undefined,
        heuristicName: undefined,
        status: 'PASS',
        description: 'El botón mantiene un nombre accesible consistente.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Enviar', selector: 'button.x' } as any],
        affectedElement: { tag: 'button', selector: 'button.x' },
        recommendation: null,
      }),
    ];
    const gated = evidenceGateService.processAiFindings(findings, index);
    assert(gated[0].status === 'FAIL', '21a. Ratio real 1.67:1 < 4.5:1 -> FAIL confirmado independientemente del valor citado por Gemini');
    assert(gated[1].status === 'PASS', '21b. El PASS de otro criterio no se ve afectado');

    const metrics = auditMetricsService.calculateMetrics(gated as any);
    assert(metrics.wcagMetrics.failCount >= 1, `21c. La consolidación de métricas cuenta el FAIL de 1.4.3 confirmado, obtenido=${metrics.wcagMetrics.failCount}`);
  }

  // ─── 22. Regresión: Gate Rule 0d (Automation Signal Protection) sigue intacta y se ejecuta ANTES de 0e ──
  {
    const index = buildIndexWithStyle('p.low-contrast');
    const f = finding({
      description: 'Timeout 10000ms exceeded al intentar verificar el contraste del texto.',
      evidence: [], // sin evidencia DOM pertinente -> 0d ya degrada antes de que 0e pueda actuar
    });
    const [r] = evidenceGateService.processAiFindings([f], index);
    assert(r.status === 'NOT_EVALUABLE', '22. Lenguaje de automatización sin evidencia pertinente -> degradado por Gate Rule 0d (sin cambios por P1.7.3.2)');
  }

  // ─── 23. Regresión: sin EvidenceIndex (compatibilidad hacia atrás) -> Rule 0e no se aplica, no lanza excepción ──
  {
    const f = finding();
    const [r] = evidenceGateService.processAiFindings([f]); // sin índice
    assert(r.status === 'FAIL', '23. Sin EvidenceIndex -> Rule 0e no puede verificar nada (requiere evidenceIndex) y no actúa; el finding conserva el status que traía de las reglas anteriores, sin lanzar excepción');
  }

  // ─── 24. Múltiples evidencias "contrastRatio" grounded al mismo elemento, con valores citados distintos ──
  // (P1.7.3.2: TEST COVERAGE COMPLETION, §2) -- separa explícitamente dos
  // capas independientes del pipeline real (`audit-engine.service.ts:261`
  // Rule 0e, luego `:275` applyClaimConsistency/J6 global), SIN afirmar que
  // Rule 0e degrada por la inconsistencia numérica cuando esa degradación
  // ocurre realmente en J6.
  {
    const index = buildIndexWithStyle('p.multi-contrast-citation'); // real: rgb(200,200,200)/blanco -> 1.67:1, umbral 4.5:1 (insuficiente)
    const f = finding({
      affectedElement: { tag: 'p', selector: 'p.multi-contrast-citation' },
      evidence: [
        { type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '3.0:1', selector: 'p.multi-contrast-citation' } as any, // grounded, pero NO coincide con el real (1.67:1)
        { type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '5.0:1', selector: 'p.multi-contrast-citation' } as any, // grounded, TAMPOCO coincide con el real (1.67:1)
      ],
    });

    // Nivel A -- Rule 0e en aislamiento: la decisión depende SOLO del
    // registro real indexado, nunca de cuál de los dos valores citados se
    // use -- ambos son grounded, así que basta con que exista >=1 para que
    // la rama recalcule desde el `record` real.
    const [gatedByRule0e] = evidenceGateService.processAiFindings([f], index);
    assert(gatedByRule0e.status === 'FAIL', '24a. [Nivel A -- Rule 0e] Ratio real 1.67:1 < 4.5:1 -> FAIL confirmado; la decisión NO depende de cuál de los dos valores citados (3.0:1 / 5.0:1) se considere -- ambos son ignorados, solo se usa el registro real');

    // Nivel B -- J6 global (`applyClaimConsistency`, ejecutado DESPUÉS de
    // Rule 0e en el pipeline real) sobre el finding YA procesado por Rule 0e.
    const consistency = checkClaimConsistency(f, index);
    assert(consistency.overallStatus === 'INCONSISTENT', '24b. [Nivel B -- J6] checkClaimConsistency detecta que AMBOS valores citados (3.0:1, 5.0:1) son INCONSISTENT contra el real (1.67:1)');

    const { findings: [afterJ6] } = applyClaimConsistency([gatedByRule0e], index);
    assert(afterJ6.status === 'NOT_EVALUABLE', '24c. [Nivel B -- J6] El resultado FINAL posterior a applyClaimConsistency es NOT_EVALUABLE -- esta degradación es responsabilidad de J6, NO de Rule 0e (0e por sí sola había confirmado FAIL en 24a)');
  }

  // ─── 25. Cita incorrecta con incumplimiento real: Rule 0e confirma FAIL; J6 posterior degrada por la cita falsa ──
  // (P1.7.3.2: TEST COVERAGE COMPLETION, §3) -- caso explícito e
  // independiente, antes solo cubierto incidentalmente dentro del test 21a.
  {
    const index = buildIndexWithStyle('p.wrong-citation-real-fail'); // real: rgb(200,200,200)/blanco -> 1.67:1, umbral 4.5:1
    const f = finding({
      affectedElement: { tag: 'p', selector: 'p.wrong-citation-real-fail' },
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '21:1', selector: 'p.wrong-citation-real-fail' } as any], // Gemini cita "21:1" (sugiere contraste máximo), el real es 1.67:1
    });

    // 1. Rule 0e conserva FAIL porque el contraste REAL (1.67:1) incumple el umbral real (4.5:1) -- nunca lee el valor citado.
    const [gatedByRule0e] = evidenceGateService.processAiFindings([f], index);
    assert(gatedByRule0e.status === 'FAIL', '25a. Rule 0e conserva FAIL: ratio real 1.67:1 < umbral real 4.5:1, independientemente de que Gemini citó "21:1"');

    // 2. J6 detecta la inconsistencia de la evidencia citada ("21:1" != "1.67:1" real).
    const consistency = checkClaimConsistency(f, index);
    assert(consistency.overallStatus === 'INCONSISTENT', '25b. checkClaimConsistency (J6) detecta que "21:1" citado no coincide con el real "1.67:1" -> INCONSISTENT');

    // 3. Resultado final posterior a J6, confirmado contra el código real (audit-engine.service.ts: Rule 0e en processAiFindings línea 261, applyClaimConsistency línea 275).
    const { findings: [afterJ6] } = applyClaimConsistency([gatedByRule0e], index);
    assert(afterJ6.status === 'NOT_EVALUABLE', '25c. El resultado FINAL del pipeline completo (Rule 0e + J6 posterior) es NOT_EVALUABLE -- Rule 0e había confirmado FAIL (25a) por motivos correctos (umbral real incumplido), pero J6 degrada por separado al detectar la cita numérica falsa; ambas capas son independientes y ninguna se atribuye el mérito de la otra');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
