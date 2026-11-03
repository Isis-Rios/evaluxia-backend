import {
  buildEvidenceIndex,
  EvidenceIndex,
  EvidenceKind,
} from '../services/evidence-traceability.service';
import {
  checkClaimConsistency,
  applyClaimConsistency,
} from '../services/evidence-claim-consistency.service';
import { TechnicalEvidenceItemSchema } from '@/modules/ai/contracts/ai.contracts';
import { calculateContrastRatio } from '../services/deterministic-analyzer.service';

/**
 * J6 (Hardening Post-Fase H) — Evidence Claim Consistency tests.
 *
 * Gemini calls: 0. Production changes: 0 (this file only). Mongo: none.
 * Playwright: none. HTTP: none. Fully deterministic.
 */

function buildRealisticIndex(): EvidenceIndex {
  return buildEvidenceIndex({
    evidencesSummary: [
      {
        iteration: 1,
        headings: [{ level: 1, text: 'Iniciar sesión', selector: 'h1' } as any],
        images: [{ selector: 'img.logo', src: 'https://cdn.example.com/logo.png', alt: 'Logo', ariaLabel: null, role: null, isDecorative: false } as any],
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
        computedStyles: [
          { selector: 'button', tag: 'button', text: 'Iniciar sesión', color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(11, 95, 165)', fontSize: '13.3333px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any,
        ],
      },
      // Segunda iteración: MISMO selector ".promo", contenido DISTINTO -> Caso D (ambiguo).
      {
        iteration: 2,
        headings: [],
        images: [],
        forms: [],
        computedStyles: [
          { selector: '.promo', tag: 'span', text: 'Oferta', color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', fontSize: '10px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any,
        ],
      },
      {
        iteration: 3,
        headings: [],
        images: [],
        forms: [],
        computedStyles: [
          { selector: '.promo', tag: 'span', text: 'Oferta distinta', color: 'rgb(9,9,9)', backgroundColor: 'rgb(1,1,1)', fontSize: '20px', fontWeight: '700', lineHeight: 'normal', fontFamily: 'Arial' } as any,
        ],
      },
    ],
    dedupedLandmarks: [{ type: 'form', selector: 'form', ariaLabel: null, iterations: [1] } as any],
    dedupedLinks: [{ selector: 'a.help', text: 'Ayuda', href: '/help', ariaLabel: null, role: null, isExternal: false, iterations: [1] } as any],
    dedupedButtons: [],
  });
}

function buildSyntheticIndex(selector: string, kind: EvidenceKind, record: Record<string, unknown>): EvidenceIndex {
  const index: EvidenceIndex = new Map();
  index.set(selector, {
    selector,
    ambiguous: false,
    occurrences: [{ kind, fingerprint: JSON.stringify(record), iterations: [1], record }],
  });
  return index;
}

/**
 * Builds a test finding, parsing `evidence[]` items through the REAL
 * `TechnicalEvidenceItemSchema` (never reimplemented) so that `value`
 * arrives at `checkClaimConsistency` in EXACTLY the representation Gemini's
 * real output takes after schema parsing (numbers/booleans/null all become
 * strings, `null`→"null") -- see ai.contracts.ts and the docstring in
 * evidence-claim-consistency.service.ts. Raw JS values (number/boolean/
 * null) can be passed directly in `overrides.evidence[].value` here, just
 * like a test author would naturally write them.
 */
function finding(overrides: any): any {
  const rawEvidence = overrides.evidence ?? [];
  const parsedEvidence = rawEvidence.map((item: any) => TechnicalEvidenceItemSchema.parse(item));
  return {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    description: 'test finding',
    recommendation: 'fix it',
    iteration: 1,
    ...overrides,
    evidence: parsedEvidence,
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

function runJ6Tests() {
  console.log('🧪 Starting J6 Evidence Claim Consistency tests...\n');
  const index = buildRealisticIndex();

  // ===== Selector / traceability (1-3) =====
  const f1 = finding({
    affectedElement: { selector: '[name="email"]' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' }],
  });
  expect(checkClaimConsistency(f1, index).overallStatus === 'CONSISTENT', 'Test 1: selector válido → J6 puede evaluar (CONSISTENT).');

  const f2 = finding({
    affectedElement: { selector: '.promo' },
    evidence: [{ type: 'COMPUTED_STYLE', property: 'fontSize', value: '10px', selector: '.promo' }],
  });
  const r2 = checkClaimConsistency(f2, index);
  expect(r2.items[0].status === 'NOT_CHECKABLE' && r2.overallStatus === 'INSUFFICIENT', 'Test 2: selector ambiguo → NOT_CHECKABLE, nunca falso INCONSISTENT.', r2);

  const f3 = finding({
    affectedElement: { selector: '[name="does-not-exist"]' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="does-not-exist"]' }],
  });
  const r3 = checkClaimConsistency(f3, index);
  expect(r3.items[0].status === 'NOT_CHECKABLE', 'Test 3: selector inexistente → NOT_CHECKABLE (J1 sigue siendo la autoridad, J6 no lo re-juzga).', r3);

  // ===== Property (4-6) =====
  const f4 = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(f4, index).items[0].status === 'CONSISTENT', 'Test 4: property válida ("label" en formElement) → CONSISTENT.');

  const f5 = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'randomProperty', value: 'x', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(f5, index).items[0].status === 'PROPERTY_NOT_FOUND', 'Test 5: property inexistente → PROPERTY_NOT_FOUND.');

  const f6 = finding({ affectedElement: { selector: 'button' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'x', selector: 'button' }] });
  expect(checkClaimConsistency(f6, index).items[0].status === 'PROPERTY_NOT_FOUND', 'Test 6: property válida para OTRO tipo (formElement.placeholder) pero no para computedStyle (button) → PROPERTY_NOT_FOUND.');

  // ===== Values (7-17) =====
  const fStrEq = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fStrEq, index).items[0].status === 'CONSISTENT', 'Test 7: string igual → CONSISTENT.');

  const fStrDiff = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Otro texto', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fStrDiff, index).items[0].status === 'INCONSISTENT', 'Test 8: string diferente → INCONSISTENT.');

  const fNumber = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'level', value: 1, selector: 'h1' }] });
  expect(checkClaimConsistency(fNumber, index).items[0].status === 'CONSISTENT', 'Test 9: number (level=1) → CONSISTENT.');
  const fNumberWrong = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'level', value: 2, selector: 'h1' }] });
  expect(checkClaimConsistency(fNumberWrong, index).items[0].status === 'INCONSISTENT', 'Test 9b: number incorrecto (level=2 vs real 1) → INCONSISTENT.');

  const fBoolTrue = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'required', value: true, selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fBoolTrue, index).items[0].status === 'CONSISTENT', 'Test 10: boolean true (required) → CONSISTENT.');
  const fBoolWrong = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'required', value: false, selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fBoolWrong, index).items[0].status === 'INCONSISTENT', 'Test 10b: boolean incorrecto (required=false vs real true) → INCONSISTENT.');

  const fNull = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: null, selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fNull, index).items[0].status === 'CONSISTENT', 'Test 11: null citado === null real (via schema "null" string) → CONSISTENT.');

  // NOTA (descubrimiento durante implementación, no silenciado): el schema
  // real (`TechnicalEvidenceItemSchema`'s superRefine) EXIGE `value` no
  // vacío para type=DOM_ATTRIBUTE -- "property sin value" es un estado
  // literalmente irrepresentable para ese type (Gemini nunca podría emitir
  // eso sin que V2AuditOutputSchema.parse() fallara antes de llegar a J6).
  // Es alcanzable para ACCESSIBILITY_TREE/SCREENSHOT/INTERACTION/
  // HEADING_STRUCTURE, que solo exigen property O value O context.
  const fUndefinedValue = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', selector: 'h1' }] });
  expect(checkClaimConsistency(fUndefinedValue, index).items[0].status === 'NOT_CHECKABLE', 'Test 12: value ausente (property citada sin value, type que sí lo permite) → NOT_CHECKABLE, no CONSISTENT/INCONSISTENT.');

  const fEmptyString = finding({ affectedElement: { selector: 'button' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'lineHeight', value: 'normal', selector: 'button' }] });
  expect(checkClaimConsistency(fEmptyString, index).items[0].status === 'CONSISTENT', 'Test 13 (control string no vacío): sanity check antes del caso "" real.');
  const emptyStrIndex = buildSyntheticIndex('.x', 'computedStyle', { selector: '.x', text: '' });
  // NOTA (descubrimiento durante implementación): el schema exige value NO
  // vacío para COMPUTED_STYLE/DOM_ATTRIBUTE específicamente (isNonEmpty
  // aplica ahí sin importar si property está presente) -- "" es literalmente
  // irrepresentable para esos dos types. Para HEADING_STRUCTURE (y los otros
  // 3 tipos "OR"), property presente ya satisface la validación, así que ""
  // SÍ es alcanzable como value real -- se usa ese type aquí a propósito.
  const fEmpty = finding({ affectedElement: { selector: '.x' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', value: '', selector: '.x' }] });
  expect(checkClaimConsistency(fEmpty, emptyStrIndex).items[0].status === 'CONSISTENT', 'Test 13: string vacío real ("") vs citado "" → CONSISTENT (no colapsado a null).');

  const zeroIndex = buildSyntheticIndex('h2', 'heading', { selector: 'h2', level: 0, text: 'x' });
  const fZero = finding({ affectedElement: { selector: 'h2' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'level', value: 0, selector: 'h2' }] });
  expect(checkClaimConsistency(fZero, zeroIndex).items[0].status === 'CONSISTENT', 'Test 14: 0 real vs citado 0 → CONSISTENT (no tratado como ausente).');

  const falseIndex = buildSyntheticIndex('[name="x"]', 'formElement', { selector: '[name="x"]', required: false });
  const fFalse = finding({ affectedElement: { selector: '[name="x"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'required', value: false, selector: '[name="x"]' }] });
  expect(checkClaimConsistency(fFalse, falseIndex).items[0].status === 'CONSISTENT', 'Test 15: false real vs citado false → CONSISTENT (no tratado como ausente).');

  const arrayIndex = buildSyntheticIndex('.arr', 'computedStyle', { selector: '.arr', fontFamily: ['Arial', 'sans-serif'] as any });
  const fArrayOk = finding({ affectedElement: { selector: '.arr' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'fontFamily', value: JSON.stringify(['Arial', 'sans-serif']), selector: '.arr' }] });
  expect(checkClaimConsistency(fArrayOk, arrayIndex).items[0].status === 'CONSISTENT', 'Test 16: array real === array citado (mismo orden, serializado) → CONSISTENT.');
  const fArrayWrong = finding({ affectedElement: { selector: '.arr' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'fontFamily', value: JSON.stringify(['sans-serif', 'Arial']), selector: '.arr' }] });
  expect(checkClaimConsistency(fArrayWrong, arrayIndex).items[0].status === 'INCONSISTENT', 'Test 16b: array con orden distinto → INCONSISTENT.');

  const objIndex = buildSyntheticIndex('.obj', 'computedStyle', { selector: '.obj', fontFamily: { a: 1, b: 2 } as any });
  // NOTA (límite descubierto durante implementación, documentado en vez de
  // sobre-diseñado): la normalización de "objeto real" ordena SUS PROPIAS
  // claves de forma estable antes de comparar, pero el valor CITADO por
  // Gemini llega como un string opaco (ya coaccionado por el schema) y NO
  // se re-parsea/re-ordena -- comparar contra un JSON citado con claves en
  // OTRO orden fallaría como INCONSISTENT. Ningún campo real de la whitelist
  // es hoy un objeto, así que esto es una limitación conocida y acotada, no
  // un bug en producción; el test usa el MISMO orden de claves para
  // reflejar exactamente lo que la implementación actual soporta.
  const fObjOk = finding({ affectedElement: { selector: '.obj' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'fontFamily', value: JSON.stringify({ a: 1, b: 2 }), selector: '.obj' }] });
  expect(checkClaimConsistency(fObjOk, objIndex).items[0].status === 'CONSISTENT', 'Test 17: objeto real === objeto citado (mismo orden de claves) → CONSISTENT.');

  // ===== Evidencia incompleta (18-21) =====
  // NOTA (mismo descubrimiento que Test 12): DOM_ATTRIBUTE exige property O
  // attribute (schema) -- "sin property" es irrepresentable ahí. Se usa
  // HEADING_STRUCTURE (value presente satisface el OR del schema) para
  // aislar específicamente el caso "sin property" que J6 sí debe manejar.
  const f18 = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', value: 'x', selector: 'h1' }] });
  expect(checkClaimConsistency(f18, index).items[0].status === 'NOT_CHECKABLE', 'Test 18: sin property/attribute → NOT_CHECKABLE.');

  const f19 = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', selector: 'h1' }] });
  expect(checkClaimConsistency(f19, index).items[0].status === 'NOT_CHECKABLE', 'Test 19: sin value cuando no puede determinarse → NOT_CHECKABLE.');

  const f20 = finding({ affectedElement: { selector: '[name="email"]' }, evidence: [] });
  expect(checkClaimConsistency(f20, index).overallStatus === 'INSUFFICIENT', 'Test 20: evidence vacío → INSUFFICIENT (sin items para evaluar).');

  const f21 = finding({ status: 'NOT_EVALUABLE', affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' }] });
  const r21 = checkClaimConsistency(f21, index);
  expect(r21.overallStatus === 'CONSISTENT', 'Test 21: finding NOT_EVALUABLE de entrada → J6 sigue evaluando su evidencia (CONSISTENT aquí), sin alterar el status por sí solo.');

  // ===== Dominios (22-28) =====
  const fWcag = finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fWcag, index).overallStatus === 'CONSISTENT', 'Test 22 (WCAG): finding con wcagCriterion se evalúa igual, agnóstico al dominio.');

  const fNielsen = finding({ heuristicCode: 'N-06', wcagCriterion: undefined, affectedElement: { selector: '[name="email"]' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' }] });
  expect(checkClaimConsistency(fNielsen, index).overallStatus === 'CONSISTENT', 'Test 23 (Nielsen): finding sin wcagCriterion (solo heuristicCode) se evalúa igual.');

  expect(checkClaimConsistency(f1, index).overallStatus === 'CONSISTENT', 'Test 24 (forms/formElement): ya cubierto arriba (Test 1), confirmado de nuevo aquí explícitamente.');

  const fLandmark = finding({ affectedElement: { selector: 'form' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: 'form' }] });
  expect(checkClaimConsistency(fLandmark, index).overallStatus === 'CONSISTENT', 'Test 25 (landmarks): ariaLabel real (null) vs citado null → CONSISTENT.');

  const fHeading = finding({ affectedElement: { selector: 'h1' }, evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', value: 'Iniciar sesión', selector: 'h1' }] });
  expect(checkClaimConsistency(fHeading, index).overallStatus === 'CONSISTENT', 'Test 26 (headings): text real vs citado → CONSISTENT.');

  const fImage = finding({ affectedElement: { selector: 'img.logo' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'srcType', value: 'external-url', selector: 'img.logo' }] });
  expect(checkClaimConsistency(fImage, index).overallStatus === 'CONSISTENT', 'Test 27 (images): srcType DERIVADO (classifySrcType(src)) coincide → CONSISTENT.');
  const fImageWrong = finding({ affectedElement: { selector: 'img.logo' }, evidence: [{ type: 'DOM_ATTRIBUTE', property: 'srcType', value: 'data-uri', selector: 'img.logo' }] });
  expect(checkClaimConsistency(fImageWrong, index).overallStatus === 'INCONSISTENT', 'Test 27b (images): srcType incorrecto citado → INCONSISTENT.');

  const fComputed = finding({ affectedElement: { selector: 'button' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'color', value: 'rgb(255, 255, 255)', selector: 'button' }] });
  expect(checkClaimConsistency(fComputed, index).overallStatus === 'CONSISTENT', 'Test 28 (computedStyles): color real vs citado → CONSISTENT.');

  // ===== contrastRatio derivado (Fase I.3.1, discrepancia 2) (28c-28f) =====
  // contrastRatio NUNCA es una clave literal serializada (a diferencia de
  // image.srcType) -- se recalcula aquí con la MISMA función real
  // (calculateContrastRatio, importada de deterministic-analyzer.service.ts,
  // nunca reimplementada) para que el valor citado en cada test sea
  // exactamente el que produciría analyzeContrast, evitando depender de un
  // número "a mano" que pueda desincronizarse del redondeo real (toFixed(2)).
  const contrastIndex = buildSyntheticIndex('#gt-text-good-contrast', 'computedStyle', {
    selector: '#gt-text-good-contrast', tag: 'p', text: 'x', color: 'rgb(17, 17, 17)', backgroundColor: 'rgb(255, 255, 255)', fontSize: '16px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial',
  });
  const goodRatio = calculateContrastRatio('rgb(17, 17, 17)', 'rgb(255, 255, 255)');
  const fContrastOk = finding({ affectedElement: { selector: '#gt-text-good-contrast' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: `${goodRatio}:1`, selector: '#gt-text-good-contrast' }] });
  expect(checkClaimConsistency(fContrastOk, contrastIndex).overallStatus === 'CONSISTENT', `Test 28c (contrastRatio derivado, correcto): "${goodRatio}:1" citado === recalculado con calculateContrastRatio(color, backgroundColor) → CONSISTENT.`);

  const fContrastWrong = finding({ affectedElement: { selector: '#gt-text-good-contrast' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '1.5:1', selector: '#gt-text-good-contrast' }] });
  expect(checkClaimConsistency(fContrastWrong, contrastIndex).overallStatus === 'INCONSISTENT', 'Test 28d (contrastRatio derivado, incorrecto): valor citado no coincide con el recalculado → INCONSISTENT.');

  // Ausencia de background-color real (color no vacío, backgroundColor
  // vacío) → calculateContrastRatio devuelve null (parseCssColor falla) →
  // el resolver derivado también debe devolver null, SIN fabricar una
  // inconsistencia artificial: el ítem debe degradar a NOT_CHECKABLE/
  // PROPERTY_NOT_FOUND (evidencia no verificable), nunca a INCONSISTENT.
  const noBgIndex = buildSyntheticIndex('.no-bg', 'computedStyle', {
    selector: '.no-bg', tag: 'p', text: 'x', color: 'rgb(17, 17, 17)', backgroundColor: '', fontSize: '16px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial',
  });
  const fContrastNoBg = finding({ affectedElement: { selector: '.no-bg' }, evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '4.5:1', selector: '.no-bg' }] });
  const rContrastNoBg = checkClaimConsistency(fContrastNoBg, noBgIndex);
  expect(rContrastNoBg.items[0].status === 'NOT_CHECKABLE' && rContrastNoBg.overallStatus === 'INSUFFICIENT', 'Test 28e (contrastRatio derivado, sin background real): no calculable → NOT_CHECKABLE/INSUFFICIENT, nunca INCONSISTENT artificial.', rContrastNoBg);

  // Integración: un finding real de analyzeContrast (mismo formato de
  // evidencia que la implementación de producción) debe ser CONSISTENT.
  const prodStyleIndex = buildSyntheticIndex('#gt-text-bad-contrast', 'computedStyle', {
    selector: '#gt-text-bad-contrast', tag: 'p', text: 'Este texto tiene un contraste insuficiente frente al fondo.', color: 'rgb(153, 153, 153)', backgroundColor: 'rgb(255, 255, 255)', fontSize: '16px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'sans-serif',
  });
  const badRatio = calculateContrastRatio('rgb(153, 153, 153)', 'rgb(255, 255, 255)');
  const fRealContrastFinding = finding({
    wcagCriterion: 'WCAG 1.4.3',
    affectedElement: { selector: '#gt-text-bad-contrast' },
    evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: `${badRatio}:1`, selector: '#gt-text-bad-contrast' }],
  });
  expect(checkClaimConsistency(fRealContrastFinding, prodStyleIndex).overallStatus === 'CONSISTENT', `Test 28f (integración, finding real de contraste): "${badRatio}:1" citado tal como lo emitiría analyzeContrast → CONSISTENT.`);

  // ===== Caso real H-REGRESSION-2 (29-31) =====
  const fReal29 = finding({
    affectedElement: { selector: '[name="email"]' },
    evidence: [
      { type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' },
      { type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' },
    ],
  });
  const r29 = checkClaimConsistency(fReal29, index);
  expect(r29.overallStatus === 'CONSISTENT' && r29.items.every((i) => i.status === 'CONSISTENT'), 'Test 29: caso real H-REGRESSION-2 (label=null, placeholder=real) → ambos ítems CONSISTENT.', r29);

  const fReal30 = finding({
    affectedElement: { selector: '[name="email"]' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Correo válido', selector: '[name="email"]' }],
  });
  expect(checkClaimConsistency(fReal30, index).overallStatus === 'INCONSISTENT', 'Test 30: citar ariaLabel="Correo válido" cuando el real es null → INCONSISTENT.');

  const fReal31 = finding({
    affectedElement: { selector: 'form' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'name', value: 'null', selector: 'form' }],
  });
  // 'name' SÍ existe como propiedad real de FormEvidence -- este caso confirma
  // el hallazgo del análisis previo: Gemini citó "name" para el <form> y ESE
  // campo sí existe (valor real null) -- por tanto CONSISTENT, no
  // PROPERTY_NOT_FOUND. Se deja explícito para no repetir la hipótesis de
  // "propiedad fabricada" que el análisis anterior descartó tras verificar
  // el modelo real.
  expect(checkClaimConsistency(fReal31, index).overallStatus === 'CONSISTENT', 'Test 31: "name" en <form> es una propiedad real (FormEvidence.name) -- CONSISTENT, no PROPERTY_NOT_FOUND.');

  const fReal31b = finding({
    affectedElement: { selector: 'form' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'role', value: 'search', selector: 'form' }],
  });
  expect(checkClaimConsistency(fReal31b, index).overallStatus === 'INSUFFICIENT' && checkClaimConsistency(fReal31b, index).items[0].status === 'PROPERTY_NOT_FOUND', 'Test 31b: citar una propiedad que SÍ es inexistente ("role" en form/landmark) → PROPERTY_NOT_FOUND.');

  // ===== Agregación y degradación (bonus, más allá de los 31 mínimos) =====
  const fMixed = finding({
    affectedElement: { selector: '[name="email"]' },
    evidence: [
      { type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' }, // CONSISTENT
      { type: 'DOM_ATTRIBUTE', property: 'randomProperty', value: 'x', selector: '[name="email"]' }, // PROPERTY_NOT_FOUND
    ],
  });
  const rMixed = checkClaimConsistency(fMixed, index);
  expect(rMixed.overallStatus === 'CONSISTENT', 'Test bonus A: un ítem CONSISTENT + un PROPERTY_NOT_FOUND → overall CONSISTENT (no se descarta evidencia válida por otro ítem no verificable).', rMixed);

  const fIncons = finding({
    affectedElement: { selector: '[name="email"]' },
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'Correo válido', selector: '[name="email"]' }],
    status: 'FAIL',
    confidence: 'high',
    recommendation: 'agregar aria-label',
  });
  const { findings: degraded, summary } = applyClaimConsistency([fIncons], index);
  expect(degraded[0].status === 'NOT_EVALUABLE' && degraded[0].confidence === 'low' && degraded[0].recommendation === null, 'Test bonus B: applyClaimConsistency degrada INCONSISTENT a NOT_EVALUABLE/confidence=low/recommendation=null.', degraded[0]);
  expect(summary.inconsistent === 1 && summary.total === 1, 'Test bonus C: summary de applyClaimConsistency refleja el conteo correcto.', summary);

  console.log(`\n🎉 ALL J6 + Fase I.3.1 (contrastRatio) tests passed (${passed} assertions).`);
  process.exit(0);
}

runJ6Tests();
