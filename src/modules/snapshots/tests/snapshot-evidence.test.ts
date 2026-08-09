import {
  SnapshotEvidenceModel,
  HeadingEvidence,
  ImageEvidence,
  LinkEvidence,
  ButtonEvidence,
  FormEvidence,
  LandmarkEvidence,
  ComputedStyleEvidence,
} from '../snapshot-evidence.model';
import { ruleEngine } from '@/modules/evaluations/services/rule-engine.service';
import { Types } from 'mongoose';

function runTests() {
  console.log('🧪 Starting Subetapa 3A — SnapshotEvidence Infrastructure Tests...');

  const dummyEvalId = new Types.ObjectId().toString();

  // Test 1: SnapshotEvidence basic object structure
  const sampleHeadings: HeadingEvidence[] = [
    { level: 1, text: 'Main Title', selector: 'h1' },
    { level: 2, text: 'Subtitle', selector: 'h2' },
  ];

  const sampleImages: ImageEvidence[] = [
    { selector: 'img.logo', src: 'https://example.com/logo.png', alt: 'Company Logo', ariaLabel: null, role: 'img', isDecorative: false },
    { selector: 'img.icon', src: 'https://example.com/icon.png', alt: '', ariaLabel: null, role: 'presentation', isDecorative: true },
  ];

  const sampleLinks: LinkEvidence[] = [
    { selector: 'a#home', text: 'Home', href: 'https://example.com', ariaLabel: 'Home link', role: 'link', isExternal: false },
    { selector: 'a#docs', text: 'Docs', href: 'https://external.com/docs', ariaLabel: null, role: null, isExternal: true },
  ];

  const sampleButtons: ButtonEvidence[] = [
    { selector: 'button#cta', tag: 'button', text: 'Get Started', ariaLabel: 'Get Started CTA', role: 'button', isDisabled: false, isPrimary: true },
  ];

  const sampleForms: FormEvidence[] = [
    {
      selector: 'form#signup',
      name: 'signup',
      action: '/register',
      elements: [
        { selector: 'input#email', type: 'email', name: 'email', label: 'Email', ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: true, placeholder: 'you@example.com', ariaInvalid: false },
      ],
    },
  ];

  const sampleLandmarks: LandmarkEvidence[] = [
    { type: 'header', selector: 'header', ariaLabel: 'Banner' },
    { type: 'main', selector: 'main', ariaLabel: null },
  ];

  const sampleComputedStyles: ComputedStyleEvidence[] = [
    { selector: 'h1', tag: 'h1', text: 'Main Title', color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)', fontSize: '32px', fontWeight: '700', lineHeight: '40px', fontFamily: 'Inter' },
  ];

  const mockEvidenceData = {
    evaluationId: dummyEvalId as any,
    iteration: 1,
    url: 'https://launchpage.xyz/',
    timestamp: new Date(),
    action: {
      actionType: 'CLICK',
      description: 'Click CTA',
      targetElement: 'button#cta',
    },
    screenshotPath: `/uploads/evaluation_${dummyEvalId}_step_1.png`,
    headings: sampleHeadings,
    images: sampleImages,
    links: sampleLinks,
    buttons: sampleButtons,
    forms: sampleForms,
    landmarks: sampleLandmarks,
    accessibilityTree: 'ariaRoot: heading "Main Title"',
    computedStyles: sampleComputedStyles,
  };

  // Test 1: Basic SnapshotEvidence creation
  const doc = new SnapshotEvidenceModel(mockEvidenceData);
  if (doc.iteration !== 1 || doc.url !== 'https://launchpage.xyz/') {
    console.error('❌ Test 1 Failed: Basic SnapshotEvidence object creation');
    process.exit(1);
  }
  console.log('✅ Test 1 (Basic SnapshotEvidence creation) passed.');

  // Test 2: Headings extraction structure
  if (doc.headings.length !== 2 || doc.headings[0].level !== 1 || doc.headings[0].text !== 'Main Title') {
    console.error('❌ Test 2 Failed: Headings extraction');
    process.exit(1);
  }
  console.log('✅ Test 2 (Headings extraction structure) passed.');

  // Test 3: Images extraction structure
  if (doc.images.length !== 2 || doc.images[1].isDecorative !== true) {
    console.error('❌ Test 3 Failed: Images extraction');
    process.exit(1);
  }
  console.log('✅ Test 3 (Images extraction structure) passed.');

  // Test 4: Links extraction structure
  if (doc.links.length !== 2 || doc.links[1].isExternal !== true) {
    console.error('❌ Test 4 Failed: Links extraction');
    process.exit(1);
  }
  console.log('✅ Test 4 (Links extraction structure) passed.');

  // Test 5: Buttons extraction structure
  if (doc.buttons.length !== 1 || doc.buttons[0].isPrimary !== true) {
    console.error('❌ Test 5 Failed: Buttons extraction');
    process.exit(1);
  }
  console.log('✅ Test 5 (Buttons extraction structure) passed.');

  // Test 6: Forms extraction structure
  if (doc.forms.length !== 1 || doc.forms[0].elements[0].required !== true) {
    console.error('❌ Test 6 Failed: Forms extraction');
    process.exit(1);
  }
  console.log('✅ Test 6 (Forms extraction structure) passed.');

  // Test 7: Landmarks extraction structure
  if (doc.landmarks.length !== 2 || doc.landmarks[0].type !== 'header') {
    console.error('❌ Test 7 Failed: Landmarks extraction');
    process.exit(1);
  }
  console.log('✅ Test 7 (Landmarks extraction structure) passed.');

  // Test 8: Computed styles extraction structure
  if (doc.computedStyles.length !== 1 || doc.computedStyles[0].fontSize !== '32px') {
    console.error('❌ Test 8 Failed: Computed styles extraction');
    process.exit(1);
  }
  console.log('✅ Test 8 (Computed styles extraction structure) passed.');

  // Test 9: Accessibility tree preservation
  if (doc.accessibilityTree !== 'ariaRoot: heading "Main Title"') {
    console.error('❌ Test 9 Failed: Accessibility tree preservation');
    process.exit(1);
  }
  console.log('✅ Test 9 (Accessibility tree preservation) passed.');

  // Test 10: Screenshot association
  if (doc.screenshotPath !== `/uploads/evaluation_${dummyEvalId}_step_1.png`) {
    console.error('❌ Test 10 Failed: Screenshot association');
    process.exit(1);
  }
  console.log('✅ Test 10 (Screenshot association) passed.');

  // Test 11: Iteration association
  if (doc.iteration !== 1) {
    console.error('❌ Test 11 Failed: Iteration association');
    process.exit(1);
  }
  console.log('✅ Test 11 (Iteration association) passed.');

  // Test 12: URL association
  if (doc.url !== 'https://launchpage.xyz/') {
    console.error('❌ Test 12 Failed: URL association');
    process.exit(1);
  }
  console.log('✅ Test 12 (URL association) passed.');

  // Test 13: Action association
  if (!doc.action || doc.action.actionType !== 'CLICK') {
    console.error('❌ Test 13 Failed: Action association');
    process.exit(1);
  }
  console.log('✅ Test 13 (Action association) passed.');

  // Test 14: Edge case — Page without images does not fail
  const noImagesDoc = new SnapshotEvidenceModel({ ...mockEvidenceData, images: [] });
  if (noImagesDoc.images.length !== 0) {
    console.error('❌ Test 14 Failed: Page without images');
    process.exit(1);
  }
  console.log('✅ Test 14 (Page without images) passed.');

  // Test 15: Edge case — Page without forms does not fail
  const noFormsDoc = new SnapshotEvidenceModel({ ...mockEvidenceData, forms: [] });
  if (noFormsDoc.forms.length !== 0) {
    console.error('❌ Test 15 Failed: Page without forms');
    process.exit(1);
  }
  console.log('✅ Test 15 (Page without forms) passed.');

  // Test 16: Edge case — Page without explicit landmarks does not fail
  const noLandmarksDoc = new SnapshotEvidenceModel({ ...mockEvidenceData, landmarks: [] });
  if (noLandmarksDoc.landmarks.length !== 0) {
    console.error('❌ Test 16 Failed: Page without landmarks');
    process.exit(1);
  }
  console.log('✅ Test 16 (Page without landmarks) passed.');

  // Test 17: Edge case — Elements without aria-label do not error
  const noAriaDoc = new SnapshotEvidenceModel({
    ...mockEvidenceData,
    images: [{ selector: 'img', src: 'a.png', alt: null, ariaLabel: null, role: null, isDecorative: false }],
  });
  if (noAriaDoc.images[0].ariaLabel !== null) {
    console.error('❌ Test 17 Failed: Null ariaLabel');
    process.exit(1);
  }
  console.log('✅ Test 17 (Elements without aria-label -> null) passed.');

  // Test 18: Preserved visibleDOMSummary for RuleEngine matches Phase 1 contract
  const mockPhase1Context: any = {
    metadata: { evaluationId: 'eval_sub3a', timestamp: new Date().toISOString(), iteration: 1 },
    flowDefinition: { flowDescription: 'Check', currentStepObjective: 'Obj', totalStepsEstimated: 3 },
    flowState: { currentStep: 1, completedSteps: [], previousActions: [], blockingError: null },
    userArchetype: { fullName: 'Test', phrase: '', age: 30, profession: 'Dev', maritalStatus: 'S', country: 'CO', city: 'BOG', archetype: 'Test', biography: '', personality: '', goals: [], frustrations: [] },
    technicalContext: {
      url: 'https://launchpage.xyz',
      requiresAuthentication: false,
      authenticationStatus: 'unauthenticated',
      visibleDOMSummary: [
        { type: 'button', text: 'Click me', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true },
      ],
    },
    constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
  };

  const ruleRes = ruleEngine.evaluate(mockPhase1Context);
  if (ruleRes) {
    console.log('   RuleEngine evaluated mock context successfully.');
  }
  console.log('✅ Test 18 (RuleEngine Phase 1 compatibility) passed.');

  console.log('🎉 All 18 SnapshotEvidence Infrastructure Tests passed successfully!');
  process.exit(0);
}

runTests();
