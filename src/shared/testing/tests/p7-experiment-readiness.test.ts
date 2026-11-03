import fs from 'fs';
import path from 'path';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';
import { aiService } from '@/modules/ai/ai.service';
import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { applyVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';
import { matchPrototypeFindings, PrototypeExpectedFinding } from '@/shared/testing/prototype-finding-matching';
import { detectImageFormat } from '@/modules/evaluations/services/prototype-image-upload.service';

/**
 * P7.0 — Readiness validation (testing-only, MOCK ONLY, cero Gemini real).
 *
 * Reproduce el recorrido EXACTO que ejecutará el primer experimento real
 * (performPrototypeAuditAnalysis -> VisualEvidenceGate -> cardinalidad ->
 * VisualEvidenceConsistency -> matchPrototypeFindings) contra respuestas
 * de Gemini SIMULADAS -- una "ideal" (para confirmar que el caso de éxito
 * realmente produce TP_EXACT con el Ground Truth real que se usará) y
 * varias que ejercen cada categoría de la taxonomía de fallo documentada
 * en el reporte P7.0, ANTES de gastar ningún crédito real.
 */

const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
const groundTruth: { expectedFindings: PrototypeExpectedFinding[] } = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-heading-label.groundtruth.json'), 'utf8'),
);

async function runPipeline(geminiJson: string) {
  const stub = stubGeminiJsonResponses([geminiJson]);
  try {
    const result = await aiService.performPrototypeAuditAnalysis({
      evaluationId: 'p7-readiness',
      title: 'Confirmación de compra',
      description: 'Pantalla de confirmación de compra de un checkout de comercio electrónico.',
      archetype: {
        fullName: 'Perfil Mock', archetype: 'El Explorador', profession: 'QA', phrase: 'frase',
        goals: ['completar la compra'], frustrations: ['pantallas confusas'], techSavviness: 'medium',
        accessibilityNeeds: [], preferredDevice: 'desktop',
      },
      imageMimeType: 'image/png',
      imageBase64: 'ZmFrZQ==',
    });
    const rawFindings = result.result.findings;
    const gated = visualEvidenceGateService.processPrototypeFindings(rawFindings);
    const { findings: cardChecked } = applyCardinalityEnforcement(gated);
    const { findings: validated } = applyVisualEvidenceConsistency(cardChecked);
    const matching = matchPrototypeFindings(groundTruth.expectedFindings, validated);
    return { rawFindings, validated, matching, callCount: stub.callCount() };
  } finally {
    stub.restore();
  }
}

function buildOutput(findings: any[]): string {
  return JSON.stringify({ overallScore: 70, executiveSummary: 'Resumen de prueba.', findings });
}

