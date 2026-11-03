import { aiService } from '@/modules/ai/ai.service';
import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { applyVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';
import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * prototype-gemini-mock-harness.ts (testing-only) — análogo de
 * `gemini-mock-harness.ts` para el pipeline de prototipos. Reutiliza el
 * MISMO `stubGeminiJsonResponses`/`stubGeminiResponsesWithUsage` de ese
 * módulo (no se reimplementa ningún mecanismo de mock nuevo -- ambos stubs
 * ya interceptan `client.models.generateContent`, que
 * `generateMultimodalStructuredWithUsage` sigue invocando por debajo). Cero
 * llamadas reales a Gemini en ningún test que use este harness.
 */
export interface PrototypePipelineResult {
  rawFindings: PrototypeAuditFinding[];
  gatedFindings: PrototypeAuditFinding[];
  cardinalityCheckedFindings: PrototypeAuditFinding[];
  validatedFindings: PrototypeAuditFinding[];
  cardinalitySummary: { total: number; violations: number };
  consistencySummary: { total: number; consistent: number; inconsistent: number; insufficient: number };
  metrics: ReturnType<typeof calculatePrototypeMetrics>;
  usage: any;
}

const FAKE_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function runMockedPrototypePipeline(
  meta: { evaluationId: string; description?: string } = { evaluationId: 'prototype-mock' },
): Promise<PrototypePipelineResult> {
  const auditResult = await aiService.performPrototypeAuditAnalysis({
    evaluationId: meta.evaluationId,
    title: 'Prototipo mock',
    description: meta.description || 'Pantalla de checkout ficticia para pruebas deterministas.',
    archetype: {
      fullName: 'Perfil Mock',
      archetype: 'El Explorador',
      profession: 'QA',
      phrase: 'Pruebo todo dos veces',
      goals: ['Completar el checkout'],
      frustrations: ['Botones ambiguos'],
      techSavviness: 'medium',
      accessibilityNeeds: [],
      preferredDevice: 'desktop',
    },
    imageMimeType: 'image/png',
    imageBase64: FAKE_1X1_PNG_BASE64,
  });

  const rawFindings = auditResult.result.findings;
  const gatedFindings = visualEvidenceGateService.processPrototypeFindings(rawFindings);
  const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } = applyCardinalityEnforcement(gatedFindings);
  const { findings: validatedFindings, summary: consistencySummary } = applyVisualEvidenceConsistency(cardinalityCheckedFindings);
  const metrics = calculatePrototypeMetrics(validatedFindings);

  return {
    rawFindings,
    gatedFindings,
    cardinalityCheckedFindings,
    validatedFindings,
    cardinalitySummary,
    consistencySummary,
    metrics,
    usage: auditResult.usage,
  };
}

/** Builds a minimal, schema-valid PrototypeAuditOutput JSON string. */
export function buildValidPrototypeAuditOutputJson(findings: any[], overallScore = 70): string {
  return JSON.stringify({
    overallScore,
    executiveSummary: 'Resumen ejecutivo de prueba (prototipo, mock).',
    findings,
  });
}
