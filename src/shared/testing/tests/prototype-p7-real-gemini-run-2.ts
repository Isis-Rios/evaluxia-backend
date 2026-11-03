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
 * EXPERIMENTO GEMINI REAL — Prototype #2 (diseñado en P7.3/P7.3.1,
 * artefactos preparados en P7.3.2, NO ejecutado todavía). Observacional/
 * diagnóstico, n=1, un escenario DISTINTO al de
 * `prototype-p7-real-gemini-run.ts` (experimento #1, "Prototype #1" --
 * ARCHIVO SEPARADO, nunca sobrescrito, para preservar intacto el registro
 * exacto de lo que P7.1 ejecutó realmente).
 *
 * Fixture dedicada: `fixtures/prototypes/p7-contact-form.png` -- 3
 * problemas controlados independientes:
 *   PEF2-ICON       (N-06)        ícono abstracto sin etiqueta
 *   PEF2-DUPLABEL   (N-04)        dos botones "Enviar" sin desambiguación propia
 *   PEF2-HEADING-OK (WCAG 2.4.6)  control negativo -- encabezado YA descriptivo
 *
 * Usa una variable de autorización PROPIA y DISTINTA de la del experimento
 * #1 (`PROTOTYPE_P7_EXPERIMENT_2_AUTHORIZED=yes`) -- autorizaciones
 * independientes y auditables por separado, mismo patrón que Gemini Real
 * #1/#2 para WEB en este proyecto.
 *
 * Mientras esa variable no esté definida como 'yes', ejecutar este archivo
 * NO realiza ninguna llamada real a Gemini -- solo corre el preflight.
 */
async function main() {
  console.log('🚨 EXPERIMENTO GEMINI REAL — Prototype #2 (observacional, n=1)\n');

  const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
  const imagePath = path.join(FIXTURES_ROOT, 'p7-contact-form.png');
  const groundTruthPath = path.join(FIXTURES_ROOT, 'p7-contact-form.groundtruth.json');

  const imageBuffer = fs.readFileSync(imagePath);
  const format = detectImageFormat(imageBuffer);
  const groundTruth: { fixture: string; expectedFindings: PrototypeExpectedFinding[] } = JSON.parse(
    fs.readFileSync(groundTruthPath, 'utf8'),
  );

  // NOTA: el Ground Truth cargado arriba se usa ÚNICAMENTE después de
  // recibir la respuesta de Gemini (análisis posterior) -- nunca se pasa a
  // `description`, `archetype` ni a ningún campo que llegue al prompt real.
  const archetype = {
    fullName: 'Ana Torres', archetype: 'El Explorador', profession: 'QA',
    phrase: 'Quiero que cada botón me diga claramente qué va a pasar al presionarlo',
    goals: ['Contactar al soporte sin confundirse de formulario'],
    frustrations: ['Botones con el mismo texto que hacen cosas distintas', 'Íconos sin etiqueta cuya función no puedo adivinar'],
    techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop',
  };

  const description = 'Pantalla de contacto de un sitio web. Incluye un formulario para enviar un mensaje de soporte y, debajo, una opción para suscribirse al boletín de novedades por correo.';

  const applicableCriteria = resolveApplicablePrototypeCriteria();
  const prompt: string = (aiService as any).buildPrototypeAuditPrompt(
    { evaluationId: 'prototype-p7-2', title: 'Formulario de contacto', description, archetype, imageMimeType: 'image/png', imageBase64: '' },
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
  console.log(`[x] Ground Truth dedicado tiene exactamente 3 expectedFindings: ${groundTruth.expectedFindings.length === 3}`);
  console.log(`[x] COST CONTROL: maxRetries=0 pasado explícitamente a performPrototypeAuditAnalysis -- máximo 1 intento físico, política global de retry (AI_RETRY_CONFIG, WEB) sin modificar`);
  console.log(`[${process.env.PROTOTYPE_P7_EXPERIMENT_2_AUTHORIZED === 'yes' ? 'x' : ' '}] Exactamente un experimento real autorizado (env PROTOTYPE_P7_EXPERIMENT_2_AUTHORIZED=yes)`);

  if (!format || wouldBlock || measurement.level === 'CRITICAL') {
    console.error('\n⛔ BLOCKED: la fixture o el payload no pasan el preflight. No se realiza ninguna llamada real.');
    fs.writeFileSync('/tmp/prototype-p7-experiment-2-result.json', JSON.stringify({ classification: 'BLOCKED', reason: 'preflight failed', measurement, format }, null, 2));
    process.exit(1);
  }

  if (process.env.PROTOTYPE_P7_EXPERIMENT_2_AUTHORIZED !== 'yes') {
    console.log('\n========================================');
    console.log('DETENIDO ANTES DE GEMINI (preparación, no ejecución)');
    console.log('========================================');
    console.log('Preflight OK pero no autorizado. Se requiere PROTOTYPE_P7_EXPERIMENT_2_AUTHORIZED=yes.');
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
    auditResult = await aiService.performPrototypeAuditAnalysis(
      {
        evaluationId: 'prototype-p7-2', title: 'Formulario de contacto', description, archetype,
        imageMimeType: mimeTypeForFormat(format), imageBase64,
      },
      { maxRetries: 0 },
    );
  } catch (err: any) {
    executionError = err;
  }
  const wallClockMs = Date.now() - startTime;

  if (executionError) {
    console.error(`\nRESULT: FAIL (1 único intento físico consumido, sin retry automático): ${executionError?.message || executionError}`);
    fs.writeFileSync(
      '/tmp/prototype-p7-experiment-2-result.json',
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
  fs.writeFileSync('/tmp/prototype-p7-experiment-2-result.json', JSON.stringify(dump, null, 2));
  console.log('\nDump completo escrito en /tmp/prototype-p7-experiment-2-result.json');
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
