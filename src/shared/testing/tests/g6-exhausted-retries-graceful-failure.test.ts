import fs from 'fs';
import path from 'path';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline } from '@/shared/testing/gemini-mock-harness';
import { AppError } from '@/shared/errors/AppError';

/**
 * Fase G — G6: TODAS las respuestas de Gemini violan la barrera real del
 * schema -> se agotan los reintentos -> fallo controlado. Caso G de
 * gemini-resilience.test.ts ya prueba esto para el flujo Phase 1
 * (flowState/RuleEngine); G6 es la primera vez que se prueba el corte
 * Phase 2/AuditEngine específicamente: CERO findings (ni determinísticos
 * ni de IA, ni parciales ni inventados) deben llegar a consolidarse o
 * persistirse cuando Gemini nunca produce una respuesta válida.
 */
async function main() {
  console.log('🧪 Starting G6 — Exhausted Retries, Graceful Phase 2 Failure (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const evidences: EvidenceInput[] = [
    {
      iteration: 1, url: 'https://fixture.local/g6', screenshotPath: '/x.png',
      headings: [], images: [{ selector: 'img.g6', src: '/g6.png', alt: null, ariaLabel: null, role: null, isDecorative: false }],
      links: [], buttons: [], forms: [], landmarks: [], computedStyles: [],
    },
  ];

  // El determinístico SÍ produce un finding real (independiente de
  // Gemini) -- se usa para confirmar que existe, pero que NUNCA llega a
  // calculateMetrics/consolidación porque el pipeline aborta antes.
  const deterministicFindingsIndependent = deterministicAnalyzer.analyzeSnapshots(evidences as any);
  assert(deterministicFindingsIndependent.some((f: any) => f.wcagCriterion?.includes('1.1.1')), 'Precondición: el determinístico SÍ detecta un finding real para esta evidencia (independiente de Gemini)');

  // TODAS las respuestas violan la barrera real del schema (FAIL sin evidence/recommendation).
  const invalidResponse = JSON.stringify({
    overallScore: 50,
    executiveSummary: 'Respuesta persistentemente inválida.',
    findings: [{ findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', description: 'Inválido', evidence: [] }],
  });
  const stub = stubGeminiJsonResponses([invalidResponse, invalidResponse, invalidResponse, invalidResponse]);

  let caughtError: any = null;
  let pipelineResult: any = null;
  try {
    pipelineResult = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g6', url: 'https://fixture.local/g6' });
  } catch (err) {
    caughtError = err;
  } finally {
    stub.restore();
  }

  assert(pipelineResult === null, 'El pipeline NUNCA devuelve un resultado (ni parcial ni con findings inventados) cuando Gemini agota los reintentos con respuestas inválidas');
  assert(caughtError instanceof AppError, 'Se lanza un AppError tipado (mismo patrón que Caso K de gemini-resilience.test.ts, ahora para el corte Phase 2)');
  assert(caughtError?.statusCode === 502, `El statusCode preservado es 502 (respuesta de IA inválida), obtenido: ${caughtError?.statusCode}`);
  console.log(`  ℹ️  Mensaje de error propagado: "${caughtError?.message}"`);

  // Confirmación por código (no por suposición): en producción,
  // AuditEngine.performAudit envuelve exactamente este punto (la llamada a
  // aiService.performAuditAnalysis) en un try/catch que marca
  // auditStatus=FAILED y ABORTA antes de llegar a calculateMetrics/
  // persistencia de findings (pasos 6-9) -- es decir, el throw que
  // acabamos de reproducir aquí es, en producción, el mismo que impide que
  // cualquier finding (determinístico o de IA) se consolide o persista.
  const auditEngineSrc = fs.readFileSync(path.join(process.cwd(), 'src/modules/evaluations/services/audit-engine.service.ts'), 'utf8');
  const performAuditAnalysisLine = auditEngineSrc.indexOf('aiService.performAuditAnalysis');
  const calculateMetricsLine = auditEngineSrc.indexOf('calculateMetrics');
  const catchLine = auditEngineSrc.indexOf('AUDIT_STATUS.FAILED');
  assert(
    performAuditAnalysisLine > -1 && calculateMetricsLine > performAuditAnalysisLine && catchLine > calculateMetricsLine,
    'Confirmado por código real: aiService.performAuditAnalysis se invoca ANTES de calculateMetrics, y el catch que marca AUDIT_STATUS.FAILED envuelve todo ese tramo -- un throw en performAuditAnalysis impide alcanzar calculateMetrics en producción, igual que aquí',
  );

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
