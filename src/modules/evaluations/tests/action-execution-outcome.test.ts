import { resolveActionOutcome } from '../evaluation.service';
import { automationService } from '@/modules/automation/automation.service';

/**
 * Deterministic tests for the P0-4 fix: AutomationService.executeAction()
 * reports failures via `{ success: false, error }` instead of throwing, and
 * the caller (EvaluationService.runEvaluation, via resolveActionOutcome)
 * must map that into a 'failure' previousActions entry + blockingError —
 * never record a failed action as a success. No live browser/DB/Gemini is
 * used: executeAction's "no selector" / "unsupported action type" branches
 * are hit before any Playwright Page method is called, so a stub page
 * object is enough to exercise the real return-contract deterministically.
 */
function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error(`❌ ${label}`);
    console.error('   expected:', JSON.stringify(expected));
    console.error('   actual:  ', JSON.stringify(actual));
    process.exit(1);
  }
  console.log(`✅ ${label}`);
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting executeAction success:false / resolveActionOutcome tests...');

  // ── Part 1: AutomationService.executeAction() really returns
  //    { success: false }, it does not throw, for a genuine failure. ──
  const evaluationId = 'test-eval-outcome-1';
  (automationService as unknown as { activeSessions: Map<string, unknown> }).activeSessions.set(
    evaluationId,
    { page: {}, close: async () => {} },
  );

  const unsupportedResult = await automationService.executeAction(evaluationId, {
    actionType: 'BOGUS_ACTION',
  });
  assertEqual(
    unsupportedResult.success,
    false,
    'executeAction() with an unsupported actionType resolves (does not throw) with success:false',
  );
  if (!unsupportedResult.error || !unsupportedResult.error.includes('Unsupported action type')) {
    console.error('❌ executeAction() error message should mention "Unsupported action type", got:', unsupportedResult.error);
    process.exit(1);
  }
  console.log('✅ executeAction() failure carries a descriptive error message');

  const missingSelectorResult = await automationService.executeAction(evaluationId, {
    actionType: 'CLICK',
  });
  assertEqual(
    missingSelectorResult.success,
    false,
    'executeAction() CLICK without a selector resolves with success:false (not a thrown exception)',
  );

  await automationService.closeSession(evaluationId);

  // ── Part 2: resolveActionOutcome() maps a successful executeAction()
  //    result into a 'success' previousActions entry and advances the flow. ──
  const currentAction = {
    actionType: 'CLICK',
    rationale: 'Click the primary CTA',
    targetElement: { value: '#cta' },
  };

  const successOutcome = resolveActionOutcome({ success: true }, currentAction, 'Locate CTA');
  assertEqual(
    successOutcome.previousAction,
    { actionType: 'CLICK', description: 'Click the primary CTA', result: 'success' },
    'resolveActionOutcome(success) records result: success with the rationale as description',
  );
  assertEqual(successOutcome.blockingError, null, 'resolveActionOutcome(success) clears blockingError');
  assertEqual(successOutcome.completedStep, 'Locate CTA', 'resolveActionOutcome(success) marks the current objective as completed');
  if (!successOutcome.nextObjective) {
    console.error('❌ resolveActionOutcome(success) should produce a non-null nextObjective');
    process.exit(1);
  }
  console.log('✅ resolveActionOutcome(success) advances to a new objective');

  // ── Part 3: THE critical case — resolveActionOutcome() must NOT record a
  //    failed action as a success. This is exactly the bug found in the
  //    audit: executeAction() returning { success: false } was previously
  //    ignored by the caller and pushed into previousActions as 'success',
  //    silently defeating RuleEngine's Rule 0 (stop on failed action). ──
  const failureOutcome = resolveActionOutcome(
    { success: false, error: 'Timeout 10000ms exceeded waiting for selector "#missing"' },
    currentAction,
    'Locate CTA',
  );
  assertEqual(
    failureOutcome.previousAction.result,
    'failure',
    'resolveActionOutcome(failure) records result: failure — NEVER success',
  );
  if (!failureOutcome.previousAction.description.includes('Timeout')) {
    console.error('❌ resolveActionOutcome(failure) description should include the underlying error, got:', failureOutcome.previousAction.description);
    process.exit(1);
  }
  console.log('✅ resolveActionOutcome(failure) description includes the underlying executeAction error');
  if (!failureOutcome.blockingError || !failureOutcome.blockingError.includes('Timeout')) {
    console.error('❌ resolveActionOutcome(failure) should set a non-null blockingError describing the failure');
    process.exit(1);
  }
  console.log('✅ resolveActionOutcome(failure) sets blockingError');
  assertEqual(
    failureOutcome.completedStep,
    null,
    'resolveActionOutcome(failure) must NOT mark the objective as completed (page did not actually change)',
  );
  assertEqual(
    failureOutcome.nextObjective,
    null,
    'resolveActionOutcome(failure) must NOT advance to a new objective',
  );

  // ── Part 4: end-to-end of the fix — feeding a 'failure' previousActions
  //    entry (as resolveActionOutcome now correctly produces) into
  //    RuleEngine.evaluate() deterministically triggers STOP_FLOW (Rule 0).
  //    This is the safety net the original bug silently defeated. ──
  const { ruleEngine } = await import('../services/rule-engine.service');
  const contextWithFailedAction = {
    metadata: { evaluationId, timestamp: new Date().toISOString(), iteration: 2 },
    flowDefinition: { flowDescription: 'Test flow', currentStepObjective: 'Locate CTA', totalStepsEstimated: 5 },
    flowState: {
      currentStep: 2,
      completedSteps: [],
      previousActions: [failureOutcome.previousAction],
      blockingError: failureOutcome.blockingError,
    },
    userArchetype: {
      fullName: 'Test User', phrase: '', age: 30, profession: 'Tester', maritalStatus: 'Single',
      country: 'CO', city: 'Bogotá', archetype: 'Tester', biography: '', personality: '',
      goals: [], frustrations: [],
    },
    technicalContext: {
      url: 'https://example.com', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
      visibleDOMSummary: [
        { type: 'button', text: 'Continue', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true },
      ],
    },
    constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
  } as any;

  const ruleDecision = ruleEngine.evaluate(contextWithFailedAction);
  if (!ruleDecision || ruleDecision.actionType !== 'STOP_FLOW') {
    console.error('❌ RuleEngine did not STOP_FLOW after a correctly-recorded failed action:', ruleDecision);
    process.exit(1);
  }
  console.log('✅ End-to-end: a resolveActionOutcome(failure) result correctly triggers RuleEngine STOP_FLOW on the next iteration');

  console.log('🎉 All executeAction success:false / resolveActionOutcome tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running action-execution-outcome tests:', err);
  process.exit(1);
});