async function runTests() {
  console.log('🧪 Starting P7.0 — Experiment Readiness Validation (MOCK ONLY)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 0. Integridad de la fixture dedicada al experimento.
  const imageBuffer = fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-heading-label.png'));
  assert(detectImageFormat(imageBuffer) === 'png', 'p7-heading-label.png es un PNG real válido');
  assert(groundTruth.expectedFindings.length === 1, 'El Ground Truth dedicado declara exactamente 1 expectedFinding (PEF-H1)');

  // 1. CASO DE ÉXITO IDEALIZADO -- confirma que el camino feliz realmente
  // produce TP_EXACT con el Ground Truth REAL que usará el experimento.
  const idealResponse = buildOutput([
    {
      findingGroup: 'accessibility',
      status: 'FAIL',
      severity: 'medium',
      confidence: 'high',
      wcagCriterion: 'WCAG 2.4.6',
      description: 'El encabezado principal de la pantalla dice "Página", lo cual no describe el propósito real de la pantalla (confirmación de compra).',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Página' }],
      affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
      recommendation: 'Reemplazar "Página" por un encabezado que describa el propósito real, ej. "Confirmar tu pedido".',
    },
  ]);
  const idealResult = await runPipeline(idealResponse);
  assert(idealResult.callCount === 1, 'Camino feliz: exactamente 1 llamada (mockeada) a Gemini, sin retries');
  assert(idealResult.matching.counts.TP_EXACT === 1, 'Camino feliz: el matcher clasifica el finding idealizado como TP_EXACT contra el Ground Truth real');
  assert(idealResult.matching.counts.FN === 0, 'Camino feliz: PEF-H1 queda cubierto (no FN)');

  // 2. TAXONOMÍA DE FALLO -- "descripción genérica" (elementDescription="encabezado" a secas).
  const genericDescResponse = buildOutput([
    {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'medium', confidence: 'high',
      wcagCriterion: 'WCAG 2.4.6', description: 'Encabezado no descriptivo.',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado', region: 'top-center', property: 'visibleText', value: 'Página' }],
      affectedElement: { visualReference: { description: 'encabezado', region: 'top-center' } },
      recommendation: 'Usar un encabezado descriptivo.',
    },
  ]);
  // NOTA: "encabezado" (a secas) NO está en GENERIC_DESCRIPTION_DENYLIST
  // (solo boton/enlace/imagen/texto/icono/campo/etiqueta/elemento) -- por
  // diseño, la whitelist es intencionalmente pequeña (K.2.1.1: lista
  // determinista, no exhaustiva). Confirmamos el comportamiento REAL en vez
  // de asumirlo: con un único ítem de evidencia, ninguna comparación por
  // pares ocurre (no hay con qué contrastar), así que el resultado depende
  // únicamente de si "encabezado" pasa el filtro de especificidad.
  const genericDescResult = await runPipeline(genericDescResponse);
  assert(
    genericDescResult.matching.counts.TP_EXACT + genericDescResult.matching.counts.TP_SEMANTIC === 1,
    'Taxonomía: "encabezado" (sin modificador) SÍ pasa el filtro de especificidad actual (no está en la denylist) -- sigue clasificando como TP; documentado como límite conocido, no un fallo de esta validación',
  );

  // 3. TAXONOMÍA DE FALLO -- Gemini asigna un criterio incorrecto (fuera del GT) -> UNMATCHED, nunca TP forzado.
  const wrongCriterionResponse = buildOutput([
    {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'medium', confidence: 'high',
      wcagCriterion: 'WCAG 1.3.1', description: 'Problema de jerarquía visual.',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Página' }],
      affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
      recommendation: 'Ajustar la jerarquía visual.',
    },
  ]);
  const wrongCriterionResult = await runPipeline(wrongCriterionResponse);
  assert(wrongCriterionResult.matching.counts.UNMATCHED === 1, 'Taxonomía: criterio incorrecto (WCAG 1.3.1 en vez de 2.4.6) -> UNMATCHED, nunca TP/FP forzado');
  assert(wrongCriterionResult.matching.counts.FN === 1, 'Taxonomía: PEF-H1 queda como FN (el criterio esperado nunca se produjo)');

  // 4. TAXONOMÍA DE FALLO -- Gemini se abstiene (NOT_EVALUABLE) pese a que el problema es visualmente evidente.
  const abstainedResponse = buildOutput([
    {
      findingGroup: 'accessibility', status: 'NOT_EVALUABLE', severity: 'medium', confidence: 'low',
      wcagCriterion: 'WCAG 2.4.6', description: 'No se puede determinar con certeza.',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Página' }],
      affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
    },
  ]);
  const abstainedResult = await runPipeline(abstainedResponse);
  assert(abstainedResult.matching.counts.NOT_EVALUABLE >= 1, 'Taxonomía: abstención (NOT_EVALUABLE) se clasifica como tal, nunca como FN automático');

  // 5. TAXONOMÍA DE FALLO -- Gemini inventa una ratio numérica de contraste
  // (prohibido por el contrato Zod) -> la respuesta es rechazada en el
  // parseo de salida, lo que dispara el MISMO mecanismo de retry que WEB ya
  // tiene (hasta 3 intentos). Esto es relevante para el control de costo:
  // una respuesta no conforme puede convertir "1 llamada lógica" en hasta 3
  // intentos físicos.
  const invalidContrastResponse = buildOutput([
    {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'low', confidence: 'high',
      wcagCriterion: 'WCAG 1.4.3', description: 'Contraste insuficiente.',
      evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'texto de ayuda', property: 'visualContrast', value: '3.2:1' }],
      recommendation: 'Aumentar el contraste.',
    },
  ]);
  const stubInvalid = stubGeminiJsonResponses([invalidContrastResponse, buildOutput([])]);
  try {
    await aiService.performPrototypeAuditAnalysis({
      evaluationId: 'p7-readiness-invalid', title: 't', description: 'd',
      archetype: { fullName: 'a', archetype: 'a', profession: 'a', phrase: 'a', goals: [], frustrations: [], techSavviness: 'medium', accessibilityNeeds: [], preferredDevice: 'desktop' },
      imageMimeType: 'image/png', imageBase64: 'ZmFrZQ==',
    });
    assert(stubInvalid.callCount() === 2, 'Taxonomía: una ratio numérica de contraste inventada es rechazada por el schema Zod y dispara exactamente 1 retry (confirmado con el mecanismo real, no asumido)');
  } finally {
    stubInvalid.restore();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
