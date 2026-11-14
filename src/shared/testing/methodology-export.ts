/**
 * P1.7.2 — núcleo puro (sin I/O) de la herramienta de extracción
 * metodológica. Reconstruye, por evaluación y criterio, el estado
 * recuperable de cada criterio WCAG/Nielsen aplicable, para alimentar los
 * Anexos B/D/E del proyecto de grado.
 *
 * Diseñado y auditado en P1.7.1/P1.7.2/P1.7.2.1 antes de escribirse.
 * Reglas obligatorias que este módulo nunca viola:
 *   1. Nunca infiere PASS por ausencia de Finding.
 *   2. Nunca confunde NOT_EVALUABLE con OUT_OF_COVERAGE.
 *   3. Nunca afirma que Gemini "guardó silencio" como hecho confirmado --
 *      solo registra que no hay un resultado persistido, con una nota que
 *      no atribuye causa quirúrgica cuando no hay evidencia suficiente.
 *   4. Reproduce las reglas REALES de consolidación de cada pipeline
 *      (WEB: `audit-metrics.service.ts`; PROTOTYPE:
 *      `prototype-metrics.service.ts`) antes de comparar contra `Report`.
 *   5. Es exclusivamente de lectura: no escribe nada, no modifica nada.
 */

import { normalizeCriterionKey } from './ground-truth-oracle';
import { SUPPORTED_WCAG_CRITERIA, SUPPORTED_NIELSEN_HEURISTICS } from '@/modules/evaluations/services/audit-metrics.service';
import {
  resolveApplicablePrototypeCriteria,
  getOutOfCoveragePrototypeCriteria,
} from '@/modules/evaluations/services/prototype-criteria-resolver';

export type RecoveredStatus =
  | 'PASS confirmado'
  | 'FAIL confirmado'
  | 'NOT_EVALUABLE'
  | 'OUT_OF_COVERAGE'
  | 'SIN_RESULTADO_RECUPERABLE';

export type ExportEvaluationType = 'WEB' | 'PROTOTYPE';

/**
 * WCAG 2.1.1 (Teclado) y WCAG 3.2.2 (On Input) están en
 * `SUPPORTED_WCAG_CRITERIA` (para que el slot exista y se reporte
 * honestamente en las métricas agregadas), pero el prompt WEB NUNCA los
 * envía a Gemini y no existe ninguna verificación determinística para
 * ellos (`ai.service.ts`, Hardening K.1 Parte E / post Gemini Real #1,
 * confirmado por auditoría de código en P1.7.1). Para esta herramienta de
 * extracción son, en la práctica, OUT_OF_COVERAGE -- nunca pueden producir
 * un Finding real, por diseño permanente, igual que los criterios
 * OUT_OF_COVERAGE de prototipos.
 */
const WEB_PERMANENTLY_EXCLUDED_WCAG = new Set(
  ['WCAG 2.1.1', 'WCAG 3.2.2'].map((c) => normalizeCriterionKey(c)),
);

const WEB_CRITERION_NAMES: Record<string, string> = {
  'WCAG 1.1.1': 'Contenido no textual',
  'WCAG 1.3.1': 'Información y relaciones',
  'WCAG 1.4.1': 'Uso del color',
  'WCAG 1.4.3': 'Contraste mínimo',
  'WCAG 2.1.1': 'Teclado',
  'WCAG 2.4.4': 'Propósito de los enlaces (en contexto)',
  'WCAG 2.4.6': 'Encabezados y etiquetas',
  'WCAG 3.2.2': 'Al recibir entradas',
  'WCAG 3.3.2': 'Etiquetas o instrucciones',
  'WCAG 4.1.2': 'Nombre, función, valor',
  'N-01': 'Visibilidad del estado del sistema',
  'N-02': 'Coincidencia entre el sistema y el mundo real',
  'N-03': 'Control y libertad del usuario',
  'N-04': 'Consistencia y estándares',
  'N-05': 'Prevención de errores',
  'N-06': 'Reconocimiento antes que recuerdo',
  'N-07': 'Flexibilidad y eficiencia de uso',
  'N-08': 'Diseño estético y minimalista',
  'N-09': 'Ayudar a reconocer, diagnosticar y recuperarse de errores',
  'N-10': 'Ayuda y documentación',
};

