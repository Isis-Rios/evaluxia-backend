import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { normalizeCriterionKey } from '@/shared/testing/ground-truth-oracle';
import { resolveApplicablePrototypeCriteria, getOutOfCoveragePrototypeCriteria } from './prototype-criteria-resolver';

/**
 * PrototypeMetricsService (P4) — análogo DELIBERADAMENTE SEPARADO de
 * `AuditMetricsService.calculateMetrics`: ese método asume un espacio FIJO
 * de 20 criterios (10 WCAG + 10 Nielsen, `SUPPORTED_WCAG_CRITERIA`/
 * `SUPPORTED_NIELSEN_HEURISTICS`), que para prototipos produciría
 * exactamente la lectura engañosa que K.2.1 §5 prohíbe ("6/10 parece que
 * fallamos 4" cuando 4 son OUT_OF_COVERAGE). Esta versión calcula cobertura
 * y score ÚNICAMENTE sobre los criterios que
 * `resolveApplicablePrototypeCriteria()` declara aplicables para esta
 * evaluación -- OUT_OF_COVERAGE nunca entra al denominador.
 *
 * También es más simple que su análogo WEB porque no existe consolidación
 * determinístico-vs-IA para prototipos en este MVP (una única fuente de
 * hallazgos: Gemini multimodal) -- no hay colisión de `origin` que arbitrar.
 */

const SEVERITY_PENALTY: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };

export interface PrototypeMetrics {
  overallScore: number | null;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  passCount: number;
  failCount: number;
  notEvaluableCount: number;
  coverage: {
    applicableCriteria: number;
    evaluatedCriteria: number;
    notEvaluableCriteria: number;
    outOfCoverageCriteria: number;
  };
}

export function calculatePrototypeMetrics(findings: PrototypeAuditFinding[]): PrototypeMetrics {
  const applicable = resolveApplicablePrototypeCriteria();
  const outOfCoverage = getOutOfCoveragePrototypeCriteria();
  const applicableKeys = new Set(applicable.map((c) => normalizeCriterionKey(c.code)));

  // P1.6.6.1 -- agrupa primero TODOS los hallazgos de cada criterio y recién
  // entonces decide el estado consolidado, en vez de ir actualizando un
  // acumulador hallazgo por hallazgo en el orden en que llegan. La política
  // de prioridad (FAIL > PASS > NOT_EVALUABLE) y la severidad máxima entre
  // los FAIL son ambas conmutativas sobre el conjunto de hallazgos del
  // criterio -- el resultado no puede depender del orden del array de
  // entrada. Corrige el defecto confirmado en la auditoría P1.6.6: el mismo
  // par de hallazgos (PASS + FAIL high) para un mismo criterio producía
  // `overallScore: 54` o `overallScore: 0` según cuál apareciera primero.
  const findingsByCriterion = new Map<string, PrototypeAuditFinding[]>();
  for (const f of findings) {
    const key = normalizeCriterionKey(f.wcagCriterion || f.heuristicCode || undefined);
    // Defensa adicional: un criterio fuera de la lista resuelta como
    // aplicable (ej. si Gemini igualmente lo mencionara pese a la
    // instrucción del prompt) nunca se cuenta -- ni como evaluado ni como
    // fallo. Nunca debería ocurrir si el prompt se respeta, pero no se
    // confía ciegamente en eso.
    if (!applicableKeys.has(key)) continue;

    const existing = findingsByCriterion.get(key);
    if (existing) existing.push(f);
    else findingsByCriterion.set(key, [f]);
  }

  const statusByCriterion = new Map<string, { status: 'PASS' | 'FAIL' | 'NOT_EVALUABLE'; maxSeverity: string }>();
  for (const [key, group] of findingsByCriterion) {
    const failItems = group.filter((f) => f.status === 'FAIL');
    if (failItems.length > 0) {
      const maxSeverity = failItems.reduce(
        (worst, f) => ((SEVERITY_PENALTY[f.severity] ?? 0) > (SEVERITY_PENALTY[worst] ?? 0) ? f.severity : worst),
        failItems[0].severity,
      );
      statusByCriterion.set(key, { status: 'FAIL', maxSeverity });
      continue;
    }

    const hasPass = group.some((f) => f.status === 'PASS');
    if (hasPass) {
      statusByCriterion.set(key, { status: 'PASS', maxSeverity: 'info' });
      continue;
    }

    statusByCriterion.set(key, { status: 'NOT_EVALUABLE', maxSeverity: 'info' });
  }

  let pass = 0;
  let fail = 0;
  for (const [, v] of statusByCriterion) {
    if (v.status === 'PASS') pass++;
    else if (v.status === 'FAIL') fail++;
  }
  const evaluated = pass + fail;
  const notEvaluableCriteria = Math.max(0, applicable.length - evaluated);

  let overallScore: number | null = null;
  if (evaluated > 0) {
    const compliance = (pass / evaluated) * 100;
    let totalPenalty = 0;
    for (const [, v] of statusByCriterion) {
      if (v.status === 'FAIL') totalPenalty += SEVERITY_PENALTY[v.maxSeverity] ?? 0;
    }
    const penaltyNormalized = totalPenalty / evaluated;
    const coverageRatio = applicable.length > 0 ? evaluated / applicable.length : 0;
    const gammaCoverage = 0.5 + 0.5 * coverageRatio;
    const baseQuality = Math.max(0, compliance - penaltyNormalized);
    overallScore = Math.min(100, Math.max(0, Math.round(baseQuality * gammaCoverage)));
  }

  const failFindings = findings.filter((f) => f.status === 'FAIL');

  return {
    overallScore,
    totalFindings: findings.length,
    criticalCount: failFindings.filter((f) => f.severity === 'critical').length,
    highCount: failFindings.filter((f) => f.severity === 'high').length,
    mediumCount: failFindings.filter((f) => f.severity === 'medium').length,
    lowCount: failFindings.filter((f) => f.severity === 'low').length,
    infoCount: findings.filter((f) => f.severity === 'info').length,
    passCount: pass,
    failCount: fail,
    notEvaluableCount: findings.filter((f) => f.status === 'NOT_EVALUABLE').length,
    coverage: {
      applicableCriteria: applicable.length,
      evaluatedCriteria: evaluated,
      notEvaluableCriteria,
      outOfCoverageCriteria: outOfCoverage.length,
    },
  };
}
