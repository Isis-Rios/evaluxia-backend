import { SnapshotEvidenceModel } from '@/modules/snapshots/snapshot-evidence.model';

/**
 * Fase 2.3 — Fase C: shared builder for synthetic-but-real Mongoose
 * subdocuments (via `new SnapshotEvidenceModel(...)`, never `.lean()`).
 *
 * Extracted from the pattern already validated in T1
 * (token-budget-mongoose-regression.test.ts) so T2/T3/T5/T6 don't
 * re-implement the same boilerplate. Using REAL Mongoose documents (not
 * plain objects) matters here: it's the only way these tests exercise the
 * exact same subdocument shape `evidence-deduplication.service.ts` sees in
 * production (`SnapshotEvidenceModel.find()`, never `.lean()`).
 */

export interface SyntheticLink {
  selector: string;
  text: string;
  href: string;
  ariaLabel?: string | null;
  role?: string | null;
  isExternal?: boolean;
}

export interface SyntheticButton {
  selector: string;
  tag?: string;
  text?: string | null;
  ariaLabel?: string | null;
  role?: string | null;
  isDisabled?: boolean;
  isPrimary?: boolean;
}

export interface SyntheticLandmark {
  type: string;
  selector: string;
  ariaLabel?: string | null;
}

export interface SyntheticComputedStyle {
  selector: string;
  tag?: string;
  text?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  fontFamily?: string;
}

export interface SyntheticEvidenceSpec {
  iteration: number;
  url?: string;
  links?: SyntheticLink[];
  buttons?: SyntheticButton[];
  landmarks?: SyntheticLandmark[];
  computedStyles?: SyntheticComputedStyle[];
  headings?: Array<{ level: number; text: string; selector: string }>;
  images?: Array<{ selector: string; src: string; alt: string | null; ariaLabel?: string | null; role?: string | null; isDecorative?: boolean }>;
  forms?: unknown[];
}

/** Real Mongoose document — has `$__parent`/`_doc`/etc. on its subdocuments. */
export function buildSyntheticMongooseEvidence(spec: SyntheticEvidenceSpec): any {
  return new SnapshotEvidenceModel({
    evaluationId: '000000000000000000000001',
    iteration: spec.iteration,
    url: spec.url ?? 'https://example.com',
    screenshotPath: `/uploads/step_${spec.iteration}.png`,
    headings: spec.headings ?? [],
    images: spec.images ?? [],
    forms: spec.forms ?? [],
    computedStyles: spec.computedStyles ?? [],
    landmarks: spec.landmarks ?? [],
    links: spec.links ?? [],
    buttons: spec.buttons ?? [],
  });
}

/** Shapes a built Mongoose document into the `EvidenceInput` shape `buildDeduplicatedEvidenceContext` expects. */
export function toEvidenceInput(doc: any) {
  return {
    iteration: doc.iteration,
    url: doc.url,
    screenshotPath: doc.screenshotPath,
    headings: doc.headings,
    images: doc.images,
    links: doc.links,
    buttons: doc.buttons,
    forms: doc.forms,
    landmarks: doc.landmarks,
    computedStyles: doc.computedStyles,
  };
}
