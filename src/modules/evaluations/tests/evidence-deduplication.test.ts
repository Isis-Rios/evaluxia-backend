import {
  deduplicateLinks,
  deduplicateButtons,
  deduplicateLandmarks,
  buildDeduplicatedEvidenceContext,
  EvidenceInput,
} from '../services/evidence-deduplication.service';
import type {
  LinkEvidence,
  ButtonEvidence,
  LandmarkEvidence,
  HeadingEvidence,
  ImageEvidence,
  FormEvidence,
  ComputedStyleEvidence,
} from '@/modules/snapshots/snapshot-evidence.model';
import { aiService } from '@/modules/ai/ai.service';

/**
 * Phase C.2.1 — deduplication of landmarks/links/buttons across iterations.
 * Pure functions, no DB/network/Gemini involved.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    failed++;
  }
}

function baseLink(overrides: Partial<LinkEvidence> = {}): LinkEvidence {
  return {
    selector: 'nav a#home',
    text: 'Inicio',
    href: 'https://example.com/',
    ariaLabel: null,
    role: null,
    isExternal: false,
    ...overrides,
  };
}

function baseButton(overrides: Partial<ButtonEvidence> = {}): ButtonEvidence {
  return {
    selector: 'header button#signup',
    tag: 'button',
    text: 'Registrarse',
    ariaLabel: null,
    role: 'button',
    isDisabled: false,
    isPrimary: true,
    ...overrides,
  };
}

function baseLandmark(overrides: Partial<LandmarkEvidence> = {}): LandmarkEvidence {
  return {
    type: 'navigation',
    selector: 'nav.main-nav',
    ariaLabel: 'Navegación principal',
    ...overrides,
  };
}

function runTests(): void {
  console.log('🧪 Starting Evidence Deduplication tests (Phase C.2.1)...\n');

  // ── Test 1: identical element in iterations 1, 2, 3 → grouped ──
  {
    const link = baseLink();
    const result = deduplicateLinks([
      { iteration: 1, items: [link] },
      { iteration: 2, items: [baseLink()] }, // structurally identical, different object
      { iteration: 3, items: [baseLink()] },
    ]);
    assert(result.length === 1, 'Test 1: identical link across 3 iterations produces exactly 1 group');
    assert(
      JSON.stringify(result[0]?.iterations) === JSON.stringify([1, 2, 3]),
      `Test 1: group.iterations === [1,2,3], got ${JSON.stringify(result[0]?.iterations)}`,
    );
  }

  // ── Test 2: same selector, different text → NOT grouped ──
  {
    const result = deduplicateLinks([
      { iteration: 1, items: [baseLink({ text: 'Inicio' })] },
      { iteration: 2, items: [baseLink({ text: 'Home' })] },
    ]);
    assert(result.length === 2, 'Test 2: same selector but different text produces 2 separate entries (not grouped)');
  }

  // ── Test 3: same selector, different href → NOT grouped ──
  {
    const result = deduplicateLinks([
      { iteration: 1, items: [baseLink({ href: 'https://example.com/' })] },
      { iteration: 2, items: [baseLink({ href: 'https://example.com/v2' })] },
    ]);
    assert(result.length === 2, 'Test 3: same selector but different href produces 2 separate entries (not grouped)');
  }

  // ── Test 4: same selector, different isDisabled → NOT grouped ──
  {
    const result = deduplicateButtons([
      { iteration: 1, items: [baseButton({ isDisabled: false })] },
      { iteration: 2, items: [baseButton({ isDisabled: true })] },
    ]);
    assert(result.length === 2, 'Test 4: same selector but different isDisabled produces 2 separate entries (not grouped)');
    const disabledEntry = result.find((r) => r.isDisabled === true);
    const enabledEntry = result.find((r) => r.isDisabled === false);
    assert(
      JSON.stringify(disabledEntry?.iterations) === JSON.stringify([2]) &&
        JSON.stringify(enabledEntry?.iterations) === JSON.stringify([1]),
      'Test 4: each isDisabled variant carries only its own iteration',
    );
  }

  // ── Test 5: element appears only in iteration 3 → preserved standalone ──
  {
    const result = deduplicateLinks([
      { iteration: 1, items: [] },
      { iteration: 2, items: [] },
      { iteration: 3, items: [baseLink({ selector: 'main a#only-here' })] },
    ]);
    assert(result.length === 1, 'Test 5: element appearing only in iteration 3 is preserved');
    assert(
      JSON.stringify(result[0]?.iterations) === JSON.stringify([3]),
      `Test 5: iterations === [3], got ${JSON.stringify(result[0]?.iterations)}`,
    );
  }

  // ── Test 6: identical in 1-4, changes in 5 → [1,2,3,4] grouped, 5 separate ──
  {
    const result = deduplicateButtons([
      { iteration: 1, items: [baseButton({ text: 'Registrarse' })] },
      { iteration: 2, items: [baseButton({ text: 'Registrarse' })] },
      { iteration: 3, items: [baseButton({ text: 'Registrarse' })] },
      { iteration: 4, items: [baseButton({ text: 'Registrarse' })] },
      { iteration: 5, items: [baseButton({ text: 'Registrarse (3 plazas)' })] },
    ]);
    assert(result.length === 2, 'Test 6: stable version (1-4) and changed version (5) produce exactly 2 groups');
    const stable = result.find((r) => r.text === 'Registrarse');
    const changed = result.find((r) => r.text === 'Registrarse (3 plazas)');
    assert(
      JSON.stringify(stable?.iterations) === JSON.stringify([1, 2, 3, 4]),
      `Test 6: stable group iterations === [1,2,3,4], got ${JSON.stringify(stable?.iterations)}`,
    );
    assert(
      JSON.stringify(changed?.iterations) === JSON.stringify([5]),
      `Test 6: changed group iterations === [5], got ${JSON.stringify(changed?.iterations)}`,
    );
  }

  // ── Test 7: two genuinely different elements (different selectors) never merge ──
  {
    const result = deduplicateLinks([
      { iteration: 1, items: [baseLink({ selector: 'nav a#home', text: 'Inicio' }), baseLink({ selector: 'nav a#pricing', text: 'Precios', href: 'https://example.com/precios' })] },
      { iteration: 2, items: [baseLink({ selector: 'nav a#home', text: 'Inicio' }), baseLink({ selector: 'nav a#pricing', text: 'Precios', href: 'https://example.com/precios' })] },
    ]);
    assert(result.length === 2, 'Test 7: two distinct selectors never merge into one group');
    assert(
      result.every((r) => JSON.stringify(r.iterations) === JSON.stringify([1, 2])),
      'Test 7: both distinct elements independently track their own (identical) iteration list',
    );
  }

  // ── Test 8: iteration information is preserved (explicit field presence + values) ──
  {
    const result = deduplicateLandmarks([
      { iteration: 1, items: [baseLandmark()] },
      { iteration: 4, items: [baseLandmark()] }, // non-consecutive on purpose
    ]);
    assert(result.length === 1, 'Test 8: identical landmark across non-consecutive iterations still groups (global grouping)');
    assert(Array.isArray(result[0]?.iterations), 'Test 8: iterations field exists and is an array');
    assert(
      JSON.stringify(result[0]?.iterations) === JSON.stringify([1, 4]),
      `Test 8: non-consecutive iterations preserved and sorted, got ${JSON.stringify(result[0]?.iterations)}`,
    );
    // All original fields must still be present alongside "iterations".
    assert(
      result[0]?.type === 'navigation' && result[0]?.selector === 'nav.main-nav' && result[0]?.ariaLabel === 'Navegación principal',
      'Test 8: all original landmark fields are preserved alongside iterations',
    );
  }

  // ── Test 9: headings/images/forms/computedStyles are NOT modified ──
  {
    const headings: HeadingEvidence[] = [{ level: 1, text: 'Título', selector: 'h1' }];
    const images: ImageEvidence[] = [{ selector: 'img.hero', src: 'https://example.com/x.png', alt: 'Hero', ariaLabel: null, role: null, isDecorative: false }];
    const forms: FormEvidence[] = [{ selector: 'form#f1', name: 'f1', action: null, elements: [] }];
    const computedStyles: ComputedStyleEvidence[] = [
      { selector: 'h1', tag: 'h1', text: 'Título', color: 'rgb(0,0,0)', backgroundColor: 'rgba(0,0,0,0)', fontSize: '32px', fontWeight: '700', lineHeight: '38px', fontFamily: 'Inter' },
    ];

    const evidences: EvidenceInput[] = [
      {
        iteration: 1,
        url: 'https://example.com/',
        screenshotPath: '/uploads/x_1.png',
        headings,
        images,
        links: [baseLink()],
        buttons: [baseButton()],
        forms,
        landmarks: [baseLandmark()],
        computedStyles,
      },
    ];

    const ctx = buildDeduplicatedEvidenceContext(evidences);
    assert(ctx.evidencesSummary.length === 1, 'Test 9: evidencesSummary has one entry per iteration, unchanged count');
    assert(
      JSON.stringify(ctx.evidencesSummary[0].headings) === JSON.stringify(headings),
      'Test 9: headings pass through byte-identical, untouched',
    );
    assert(
      JSON.stringify(ctx.evidencesSummary[0].images) === JSON.stringify(images),
      'Test 9: images pass through byte-identical, untouched',
    );
    assert(
      JSON.stringify(ctx.evidencesSummary[0].forms) === JSON.stringify(forms),
      'Test 9: forms pass through byte-identical, untouched',
    );
    assert(
      JSON.stringify(ctx.evidencesSummary[0].computedStyles) === JSON.stringify(computedStyles),
      'Test 9: computedStyles pass through byte-identical, untouched',
    );
    assert(
      !('links' in ctx.evidencesSummary[0]) && !('buttons' in ctx.evidencesSummary[0]) && !('landmarks' in ctx.evidencesSummary[0]),
      'Test 9: links/buttons/landmarks are removed from the per-iteration evidencesSummary entries (moved to the deduplicated arrays instead)',
    );
  }

  // ── Test 10: ARIA trees are not touched by this module at all ──
  {
    // This module's public API (buildDeduplicatedEvidenceContext,
    // DeduplicatedEvidenceContext) has no accessibilityTree/ARIA field
    // anywhere — ARIA assembly in audit-engine.service.ts
    // (`evidences.map(e => e.accessibilityTree)`) is a separate line this
    // module is never involved in. Confirmed structurally: the shape below
    // is exhaustive for what this module returns.
    //
    // Updated for J4 Step 1 (Hardening Post-Fase H): `dedupedComputedStyles`
    // added as a new ADDITIVE field (same pattern as dedupedLandmarks/Links/
    // Buttons) — still no ARIA-related field, so the assertion's intent
    // (this module never touches ARIA) still holds; only the expected key
    // list grew to include the new, legitimate field.
    const ctx = buildDeduplicatedEvidenceContext([]);
    const keys = Object.keys(ctx).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(['dedupedButtons', 'dedupedComputedStyles', 'dedupedLandmarks', 'dedupedLinks', 'evidencesSummary'].sort()),
      `Test 10: DeduplicatedEvidenceContext exposes no ARIA-related field — got keys: ${JSON.stringify(keys)}`,
    );
  }

  // ── Test 11: the resulting evidence is still valid input for buildV2AuditPrompt ──
  {
    const evidences: EvidenceInput[] = [
      {
        iteration: 1,
        url: 'https://example.com/',
        screenshotPath: '/uploads/x_1.png',
        headings: [{ level: 1, text: 'Título', selector: 'h1' }],
        images: [],
        links: [baseLink()],
        buttons: [baseButton()],
        forms: [],
        landmarks: [baseLandmark()],
        computedStyles: [],
      },
      {
        iteration: 2,
        url: 'https://example.com/step2',
        screenshotPath: '/uploads/x_2.png',
        headings: [],
        images: [],
        links: [baseLink()],
        buttons: [baseButton({ isDisabled: true })],
        forms: [],
        landmarks: [baseLandmark()],
        computedStyles: [],
      },
    ];
    const ctx = buildDeduplicatedEvidenceContext(evidences);

    const svc = aiService as any;
    let prompt = '';
    try {
      prompt = svc.buildV2AuditPrompt({
        evaluationId: 'test-eval',
        title: 'Test',
        url: 'https://example.com/',
        archetype: { fullName: 'Test User', archetype: 'Tester', profession: 'QA', phrase: 'p', goals: [], frustrations: [] },
        completedSteps: [],
        previousActions: [],
        snapshotsCount: 2,
        evidencesSummary: ctx.evidencesSummary,
        dedupedLandmarks: ctx.dedupedLandmarks,
        dedupedLinks: ctx.dedupedLinks,
        dedupedButtons: ctx.dedupedButtons,
      });
    } catch (err) {
      console.error('❌ Test 11: buildV2AuditPrompt threw with deduplicated evidence input:', err);
      process.exit(1);
    }

    assert(typeof prompt === 'string' && prompt.length > 0, 'Test 11: buildV2AuditPrompt returns a non-empty string with deduplicated evidence');
    assert(prompt.includes('SHARED STRUCTURAL ELEMENTS'), 'Test 11: prompt includes the new deduplicated-elements section');
    assert(prompt.includes('nav.main-nav'), 'Test 11: the deduplicated landmark selector is present in the prompt text');
    assert(prompt.includes('"iterations"'), 'Test 11: the "iterations" field is present in the rendered JSON');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
