import { snapshotEvidenceService } from '../snapshot-evidence.service';

function runSnapshotsApiTests() {
  console.log('🧪 Starting Snapshot Evidence API Tests...\n');

  // Test 1: snapshotEvidenceService method signature
  if (typeof snapshotEvidenceService.getEvidencesForEvaluation !== 'function') {
    console.error('❌ Test 1 Failed: getEvidencesForEvaluation method missing');
    process.exit(1);
  }
  console.log('✅ Test 1 (snapshotEvidenceService method signature) passed.');

  console.log('\n🎉 ALL Snapshot Evidence API Tests passed successfully!');
  process.exit(0);
}

runSnapshotsApiTests();
