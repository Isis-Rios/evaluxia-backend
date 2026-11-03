import {
  LandmarkEvidence,
  LinkEvidence,
  ButtonEvidence,
  HeadingEvidence,
  ImageEvidence,
  FormEvidence,
  ComputedStyleEvidence,
} from '@/modules/snapshots/snapshot-evidence.model';

/**
 * evidence-deduplication.service — Phase C.2.1.
 *
 * Structural elements that tend to stay identical across iterations of the
 * same session (nav/header/footer landmarks, links, buttons) are the
 * dominant contributor to Phase 2's prompt size (see C.2.0 audit). This
 * module groups EXACTLY-identical occurrences of `landmarks`/`links`/
 * `buttons` across iterations into one entry with an `iterations: number[]`
 * list, instead of repeating the same object once per iteration.
 *
 * Grouping rule: every field of the element's own interface participates in
 * the equality check (never a subset, never a heuristic like selector name
 * or "looks like nav"). If ANY field differs between two occurrences, they
 * are two distinct entries — never merged. Grouping is global across the
 * whole session (not just consecutive iterations): if an element is
 * byte-identical in iterations 1, 2 and 5 but different in 3-4, it produces
 * ONE group with `iterations: [1, 2, 5]`, since that is still a truthful,
 * lossless statement about when that exact representation was observed.
 *
 * `headings`, `images`, `forms`, ARIA trees and `accessibilityTree` are NOT
 * touched by this module — deliberately out of scope for C.2.1 (see the
 * C.2.0 audit for why).
 *
 * `computedStyles` — Hardening Post-Fase H, J4 Step 1 — now follows the
 * SAME pattern as landmarks/links/buttons (`deduplicateComputedStyles`,
 * exposed as `dedupedComputedStyles`). IMPORTANT: this is an ADDITIVE
 * capture-and-deduplicate step only. `evidencesSummary[].computedStyles`
 * (the per-iteration, non-deduplicated view) is deliberately LEFT
 * UNCHANGED — nothing in production reads `dedupedComputedStyles` yet.
 * Wiring it into the real Gemini prompt (which would require touching
 * `buildV2AuditPrompt`'s template and `evidence-traceability.service.ts`'s
 * index, both explicitly out of scope for J4 Step 1) is deferred to a
 * later step. J4 Step 1's own tests measure the payload impact using this
 * new field directly, independent of the live prompt template.
 */

export interface IterationBucket<T> {
  iteration: number;
  items: T[];
}

export type Deduplicated<T> = T & { iterations: number[] };

/**
 * `toPlainEvidence` rebuilds the output as a brand-new plain object by
 * reading each functional field explicitly by name (mirroring `keyOf`'s own
 * field list) — deliberately NOT `{...item}`.
 *
 * When `item` is a real Mongoose subdocument (as it is in production —
 * `SnapshotEvidenceModel.find()` without `.lean()`), its schema-defined
 * fields (`selector`, `text`, `href`, ...) are prototype getters, not own
 * enumerable properties; `{...item}` copies only Mongoose's own bookkeeping
 * properties instead (`$__parent`, `__parentArray`, `$__`, `_doc`,
 * `$isNew`) — and `$__parent`/`__parentArray` are live references to the
 * parent document/array, which `JSON.stringify` later serializes in full.
 * Verified real: this was inflating a single evaluation's Phase 2 prompt
 * from ~90 KB to ~5.4 MB (2026-09-10 incident), triggering 429
 * RESOURCE_EXHAUSTED. Explicit field reads (`item.selector`, etc.) resolve
 * correctly through Mongoose's getters, so this fix works identically for
 * real subdocuments and for plain test fixtures.
 */
