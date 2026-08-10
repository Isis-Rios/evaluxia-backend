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
  | 'HEADING_STRUCTURE';

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
