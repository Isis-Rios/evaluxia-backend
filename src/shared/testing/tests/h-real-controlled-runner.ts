import { automationService } from '@/modules/automation/automation.service';
import { loadFixture } from '@/shared/testing/fixture-loader';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { H_FIXTURES } from '@/shared/testing/h-fixtures-manifest';
import { runPhase2RealControlled, FixtureCase, MAX_REAL_CALLS_PHASE_H } from '@/shared/testing/gemini-real-controlled-harness';

/**
 * ⚠️  Fase H — EJECUCIÓN REAL. Este script, al correrse, hace HASTA
 * ${MAX_REAL_CALLS_PHASE_H} llamadas REALES a Gemini (costo real, aunque
 * mínimo según la proyección de la Fase H). NO se ejecuta automáticamente
 * como parte de ninguna suite ni de este trabajo de implementación --
 * requiere una autorización explícita separada del usuario antes de
 * correrse con `npx ts-node -r tsconfig-paths/register
 * src/shared/testing/tests/h-real-controlled-runner.ts`.
 *
 * A diferencia de todo lo demás en src/shared/testing/tests/, este archivo
 * deliberadamente NO se llama "*.test.ts" con el patrón de auto-verificación
 * de las demás fases -- es un script de un solo uso, gatillado a mano.
 *
 * No aplica ningún stub (gemini-mock-harness.stubGeminiJsonResponses) --
 * por eso golpea el GeminiClient real. Su lógica de orquestación
 * (tope de 6, preflight de presupuesto, aborto ante error) ya fue
 * verificada por completo en modo mockeado en h0-harness-self-check.test.ts
 * — cero llamadas reales se hicieron para validar ese comportamiento.
 */
async function loadFixtureAsEvidence(path: string): Promise<{ evidences: EvidenceInput[]; url: string }> {
  const fixture = loadFixture(path);
  const evalId = `h-real-${path.replace(/[\/.]/g, '-')}`;
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);
  const url = `https://fixture.local/${path}`;
  return {
    url,
    evidences: [
      {
        iteration: 1,
        url,
        screenshotPath: '/x.png',
        headings: snapshot.headings,
        images: snapshot.images,
        links: snapshot.links,
        buttons: snapshot.buttons,
        forms: snapshot.forms,
        landmarks: snapshot.landmarks,
        computedStyles: snapshot.computedStyles,
      },
    ],
  };
}

async function main() {
  console.log('🚨 Fase H — EJECUCIÓN REAL CONTROLADA (hasta 6 llamadas reales a Gemini)\n');
  console.log(`   Fixtures: ${H_FIXTURES.map((f) => f.id).join(', ')}`);
  console.log(`   Tope duro: ${MAX_REAL_CALLS_PHASE_H} llamadas. Preflight de presupuesto activo. Aborto inmediato ante cualquier error.\n`);

  const fixtureCases: FixtureCase[] = [];
  for (const entry of H_FIXTURES) {
    const { evidences, url } = await loadFixtureAsEvidence(entry.path);
    const loaded = loadFixture(entry.path);
    fixtureCases.push({ name: entry.id, evidences, url, groundTruth: loaded.groundTruth });
  }

  const records = await runPhase2RealControlled(fixtureCases);

  console.log('\n========================================');
  console.log('Fase H — Reporte de ejecución real');
  console.log('========================================\n');

  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const r of records) {
    const entry = H_FIXTURES.find((f) => f.id === r.fixtureName);
    console.log(`--- ${r.fixtureName}${entry ? ` (${entry.question})` : ''} ---`);
    console.log(`  [A] Validez técnica del schema: ${r.schemaValid ? 'OK' : `FALLO — ${r.errorMessage}`}`);
    console.log(`  [B] Procesamiento del pipeline: ${r.pipelineCompletedWithoutError ? `OK (${r.consolidatedFindingsCount} findings consolidados)` : 'NO COMPLETADO'}`);
    if (r.oracleReport) {
      console.log(`  [C] Juicio de Gemini vs. Ground Truth (informativo, NO bloqueante): overallPassed=${r.oracleReport.overallPassed}`);
      r.oracleReport.criteriaResults.forEach((cr) => {
        console.log(`      - ${cr.code} (${cr.match}): esperado=${cr.expectedStatus} real=[${cr.actualStatuses.join(',')}] passed=${cr.passed} — ${cr.reason}`);
      });
    }
    console.log(`  Tokens: estimatedInput=${r.estimatedInputTokens} promptTokens=${r.promptTokens ?? 'n/a'} outputTokens=${r.outputTokens ?? 'n/a'} totalTokens=${r.totalTokens ?? 'n/a'} costo≈$${r.estimatedCostUsd?.toFixed(6) ?? 'n/a'}`);
    console.log('');

    totalPromptTokens += r.promptTokens ?? 0;
    totalOutputTokens += r.outputTokens ?? 0;
    totalCostUsd += r.estimatedCostUsd ?? 0;
  }

  console.log('========================================');
  console.log(`Totales: ${records.length}/${H_FIXTURES.length} fixtures procesadas. promptTokens=${totalPromptTokens} outputTokens=${totalOutputTokens} costo total≈$${totalCostUsd.toFixed(6)}`);
  console.log('========================================\n');

  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
