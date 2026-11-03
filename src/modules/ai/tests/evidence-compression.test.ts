import {
  aiService,
  classifySrcType,
  sanitizeEvidenceForGemini,
  V2AuditAnalysisInput,
} from '../ai.service';

/**
 * Evidence Compression (Phase 2.1) — surgical optimization tests.
 *
 * Covers: image src → srcType classification, Mongoose `_id` stripping from
 * evidencesSummary, preservation of evaluative image fields, and a
 * regression check that the REAL buildV2AuditPrompt() output (not a
 * reconstruction) never contains a raw src/data-URI/`_id` after the
 * transformation.
 *
 * No real Gemini calls — buildV2AuditPrompt is a pure string builder.
 */
function runTests() {
  console.log('🧪 Starting Evidence Compression (Phase 2.1) Tests...\n');

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

  // ---------------------------------------------------------------------
  // Test 1 — data URI
  // ---------------------------------------------------------------------
  console.log('--- Test 1: data URI ---');
  {
    const bigBase64 = 'iVBORw0KGgoAAAANSUhEUgAAB4A'.repeat(50_000); // ~1.4M chars filler
    const src = `data:image/png;base64,${bigBase64}`;
    assert(classifySrcType(src) === 'data-uri', 'Test 1: data: URI clasificado como "data-uri"');

    const sanitized = sanitizeEvidenceForGemini([
      {
        iteration: 1, url: 'https://example.com', screenshotPath: '/x.png',
        headings: [], forms: [], computedStyles: [],
        images: [{ selector: 'img.hero', src, alt: 'Hero', ariaLabel: null, role: null, isDecorative: false }],
      },
    ]);
    const serialized = JSON.stringify(sanitized);
    assert(!serialized.includes(bigBase64), 'Test 1: el base64 original NO aparece en la representación sanitizada');
    assert(!serialized.includes('data:image/png;base64'), 'Test 1: el prefijo data: URI original NO aparece en la representación sanitizada');
    assert(sanitized[0].images[0].srcType === 'data-uri', 'Test 1: srcType = "data-uri" en la salida sanitizada');
  }

  // ---------------------------------------------------------------------
  // Test 2 — URL externa
  // ---------------------------------------------------------------------
  console.log('\n--- Test 2: URL externa ---');
  {
    const src = 'https://example.com/assets/img/image.png';
    assert(classifySrcType(src) === 'external-url', 'Test 2: URL absoluta clasificada como "external-url"');

    const sanitized = sanitizeEvidenceForGemini([
      { iteration: 1, url: 'https://example.com', screenshotPath: '/x.png', headings: [], forms: [], computedStyles: [],
        images: [{ selector: 'img.logo', src, alt: 'Logo', ariaLabel: null, role: null, isDecorative: false }] },
    ]);
    const serialized = JSON.stringify(sanitized);
    assert(!serialized.includes(src), 'Test 2: la URL completa NO se conserva en el payload sanitizado');
    assert(sanitized[0].images[0].srcType === 'external-url', 'Test 2: srcType = "external-url"');
  }

  // ---------------------------------------------------------------------
  // Test 3 — URL relativa
  // ---------------------------------------------------------------------
  console.log('\n--- Test 3: URL relativa ---');
  {
    assert(classifySrcType('/images/logo.png') === 'relative-url', 'Test 3: ruta relativa con "/" clasificada como "relative-url"');
    assert(classifySrcType('images/logo.png') === 'relative-url', 'Test 3: ruta relativa sin "/" inicial también clasificada como "relative-url"');
  }

  // ---------------------------------------------------------------------
  // Test 4 — src vacío
  // ---------------------------------------------------------------------
  console.log('\n--- Test 4: src vacío ---');
  {
    assert(classifySrcType('') === 'empty', 'Test 4: string vacío clasificado como "empty"');
    assert(classifySrcType(undefined) === 'empty', 'Test 4: undefined clasificado como "empty" (defensivo)');
    assert(classifySrcType(null) === 'empty', 'Test 4: null clasificado como "empty" (defensivo)');
  }

  // ---------------------------------------------------------------------
  // Test 5 — preservación de evidencia evaluativa
  // ---------------------------------------------------------------------
  console.log('\n--- Test 5: preservación de campos evaluativos ---');
  {
    const sanitized = sanitizeEvidenceForGemini([
      { iteration: 1, url: 'https://example.com', screenshotPath: '/x.png', headings: [], forms: [], computedStyles: [],
        images: [{
          selector: 'img.hero-background', src: 'data:image/png;base64,AAAA',
          alt: 'Descripción real de la imagen', ariaLabel: 'Etiqueta ARIA', role: 'img', isDecorative: false,
        }] },
    ]);
    const img = sanitized[0].images[0];
    assert(img.selector === 'img.hero-background', 'Test 5: selector preservado');
    assert(img.alt === 'Descripción real de la imagen', 'Test 5: alt preservado');
    assert(img.ariaLabel === 'Etiqueta ARIA', 'Test 5: ariaLabel preservado');
    assert(img.role === 'img', 'Test 5: role preservado');
    assert(img.isDecorative === false, 'Test 5: isDecorative preservado');
    assert(!('src' in img), 'Test 5: el campo "src" ya no existe en la representación para Gemini');
  }

  // ---------------------------------------------------------------------
  // Test 6 — _id no llega a Gemini
  // ---------------------------------------------------------------------
  console.log('\n--- Test 6: _id de Mongoose no llega a la representación para Gemini ---');
  {
    const withMongoIds = [
      {
        iteration: 1, url: 'https://example.com', screenshotPath: '/x.png',
        headings: [{ level: 1, text: 'Título', selector: 'h1', _id: '6aa1a72f14059206b854112f' } as any],
        forms: [],
        computedStyles: [{ selector: 'p', tag: 'p', text: '', color: '#000', backgroundColor: '#fff', fontSize: '16px', fontWeight: '400', lineHeight: '24px', fontFamily: 'Roboto', _id: '6aa1a72f14059206b854112c' } as any],
        images: [{ selector: 'img', src: 'https://example.com/a.png', alt: null, ariaLabel: null, role: null, isDecorative: false, _id: '6aa1a72f14059206b854112d' } as any],
      },
    ];
    const sanitized = sanitizeEvidenceForGemini(withMongoIds as any);
    const serialized = JSON.stringify(sanitized);
    assert(!serialized.includes('_id'), 'Test 6: ningún "_id" de Mongoose aparece en headings/images/computedStyles sanitizados');
    assert(!('_id' in sanitized[0].headings[0]), 'Test 6: headings[0] no tiene _id');
    assert(!('_id' in sanitized[0].images[0]), 'Test 6: images[0] no tiene _id');
    assert(!('_id' in sanitized[0].computedStyles[0]), 'Test 6: computedStyles[0] no tiene _id');
  }

  // ---------------------------------------------------------------------
  // Test 7 — regresión del PROMPT REAL (buildV2AuditPrompt, no reconstrucción)
  // ---------------------------------------------------------------------
  console.log('\n--- Test 7: regresión del prompt real construido por buildV2AuditPrompt ---');
  {
    const bigBase64 = 'iVBORw0KGgoAAAANSUhEUgAAB4A'.repeat(50_000);
    const rawSrc = `data:image/png;base64,${bigBase64}`;

    const rawEvidencesSummary = [
      {
        iteration: 1, url: 'https://example.com', screenshotPath: '/uploads/step_1.png',
        headings: [{ level: 1, text: 'Título', selector: 'h1', _id: 'mongoid1' } as any],
        forms: [],
        computedStyles: [{ selector: 'p', tag: 'p', text: '', color: '#000', backgroundColor: '#fff', fontSize: '16px', fontWeight: '400', lineHeight: '24px', fontFamily: 'Roboto', _id: 'mongoid2' } as any],
        images: [{ selector: 'img.hero-background', src: rawSrc, alt: 'Hero background', ariaLabel: null, role: null, isDecorative: false, _id: 'mongoid3' } as any],
      },
    ];

    const sanitized = sanitizeEvidenceForGemini(rawEvidencesSummary as any);

    const input: V2AuditAnalysisInput = {
      evaluationId: 'test-eval', title: 'Test', url: 'https://example.com',
      archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
      completedSteps: [], previousActions: [], snapshotsCount: 1,
      evidencesSummary: sanitized,
      dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
      accessibilityTrees: [],
    };

    // Calls the REAL, unmodified prompt-building function.
    const prompt: string = (aiService as any).buildV2AuditPrompt(input);

    assert(typeof prompt === 'string' && prompt.length > 0, 'Test 7: el prompt se construye correctamente (no vacío)');
    assert(!prompt.includes(bigBase64), 'Test 7: el base64 original NO aparece en el prompt final enviado a Gemini');
    assert(!prompt.includes('data:image/png;base64'), 'Test 7: ningún data: URI original aparece en el prompt final');
    assert(!prompt.includes('mongoid'), 'Test 7: ningún _id de Mongoose aparece en el prompt final');
    assert(prompt.includes('"srcType": "data-uri"'), 'Test 7: el prompt SÍ contiene la representación semántica srcType="data-uri"');
    assert(prompt.includes('"selector": "img.hero-background"'), 'Test 7: el selector de la imagen se conserva en el prompt');
    assert(prompt.includes('"alt": "Hero background"'), 'Test 7: el alt de la imagen se conserva en el prompt');

    // Sanity: the prompt should be small (no MB-scale content), unlike the
    // pre-transformation case would have been.
    assert(prompt.length < 10_000, `Test 7: el prompt final es pequeño (${prompt.length} chars) — el base64 de ~1.4M chars no infló el payload`);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
