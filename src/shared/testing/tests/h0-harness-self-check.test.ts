import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { GroundTruth } from '@/shared/testing/ground-truth-oracle';
import { stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import {
  runPhase2RealControlled,
  estimateCostUsd,
  MAX_REAL_CALLS_PHASE_H,
  FixtureCase,
} from '@/shared/testing/gemini-real-controlled-harness';
import { buildOversizedFieldHtml } from '@/shared/testing/stress-generators';
import { automationService } from '@/modules/automation/automation.service';

/**
 * Fase H — H0: verificación del harness/orquestador de Fase H, EN MODO
 * COMPLETAMENTE MOCKEADO (stubGeminiJsonResponses de Fase G, cero llamadas
 * reales a Gemini). Confirma que la lógica del orquestador (tope de 6,
 * aborto ante preflight no-NORMAL, aborto ante error, cálculo de costo,
 * separación A/B/C) funciona correctamente ANTES de exponerlo a Gemini
 * real. Esta es la única forma de validar el harness sin gastar ni una
 * sola llamada real -- exactamente el mismo patrón que G0 (implícito en
 * G1-G7) usó para validar el mecanismo de mock antes de F8/G7.
 */
async function main() {
  console.log('🧪 Starting H0 — Real-Controlled Harness Self-Check, Fully Mocked (Fase H)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const simpleEvidence: EvidenceInput[] = [
    { iteration: 1, url: 'https://fixture.local/h0', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] },
  ];
  const emptyGt: GroundTruth = { fixture: 'h0-mock', criteria: [] };

  // --- Test 1: tope duro de 6 -- pasar 7 fixtures debe lanzar ANTES de cualquier llamada ---
  {
    const sevenFixtures: FixtureCase[] = Array.from({ length: 7 }).map((_, i) => ({ name: `f${i}`, evidences: simpleEvidence, groundTruth: emptyGt }));
    let threw = false;
    try {
      await runPhase2RealControlled(sevenFixtures);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('tope duro'), `El error rechaza explícitamente exceder el tope (mensaje: "${e.message}")`);
    }
    assert(threw, `Pasar ${7} fixtures (> MAX_REAL_CALLS_PHASE_H=${MAX_REAL_CALLS_PHASE_H}) lanza un error ANTES de intentar ninguna llamada`);
  }

  // --- Test 2: preflight rechaza un prompt no-NORMAL, sin llamar a Gemini ---
  {
    const oversizedHtml = buildOversizedFieldHtml('heading', 1_200_000);
    await automationService.attachTestSession('h0-oversized', oversizedHtml);
    const snap = await automationService.extractCurrentSnapshot('h0-oversized');
    await automationService.closeSession('h0-oversized');
    const oversizedEvidence: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/h0-oversized', screenshotPath: '/x.png', headings: snap.headings, images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] },
    ];

    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const records = await runPhase2RealControlled([{ name: 'oversized', evidences: oversizedEvidence, groundTruth: emptyGt }]);
      assert(records.length === 1 && records[0].aborted === true, 'El preflight rechaza el prompt oversized (nivel no-NORMAL) y lo registra como abortado');
      assert(stub.callCount() === 0, `CONFIRMADO: la llamada (mockeada, representando a Gemini real) NUNCA se realizó — el preflight la detuvo antes (callCount=${stub.callCount()})`);
    } finally {
      stub.restore();
    }
  }

  // --- Test 3: éxito normal -- registra A (schema válido), B (pipeline OK), C (oráculo informativo) y telemetría/costo ---
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        { findingGroup: 'ux', status: 'NOT_EVALUABLE', severity: 'info', confidence: 'low', heuristicCode: 'N-08', description: 'Sin evidencia suficiente.', evidence: [] },
      ]),
    ]);
    try {
      const gt: GroundTruth = { fixture: 'h0-success', criteria: [{ code: 'N-08', expectedStatus: 'PASS', match: 'SEMANTIC', verifiableBy: 'ai', acceptableStatuses: ['PASS', 'NOT_EVALUABLE'] }] };
      const records = await runPhase2RealControlled([{ name: 'success-case', evidences: simpleEvidence, groundTruth: gt }]);
      const r = records[0];
      assert(r.schemaValid === true, 'Dimensión A (validez de schema): true tras una respuesta válida');
      assert(r.pipelineCompletedWithoutError === true, 'Dimensión B (pipeline): true — dedup/gate/métricas corrieron sin excepción');
      assert(!!r.oracleReport && r.oracleReport.overallPassed === true, 'Dimensión C (oráculo, informativa): se registra el reporte completo, no solo un booleano');
      assert(typeof r.promptTokens === 'number' && typeof r.outputTokens === 'number' && typeof r.totalTokens === 'number', 'Se registran promptTokens/outputTokens/totalTokens (estimados vía fallback cuando no hay usageMetadata real, igual que en G1-G7)');
      assert(typeof r.estimatedCostUsd === 'number' && r.estimatedCostUsd! >= 0, `Se calcula un costo estimado (obtenido: $${r.estimatedCostUsd?.toFixed(6)})`);
    } finally {
      stub.restore();
    }
  }

  // --- Test 4: aborto ante error -- si una fixture falla, NO continúa con las siguientes ---
  {
    const alwaysInvalid = JSON.stringify({ overallScore: 50, executiveSummary: 'x', findings: [{ findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', description: 'x', evidence: [] }] });
    const stub = stubGeminiJsonResponses([alwaysInvalid, alwaysInvalid, alwaysInvalid, alwaysInvalid]); // agota los 4 intentos (1+3 retries) con respuestas inválidas
    try {
      const twoFixtures: FixtureCase[] = [
        { name: 'will-fail', evidences: simpleEvidence, groundTruth: emptyGt },
        { name: 'never-reached', evidences: simpleEvidence, groundTruth: emptyGt },
      ];
      const records = await runPhase2RealControlled(twoFixtures);
      assert(records.length === 1, `Ante un error en la 1ª fixture, la fase se detiene de inmediato -- la 2ª fixture NUNCA se procesa (registros obtenidos: ${records.length}, esperado: 1)`);
      assert(records[0].schemaValid === false && records[0].aborted === true, 'La fixture que falló se registra con schemaValid=false y aborted=true');
    } finally {
      stub.restore();
    }
  }

  // --- Test 5: estimateCostUsd es coherente con la tarifa documentada ---
  {
    const cost = estimateCostUsd(1_000_000, 1_000_000);
    assert(Math.abs(cost - 2.80) < 0.001, `1M promptTokens + 1M outputTokens cuesta exactamente input+output tarifado (obtenido: $${cost.toFixed(4)}, esperado: $2.80)`);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
