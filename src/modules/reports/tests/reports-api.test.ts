import { reportService } from '../report.service';

function runReportsApiTests() {
  console.log('🧪 Starting Reports API Tests...\n');

  // Test 1: reportRepository methods signature and responsiveness
  if (typeof reportService.getReportForEvaluation !== 'function') {
    console.error('❌ Test 1 Failed: getReportForEvaluation is missing');
    process.exit(1);
  }
  console.log('✅ Test 1 (reportService method signature) passed.');

  // Test 2: getCumulativeMetrics responsiveness
  const metrics = reportService.getCumulativeMetrics();
  if (typeof metrics.cumulativeCostUsd !== 'number' || typeof metrics.totalPromptTokens !== 'number') {
    console.error('❌ Test 2 Failed: Invalid cumulative metrics:', metrics);
    process.exit(1);
  }
  console.log('✅ Test 2 (getCumulativeMetrics response format) passed.');

  console.log('\n🎉 ALL Reports API Tests passed successfully!');
  process.exit(0);
}

runReportsApiTests();
