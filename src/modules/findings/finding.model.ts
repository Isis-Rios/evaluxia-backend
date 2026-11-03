import { Schema, model, Document, Types } from 'mongoose';

export type FindingGroup = 'ux' | 'accessibility';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export type FindingConfidence = 'high' | 'medium' | 'low';

export type TechnicalEvidenceType =
  | 'DOM_ATTRIBUTE'
  | 'COMPUTED_STYLE'
  | 'ACCESSIBILITY_TREE'
  | 'SCREENSHOT'
  | 'INTERACTION'
  | 'HEADING_STRUCTURE'
  /**
   * Prototype visual evaluation (K.2.1.1/implementación P0) — ÚNICO tipo de
   * evidencia nuevo, aditivo. Nunca emitido por el pipeline WEB; solo
   * `PrototypeEvaluationService`/Gemini multimodal lo produce. Ver
   * `prototype.contracts.ts` para el contrato Zod completo (whitelist de
   * `property`, reglas de `region`/`elementDescription`).
   */
  | 'VISUAL_OBSERVATION';

/**
 * Grid espacial 3x3 + `full-screen` (K.2/K.2.1/K.2.1.1) — contexto espacial
 * de una observación visual, NUNCA identidad de elemento (ver
 * `visual-evidence-consistency.service.ts`: region por sí sola, o
 * region+property, nunca distingue dos elementos distintos).
 */
export type VisualRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'full-screen';

export interface TechnicalEvidenceItem {
  type: TechnicalEvidenceType;
  property?: string;
  value?: string;
  selector?: string;
  attribute?: string;
  measurement?: string;
  context?: string;
  relatedValue?: {
    property?: string;
    value?: string;
  };
  /**
   * Prototype visual evaluation — presentes ÚNICAMENTE en ítems
   * `type: 'VISUAL_OBSERVATION'`. `elementDescription` es texto libre
   * descriptivo del elemento observado (ej. "botón Guardar"); solo cuenta
   * como identidad suficiente cuando es ESPECÍFICO (ver
   * `visual-evidence-consistency.service.ts`). `region` es contexto
   * espacial corroborante, nunca identidad por sí solo (K.2.1.1).
   */
  elementDescription?: string;
  region?: VisualRegion;
}

export interface AffectedElement {
  tag?: string;
  text?: string;
  selector?: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  id?: string;
  attributes?: Record<string, string>;
  /**
   * Prototype visual evaluation — análogo de `selector` para una imagen
   * estática (nunca se inventa un selector CSS para un prototipo, K.2.1.1
   * §4/sección 18 del prompt de implementación).
   */
  visualReference?: {
    description?: string;
    region?: VisualRegion;
  };
}

/**
 * Finding — Unifies Evidence-Based UX and Accessibility findings (Subetapa 3B).
 */
export interface IFinding extends Document {
  evaluationId: Types.ObjectId;
  iteration: number;

  findingGroup: FindingGroup;
  type?: string;

  status: FindingStatus;
  severity: FindingSeverity;
  confidence: FindingConfidence;

  heuristicCode?: string; // e.g. "N-01"
  heuristicName?: string; // e.g. "Visibilidad del estado del sistema"
  heuristic?: string; // Deprecated legacy field for backward compatibility

  wcagCriterion?: string; // e.g. "1.4.3 Contraste Mínimo"

  description: string;
  evidence?: TechnicalEvidenceItem[];
  affectedElement?: AffectedElement;
  impact?: string;
  recommendation?: string | null;

  screenshotUrl?: string; // Traceable path reference e.g. /uploads/evaluation_{id}_step_{iteration}.png

  /**
   * Hardening (post Gemini Real #1, hallazgo A) -- presente únicamente
   * cuando, durante la consolidación (`AuditMetricsService.
   * deduplicateFindings`), un finding determinístico y uno de IA
   * compartieron el mismo criterio+selector pero discreparon en `status`.
   * El veredicto perdedor NUNCA se descarta en silencio: se preserva aquí
   * íntegro para inspección (frontend, soporte, análisis posterior). Ver
   * `ConsolidationDiscrepancy` en audit-metrics.service.ts.
   */
  discrepancy?: {
    origin: 'deterministic' | 'ai';
    status: FindingStatus;
    severity: FindingSeverity;
    confidence: FindingConfidence;
    description: string;
    recommendation?: string | null;
    evidence?: TechnicalEvidenceItem[];
  };

  createdAt: Date;
  updatedAt: Date;
}

const TechnicalEvidenceItemSchema = new Schema<TechnicalEvidenceItem>(
  {
    type: {
      type: String,
      enum: [
        'DOM_ATTRIBUTE',
        'COMPUTED_STYLE',
        'ACCESSIBILITY_TREE',
        'SCREENSHOT',
        'INTERACTION',
        'HEADING_STRUCTURE',
        'VISUAL_OBSERVATION',
      ],
      required: true,
    },
    property: { type: String },
    value: { type: String },
    selector: { type: String },
    attribute: { type: String },
    measurement: { type: String },
    context: { type: String },
    relatedValue: {
      property: { type: String },
      value: { type: String },
    },
    elementDescription: { type: String },
    region: {
      type: String,
      enum: [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
        'full-screen',
      ],
    },
  },
  { _id: false },
);

const AffectedElementSchema = new Schema<AffectedElement>(
  {
    tag: { type: String },
    text: { type: String },
    selector: { type: String },
    role: { type: String },
    ariaLabel: { type: String },
    href: { type: String },
    id: { type: String },
    attributes: { type: Map, of: String },
    visualReference: {
      description: { type: String },
      region: {
        type: String,
        enum: [
          'top-left', 'top-center', 'top-right',
          'middle-left', 'center', 'middle-right',
          'bottom-left', 'bottom-center', 'bottom-right',
          'full-screen',
        ],
      },
    },
  },
  { _id: false },
);

const FindingSchema = new Schema<IFinding>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true, index: true },
    iteration: { type: Number, required: true, min: 1 },
    findingGroup: { type: String, enum: ['ux', 'accessibility'], required: true },
    type: { type: String },
    status: { type: String, enum: ['PASS', 'FAIL', 'NOT_EVALUABLE'], default: 'FAIL', required: true },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'info'], required: true },
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'high', required: true },
    heuristicCode: { type: String },
    heuristicName: { type: String },
    heuristic: { type: String }, // Legacy field preserved for retrocompatibility
    wcagCriterion: { type: String },
    description: { type: String, required: true },
    evidence: [TechnicalEvidenceItemSchema],
    affectedElement: AffectedElementSchema,
    impact: { type: String },
    recommendation: { type: String, default: null },
    screenshotUrl: { type: String },
    discrepancy: {
      type: new Schema(
        {
          origin: { type: String, enum: ['deterministic', 'ai'], required: true },
          status: { type: String, enum: ['PASS', 'FAIL', 'NOT_EVALUABLE'], required: true },
          severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'info'], required: true },
          confidence: { type: String, enum: ['high', 'medium', 'low'], required: true },
          description: { type: String, required: true },
          recommendation: { type: String, default: null },
          evidence: [TechnicalEvidenceItemSchema],
        },
        { _id: false },
      ),
      required: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

FindingSchema.index({ evaluationId: 1, findingGroup: 1 });
FindingSchema.index({ evaluationId: 1, status: 1 });

export const Finding = model<IFinding>('Finding', FindingSchema);
