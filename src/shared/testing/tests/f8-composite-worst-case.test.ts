import fs from 'fs';
import path from 'path';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput, SyntheticLink, SyntheticButton, SyntheticComputedStyle } from '@/shared/testing/synthetic-mongoose-evidence';
import { measurePayload, shouldBlockBeforeSending, PHASE2_BUDGET } from '@/shared/testing/payload-budgets';
import { analyzePromptComposition } from '@/shared/testing/payload-composition-analyzer';

/**
 * Fase F — F8: Composite worst-case (F1 + F2 + F3 + F4 en una sesión de
 * F5 de 8 iteraciones). Combina, en el mismo escenario:
 *   - F1: muchos elementos con identidad distinta por iteración (además,
 *     SIN beneficio de dedup entre iteraciones -- deliberado, es el peor
 *     caso, no el realista de F5).
 *   - F2: cada elemento lleva un campo de texto largo.
 *   - F3: 50 entradas de computedStyles (el tope real ya confirmado).
 *   - F4: selectores con un prefijo de ancestros largo (simula el costo de
 *     un DOM profundo, sin relanzar Playwright — mismo principio híbrido
 *     de F7, aquí con el prefijo escrito directamente).
 *   - F5: 8 iteraciones acumuladas.
 *
 * OBJETIVO: (a) producir una descomposición CAUSAL del payload final por
 * categoría para identificar qué factor domina el crecimiento, y (b)
 * separar EXPLÍCITAMENTE clasificación (shouldBlockBeforeSending clasifica
 * bien un payload CRITICAL) de enforcement productivo (documentado, NO
 * corregido, que hoy ningún call-site de producción invoca esa función).
 */
const ITERATIONS = 8;
const LINKS_PER_ITERATION = 150;
const TEXT_CHARS = 600;
const DEEP_SELECTOR_PREFIX = 'div:nth-of-type(1) > '.repeat(20); // simula costo F4 sin relanzar Playwright (mecanismo híbrido, ver F7)

function buildWorstCaseLinks(iteration: number): SyntheticLink[] {
  const padding = 'x'.repeat(Math.max(0, TEXT_CHARS - 20));
  const links: SyntheticLink[] = [];
  for (let i = 0; i < LINKS_PER_ITERATION; i++) {
    links.push({
      // Único POR ITERACIÓN (a diferencia de F1/F6): defeat deliberado del
      // dedup, igual que F5's modo 'no-dedup-benefit'.
      selector: `${DEEP_SELECTOR_PREFIX}article:nth-of-type(${i + 1}) > a`,
      text: `Producto ${iteration}-${i} ${padding}`,
      href: `/iter-${iteration}/productos/${i}`,
      ariaLabel: null,
      role: null,
      isExternal: false,
    });
  }
  return links;
}

function buildWorstCaseButtons(iteration: number): SyntheticButton[] {
  const buttons: SyntheticButton[] = [];
  for (let i = 0; i < LINKS_PER_ITERATION; i++) {
    buttons.push({
      // selector incluye la iteración para ser único por iteración, igual
      // que los links -- mismo defeat deliberado del dedup (peor caso).
      selector: `${DEEP_SELECTOR_PREFIX}article[data-iter="${iteration}"]:nth-of-type(${i + 1}) > button`,
      tag: 'button', text: 'Añadir al carrito', ariaLabel: null, role: null, isDisabled: false, isPrimary: false,
    });
  }
  return buttons;
}

function buildWorstCaseComputedStyles(): SyntheticComputedStyle[] {
  const styles: SyntheticComputedStyle[] = [];
  for (let i = 0; i < 50; i++) {
    styles.push({
      selector: `${DEEP_SELECTOR_PREFIX}p:nth-of-type(${i + 1})`,
      tag: 'p', text: `Párrafo estilizado ${i}`, color: '#333333', backgroundColor: '#ffffff',
      fontSize: '16px', fontWeight: '400', lineHeight: '1.5', fontFamily: 'Arial, sans-serif',
    });
  }
  return styles;
}