function groupIdenticalEvidence<T>(
  buckets: Array<IterationBucket<T>>,
  keyOf: (item: T) => string,
  toPlainEvidence: (item: T) => T,
): Array<Deduplicated<T>> {
  const groups = new Map<string, { item: T; iterations: Set<number> }>();

  for (const { iteration, items } of buckets) {
    for (const item of items) {
      const key = keyOf(item);
      const existing = groups.get(key);
      if (existing) {
        existing.iterations.add(iteration);
      } else {
        groups.set(key, { item, iterations: new Set([iteration]) });
      }
    }
  }

  return Array.from(groups.values()).map(({ item, iterations }) => ({
    ...toPlainEvidence(item),
    iterations: Array.from(iterations).sort((a, b) => a - b),
  }));
}

// Canonical identity key per evidence type — lists EVERY field of the
// corresponding interface (snapshot-evidence.model.ts) in a fixed order, so
// the key never depends on incidental object-property insertion order.

function landmarkKey(lm: LandmarkEvidence): string {
  return JSON.stringify([lm.type, lm.selector, lm.ariaLabel]);
}

function linkKey(l: LinkEvidence): string {
  return JSON.stringify([l.selector, l.text, l.href, l.ariaLabel, l.role, l.isExternal]);
}

function buttonKey(b: ButtonEvidence): string {
  return JSON.stringify([b.selector, b.tag, b.text, b.ariaLabel, b.role, b.isDisabled, b.isPrimary]);
}

// J4 Step 1: every field of ComputedStyleEvidence participates in the key
// (selector included) — same "no subset, no heuristic" rule as the other
// three. A single differing field (e.g. `color` changing between
// iterations, or a different `selector` with identical styles) always
// produces two distinct entries, never merged.
function computedStyleKey(cs: ComputedStyleEvidence): string {
  return JSON.stringify([
    cs.selector, cs.tag, cs.text, cs.color, cs.backgroundColor,
    cs.fontSize, cs.fontWeight, cs.lineHeight, cs.fontFamily,
  ]);
}

// Explicit field whitelists — same fields as each *Key function above, plus
// `_id` deliberately excluded (never read by keyOf, buildV2AuditPrompt, or
// any other consumer — see grep audit, 2026-09-10). This is what actually
// strips Mongoose bookkeeping (see groupIdenticalEvidence's doc comment).
function toPlainLandmark(lm: LandmarkEvidence): LandmarkEvidence {
  return { type: lm.type, selector: lm.selector, ariaLabel: lm.ariaLabel ?? null };
}

function toPlainLink(l: LinkEvidence): LinkEvidence {
  return {
    selector: l.selector,
    text: l.text,
    href: l.href,
    ariaLabel: l.ariaLabel ?? null,
    role: l.role ?? null,
    isExternal: !!l.isExternal,
  };
}

function toPlainButton(b: ButtonEvidence): ButtonEvidence {
  return {
    selector: b.selector,
    tag: b.tag,
    text: b.text ?? null,
    ariaLabel: b.ariaLabel ?? null,
    role: b.role ?? null,
    isDisabled: !!b.isDisabled,
    isPrimary: !!b.isPrimary,
  };
}

function toPlainComputedStyle(cs: ComputedStyleEvidence): ComputedStyleEvidence {
  return {
    selector: cs.selector,
    tag: cs.tag,
    text: cs.text,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    fontFamily: cs.fontFamily,
  };
}

export function deduplicateLandmarks(
  buckets: Array<IterationBucket<LandmarkEvidence>>,
): Array<Deduplicated<LandmarkEvidence>> {
  return groupIdenticalEvidence(buckets, landmarkKey, toPlainLandmark);
}

export function deduplicateLinks(
  buckets: Array<IterationBucket<LinkEvidence>>,
): Array<Deduplicated<LinkEvidence>> {
  return groupIdenticalEvidence(buckets, linkKey, toPlainLink);
}

export function deduplicateButtons(
  buckets: Array<IterationBucket<ButtonEvidence>>,
): Array<Deduplicated<ButtonEvidence>> {
  return groupIdenticalEvidence(buckets, buttonKey, toPlainButton);
}

/**
 * J4 Step 1 (Hardening Post-Fase H). Same exact/global grouping as
 * deduplicateLandmarks/Links/Buttons — never a heuristic, never a subset
 * of fields. Independent key-space from every other evidence type (its
 * own Map instance per call), so a computedStyle and a button sharing the
 * same selector string never interact with each other's grouping.
 */
