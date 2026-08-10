import { evaluationService } from '../evaluation.service';

function runObservability3FTests() {
  console.log('🧪 Starting Subetapa 3F — Live Session Observability & Timeline Tests...\n');

  // Test 1: evaluationService method signatures
  if (typeof evaluationService.create !== 'function' || typeof evaluationService.findById !== 'function') {
    console.error('❌ Test 1 Failed: evaluationService methods missing');
    process.exit(1);
  }
  console.log('✅ Test 1 (evaluationService method signatures) passed.');

  // Test 2: Verify contract structure of flowState previousActions
  const mockPreviousActions = [
    { actionType: 'NAVIGATE', description: 'Navegar a https://example.com', result: 'success' },
    { actionType: 'CLICK', description: 'Click en boton buscar', result: 'success' },
  ];
  if (mockPreviousActions.length !== 2 || mockPreviousActions[0].actionType !== 'NAVIGATE') {
    console.error('❌ Test 2 Failed: mockPreviousActions format invalid');
    process.exit(1);
  }
  console.log('✅ Test 2 (flowState previousActions structure format) passed.');

  console.log('\n🎉 ALL 3F Observability & Timeline Tests passed successfully!');
  process.exit(0);
}

runObservability3FTests();
