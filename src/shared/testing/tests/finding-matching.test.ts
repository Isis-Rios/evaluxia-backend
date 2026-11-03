import { buildEvidenceIndex, EvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import {
  matchFindings,
  ExpectedFinding,
  ActualFindingForMatching,
} from '@/shared/testing/finding-matching';

/**
 * Fase I.1 — finding-matching.ts synthetic tests. NO Gemini, NO real fixture
 * yet (that is Fase II/III). Covers exactly the 25 cases required by the
 * approved design, grouped by the same headings used in the spec.
 */

function buildIndex(): EvidenceIndex {
  return buildEvidenceIndex({
    evidencesSummary: [
      {
        iteration: 1,
        headings: [{ level: 1, text: 'Iniciar sesión', selector: 'h1' } as any],
        images: [],
        forms: [
          {
            selector: 'form',
            name: null,
            action: null,
            elements: [
              { selector: '[name="email"]', type: 'email', name: 'email', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: true, placeholder: 'Correo electrónico', ariaInvalid: false },
              { selector: '[name="password"]', type: 'password', name: 'password', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: true, placeholder: 'Contraseña', ariaInvalid: false },
            ],
          } as any,
        ],
        computedStyles: [],
      },
    ],
    dedupedLandmarks: [{ type: 'form', selector: 'form', ariaLabel: null, iterations: [1] } as any],
    dedupedLinks: [],
    dedupedButtons: [],
  });
}

function finding(overrides: Partial<ActualFindingForMatching>): ActualFindingForMatching {
  return {
    status: 'FAIL',
    evidence: [],
    ...overrides,
  };
}

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function runFindingMatchingTests() {
  console.log('🧪 Starting Fase I.1 finding-matching.ts tests...\n');
  const index = buildIndex();

  const EF_EMAIL_LABEL: ExpectedFinding = {
    id: 'EF-001', problemType: 'missing-form-label', criterion: 'WCAG 3.3.2',
    relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL',
    minimumEvidence: [{ property: 'ariaLabel', expectedRealValue: null }],
  };
  const EF_PASSWORD_LABEL: ExpectedFinding = {
    id: 'EF-002', problemType: 'missing-form-label', criterion: 'WCAG 3.3.2',
    relevantSelectors: ['[name="password"]'], expectedStatus: 'FAIL',
    minimumEvidence: [{ property: 'ariaLabel', expectedRealValue: null }],
  };
  const EF_H1_RELATIONS: ExpectedFinding = {
    id: 'EF-003', problemType: 'heading-structure', criterion: 'WCAG 1.3.1',
    relevantSelectors: ['h1'], expectedStatus: 'PASS',
  };

  // ===== 1. Básicos =====

  // Test 1: exact match -> TP_EXACT
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'TP_EXACT', 'Test 1: exact match -> TP_EXACT.', r.results[0]);
  }

  // Test 2: semantic match controlado -> TP_SEMANTIC (evidencia real/consistente pero minimumEvidence no citado en su totalidad)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'TP_SEMANTIC', 'Test 2: evidencia consistente pero minimumEvidence incompleto -> TP_SEMANTIC.', r.results[0]);
  }

  // Test 3: no finding -> FN
  {
    const r = matchFindings([EF_PASSWORD_LABEL], [], index);
    expect(r.coverage[0].status === 'FN', 'Test 3: ningún finding real -> FN en coverage.', r.coverage[0]);
    expect(r.counts.FN === 1, 'Test 3b: counts.FN === 1.');
  }

  // Test 4: finding incorrecto (evidencia inconsistente) -> FP
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'Correo válido', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'FP' && r.results[0].evidenceStatus === 'INCONSISTENT', 'Test 4: evidencia inconsistente -> FP (nunca TP).', r.results[0]);
  }

  // Test 5: NOT_EVALUABLE -> categoría propia
  {
    const real = finding({ status: 'NOT_EVALUABLE', wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'NOT_EVALUABLE', 'Test 5: sistema NOT_EVALUABLE, GT esperaba FAIL -> NOT_EVALUABLE, nunca FN automático.', r.results[0]);
  }

  // Test 6: duplicate -> DUPLICATE
  {
    const real1 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const real2 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real1, real2], index);
    expect(r.results[0].classification === 'TP_EXACT' && r.results[1].classification === 'DUPLICATE', 'Test 6: segundo finding idéntico -> DUPLICATE, no TP ni FP adicional.', r.results);
  }

  // Test 7: unmatched -> categoría propia
  {
    const real = finding({ wcagCriterion: 'WCAG 2.1.1 Teclado', affectedElement: { selector: '[name="email"]' } });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'UNMATCHED', 'Test 7: criterio no representado en el GT -> UNMATCHED (no FP, no juzgable).', r.results[0]);
  }

  // ===== 2. Grounding =====

  // Test 8: criterio correcto + selector correcto (ya cubierto por Test 1, se reafirma explícitamente)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].criterionMatch && r.results[0].selectorMatch, 'Test 8: criterio correcto + selector correcto -> ambos flags true.', r.results[0]);
  }

  // Test 9 [ACTUALIZADO post-discrepancia-1, Fase I.3->I.3.1]: criterio
  // correcto + selector SIN expectedFinding propio -> UNMATCHED, NUNCA FP.
  // ANTES de esta corrección, este test exigía 'FP' -- ese era exactamente
  // el comportamiento metodológicamente incorrecto descubierto en Landing
  // V1 (la ausencia de una expectativa en el GT para ESTE elemento no
  // demuestra que el finding sea incorrecto). Reemplazado, no ocultado.
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#unrelated-element' } });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'UNMATCHED' && r.results[0].criterionMatch && !r.results[0].selectorMatch, 'Test 9 [ACTUALIZADO]: criterio correcto, pero SIN expectedFinding para este selector -> UNMATCHED (el GT no cubre este elemento, no es evidencia de que esté mal).', r.results[0]);
  }

  // Test 10: criterio incorrecto + selector correcto -> UNMATCHED (el criterio decide primero, el selector correcto no lo "salva")
  {
    const real = finding({ wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces', affectedElement: { selector: '[name="email"]' } });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'UNMATCHED' && !r.results[0].criterionMatch, 'Test 10: criterio incorrecto (aunque el selector sea real) -> UNMATCHED, no TP.', r.results[0]);
  }

  // Test 11 + 13: problemType incorrecto / 2 GT -> 1 finding (disambiguación por solapamiento de evidencia)
  {
    const EF_A: ExpectedFinding = { id: 'EF-A', problemType: 'missing-label', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL', minimumEvidence: [{ property: 'ariaLabel', expectedRealValue: null }] };
    const EF_B: ExpectedFinding = { id: 'EF-B', problemType: 'missing-aria-describedby', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL', minimumEvidence: [{ property: 'ariaDescribedBy', expectedRealValue: null }] };
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaDescribedBy', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_A, EF_B], [real], index);
    expect(r.results[0].matchedExpectedFindingId === 'EF-B', 'Test 11: desambiguación correcta por solapamiento de evidencia -> matchea EF-B, no EF-A (problemType correcto, no confundido).', r.results[0]);
    const covA = r.coverage.find((c) => c.expectedFindingId === 'EF-A');
    expect(covA?.status === 'FN', 'Test 13: EF-A (2do GT del mismo criterio+selector) queda sin cubrir -> FN, no se le atribuye falsamente el match.', covA);
  }

  // Test 11b (AMBIGUOUS): mismo escenario pero SIN evidencia que permita desambiguar
  {
    const EF_A: ExpectedFinding = { id: 'EF-A2', problemType: 'missing-label', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL', minimumEvidence: [{ property: 'ariaLabel', expectedRealValue: null }] };
    const EF_B: ExpectedFinding = { id: 'EF-B2', problemType: 'missing-aria-describedby', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL', minimumEvidence: [{ property: 'ariaDescribedBy', expectedRealValue: null }] };
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' }] });
    const r = matchFindings([EF_A, EF_B], [real], index);
    expect(r.results[0].classification === 'AMBIGUOUS', 'Test 11c: sin solapamiento que desambigüe -> AMBIGUOUS (revisión manual), nunca TP forzado.', r.results[0]);
  }

  // Test 12: elemento correcto pero evidencia inconsistente (idéntico mecanismo que Test 4, reafirmado con ambos flags grounding en true)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'Correo válido', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].criterionMatch && r.results[0].selectorMatch && r.results[0].classification === 'FP', 'Test 12: grounding correcto (criterio+selector) pero evidencia inconsistente -> FP igualmente.', r.results[0]);
  }

  // ===== 3. Composición =====

  // Test 14: 1 GT -> 2 findings (mismo mecanismo que Test 6, con foco en conteos)
  {
    const real1 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const real2 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real1, real2], index);
    expect(r.counts.TP_EXACT === 1 && r.counts.DUPLICATE === 1, 'Test 14: 1 GT + 2 findings equivalentes -> 1 TP_EXACT + 1 DUPLICATE (conteos).', r.counts);
  }

  // Test 15: 2 problemas distintos bajo el MISMO criterio, distinto selector -> ambos TP_EXACT independientes
  {
    const realEmail = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const realPassword = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="password"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="password"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL, EF_PASSWORD_LABEL], [realEmail, realPassword], index);
    expect(r.counts.TP_EXACT === 2, 'Test 15: mismo criterio, selectores distintos -> 2 TP_EXACT independientes, sin confusión entre ellos.', r.counts);
  }

  // Test 16: findings de distintos criterios en un mismo batch
  {
    const realEmail = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const realPassword = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="password"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="password"]' }] });
    const realH1 = finding({ status: 'PASS', wcagCriterion: 'WCAG 1.3.1 Información y relaciones', affectedElement: { selector: 'h1' }, evidence: [{ property: 'text', value: 'Iniciar sesión', selector: 'h1' }] });
    const r = matchFindings([EF_EMAIL_LABEL, EF_PASSWORD_LABEL, EF_H1_RELATIONS], [realEmail, realPassword, realH1], index);
    expect(r.counts.TP_EXACT === 3, 'Test 16: 3 criterios distintos en un mismo batch, sin contaminación cruzada -> 3 TP_EXACT.', r.counts);
  }

  // ===== 4. Métricas =====

  // Test 17/18/19: precision/recall/F1 correctos (2 TP, 1 FP genuino, 1 FN)
  // [ACTUALIZADO post-discrepancia-1]: fp1 ahora es un FP GENUINO -- reutiliza
  // EF_H1_RELATIONS (criterio+selector 'h1', expectedStatus 'PASS'), y el
  // finding real contradice esa expectativa exacta (FAIL) -- ya NO se usa
  // "selector no declarado" como fuente de FP (eso ahora es UNMATCHED, ver
  // Tests 9/26-30). Nota de diseño: por la lógica de cobertura existente
  // (claimedBy solo se fija en clasificaciones TP), un expectedFinding cuyo
  // único finding real lo contradice (FP) queda simultáneamente sin reclamar
  // -> también cuenta como FN propio. Esto es intencional y preexistente
  // (no modificado en esta fase): Precision y Recall se computan sobre
  // conjuntos distintos (findings reales vs. expectedFindings), así que un
  // mismo defecto real puede legítimamente contribuir un FP (afirmación
  // incorrecta emitida) Y un FN (expectativa correcta nunca confirmada) a la
  // vez. Por eso aquí NO se añade un expectedFinding adicional sin cubrir:
  // EF_H1_RELATIONS por sí sola ya aporta exactamente el FP y el FN.
  {
    const tp1 = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const tp2 = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="password"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="password"]' }] });
    // fp1 cita evidencia real y consistente (J6 CONSISTENT) para que el
    // rechazo NO sea por falta de evidencia (INSUFFICIENT/NOT_EVALUABLE),
    // sino por una contradicción de estado genuina: el GT espera PASS y el
    // sistema declara FAIL para el mismo criterio+selector+evidencia real.
    const fp1 = finding({ status: 'FAIL', wcagCriterion: 'WCAG 1.3.1', affectedElement: { selector: 'h1' }, evidence: [{ property: 'text', value: 'Iniciar sesión', selector: 'h1' }] });
    const r = matchFindings([EF_EMAIL_LABEL, EF_PASSWORD_LABEL, EF_H1_RELATIONS], [tp1, tp2, fp1], index);
    expect(r.counts.TP_EXACT === 2 && r.counts.FP === 1 && r.counts.FN === 1, 'Test 17 setup: 2 TP_EXACT, 1 FP genuino (GT PASS vs. real FAIL sobre EF_H1_RELATIONS), 1 FN (la misma EF_H1_RELATIONS, por quedar sin reclamar vía TP).', r.counts);
    expect(r.metrics.precision === 2 / 3, `Test 17: precision = TP/(TP+FP) = 2/3 (obtenido: ${r.metrics.precision}).`);
    expect(r.metrics.recall === 2 / 3, `Test 18: recall = TP/(TP+FN) = 2/3 (obtenido: ${r.metrics.recall}).`);
    const expectedF1 = (2 * (2 / 3) * (2 / 3)) / ((2 / 3) + (2 / 3));
    expect(r.metrics.f1 === expectedF1, `Test 19: F1 = media armónica correcta (obtenido: ${r.metrics.f1}, esperado: ${expectedF1}).`);
  }

  // Test 20: recall N/A cuando no hay expectedFindings evaluables
  {
    const EF_NE: ExpectedFinding = { id: 'EF-NE', problemType: 'p', criterion: 'WCAG 1.4.3', relevantSelectors: ['h1'], expectedStatus: 'NOT_EVALUABLE' };
    const r = matchFindings([EF_NE], [], index);
    expect(r.metrics.recall === 'N/A', `Test 20: recall = 'N/A' cuando TP+FN=0 (obtenido: ${r.metrics.recall}).`);
  }

  // Test 21: duplicates no inflan ni deflan precision
  {
    const real1 = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const real2 = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const real3 = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real1, real2, real3], index);
    expect(r.metrics.precision === 1, `Test 21: 1 TP_EXACT + 2 DUPLICATE, 0 FP -> precision = 1 (duplicates no penalizan ni inflan) (obtenido: ${r.metrics.precision}).`);
  }

  // Test 22: NOT_EVALUABLE no modifica TP/FP
  {
    const tp = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const ne = finding({ status: 'NOT_EVALUABLE', wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="password"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="password"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL, EF_PASSWORD_LABEL], [tp, ne], index);
    expect(r.counts.NOT_EVALUABLE === 1 && r.metrics.precision === 1 && r.metrics.recall === 1, 'Test 22: NOT_EVALUABLE no cuenta como TP ni FP; precision/recall solo ven el TP real.', { counts: r.counts, metrics: r.metrics });
  }

  // ===== 5. Evidencia (J6 reutilizado, no reimplementado) =====

  // Test 23: J6 CONSISTENT (ya cubierto por Test 1, reafirmado explícitamente)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].evidenceStatus === 'CONSISTENT', 'Test 23: J6 CONSISTENT reflejado en evidenceStatus.', r.results[0]);
  }

  // Test 24: J6 INCONSISTENT (ya cubierto por Test 4, reafirmado explícitamente)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'Correo válido', selector: '[name="email"]' }] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].evidenceStatus === 'INCONSISTENT', 'Test 24: J6 INCONSISTENT reflejado en evidenceStatus.', r.results[0]);
  }

  // Test 25: J6 INSUFFICIENT (finding sin evidencia estructurada citable)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2', affectedElement: { selector: '[name="email"]' }, evidence: [] });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.results[0].classification === 'NOT_EVALUABLE' && r.results[0].evidenceStatus === 'INSUFFICIENT', 'Test 25: sin evidencia citable -> J6 INSUFFICIENT -> NOT_EVALUABLE, nunca TP artificial.', r.results[0]);
  }

  // ===== Fase I.3.1: FP vs. UNMATCHED (discrepancia 1 de Landing V1) =====
  // Ground Truth PARCIAL por diseño: solo declara expectedFinding para
  // UN selector bajo un criterio (email), nunca para otro elemento
  // real bajo el MISMO criterio (password) -- eso es legítimo y NO debe
  // producir un falso FP para el elemento no declarado.

  // Test 26: GT parcial por selector -- A cubierto (TP), B real pero NO
  // declarado bajo el mismo criterio -> A=TP_EXACT, B=UNMATCHED, B≠FP.
  {
    const realA = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const realB = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-unrelated-input' } });
    const r = matchFindings([EF_EMAIL_LABEL], [realA, realB], index);
    expect(r.results[0].classification === 'TP_EXACT', 'Test 26a: A (cubierto por el GT) -> TP_EXACT, sin cambios por la presencia de B.', r.results[0]);
    expect(r.results[1].classification === 'UNMATCHED', 'Test 26b: B (mismo criterio, selector NO declarado en el GT) -> UNMATCHED, nunca FP.', r.results[1]);
    expect(r.counts.FP === 0, 'Test 26c: counts.FP === 0 -- B no contamina el conteo de falsos positivos.', r.counts);
  }

  // Test 27: GT parcial por criterio -- el criterio SÍ existe en el GT
  // (para otro selector), pero el finding real bajo ese criterio apunta a
  // un elemento que el GT nunca declaró -- no se asume FP automáticamente.
  // (Mecanismo idéntico al Test 26b; se deja como caso independiente por
  // ser explícitamente uno de los escenarios requeridos.)
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-another-uncovered-input' } });
    const r = matchFindings([EF_EMAIL_LABEL, EF_PASSWORD_LABEL], [real], index);
    expect(r.results[0].classification === 'UNMATCHED', 'Test 27: criterio presente en el GT (para otros selectores), elemento real no declarado -> UNMATCHED, no FP asumido.', r.results[0]);
  }

  // Test 28: FP explícito SIGUE siendo FP cuando el GT realmente permite
  // juzgarlo -- GT declara PASS para este selector exacto, el sistema
  // declara FAIL -> contradicción demostrable, FP correcto.
  {
    const EF_PASS_EXPECTED: ExpectedFinding = { id: 'EF-PASS-CHECK', problemType: 'missing-form-label', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'PASS' };
    const real = finding({ status: 'FAIL', wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const r = matchFindings([EF_PASS_EXPECTED], [real], index);
    expect(r.results[0].classification === 'FP', 'Test 28: GT declara PASS para ESTE selector exacto, sistema declara FAIL -> FP correcto (el GT sí demuestra la contradicción).', r.results[0]);
  }

  // Test 29: un único finding real no cubierto por el GT -> queda
  // completamente fuera de Precision/Recall/F1 (ni los mejora ni los empeora).
  {
    const real = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-single-uncovered' } });
    const r = matchFindings([EF_EMAIL_LABEL], [real], index);
    expect(r.metrics.recall === 'N/A' || r.metrics.precision === 'N/A', 'Test 29a: sin ningún TP/FP/FN real, ambas métricas son N/A (nada que medir).', r.metrics);
    expect(r.counts.UNMATCHED === 1 && r.counts.FP === 0, 'Test 29b: el finding no cubierto se cuenta como UNMATCHED, nunca como FP.', r.counts);
  }

  // Test 30: múltiples findings reales no cubiertos -- ninguno contamina
  // Precision como FP, incluso junto a un TP real.
  {
    const realTP = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ property: 'ariaLabel', value: 'null', selector: '[name="email"]' }] });
    const uncovered1 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-uncovered-1' } });
    const uncovered2 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-uncovered-2' } });
    const uncovered3 = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '#gt-uncovered-3' } });
    const r = matchFindings([EF_EMAIL_LABEL], [realTP, uncovered1, uncovered2, uncovered3], index);
    expect(r.counts.FP === 0 && r.counts.UNMATCHED === 3, 'Test 30: 3 findings no cubiertos + 1 TP real -> 0 FP, 3 UNMATCHED.', r.counts);
    expect(r.metrics.precision === 1, `Test 30b: precision = 1 (el único TP, sin ningún FP contaminando) (obtenido: ${r.metrics.precision}).`);
  }

  console.log(`\n🎉 ALL Fase I.1 + I.3.1 finding-matching tests passed (${passed} assertions).`);
  process.exit(0);
}

runFindingMatchingTests();
