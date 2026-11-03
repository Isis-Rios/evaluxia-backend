import fs from 'fs';
import path from 'path';
import { aiService } from '@/modules/ai/ai.service';
import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { applyVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';
import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { matchPrototypeFindings, PrototypeExpectedFinding } from '@/shared/testing/prototype-finding-matching';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';
import { detectImageFormat, mimeTypeForFormat } from '@/modules/evaluations/services/prototype-image-upload.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';

/**
 * EXPERIMENTO GEMINI REAL — Prototype #1 (P7, diseñado en P7.0, NO ejecutado
 * todavía). Observacional/diagnóstico, n=1. UNA sola llamada lógica
 * autorizada a `aiService.performPrototypeAuditAnalysis`, sobre la fixture
 * dedicada `fixtures/prototypes/p7-heading-label.png` (ver su
 * `.groundtruth.json` -- un único problema controlado: encabezado principal
 * no descriptivo, WCAG 2.4.6).
 *
 * Requiere PROTOTYPE_P7_EXPERIMENT_1_AUTHORIZED=yes -- sin esta variable,
 * el runner se detiene justo antes de la llamada real (mismo mecanismo de
 * seguridad que `landing-v1-real-gemini-run.ts`, Fase Gemini Real #1/#2).
 *
 * Mientras esta variable no esté definida como 'yes', ejecutar este archivo
 * NO realiza ninguna llamada real a Gemini -- solo corre el preflight.
 */
async function main() {
  console.log('🚨 EXPERIMENTO GEMINI REAL — Prototype #1 (observacional, n=1)\n');

  const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
  const imagePath = path.join(FIXTURES_ROOT, 'p7-heading-label.png');
  const groundTruthPath = path.join(FIXTURES_ROOT, 'p7-heading-label.groundtruth.json');

  const imageBuffer = fs.readFileSync(imagePath);
  const format = detectImageFormat(imageBuffer);
  const groundTruth: { fixture: string; expectedFindings: PrototypeExpectedFinding[] } = JSON.parse(
    fs.readFileSync(groundTruthPath, 'utf8'),
  );

  const archetype = {
    fullName: 'Ana Torres', archetype: 'El Explorador', profession: 'QA',
    phrase: 'Quiero entender rápido qué está pasando en la pantalla',
    goals: ['Completar la compra sin confusiones'],
    frustrations: ['Pantallas con textos genéricos que no explican qué hacer'],
    techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop',
  };

  const description = 'Pantalla de confirmación de compra de una aplicación de comercio electrónico. El usuario revisa el método de pago y el envío antes de confirmar su pedido.';

  const applicableCriteria = resolveApplicablePrototypeCriteria();
  // Construye el MISMO prompt real que se enviaría (acceso al método
  // privado solo para auditoría/instrumentación previa, igual que el
  // runner de landing-v1 hace con buildV2AuditPrompt).
  const prompt: string = (aiService as any).buildPrototypeAuditPrompt(
    { evaluationId: 'prototype-p7-1', title: 'Confirmación de compra', description, archetype, imageMimeType: 'image/png', imageBase64: '' },
    applicableCriteria,
  );
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);

  console.log('========================================');
  console.log('1. FIXTURE');
  console.log('========================================');
  console.log(`imagen: ${imagePath}`);
  console.log(`formato detectado (firma binaria): ${format}`);
  console.log(`tamaño: ${imageBuffer.length} bytes`);
  console.log(`groundTruth.fixture: ${groundTruth.fixture}`);
  console.log(`expectedFindings: ${groundTruth.expectedFindings.length} (${groundTruth.expectedFindings.map((e) => e.id).join(', ')})`);

  console.log('\n========================================');
  console.log('2. CRITERIOS APLICABLES ENVIADOS');
  console.log('========================================');
  applicableCriteria.forEach((c) => console.log(`  ${c.code} (${c.coverage})`));

  console.log('\n========================================');
  console.log('3. PAYLOAD AUDIT (texto del prompt, sin la imagen)');
  console.log('========================================');
  console.log(`chars=${measurement.chars} bytes=${measurement.bytes} estimatedTokens=${measurement.estimatedTokens} budget=${measurement.level} J2 bloquearía=${wouldBlock}`);

  console.log('\n========================================');
  console.log('PRE-FLIGHT CHECKLIST');
  console.log('========================================');
  console.log(`[x] Imagen es un PNG/JPEG/WEBP real (firma binaria): ${!!format}`);
  console.log(`[x] Payload de texto NORMAL/WARNING: ${measurement.level !== 'CRITICAL'} (level=${measurement.level})`);
  console.log(`[x] J2 (texto) no bloquea: ${!wouldBlock}`);
  console.log(`[x] Ground Truth dedicado tiene exactamente 1 expectedFinding: ${groundTruth.expectedFindings.length === 1}`);
  console.log(`[x] COST CONTROL (P7.0.1): maxRetries=0 pasado explícitamente a performPrototypeAuditAnalysis -- máximo 1 intento físico, política global de retry (AI_RETRY_CONFIG, WEB) sin modificar`);
  console.log(`[${process.env.PROTOTYPE_P7_EXPERIMENT_1_AUTHORIZED === 'yes' ? 'x' : ' '}] Exactamente un experimento real autorizado (env PROTOTYPE_P7_EXPERIMENT_1_AUTHORIZED=yes)`);

  if (!format || wouldBlock || measurement.level === 'CRITICAL') {
    console.error('\n⛔ BLOCKED: la fixture o el payload no pasan el preflight. No se realiza ninguna llamada real.');
    fs.writeFileSync('/tmp/prototype-p7-experiment-1-result.json', JSON.stringify({ classification: 'BLOCKED', reason: 'preflight failed', measurement, format }, null, 2));
    process.exit(1);
  }

  if (process.env.PROTOTYPE_P7_EXPERIMENT_1_AUTHORIZED !== 'yes') {
    console.log('\n========================================');
    console.log('DETENIDO ANTES DE GEMINI (preparación, no ejecución)');
    console.log('========================================');
    console.log('Preflight OK pero no autorizado. Se requiere PROTOTYPE_P7_EXPERIMENT_1_AUTHORIZED=yes.');
    process.exit(0);
  }

  // =======================================================================
  // EJECUCIÓN REAL (1 sola llamada lógica) — NUNCA alcanzado sin autorización.
  // =======================================================================
  console.log('\n========================================');
  console.log('EJECUTANDO LA ÚNICA LLAMADA REAL AUTORIZADA A GEMINI...');
  console.log('========================================\n');

  const imageBase64 = imageBuffer.toString('base64');
  let auditResult: any = null;
  let executionError: any = null;
  const startTime = Date.now();
  try {
    // [P7.0.1] COST CONTROL — maxRetries:0 es EXCLUSIVO de este runner
    // (parámetro opcional de `performPrototypeAuditAnalysis`, aditivo, ver
    // ai.service.ts). Garantiza físicamente 1 intento máximo: ante CUALQUIER
    // fallo (HTTP, timeout, schema Zod inválido, JSON malformado),
    // `GeminiClient.executeWithRetry` lanza inmediatamente en vez de
    // reintentar -- NUNCA se modifica `AI_RETRY_CONFIG` (política global,
    // usada sin cambios por WEB y por `PrototypeEvaluationService` en
    // producción, que no pasa este parámetro).
    auditResult = await aiService.performPrototypeAuditAnalysis(
      {
        evaluationId: 'prototype-p7-1', title: 'Confirmación de compra', description, archetype,
        imageMimeType: mimeTypeForFormat(format), imageBase64,
      },
      { maxRetries: 0 },
    );
  } catch (err: any) {
    executionError = err;
  }
  const wallClockMs = Date.now() - startTime;

  if (executionError) {
    // [P7.0.1] maxRetries:0 garantiza que este catch se alcanza tras
    // EXACTAMENTE 1 intento físico -- ningún segundo intento automático
    // ocurrió (HTTP, timeout, schema inválido o JSON malformado se tratan
    // todos igual: lanzan de inmediato). El fallo queda registrado aquí
    // para análisis, nunca reintentado en silencio.
    console.error(`\nRESULT: FAIL (1 único intento físico consumido, sin retry automático): ${executionError?.message || executionError}`);
    fs.writeFileSync(
      '/tmp/prototype-p7-experiment-1-result.json',
      JSON.stringify({ classification: 'FAILED_SINGLE_ATTEMPT', physicalAttempts: 1, reason: `execution error: ${executionError?.message || executionError}` }, null, 2),
    );
    process.exit(1);
  }

  const logicalCalls = 1;
  const physicalAttempts = auditResult.retryAccounting?.attempts ?? 1;
  const retries = physicalAttempts - 1;

  const rawFindings = auditResult.result.findings;
  const gatedFindings = visualEvidenceGateService.processPrototypeFindings(rawFindings);
  const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } = applyCardinalityEnforcement(gatedFindings);
  const { findings: validatedFindings, summary: consistencySummary } = applyVisualEvidenceConsistency(cardinalityCheckedFindings);
  const metrics = calculatePrototypeMetrics(validatedFindings);
  const gtSummary = matchPrototypeFindings(groundTruth.expectedFindings, validatedFindings);

  console.log('========================================');
  console.log('GEMINI EXECUTION — MÉTRICAS Y TOKENS');
  console.log('========================================');
  console.log(`logical calls: ${logicalCalls}  physical attempts: ${physicalAttempts}  retries: ${retries}  wallClockMs: ${wallClockMs}`);
  console.log(`usage (último intento exitoso): ${JSON.stringify(auditResult.usage)}`);
  console.log(`retryAccounting: ${auditResult.retryAccounting ? JSON.stringify(auditResult.retryAccounting.cumulativeUsage) : 'no disponible'}`);

  console.log('\n========================================');
  console.log('RAW FINDINGS');
  console.log('========================================');
  console.log(JSON.stringify(rawFindings, null, 2));

  console.log('\n========================================');
  console.log('GATE / CARDINALITY / CONSISTENCY');
  console.log('========================================');
  console.log(`cardinalitySummary: ${JSON.stringify(cardinalitySummary)}`);
  console.log(`consistencySummary: ${JSON.stringify(consistencySummary)}`);
  console.log(`validatedFindings: ${JSON.stringify(validatedFindings, null, 2)}`);

  console.log('\n========================================');
  console.log('GROUND TRUTH MATCHER');
  console.log('========================================');
  console.log(`Conteos: ${JSON.stringify(gtSummary.counts, null, 2)}`);
  console.log(`Métricas: precision=${gtSummary.metrics.precision} recall=${gtSummary.metrics.recall} f1=${gtSummary.metrics.f1}`);
  gtSummary.results.forEach((r) => console.log(`  #${r.findingIndex} -> ${r.classification} matched=${r.matchedExpectedFindingId ?? 'n/a'} reason=${r.reason}`));
  gtSummary.coverage.forEach((c) => console.log(`  ${c.expectedFindingId}: ${c.status}`));

  console.log('\n========================================');
  console.log('METRICS');
  console.log('========================================');
  console.log(JSON.stringify(metrics, null, 2));

  const dump = {
    classification: 'OBSERVATIONAL_RESULT',
    fixture: groundTruth.fixture,
    gemini: { model: 'gemini-2.5-flash', logicalCalls, physicalAttempts, retries, wallClockMs, usage: auditResult.usage, retryAccounting: auditResult.retryAccounting ?? null },
    rawFindings, gatedFindings, cardinalityCheckedFindings, validatedFindings, cardinalitySummary, consistencySummary,
    gtSummary, metrics, prompt,
  };
  fs.writeFileSync('/tmp/prototype-p7-experiment-1-result.json', JSON.stringify(dump, null, 2));
  console.log('\nDump completo escrito en /tmp/prototype-p7-experiment-1-result.json');
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