const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export interface ExportedCriterionRecord {
  evaluationId: string;
  evaluationType: ExportEvaluationType;
  criterionId: string;
  criterionName: string;
  recoveredStatus: RecoveredStatus;
  evidence: unknown[];
  description: string | null;
  recommendation: string | null;
  geminiModel: string | null;
  findingPersistencePolicy: 'PASS_PERSISTED' | 'PASS_DISCARDED' | null;
  historicalLimitationNote: string | null;
  /** P1.7.2.3 — `false` solo para los 6 criterios de prototipo sin código CRI (ver `ANNEX_C_EXCLUSION_NOTE`). */
  inAnnexCInstrument: boolean;
  annexCNote: string | null;
}

export interface MinimalFindingForExport {
  wcagCriterion?: string | null;
  heuristicCode?: string | null;
  status: 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
  severity?: string;
  description?: string | null;
  recommendation?: string | null;
  evidence?: unknown[];
}

export interface MinimalReportForExport {
  passCount?: number;
  failCount?: number;
  notEvaluableCount?: number;
  totalCriteria?: number;
  coverage?: {
    applicableCriteria: number;
    evaluatedCriteria: number;
    notEvaluableCriteria: number;
    outOfCoverageCriteria: number;
  };
  findingPersistencePolicy?: 'PASS_PERSISTED' | 'PASS_DISCARDED';
  geminiModel?: string;
}

export interface MinimalEvaluationForExport {
  id: string;
  type: 'website' | 'prototype';
  status?: string;
  auditStatus?: string;
}

export interface EvaluationExportValidation {
  /** `false` cuando hay Report para comparar y alguna identidad no cuadra. */
  valid: boolean;
  passMatchesReport: boolean | null;
  failMatchesReport: boolean | null;
  remainderMatchesReport: boolean | null;
  discrepancies: string[];
}

export interface EvaluationExportResult {
  evaluationId: string;
  evaluationType: ExportEvaluationType;
  records: ExportedCriterionRecord[];
  validation: EvaluationExportValidation;
}

interface CriterionDefinition {
  code: string;
  name: string;
  outOfCoverage: boolean;
  /**
   * P1.7.2.3 — `false` ÚNICAMENTE para los 6 criterios de prototipo
   * (WCAG 4.1.2, WCAG 2.1.1, N-01, N-07, N-09, N-10) que el resolver
   * documenta como OUT_OF_COVERAGE pero que el Anexo C NUNCA define para la
   * modalidad "Imagen" (Tabla C1 solo cubre CRI-21 a CRI-33, 13 criterios).
   * Son información técnica interna de cobertura del sistema, no parte del
   * instrumento metodológico -- deben excluirse de la matriz de
   * comparación del Anexo D, nunca recibir un código CRI artificial. Los 20
   * criterios WEB (incluidos WCAG 2.1.1/3.2.2, que SÍ tienen CRI-05/CRI-08)
   * están siempre en `true`.
   */
  inAnnexCInstrument: boolean;
}

const ANNEX_C_EXCLUSION_NOTE =
  'Este criterio no corresponde a ningún código CRI del Anexo C para la modalidad "Imagen" ' +
  '(Tabla C1 solo define CRI-21 a CRI-33, 13 criterios). Es información técnica de cobertura ' +
  'del sistema, no un resultado del instrumento metodológico -- debe excluirse de la matriz de ' +
  'comparación del Anexo D, nunca recibir un código CRI artificial.';

function resolveCriteriaSpace(evaluationType: ExportEvaluationType): CriterionDefinition[] {
  if (evaluationType === 'PROTOTYPE') {
    const applicable = resolveApplicablePrototypeCriteria();
    const outOfCoverage = getOutOfCoveragePrototypeCriteria();
    return [
      ...applicable.map((c) => ({ code: normalizeCriterionKey(c.code), name: c.name, outOfCoverage: false, inAnnexCInstrument: true })),
      ...outOfCoverage.map((c) => ({ code: normalizeCriterionKey(c.code), name: c.name, outOfCoverage: true, inAnnexCInstrument: false })),
    ];
  }

  // WEB -- los 20 criterios tienen código CRI en el Anexo C (CRI-01 a
  // CRI-20), incluidos WCAG 2.1.1 (CRI-05) y WCAG 3.2.2 (CRI-08) aunque el
  // sistema nunca pueda producir un resultado real para ellos.
  const wcag = SUPPORTED_WCAG_CRITERIA.map((code) => {
    const normalized = normalizeCriterionKey(code);
    return { code: normalized, name: WEB_CRITERION_NAMES[normalized] ?? code, outOfCoverage: WEB_PERMANENTLY_EXCLUDED_WCAG.has(normalized), inAnnexCInstrument: true };
  });
  const nielsen = SUPPORTED_NIELSEN_HEURISTICS.map((code) => {
    const normalized = normalizeCriterionKey(code);
    return { code: normalized, name: WEB_CRITERION_NAMES[normalized] ?? code, outOfCoverage: false, inAnnexCInstrument: true };
  });
  return [...wcag, ...nielsen];
}

