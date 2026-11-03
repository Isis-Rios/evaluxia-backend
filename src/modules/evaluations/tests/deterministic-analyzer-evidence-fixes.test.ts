import { deterministicAnalyzer } from '../services/deterministic-analyzer.service';
import { inferFormControlTag } from '../services/deterministic-analyzer.service';

/**
 * [Revisión MVP, post-evaluación real `6ad2eddad9fe70084f43d58d`] Dos
 * correcciones P2 en `deterministic-analyzer.service.ts`:
 *   1. `analyzeLinks` (WCAG 2.4.4) ahora persiste `text`/`ariaLabel` además
 *      de `href` -- el dato que realmente sustenta PASS/FAIL, antes nunca
 *      adjuntado como evidencia.
 *   2. `analyzeForms` (WCAG 3.3.2) usa el tag HTML real (`input`/`select`/
 *      `textarea`) en vez del atributo `type` (`<text>`/`<email>`).
 * Gemini calls: 0. Todo determinístico.
 */

function snapshot(overrides: any = {}) {
  return {
    iteration: 1,
    url: 'https://fixture.local/evidence-fixes-test',
    screenshotPath: '/x.png',
    headings: [],
    images: [],
    links: [],
    buttons: [],
    forms: [],
    landmarks: [],
    computedStyles: [],
    ...overrides,
  };
}

function linkElement(overrides: any) {
  return {
    selector: 'a', text: '', href: 'https://example.com', ariaLabel: null, role: null, isExternal: false,
    ...overrides,
  };
}

function formElement(overrides: any) {
  return {
    selector: '[name="x"]', type: 'text', name: 'x', label: null, ariaLabel: null,
    ariaLabelledBy: null, ariaDescribedBy: null, required: false, placeholder: null, ariaInvalid: false,
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

function linkFindingFor(findings: any[], selector: string) {
  return findings.find((f) => f.affectedElement?.selector === selector && f.wcagCriterion === 'WCAG 2.4.4 Propósito de los enlaces');
}

function runTests() {
  console.log('🧪 Starting Revisión MVP — analyzeLinks evidence + analyzeForms tag fixes...\n');

  // ===========================================================================
  // inferFormControlTag — función pura
  // ===========================================================================
  expect(inferFormControlTag('text') === 'input', 'inferFormControlTag("text") -> "input"');
  expect(inferFormControlTag('email') === 'input', 'inferFormControlTag("email") -> "input"');
  expect(inferFormControlTag('tel') === 'input', 'inferFormControlTag("tel") -> "input"');
  expect(inferFormControlTag('select-one') === 'select', 'inferFormControlTag("select-one") -> "select"');
  expect(inferFormControlTag('select-multiple') === 'select', 'inferFormControlTag("select-multiple") -> "select"');
  expect(inferFormControlTag('textarea') === 'textarea', 'inferFormControlTag("textarea") -> "textarea"');
  expect(inferFormControlTag(null) === 'input', 'inferFormControlTag(null) -> "input" (default seguro)');

  // ===========================================================================
  // analyzeForms — affectedElement.tag y descripción usan el tag real
  // ===========================================================================
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '[name="email"]', type: 'email' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findings.find((x: any) => x.affectedElement?.selector === '[name="email"]');
    expect(f?.affectedElement?.tag === 'input', '[CORRECCIÓN] input type="email" -> affectedElement.tag="input" (antes: "email")', f?.affectedElement);
    expect(!!f?.description.includes('<input>') && !f?.description.includes('<email>'), '[CORRECCIÓN] la descripción usa <input>, nunca <email>', f?.description);
  }
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: 'select', type: 'select-one' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findings.find((x: any) => x.affectedElement?.selector === 'select');
    expect(f?.affectedElement?.tag === 'select', '[CORRECCIÓN] <select> -> affectedElement.tag="select" (antes: "select-one")', f?.affectedElement);
  }
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: 'textarea', type: 'textarea' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findings.find((x: any) => x.affectedElement?.selector === 'textarea');
    expect(f?.affectedElement?.tag === 'textarea', '[REGRESIÓN] <textarea> sigue siendo "textarea" (ya era correcto, confirmado sin cambios)', f?.affectedElement);
  }

  // ===========================================================================
  // analyzeLinks — evidencia enriquecida, clasificación intacta
  // ===========================================================================
  {
    // FAIL: enlace sin texto ni aria-label -- la evidencia ahora debe incluir
    // href Y text (vacío), demostrando la ausencia en vez de solo citar el destino.
    const ev = snapshot({ links: [linkElement({ selector: 'a:nth-of-type(1)', text: '', ariaLabel: null, href: 'https://bootstrapmade.com/' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = linkFindingFor(findings, 'a:nth-of-type(1)');
    expect(f?.status === 'FAIL', '[REGRESIÓN] Enlace sin texto ni aria-label sigue siendo FAIL (clasificación intacta)', f);
    const hrefItem = f?.evidence.find((e: any) => e.property === 'href');
    const textItem = f?.evidence.find((e: any) => e.property === 'text');
    expect(hrefItem?.value === 'https://bootstrapmade.com/', '[REGRESIÓN] href se conserva tal cual', hrefItem);
    expect(!!textItem && textItem.value === '', '[CORRECCIÓN] ahora se adjunta evidence DOM_ATTRIBUTE property="text" value="" -- el dato real que demuestra la ausencia, antes nunca incluido', f?.evidence);
    expect(!f?.evidence.some((e: any) => e.property === 'ariaLabel'), '[CORRECCIÓN] sin ariaLabel real, no se agrega ningún ítem ariaLabel (no se inventa un valor)', f?.evidence);
  }

  {
    // PASS: enlace con texto visible -- evidencia debe incluir href + text con el valor real.
    const ev = snapshot({ links: [linkElement({ selector: 'a:nth-of-type(2)', text: 'Ir a inicio', ariaLabel: null, href: 'https://bootstrapmade.com/' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = linkFindingFor(findings, 'a:nth-of-type(2)');
    expect(f?.status === 'PASS', '[REGRESIÓN] Enlace con texto visible sigue siendo PASS (clasificación intacta)', f);
    const textItem = f?.evidence.find((e: any) => e.property === 'text');
    expect(textItem?.value === 'Ir a inicio', '[CORRECCIÓN] evidence incluye el texto real que sustenta el PASS', textItem);
  }

  {
    // PASS vía aria-label (sin texto visible) -- evidencia debe incluir el ariaLabel real.
    const ev = snapshot({ links: [linkElement({ selector: 'a:nth-of-type(3)', text: '', ariaLabel: 'Ir al carrito de compras', href: '/cart' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = linkFindingFor(findings, 'a:nth-of-type(3)');
    expect(f?.status === 'PASS', '[REGRESIÓN] Enlace con solo aria-label sigue siendo PASS (clasificación intacta, prioriza ariaLabel sobre text)', f);
    const ariaItem = f?.evidence.find((e: any) => e.property === 'ariaLabel');
    expect(ariaItem?.value === 'Ir al carrito de compras', '[CORRECCIÓN] evidence incluye el ariaLabel real que sustenta el PASS', ariaItem);
    expect(f?.evidence.length === 3, '[CORRECCIÓN] 3 ítems de evidencia (href + text vacío + ariaLabel real) cuando ambos datos existen', f?.evidence);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, 0 failed.`);
  console.log(`========================================\n`);
  process.exit(0);
}

runTests();
