import {
  countWcagCodesInCriterion,
  violatesWcagCardinality,
  checkWcagCardinality,
  applyCardinalityEnforcement,
} from '@/shared/testing/wcag-criterion-cardinality';

/**
 * H-REGRESSION-2 preparation — deterministic, Gemini-free validation of the
 * cardinality-check utility itself, BEFORE it is trusted to grade a real
 * Gemini response. Uses the exact real H-REGRESSION-1 combined string as
 * the known-bad case, and single-code strings (as used throughout the
 * existing test suite) as known-good cases.
 */

const REAL_COMBINED_CRITERION_H_REGRESSION_1 =
  'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones';

function runWcagCardinalityTests() {
  console.log('🧪 Starting H-REGRESSION-2 preparation: WCAG cardinality-check utility tests...\n');

  // Test 1: the real H-REGRESSION-1 combined string must be detected as a violation, count=3.
  if (countWcagCodesInCriterion(REAL_COMBINED_CRITERION_H_REGRESSION_1) !== 3) {
    console.error(
      `❌ Test 1 Failed: expected count=3 for the real combined string, got ${countWcagCodesInCriterion(REAL_COMBINED_CRITERION_H_REGRESSION_1)}`,
    );
    process.exit(1);
  }
  if (!violatesWcagCardinality(REAL_COMBINED_CRITERION_H_REGRESSION_1)) {
    console.error('❌ Test 1b Failed: the real combined string must be flagged as a cardinality violation.');
    process.exit(1);
  }
  console.log('✅ Test 1: real H-REGRESSION-1 combined string detected as violation (count=3).');

  // Test 2: a normal single-code string must NOT be flagged.
  const singleCode = 'WCAG 3.3.2 Etiquetas o instrucciones';
  if (countWcagCodesInCriterion(singleCode) !== 1 || violatesWcagCardinality(singleCode)) {
    console.error(`❌ Test 2 Failed: single-code string incorrectly flagged. count=${countWcagCodesInCriterion(singleCode)}`);
    process.exit(1);
  }
  console.log('✅ Test 2: single-code string correctly NOT flagged (count=1).');

  // Test 3: null/undefined/empty must not be flagged (not applicable, not a violation).
  if (violatesWcagCardinality(null) || violatesWcagCardinality(undefined) || violatesWcagCardinality('')) {
    console.error('❌ Test 3 Failed: null/undefined/empty incorrectly flagged as violation.');
    process.exit(1);
  }
  console.log('✅ Test 3: null/undefined/empty correctly NOT flagged.');

  // Test 4: a pure Nielsen finding (no wcagCriterion at all) must not be flagged and must be
  // excluded entirely from checkWcagCardinality's result set (not applicable).
  const mixedFindings = [
    { wcagCriterion: singleCode, affectedElement: { selector: '[name="email"]' } },
    { wcagCriterion: REAL_COMBINED_CRITERION_H_REGRESSION_1, affectedElement: { selector: '[name="password"]' } },
    { heuristicCode: 'N-06', affectedElement: { selector: '[name="email"]' } }, // no wcagCriterion at all
  ];
  const results = checkWcagCardinality(mixedFindings as any);
  if (results.length !== 2) {
    console.error(`❌ Test 4 Failed: expected 2 applicable findings (Nielsen-only excluded), got ${results.length}`);
    process.exit(1);
  }
  if (results[0].violatesCardinality !== false || results[1].violatesCardinality !== true) {
    console.error('❌ Test 4b Failed: per-finding violation flags incorrect.', results);
    process.exit(1);
  }
  console.log('✅ Test 4: batch check correctly isolates the violating finding and excludes Nielsen-only findings.');

  // Test 5 (J6): an unknown/unsupported WCAG code, but SINGLE, must NOT be
  // flagged -- cardinality counts occurrences of the "WCAG X.Y.Z" pattern,
  // it is orthogonal to whether that code is in SUPPORTED_WCAG_CRITERIA.
  const unknownButSingle = 'WCAG 9.9.9 Criterio inexistente';
  if (violatesWcagCardinality(unknownButSingle)) {
    console.error('❌ Test 5 Failed: a single unknown WCAG code must not be flagged as a cardinality violation.');
    process.exit(1);
  }
  console.log('✅ Test 5: single unknown/unsupported WCAG code correctly NOT flagged (cardinality ≠ support).');

  // Test 6 (J6): applyCardinalityEnforcement — backend enforcement.
  // Single-code finding: untouched.
  const singleFinding = { wcagCriterion: singleCode, status: 'FAIL', confidence: 'high', recommendation: 'fix it' };
  const { findings: r6, summary: s6 } = applyCardinalityEnforcement([singleFinding]);
  if (r6[0].status !== 'FAIL' || r6[0].confidence !== 'high' || s6.violations !== 0) {
    console.error('❌ Test 6 Failed: single-code finding must be left untouched.', r6, s6);
    process.exit(1);
  }
  console.log('✅ Test 6: applyCardinalityEnforcement leaves a single-code finding untouched.');

  // Test 7 (J6): combined-code finding: degraded to NOT_EVALUABLE/low/null.
  const combinedFinding = { wcagCriterion: REAL_COMBINED_CRITERION_H_REGRESSION_1, status: 'FAIL', confidence: 'high', recommendation: 'fix it' };
  const { findings: r7, summary: s7 } = applyCardinalityEnforcement([combinedFinding]);
  if (r7[0].status !== 'NOT_EVALUABLE' || r7[0].confidence !== 'low' || r7[0].recommendation !== null || s7.violations !== 1) {
    console.error('❌ Test 7 Failed: combined-code finding must be degraded to NOT_EVALUABLE/low/null.', r7, s7);
    process.exit(1);
  }
  console.log('✅ Test 7: applyCardinalityEnforcement degrades a combined-code finding to NOT_EVALUABLE/confidence=low/recommendation=null.');

  // Test 8 (J6): Nielsen finding (no wcagCriterion) — not applicable, untouched.
  const nielsenFinding = { heuristicCode: 'N-06', status: 'FAIL', confidence: 'high', recommendation: 'fix it' };
  const { findings: r8, summary: s8 } = applyCardinalityEnforcement([nielsenFinding as any]);
  if (r8[0].status !== 'FAIL' || s8.violations !== 0) {
    console.error('❌ Test 8 Failed: Nielsen-only finding (no wcagCriterion) must never be flagged.', r8, s8);
    process.exit(1);
  }
  console.log('✅ Test 8: Nielsen-only finding (no wcagCriterion) correctly not applicable, untouched.');

  // Test 9 (P0-1): Single WCAG code without "WCAG " prefix must count as 1 and NOT violate cardinality.
  const singlePrefixless = '1.4.3 Contraste mínimo';
  if (countWcagCodesInCriterion(singlePrefixless) !== 1 || violatesWcagCardinality(singlePrefixless)) {
    console.error(`❌ Test 9 Failed: single prefix-less WCAG code should have count=1, got ${countWcagCodesInCriterion(singlePrefixless)}`);
    process.exit(1);
  }
  console.log('✅ Test 9 (P0-1): single WCAG code without "WCAG " prefix correctly counted as 1 (no violation).');

  // Test 10 (P0-1): Two WCAG codes in a single finding (with or without repeating "WCAG ") must be flagged and degraded.
  const combinedMixedPrefix = 'WCAG 1.3.1 Información y relaciones y 3.3.2 Etiquetas o instrucciones';
  const combinedNoPrefix = '1.3.1 Información y relaciones, 3.3.2 Etiquetas o instrucciones';
  if (
    countWcagCodesInCriterion(combinedMixedPrefix) !== 2 ||
    !violatesWcagCardinality(combinedMixedPrefix) ||
    countWcagCodesInCriterion(combinedNoPrefix) !== 2 ||
    !violatesWcagCardinality(combinedNoPrefix)
  ) {
    console.error('❌ Test 10 Failed: two WCAG codes without repeated prefix must be detected as cardinality violation.');
    process.exit(1);
  }
  const { findings: r10, summary: s10 } = applyCardinalityEnforcement([
    { wcagCriterion: combinedNoPrefix, status: 'FAIL', confidence: 'high', recommendation: 'fix it' },
  ]);
  if (r10[0].status !== 'NOT_EVALUABLE' || r10[0].confidence !== 'low' || r10[0].recommendation !== null || s10.violations !== 1) {
    console.error('❌ Test 10b Failed: combined prefix-less WCAG finding must be degraded by applyCardinalityEnforcement.', r10, s10);
    process.exit(1);
  }
  console.log('✅ Test 10 (P0-1): two WCAG codes in the same finding (with or without prefix) detected (count=2) and degraded to NOT_EVALUABLE.');

  console.log('\n🎉 ALL H-REGRESSION-2 + J6 cardinality tests passed. Utility ready to grade a real Gemini response AND enforce the contract in production.');
  process.exit(0);
}

runWcagCardinalityTests();
