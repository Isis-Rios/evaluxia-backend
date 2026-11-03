import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase G — G1: Gemini coincide con el determinístico (mismo selector,
 * mismo criterio, mismo status). Primer escenario end-to-end real: prompt
 * real -> respuesta de Gemini simulada -> V2AuditOutputSchema real ->
 * EvidenceGate real -> fusión determinístico-primero real ->
 * AuditMetricsService.calculateMetrics real -> Oráculo.
 *
 * Nunca antes probado así: gemini-resilience.test.ts (Casos H-K) usa un
 * schema de juguete; audit-metrics.test.ts consolida arrays hechos a mano.
 * Aquí la respuesta de "Gemini" (mockeada) se referencia sobre la MISMA
 * evidencia real que generó el prompt.
 */
async function main() {
  console.log('🧪 Starting G1 — Gemini Agrees with Deterministic (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // Página con 1 imagen SIN alt (determinístico: FAIL WCAG 1.1.1) y 1 enlace con texto (determinístico: PASS WCAG 2.4.4).
  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g1', screenshotPath: '/x.png',
      headings: [{ level: 1, text: 'Página G1', selector: 'h1' }],
      images: [{ selector: 'img.hero', src: '/hero.png', alt: null, ariaLabel: null, role: null, isDecorative: false }],
      links: [{ selector: 'a.nav-1', text: 'Ir a inicio', href: '/inicio', ariaLabel: null, role: null, isExternal: false }],
      buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];

  // Gemini (mockeado) reporta el MISMO hallazgo que el determinístico ya
  // detecta para la misma imagen: FAIL WCAG 1.1.1, mismo selector.
  const stub = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high',
        wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
        description: 'La imagen img.hero carece de texto alternativo.',
        evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: 'null', selector: 'img.hero' }],
        affectedElement: { tag: 'img', selector: 'img.hero' },
        recommendation: 'Agregar un atributo alt descriptivo a la imagen.',
      },
    ]),
  ]);

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g1', url: 'https://fixture.local/g1' });

    assert(stub.callCount() === 1, `Gemini (mockeado) se llamó exactamente 1 vez (obtenido: ${stub.callCount()})`);
    assert(result.deterministicFindings.some((f: any) => f.wcagCriterion?.includes('1.1.1') && f.status === 'FAIL'), 'El determinístico detecta FAIL WCAG 1.1.1 para img.hero (independiente de Gemini)');
    assert(result.rawAiFindings.length === 1, 'Gemini (mockeado) devuelve exactamente 1 finding, parseado y validado por V2AuditOutputSchema real');

    const consolidated1_1_1 = result.metrics.consolidatedFindings.filter((f: any) => f.wcagCriterion?.includes('1.1.1'));
    assert(consolidated1_1_1.length === 1, `Cuando determinístico e IA coinciden en el mismo selector+criterio+status, la consolidación produce UNA sola entrada, no dos (obtenido: ${consolidated1_1_1.length})`);
    assert(consolidated1_1_1[0]?.status === 'FAIL', 'La entrada consolidada preserva el status FAIL');

    const gt: GroundTruth = {
      fixture: 'synthetic/g1',
      criteria: [
        { code: 'WCAG 1.1.1', expectedStatus: 'FAIL', match: 'EXACT', verifiableBy: 'deterministic' },
        { code: 'WCAG 2.4.4', expectedStatus: 'PASS', match: 'EXACT', verifiableBy: 'deterministic' },
      ],
    };
    const report = evaluateGroundTruth(gt, result.metrics.consolidatedFindings as any);
    assert(report.overallPassed, `Oráculo: overallPassed=true tras el pipeline completo con Gemini mockeado — ${JSON.stringify(report.criteriaResults.filter((r) => !r.passed))}`);
    assert(report.duplicateViolations.length === 0, 'El oráculo no detecta duplicados (criterio, selector) en los findings consolidados');
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
