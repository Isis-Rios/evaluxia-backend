import { EvidenceKind } from './evidence-traceability.service';

/**
 * J6 (Hardening Post-Fase H) — single conceptual source of truth for "which
 * properties can Gemini legitimately cite for a given evidence kind".
 *
 * DELIBERATE DESIGN CHOICE: this is a STANDALONE constant, not something
 * imported at runtime by `sanitizeEvidenceForGemini` (ai.service.ts) or by
 * `toPlainLandmark/toPlainLink/toPlainButton/toPlainComputedStyle`
 * (evidence-deduplication.service.ts). Those two places already build the
 * exact field-by-field projection that is actually sent to Gemini, with
 * null-coalescing/boolean-coercion logic (`?? null`, `!!x`) baked in —
 * routing them through a generic `pick(obj, keys)` helper driven by this
 * list would risk silently changing what those transforms output (e.g.
 * dropping the `?? null` normalization), which is exactly the real Gemini
 * payload this hardening round must not touch.
 *
 * Instead, this list is kept in sync with those two places by construction
 * (transcribed field-by-field from their current code) and, going forward,
 * by `evidence-field-whitelist.test.ts`, which fails loudly the moment any
 * of the four kinds it can mechanically check (form/formElement/heading/
 * computedStyle) drifts from this list — the single source of truth is
 * enforced by test, not by shared runtime code, precisely to avoid
 * destabilizing the prompt-building path.
 *
 * `image` is a special case: `sanitizeEvidenceForGemini` replaces the real
 * `src` field with a DERIVED `srcType` (see `classifySrcType` in
 * ai.service.ts) — the whitelist below reflects what Gemini actually SEES
 * (`srcType`), not the raw stored field (`src`). J6 (evidence-claim-
 * consistency.service.ts) special-cases `image.srcType` by recomputing it
 * from the indexed record's `src` via the SAME `classifySrcType` function,
 * rather than looking for a literal `srcType` field on the raw record.
 */
export const EVIDENCE_FIELD_WHITELIST: Record<EvidenceKind, readonly string[]> = {
  heading: ['level', 'text', 'selector'],
  image: ['selector', 'alt', 'ariaLabel', 'role', 'isDecorative', 'srcType'],
  form: ['selector', 'name', 'action'],
  formElement: ['selector', 'type', 'name', 'label', 'ariaLabel', 'ariaLabelledBy', 'ariaDescribedBy', 'required', 'placeholder', 'ariaInvalid'],
  landmark: ['type', 'selector', 'ariaLabel'],
  link: ['selector', 'text', 'href', 'ariaLabel', 'role', 'isExternal'],
  button: ['selector', 'tag', 'text', 'ariaLabel', 'role', 'isDisabled', 'isPrimary'],
  computedStyle: ['selector', 'tag', 'text', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'fontFamily'],
};
