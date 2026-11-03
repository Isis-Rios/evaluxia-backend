import {
  V2AIInputContextSchema,
  V2AIOutputDecisionSchema,
  V2AuditOutputSchema,
  TechnicalEvidenceItemSchema,
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

  // Test Case 2b (Phase C.1): Gemini response with NO "notes" and NO
  // "userIntention" at all — this is exactly the reduced shape the Phase 1
  // prompt now asks for (see ai.service.ts buildV2DecisionPrompt). Confirms
  // Gemini can respond validly without them, and that suggestedAction /
  // flowControl work exactly the same as before.
  const reducedV2Output = {
    evaluationSummary: {
      flowCanContinue: true,
      // no "notes" field at all
    },
    // no "userIntention" field at all
    suggestedAction: {
      actionType: 'CLICK',
      targetElement: {
        matchStrategy: 'CSS',
        value: 'button#submit',
      },
      inputData: null,
      rationale: 'Único botón visible en la pantalla actual.',
      confidence: 'high',
    },
    flowControl: {
      isStopper: false,
      stopperReason: null,
      recommendedNextStep: 'executeSuggestedAction',
    },
  };

  const reducedValidation = V2AIOutputDecisionSchema.safeParse(reducedV2Output);
  if (!reducedValidation.success) {
    console.error('❌ Reduced V2 Output Decision (Phase C.1, no notes/userIntention) validation failed:', reducedValidation.error.message);
    process.exit(1);
  }
  console.log('✅ Reduced V2 Output Decision (no notes/userIntention) validates successfully.');

  if (reducedValidation.data.evaluationSummary.notes !== '') {
    console.error(`❌ Expected evaluationSummary.notes to default to '' when omitted, got: ${JSON.stringify(reducedValidation.data.evaluationSummary.notes)}`);
    process.exit(1);
  }
  console.log("✅ evaluationSummary.notes defaults to '' when Gemini omits it.");

  if (
    reducedValidation.data.userIntention.description !== 'Navegación táctica' ||
    reducedValidation.data.userIntention.derivedFromArchetype !== false
  ) {
    console.error('❌ Expected userIntention to fall back to its default object when omitted, got:', reducedValidation.data.userIntention);
    process.exit(1);
  }
  console.log('✅ userIntention defaults correctly when Gemini omits it entirely.');

  if (
    reducedValidation.data.suggestedAction?.actionType !== 'CLICK' ||
    reducedValidation.data.suggestedAction?.targetElement?.value !== 'button#submit'
  ) {
    console.error('❌ suggestedAction was not preserved correctly in the reduced-shape response.');
    process.exit(1);
  }
  console.log('✅ suggestedAction is preserved exactly, unaffected by removing notes/userIntention from the prompt.');

  if (
    reducedValidation.data.flowControl.recommendedNextStep !== 'executeSuggestedAction' ||
    reducedValidation.data.flowControl.isStopper !== false
  ) {
    console.error('❌ flowControl was not preserved correctly in the reduced-shape response.');
    process.exit(1);
  }
  console.log('✅ flowControl is preserved exactly, unaffected by removing notes/userIntention from the prompt.');

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
        status: 'FAIL',
        severity: 'medium',
        confidence: 'high',
        heuristicCode: 'N-01',
        heuristicName: 'Visibilidad del estado del sistema',
        heuristic: 'N-01: Visibilidad del estado del sistema',
        description: 'No visual feedback when loading.',
        evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'div.loading', attribute: 'class', value: 'hidden' }],
        recommendation: 'Add loading indicator.',
        affectedArchetypeTraits: ['analytical'],
      },
      {
        findingGroup: 'accessibility',
        type: 'wcag',
        status: 'FAIL',
        severity: 'high',
        confidence: 'high',
        wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
        description: 'Primary image missing alt attribute.',
        evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'img.hero', attribute: 'alt', value: 'missing' }],
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

  // Test Case 5b: Null-safety validation of AffectedElementSchema in V2AuditOutputSchema
  const auditOutputWithNullAffectedElement = {
    overallScore: 85,
    executiveSummary: 'Audit summary with null properties in affectedElement.',
    findings: [
      {
        findingGroup: 'accessibility',
        type: 'wcag',
        status: 'FAIL',
        severity: 'medium',
        confidence: 'high',
        wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
        description: 'Generic container element lacking role semantics.',
        evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'div.hero-banner', property: 'role', value: null }],
        affectedElement: {
          tag: 'div',
          text: null,
          selector: 'div.hero-banner',
          role: null,
          ariaLabel: null,
          href: null,
          id: null,
          attributes: null,
        },
        recommendation: 'Add explicit role or ARIA attributes.',
      },
    ],
  };

  const nullSafetyValidation = V2AuditOutputSchema.safeParse(auditOutputWithNullAffectedElement);
  if (!nullSafetyValidation.success) {
    console.error('❌ AffectedElementSchema null-safety validation failed:', nullSafetyValidation.error.message);
    process.exit(1);
  }
  console.log('✅ AffectedElementSchema null-safety (role: null, text: null, etc.) validated successfully.');

  // Test Case 5c: Evidence Type Alias Normalization & Semantic Preservation Test
  const auditOutputWithEvidenceAliases = {
    overallScore: 80,
    executiveSummary: 'Audit summary with evidence aliases.',
    findings: [
      {
        findingGroup: 'accessibility',
        type: 'wcag',
        status: 'FAIL',
        severity: 'high',
        confidence: 'high',
        wcagCriterion: 'WCAG 2.4.1 Omitir bloques',
        description: 'No skip link available.',
        evidence: [
          { type: 'CURRENT_URL', value: 'https://launchpage.xyz/example', selector: null },
          { type: 'BUTTON_PROPERTIES', property: 'aria-label', value: 'missing', selector: 'button#btn1' },
          { type: 'COLOR_CONTRAST', property: 'contrastRatio', value: '2.1:1', selector: 'p.hero' },
          { type: 'ARIA_SNAPSHOT', property: 'accessibleName', value: '0', selector: null },
          { type: 'SCREENSHOT', value: '/uploads/step_1.png', selector: null },
        ],
        recommendation: 'Add skip link and fix contrast.',
      },
    ],
  };

  const aliasValidation = V2AuditOutputSchema.safeParse(auditOutputWithEvidenceAliases);
  if (!aliasValidation.success) {
    console.error('❌ Evidence type alias validation failed:', aliasValidation.error.message);
    process.exit(1);
  }
  const parsedFinding = aliasValidation.data.findings[0];
  if (
    parsedFinding.evidence[0].type !== 'INTERACTION' ||
    parsedFinding.evidence[0].property !== 'url' ||
    parsedFinding.evidence[0].selector !== undefined ||
    parsedFinding.evidence[1].type !== 'DOM_ATTRIBUTE' ||
    parsedFinding.evidence[1].property !== 'aria-label' ||
    parsedFinding.evidence[2].type !== 'COMPUTED_STYLE' ||
    parsedFinding.evidence[2].property !== 'contrastRatio' ||
    parsedFinding.evidence[3].type !== 'ACCESSIBILITY_TREE' ||
    parsedFinding.evidence[3].value !== '0' ||
    parsedFinding.evidence[4].type !== 'SCREENSHOT' ||
    parsedFinding.evidence[4].selector !== undefined
  ) {
    console.error('❌ Evidence type alias mapping, property preservation, or nullish selector failed!');
    process.exit(1);
  }
  console.log('✅ Evidence type alias normalization & superRefine semantic preservation (CURRENT_URL -> INTERACTION, selector: null -> undefined, value: "0" accepted) validated successfully.');

  // Test Case 5d: SuperRefine Strict Validation Tests (Rejecting empty property/value when mandatory)
  const testCasesSuperRefineRejection = [
    {
      name: 'DOM_ATTRIBUTE missing property/attribute',
      payload: { type: 'DOM_ATTRIBUTE', value: 'missing', selector: 'img' },
    },
    {
      name: 'DOM_ATTRIBUTE empty string property',
      payload: { type: 'DOM_ATTRIBUTE', property: '   ', value: 'missing' },
    },
    {
      name: 'DOM_ATTRIBUTE empty string value',
      payload: { type: 'DOM_ATTRIBUTE', property: 'alt', value: '   ' },
    },
    {
      name: 'COMPUTED_STYLE missing property',
      payload: { type: 'COMPUTED_STYLE', value: '2.32:1' },
    },
    {
      name: 'COMPUTED_STYLE missing value',
      payload: { type: 'COMPUTED_STYLE', property: 'contrastRatio' },
    },
    {
      name: 'INTERACTION missing both property and value',
      payload: { type: 'INTERACTION', selector: 'window' },
    },
    {
      name: 'Unknown evidence type alias',
      payload: { type: 'TOTALLY_UNKNOWN_TYPE', value: 'some value' },
    },
    {
      name: 'Empty evidence type',
      payload: { type: '   ', value: 'some value' },
    },
  ];

  for (const tc of testCasesSuperRefineRejection) {
    const res = TechnicalEvidenceItemSchema.safeParse(tc.payload);
    if (res.success) {
      console.error(`❌ SuperRefine failed to reject invalid evidence item [${tc.name}]:`, JSON.stringify(res.data));
      process.exit(1);
    }
  }
  console.log('✅ SuperRefine strict validation (rejecting empty property/value, unknown type, empty type) validated successfully.');

  // Test Case 5e: DOM_ATTRIBUTE `value` edge cases (Fase 2 fix — real
  // incident, evaluation 6ae151a7c9e40a501f9cd885, 2026-10-28). Before this
  // fix, `value: ''` was indistinguishable from an omitted `value` and was
  // rejected identically — a legitimate empty attribute observation
  // (e.g. alt="") caused Phase 2 to exhaust all retries with zero findings
  // persisted. This isolates exactly what changed and what did NOT.
  const domAttributeValueCases: Array<{ name: string; payload: any; expectValid: boolean }> = [
    { name: '1. valor de texto válido', payload: { type: 'DOM_ATTRIBUTE', property: 'alt', value: 'Logo de la empresa' }, expectValid: true },
    { name: '2. value: "" (cadena vacía explícita) — EL FIX', payload: { type: 'DOM_ATTRIBUTE', property: 'alt', value: '' }, expectValid: true },
    { name: '3. value ausente (campo no presente)', payload: { type: 'DOM_ATTRIBUTE', property: 'alt' }, expectValid: false },
    { name: '4. value: null (sentinel "null", ya soportado antes del fix)', payload: { type: 'DOM_ATTRIBUTE', property: 'role', value: null }, expectValid: true },
    { name: '5. value de tipo incorrecto (objeto)', payload: { type: 'DOM_ATTRIBUTE', property: 'alt', value: { nested: true } }, expectValid: false },
    { name: '6. value solo espacios en blanco (sigue rechazado, no es "")', payload: { type: 'DOM_ATTRIBUTE', property: 'alt', value: '   ' }, expectValid: false },
    { name: '7. regresión: COMPUTED_STYLE con value: "" sigue rechazado (no se debilitó otro tipo)', payload: { type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '' }, expectValid: false },
  ];
  for (const tc of domAttributeValueCases) {
    const res = TechnicalEvidenceItemSchema.safeParse(tc.payload);
    if (res.success !== tc.expectValid) {
      console.error(
        `❌ DOM_ATTRIBUTE value edge case [${tc.name}]: esperado ${tc.expectValid ? 'VÁLIDO' : 'RECHAZADO'}, obtenido ${res.success ? 'VÁLIDO' : 'RECHAZADO'}`,
        res.success ? JSON.stringify(res.data) : res.error.message,
      );
      process.exit(1);
    }
  }
  console.log('✅ DOM_ATTRIBUTE value edge cases (Fase 2 fix: "" aceptado, ausente/null-sentinel/tipo-incorrecto/whitespace sin cambios, COMPUTED_STYLE sin debilitar) validados.');

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
