import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { SnapshotEvidenceModel } from '@/modules/snapshots/snapshot-evidence.model';
import {
  measurePayload,
  shouldBlockBeforeSending,
  PHASE2_BUDGET,
  computeWorstCaseCumulativeTokens,
} from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase 2.3 — T1: Mongoose expansion regression (PERMANENT ALARM).
 *
 * Reproduces the exact precondition of the 2026-09-10 incident (~5.42 MB /
 * ~1.35M estimated tokens, real 429 RESOURCE_EXHAUSTED): real Mongoose
 * subdocuments (via `new SnapshotEvidenceModel(...)`, never `.lean()`),
 * shaped like the real evaluation that triggered it (2 snapshots, ~50
 * computedStyles/snapshot, ~69 links/snapshot, 10 landmarks/snapshot,
 * 4 buttons/snapshot), run through the REAL, unmodified
 * `buildDeduplicatedEvidenceContext` + `sanitizeEvidenceForGemini` +
 * `buildV2AuditPrompt`.
 *
 * If `groupIdenticalEvidence`'s `{...item}` spread bug (or an equivalent
 * one) ever reappears, this test's payload-level assertion fails loudly,
 * BEFORE any real evaluation could hit the same 429 in production.
 *
 * No browser, no MongoDB connection, no Gemini call — `new
 * SnapshotEvidenceModel(...)` only needs Mongoose's schema machinery, not a
 * live connection.
 */
function buildRealisticEvidence(iteration: number) {
  const computedStyles = Array.from({ length: 50 }).map((_, i) => ({
    selector: `el:nth-of-type(${i + 1})`,
    tag: i % 3 === 0 ? 'a' : i % 3 === 1 ? 'button' : 'p',
    text: '',
    color: 'rgb(2, 59, 109)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    fontFamily: 'Roboto, sans-serif',
  }));

  const links = Array.from({ length: 69 }).map((_, i) => ({
    selector: `a:nth-of-type(${i + 1})`,
    text: `Enlace ${i + 1}`,
    href: `https://example.com/page-${i + 1}?ref=nav`,
    ariaLabel: null,
    role: null,
    isExternal: i % 5 === 0,
  }));

  const landmarks = [
    { type: 'header', selector: 'header', ariaLabel: null },
    { type: 'nav', selector: 'nav', ariaLabel: 'Principal' },
    { type: 'main', selector: 'main', ariaLabel: null },
    { type: 'footer', selector: 'footer', ariaLabel: null },
    { type: 'form', selector: 'form#newsletter', ariaLabel: null },
    { type: 'complementary', selector: 'aside', ariaLabel: null },
    { type: 'search', selector: 'div.search-bar', ariaLabel: 'Buscar' },
    { type: 'region', selector: 'section.features', ariaLabel: 'Características' },
    { type: 'region', selector: 'section.pricing', ariaLabel: 'Precios' },
    { type: 'contentinfo', selector: 'div.copyright', ariaLabel: null },
  ];

  const buttons = [1, 2, 3, 4].map((n) => ({
    selector: `button:nth-of-type(${n})`,
    tag: 'button',
    text: n === 1 ? 'Enviar' : `Acción ${n}`,
    ariaLabel: null,
    role: null,
    isDisabled: false,
    isPrimary: n === 1,
  }));

  const headings = [1, 2, 3, 4, 5, 6].map((n) => ({
    level: n <= 2 ? 1 : 2,
    text: `Encabezado de sección ${n}`,
    selector: `h${n <= 2 ? 1 : 2}:nth-of-type(${n})`,
  }));

  const images = [1, 2, 3, 4, 5].map((n) => ({
    selector: `img:nth-of-type(${n})`,
    src: `https://example.com/assets/img-${n}.png`,
    alt: `Imagen ${n}`,
    ariaLabel: null,
    role: null,
    isDecorative: false,
  }));

  const forms = [1, 2, 3].map((n) => ({
    selector: `form:nth-of-type(${n})`,
    name: null,
    action: n === 1 ? '/subscribe' : null,
    elements: [
      {
        selector: `form:nth-of-type(${n}) input[type=email]`,
        type: 'email',
        name: 'email',
        label: 'Correo electrónico',
        ariaLabel: null,
        ariaLabelledBy: null,
        ariaDescribedBy: null,
        required: true,
        placeholder: 'tu@email.com',
        ariaInvalid: false,
      },
    ],
  }));

  return new SnapshotEvidenceModel({
    evaluationId: '000000000000000000000001',
    iteration,
    url: 'https://example.com',
    screenshotPath: `/uploads/step_${iteration}.png`,
    headings,
    images,
    forms,
    computedStyles,
    landmarks,
    links,
    buttons,
  });
}

