import { Schema, model, Document, Types } from 'mongoose';

export interface HeadingEvidence {
  level: number;
  text: string;
  selector: string;
}

export interface ImageEvidence {
  selector: string;
  src: string;
  alt: string | null;
  ariaLabel: string | null;
  role: string | null;
  isDecorative: boolean;
}

export interface LinkEvidence {
  selector: string;
  text: string;
  href: string;
  ariaLabel: string | null;
  role: string | null;
  isExternal: boolean;
}

export interface ButtonEvidence {
  selector: string;
  tag: string;
  text: string | null;
  ariaLabel: string | null;
  role: string | null;
  isDisabled: boolean;
  isPrimary: boolean;
}

export interface FormElementEvidence {
  selector: string;
  type: string;
  name: string | null;
  label: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  ariaDescribedBy: string | null;
  required: boolean;
  placeholder: string | null;
  ariaInvalid: boolean;
}

export interface FormEvidence {
  selector: string;
  name: string | null;
  action: string | null;
  elements: FormElementEvidence[];
}

export interface LandmarkEvidence {
  type: string;
  selector: string;
  ariaLabel: string | null;
}

export interface ComputedStyleEvidence {
  selector: string;
  tag: string;
  text: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  fontFamily: string;
}

export interface ISnapshotEvidence extends Document {
  evaluationId: Types.ObjectId;
  iteration: number;
  url: string;
  timestamp: Date;
  action?: {
    actionType: string;
    description: string;
    targetElement?: string;
  };
  screenshotPath: string;
  headings: HeadingEvidence[];
  images: ImageEvidence[];
  links: LinkEvidence[];
  buttons: ButtonEvidence[];
  forms: FormEvidence[];
  landmarks: LandmarkEvidence[];
  accessibilityTree?: string;
  computedStyles: ComputedStyleEvidence[];
  createdAt: Date;
  updatedAt: Date;
}

const SnapshotEvidenceSchema = new Schema<ISnapshotEvidence>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true, index: true },
    iteration: { type: Number, required: true, min: 1 },
    url: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    action: {
      actionType: { type: String },
      description: { type: String },
      targetElement: { type: String },
    },
    screenshotPath: { type: String, required: true },
    headings: [
      {
        level: { type: Number, required: true },
        text: { type: String, default: '' },
        selector: { type: String, required: true },
      },
    ],
    images: [
      {
        selector: { type: String, required: true },
        src: { type: String, default: '' },
        alt: { type: String, default: null },
        ariaLabel: { type: String, default: null },
        role: { type: String, default: null },
        isDecorative: { type: Boolean, default: false },
      },
    ],
    links: [
      {
        selector: { type: String, required: true },
        text: { type: String, default: '' },
        href: { type: String, default: '' },
        ariaLabel: { type: String, default: null },
        role: { type: String, default: null },
        isExternal: { type: Boolean, default: false },
      },
    ],
    buttons: [
      {
        selector: { type: String, required: true },
        tag: { type: String, required: true },
        text: { type: String, default: null },
        ariaLabel: { type: String, default: null },
        role: { type: String, default: null },
        isDisabled: { type: Boolean, default: false },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    forms: [
      {
        selector: { type: String, required: true },
        name: { type: String, default: null },
        action: { type: String, default: null },
        elements: [
          {
            selector: { type: String, required: true },
            type: { type: String, required: true },
            name: { type: String, default: null },
            label: { type: String, default: null },
            ariaLabel: { type: String, default: null },
            ariaLabelledBy: { type: String, default: null },
            ariaDescribedBy: { type: String, default: null },
            required: { type: Boolean, default: false },
            placeholder: { type: String, default: null },
            ariaInvalid: { type: Boolean, default: false },
          },
        ],
      },
    ],
    landmarks: [
      {
        type: { type: String, required: true },
        selector: { type: String, required: true },
        ariaLabel: { type: String, default: null },
      },
    ],
    accessibilityTree: { type: String, default: undefined },
    computedStyles: [
      {
        selector: { type: String, required: true },
        tag: { type: String, required: true },
        text: { type: String, default: '' },
        color: { type: String, default: '' },
        backgroundColor: { type: String, default: '' },
        fontSize: { type: String, default: '' },
        fontWeight: { type: String, default: '' },
        lineHeight: { type: String, default: '' },
        fontFamily: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

SnapshotEvidenceSchema.index({ evaluationId: 1, iteration: 1 });

export const SnapshotEvidenceModel = model<ISnapshotEvidence>(
  'SnapshotEvidence',
  SnapshotEvidenceSchema,
);
