import {
  deduplicateLinks,
  deduplicateLandmarks,
  deduplicateButtons,
} from '@/modules/evaluations/services/evidence-deduplication.service';
import { SnapshotEvidenceModel } from '@/modules/snapshots/snapshot-evidence.model';
import { aiService } from '@/modules/ai/ai.service';

/**
 * Regression test for the Mongoose-subdocument-spread bug (2026-09-10
 * incident): groupIdenticalEvidence() used to do `{...item, iterations}` on
 * real Mongoose subdocuments, which copies internal bookkeeping
 * ($__parent, __parentArray, $__, _doc, $isNew) instead of the schema
 * fields (selector/text/href/... are prototype getters, not own
 * properties) — and $__parent/__parentArray are live references to the
 * parent document/array, which JSON.stringify serializes in full. This
 * inflated a single evaluation's Phase 2 prompt from ~90 KB to ~5.4 MB.
 *
 * Uses REAL Mongoose subdocuments (via `new SnapshotEvidenceModel(...)`,
 * never saved/connected to a DB — Mongoose document construction alone is
 * enough to reproduce the exact internal shape production code sees).
 */
function runTests() {
  console.log('🧪 Starting Evidence Deduplication — Mongoose Subdocument Bug Regression Tests...\n');

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
  // 1. Escenario con subdocumentos Mongoose reales (2 iteraciones idénticas,
  //    exactamente como el incidente real: misma página capturada 2 veces).
  // ---------------------------------------------------------------------
  const doc1: any = new SnapshotEvidenceModel({
    evaluationId: '000000000000000000000001',
    iteration: 1,
    url: 'https://example.com',
    screenshotPath: '/x1.png',
    headings: [], images: [], forms: [], computedStyles: [],
    landmarks: [{ type: 'nav', selector: 'nav.main-nav', ariaLabel: 'Principal' }],
    links: [{ selector: 'a.home', text: 'Inicio', href: 'https://example.com/', ariaLabel: null, role: null, isExternal: false }],
    buttons: [{ selector: 'button.submit', tag: 'button', text: 'Enviar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true }],
  });
  const doc2: any = new SnapshotEvidenceModel({
    evaluationId: '000000000000000000000001',
    iteration: 2,
    url: 'https://example.com',
    screenshotPath: '/x2.png',
    headings: [], images: [], forms: [], computedStyles: [],
    landmarks: [{ type: 'nav', selector: 'nav.main-nav', ariaLabel: 'Principal' }],
    links: [{ selector: 'a.home', text: 'Inicio', href: 'https://example.com/', ariaLabel: null, role: null, isExternal: false }],
    buttons: [{ selector: 'button.submit', tag: 'button', text: 'Enviar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true }],
  });

  // Sanity: confirm we really are dealing with Mongoose subdocuments (the
  // bug's precondition), not plain objects — otherwise this test would not
  // be reproducing anything.
  assert(
    typeof (doc1.links[0] as any).$__parent === 'object',
    'Precondición: doc1.links[0] es un subdocumento Mongoose real (tiene $__parent)',
  );

  // ---------------------------------------------------------------------
  // 2. Pasarlos por groupIdenticalEvidence() (vía las funciones públicas)
  // ---------------------------------------------------------------------
  const dedupedLinks = deduplicateLinks([
    { iteration: 1, items: doc1.links as any },
    { iteration: 2, items: doc2.links as any },
  ]);
  const dedupedLandmarks = deduplicateLandmarks([
    { iteration: 1, items: doc1.landmarks as any },
    { iteration: 2, items: doc2.landmarks as any },
  ]);
  const dedupedButtons = deduplicateButtons([
    { iteration: 1, items: doc1.buttons as any },
    { iteration: 2, items: doc2.buttons as any },
  ]);

  assert(dedupedLinks.length === 1, 'Deduplicación funcional intacta: 1 link idéntico en 2 iteraciones -> 1 grupo');
  assert(dedupedLandmarks.length === 1, 'Deduplicación funcional intacta: 1 landmark idéntico -> 1 grupo');
  assert(dedupedButtons.length === 1, 'Deduplicación funcional intacta: 1 button idéntico -> 1 grupo');

  // ---------------------------------------------------------------------
  // 3. Object.keys() del resultado NO debe contener propiedades internas
  // ---------------------------------------------------------------------
  const MONGOOSE_INTERNAL_KEYS = ['$__parent', '__parentArray', '$__', '_doc', '$isNew'];
  for (const [label, arr] of [['dedupedLinks', dedupedLinks], ['dedupedLandmarks', dedupedLandmarks], ['dedupedButtons', dedupedButtons]] as const) {
    const keys = Object.keys(arr[0] as object);
    const leaked = MONGOOSE_INTERNAL_KEYS.filter((k) => keys.includes(k));
    assert(leaked.length === 0, `${label}[0]: Object.keys() no contiene propiedades internas de Mongoose (encontradas: ${JSON.stringify(leaked)})`);
  }

  // ---------------------------------------------------------------------
  // 4. JSON.stringify(resultado) NO debe contener los marcadores del bug
  // ---------------------------------------------------------------------
  for (const [label, arr] of [['dedupedLinks', dedupedLinks], ['dedupedLandmarks', dedupedLandmarks], ['dedupedButtons', dedupedButtons]] as const) {
    const serialized = JSON.stringify(arr);
    assert(!serialized.includes('$__parent'), `${label}: JSON.stringify no contiene "$__parent"`);
    assert(!serialized.includes('__parentArray'), `${label}: JSON.stringify no contiene "__parentArray"`);
    assert(!serialized.includes('"_doc"'), `${label}: JSON.stringify no contiene "\\"_doc\\""`);
  }

  // ---------------------------------------------------------------------
  // 5. Los campos funcionales esperados sí permanecen
  // ---------------------------------------------------------------------
  assert((dedupedLinks[0] as any).selector === 'a.home', 'dedupedLinks[0].selector preservado');
  assert((dedupedLinks[0] as any).text === 'Inicio', 'dedupedLinks[0].text preservado');
  assert((dedupedLinks[0] as any).href === 'https://example.com/', 'dedupedLinks[0].href preservado');
  assert((dedupedLinks[0] as any).isExternal === false, 'dedupedLinks[0].isExternal preservado');
  assert((dedupedLandmarks[0] as any).type === 'nav', 'dedupedLandmarks[0].type preservado');
  assert((dedupedLandmarks[0] as any).ariaLabel === 'Principal', 'dedupedLandmarks[0].ariaLabel preservado');
  assert((dedupedButtons[0] as any).text === 'Enviar', 'dedupedButtons[0].text preservado');
  assert((dedupedButtons[0] as any).isPrimary === true, 'dedupedButtons[0].isPrimary preservado');

  // Explicitly NOT present: Mongoose's own `_id` per subdocument (never
  // needed by Gemini — see grep audit; excluded the same way Evidence
  // Compression #1 excluded it from evidencesSummary).
  assert(!('_id' in (dedupedLinks[0] as any)), 'dedupedLinks[0] no expone _id de Mongoose');

  // ---------------------------------------------------------------------
  // 6. `iterations` permanece
  // ---------------------------------------------------------------------
  assert(Array.isArray((dedupedLinks[0] as any).iterations), 'dedupedLinks[0].iterations existe y es array');
  assert(
    JSON.stringify((dedupedLinks[0] as any).iterations) === JSON.stringify([1, 2]),
    'dedupedLinks[0].iterations = [1, 2] (ambas iteraciones idénticas agrupadas)',
  );

  // ---------------------------------------------------------------------
  // 7. Compatibilidad con buildV2AuditPrompt() — el prompt real
  // ---------------------------------------------------------------------
  const input: any = {
    evaluationId: 'x', title: 'Test', url: 'https://example.com',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: 2,
    evidencesSummary: [], dedupedLandmarks, dedupedLinks, dedupedButtons,
    accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  assert(typeof prompt === 'string' && prompt.length > 0, 'buildV2AuditPrompt construye un prompt no vacío con la salida corregida');
  assert(!prompt.includes('$__parent'), 'El prompt real NO contiene "$__parent"');
  assert(!prompt.includes('__parentArray'), 'El prompt real NO contiene "__parentArray"');
  assert(prompt.includes('"selector": "a.home"'), 'El prompt real SÍ contiene el selector real del link');
  assert(prompt.includes('"href": "https://example.com/"'), 'El prompt real SÍ contiene el href real del link');
  // The fixed instruction template alone is ~7 KB (see payload-composition
  // audit, 2026-09-10), so "small" here means "no MB-scale inflation from
  // the parent-document leak" rather than an arbitrarily tight byte count.
  assert(prompt.length < 20_000, `El prompt es pequeño (${prompt.length} chars) — sin inflado por referencias al documento padre`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
