import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * Fase G — G3: Gemini "alucina" un selector que NO existe en la evidencia
 * enviada.
 *
 * HISTORIAL: cuando esta prueba se escribió (Fase G), confirmó un GAP DE
 * TRAZABILIDAD real — ni `evidenceGateService.processAiFindings` ni
 * `AuditMetricsService` verificaban que `affectedElement.selector`
 * correspondiera a un elemento realmente enviado; el finding inventado se
 * consolidaba como cualquier FAIL real. Ese gap fue registrado como deuda
 * técnica en el plan de Hardening Post-Fase H (J1 — Evidence Traceability)
 * y ahora está CORREGIDO: `evidence-traceability.service.ts` construye un
 * índice a partir de la evidencia realmente enviada y
 * `EvidenceGateService.processAiFindings` degrada a NOT_EVALUABLE
 * cualquier finding cuyo selector no sea trazable a ese índice. Esta
 * prueba se actualizó para confirmar el comportamiento CORREGIDO — dejar
 * las aserciones originales (que exigían que el gap siguiera existiendo)
 * habría convertido una corrección real en una "regresión" falsa cada vez
 * que corriera la suite.
 */
async function main() {
  console.log('🧪 Starting G3 — Hallucinated Selector, Traceability Gap (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // Solo 1 elemento real enviado: un enlace con selector "a.real-link".
  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g3', screenshotPath: '/x.png',
      headings: [], images: [],
      links: [{ selector: 'a.real-link', text: 'Enlace real', href: '/real', ariaLabel: null, role: null, isExternal: false }],
      buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];
  const realSelectors = new Set(evidences.flatMap((e) => e.links.map((l) => l.selector)));

  // Gemini (mockeado) reporta un finding sobre un selector que NUNCA fue
  // enviado — simula una alucinación real del modelo (un botón inventado
  // que no existe en esta página).
  const HALLUCINATED_SELECTOR = 'button.newsletter-signup-modal';
  const stub = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
        wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
        description: `El botón en ${HALLUCINATED_SELECTOR} carece de nombre accesible.`,
        evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'aria-label', value: 'null', selector: HALLUCINATED_SELECTOR }],
        affectedElement: { tag: 'button', selector: HALLUCINATED_SELECTOR },
        recommendation: 'Agregar un aria-label descriptivo al botón.',
      },
    ]),
  ]);

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g3', url: 'https://fixture.local/g3' });

    assert(!realSelectors.has(HALLUCINATED_SELECTOR), `Confirmado: "${HALLUCINATED_SELECTOR}" NUNCA estuvo en la evidencia real enviada (selectores reales: [${Array.from(realSelectors).join(', ')}])`);

    // 1. EvidenceGate (post-J1) SÍ detecta la alucinación y degrada el finding.
    const degraded = result.validatedAiFindings.find((f: any) => f.affectedElement?.selector === HALLUCINATED_SELECTOR);
    assert(
      !!degraded && degraded.status === 'NOT_EVALUABLE',
      `CORREGIDO (J1): evidenceGateService.processAiFindings degrada a NOT_EVALUABLE el finding cuyo selector no es trazable (obtenido: status=${degraded?.status})`,
    );
    assert(degraded?.recommendation === null, 'CORREGIDO (J1): al degradar a NOT_EVALUABLE, la recomendación se anula (mismo comportamiento que Gate Rule 1 para especulación/evidencia vacía)');

    // 2. La consolidación refleja el status ya degradado -- nunca llega como FAIL real.
    const consolidatedHallucinated = result.metrics.consolidatedFindings.find((f: any) => f.affectedElement?.selector === HALLUCINATED_SELECTOR);
    assert(
      !!consolidatedHallucinated && consolidatedHallucinated.status === 'NOT_EVALUABLE',
      `CORREGIDO (J1): AuditMetricsService consolida el finding alucinado como NOT_EVALUABLE, nunca como FAIL (obtenido: ${consolidatedHallucinated?.status})`,
    );
  } finally {
    stub.restore();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