export function deduplicateComputedStyles(
  buckets: Array<IterationBucket<ComputedStyleEvidence>>,
): Array<Deduplicated<ComputedStyleEvidence>> {
  return groupIdenticalEvidence(buckets, computedStyleKey, toPlainComputedStyle);
}

/**
 * Minimal per-iteration evidence shape this module needs — a structural
 * subset of ISnapshotEvidence (no Mongoose Document coupling), so this stays
 * independently testable without touching SnapshotEvidence itself.
 */
export interface EvidenceInput {
  iteration: number;
  url: string;
  screenshotPath: string;
  headings: HeadingEvidence[];
  images: ImageEvidence[];
  links: LinkEvidence[];
  buttons: ButtonEvidence[];
  forms: FormEvidence[];
  landmarks: LandmarkEvidence[];
  computedStyles: ComputedStyleEvidence[];
  /**
   * J4 Step 2a (Hardening Post-Fase H) — OPTIONAL, larger bounded candidate
   * pool (up to 500, see automation.service.ts). When present, this is what
   * `dedupedComputedStyles` below is computed from, instead of the small
   * `computedStyles` field (which stays reserved for
   * DeterministicAnalyzer / backward compatibility with every existing
   * caller that never sets this new field).
   */
  computedStylesCandidates?: ComputedStyleEvidence[];
}

export interface DeduplicatedEvidenceContext {
  /**
   * Same per-iteration shape AuditEngine already produced, minus
   * links/buttons/landmarks (now carried separately, deduplicated, below).
   * headings/images/forms/computedStyles are passed through untouched.
   */
  evidencesSummary: Array<{
    iteration: number;
    url: string;
    screenshotPath: string;
    headings: HeadingEvidence[];
    images: ImageEvidence[];
    forms: FormEvidence[];
    computedStyles: ComputedStyleEvidence[];
  }>;
  dedupedLandmarks: Array<Deduplicated<LandmarkEvidence>>;
  dedupedLinks: Array<Deduplicated<LinkEvidence>>;
  dedupedButtons: Array<Deduplicated<ButtonEvidence>>;
  /**
   * `evidencesSummary[].computedStyles` arriba permanece intacto (raw, por
   * iteración, capado a 50 -- el mismo campo que DeterministicAnalyzer
   * usa). Este campo es una VISTA ADICIONAL, deduplicada, calculada desde
   * `computedStylesCandidates` cuando está presente (J4 Step 2a) o desde
   * `computedStyles` como fallback (J4 Step 1, compatibilidad hacia atrás).
   */
  dedupedComputedStyles: Array<Deduplicated<ComputedStyleEvidence>>;
}

/**
 * Single entry point AuditEngine calls when assembling the Phase 2 context.
 * Pure function: same input always produces the same output, no I/O.
 */
export function buildDeduplicatedEvidenceContext(
  evidences: EvidenceInput[],
): DeduplicatedEvidenceContext {
  return {
    evidencesSummary: evidences.map((ev) => ({
      iteration: ev.iteration,
      url: ev.url,
      screenshotPath: ev.screenshotPath,
      headings: ev.headings,
      images: ev.images,
      forms: ev.forms,
      computedStyles: ev.computedStyles,
    })),
    dedupedLandmarks: deduplicateLandmarks(
      evidences.map((ev) => ({ iteration: ev.iteration, items: ev.landmarks || [] })),
    ),
    dedupedLinks: deduplicateLinks(
      evidences.map((ev) => ({ iteration: ev.iteration, items: ev.links || [] })),
    ),
    dedupedButtons: deduplicateButtons(
      evidences.map((ev) => ({ iteration: ev.iteration, items: ev.buttons || [] })),
    ),
    dedupedComputedStyles: deduplicateComputedStyles(
      evidences.map((ev) => ({ iteration: ev.iteration, items: ev.computedStylesCandidates ?? ev.computedStyles ?? [] })),
    ),
  };
}
