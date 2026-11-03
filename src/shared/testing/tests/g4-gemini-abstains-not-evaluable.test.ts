import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { evaluateGroundTruth, GroundTruth } from '@/shared/testing/ground-truth-oracle';

/**
 * Fase G — G4: Gemini se abstiene (NOT_EVALUABLE) en un criterio que solo
 * la IA puede evaluar (sin equivalente determinístico). Cierra, con una
 * respuesta simulada real, el diseño de la banda SEMANTIC/
 * acceptableStatuses del oráculo (construido en Fase A, nunca antes
 * ejercitado con una respuesta de Gemini real parseada por el schema).
 */
async function main() {
  console.log('🧪 Starting G4 — Gemini Abstains into NOT_EVALUABLE (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g4', screenshotPath: '/x.png',
      headings: [{ level: 1, text: 'Página G4', selector: 'h1' }],
      images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];

  // N-08 (diseño estético/minimalista) es un criterio deliberadamente
  // sin equivalente determinístico -- Gemini se abstiene por evidencia
  // insuficiente (una sola pantalla, sin capturas de scroll/layout completo).
  const stub = stubGeminiJsonResponses([
    buildValidAuditOutputJson([
      {
        findingGroup: 'ux', type: 'visual', status: 'NOT_EVALUABLE', severity: 'info', confidence: 'low',
        heuristicCode: 'N-08', heuristicName: 'Diseño estético y minimalista',
        description: 'Evidencia insuficiente (una sola captura) para evaluar el diseño estético global de la página.',
        evidence: [],
        recommendation: null,
      },
    ]),
  ]);

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g4', url: 'https://fixture.local/g4' });

    assert(result.rawAiFindings[0]?.status === 'NOT_EVALUABLE', 'Gemini (mockeado) devuelve NOT_EVALUABLE, aceptado por V2AuditOutputSchema (evidence=[] es válido solo porque status no es FAIL)');
    assert(result.validatedAiFindings[0]?.status === 'NOT_EVALUABLE', 'EvidenceGate preserva NOT_EVALUABLE (no lo convierte en FAIL ni lo descarta)');

    const consolidatedN08 = result.metrics.consolidatedFindings.find((f: any) => f.heuristicCode === 'N-08');
    assert(consolidatedN08?.status === 'NOT_EVALUABLE', `La consolidación preserva NOT_EVALUABLE hasta el final (obtenido: ${consolidatedN08?.status})`);

    // El oráculo (banda SEMANTIC con acceptableStatuses) NO debe marcar
    // esto como fallo -- una abstención honesta es un resultado aceptable,
    // nunca un hard failure del oráculo.
    const gt: GroundTruth = {
      fixture: 'synthetic/g4',
      criteria: [
        { code: 'N-08', expectedStatus: 'PASS', match: 'SEMANTIC', verifiableBy: 'ai', acceptableStatuses: ['PASS', 'NOT_EVALUABLE'] },
      ],
    };
    const report = evaluateGroundTruth(gt, result.metrics.consolidatedFindings as any);
    assert(report.overallPassed, `Oráculo: una abstención real (NOT_EVALUABLE) dentro de la banda SEMANTIC aceptable no se marca como fallo — overallPassed=true (obtenido: ${JSON.stringify(report.criteriaResults)})`);

    // Contraste: si NO estuviera en la banda aceptable, SÍ debería fallar (confirma que el oráculo no es permisivo por defecto).
    const gtStrict: GroundTruth = {
      fixture: 'synthetic/g4-strict',
      criteria: [{ code: 'N-08', expectedStatus: 'PASS', match: 'SEMANTIC', verifiableBy: 'ai', acceptableStatuses: ['PASS'] }],
    };
    const reportStrict = evaluateGroundTruth(gtStrict, result.metrics.consolidatedFindings as any);
    assert(!reportStrict.overallPassed, 'Contraste: fuera de una banda aceptable explícita, el mismo NOT_EVALUABLE SÍ se marca como fallo del oráculo — confirma que la aceptación no es automática, depende de la banda declarada');
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
