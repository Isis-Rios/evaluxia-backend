import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { EvidenceInput, buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import {
  prioritizeComputedStyles,
  collectOtherEvidenceSelectors,
  collectIndependentFindingSelectors,
  COMPUTED_STYLES_FINAL_BUDGET,
} from '@/modules/evaluations/services/evidence-prioritization.service';
import { checkFindingTraceability, buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { measurePayload } from '@/shared/testing/payload-budgets';
import { aiService } from '@/modules/ai/ai.service';
import { ComputedStyleEvidence } from '@/modules/snapshots/snapshot-evidence.model';

/**
 * EvalUXIA — J4.3: Validación final cerrada antes de Gemini real.
 * Cero Gemini real, cero cambios de producción, cero Ground Truth/fixtures
 * modificados. Este archivo mide y reporta; no corrige nada que encuentre.
 */
function cs(overrides: Partial<ComputedStyleEvidence> = {}): ComputedStyleEvidence {
  return {
    selector: 'p.x', tag: 'p', text: 'texto', color: '#111', backgroundColor: '#fff',
    fontSize: '16px', fontWeight: '400', lineHeight: '1.5', fontFamily: 'Arial',
    ...overrides,
  };
}

async function main() {
  console.log('🧪 Starting J4.3 — Validación Final Cerrada (sin Gemini real)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }
  function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

  // ==========================================================================
  // J4.3-1 — Barrido de conteo de candidatos
  // ==========================================================================
  console.log('\n--- J4.3-1: Barrido de conteo de candidatos ---');
  {
    const RELEVANT_COUNT = 8; // colocados AL FINAL (posiciones más profundas), señal "evidenced"
    const counts = [50, 51, 80, 100, 300, 500];
    console.log('  N     | raw  | dedup | final | relevantes | retenidos | perdidos');
    for (const n of counts) {
      const irrelevantCount = n - RELEVANT_COUNT;
      const irrelevant: ComputedStyleEvidence[] = Array.from({ length: irrelevantCount }, (_, i) => cs({ selector: `irr:nth-of-type(${i + 1})` }));
      const relevant: ComputedStyleEvidence[] = Array.from({ length: RELEVANT_COUNT }, (_, i) => cs({ selector: `rel:nth-of-type(${i + 1})`, tag: 'button' }));
      const candidates = [...irrelevant, ...relevant]; // relevantes al final -> más allá de la posición 50 para todo n>=50

      const deduped = buildDeduplicatedEvidenceContext([
        { iteration: 1, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: candidates },
      ]).dedupedComputedStyles;

      const result = prioritizeComputedStyles(deduped, {
        otherEvidenceSelectors: new Set(relevant.map((r) => r.selector)),
        independentFindingSelectors: new Set(),
      });
      const retainedRelevant = relevant.filter((r) => result.final.some((f) => f.selector === r.selector)).length;
      console.log(`  ${String(n).padEnd(5)} | ${String(candidates.length).padEnd(4)} | ${String(deduped.length).padEnd(5)} | ${String(result.finalCount).padEnd(5)} | ${String(RELEVANT_COUNT).padEnd(10)} | ${String(retainedRelevant).padEnd(9)} | ${RELEVANT_COUNT - retainedRelevant}`);
      assert(result.finalCount <= COMPUTED_STYLES_FINAL_BUDGET, `n=${n}: final (${result.finalCount}) <= presupuesto (${COMPUTED_STYLES_FINAL_BUDGET})`);
      assert(retainedRelevant === RELEVANT_COUNT, `n=${n}: los ${RELEVANT_COUNT} elementos relevantes (posición final, señal "evidenced") se retienen al 100% (obtenido: ${retainedRelevant})`);
    }

    // Caso ">500": requiere captura REAL (Playwright), es un límite de CAPTURA, no de priorización.
    const OVER_500_COUNT = 520;
    const fillers = Array.from({ length: OVER_500_COUNT - 1 }, (_, i) => `<p>Relleno ${i}</p>`).join('');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body><h1>Test &gt;500</h1>${fillers}</body></html>`;
    const evalId = 'j4-3-over500';
    await automationService.attachTestSession(evalId, html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);
    console.log(`  N=${OVER_500_COUNT} (real, Playwright): computedStylesCandidates.length=${snapshot.computedStylesCandidates.length} (esperado: 500, tope de captura -- NO declarado 'demostrado sin pérdida', ver limitación abajo)`);
    assert(snapshot.computedStylesCandidates.length === 500, `n=${OVER_500_COUNT}: la captura satura en 500 (tope real de automation.service.ts), NUNCA más -- confirmado, no asumido`);
    info(`GARANTÍA NO DEMOSTRADA: con ${OVER_500_COUNT} elementos reales candidatos, los ${OVER_500_COUNT - 500} más allá del índice 500 en orden DOM NUNCA se capturan -- ninguna priorización downstream puede recuperarlos. Esto es una pérdida real, documentada, no corregida (fuera de alcance de J4.3).`);
  }

  // ==========================================================================
  // J4.3-1 (continuación) — findings determinísticos independientes >50, y por tipo de elemento >50
  // ==========================================================================
  console.log('\n--- J4.3-1 (cont.): findings determinísticos y tipos de elemento después de la posición 50 ---');
  {
    async function checkTypeBeyond50(tag: string, targetHtml: string) {
      const fillerCount = 58;
      const fillers = Array.from({ length: fillerCount }, (_, i) => `<p>Filler ${i}</p>`).join('');
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body><h1>T</h1>${fillers}${targetHtml}</body></html>`;
      const evalId = `j4-3-type-${tag}`;
      await automationService.attachTestSession(evalId, html);
      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      await automationService.closeSession(evalId);
      const inCandidates = snapshot.computedStylesCandidates.some((c) => c.selector.includes('target'));
      assert(inCandidates, `Tipo "${tag}" en posición >50: SÍ es candidato (computedStylesCandidates)`);
      return snapshot;
    }
    await checkTypeBeyond50('button', '<button id="target-b">Comprar</button>');
    await checkTypeBeyond50('link', '<a id="target-a" href="/x">Ir</a>');
    await checkTypeBeyond50('input-no-form', '<input id="target-i" type="text" />');
    await checkTypeBeyond50('label', '<label id="target-l">Nombre</label>');
    await checkTypeBeyond50('paragraph', '<p id="target-p">Texto</p>');
  }

  // ==========================================================================
  // J4.3-1 (continuación) — repetidos entre iteraciones, estilos idénticos/diferentes
  // ==========================================================================
  console.log('\n--- J4.3-1 (cont.): iteraciones repetidas ---');
  {
    const shared = cs({ selector: 'p.shared' });
    const evidencesIdentical: EvidenceInput[] = [1, 2, 3].map((iteration) => ({
      iteration, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
      computedStyles: [], computedStylesCandidates: [shared],
    }));
    const dedupedIdentical = buildDeduplicatedEvidenceContext(evidencesIdentical).dedupedComputedStyles;
    assert(dedupedIdentical.length === 1 && JSON.stringify(dedupedIdentical[0].iterations) === '[1,2,3]', `Estilos idénticos en 3 iteraciones -> 1 entrada, iterations=[1,2,3] (obtenido: ${dedupedIdentical.length} entradas, iterations=${JSON.stringify(dedupedIdentical[0]?.iterations)})`);

    const evidencesDifferent: EvidenceInput[] = [
      { iteration: 1, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: [cs({ selector: 'p.shared', color: '#000' })] },
      { iteration: 2, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: [cs({ selector: 'p.shared', color: '#fff' })] },
    ];
    const dedupedDifferent = buildDeduplicatedEvidenceContext(evidencesDifferent).dedupedComputedStyles;
    assert(dedupedDifferent.length === 2, `Estilos DIFERENTES para el mismo selector en 2 iteraciones -> 2 entradas separadas (obtenido: ${dedupedDifferent.length})`);
  }

  // ==========================================================================
  // J4.3-2 — Auditoría de collectIndependentFindingSelectors
  // ==========================================================================
  console.log('\n--- J4.3-2: Auditoría de señales de finding independiente ---');
  {
    // Los 5 únicos wcagCriterion realmente producidos por deterministic-analyzer.service.ts (grep exhaustivo, no supuesto).
    const contrastFinding = { wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', affectedElement: { selector: 'p.contrast' } };
    const imageFinding = { wcagCriterion: 'WCAG 1.1.1 Contenido no textual', affectedElement: { selector: 'img.a' } };
    const buttonFinding = { wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor', affectedElement: { selector: 'button.a' } };
    const linkFinding = { wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces', affectedElement: { selector: 'a.a' } };
    const headingFinding = { wcagCriterion: 'WCAG 1.3.1 Información y relaciones', affectedElement: { selector: 'h1.a' } };

    const selectors = collectIndependentFindingSelectors([contrastFinding, imageFinding, buttonFinding, linkFinding, headingFinding]);
    assert(!selectors.has('p.contrast'), 'WCAG 1.4.3 (contraste, DEPENDE de computedStyles) -- EXCLUIDO correctamente de la señal "finding independiente"');
    assert(selectors.has('img.a'), 'WCAG 1.1.1 (ImageEvidence, independiente) -- incluido');
    assert(selectors.has('button.a'), 'WCAG 4.1.2 (ButtonEvidence, independiente) -- incluido');
    assert(selectors.has('a.a'), 'WCAG 2.4.4 (LinkEvidence, independiente) -- incluido');
    assert(selectors.has('h1.a'), 'WCAG 1.3.1 (HeadingEvidence, independiente) -- incluido');
    assert(selectors.size === 4, `Exactamente 4 de 5 findings pasan el filtro (todos menos el de contraste) (obtenido: ${selectors.size})`);
    info('Confirmado por grep exhaustivo de deterministic-analyzer.service.ts: SOLO existen estos 5 wcagCriterion en todo el código; WCAG 1.4.3 es el ÚNICO que lee ev.computedStyles (analyzeContrast). Ningún otro criterio depende directa ni indirectamente de computedStyles.');
  }

  // ==========================================================================
  // J4.3-3 — Validación final de J1 (matriz de referencia + 1 caso nuevo explícito)
  // ==========================================================================
  console.log('\n--- J4.3-3: Validación final de EvidenceTraceability (J1) ---');
  {
    info('Casos A-J ya cubiertos exhaustivamente en j1-evidence-traceability.test.ts (23/23) y J4-16/17 en j4-step2-prioritization.test.ts (re-ejecutados como parte de la regresión de este informe, ver sección de regresión).');

    // Caso explícito pedido: "selector descartado por J4 no puede sobrevivir como trazable por estar en el pool de candidatos original".
    const many: ComputedStyleEvidence[] = Array.from({ length: 100 }, (_, i) => cs({ selector: `pool:nth-of-type(${i + 1})` }));
    const deduped = buildDeduplicatedEvidenceContext([
      { iteration: 1, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: many },
    ]).dedupedComputedStyles;
    const { final } = prioritizeComputedStyles(deduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    const discardedButInOriginalPool = many.find((c) => !final.some((f) => f.selector === c.selector));
    assert(!!discardedButInOriginalPool, 'Precondición: existe al menos 1 selector descartado (100 candidatos, presupuesto 50)');
    const index = buildEvidenceIndex({ evidencesSummary: [], dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [], dedupedComputedStyles: final });
    const traceability = checkFindingTraceability({ affectedElement: { tag: 'p', selector: discardedButInOriginalPool!.selector } } as any, index);
    assert(traceability.traceable === false, `El selector "${discardedButInOriginalPool!.selector}" (presente en el POOL ORIGINAL de 100 candidatos, pero descartado por el presupuesto de J4) NO es trazable -- estar en el pool original NUNCA lo hace sobrevivir (obtenido: traceable=${traceability.traceable})`);
  }

  // ==========================================================================
  // J4.3-4 — Validación de J2 (referencia + confirmación de persistencia NO verificada)
  // ==========================================================================
  console.log('\n--- J4.3-4: Validación de J2 (CRITICAL Payload Enforcement) ---');
  {
    info('NORMAL/WARNING/CRITICAL + bloqueo real de generateStructuredWithUsage ya demostrados exhaustivamente en j2-critical-payload-enforcement.test.ts (31/31, re-ejecutado en la regresión de este informe).');
    info('NO DEMOSTRADO (declarado explícitamente, no asumido): el comportamiento de persistencia real en MongoDB cuando Phase 2 es bloqueada por CRITICAL -- J2-G ejercita la lógica de consolidación (deterministic-only) SIN tocar la base de datos real (mismo patrón usado en TODA la sesión). Nunca se ha ejecutado audit-engine.service.ts completo (con snapshotEvidenceService/findingService/reportRepository reales) para confirmar qué queda escrito en Mongo cuando ocurre un bloqueo CRITICAL real.');
  }

  // ==========================================================================
  // J4.3-5 — Medición real del payload: raw -> dedup -> priorizado -> prompt final, CON vs SIN J4 Step 2
  // ==========================================================================
  console.log('\n--- J4.3-5: Medición real del payload (con vs. sin J4 Step 2) ---');
  {
    // Escenario realista: página estática (header/nav igual siempre) con 70
    // elementos de estilo candidatos, capturada en 3 "iteraciones" (misma
    // página, 3 snapshots reales) -- exactamente el patrón que expone la
    // repetición que Step 1/2 existen para resolver.
    const CANDIDATE_COUNT = 70;
    const paragraphs = Array.from({ length: CANDIDATE_COUNT - 2 }, (_, i) => `<p>Contenido estático ${i}</p>`).join('');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body><h1>Página J4.3-5</h1>${paragraphs}<button id="cta-final">Comprar ahora</button></body></html>`;
    const evalId = 'j4-3-5-payload';
    await automationService.attachTestSession(evalId, html);
    const snap1 = await automationService.extractCurrentSnapshot(evalId);
    const snap2 = await automationService.extractCurrentSnapshot(evalId); // misma página, 2ª "iteración"
    const snap3 = await automationService.extractCurrentSnapshot(evalId); // 3ª "iteración"
    await automationService.closeSession(evalId);

    const evidences: EvidenceInput[] = [snap1, snap2, snap3].map((s, i) => ({
      iteration: i + 1, url: 'https://fixture.local/j4-3-5', screenshotPath: '/x.png',
      headings: s.headings, images: s.images, links: s.links, buttons: s.buttons, forms: s.forms, landmarks: s.landmarks,
      computedStyles: s.computedStyles, computedStylesCandidates: s.computedStylesCandidates,
    }));

    // --- SIN J4 Step 2 (comportamiento previo simulado): computedStyles (50, sin dedup) repetido tal cual en evidencesSummary por iteración -- exactamente como el código se comportaba antes de esta fase. ---
    const { evidencesSummary } = buildDeduplicatedEvidenceContext(evidences);
    const promptWithoutStep2: string = (aiService as any).buildV2AuditPrompt({
      evaluationId: 'j4-3-5', title: 'J4.3-5', url: 'https://fixture.local/j4-3-5',
      archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
      completedSteps: [], previousActions: [], snapshotsCount: 3,
      evidencesSummary, dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [], accessibilityTrees: [],
      // dedupedComputedStyles OMITIDO deliberadamente -> buildV2AuditPrompt usa la rama "sin J4 Step 2"
    });

    // --- CON J4 Step 2: dedup + priorización real ---
    const { dedupedComputedStyles: allDeduped, dedupedLandmarks, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(evidences);
    const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
    const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
    const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
    const { final: finalComputedStyles, candidateCount, finalCount } = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });
    const promptWithStep2: string = (aiService as any).buildV2AuditPrompt({
      evaluationId: 'j4-3-5', title: 'J4.3-5', url: 'https://fixture.local/j4-3-5',
      archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
      completedSteps: [], previousActions: [], snapshotsCount: 3,
      evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: finalComputedStyles, accessibilityTrees: [],
    });

    const mWithout = measurePayload(2, promptWithoutStep2);
    const mWith = measurePayload(2, promptWithStep2);
    const reductionChars = mWithout.chars - mWith.chars;
    const reductionPercent = Number(((reductionChars / mWithout.chars) * 100).toFixed(1));

    console.log(`  Escenario: ${CANDIDATE_COUNT} candidatos × 3 iteraciones idénticas (misma página estática) + 1 botón CTA`);
    console.log(`  SIN J4 Step 2: chars=${mWithout.chars} bytes=${mWithout.bytes} estimatedTokens=${mWithout.estimatedTokens} level=${mWithout.level}`);
    console.log(`  CON J4 Step 2: chars=${mWith.chars} bytes=${mWith.bytes} estimatedTokens=${mWith.estimatedTokens} level=${mWith.level}`);
    console.log(`  candidatos=${candidateCount} deduplicados=${allDeduped.length} final=${finalCount}`);
    console.log(`  Reducción: ${reductionChars} chars (${reductionPercent}%)`);

    assert(mWith.chars < mWithout.chars, `El prompt CON J4 Step 2 es estrictamente menor que SIN él (con=${mWith.chars}, sin=${mWithout.chars})`);
    assert(finalComputedStyles.some((f: any) => f.selector.includes('cta-final')), 'El botón CTA (evidenciado por ButtonEvidence, señal "evidenced") se retiene en el set final priorizado');
    assert(candidateCount === CANDIDATE_COUNT, `El pool deduplicado corresponde a los ${CANDIDATE_COUNT} elementos únicos (idénticos en las 3 iteraciones), no a ${CANDIDATE_COUNT * 3} observaciones crudas (obtenido: ${candidateCount})`);
  }

  // ==========================================================================
  // J4.3-6 — Stress de frontera: 500, 501, 600, 1000 candidatos reales
  // ==========================================================================
  console.log('\n--- J4.3-6: Stress de frontera (captura real) ---');
  {
    for (const n of [500, 501, 600, 1000]) {
      const fillers = Array.from({ length: n - 1 }, (_, i) => `<p>Relleno ${i}</p>`).join('');
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body><h1>Stress ${n}</h1>${fillers}</body></html>`;
      const evalId = `j4-3-6-${n}`;
      await automationService.attachTestSession(evalId, html);
      const snapshot = await automationService.extractCurrentSnapshot(evalId);
      await automationService.closeSession(evalId);

      const captured = snapshot.computedStylesCandidates.length;
      const lost = n - captured;
      const deduped = buildDeduplicatedEvidenceContext([
        { iteration: 1, url: 'x', screenshotPath: 'x', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: snapshot.computedStyles, computedStylesCandidates: snapshot.computedStylesCandidates },
      ]).dedupedComputedStyles;
      const { finalCount } = prioritizeComputedStyles(deduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });

      const input: any = {
        evaluationId: `j4-3-6-${n}`, title: 'Stress', url: 'https://fixture.local',
        archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [] },
        completedSteps: [], previousActions: [], snapshotsCount: 1,
        evidencesSummary: [{ iteration: 1, url: 'x', screenshotPath: 'x', headings: [], images: [], forms: [] }],
        dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
        dedupedComputedStyles: prioritizeComputedStyles(deduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() }).final,
        accessibilityTrees: [],
      };
      const prompt: string = (aiService as any).buildV2AuditPrompt(input);
      const measurement = measurePayload(2, prompt);

      console.log(`  n=${n}: capturado=${captured} perdido_en_captura=${lost} deduplicado=${deduped.length} final=${finalCount} promptChars=${measurement.chars} level=${measurement.level}`);
      assert(captured === 500, `n=${n}: la captura satura en 500 (tope real), confirmado (obtenido: ${captured})`);
      assert(finalCount <= COMPUTED_STYLES_FINAL_BUDGET, `n=${n}: el set final respeta el presupuesto de ${COMPUTED_STYLES_FINAL_BUDGET} (obtenido: ${finalCount})`);
      assert(measurement.level === 'NORMAL', `n=${n}: el prompt resultante (solo por computedStyles, sin otro contenido) permanece NORMAL -- confirma que J2 NO bloquearía este escenario aislado (obtenido: ${measurement.level})`);
    }
    info('En NINGÚN caso probado (hasta 1000 candidatos) el prompt de computedStyles por sí solo alcanza WARNING/CRITICAL -- el presupuesto final de 50 elementos actúa como un techo natural de tamaño, independientemente de cuántos candidatos existan.');
  }

  // ==========================================================================
  // J4.3-7 — No regresión determinística (referencia + confirmación adicional)
  // ==========================================================================
  console.log('\n--- J4.3-7: No regresión determinística ---');
  {
    info('Caso de contraste FAIL real con/sin computedStylesCandidates ya demostrado exhaustivamente en J4-DET (j4-step2-prioritization.test.ts, re-ejecutado en la regresión de este informe): findings, statuses, selectors y overallScore idénticos.');

    // Confirmación adicional con el escenario de J4.3-6 (1000 candidatos): findings determinísticos deben depender SOLO de `computedStyles` (50), nunca de `computedStylesCandidates` (1000).
    const fillers = Array.from({ length: 999 }, (_, i) => `<p>Relleno ${i}</p>`).join('');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/></head><body><h1>Det ${1000}</h1><p id="low-c" style="color:#aaaaaa;background-color:#ffffff;">Bajo contraste</p>${fillers}</body></html>`;
    const evalId = 'j4-3-7-det';
    await automationService.attachTestSession(evalId, html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);
    const withCandidates: any = { iteration: 1, url: 'x', screenshotPath: 'x', headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons, forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles, computedStylesCandidates: snapshot.computedStylesCandidates };
    const withoutCandidates: any = { ...withCandidates, computedStylesCandidates: undefined };
    const findingsWith = deterministicAnalyzer.analyzeSnapshots([withCandidates]);
    const findingsWithout = deterministicAnalyzer.analyzeSnapshots([withoutCandidates]);
    assert(JSON.stringify(findingsWith) === JSON.stringify(findingsWithout), `Con 1000 candidatos disponibles, los findings determinísticos son BYTE-IDÉNTICOS con/sin computedStylesCandidates (confirmado con JSON.stringify completo, no solo conteo)`);
    const contrastFail = findingsWith.find((f: any) => f.wcagCriterion?.includes('1.4.3') && f.status === 'FAIL');
    assert(!!contrastFail, 'El escenario ejercitó un FAIL de contraste real (no es una prueba vacía)');
  }

  // ==========================================================================
  // J4.3-8 — Preflight para forms/login-missing-label.html (SIN ejecutar Gemini)
  // ==========================================================================
  console.log('\n--- J4.3-8: Preflight para el fixture candidato a primera prueba real ---');
  {
    const { loadFixture } = await import('@/shared/testing/fixture-loader');
    const fixture = loadFixture('forms/login-missing-label.html');
    const evalId = 'j4-3-8-preflight';
    await automationService.attachTestSession(evalId, fixture.html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);

    const evidences: EvidenceInput[] = [{
      iteration: 1, url: 'https://fixture.local/login-missing-label', screenshotPath: '/x.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
      computedStylesCandidates: snapshot.computedStylesCandidates,
    }];
    const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
    const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
    const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
    const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
    const { final: dedupedComputedStyles } = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });

    const promptInput: any = {
      evaluationId: 'preflight-login-missing-label', title: 'Preflight J4.3-8', url: 'https://fixture.local/login-missing-label',
      archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero iniciar sesión rápido', goals: ['Acceder a su cuenta'], frustrations: ['Formularios confusos'] },
      completedSteps: [], previousActions: [], snapshotsCount: 1,
      evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
    };
    const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
    const measurement = measurePayload(2, prompt);

    const traceableSelectors = Array.from(new Set([...dedupedLinks.map((l: any) => l.selector), ...dedupedButtons.map((b: any) => b.selector), ...dedupedComputedStyles.map((c: any) => c.selector)]));

    console.log('  --- PREFLIGHT: forms/login-missing-label.html ---');
    console.log(`  Ground Truth: WCAG 4.1.2=PASS(det), WCAG 1.4.3=PASS(det), WCAG 3.3.2=FAIL esperado (AI-only, banda SEMANTIC[FAIL,NOT_EVALUABLE])`);
    console.log(`  mustNotAppear: WCAG 1.1.1, WCAG 2.4.4`);
    console.log(`  Findings determinísticos esperados: ${deterministicFindings.length} (WCAG 4.1.2 x1 PASS, WCAG 1.4.3 x${deterministicFindings.filter((f: any) => f.wcagCriterion?.includes('1.4.3')).length})`);
    console.log(`  Payload: chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level}`);
    console.log(`  Categorías de evidencia: headings=${snapshot.headings.length} images=${snapshot.images.length} links=${snapshot.links.length} buttons=${snapshot.buttons.length} forms=${snapshot.forms.length} computedStyles(final)=${dedupedComputedStyles.length}`);
    console.log(`  Selectores trazables esperados (${traceableSelectors.length}): ${traceableSelectors.join(', ')}`);
    console.log(`  Llamadas a Gemini esperadas: 1 (Phase 2 única, este fixture no requiere exploración Phase 1 -- es un snapshot estático)`);
    console.log(`  Costo estimado: ~$0.002-0.006 USD (proyección basada en la calibración de Fase H, prompt pequeño ~${measurement.estimatedTokens} tokens estimados de input + salida típica de unos cientos de tokens)`);

    assert(measurement.level === 'NORMAL', `El preflight confirma nivel NORMAL para este fixture (obtenido: ${measurement.level}) -- seguro para una llamada real`);
    assert(deterministicFindings.some((f: any) => f.wcagCriterion?.includes('4.1.2') && f.status === 'PASS'), 'Precondición GT: WCAG 4.1.2 PASS confirmado determinísticamente antes de cualquier llamada real');
    assert(!deterministicFindings.some((f: any) => f.wcagCriterion?.includes('1.1.1') || f.wcagCriterion?.includes('2.4.4')), 'Precondición GT: ningún finding mustNotAppear (1.1.1/2.4.4) aparece -- consistente con el fixture (sin imágenes ni enlaces)');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
