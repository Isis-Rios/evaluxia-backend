import {
  auditMetricsService,
  InputAuditFinding,
} from '../services/audit-metrics.service';

/**
 * Regression test for the combined-WCAG-criterion inconsistency found during
 * H-REGRESSION-1 (real Gemini execution, forms/login-missing-label.html).
 *
 * Gemini returned this REAL, VERBATIM value for `wcagCriterion` on the
 * "input sin label" finding for [name="email"]:
 *
 *   "WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y
 *    valor, WCAG 1.3.1 Información y relaciones"
 *
 * Local analysis (no Gemini involved) showed that two different parts of
 * AuditMetricsService disagree on which canonical WCAG code this string
 * represents:
 *   - `normalizeCriterionKey` (used by `deduplicateFindings` to build the
 *     dedup/problem-identity key) extracts the FIRST code that appears
 *     TEXTUALLY in the string          -> "WCAG 3.3.2"
 *   - the `wcagStatusMap` loop inside `calculateMetrics` uses
 *     `SUPPORTED_WCAG_CRITERIA.find(c => str.includes(c))`, which returns
 *     the first code matching the ARRAY's OWN fixed declaration order
 *     (1.1.1, 1.3.1, 1.4.1, 1.4.3, ...)                -> "WCAG 1.3.1"
 *
 * ---------------------------------------------------------------------
 * UPDATE (J6-metrics-fix, Hardening Post-Fase H): `calculateMetrics`'s
 * `wcagStatusMap` loop was changed to call `this.normalizeCriterionKey(...)`
 * instead of `SUPPORTED_WCAG_CRITERIA.find(...)` -- see audit-metrics.
 * service.ts. This test's ORIGINAL Test 3 and Test 4 explicitly documented
 * the BUG (the two-algorithm divergence): Test 3 asserted that adding an
 * independent pure "WCAG 3.3.2" finding INCREASED evaluatedCount (proof
 * 3.3.2 wasn't attributed by the combined finding), and Test 4 asserted the
 * OPPOSITE for "WCAG 1.3.1" (proof it WAS wrongly attributed there instead).
 *
 * Now that both `deduplicateFindings` and `calculateMetrics` use the SAME
 * `normalizeCriterionKey`, the combined finding is consistently attributed
 * to "WCAG 3.3.2" everywhere -- so Test 3 and Test 4's expected outcomes
 * SWAP (documented explicitly below, not silently flipped): adding an
 * independent "WCAG 3.3.2" finding no longer increases evaluatedCount
 * (3.3.2 is already accounted for), while adding an independent "WCAG
 * 1.3.1" finding now DOES increase it (1.3.1 was never really touched by
 * the combined finding once the fix is applied).
 * ---------------------------------------------------------------------
 *
 * This test does NOT reimplement either algorithm and does NOT modify
 * production code from within the test itself. It exercises the REAL
 * `auditMetricsService` (both `deduplicateFindings` and `calculateMetrics`)
 * with the exact real string, and freezes the CURRENT (post-fix) observed
 * behavior as an automated regression.
 *
 * Gemini calls: 0. Ground Truth changes: 0.
 */

const COMBINED_CRITERION =
  'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones';

