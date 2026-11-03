import { automationService } from '@/modules/automation/automation.service';
import { buildDeepChainHtml } from '@/shared/testing/stress-generators';
import { estimateTokensFromChars } from '@/shared/testing/payload-budgets';

/**
 * Fase F — F4: Profundidad/anchura extrema de selectores. Extiende T7/D3
 * (depth=5, branches=8 fijos) midiendo la CURVA de costo real al variar
 * profundidad (5/10/20/40) y anchura (8/50 ramas), en vez de un solo punto.
 *
 * AISLADA: dos sub-dimensiones del mismo factor (selectores), medidas por
 * separado (profundidad a anchura fija, luego anchura a profundidad fija)
 * — no se combinan entre sí todavía (eso sería otro factor).
 *
 * PREDICCIÓN ANTES DE EJECUTAR: cada nivel de anidamiento de un único hijo
 * agrega un segmento fijo a la cadena de ancestros (`tag:nth-of-type(n)`
 * cuando se necesita, o solo `tag` cuando no hay ambigüedad en ese nivel)
 * hasta llegar al primer nivel con hermanos >1 (las `branches` raíz) —
 * el crecimiento de longitud del selector debe ser LINEAL en profundidad,
 * nunca peor. La unicidad (0 selectores duplicados) debe sostenerse en
 * TODOS los puntos, incluso en el caso más ancho.
 */
async function measureSelectors(depth: number, branches: number): Promise<{ selectors: string[]; ms: number }> {
  const evalId = `f4-d${depth}-b${branches}`;
  const html = buildDeepChainHtml(depth, branches);
  const t0 = Date.now();
  await automationService.attachTestSession(evalId, html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  const ms = Date.now() - t0;
  await automationService.closeSession(evalId);
  return { selectors: snapshot.links.map((l) => l.selector!), ms };
}

async function main() {
  console.log('🧪 Starting F4 — Deep/Wide Selector Scaling Curve (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const BRANCHES_FIXED = 8;
  const depths = [5, 10, 20, 40];
  const depthResults = [];
  for (const depth of depths) {
    const r = await measureSelectors(depth, BRANCHES_FIXED);
    const uniqueCount = new Set(r.selectors).size;
    const avgLen = r.selectors.reduce((s, sel) => s + sel.length, 0) / r.selectors.length;
    depthResults.push({ depth, uniqueCount, avgLen, total: r.selectors.length, ms: r.ms });
    console.log(`  ℹ️  depth=${depth} branches=${BRANCHES_FIXED} -> selectores únicos=${uniqueCount}/${r.selectors.length} avgLen=${avgLen.toFixed(1)}c tiempo=${r.ms}ms`);
  }

  depthResults.forEach((r) => {
    assert(r.uniqueCount === r.total, `depth=${r.depth}: los ${r.total} selectores son TODOS únicos (obtenido: ${r.uniqueCount})`);
  });

  // Crecimiento lineal esperado: avgLen(40) / avgLen(5) debe ser
  // aproximadamente 40/5=8x, no superlineal (ej. cuadrático daría ~64x).
  const len5 = depthResults.find((r) => r.depth === 5)!.avgLen;
  const len40 = depthResults.find((r) => r.depth === 40)!.avgLen;
  const growthRatio = len40 / len5;
  const depthRatio = 40 / 5;
  console.log(`  ℹ️  Crecimiento de longitud de selector: depth 5->40 (8x profundidad) => ratio de longitud=${growthRatio.toFixed(2)}x`);
  assert(growthRatio < depthRatio * 1.5, `El crecimiento de longitud del selector es LINEAL (o mejor) respecto a la profundidad (ratio=${growthRatio.toFixed(2)}x para 8x más profundidad, tope aceptado=${(depthRatio * 1.5).toFixed(1)}x) — no superlineal`);

  // --- Anchura: fijar profundidad, variar ramas ---
  const DEPTH_FIXED = 10;
  const widths = [8, 50];
  const widthResults = [];
  for (const branches of widths) {
    const r = await measureSelectors(DEPTH_FIXED, branches);
    const uniqueCount = new Set(r.selectors).size;
    widthResults.push({ branches, uniqueCount, total: r.selectors.length, ms: r.ms });
    console.log(`  ℹ️  depth=${DEPTH_FIXED} branches=${branches} -> selectores únicos=${uniqueCount}/${r.selectors.length} tiempo=${r.ms}ms`);
  }
  widthResults.forEach((r) => {
    assert(r.uniqueCount === r.total, `branches=${r.branches}: los ${r.total} selectores raíz siguen siendo TODOS únicos incluso con muchos hermanos (obtenido: ${r.uniqueCount})`);
  });

  // Costo en payload de los selectores es marginal incluso en el peor caso
  // (confirma T7's hallazgo "+<100 chars/selector" ahora a profundidad 40).
  const worstCase = depthResults.find((r) => r.depth === 40)!;
  const worstCaseTotalChars = worstCase.avgLen * worstCase.total;
  const worstCaseTokens = estimateTokensFromChars(worstCaseTotalChars);
  console.log(`  ℹ️  Peor caso (depth=40, ${worstCase.total} selectores): ~${worstCaseTotalChars.toFixed(0)} chars totales (~${worstCaseTokens} tokens est.)`);
  assert(worstCaseTokens < 1000, `El costo total de selectores en el peor caso probado sigue siendo una fracción pequeña de cualquier presupuesto de fase (${worstCaseTokens} tokens est.)`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
