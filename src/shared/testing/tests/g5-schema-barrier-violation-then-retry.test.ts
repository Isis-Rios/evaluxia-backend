import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * Fase G — G5: la primera respuesta de Gemini viola una BARRERA REAL de
 * V2AuditFindingSchema (no un error de JSON genérico) -- un finding FAIL
 * sin evidencia ni recomendación, prohibido explícitamente por el
 * `.refine()` de ai.contracts.ts ("FAIL findings require non-empty
 * technical evidence and an actionable recommendation"). La segunda
 * respuesta es válida.
 *
 * gemini-resilience.test.ts (Casos H-K) ya prueba retry ante JSON
 * malformado / contrato de un schema DE JUGUETE inválido. G5 es la primera
 * vez que se ejercita el retry contra las barreras REALES y específicas de
 * V2AuditOutputSchema, usadas en producción.
 */
async function main() {
  console.log('🧪 Starting G5 — Real Schema Barrier Violation, then Valid Retry (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // NOTA: se usa un heuristicCode de Nielsen (N-05), NUNCA un wcagCriterion
  // -- el DeterministicAnalyzer SOLO produce hallazgos WCAG (1.1.1/2.4.4/
  // 4.1.2, ver deterministic-analyzer.service.ts), nunca códigos N-*. Esto
  // aísla G5 de la prioridad determinístico-sobre-IA ya probada en G2: aquí
  // NO debe existir ningún hallazgo determinístico compitiendo por la misma
  // clave (criterio+selector), para que la única variable en juego sea el
  // comportamiento de retry ante la violación de la barrera del schema.
  // NOTA (post-J1): `forms` incluye un elemento real con selector
  // "form.checkout" -- el mismo que referencia el finding simulado más
  // abajo. Esto es necesario desde que J1 (Evidence Traceability) exige
  // que `affectedElement.selector` sea trazable a la evidencia realmente
  // enviada; sin este elemento real, J1 degradaría el finding a
  // NOT_EVALUABLE por selector no trazable, contaminando esta prueba (que
  // busca aislar exclusivamente el comportamiento de retry ante la
  // barrera del schema, no la trazabilidad).
  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g5', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [],
      forms: [{ selector: 'form.checkout', name: null, action: null, elements: [] }],
      landmarks: [], computedStyles: [],
    },
  ];

  // Intento 1: JSON bien formado, pero VIOLA la barrera del schema real
  // (FAIL sin evidence ni recommendation) -> V2AuditOutputSchema.safeParse
  // debe rechazarlo -> InvalidAiResponseError -> retryable.
  const invalidBarrierResponse = JSON.stringify({
    overallScore: 70,
    executiveSummary: 'Resumen con un finding inválido según la barrera del schema.',
    findings: [
      {
        findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high',
        heuristicCode: 'N-05', heuristicName: 'Prevención de errores',
        description: 'El formulario no confirma acciones destructivas.',
        evidence: [], // VACÍO -> viola la barrera para status FAIL
        // recommendation ausente -> también viola la barrera
      },
    ],
  });

  // Intento 2: válido, cumple la barrera.
  // [ACTUALIZADO K.1.1]: la evidencia ahora cita `property: 'action'`
  // (FormEvidence.action, real y verificable -- "null" en este fixture,
  // ver `evidences` arriba) en vez de un ítem `INTERACTION` sin
  // `property`/`attribute`. Descubierto durante K.1.1 (Parte A, al corregir
  // `applyClaimConsistency` para degradar también INSUFFICIENT, no solo
  // INCONSISTENT -- ver evidence-claim-consistency.service.ts): un ítem sin
  // `property` es NOT_CHECKABLE (J6 no tiene nada que comparar), lo que
  // ahora degrada el finding -- correcto para evidencia genuinamente no
  // verificable, pero este fixture NUNCA tuvo la intención de probar eso,
  // solo la recuperación del retry. `type: 'INTERACTION'` no tiene hoy
  // ningún respaldo real en el EvidenceIndex (no existe ese EvidenceKind)
  // -- se cambia a `DOM_ATTRIBUTE`/`property` real para que la evidencia
  // sea genuinamente verificable, sin alterar el propósito de la prueba.
  const validResponse = buildValidAuditOutputJson([
    {
      findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high',
      heuristicCode: 'N-05', heuristicName: 'Prevención de errores',
      description: 'El formulario no confirma acciones destructivas (recuperado tras retry).',
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'action', value: 'null', selector: 'form.checkout' }],
      affectedElement: { tag: 'form', selector: 'form.checkout' },
      recommendation: 'Agregar un diálogo de confirmación antes de ejecutar la acción destructiva.',
    },
  ]);

  const stub = stubGeminiJsonResponses([invalidBarrierResponse, validResponse]);

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g5', url: 'https://fixture.local/g5' });

    assert(stub.callCount() === 2, `Se reintentó exactamente 1 vez tras la violación de la barrera real del schema (obtenido: ${stub.callCount()} llamadas)`);
    assert(result.rawAiFindings.length === 1, 'El resultado final proviene de la respuesta VÁLIDA (intento 2), nunca de la que violó la barrera');
    assert(result.rawAiFindings[0]?.description.includes('recuperado tras retry'), 'La descripción final es la del intento 2, confirmando que no se mezcló ni se inventó contenido del intento 1 inválido');

    const consolidated = result.metrics.consolidatedFindings.find((f: any) => f.heuristicCode === 'N-05');
    assert(!!consolidated, 'El finding recuperado tras el retry se consolida normalmente');
    assert(!!consolidated?.recommendation, 'La recomendación final está presente (la del intento 2) — el finding con recomendación ausente del intento 1 nunca llegó a consolidarse');
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
