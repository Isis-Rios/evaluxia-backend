import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * Fase G — G2: Gemini CONTRADICE al determinístico para el mismo selector
 * (determinístico: PASS WCAG 2.4.4 porque el enlace tiene texto; Gemini
 * mockeado: FAIL para el MISMO selector, mismo criterio).
 *
 * audit-metrics.test.ts (Stage 2-B) ya prueba la prioridad determinístico
 * con arrays de findings construidos a mano. G2 prueba lo mismo pero end-
 * to-end: la contradicción llega desde una respuesta de Gemini real
 * (mockeada) parseada por el schema real, no desde un objeto de test.
 */
async function main() {
  console.log('🧪 Starting G2 — Gemini Contradicts Deterministic, Priority Held End-to-End (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g2', screenshotPath: '/x.png',
      headings: [{ level: 1, text: 'Página G2', selector: 'h1' }],
      images: [],
      links: [{ selector: 'a.cta', text: 'Comprar ahora', href: '/comprar', ariaLabel: null, role: null, isExternal: false }],
      buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];

  // Gemini (mockeado) afirma FAIL para el MISMO selector que el
  // determinístico ya evaluó como PASS (el enlace SÍ tiene texto propio).
  const stub = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'medium', confidence: 'high',
        wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
        description: 'El enlace a.cta no describe claramente su destino (falso positivo simulado de Gemini).',
        evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'href', value: '/comprar', selector: 'a.cta' }],
        affectedElement: { tag: 'a', selector: 'a.cta' },
        recommendation: 'Reformular el texto del enlace.',
      },
    ]),
  ]);

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g2', url: 'https://fixture.local/g2' });

    const deterministicEntry = result.deterministicFindings.find((f: any) => f.wcagCriterion?.includes('2.4.4'));
    assert(deterministicEntry?.status === 'PASS', 'El determinístico evalúa PASS para a.cta (tiene texto propio no vacío)');
    assert(result.rawAiFindings[0]?.status === 'FAIL', 'Gemini (mockeado) devuelve FAIL para el mismo selector — la contradicción es real, no simulada a medias');

    const consolidated = result.metrics.consolidatedFindings.filter((f: any) => f.wcagCriterion?.includes('2.4.4'));
    assert(consolidated.length === 1, `Una sola entrada consolidada para el criterio+selector en conflicto (obtenido: ${consolidated.length})`);
    assert(
      consolidated[0]?.status === 'PASS',
      `La prioridad determinístico-sobre-IA se sostiene END-TO-END (mockeado -> schema real -> gate real -> consolidación real): status consolidado=${consolidated[0]?.status} (esperado: PASS, el veredicto determinístico gana sobre el de Gemini)`,
    );

    console.log(`  ℹ️  Confidence de la entrada consolidada: ${consolidated[0]?.confidence} (esperado: alta, por venir de una medición determinística, no de una inferencia de IA)`);
    assert(consolidated[0]?.confidence === 'high', 'La entrada consolidada preserva la confidence "high" propia de la medición determinística, no la de Gemini');
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