function pickWorstFail(fails: MinimalFindingForExport[]): MinimalFindingForExport {
  return fails.reduce((worst, f) => {
    const worstRank = SEVERITY_RANK[worst.severity ?? 'info'] ?? 0;
    const currentRank = SEVERITY_RANK[f.severity ?? 'info'] ?? 0;
    return currentRank > worstRank ? f : worst;
  }, fails[0]);
}

function isEvaluationCompleted(evaluation: MinimalEvaluationForExport): boolean {
  // P1.6.7 reconcileStuckRunning solo deja 'completed'/'failed' como
  // estados terminales reales; cualquier otro valor (incluida ausencia) se
  // trata como "no completada" -- nunca se asume éxito por defecto.
  return evaluation.status === 'completed' && (evaluation.auditStatus === undefined || evaluation.auditStatus === 'completed');
}

/**
 * Construye el registro de exportación por criterio para UNA evaluación.
 * Función pura: no hace I/O, no depende de MongoDB -- toda la información
 * se recibe ya cargada. Esto es deliberado para que sea 100% testeable con
 * datos controlados (P1.7.2, sección 7).
 */
export function buildCriterionExport(params: {
  evaluation: MinimalEvaluationForExport;
  report: MinimalReportForExport | null;
  findings: MinimalFindingForExport[];
}): EvaluationExportResult {
  const { evaluation, report, findings } = params;
  const evaluationType: ExportEvaluationType = evaluation.type === 'prototype' ? 'PROTOTYPE' : 'WEB';
  const criteriaSpace = resolveCriteriaSpace(evaluationType);
  const completed = isEvaluationCompleted(evaluation);
  const policy = report?.findingPersistencePolicy ?? null;
  const geminiModel = report?.geminiModel ?? null;

  // Regla 4 (reproducir la consolidación real): agrupar por criterio
  // normalizado ANTES de decidir el estado, igual que
  // `calculateMetrics`/`calculatePrototypeMetrics` -- nunca se cuenta una
  // instancia cruda como si fuera un criterio.
  const findingsByCriterion = new Map<string, MinimalFindingForExport[]>();
  for (const f of findings) {
    const key = normalizeCriterionKey(f.wcagCriterion || f.heuristicCode || undefined);
    const group = findingsByCriterion.get(key);
    if (group) group.push(f);
    else findingsByCriterion.set(key, [f]);
  }

  const records: ExportedCriterionRecord[] = criteriaSpace.map((criterion) => {
    const base = {
      evaluationId: evaluation.id,
      evaluationType,
      criterionId: criterion.code,
      criterionName: criterion.name,
      geminiModel,
      findingPersistencePolicy: policy,
      inAnnexCInstrument: criterion.inAnnexCInstrument,
      annexCNote: criterion.inAnnexCInstrument ? null : ANNEX_C_EXCLUSION_NOTE,
    };

    if (criterion.outOfCoverage) {
      return {
        ...base,
        recoveredStatus: 'OUT_OF_COVERAGE' as const,
        evidence: [],
        description: null,
        recommendation: null,
        historicalLimitationNote: null,
      };
    }

    const group = findingsByCriterion.get(criterion.code) ?? [];
    const fails = group.filter((f) => f.status === 'FAIL');
    const passes = group.filter((f) => f.status === 'PASS');
    const notEvaluables = group.filter((f) => f.status === 'NOT_EVALUABLE');

    // Prioridad FAIL > PASS > NOT_EVALUABLE, idéntica a ambos pipelines.
    // Esta rama aplica SIEMPRE que exista un Finding real, sin importar la
    // política de persistencia vigente -- un resultado persistido es un
    // hecho, nunca se descarta por la política (P1.7.2.3, punto 2).
    if (fails.length > 0) {
      const worst = pickWorstFail(fails);
      return {
        ...base,
        recoveredStatus: 'FAIL confirmado' as const,
        evidence: fails.flatMap((f) => f.evidence ?? []),
        description: worst.description ?? null,
        recommendation: worst.recommendation ?? null,
        historicalLimitationNote: null,
      };
    }
    if (passes.length > 0) {
      return {
        ...base,
        recoveredStatus: 'PASS confirmado' as const,
        evidence: passes.flatMap((f) => f.evidence ?? []),
        description: passes[0].description ?? null,
        recommendation: passes[0].recommendation ?? null,
        historicalLimitationNote: null,
      };
    }
    if (notEvaluables.length > 0) {
      return {
        ...base,
        recoveredStatus: 'NOT_EVALUABLE' as const,
        evidence: notEvaluables.flatMap((f) => f.evidence ?? []),
        description: notEvaluables[0].description ?? null,
        recommendation: notEvaluables[0].recommendation ?? null,
        historicalLimitationNote: null,
      };
    }

    // Silencio total para este criterio -- aquí es donde la regla 1 y la
    // regla 3 importan más: NUNCA se infiere PASS, y la nota nunca afirma
    // una causa que los datos no permiten confirmar.
    if (!completed) {
      return {
        ...base,
        recoveredStatus: 'SIN_RESULTADO_RECUPERABLE' as const,
        evidence: [],
        description: null,
        recommendation: null,
        historicalLimitationNote:
          'La evaluación no completó exitosamente (status/auditStatus distinto de "completed"); ' +
          'la ausencia de resultado para este criterio puede deberse a que el proceso se interrumpió, ' +
          'no a un juicio de Gemini sobre el criterio.',
      };
    }
    if (policy === null) {
      return {
        ...base,
        recoveredStatus: 'SIN_RESULTADO_RECUPERABLE' as const,
        evidence: [],
        description: null,
        recommendation: null,
        historicalLimitationNote:
          'Evaluación histórica sin findingPersistencePolicy registrada: bajo la política anterior, ' +
          'los hallazgos PASS nunca se persistían, por lo que esta ausencia NO permite determinar si ' +
          'el criterio fue evaluado como conforme o si nunca fue considerado.',
      };
    }
    // P1.7.2.3, punto 2 -- tratamiento explícito de PASS_DISCARDED, nunca
    // confundido con PASS_PERSISTED. No existe hoy ningún código de
    // producción que escriba este valor, pero el núcleo debe manejarlo
    // correctamente si una migración futura lo asigna a Reports antiguos.
    if (policy === 'PASS_DISCARDED') {
      return {
        ...base,
        recoveredStatus: 'SIN_RESULTADO_RECUPERABLE' as const,
        evidence: [],
        description: null,
        recommendation: null,
        historicalLimitationNote:
          'Evaluación ejecutada bajo la política PASS_DISCARDED: los hallazgos PASS se descartaban ' +
          'deliberadamente antes de persistirse. Esta ausencia NO permite recuperar el resultado individual ' +
          'de este criterio -- nunca debe interpretarse como PASS ni como FAIL.',
      };
    }
    // policy === 'PASS_PERSISTED'
    return {
      ...base,
      recoveredStatus: 'SIN_RESULTADO_RECUPERABLE' as const,
      evidence: [],
      description: null,
      recommendation: null,
      historicalLimitationNote:
        'Evaluación completada bajo la política PASS_PERSISTED, sin ningún Finding persistido para este ' +
        'criterio. El sistema no registra si el modelo lo consideró y no se pronunció, o si nunca lo evaluó; ' +
        'no se atribuye una causa específica por no haber evidencia suficiente para distinguirlas.',
    };
  });

  const validation = validateAgainstReport({ evaluationType, report, records, completed });

  return {
    evaluationId: evaluation.id,
    evaluationType,
    records,
    validation,
  };
}