function runTests() {
  console.log('🧪 Starting T1 — Mongoose Expansion Regression (Fase 2.3, permanent alarm)...\n');

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

  // 1. Real Mongoose subdocuments — precondition of the original bug.
  const doc1: any = buildRealisticEvidence(1);
  const doc2: any = buildRealisticEvidence(2);
  assert(
    typeof doc1.links[0].$__parent === 'object',
    'Precondición: los subdocumentos son Mongoose reales (tienen $__parent) — el escenario reproduce el bug original',
  );

  // 2. Real pipeline: buildDeduplicatedEvidenceContext -> sanitizeEvidenceForGemini -> buildV2AuditPrompt
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext([
    {
      iteration: 1, url: doc1.url, screenshotPath: doc1.screenshotPath,
      headings: doc1.headings, images: doc1.images, links: doc1.links, buttons: doc1.buttons,
      forms: doc1.forms, landmarks: doc1.landmarks, computedStyles: doc1.computedStyles,
    },
    {
      iteration: 2, url: doc2.url, screenshotPath: doc2.screenshotPath,
      headings: doc2.headings, images: doc2.images, links: doc2.links, buttons: doc2.buttons,
      forms: doc2.forms, landmarks: doc2.landmarks, computedStyles: doc2.computedStyles,
    },
  ] as any);

  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);

  const input: any = {
    evaluationId: 't1-regression', title: 'T1 Regression Fixture', url: 'https://example.com',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: ['Navegar a la URL objetivo'],
    previousActions: [{ actionType: 'NAVIGATE', description: 'x', result: 'success' }],
    snapshotsCount: 2,
    evidencesSummary: sanitized,
    dedupedLandmarks, dedupedLinks, dedupedButtons,
    accessibilityTrees: ['- document:\n  - banner:', '- document:\n  - banner:'],
  };

  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);
  const breakdown = analyzePromptComposition(prompt, {
    dedupedLandmarks, dedupedLinks, dedupedButtons,
    evidencesSummary: sanitized,
    accessibilityTrees: input.accessibilityTrees,
  });
  const linksEntry = breakdown.find((b) => b.category === 'dedupedLinks')!;

  console.log(`  ℹ️  chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log('  ℹ️  Composición:', breakdown.map((b) => `${b.category}=${b.chars}(${b.percentOfTotal}%)`).join(', '));

  // ─────────────────────────────────────────────────────────────────────
  // ASERCIÓN INDEPENDIENTE 1 — Regresión estructural.
  //
  // ¿El código sigue produciendo un objeto PLANO, sin bookkeeping interno
  // de Mongoose filtrado? Esto es correctitud de forma — es verdadero o
  // falso independientemente de cuántos bytes ocupe el resultado. Un futuro
  // bug distinto (p.ej. una nueva propiedad interna de una versión más
  // reciente de Mongoose) podría filtrar datos sin necesariamente inflar el
  // payload lo suficiente como para cruzar el presupuesto — por eso esta
  // aserción NO depende de la Aserción 2.
  // ─────────────────────────────────────────────────────────────────────
  const noMongooseLeak =
    !prompt.includes('$__parent') && !prompt.includes('__parentArray') && !prompt.includes('"_doc"');
  assert(
    noMongooseLeak,
    'ASERCIÓN 1 (regresión estructural): el prompt real NO contiene ningún marcador interno de Mongoose ($__parent / __parentArray / "_doc")',
  );

  // ─────────────────────────────────────────────────────────────────────
  // ASERCIÓN INDEPENDIENTE 2 — Presupuesto.
  //
  // ¿El tamaño resultante se mantiene dentro del presupuesto de Phase 2
  // (nunca CRITICAL)? Esto es una propiedad de TAMAÑO — en teoría, un
  // pipeline sin ningún leak estructural igual podría crecer sin control
  // por otra razón (p.ej. deduplicación desactivada, un fixture
  // desproporcionado). Se verifica por separado de la Aserción 1, aunque en
  // este escenario específico ambas están relacionadas por el mismo
  // incidente histórico.
  // ─────────────────────────────────────────────────────────────────────
  const withinBudget =
    measurement.level !== 'CRITICAL' &&
    !shouldBlockBeforeSending(measurement) &&
    linksEntry.chars < 50_000; // el incidente real: 3,229,172 chars en esta misma categoría
  assert(
    withinBudget,
    `ASERCIÓN 2 (presupuesto): el payload final está dentro de presupuesto Phase 2 — level=${measurement.level}, ` +
    `chars=${measurement.chars} (límite WARNING=${PHASE2_BUDGET.warningMaxChars}), dedupedLinks=${linksEntry.chars} chars ` +
    `(incidente real: 3,229,172 chars)`,
  );

  // Informativo únicamente (no es una tercera aserción de T1): el cálculo
  // de consumo acumulado en el peor caso teórico ya tiene su propia
  // validación dedicada en payload-budgets.test.ts (ajuste #2).
  const worstCase = computeWorstCaseCumulativeTokens();
  console.log(
    `  ℹ️  [informativo] Peor caso teórico del sistema (no específico de este fixture): ` +
    `${worstCase.combinedWorstCaseTokens.toLocaleString()} tokens vs. límite real de 1,000,000/min ` +
    `-> ${worstCase.exceedsGoogleLimit ? 'EXCEDE' : 'dentro del límite'} (ver payload-budgets.test.ts para la validación formal)`,
  );

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
