import { EVIDENCE_FIELD_WHITELIST } from '../services/evidence-field-whitelist';
import {
  deduplicateLandmarks,
  deduplicateLinks,
  deduplicateButtons,
  deduplicateComputedStyles,
} from '../services/evidence-deduplication.service';
import { sanitizeEvidenceForGemini } from '@/modules/ai/ai.service';

/**
 * J6 (Hardening Post-Fase H) — "single source of truth, verified by test"
 * for EVIDENCE_FIELD_WHITELIST (see that file's docstring for why it is a
 * standalone constant instead of driving `sanitizeEvidenceForGemini`/
 * `toPlainX` at runtime). This test feeds each REAL production function an
 * over-complete input (extra bogus fields included) and asserts the
 * function's OWN output key set matches the whitelist EXACTLY for the kinds
 * that can be checked mechanically. If either side ever drifts, this test
 * fails loudly instead of silently diverging.
 *
 * Gemini calls: 0.
 */

function keysOf(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

function runWhitelistSyncTests() {
  console.log('🧪 Starting evidence-field-whitelist sync tests...\n');

  // heading / image / form / formElement / computedStyle (per-iteration) --
  // via the REAL sanitizeEvidenceForGemini, with bogus extra fields to prove
  // they get dropped (not just that the real fields survive).
  const sanitized = sanitizeEvidenceForGemini([
    {
      iteration: 1,
      url: 'x',
      screenshotPath: 'x',
      headings: [{ level: 1, text: 'x', selector: 'h1', bogus: 'drop-me' } as any],
      images: [{ selector: 'img', alt: 'x', ariaLabel: null, role: null, isDecorative: false, src: 'https://x.com/a.png', bogus: 'drop-me' } as any],
      forms: [{
        selector: 'form', name: null, action: null, bogus: 'drop-me',
        elements: [{ selector: '[name="x"]', type: 'text', name: 'x', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: false, placeholder: null, ariaInvalid: false, bogus: 'drop-me' } as any],
      } as any],
      computedStyles: [{ selector: '.x', tag: 'div', text: 'x', color: 'x', backgroundColor: 'x', fontSize: 'x', fontWeight: 'x', lineHeight: 'x', fontFamily: 'x', bogus: 'drop-me' } as any],
    },
  ]);

  const headingKeys = keysOf(sanitized[0].headings[0] as any);
  if (JSON.stringify(headingKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.heading].sort())) {
    console.error('❌ heading whitelist drift:', headingKeys, 'vs', EVIDENCE_FIELD_WHITELIST.heading);
    process.exit(1);
  }
  console.log('✅ heading: EVIDENCE_FIELD_WHITELIST matches sanitizeEvidenceForGemini exactly.');

  const imageKeys = keysOf(sanitized[0].images[0] as any);
  if (JSON.stringify(imageKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.image].sort())) {
    console.error('❌ image whitelist drift:', imageKeys, 'vs', EVIDENCE_FIELD_WHITELIST.image);
    process.exit(1);
  }
  console.log('✅ image: EVIDENCE_FIELD_WHITELIST matches sanitizeEvidenceForGemini exactly (srcType derived field included).');

  const formKeys = keysOf((({ elements, ...rest }: any) => rest)(sanitized[0].forms[0] as any));
  if (JSON.stringify(formKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.form].sort())) {
    console.error('❌ form whitelist drift:', formKeys, 'vs', EVIDENCE_FIELD_WHITELIST.form);
    process.exit(1);
  }
  console.log('✅ form: EVIDENCE_FIELD_WHITELIST matches sanitizeEvidenceForGemini exactly.');

  const formElementKeys = keysOf(sanitized[0].forms[0].elements[0] as any);
  if (JSON.stringify(formElementKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.formElement].sort())) {
    console.error('❌ formElement whitelist drift:', formElementKeys, 'vs', EVIDENCE_FIELD_WHITELIST.formElement);
    process.exit(1);
  }
  console.log('✅ formElement: EVIDENCE_FIELD_WHITELIST matches sanitizeEvidenceForGemini exactly.');

  const computedStyleKeysPerIteration = keysOf(sanitized[0].computedStyles[0] as any);
  if (JSON.stringify(computedStyleKeysPerIteration) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.computedStyle].sort())) {
    console.error('❌ computedStyle (per-iteration) whitelist drift:', computedStyleKeysPerIteration, 'vs', EVIDENCE_FIELD_WHITELIST.computedStyle);
    process.exit(1);
  }
  console.log('✅ computedStyle (per-iteration): EVIDENCE_FIELD_WHITELIST matches sanitizeEvidenceForGemini exactly.');

  // landmark / link / button / computedStyle (deduped) -- via the REAL
  // deduplicateX functions (which call toPlainX internally).
  const dedupedLandmarks = deduplicateLandmarks([{ iteration: 1, items: [{ type: 'form', selector: 'form', ariaLabel: null, bogus: 'drop-me' } as any] }]);
  const landmarkKeys = keysOf((({ iterations, ...rest }: any) => rest)(dedupedLandmarks[0]));
  if (JSON.stringify(landmarkKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.landmark].sort())) {
    console.error('❌ landmark whitelist drift:', landmarkKeys, 'vs', EVIDENCE_FIELD_WHITELIST.landmark);
    process.exit(1);
  }
  console.log('✅ landmark: EVIDENCE_FIELD_WHITELIST matches deduplicateLandmarks/toPlainLandmark exactly.');

  const dedupedLinks = deduplicateLinks([{ iteration: 1, items: [{ selector: 'a', text: 'x', href: '/x', ariaLabel: null, role: null, isExternal: false, bogus: 'drop-me' } as any] }]);
  const linkKeys = keysOf((({ iterations, ...rest }: any) => rest)(dedupedLinks[0]));
  if (JSON.stringify(linkKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.link].sort())) {
    console.error('❌ link whitelist drift:', linkKeys, 'vs', EVIDENCE_FIELD_WHITELIST.link);
    process.exit(1);
  }
  console.log('✅ link: EVIDENCE_FIELD_WHITELIST matches deduplicateLinks/toPlainLink exactly.');

  const dedupedButtons = deduplicateButtons([{ iteration: 1, items: [{ selector: 'button', tag: 'button', text: 'x', ariaLabel: null, role: null, isDisabled: false, isPrimary: false, bogus: 'drop-me' } as any] }]);
  const buttonKeys = keysOf((({ iterations, ...rest }: any) => rest)(dedupedButtons[0]));
  if (JSON.stringify(buttonKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.button].sort())) {
    console.error('❌ button whitelist drift:', buttonKeys, 'vs', EVIDENCE_FIELD_WHITELIST.button);
    process.exit(1);
  }
  console.log('✅ button: EVIDENCE_FIELD_WHITELIST matches deduplicateButtons/toPlainButton exactly.');

  const dedupedComputedStyles = deduplicateComputedStyles([{ iteration: 1, items: [{ selector: '.x', tag: 'div', text: 'x', color: 'x', backgroundColor: 'x', fontSize: 'x', fontWeight: 'x', lineHeight: 'x', fontFamily: 'x', bogus: 'drop-me' } as any] }]);
  const dedupedComputedStyleKeys = keysOf((({ iterations, ...rest }: any) => rest)(dedupedComputedStyles[0]));
  if (JSON.stringify(dedupedComputedStyleKeys) !== JSON.stringify([...EVIDENCE_FIELD_WHITELIST.computedStyle].sort())) {
    console.error('❌ computedStyle (deduped) whitelist drift:', dedupedComputedStyleKeys, 'vs', EVIDENCE_FIELD_WHITELIST.computedStyle);
    process.exit(1);
  }
  console.log('✅ computedStyle (deduped): EVIDENCE_FIELD_WHITELIST matches deduplicateComputedStyles/toPlainComputedStyle exactly.');

  console.log('\n🎉 ALL evidence-field-whitelist sync tests passed: EVIDENCE_FIELD_WHITELIST matches production exactly for all 8 kinds.');
  process.exit(0);
}

runWhitelistSyncTests();
