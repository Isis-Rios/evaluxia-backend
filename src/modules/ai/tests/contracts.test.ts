import {
  V2AIInputContextSchema,
  V2AIOutputDecisionSchema,
  V2AuditOutputSchema,
} from '../contracts/ai.contracts';
import { ruleEngine } from '@/modules/evaluations/services/rule-engine.service';
import { contextBuilder } from '@/modules/evaluations/services/context-builder.service';
import { calculateDynamicMaxIterations } from '@/modules/evaluations/services/dynamic-iterations.service';
import { InteractiveElement } from '@/modules/automation/automation.service';

function runTests() {
  console.log('🧪 Starting Contract Validation & Optimization Tests (Etapa 2C — Dynamic maxIterations)...');

  // Test Case 1: Valid V2 Input Context
  const validV2Input = {
    metadata: {
      evaluationId: 'eval_123',
      timestamp: new Date().toISOString(),
      iteration: 1,
    },
    flowDefinition: {
      flowDescription: 'Validate simple checkout flow',
      currentStepObjective: 'Locate and click add to cart button',
      totalStepsEstimated: 4,
    },
    flowState: {
      currentStep: 1,
      completedSteps: [],
      previousActions: [],
      blockingError: null,
    },
    userArchetype: {
      fullName: 'Carlos Ruiz',
      phrase: 'Simple logic only',
      age: 55,
      profession: 'Accountant',
      maritalStatus: 'Married',
      country: 'Spain',
      city: 'Madrid',
      archetype: 'The Caregiver',
      biography: 'Needs high contrast...',
      personality: 'Analytical',
      goals: ['Finish task quick'],
      frustrations: ['Overwhelming steps'],
    },
    technicalContext: {
      url: 'https://example.com/item/1',
      requiresAuthentication: false,
      authenticationStatus: 'unauthenticated',
      visibleDOMSummary: [
        {
          type: 'button',
          text: 'Buy Now',
          ariaLabel: 'Primary purchase button',
          role: 'button',
          isDisabled: false,
          isPrimary: true,
        },
        {
          type: 'select',
          text: 'Option 1',
          ariaLabel: 'Dropdown select element',
          role: 'combobox',
          isDisabled: false,
          isPrimary: false,
        },
      ],
    },
    constraints: {
      doNotAssumeHiddenElements: true,
      doNotInventActions: true,
      maxOneActionPerIteration: true,
    },
  };

  const inputValidation = V2AIInputContextSchema.safeParse(validV2Input);
  if (!inputValidation.success) {
    console.error('❌ V2 Input Context validation failed:', inputValidation.error.message);
    process.exit(1);
  }
  console.log('✅ V2 Input Context Schema validated successfully.');

  // Test Case 2: Valid V2 Output Decision with SELECT Action & Simplified Phase 1 fields
  const validV2SelectOutput = {
    evaluationSummary: {
      flowCanContinue: true,
      notes: 'Select option 2 from the dropdown list.',
    },
    suggestedAction: {
      actionType: 'SELECT',
      targetElement: {
        matchStrategy: 'CSS',
        value: 'select#dropdown',
      },
      inputData: '2',
      rationale: 'Select option 2 for dropdown requirement.',
      confidence: 'high',
    },
    flowControl: {
      isStopper: false,
      stopperReason: null,
      recommendedNextStep: 'executeSuggestedAction',
    },
  };

  const outputValidation = V2AIOutputDecisionSchema.safeParse(validV2SelectOutput);
  if (!outputValidation.success) {
    console.error('❌ V2 Output Decision (SELECT) validation failed:', outputValidation.error.message);
    process.exit(1);
  }
  console.log('✅ V2 Output Decision Schema (SELECT + Simplified Phase 1) validated successfully.');

  // Test Case 3: Invalid V2 Output (missing required fields)
  const invalidV2Output = {
    evaluationSummary: {
      flowCanContinue: 'maybe',
      confidenceLevel: 'extreme',
      notes: 123,
    },
  };

  const invalidValidation = V2AIOutputDecisionSchema.safeParse(invalidV2Output);
  if (invalidValidation.success) {
    console.error('❌ Error: Invalid Output incorrectly passed validation!');
    process.exit(1);
  }
  console.log('✅ Invalid V2 Output correctly caught by validation constraints.');

  // Test Case 4: RuleEngine Cycle Prevention Test
  const contextWithFailedAction = {
    ...validV2Input,
    flowState: {
      currentStep: 2,
      completedSteps: ['Paso 1'],
      previousActions: [
        {
          actionType: 'CLICK',
          description: 'Failed to click element: timeout 30s',
          result: 'failure' as const,
        },
      ],
      blockingError: 'Action failed: timeout',
    },
  };

  const ruleResult = ruleEngine.evaluate(contextWithFailedAction as any);
  if (!ruleResult || ruleResult.actionType !== 'STOP_FLOW') {
    console.error('❌ RuleEngine cycle prevention test failed: Did not intercept failed action!');
    process.exit(1);
  }
  console.log('✅ RuleEngine Cycle Prevention rule validated successfully (Intercepted failure with STOP_FLOW).');

  // Test Case 5: Valid V2 Phase 2 Audit Output
  const validV2AuditOutput = {
    overallScore: 85,
    executiveSummary: '# Executive Summary\nGood overall UX...',
    findings: [
      {
        findingGroup: 'ux',
        type: 'usability',
        severity: 'medium',
        heuristic: 'N-01: Visibilidad del estado del sistema',
        description: 'No visual feedback when loading.',
        recommendation: 'Add loading indicator.',
        affectedArchetypeTraits: ['analytical'],
      },
      {
        findingGroup: 'accessibility',
        type: 'wcag',
        severity: 'high',
        wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
        description: 'Primary image missing alt attribute.',
        recommendation: 'Provide alt text describing product.',
      },
    ],
  };

  const auditOutputValidation = V2AuditOutputSchema.safeParse(validV2AuditOutput);
  if (!auditOutputValidation.success) {
    console.error('❌ V2 Audit Output validation failed:', auditOutputValidation.error.message);
    process.exit(1);
  }
  console.log('✅ V2 Audit Output Schema (Phase 2) validated successfully.');

  // Test Case 6: ContextBuilder Sliding Window Test (Keep last 3 actions)
  const dummyProfile: any = {
    fullName: 'Carlos Ruiz',
    phrase: 'Phrase',
    age: 55,
    profession: 'Accountant',
    archetype: 'The Caregiver',
    goals: [],
    frustrations: [],
  };
  const dummySnapshot: any = {
    url: 'https://example.com',
    title: 'Test Page',
    visibleDOMSummary: [],
  };
  const longActions = [
    { actionType: 'CLICK', description: 'Action 1', result: 'success' },
    { actionType: 'TYPE', description: 'Action 2', result: 'success' },
    { actionType: 'FOCUS', description: 'Action 3', result: 'success' },
    { actionType: 'SELECT', description: 'Action 4', result: 'success' },
    { actionType: 'CLICK', description: 'Action 5', result: 'success' },
  ];

  const builtContext = contextBuilder.buildContext({
    evaluationId: 'eval_123',
    iteration: 5,
    goal: 'Goal',
    currentObjective: 'Objective',
    totalStepsEstimated: 5,
    completedSteps: ['Paso 1', 'Paso 2', 'Paso 3', 'Paso 4'],
    previousActions: longActions,
    blockingError: null,
    profile: dummyProfile,
    snapshot: dummySnapshot,
  });

  if (builtContext.flowState.previousActions.length !== 3) {
    console.error('❌ ContextBuilder sliding window failed: Length is not 3');
    process.exit(1);
  }
  if (builtContext.flowState.previousActions[0].description !== 'Action 3') {
    console.error('❌ ContextBuilder sliding window failed: First element is not Action 3');
    process.exit(1);
  }
  console.log('✅ ContextBuilder Sliding Window rule (last 3 actions) validated successfully.');

  // Test Case 7: RuleEngine Regla 5 (TYPE -> Submit/Continuation) Tests (Casos A-F)
  const baseContextForRegla5: any = {
    metadata: { evaluationId: 'eval_555', timestamp: new Date().toISOString(), iteration: 2 },
    flowDefinition: { flowDescription: 'Form flow', currentStepObjective: 'Fill form', totalStepsEstimated: 2 },
    flowState: { currentStep: 2, completedSteps: [], previousActions: [], blockingError: null },
    userArchetype: { fullName: 'User', phrase: 'P', age: 30, profession: 'Dev', maritalStatus: 'S', country: 'CO', city: 'BOG', archetype: 'Test', biography: '', personality: '', goals: [], frustrations: [] },
    technicalContext: { url: 'https://example.com/form', requiresAuthentication: false, authenticationStatus: 'unauthenticated', visibleDOMSummary: [] },
    constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
  };

  // Caso A: TYPE + Submit button enabled -> RuleEngine proposes CLICK Submit
  const caseA = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'TYPE', description: 'Typed text', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Pass', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Enviar Formulario', ariaLabel: 'Submit button', role: 'button', isDisabled: false, isPrimary: true },
      ],
    },
  };
  const resA = ruleEngine.evaluate(caseA);
  if (!resA || resA.actionType !== 'CLICK' || !resA.targetElement?.value.includes('Submit')) {
    console.error('❌ Caso A failed: Expected CLICK on Submit button');
    process.exit(1);
  }
  console.log('✅ Caso A (TYPE + Submit button enabled) passed.');

  // Caso B: TYPE + Search button enabled -> RuleEngine proposes CLICK Search
  const caseB = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'TYPE', description: 'Typed query', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'Query', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Filter', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Buscar', ariaLabel: 'Search', role: 'search', isDisabled: false, isPrimary: true },
      ],
    },
  };
  const resB = ruleEngine.evaluate(caseB);
  if (!resB || resB.actionType !== 'CLICK' || !resB.targetElement?.value.includes('Search')) {
    console.error('❌ Caso B failed: Expected CLICK on Search button');
    process.exit(1);
  }
  console.log('✅ Caso B (TYPE + Search button enabled) passed.');

  // Caso C: TYPE + No continuation button -> RuleEngine returns null
  const caseC = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'TYPE', description: 'Typed text', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Password', role: 'textbox', isDisabled: false, isPrimary: false },
      ],
    },
  };
  const resC = ruleEngine.evaluate(caseC);
  if (resC !== null) {
    console.error('❌ Caso C failed: Expected null when no continuation button exists');
    process.exit(1);
  }
  console.log('✅ Caso C (TYPE + No continuation button -> null) passed.');

  // Caso D: TYPE + Disabled Submit button -> RuleEngine returns null
  const caseD = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'TYPE', description: 'Typed text', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Password', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Submit', ariaLabel: 'Submit button', role: 'button', isDisabled: true, isPrimary: true },
      ],
    },
  };
  const resD = ruleEngine.evaluate(caseD);
  if (resD !== null) {
    console.error('❌ Caso D failed: Expected null when submit button is disabled');
    process.exit(1);
  }
  console.log('✅ Caso D (TYPE + Disabled submit button -> null) passed.');

  // Caso E: Previous action != TYPE (e.g. CLICK) -> RuleEngine returns null
  const caseE = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'CLICK', description: 'Clicked link', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Password', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Submit', ariaLabel: 'Submit button', role: 'button', isDisabled: false, isPrimary: true },
      ],
    },
  };
  const resE = ruleEngine.evaluate(caseE);
  if (resE !== null) {
    console.error('❌ Caso E failed: Expected null when previous action is not TYPE');
    process.exit(1);
  }
  console.log('✅ Caso E (Previous action != TYPE -> null) passed.');

  // Caso F: TYPE + Button with non-submit signals ("Cancel") -> RuleEngine returns null
  const caseF = {
    ...baseContextForRegla5,
    flowState: { ...baseContextForRegla5.flowState, previousActions: [{ actionType: 'TYPE', description: 'Typed text', result: 'success' }] },
    technicalContext: {
      ...baseContextForRegla5.technicalContext,
      visibleDOMSummary: [
        { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'input', text: null, ariaLabel: 'Password', role: 'textbox', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Cancel', ariaLabel: 'Cancel action', role: 'button', isDisabled: false, isPrimary: false },
        { type: 'button', text: 'Help', ariaLabel: 'Help documentation', role: 'button', isDisabled: false, isPrimary: false },
      ],
    },
  };
  const resF = ruleEngine.evaluate(caseF);
  if (resF !== null) {
    console.error('❌ Caso F failed: Expected null when buttons do not match submit signals');
    process.exit(1);
  }
  console.log('✅ Caso F (TYPE + Non-submit button "Cancel" -> null) passed.');

  // Test Case 8: calculateDynamicMaxIterations Tests (Etapa 2C)
  const simplePageDom: InteractiveElement[] = [{ type: 'input', text: null, ariaLabel: 'Text', role: 'textbox', isDisabled: false, isPrimary: false }];
  if (calculateDynamicMaxIterations(simplePageDom) !== 3) {
    console.error('❌ Dynamic maxIterations test 1 (simple page) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (simple page -> 3) passed.');

  const shortFormDom: InteractiveElement[] = [
    { type: 'input', text: null, ariaLabel: 'User', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'input', text: null, ariaLabel: 'Pass', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'button', text: 'Submit', ariaLabel: 'Submit', role: 'submit', isDisabled: false, isPrimary: true },
  ];
  if (calculateDynamicMaxIterations(shortFormDom) !== 5) {
    console.error('❌ Dynamic maxIterations test 2 (short form) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (short form -> 5) passed.');

  const mediumFormDom: InteractiveElement[] = [
    { type: 'input', text: null, ariaLabel: 'F1', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'input', text: null, ariaLabel: 'F2', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'input', text: null, ariaLabel: 'F3', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'select', text: null, ariaLabel: 'F4', role: 'combobox', isDisabled: false, isPrimary: false },
    { type: 'textarea', text: null, ariaLabel: 'F5', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'button', text: 'Send', ariaLabel: 'Send', role: 'submit', isDisabled: false, isPrimary: true },
  ];
  if (calculateDynamicMaxIterations(mediumFormDom) !== 8) {
    console.error('❌ Dynamic maxIterations test 3 (medium form) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (medium form -> 8) passed.');

  const longFormDom: InteractiveElement[] = (Array.from({ length: 10 }, (_, i) => ({
    type: 'input', text: null, ariaLabel: `F${i}`, role: 'textbox', isDisabled: false, isPrimary: false,
  })) as InteractiveElement[]).concat([{ type: 'button', text: 'Submit', ariaLabel: 'Submit', role: 'submit', isDisabled: false, isPrimary: true }]);
  if (calculateDynamicMaxIterations(longFormDom) !== 8) {
    console.error('❌ Dynamic maxIterations test 4 (long form) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (long form -> 8 clamped) passed.');

  const manyLinksDom: InteractiveElement[] = ([
    { type: 'input', text: null, ariaLabel: 'Search', role: 'textbox', isDisabled: false, isPrimary: false },
    { type: 'button', text: 'Search', ariaLabel: 'Search', role: 'submit', isDisabled: false, isPrimary: true },
  ] as InteractiveElement[]).concat(Array.from({ length: 50 }, (_, i) => ({
    type: 'link', text: `Link ${i}`, ariaLabel: `Link ${i}`, role: 'link', isDisabled: false, isPrimary: false,
  })));
  if (calculateDynamicMaxIterations(manyLinksDom) !== 6) {
    console.error(`❌ Dynamic maxIterations test 5 (many links) failed: got ${calculateDynamicMaxIterations(manyLinksDom)} expected 6`);
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (many links -> 6 capped) passed.');

  if (calculateDynamicMaxIterations([]) !== 3) {
    console.error('❌ Dynamic maxIterations test 6 (min limit 3) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (minimum limit -> 3) passed.');

  const maxElementsDom: InteractiveElement[] = Array.from({ length: 20 }, (_, i) => ({
    type: 'input', text: null, ariaLabel: `F${i}`, role: 'textbox', isDisabled: false, isPrimary: false,
  }));
  if (calculateDynamicMaxIterations(maxElementsDom) !== 8) {
    console.error('❌ Dynamic maxIterations test 7 (max limit 8) failed');
    process.exit(1);
  }
  console.log('✅ Dynamic maxIterations (maximum limit -> 8) passed.');

  console.log('🎉 All Contract & Optimization Tests (Etapa 2C) passed successfully!');
  process.exit(0);
}

runTests();
