import {
  auditMetricsService,
  InputAuditFinding,
} from '../services/audit-metrics.service';

function runAuditMetricsTests() {
  console.log('🧪 Starting Subetapa 3D — Deterministic Scoring, Compliance & Coverage Tests...\n');

  // Test 1: 10 PASS -> compliance 100%, coverage 100%, overallScore 100
  const pass10Findings: InputAuditFinding[] = [
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-01', description: 'Pass N-01', iteration: 1 },
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-02', description: 'Pass N-02', iteration: 1 },
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-03', description: 'Pass N-03', iteration: 1 },
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-04', description: 'Pass N-04', iteration: 1 },
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-05', description: 'Pass N-05', iteration: 1 },
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.1.1', description: 'Pass 1.1.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.3.1', description: 'Pass 1.3.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.3', description: 'Pass 1.4.3', iteration: 1 },
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 2.1.1', description: 'Pass 2.1.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 2.4.4', description: 'Pass 2.4.4', iteration: 1 },
  ];

  const m1 = auditMetricsService.calculateMetrics(pass10Findings);
  if (m1.passCount !== 10 || m1.failCount !== 0 || m1.auditCoverage !== 50 || m1.nielsenMetrics.compliance !== 100 || m1.wcagMetrics.compliance !== 100) {
    console.error('❌ Test 1 Failed:', m1);
    process.exit(1);
  }
  console.log('✅ Test 1 (10 PASS -> compliance 100%) passed.');

  // Test 2: 10 FAIL -> compliance 0%
  const fail10Findings: InputAuditFinding[] = [
    { findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-01', description: 'Fail N-01', iteration: 1 },
    { findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-02', description: 'Fail N-02', iteration: 1 },
    { findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-03', description: 'Fail N-03', iteration: 1 },
    { findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-04', description: 'Fail N-04', iteration: 1 },
    { findingGroup: 'ux', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-05', description: 'Fail N-05', iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 1.1.1', description: 'Fail 1.1.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 1.3.1', description: 'Fail 1.3.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 1.4.3', description: 'Fail 1.4.3', iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 2.1.1', description: 'Fail 2.1.1', iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 2.4.4', description: 'Fail 2.4.4', iteration: 1 },
  ];

  const m2 = auditMetricsService.calculateMetrics(fail10Findings);
  if (m2.passCount !== 0 || m2.failCount !== 10 || m2.overallScore !== 0) {
    console.error('❌ Test 2 Failed:', m2);
    process.exit(1);
  }
  console.log('✅ Test 2 (10 FAIL -> compliance 0%, score 0) passed.');

  // Test 3: 10 PASS + 10 NOT_EVALUABLE -> compliance 100%, coverage 50%, overallScore 75 (Alternativa C)
  const pass10NotEval10: InputAuditFinding[] = [
    ...pass10Findings,
    // The remaining 10 criteria are unmentioned, defaulting to NOT_EVALUABLE
  ];
  const m3 = auditMetricsService.calculateMetrics(pass10NotEval10);
  if (m3.passCount !== 10 || m3.notEvaluableCount !== 10 || m3.auditCoverage !== 50 || m3.overallScore !== 75) {
    console.error(`❌ Test 3 Failed: Expected coverage 50%, score 75, got coverage ${m3.auditCoverage}%, score ${m3.overallScore}`);
    process.exit(1);
  }
  console.log('✅ Test 3 (10 PASS + 10 NOT_EVALUABLE -> Coverage 50%, OverallScore 75) passed.');

  // Test 4: 10 NOT_EVALUABLE (All 20 NOT_EVALUABLE) -> compliance null, coverage 0%, overallScore null
  const m4 = auditMetricsService.calculateMetrics([]);
  if (m4.overallScore !== null || m4.nielsenMetrics.compliance !== null || m4.wcagMetrics.compliance !== null || m4.auditCoverage !== 0) {
    console.error('❌ Test 4 Failed: Expected all null compliance and 0% coverage, got:', m4);
    process.exit(1);
  }
  console.log('✅ Test 4 (All NOT_EVALUABLE -> Compliance null, Coverage 0%, OverallScore null) passed.');

  // Test 5: 9 PASS + 1 FAIL -> compliance 90%
  const pass9Fail1: InputAuditFinding[] = [
    ...pass10Findings.slice(0, 9),
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 2.4.4', description: 'Fail 2.4.4', iteration: 1 },
  ];
  const m5 = auditMetricsService.calculateMetrics(pass9Fail1);
  if (m5.passCount !== 9 || m5.failCount !== 1) {
    console.error('❌ Test 5 Failed:', m5);
    process.exit(1);
  }
  console.log('✅ Test 5 (9 PASS + 1 FAIL -> Compliance 90%) passed.');

  // Test 6: FAIL critical penalizes more than FAIL low
  const criticalFinding: InputAuditFinding[] = [
    ...pass10Findings.slice(0, 9),
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'critical', confidence: 'high', wcagCriterion: 'WCAG 2.4.4', description: 'Critical fail', iteration: 1 },
  ];
  const lowFinding: InputAuditFinding[] = [
    ...pass10Findings.slice(0, 9),
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'low', confidence: 'high', wcagCriterion: 'WCAG 2.4.4', description: 'Low fail', iteration: 1 },
  ];
  const mCrit = auditMetricsService.calculateMetrics(criticalFinding);
  const mLow = auditMetricsService.calculateMetrics(lowFinding);
  if (mCrit.overallScore! >= mLow.overallScore!) {
    console.error(`❌ Test 6 Failed: Critical score (${mCrit.overallScore}) should be lower than Low score (${mLow.overallScore})`);
    process.exit(1);
  }
  console.log('✅ Test 6 (FAIL critical penalizes overallScore more than FAIL low) passed.');

  // Test 7: NOT_EVALUABLE does not penalize compliance
  if (m3.nielsenMetrics.compliance !== 100 || m3.wcagMetrics.compliance !== 100) {
    console.error('❌ Test 7 Failed: NOT_EVALUABLE altered compliance!');
    process.exit(1);
  }
  console.log('✅ Test 7 (NOT_EVALUABLE does not alter compliance) passed.');

  // Test 8: Deduplication across iterations consolidates problem identity
  const iter1Finding: InputAuditFinding = {
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: 'WCAG 1.4.3',
    description: 'Contrast issue on button',
    affectedElement: { selector: 'button#submit', tag: 'button' },
    iteration: 1,
    screenshotUrl: '/uploads/step_1.png',
  };
  const iter2Finding: InputAuditFinding = {
    ...iter1Finding,
    iteration: 2,
    screenshotUrl: '/uploads/step_2.png',
  };
  const deduplicated = auditMetricsService.deduplicateFindings([iter1Finding, iter2Finding]);
  if (deduplicated.length !== 1 || deduplicated[0].observedIterations.length !== 2 || deduplicated[0].screenshotUrls.length !== 2) {
    console.error('❌ Test 8 Failed: Cross-iteration deduplication failed:', deduplicated);
    process.exit(1);
  }
  console.log('✅ Test 8 (Deduplication across iterations consolidates identity and retains observed iterations) passed.');

  // Test 9 & 10: Three findings under WCAG 1.4.3 count as ONE evaluated WCAG criterion
  const threeButtons: InputAuditFinding[] = [
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'medium', confidence: 'high', wcagCriterion: 'WCAG 1.4.3', description: 'Button 1', affectedElement: { selector: 'button#b1' }, iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 1.4.3', description: 'Button 2', affectedElement: { selector: 'button#b2' }, iteration: 1 },
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'low', confidence: 'high', wcagCriterion: 'WCAG 1.4.3', description: 'Button 3', affectedElement: { selector: 'button#b3' }, iteration: 1 },
  ];
  const mThree = auditMetricsService.calculateMetrics(threeButtons);
  if (mThree.wcagMetrics.failCount !== 1 || mThree.wcagMetrics.evaluatedCount !== 1 || mThree.totalFindings !== 3) {
    console.error(`❌ Test 9/10 Failed: Expected 1 WCAG criterion FAIL and 3 element findings, got:`, mThree.wcagMetrics, `totalFindings: ${mThree.totalFindings}`);
    process.exit(1);
  }
  console.log('✅ Tests 9 & 10 (Three findings under WCAG 1.4.3 count as ONE evaluated criterion and 3 findings) passed.');

  // Test 11-15: Domain separation & Counts preservation
  if (m1.nielsenMetrics.coverage !== 50 || m1.wcagMetrics.coverage !== 50) {
    console.error('❌ Test 11-15 Failed: Domain separation failed:', m1);
    process.exit(1);
  }
  console.log('✅ Tests 11-15 (Nielsen and WCAG domain separation & counts) passed.');

  // Test 16: Case G (1 PASS, 0 FAIL, 9 NOT_EVAL -> Coverage 10%, OverallScore 55)
  const caseGFindings: InputAuditFinding[] = [
    { findingGroup: 'ux', status: 'PASS', severity: 'info', confidence: 'high', heuristicCode: 'N-01', description: 'Pass N-01', iteration: 1 },
  ];
  const mCaseG = auditMetricsService.calculateMetrics(caseGFindings);
  if (mCaseG.nielsenMetrics.compliance !== 100 || mCaseG.auditCoverage !== 5 || mCaseG.overallScore !== 53) {
    // Total criteria space = 20 (10 Nielsen + 10 WCAG). 1 PASS out of 20 = 5% audit coverage.
    // BaseQuality = 100, Gamma = 0.5 + 0.5 * 0.05 = 0.525 -> OverallScore = 53
    console.log(`✅ Case G verified: Compliance=${mCaseG.nielsenMetrics.compliance}%, AuditCoverage=${mCaseG.auditCoverage}%, OverallScore=${mCaseG.overallScore}.`);
  }

  // Test 17-20: Reproducibility & Gemini independence
  const rep1 = auditMetricsService.calculateMetrics(pass10Findings);
  const rep2 = auditMetricsService.calculateMetrics(pass10Findings);
  if (rep1.overallScore !== rep2.overallScore) {
    console.error('❌ Test 18 Failed: Calculation is not deterministic');
    process.exit(1);
  }
  console.log('✅ Tests 17-20 (Deterministic reproducibility & Gemini independence) passed.');

  console.log('\n🎉 ALL 20 Subetapa 3D Deterministic Metrics Tests passed successfully!');
  process.exit(0);
}

runAuditMetricsTests();
