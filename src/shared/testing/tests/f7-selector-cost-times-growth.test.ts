import { automationService } from '@/modules/automation/automation.service';
import { aiService, sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';
import { buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildSyntheticMongooseEvidence, toEvidenceInput, SyntheticLink } from '@/shared/testing/synthetic-mongoose-evidence';
import { buildDeepChainHtml } from '@/shared/testing/stress-generators';
import { measurePayload } from '@/shared/testing/payload-budgets';

/**
 * Fase F — F7: DOM ruidoso/profundo × crecimiento multi-snapshot (F4 × F5),
 * MECANISMO HÍBRIDO: se captura UNA sola vez, con Playwright real, el DOM
 * costoso en selectores de F4 (depth=20, branches=8) — luego esa misma
 * evidencia YA capturada se reinyecta a través de 8 iteraciones sintéticas
 * (patrón de F5/T6), sin volver a levantar Playwright por iteración.
 *
 * COMBINATORIA: pregunta que ni F4 ni F5 responden por separado — cuando
 * el MISMO conjunto de selectores costosos aparece IDÉNTICO en las 8
 * iteraciones (el caso real de una página que no cambia entre pasos de
 * exploración), ¿el dedup los colapsa a 1 aparición (costo pagado una
 * sola vez) o el costo se multiplica ×8 porque el dedup no opera sobre
 * este tipo de evidencia entre iteraciones?
 *
 * PREDICCIÓN ANTES DE EJECUTAR: dado que `linkKey` (evidence-deduplication.
 * service.ts) exige coincidencia EXACTA de selector+text+href+... y los 8
 * enlaces profundos son BYTE-IDÉNTICOS en cada iteración (mismo DOM
 * estático recapturado), `dedupedLinks.length` debe ser EXACTAMENTE 8
 * (no 8×8=64) — el costo de los selectores se paga UNA vez, no se
 * multiplica por el número de iteraciones.
 */
async function main() {
  console.log('🧪 Starting F7 — Selector Cost × Snapshot Growth, Hybrid Combinatorial (Fase F)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- Captura REAL, una sola vez (Playwright) ---
  const DEPTH = 20;
  const BRANCHES = 8;
  const evalId = 'f7-deep-chain-capture';
  await automationService.attachTestSession(evalId, buildDeepChainHtml(DEPTH, BRANCHES));
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  assert(snapshot.links.length === BRANCHES, `Se capturan los ${BRANCHES} enlaces profundos reales (obtenido: ${snapshot.links.length})`);
  const capturedLinks: SyntheticLink[] = snapshot.links.map((l) => ({
    selector: l.selector!, text: l.text, href: l.href, ariaLabel: l.ariaLabel, role: l.role, isExternal: l.isExternal,
  }));
  const avgSelectorLen = capturedLinks.reduce((s, l) => s + l.selector.length, 0) / capturedLinks.length;
  console.log(`  ℹ️  Selectores capturados (depth=${DEPTH}, branches=${BRANCHES}): avgLen=${avgSelectorLen.toFixed(1)}c`);

  // --- Reinyección sintética a través de 8 iteraciones (patrón F5/T6) ---
  const ITERATIONS = 8;
  const docs = Array.from({ length: ITERATIONS }).map((_, i) =>
    buildSyntheticMongooseEvidence({ iteration: i + 1, links: capturedLinks }), // MISMO DOM cada iteración (byte-idéntico)
  );
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(docs.map((d) => toEvidenceInput(d)));

  console.log(`  ℹ️  dedupedLinks.length tras ${ITERATIONS} iteraciones idénticas = ${dedupedLinks.length} (esperado: ${BRANCHES}, NO ${BRANCHES * ITERATIONS})`);
  assert(dedupedLinks.length === BRANCHES, `El costo de los selectores profundos se paga UNA sola vez — el dedup colapsa las ${ITERATIONS} repeticiones idénticas a ${BRANCHES} entradas (obtenido: ${dedupedLinks.length})`);
  assert(
    dedupedLinks.every((l: any) => JSON.stringify(l.iterations) === JSON.stringify(Array.from({ length: ITERATIONS }, (_, i) => i + 1))),
    `Cada uno de los ${BRANCHES} selectores queda marcado como presente en las 8 iteraciones (iterations=[1..8]), preservando CUÁNDO estuvo presente sin repetir el objeto`,
  );

  // --- Medición del ratio de crecimiento real: 1 iteración vs. 8 ---
  const singleIterationCtx = buildDeduplicatedEvidenceContext([toEvidenceInput(docs[0])]);
  const sanitizedSingle = sanitizeEvidenceForGemini(singleIterationCtx.evidencesSummary as any);
  const sanitizedFull = sanitizeEvidenceForGemini(evidencesSummary as any);
  const inputFor = (sanitized: any, dl: any, snap: number) => ({
    evaluationId: `f7-${snap}`, title: 'F7', url: 'https://fixture.local/f7',
    archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
    completedSteps: [], previousActions: [], snapshotsCount: snap,
    evidencesSummary: sanitized, dedupedLandmarks, dedupedLinks: dl, dedupedButtons, accessibilityTrees: [],
  });
  const promptSingle: string = (aiService as any).buildV2AuditPrompt(inputFor(sanitizedSingle, singleIterationCtx.dedupedLinks, 1));
  const promptFull: string = (aiService as any).buildV2AuditPrompt(inputFor(sanitizedFull, dedupedLinks, ITERATIONS));

  const growthRatio = promptFull.length / promptSingle.length;
  console.log(`  ℹ️  chars(1 iteración)=${promptSingle.length} chars(${ITERATIONS} iteraciones)=${promptFull.length} ratio=${growthRatio.toFixed(3)}x (lineal ingenuo sería ${ITERATIONS}.0x)`);
  assert(growthRatio < 1.3, `El crecimiento de 1->${ITERATIONS} iteraciones con selectores costosos idénticos es MUY sub-lineal (ratio=${growthRatio.toFixed(3)}x, lejos de ${ITERATIONS}.0x) — el dedup neutraliza la multiplicación del costo de selectores por iteración`);

  const measurement = measurePayload(2, promptFull);
  console.log(`  ℹ️  Payload Audit: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
  assert(measurement.level === 'NORMAL', `El nivel permanece NORMAL (level=${measurement.level}) — confirma que la combinación de selectores costosos + 8 iteraciones NO es, por sí sola, un riesgo de payload`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
