import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { EvidenceInput, buildDeduplicatedEvidenceContext } from '@/modules/evaluations/services/evidence-deduplication.service';
import {
  prioritizeComputedStyles,
  collectOtherEvidenceSelectors,
  collectIndependentFindingSelectors,
  COMPUTED_STYLES_FINAL_BUDGET,
} from '@/modules/evaluations/services/evidence-prioritization.service';
import { checkFindingTraceability } from '@/modules/evaluations/services/evidence-traceability.service';
import { runMockedPhase2Pipeline, stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { ComputedStyleEvidence, ButtonEvidence, LinkEvidence } from '@/modules/snapshots/snapshot-evidence.model';

/**
 * Hardening Post-Fase H — J4 Step 2 (2a + 2b): ComputedStyles Prioritization.
 *
 * J4-1..J4-6 usan Playwright real (attachTestSession) para confirmar el
 * cambio de CAPTURA (Step 2a). El resto usa evidencia sintética / el mock
 * harness (Step 2b + integración) — cero Gemini real en toda la suite.
 */
function buildFixtureWithTargetAtPosition(targetHtml: string, position: number): string {
  // position es 1-based sobre el selector de captura ('h1,...,p'). El <h1>
  // cuenta como elemento #1; se agregan (position - 2) <p> de relleno antes
  // del target para que el target caiga exactamente en `position`.
  const fillerCount = Math.max(0, position - 2);
  const fillers = Array.from({ length: fillerCount }, (_, i) => `<p>Filler párrafo ${i}</p>`).join('\n');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" /></head><body><h1>Página de prueba J4 Step 2</h1>${fillers}${targetHtml}</body></html>`;
}

function cs(overrides: Partial<ComputedStyleEvidence> = {}): ComputedStyleEvidence {
  return {
    selector: 'p.x', tag: 'p', text: 'texto', color: '#111', backgroundColor: '#fff',
    fontSize: '16px', fontWeight: '400', lineHeight: '1.5', fontFamily: 'Arial',
    ...overrides,
  };
}

async function main() {
  console.log('🧪 Starting J4 Step 2 — ComputedStyles Prioritization (Hardening Post-Fase H)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ==========================================================================
  // J4-1..J4-6 — captura real (Step 2a): elemento relevante en posición >50 SÍ es candidato
  // ==========================================================================
  const POSITION_BEYOND_CAP = 60;
  const targets: Array<{ label: string; html: string; expectedSelectorFragment: string }> = [
    { label: 'J4-1/J4-2 (botón)', html: `<button id="target-btn">Comprar</button>`, expectedSelectorFragment: 'target-btn' },
    { label: 'J4-3 (link)', html: `<a href="/destino" id="target-link">Ir</a>`, expectedSelectorFragment: 'target-link' },
    { label: 'J4-4 (input sin form)', html: `<input id="target-input" type="text" />`, expectedSelectorFragment: 'target-input' },
    { label: 'J4-5 (label)', html: `<label id="target-label">Nombre:</label>`, expectedSelectorFragment: 'target-label' },
    { label: 'J4-6 (p)', html: `<p id="target-p">Párrafo objetivo</p>`, expectedSelectorFragment: 'target-p' },
  ];
  for (const t of targets) {
    const html = buildFixtureWithTargetAtPosition(t.html, POSITION_BEYOND_CAP);
    const evalId = `j4-step2-${t.expectedSelectorFragment}`;
    await automationService.attachTestSession(evalId, html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);

    const inCandidates = snapshot.computedStylesCandidates.some((c) => c.selector.includes(t.expectedSelectorFragment));
    const inSmall = snapshot.computedStyles.some((c) => c.selector.includes(t.expectedSelectorFragment));
    assert(inCandidates, `${t.label}: el elemento en posición ${POSITION_BEYOND_CAP} (>50) SÍ aparece en computedStylesCandidates`);
    assert(!inSmall, `${t.label}: el elemento en posición ${POSITION_BEYOND_CAP} sigue AUSENTE del campo pequeño computedStyles (50-cap) -- confirma que J4 Step 2a no cambió ese campo`);
    assert(snapshot.computedStyles.length === 50, `${t.label}: computedStyles (DeterministicAnalyzer-facing) sigue teniendo exactamente 50 elementos, sin cambios`);
  }

  // ==========================================================================
  // J4-7 — muchos elementos irrelevantes + relevantes al final (integración, sintético)
  // ==========================================================================
  {
    const IRRELEVANT_COUNT = 95;
    const irrelevant: ComputedStyleEvidence[] = Array.from({ length: IRRELEVANT_COUNT }, (_, i) => cs({ selector: `p:nth-of-type(${i + 1})`, text: `Relleno ${i}` }));
    const relevantButtons: ComputedStyleEvidence[] = Array.from({ length: 5 }, (_, i) => cs({ selector: `button:nth-of-type(${i + 1})`, tag: 'button', text: `Acción ${i}` }));
    const candidates = [...irrelevant, ...relevantButtons]; // relevantes AL FINAL, posiciones 96-100

    const dedupedCandidates = prioritizeComputedStyles(
      // Simula el output de deduplicateComputedStyles (Step 1) para 1 sola iteración -- usamos directamente los candidatos ya que dedup de una sola ocurrencia por selector no cambia nada aquí.
      candidates.map((c) => ({ ...c, iterations: [1] })),
      {
        otherEvidenceSelectors: new Set(relevantButtons.map((b) => b.selector)), // los 5 botones también existen como ButtonEvidence real
        independentFindingSelectors: new Set(),
      },
    );
    const retainedButtons = relevantButtons.filter((b) => dedupedCandidates.final.some((f) => f.selector === b.selector));
    assert(retainedButtons.length === 5, `J4-7: los 5 botones relevantes al FINAL de 100 elementos sobreviven la priorización (obtenido: ${retainedButtons.length}/5)`);
    assert(dedupedCandidates.finalCount <= COMPUTED_STYLES_FINAL_BUDGET, `J4-7: el set final respeta el presupuesto (${dedupedCandidates.finalCount} <= ${COMPUTED_STYLES_FINAL_BUDGET})`);
  }

  // ==========================================================================
  // J4-8 — deduplicación ANTES del presupuesto final
  // ==========================================================================
  {
    const UNIQUE_COUNT = 80; // > budget de 50
    const uniqueStyles: ComputedStyleEvidence[] = Array.from({ length: UNIQUE_COUNT }, (_, i) => cs({ selector: `el:nth-of-type(${i + 1})` }));
    const evidences: EvidenceInput[] = [1, 2, 3].map((iteration) => ({
      iteration, url: 'https://fixture.local/j4-8', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
      computedStyles: [], computedStylesCandidates: uniqueStyles, // MISMOS 80 elementos, idénticos, en las 3 iteraciones
    }));
    const { dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
    assert(allDeduped.length === UNIQUE_COUNT, `J4-8: tras deduplicar 3 iteraciones idénticas de 80 elementos, SIGUEN siendo 80 entradas únicas (no 240) -- confirma que dedup corrió (obtenido: ${allDeduped.length})`);

    const result = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    assert(result.candidateCount === UNIQUE_COUNT, `J4-8: la priorización operó sobre ${UNIQUE_COUNT} candidatos YA deduplicados, no sobre 240 observaciones crudas (obtenido: ${result.candidateCount})`);
    assert(result.finalCount === COMPUTED_STYLES_FINAL_BUDGET, `J4-8: el resultado final respeta el presupuesto (obtenido: ${result.finalCount})`);
  }

  // ==========================================================================
  // J4-9 — cinco iteraciones con contenido repetido: trazabilidad de iterations preservada en el FINAL set
  // ==========================================================================
  {
    const staticStyles: ComputedStyleEvidence[] = Array.from({ length: 10 }, (_, i) => cs({ selector: `stat:nth-of-type(${i + 1})` }));
    const evidences: EvidenceInput[] = [1, 2, 3, 4, 5].map((iteration) => ({
      iteration, url: 'https://fixture.local/j4-9', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
      computedStyles: [], computedStylesCandidates: staticStyles,
    }));
    const { dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
    const result = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    assert(result.final.length === 10, `J4-9: los 10 elementos estáticos caben enteros dentro del presupuesto (obtenido: ${result.final.length})`);
    assert(result.final.every((f: any) => JSON.stringify(f.iterations) === JSON.stringify([1, 2, 3, 4, 5])), 'J4-9: cada entrada del FINAL set conserva iterations=[1,2,3,4,5] -- la trazabilidad de iteración sobrevive la priorización, no solo la deduplicación');
  }

  // ==========================================================================
  // J4-10 — cambio real de estilo entre iteraciones: ambas versiones sobreviven
  // ==========================================================================
  {
    const evidences: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/j4-10', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: [cs({ selector: 'p.status', color: '#000000' })] },
      { iteration: 2, url: 'https://fixture.local/j4-10', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: [cs({ selector: 'p.status', color: '#ff0000' })] },
    ];
    const { dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
    assert(allDeduped.length === 2, `J4-10: 2 valores de color distintos para el mismo selector -> 2 entradas tras deduplicar (obtenido: ${allDeduped.length})`);
    const result = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    assert(result.final.length === 2, `J4-10: AMBAS versiones (color negro iteración 1, color rojo iteración 2) sobreviven la priorización -- ninguna se descarta por "elegir una" (obtenido: ${result.final.length})`);
  }

  // ==========================================================================
  // J4-11 — selector diferente + estilo idéntico -> no fusionar (confirmado end-to-end)
  // ==========================================================================
  {
    const evidences: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/j4-11', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [], computedStylesCandidates: [cs({ selector: 'p.a' }), cs({ selector: 'p.b' })] },
    ];
    const { dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
    const result = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    assert(result.final.length === 2, `J4-11: selectores distintos con estilos idénticos permanecen como 2 entradas separadas tras todo el pipeline (obtenido: ${result.final.length})`);
  }

  // ==========================================================================
  // J4-12 — finding determinístico independiente + computedStyle, más allá de la posición 50
  // ==========================================================================
  {
    // Un botón real, sin nombre accesible (genera FAIL WCAG 4.1.2, independiente de computedStyles), más 60 párrafos irrelevantes.
    const html = buildFixtureWithTargetAtPosition(`<button id="no-name-btn"></button>`, POSITION_BEYOND_CAP);
    const evalId = 'j4-12';
    await automationService.attachTestSession(evalId, html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);

    const evidences: EvidenceInput[] = [{
      iteration: 1, url: 'https://fixture.local/j4-12', screenshotPath: '/x.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
      computedStylesCandidates: snapshot.computedStylesCandidates,
    }];
    const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
    const noNameFinding = deterministicFindings.find((f: any) => f.wcagCriterion?.includes('4.1.2') && f.affectedElement?.selector?.includes('no-name-btn'));
    assert(!!noNameFinding && noNameFinding.status === 'FAIL', 'Precondición: el botón sin nombre SÍ produce un finding determinístico FAIL WCAG 4.1.2, independiente de computedStyles');

    const { dedupedComputedStyles: allDeduped, dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary } = buildDeduplicatedEvidenceContext(evidences);
    const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
    const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
    const result = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });

    const buttonStyleRetained = result.final.some((f: any) => f.selector.includes('no-name-btn'));
    assert(buttonStyleRetained, `J4-12: el computedStyle del botón (posición ${POSITION_BEYOND_CAP}, con finding determinístico independiente) SOBREVIVE la priorización pese a estar mucho más allá de la posición 50 original`);
  }

  // ==========================================================================
  // J4-13 — empate -> orden DOM estable (determinismo, se corre 2 veces)
  // ==========================================================================
  {
    const unbacked: ComputedStyleEvidence[] = Array.from({ length: 60 }, (_, i) => cs({ selector: `u:nth-of-type(${i + 1})` }));
    const withIterations = unbacked.map((c) => ({ ...c, iterations: [1] }));
    const run1 = prioritizeComputedStyles(withIterations, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    const run2 = prioritizeComputedStyles(withIterations, { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() });
    assert(JSON.stringify(run1.final.map((f: any) => f.selector)) === JSON.stringify(run2.final.map((f: any) => f.selector)), 'J4-13: con 60 elementos "unbacked" empatados (sin ninguna señal), 2 ejecuciones idénticas producen EXACTAMENTE el mismo orden/selección -- desempate estable por orden de aparición (DOM-like)');
    assert(run1.final[0].selector === 'u:nth-of-type(1)', 'J4-13: el desempate favorece el orden de aparición original (el primer elemento en orden DOM es el primero seleccionado)');
  }

  // ==========================================================================
  // J4-14 / J4-15 — el final set nunca supera el presupuesto; candidate set puede ser mayor
  // ==========================================================================
  {
    const HUGE = 300;
    const many: ComputedStyleEvidence[] = Array.from({ length: HUGE }, (_, i) => cs({ selector: `many:nth-of-type(${i + 1})` }));
    const result = prioritizeComputedStyles(
      many.map((c) => ({ ...c, iterations: [1] })),
      { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() },
    );
    assert(result.candidateCount === HUGE, `J4-15: candidate set (${result.candidateCount}) es mayor que el final set (${result.finalCount})`);
    assert(result.finalCount === COMPUTED_STYLES_FINAL_BUDGET, `J4-14: el final set NUNCA supera el presupuesto definido (obtenido: ${result.finalCount}, presupuesto: ${COMPUTED_STYLES_FINAL_BUDGET})`);
  }

  // ==========================================================================
  // J4-16 / J4-17 — trazabilidad J1 solo acepta selectors del FINAL set; un descartado NO es trazable
  // ==========================================================================
  {
    // 80 elementos "unbacked" sin ninguna señal -> el presupuesto (50) descarta 30 de ellos.
    const many: ComputedStyleEvidence[] = Array.from({ length: 80 }, (_, i) => cs({ selector: `disc:nth-of-type(${i + 1})` }));
    const evidences: EvidenceInput[] = [{
      iteration: 1, url: 'https://fixture.local/j4-16', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
      computedStyles: [], computedStylesCandidates: many,
    }];
    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'j4-16', url: 'https://fixture.local/j4-16' });
      assert(result.dedupedComputedStyles.length === COMPUTED_STYLES_FINAL_BUDGET, `J4-16: el pipeline completo produce un FINAL set de ${COMPUTED_STYLES_FINAL_BUDGET} (obtenido: ${result.dedupedComputedStyles.length})`);

      const discardedSelector = 'disc:nth-of-type(80)'; // el último candidato, casi con certeza fuera del final set (sin señal, orden de aparición tardío)
      const wasDiscarded = !result.dedupedComputedStyles.some((f: any) => f.selector === discardedSelector);
      assert(wasDiscarded, `J4-16 (precondición): "${discardedSelector}" efectivamente NO forma parte del final set de 80 candidatos sin señal`);

      // Construir el índice EXACTAMENTE como lo hace producción (desde el FINAL set) y confirmar que el descartado no es trazable.
      const { buildEvidenceIndex } = await import('@/modules/evaluations/services/evidence-traceability.service');
      const index = buildEvidenceIndex({
        evidencesSummary: [], dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
        dedupedComputedStyles: result.dedupedComputedStyles as any,
      });
      const traceabilityForDiscarded = checkFindingTraceability(
        { affectedElement: { tag: 'p', selector: discardedSelector } } as any,
        index,
      );
      assert(traceabilityForDiscarded.traceable === false, `J4-17: un selector DESCARTADO por la priorización NO puede ser considerado trazable -- un finding de Gemini que lo referenciara se degradaría a NOT_EVALUABLE (obtenido: traceable=${traceabilityForDiscarded.traceable})`);

      const survivingSelector = (result.dedupedComputedStyles[0] as any).selector;
      const traceabilityForSurviving = checkFindingTraceability(
        { affectedElement: { tag: 'p', selector: survivingSelector } } as any,
        index,
      );
      assert(traceabilityForSurviving.traceable === true, `J4-16 (control positivo): un selector que SÍ está en el final set es trazable (obtenido: traceable=${traceabilityForSurviving.traceable})`);
    } finally {
      stub.restore();
    }
  }

  // ==========================================================================
  // J4-18 — no contaminación entre tipos de evidencia
  // ==========================================================================
  {
    const SHARED = 'div.shared';
    const evidences: EvidenceInput[] = [{
      iteration: 1, url: 'https://fixture.local/j4-18', screenshotPath: '/x.png',
      headings: [], images: [],
      links: [{ selector: SHARED, text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false } as LinkEvidence],
      buttons: [{ selector: SHARED, tag: 'button', text: 'x', ariaLabel: null, role: null, isDisabled: false, isPrimary: false } as ButtonEvidence],
      forms: [], landmarks: [],
      computedStyles: [], computedStylesCandidates: [cs({ selector: SHARED })],
    }];
    const { dedupedComputedStyles: allDeduped, dedupedLinks, dedupedButtons } = buildDeduplicatedEvidenceContext(evidences);
    assert(allDeduped.length === 1 && dedupedLinks.length === 1 && dedupedButtons.length === 1, 'J4-18: el mismo selector compartido entre computedStyles/links/buttons se registra UNA vez en cada array propio, sin fusionarse ni contaminarse entre tipos');
  }

  // ==========================================================================
  // J4-DET — PRUEBA DE NO REGRESIÓN DETERMINÍSTICA (sección 13, obligatoria)
  // ==========================================================================
  {
    // Fixture real con >50 candidatos: elementos de bajo contraste colocados
    // DENTRO de los primeros 50 (para que SÍ generen findings WCAG 1.4.3
    // reales, ejercitando la regla) + suficiente relleno DESPUÉS para que
    // computedStylesCandidates supere los 50 (probando que ese excedente no
    // afecta los findings ya generados desde los primeros 50).
    const lowContrastTargets = Array.from({ length: 5 }, (_, i) => `<p id="low-contrast-${i}" style="color:#aaaaaa;background-color:#ffffff;">Texto de bajo contraste ${i}</p>`).join('\n');
    const trailingFillerCount = 60;
    const trailingFiller = Array.from({ length: trailingFillerCount }, (_, i) => `<p>Relleno posterior ${i}</p>`).join('\n');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" /></head><body><h1>Página J4-DET</h1>${lowContrastTargets}${trailingFiller}</body></html>`;
    const evalId = 'j4-det';
    await automationService.attachTestSession(evalId, html);
    const snapshot = await automationService.extractCurrentSnapshot(evalId);
    await automationService.closeSession(evalId);

    const evidenceWithCandidates: any = {
      iteration: 1, url: 'https://fixture.local/j4-det', screenshotPath: '/x.png',
      headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
      forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
      computedStylesCandidates: snapshot.computedStylesCandidates, // presente (post-J4 Step 2a)
    };
    const evidenceWithoutCandidates: any = { ...evidenceWithCandidates, computedStylesCandidates: undefined }; // ausente (simula pre-J4 Step 2a)

    const findingsWith = deterministicAnalyzer.analyzeSnapshots([evidenceWithCandidates]);
    const findingsWithout = deterministicAnalyzer.analyzeSnapshots([evidenceWithoutCandidates]);

    assert(findingsWith.length === findingsWithout.length, `J4-DET: número de findings determinísticos IDÉNTICO con/sin computedStylesCandidates presente (con=${findingsWith.length}, sin=${findingsWithout.length})`);
    assert(JSON.stringify(findingsWith.map((f: any) => f.status)) === JSON.stringify(findingsWithout.map((f: any) => f.status)), 'J4-DET: statuses IDÉNTICOS, mismo orden');
    assert(JSON.stringify(findingsWith.map((f: any) => f.affectedElement?.selector)) === JSON.stringify(findingsWithout.map((f: any) => f.affectedElement?.selector)), 'J4-DET: selectors IDÉNTICOS, mismo orden');

    const auditMetricsModule = await import('@/modules/evaluations/services/audit-metrics.service');
    const inputFindingsWith = findingsWith.map((f: any) => ({ ...f }));
    const inputFindingsWithout = findingsWithout.map((f: any) => ({ ...f }));
    const metricsWith = auditMetricsModule.auditMetricsService.calculateMetrics(inputFindingsWith);
    const metricsWithout = auditMetricsModule.auditMetricsService.calculateMetrics(inputFindingsWithout);
    assert(metricsWith.overallScore === metricsWithout.overallScore, `J4-DET: overallScore IDÉNTICO (con=${metricsWith.overallScore}, sin=${metricsWithout.overallScore})`);
    assert(metricsWith.failCount === metricsWithout.failCount && metricsWith.passCount === metricsWithout.passCount, 'J4-DET: failCount/passCount IDÉNTICOS');

    const contrastFindings = findingsWith.filter((f: any) => f.wcagCriterion?.includes('1.4.3'));
    console.log(`  ℹ️  J4-DET: ${contrastFindings.length} findings WCAG 1.4.3 generados (confirma que el escenario SÍ ejercitó la regla de contraste, no un caso vacío)`);
    assert(contrastFindings.length > 0, 'J4-DET: el escenario efectivamente ejercitó la regla de contraste determinística (no es una prueba vacía)');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
