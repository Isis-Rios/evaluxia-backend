import {
  V2AuditFindingSchema,
  V2AuditOutputSchema,
} from '@/modules/ai/contracts/ai.contracts';
import { Finding, IFinding } from '../finding.model';
import { Types } from 'mongoose';

function runFindingContractTests() {
  console.log('🧪 Starting Subetapa 3B — Evidence-Based Finding Contracts & Traceability Tests...');

  const dummyEvalId = new Types.ObjectId().toString();

  // Test 1: Valid FAIL finding with evidence and recommendation
  const validFailInput = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    heuristicCode: 'N-01',
    heuristicName: 'Visibilidad del estado del sistema',
    description: 'No existe feedback visual al hacer clic en el botón de procesamiento.',
    evidence: [
      {
        type: 'COMPUTED_STYLE',
        property: 'color',
        value: 'rgb(255, 0, 0)',
        selector: 'button#submit',
      },
    ],
    affectedElement: {
      tag: 'button',
      text: 'Enviar',
      selector: 'button#submit',
      role: 'button',
    },
    impact: 'El usuario cree que el sistema se congeló y vuelve a presionar el botón repetidamente.',
    recommendation: 'Agregar un indicador visual de carga spinner y deshabilitar el botón durante el envío.',
    screenshotUrl: `/uploads/evaluation_${dummyEvalId}_step_1.png`,
  };

  const test1Validation = V2AuditFindingSchema.safeParse(validFailInput);
  if (!test1Validation.success) {
    console.error('❌ Test 1 Failed: Valid FAIL finding rejected:', test1Validation.error.message);
    process.exit(1);
  }
  console.log('✅ Test 1 (Valid FAIL finding with evidence and recommendation) passed.');

  // Test 2: Valid PASS finding with evidence
  const validPassInput = {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'PASS',
    severity: 'info',
    confidence: 'high',
    wcagCriterion: '1.4.3 Contraste (Mínimo)',
    description: 'El texto del título cumple con la relación de contraste mínima de 4.5:1.',
    evidence: [
      {
        type: 'COMPUTED_STYLE',
        property: 'color',
        value: 'rgb(17, 24, 39)',
        selector: 'h1',
        relatedValue: { property: 'backgroundColor', value: 'rgb(255, 255, 255)' },
      },
    ],
    recommendation: null,
  };

  const test2Validation = V2AuditFindingSchema.safeParse(validPassInput);
  if (!test2Validation.success) {
    console.error('❌ Test 2 Failed: Valid PASS finding rejected:', test2Validation.error.message);
    process.exit(1);
  }
  console.log('✅ Test 2 (Valid PASS finding with evidence) passed.');

  // Test 3: Valid NOT_EVALUABLE finding
  const validNotEvaluableInput = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'NOT_EVALUABLE',
    severity: 'info',
    confidence: 'low',
    heuristicCode: 'N-05',
    heuristicName: 'Prevención de errores',
    description: 'No se observaron formularios ni entradas de usuario en esta iteración para auditar prevención de errores.',
    evidence: [],
    recommendation: null,
  };

  const test3Validation = V2AuditFindingSchema.safeParse(validNotEvaluableInput);
  if (!test3Validation.success) {
    console.error('❌ Test 3 Failed: Valid NOT_EVALUABLE finding rejected:', test3Validation.error.message);
    process.exit(1);
  }
  console.log('✅ Test 3 (Valid NOT_EVALUABLE finding) passed.');

  // Test 4: FAIL without evidence -> reject
  const failWithoutEvidence = {
    ...validFailInput,
    evidence: [],
  };
  const test4Validation = V2AuditFindingSchema.safeParse(failWithoutEvidence);
  if (test4Validation.success) {
    console.error('❌ Test 4 Failed: FAIL without evidence incorrectly passed!');
    process.exit(1);
  }
  console.log('✅ Test 4 (FAIL without evidence -> reject) passed.');

  // Test 5: FAIL without recommendation -> reject
  const failWithoutRecommendation = {
    ...validFailInput,
    recommendation: '',
  };
  const test5Validation = V2AuditFindingSchema.safeParse(failWithoutRecommendation);
  if (test5Validation.success) {
    console.error('❌ Test 5 Failed: FAIL without recommendation incorrectly passed!');
    process.exit(1);
  }
  console.log('✅ Test 5 (FAIL without recommendation -> reject) passed.');

  // Test 6: FAIL without confidence -> default to high
  const failWithoutConfidence = {
    ...validFailInput,
  };
  delete (failWithoutConfidence as any).confidence;
  const test6Validation = V2AuditFindingSchema.safeParse(failWithoutConfidence);
  if (!test6Validation.success || test6Validation.data.confidence !== 'high') {
    console.error('❌ Test 6 Failed: Missing confidence failed to default to high');
    process.exit(1);
  }
  console.log('✅ Test 6 (FAIL without confidence -> default high) passed.');

  // Test 7: Invalid status -> reject
  const invalidStatus = {
    ...validFailInput,
    status: 'UNKNOWN_STATUS',
  };
  const test7Validation = V2AuditFindingSchema.safeParse(invalidStatus);
  if (test7Validation.success) {
    console.error('❌ Test 7 Failed: Invalid status incorrectly passed!');
    process.exit(1);
  }
  console.log('✅ Test 7 (Invalid status -> reject) passed.');

  // Test 8: Invalid confidence -> reject
  const invalidConfidence = {
    ...validFailInput,
    confidence: 'EXTREME',
  };
  const test8Validation = V2AuditFindingSchema.safeParse(invalidConfidence);
  if (test8Validation.success) {
    console.error('❌ Test 8 Failed: Invalid confidence incorrectly passed!');
    process.exit(1);
  }
  console.log('✅ Test 8 (Invalid confidence -> reject) passed.');

  // Test 9: heuristicCode separated from heuristicName
  if (test1Validation.data.heuristicCode !== 'N-01' || test1Validation.data.heuristicName !== 'Visibilidad del estado del sistema') {
    console.error('❌ Test 9 Failed: heuristicCode and heuristicName not properly separated');
    process.exit(1);
  }
  console.log('✅ Test 9 (heuristicCode separated from heuristicName) passed.');

  // Test 10: recommendation separated from heuristicName (reject if identical)
  const recommendationEqualsName = {
    ...validFailInput,
    recommendation: 'Visibilidad del estado del sistema',
  };
  const test10Validation = V2AuditFindingSchema.safeParse(recommendationEqualsName);
  if (test10Validation.success) {
    console.error('❌ Test 10 Failed: Recommendation identical to heuristicName passed!');
    process.exit(1);
  }
  console.log('✅ Test 10 (recommendation separated from heuristicName -> reject identical) passed.');

  // Test 11: recommendation separated from heuristicCode (reject if identical)
  const recommendationEqualsCode = {
    ...validFailInput,
    recommendation: 'N-01',
  };
  const test11Validation = V2AuditFindingSchema.safeParse(recommendationEqualsCode);
  if (test11Validation.success) {
    console.error('❌ Test 11 Failed: Recommendation identical to heuristicCode passed!');
    process.exit(1);
  }
  console.log('✅ Test 11 (recommendation separated from heuristicCode -> reject identical) passed.');

  // Test 12: wcagCriterion separated from recommendation
  const wcagFinding = {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    wcagCriterion: '1.4.3 Contraste (Mínimo)',
    description: 'El botón secundario tiene un ratio de contraste de 2.1:1.',
    evidence: [{ type: 'COMPUTED_STYLE', property: 'color', value: 'rgb(200, 200, 200)' }],
    recommendation: 'Aumentar la oscuridad del texto del botón a rgb(50, 50, 50) para lograr un ratio mínimo de 4.5:1.',
  };
  const test12Validation = V2AuditFindingSchema.safeParse(wcagFinding);
  if (!test12Validation.success || test12Validation.data.wcagCriterion !== '1.4.3 Contraste (Mínimo)') {
    console.error('❌ Test 12 Failed: wcagCriterion not separated');
    process.exit(1);
  }
  console.log('✅ Test 12 (wcagCriterion separated from recommendation) passed.');

  // Test 13: AffectedElement valid structure
  if (!test1Validation.data.affectedElement || test1Validation.data.affectedElement.selector !== 'button#submit') {
    console.error('❌ Test 13 Failed: affectedElement invalid');
    process.exit(1);
  }
  console.log('✅ Test 13 (AffectedElement valid structure) passed.');

  // Test 14: Screenshot traceable via iteration / screenshotUrl
  if (test1Validation.data.screenshotUrl !== `/uploads/evaluation_${dummyEvalId}_step_1.png`) {
    console.error('❌ Test 14 Failed: screenshotUrl traceability');
    process.exit(1);
  }
  console.log('✅ Test 14 (Screenshot traceable via iteration/path) passed.');

  // Test 15: evidence COMPUTED_STYLE valid
  const styleEvidence = test1Validation.data.evidence[0];
  if (styleEvidence.type !== 'COMPUTED_STYLE' || styleEvidence.property !== 'color') {
    console.error('❌ Test 15 Failed: COMPUTED_STYLE evidence');
    process.exit(1);
  }
  console.log('✅ Test 15 (evidence COMPUTED_STYLE valid) passed.');

  // Test 16: evidence DOM_ATTRIBUTE valid
  const attrFinding = {
    ...validFailInput,
    evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: 'missing', selector: 'img.hero' }],
  };
  const test16Validation = V2AuditFindingSchema.safeParse(attrFinding);
  if (!test16Validation.success || test16Validation.data.evidence[0].type !== 'DOM_ATTRIBUTE') {
    console.error('❌ Test 16 Failed: DOM_ATTRIBUTE evidence');
    process.exit(1);
  }
  console.log('✅ Test 16 (evidence DOM_ATTRIBUTE valid) passed.');

  // Test 17: evidence ACCESSIBILITY_TREE valid
  const treeFinding = {
    ...validFailInput,
    evidence: [{ type: 'ACCESSIBILITY_TREE', context: 'button "Submit" [disabled=true]' }],
  };
  const test17Validation = V2AuditFindingSchema.safeParse(treeFinding);
  if (!test17Validation.success || test17Validation.data.evidence[0].type !== 'ACCESSIBILITY_TREE') {
    console.error('❌ Test 17 Failed: ACCESSIBILITY_TREE evidence');
    process.exit(1);
  }
  console.log('✅ Test 17 (evidence ACCESSIBILITY_TREE valid) passed.');

  // Test 18: evidence SCREENSHOT valid
  const screenshotFinding = {
    ...validFailInput,
    evidence: [{ type: 'SCREENSHOT', value: `/uploads/step_1.png`, selector: 'div.hero' }],
  };
  const test18Validation = V2AuditFindingSchema.safeParse(screenshotFinding);
  if (!test18Validation.success || test18Validation.data.evidence[0].type !== 'SCREENSHOT') {
    console.error('❌ Test 18 Failed: SCREENSHOT evidence');
    process.exit(1);
  }
  console.log('✅ Test 18 (evidence SCREENSHOT valid) passed.');

  // Test 19: Legacy finding retrocompatibility (Mongoose model instantiation with missing status)
  const legacyFindingData: Partial<IFinding> = {
    evaluationId: new Types.ObjectId(dummyEvalId),
    iteration: 1,
    findingGroup: 'ux',
    type: 'usability',
    severity: 'medium',
    description: 'Legacy finding without status',
    heuristic: 'N-01: Visibilidad del estado del sistema',
  };
  const legacyDoc = new Finding(legacyFindingData);
  if (legacyDoc.status !== 'FAIL' || legacyDoc.confidence !== 'high') {
    console.error('❌ Test 19 Failed: Legacy finding did not apply default status/confidence');
    process.exit(1);
  }
  console.log('✅ Test 19 (Legacy finding retrocompatibility) passed.');

  // Test 20: NOT_EVALUABLE status does not equal FAIL
  const notEvalDoc = new Finding({
    evaluationId: new Types.ObjectId(dummyEvalId),
    iteration: 1,
    findingGroup: 'ux',
    status: 'NOT_EVALUABLE',
    severity: 'info',
    confidence: 'low',
    description: 'Unchecked heuristic',
  });
  if (notEvalDoc.status === 'FAIL' || notEvalDoc.status !== 'NOT_EVALUABLE') {
    console.error('❌ Test 20 Failed: NOT_EVALUABLE equals FAIL');
    process.exit(1);
  }
  console.log('✅ Test 20 (NOT_EVALUABLE status does not equal FAIL) passed.');

  // Test V2AuditOutputSchema full payload validation
  const auditOutputPayload = {
    overallScore: 85,
    executiveSummary: '# Executive Summary\nGood overall UX...',
    findings: [validFailInput, validPassInput, validNotEvaluableInput],
  };
  const fullAuditValidation = V2AuditOutputSchema.safeParse(auditOutputPayload);
  if (!fullAuditValidation.success) {
    console.error('❌ Full V2AuditOutputSchema payload validation failed:', fullAuditValidation.error.message);
    process.exit(1);
  }
  console.log('✅ V2AuditOutputSchema full payload validation passed.');

  console.log('🎉 All 20 Evidence-Based Finding Contract Tests passed successfully!');
  process.exit(0);
}

runFindingContractTests();