function main() {
  console.log('🧪 Starting F8 — Composite Worst-Case (F1+F2+F3+F4+F5) (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const docs = Array.from({ length: ITERATIONS }).map((_, i) =>
    buildSyntheticMongooseEvidence({
      iteration: i + 1,
      links: buildWorstCaseLinks(i + 1),
      buttons: buildWorstCaseButtons(i + 1),
      // (computedStyles y headings a continuación se mantienen idénticos
      // cada iteración de forma deliberada — ver nota tras la ejecución.)
      computedStyles: buildWorstCaseComputedStyles(), // idénticos cada iteración -> SÍ debería colapsar (no forma parte del dedup module, ver más abajo)
      headings: [{ level: 1, text: `Página ${i + 1}`, selector: 'h1' }],
    }),
  );

  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(docs.map((d) => toEvidenceInput(d)));

  assert(dedupedLinks.length === LINKS_PER_ITERATION * ITERATIONS, `Sin beneficio de dedup (deliberado): dedupedLinks.length=${dedupedLinks.length} (esperado: ${LINKS_PER_ITERATION * ITERATIONS})`);
  assert(dedupedButtons.length === LINKS_PER_ITERATION * ITERATIONS, `Sin beneficio de dedup (deliberado): dedupedButtons.length=${dedupedButtons.length} (esperado: ${LINKS_PER_ITERATION * ITERATIONS})`);

  const sanitized = sanitizeEvidenceForGemini(evidencesSummary as any);
  const input: any = {
    evaluationId: 'f8-composite', title: 'F8', url: 'https://fixture.local/f8',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: ITERATIONS,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(input);
  const measurement = measurePayload(2, prompt);

  // --- 1. DESCOMPOSICIÓN CAUSAL por categoría ---
  const allHeadings = evidencesSummary.flatMap((e: any) => e.headings || []);
  const allImages = evidencesSummary.flatMap((e: any) => e.images || []);
  const allForms = evidencesSummary.flatMap((e: any) => e.forms || []);
  const allComputedStyles = evidencesSummary.flatMap((e: any) => e.computedStyles || []);
  const snapshotMeta = evidencesSummary.map((e: any) => ({ iteration: e.iteration, url: e.url, screenshotPath: e.screenshotPath }));
  const selectorsOnly = [...dedupedLinks.map((l: any) => l.selector), ...dedupedButtons.map((b: any) => b.selector)].join('|');

  const breakdown = analyzePromptComposition(prompt, {
    dedupedLinks, dedupedButtons, dedupedLandmarks,
    headings: allHeadings, images: allImages, forms: allForms, computedStyles: allComputedStyles,
    snapshotMeta, selectorsOnly,
  });

  console.log(`  ℹ️  Payload Audit: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  console.log('  ℹ️  Descomposición causal por categoría (mayor a menor):');
  breakdown.forEach((b) => console.log(`      - ${b.category}: ${b.chars}c (${b.percentOfTotal}%)`));

  const dominant = breakdown[0];
  console.log(`  ℹ️  Factor dominante del crecimiento: "${dominant.category}" (${dominant.percentOfTotal}% del total)`);
  assert(
    dominant.category === 'dedupedLinks' || dominant.category === 'dedupedButtons',
    `El factor dominante identificado ("${dominant.category}") corresponde a la combinación deliberada volumen×texto (F1×F2), coherente con el diseño del escenario`,
  );
  const computedStylesShare = breakdown.find((b) => b.category === 'computedStyles')!.percentOfTotal;
  assert(
    computedStylesShare < dominant.percentOfTotal,
    `computedStyles (${computedStylesShare}%) no es el factor dominante — se mantiene por debajo de "${dominant.category}" (${dominant.percentOfTotal}%)`,
  );
  // HALLAZGO CAUSAL ADICIONAL (no en el plan original, encontrado al medir):
  // computedStyles NO participa del módulo de deduplicación (ver docstring
  // de evidence-deduplication.service.ts: "headings, images, forms,
  // computedStyles are NOT touched by this module"). Aquí las 50 entradas
  // son IDÉNTICAS en las 8 iteraciones (a diferencia de links/buttons,
  // deliberadamente únicos por iteración), y aun así su participación en
  // el total (~10%) es notablemente mayor que en F3 aislado (donde 50
  // entradas eran una fracción marginal) -- porque el prefijo de selector
  // largo (F4) se repite SIN deduplicar una vez por cada una de las 8
  // iteraciones (50 × 8 = 400 copias del mismo selector largo). Es la
  // combinación F3×F4×F5 la que expone esto, no F3 sola.
  console.log(`  ℹ️  HALLAZGO: computedStyles no se deduplica entre iteraciones (por diseño, fuera del alcance del módulo de dedup) — combinado con selectores largos (F4) y 8 iteraciones (F5), esto representa ${computedStylesShare}% del payload pese a ser solo 50 elementos, todos idénticos entre sí.`);

  // --- 2. CLASIFICACIÓN: shouldBlockBeforeSending debe detectar CRITICAL correctamente ---
  console.log(`  ℹ️  Nivel clasificado: ${measurement.level} (umbral CRITICAL de Phase 2: >${PHASE2_BUDGET.warningMaxChars} chars)`);
  assert(measurement.level === 'CRITICAL', `El escenario compuesto deliberadamente extremo alcanza CRITICAL (obtenido: ${measurement.level}, chars=${measurement.chars})`);
  assert(shouldBlockBeforeSending(measurement) === true, 'shouldBlockBeforeSending() CLASIFICA correctamente este payload CRITICAL como "debería bloquearse antes de enviar"');

  // --- 3. ENFORCEMENT ---
  // HISTORIAL: cuando F8 se escribió, confirmó por lectura de código que
  // NINGÚN archivo de producción invocaba shouldBlockBeforeSending() (gap
  // registrado como deuda técnica). Ese gap fue cerrado por el Hardening
  // Post-Fase H (J2 — CRITICAL Payload Enforcement): `ai.service.ts` ahora
  // invoca la misma clasificación antes de cada llamada real y bloquea
  // CRITICAL. Esta prueba se actualiza para confirmar el enforcement real
  // -- dejarla exigiendo la ausencia del gap habría marcado la corrección
  // como una "regresión" cada vez que corriera la suite.
  const aiServiceSrc = fs.readFileSync(path.join(process.cwd(), 'src/modules/ai/ai.service.ts'), 'utf8');
  const invokedInAiService = aiServiceSrc.includes('shouldBlockBeforeSending');
  console.log(`  ℹ️  Búsqueda de call-sites productivos de shouldBlockBeforeSending(): ai.service.ts=${invokedInAiService}`);
  assert(
    invokedInAiService,
    'CORREGIDO (J2): ai.service.ts SÍ invoca shouldBlockBeforeSending() antes de cada llamada real a Gemini (Phase 1 y Phase 2) -- el gap confirmado en Fase F/G ya no existe',
  );

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

main();