function validateAgainstReport(params: {
  evaluationType: ExportEvaluationType;
  report: MinimalReportForExport | null;
  records: ExportedCriterionRecord[];
  completed: boolean;
}): EvaluationExportValidation {
  const { evaluationType, report, records, completed } = params;
  const discrepancies: string[] = [];

  // P1.7.2.3, punto 3 -- chequeo EXPLÍCITO y directo del estado real de la
  // evaluación (campo `status`/`auditStatus` que ya persiste
  // `evaluation.model.ts`, sin ningún mecanismo de seguimiento nuevo).
  // Nunca se aprueba una evaluación incompleta, incluso si sus conteos
  // coincidieran por casualidad con un Report parcial -- antes esto
  // dependía únicamente de que el pipeline no cree Report cuando falla
  // (efecto colateral de otro módulo, no una regla propia del validador).
  if (!completed) {
    discrepancies.push('La evaluación no completó exitosamente (status/auditStatus distinto de "completed") -- no puede aprobarse, sin importar si los conteos coinciden con el Report.');
  }

  if (!report) {
    discrepancies.push('No existe Report para esta evaluación -- no es posible validar contra agregados.');
    return { valid: false, passMatchesReport: null, failMatchesReport: null, remainderMatchesReport: null, discrepancies };
  }

  const passCount = records.filter((r) => r.recoveredStatus === 'PASS confirmado').length;
  const failCount = records.filter((r) => r.recoveredStatus === 'FAIL confirmado').length;
  const remainderCount = records.filter((r) =>
    r.recoveredStatus === 'NOT_EVALUABLE' || r.recoveredStatus === 'OUT_OF_COVERAGE' || r.recoveredStatus === 'SIN_RESULTADO_RECUPERABLE',
  ).length;

  const reportPassCount = report.passCount ?? null;
  const reportFailCount = report.failCount ?? null;
  const totalSpace =
    evaluationType === 'WEB'
      ? report.totalCriteria ?? 20
      : (report.coverage?.applicableCriteria ?? 0) + (report.coverage?.outOfCoverageCriteria ?? 0);

  const passMatchesReport = reportPassCount === null ? null : passCount === reportPassCount;
  const failMatchesReport = reportFailCount === null ? null : failCount === reportFailCount;
  const expectedRemainder = totalSpace - passCount - failCount;
  const remainderMatchesReport = remainderCount === expectedRemainder;

  if (passMatchesReport === false) {
    discrepancies.push(`PASS extraído (${passCount}) no coincide con report.passCount (${reportPassCount}).`);
  }
  if (failMatchesReport === false) {
    discrepancies.push(`FAIL extraído (${failCount}) no coincide con report.failCount (${reportFailCount}).`);
  }
  if (!remainderMatchesReport) {
    discrepancies.push(
      `Identidad de espacio total no cuadra: NOT_EVALUABLE+OUT_OF_COVERAGE+SIN_RESULTADO_RECUPERABLE (${remainderCount}) ` +
      `!= totalCriterios-PASS-FAIL (${expectedRemainder}).`,
    );
  }

  const valid = completed && passMatchesReport !== false && failMatchesReport !== false && remainderMatchesReport;

  return { valid, passMatchesReport, failMatchesReport, remainderMatchesReport, discrepancies };
}

