import { Schema, model, Document } from 'mongoose';
import { EvaluationMetrics } from '@/shared/infrastructure/metrics-tracker';

export type ReportFormat = 'json' | 'html' | 'pdf';
export type ReportStatus = 'generating' | 'ready' | 'failed';

export interface IReport extends Document {
  evaluationId: string;
  title: string;
  format: ReportFormat;
  status: ReportStatus;
  filePath?: string;
  summary?: string;
  /**
   * P2-1 — Semántica diferenciada por flujo:
   * - En WEB (`AuditMetricsService`): cuenta únicamente los hallazgos consolidados
   *   con `status: 'FAIL'` (coincide con `criticalCount + highCount + mediumCount + lowCount`).
   * - En PROTOTIPO (`PrototypeMetricsService`): cuenta TODOS los hallazgos generados
   *   (`findings.length`, incluyendo `PASS`, `FAIL` y `NOT_EVALUABLE`).
   * No deben compararse entre ambos flujos como medidas equivalentes.
   */
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  passCount?: number;
  failCount?: number;
  notEvaluableCount?: number;
  /**
   * P1-1 — Los siguientes 7 campos (`nielsenCompliance`, `wcagCompliance`,
   * `auditCoverage`, `nielsenCoverage`, `wcagCoverage`, `evaluatedCriteria`,
   * `totalCriteria`) son exclusivos del flujo WEB (`AuditEngineService`,
   * espacio fijo de 20 criterios). En evaluaciones de PROTOTIPO no se
   * calculan ni se pueblan (quedan `undefined`), utilizándose en su lugar
   * el subdocumento `coverage` (`applicableCriteria: 13`, `evaluatedCriteria`,
   * `notEvaluableCriteria`, `outOfCoverageCriteria: 6`).
   */
  nielsenCompliance?: number | null;
  wcagCompliance?: number | null;
  auditCoverage?: number;
  nielsenCoverage?: number;
  wcagCoverage?: number;
  evaluatedCriteria?: number;
  totalCriteria?: number;
  evidenceCount?: number;
  screenshotsCount?: number;
  iterationsEvaluated?: number;
  overallScore?: number | null;
  /**
   * P2-2 — Telemetría de consumo de IA. Para el costo de una evaluación
   * individual debe consultarse `metrics.estimatedCostUsd`;
   * `metrics.cumulativeCostUsd` es un acumulador en memoria por tiempo de
   * vida del proceso backend, no por evaluación.
   */
  metrics?: EvaluationMetrics;
  /**
   * Prototype visual evaluation (K.2.1 §5) — metadata de cobertura.
   * `applicableCriteria`/`evaluatedCriteria`/`notEvaluableCriteria` se
   * calculan SOLO sobre criterios aplicables (nunca incluyen
   * OUT_OF_COVERAGE en el denominador — ver `prototype-criteria-resolver.
   * ts`); `outOfCoverageCriteria` se reporta aparte, explícitamente, nunca
   * como fallo. Opcional: ausente para evaluaciones WEB (sin cambios).
   */
  coverage?: {
    applicableCriteria: number;
    evaluatedCriteria: number;
    notEvaluableCriteria: number;
    outOfCoverageCriteria: number;
  };
  /**
   * P1.7.2 — qué política de persistencia de Findings estaba vigente
   * cuando se generó este Report. `'PASS_PERSISTED'` indica que un
   * criterio sin Finding en absoluto (para esta evaluación) puede
   * interpretarse con confianza como silencio real de Gemini (no como un
   * PASS descartado). `'PASS_DISCARDED'` es el comportamiento anterior
   * (Findings PASS nunca se persistían). Ausente (`undefined`) en todo
   * Report generado antes de este campo existir -- esa ausencia ES la
   * señal de "histórico, política desconocida", nunca se infiere ni se
   * retrocompleta.
   */
  findingPersistencePolicy?: 'PASS_PERSISTED' | 'PASS_DISCARDED';
  /**
   * P1.7.2 — `env.GEMINI_MODEL` efectivo en el momento de generar este
   * Report (único punto real de la llamada al cliente, ver
   * `gemini.client.ts`). Opcional y aditivo: ausente en todo Report
   * anterior a este campo -- esa ausencia nunca debe interpretarse como
   * "modelo por defecto", el valor real de esas ejecuciones es
   * irrecuperable.
   */
  geminiModel?: string;
  generatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
  {
    evaluationId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    format: { type: String, enum: ['json', 'html', 'pdf'], default: 'json' },
    status: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating' },
    filePath: { type: String },
    summary: { type: String },
    totalFindings: { type: Number, default: 0 },
    criticalCount: { type: Number, default: 0 },
    highCount: { type: Number, default: 0 },
    mediumCount: { type: Number, default: 0 },
    lowCount: { type: Number, default: 0 },
    infoCount: { type: Number, default: 0 },
    passCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    notEvaluableCount: { type: Number, default: 0 },
    nielsenCompliance: { type: Number, default: null },
    wcagCompliance: { type: Number, default: null },
    auditCoverage: { type: Number },
    nielsenCoverage: { type: Number },
    wcagCoverage: { type: Number },
    evaluatedCriteria: { type: Number },
    totalCriteria: { type: Number },
    evidenceCount: { type: Number, default: 0 },
    screenshotsCount: { type: Number, default: 0 },
    iterationsEvaluated: { type: Number, default: 1 },
    overallScore: { type: Number, default: null },
    metrics: { type: Schema.Types.Mixed, default: null },
    coverage: {
      applicableCriteria: { type: Number },
      evaluatedCriteria: { type: Number },
      notEvaluableCriteria: { type: Number },
      outOfCoverageCriteria: { type: Number },
    },
    findingPersistencePolicy: { type: String, enum: ['PASS_PERSISTED', 'PASS_DISCARDED'] },
    geminiModel: { type: String },
    generatedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Report = model<IReport>('Report', ReportSchema);