function runCombinedWcagCriterionTests() {
  console.log('🧪 Starting H-REGRESSION-1 combined WCAG criterion regression tests...\n');

  // ==========================================================================
  // Test 1 (proves normalizeCriterionKey(COMBINED_CRITERION) === "WCAG 3.3.2")
  //
  // Uses ONLY the public `deduplicateFindings` API (never reimplements the
  // private `normalizeCriterionKey`). If a finding carrying the combined
  // string and a finding carrying the PURE "WCAG 3.3.2" criterion share the
  // same selector, they collapse into exactly 1 consolidated finding IF AND
  // ONLY IF normalizeCriterionKey resolves the combined string to
  // "WCAG 3.3.2". A resolution to any other code (e.g. "WCAG 1.3.1" or
  // "WCAG 4.1.2") would instead produce 2 separate consolidated findings.
  // ==========================================================================
  const combinedFindingEmail: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: COMBINED_CRITERION,
    description: 'REAL H-REGRESSION-1 finding: email input sin label (criterio combinado).',
    evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' } as any],
    affectedElement: { tag: 'input', selector: '[name="email"]' },
    iteration: 1,
  };
  const purePasFor332SameSelector: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: 'WCAG 3.3.2',
    description: 'Control probe: pure WCAG 3.3.2 on the SAME selector.',
    affectedElement: { tag: 'input', selector: '[name="email"]' },
    iteration: 1,
  };
  const dedupResult1 = auditMetricsService.deduplicateFindings([
    combinedFindingEmail,
    purePasFor332SameSelector,
  ]);
  if (dedupResult1.length !== 1) {
    console.error(
      `❌ Test 1 Failed: expected normalizeCriterionKey(COMBINED_CRITERION) to collapse with pure "WCAG 3.3.2" ` +
        `into 1 consolidated finding (same selector), got ${dedupResult1.length}.`,
    );
    process.exit(1);
  }
  console.log('✅ Test 1: normalizeCriterionKey(COMBINED_CRITERION) resolves to "WCAG 3.3.2" (dedup collision confirmed).');

  // Negative control: the SAME combined finding must NOT collapse with a pure
  // "WCAG 1.3.1" probe on the same selector -- if it did, that would mean
  // normalizeCriterionKey actually resolves to "WCAG 1.3.1", contradicting
  // Test 1 and the real diagnostic. This guards against a false positive in
  // Test 1 (e.g. both accidentally falling into the "unknown" bucket).
  const purePassFor131SameSelector: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: 'WCAG 1.3.1',
    description: 'Control probe: pure WCAG 1.3.1 on the SAME selector.',
    affectedElement: { tag: 'input', selector: '[name="email"]' },
    iteration: 1,
  };
  const dedupResult1b = auditMetricsService.deduplicateFindings([
    combinedFindingEmail,
    purePassFor131SameSelector,
  ]);
  if (dedupResult1b.length !== 2) {
    console.error(
      `❌ Test 1b Failed: expected combined finding to NOT collapse with pure "WCAG 1.3.1" via normalizeCriterionKey ` +
        `(dedup key), got ${dedupResult1b.length} consolidated findings (expected 2).`,
    );
    process.exit(1);
  }
  console.log('✅ Test 1b: normalizeCriterionKey(COMBINED_CRITERION) does NOT resolve to "WCAG 1.3.1" (negative control confirmed).');

  // ==========================================================================
  // Test 2 (proves calculateMetrics's wcagStatusMap resolves the SAME string
  // to "WCAG 1.3.1", NOT "WCAG 3.3.2")
  //
  // Uses ONLY the public, real `calculateMetrics` (never reimplemented).
  // Baseline: the combined finding alone must evaluate exactly 1 WCAG
  // criterion (FAIL).
  // ==========================================================================
  const baseline = auditMetricsService.calculateMetrics([combinedFindingEmail]);
  if (baseline.wcagMetrics.evaluatedCount !== 1 || baseline.wcagMetrics.failCount !== 1) {
    console.error('❌ Test 2 (baseline) Failed:', baseline.wcagMetrics);
    process.exit(1);
  }
  console.log('✅ Test 2 (baseline): combined finding alone evaluates exactly 1 WCAG criterion as FAIL.');

  // Test 3 [UPDATED post-J6-metrics-fix]: adding an INDEPENDENT pure
  // "WCAG 3.3.2" finding (different selector) must NOT increase
  // evaluatedCount anymore -- 3.3.2 is already accounted for by the
  // combined finding now that calculateMetrics uses normalizeCriterionKey.
  // BEFORE THE FIX this test asserted evaluatedCount 1->2 (the bug: 3.3.2
  // was wrongly NOT attributed). That assertion is now the wrong one, so it
  // was replaced, not silently left in place.
  const independentPure332: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'PASS',
    severity: 'info',
    confidence: 'high',
    wcagCriterion: 'WCAG 3.3.2',
    description: 'Independent probe on a DIFFERENT selector: pure WCAG 3.3.2 PASS.',
    affectedElement: { tag: 'input', selector: '[name="password"]' },
    iteration: 1,
  };
  const withIndependent332 = auditMetricsService.calculateMetrics([
    combinedFindingEmail,
    independentPure332,
  ]);
  if (
    withIndependent332.wcagMetrics.evaluatedCount !== 1 ||
    withIndependent332.wcagMetrics.failCount !== 1 ||
    withIndependent332.wcagMetrics.passCount !== 0
  ) {
    console.error(
      '❌ Test 3 Failed: expected evaluatedCount to STAY at 1 (failCount=1, passCount=0) after adding an ' +
        'independent pure WCAG 3.3.2 PASS finding -- post-fix, WCAG 3.3.2 is already FAIL from the combined ' +
        'finding, and FAIL is not overridden by a later PASS on the same criterion. Got:',
      withIndependent332.wcagMetrics,
    );
    process.exit(1);
  }
  console.log(
    '✅ Test 3 [UPDATED]: adding an independent pure "WCAG 3.3.2" PASS finding no longer changes evaluatedCount ' +
      '(post-fix: WCAG 3.3.2 IS attributed to the combined finding, consistent with normalizeCriterionKey/dedup).',
  );

  // Test 4 [UPDATED post-J6-metrics-fix] (contrast/control): adding an
  // INDEPENDENT pure "WCAG 1.3.1" finding (different selector) now DOES
  // increase evaluatedCount 1 -> 2, because post-fix the combined finding is
  // no longer attributed to 1.3.1 at all (it now resolves entirely to 3.3.2).
  // BEFORE THE FIX this test asserted evaluatedCount stayed at 1 (the bug:
  // 1.3.1 was wrongly attributed instead of 3.3.2). Replaced, not silently
  // left in place.
  const independentPure131: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'PASS',
    severity: 'info',
    confidence: 'high',
    wcagCriterion: 'WCAG 1.3.1',
    description: 'Independent probe on a DIFFERENT selector: pure WCAG 1.3.1 PASS.',
    affectedElement: { tag: 'input', selector: '[name="password"]' },
    iteration: 1,
  };
  const withIndependent131 = auditMetricsService.calculateMetrics([
    combinedFindingEmail,
    independentPure131,
  ]);
  if (
    withIndependent131.wcagMetrics.evaluatedCount !== 2 ||
    withIndependent131.wcagMetrics.failCount !== 1 ||
    withIndependent131.wcagMetrics.passCount !== 1
  ) {
    console.error(
      '❌ Test 4 Failed: expected evaluatedCount=2 (failCount=1, passCount=1) after adding an independent pure ' +
        'WCAG 1.3.1 PASS finding -- post-fix, WCAG 1.3.1 was never touched by the combined finding. Got:',
      withIndependent131.wcagMetrics,
    );
    process.exit(1);
  }
  console.log(
    '✅ Test 4 [UPDATED]: adding an independent pure "WCAG 1.3.1" PASS finding now increases evaluatedCount 1 -> 2 ' +
      '(post-fix: WCAG 1.3.1 is NOT attributed to the combined finding anymore -- no more divergence).',
  );

  // Test 5 [NEW post-J6-metrics-fix]: single call proving dedup and metrics
  // now AGREE on the exact same combined finding -- the original bug's
  // defining symptom (two algorithms, two different answers) is gone.
  const agreementCheck = auditMetricsService.calculateMetrics([
    combinedFindingEmail,
    { ...independentPure332, affectedElement: { tag: 'input', selector: '[name="confirm-email"]' } },
    { ...independentPure131, affectedElement: { tag: 'input', selector: '[name="confirm-password"]' } },
  ]);
  if (
    agreementCheck.wcagMetrics.evaluatedCount !== 2 ||
    agreementCheck.wcagMetrics.failCount !== 1 ||
    agreementCheck.wcagMetrics.passCount !== 1
  ) {
    console.error('❌ Test 5 Failed: dedup/metrics agreement check produced unexpected counts:', agreementCheck.wcagMetrics);
    process.exit(1);
  }
  console.log(
    '✅ Test 5 [NEW]: dedup (Test 1) and calculateMetrics (Tests 3/4) now agree the combined finding is ' +
      '"WCAG 3.3.2" -- the original divergence is gone.',
  );

  console.log(
    '\n🎉 ALL combined-WCAG-criterion regression tests passed: post-fix behavior frozen ' +
      '(normalizeCriterionKey AND calculateMetrics.wcagStatusMap both -> "WCAG 3.3.2").',
  );
  process.exit(0);
}

runCombinedWcagCriterionTests();