/**
 * Serializa un conjunto de resultados de exportación a filas CSV (sin
 * dependencias externas).
 *
 * P1.7.2.3, punto 1 -- `validationStatus`/`validationDiscrepancies` se leen
 * DIRECTAMENTE de `EvaluationExportResult.validation` (nunca se recalculan
 * ni se infieren desde los registros), y se repiten idénticas en TODAS las
 * filas de la misma evaluación, para que la validez sea visible fila por
 * fila sin necesidad de abrir el JSON. Si una evaluación no tiene ningún
 * registro (`records.length === 0`), se emite igualmente una fila
 * "placeholder" con las columnas de criterio vacías -- su invalidez nunca
 * desaparece silenciosamente del CSV.
 */
export function toCsv(results: EvaluationExportResult[]): string {
  const headers = [
    'evaluationId',
    'evaluationType',
    'criterionId',
    'criterionName',
    'recoveredStatus',
    'evidence',
    'description',
    'recommendation',
    'geminiModel',
    'findingPersistencePolicy',
    'historicalLimitationNote',
    'inAnnexCInstrument',
    'annexCNote',
    'validationStatus',
    'validationDiscrepancies',
  ];

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = results.flatMap((r) => {
    const validationStatus = r.validation.valid ? 'VALID' : 'INVALID';
    const validationDiscrepancies = r.validation.discrepancies.join('; ');

    if (r.records.length === 0) {
      // Evaluación sin ningún registro -- su invalidez debe seguir visible.
      return [
        [
          r.evaluationId,
          r.evaluationType,
          '', '', '', '', '', '', '', '', '', '', '',
          validationStatus,
          validationDiscrepancies,
        ].map(escape).join(','),
      ];
    }

    return r.records.map((rec) =>
      [
        rec.evaluationId,
        rec.evaluationType,
        rec.criterionId,
        rec.criterionName,
        rec.recoveredStatus,
        rec.evidence,
        rec.description,
        rec.recommendation,
        rec.geminiModel,
        rec.findingPersistencePolicy,
        rec.historicalLimitationNote,
        rec.inAnnexCInstrument,
        rec.annexCNote,
        validationStatus,
        validationDiscrepancies,
      ].map(escape).join(','),
    );
  });

  return [headers.join(','), ...rows].join('\n') + '\n';
}
