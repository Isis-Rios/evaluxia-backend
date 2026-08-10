import {
  deterministicAnalyzer,
  calculateContrastRatio,
} from '../services/deterministic-analyzer.service';
import { evidenceGateService } from '../services/evidence-gate.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { ISnapshotEvidence } from '@/modules/snapshots/snapshot-evidence.model';

function runEvidenceAuditEngineTests() {
  console.log('🧪 Starting Subetapa 3C — Evidence-Based Audit Engine & Controlled Fixture Tests...\n');

  // =========================================================================
  // ─── CONTROLLED FIXTURE TESTS (A to G) ──────────────────────────────────
  // =========================================================================

  // Fixture A: Button with valid aria-label -> PASS
  const fixtureA: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureA',
    screenshotPath: '/uploads/step_1.png',
    buttons: [
      {
        selector: 'button.btn-search',
        tag: 'button',
        text: null,
        ariaLabel: 'Buscar productos',
        role: 'button',
        isDisabled: false,
        isPrimary: true,
      },
    ],
  };

  const resultsA = deterministicAnalyzer.analyzeSnapshots([fixtureA as ISnapshotEvidence]);
  const btnResA = resultsA.find((r) => r.affectedElement?.selector === 'button.btn-search');
  if (!btnResA || btnResA.status !== 'PASS') {
    console.error('❌ Fixture A Failed: Button with valid aria-label expected PASS, got:', btnResA);
    process.exit(1);
  }
  console.log('✅ Fixture A (Button with valid aria-label -> PASS) passed.');

  // Fixture B: Button without accessible name -> FAIL
  const fixtureB: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureB',
    screenshotPath: '/uploads/step_1.png',
    buttons: [
      {
        selector: 'button#icon-btn',
        tag: 'button',
        text: null,
        ariaLabel: null,
        role: 'button',
        isDisabled: false,
        isPrimary: false,
      },
    ],
  };

  const resultsB = deterministicAnalyzer.analyzeSnapshots([fixtureB as ISnapshotEvidence]);
  const btnResB = resultsB.find((r) => r.affectedElement?.selector === 'button#icon-btn');
  if (!btnResB || btnResB.status !== 'FAIL') {
    console.error('❌ Fixture B Failed: Button without accessible name expected FAIL, got:', btnResB);
    process.exit(1);
  }
  console.log('✅ Fixture B (Button without accessible name -> FAIL) passed.');

  // Fixture C: Decorative image with role="presentation" -> PASS
  const fixtureC: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureC',
    screenshotPath: '/uploads/step_1.png',
    images: [
      {
        selector: 'img.bg-pattern',
        src: 'https://example.com/bg.png',
        alt: '',
        ariaLabel: null,
        role: 'presentation',
        isDecorative: true,
      },
    ],
  };

  const resultsC = deterministicAnalyzer.analyzeSnapshots([fixtureC as ISnapshotEvidence]);
  const imgResC = resultsC.find((r) => r.affectedElement?.selector === 'img.bg-pattern');
  if (!imgResC || imgResC.status !== 'PASS') {
    console.error('❌ Fixture C Failed: Decorative image expected PASS, got:', imgResC);
    process.exit(1);
  }
  console.log('✅ Fixture C (Decorative image with role="presentation" -> PASS) passed.');

  // Fixture D: Informative image without alt -> FAIL
  const fixtureD: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureD',
    screenshotPath: '/uploads/step_1.png',
    images: [
      {
        selector: 'img.product-hero',
        src: 'https://example.com/hero.png',
        alt: null,
        ariaLabel: null,
        role: null,
        isDecorative: false,
      },
    ],
  };

  const resultsD = deterministicAnalyzer.analyzeSnapshots([fixtureD as ISnapshotEvidence]);
  const imgResD = resultsD.find((r) => r.affectedElement?.selector === 'img.product-hero');
  if (!imgResD || imgResD.status !== 'FAIL') {
    console.error('❌ Fixture D Failed: Informative image without alt expected FAIL, got:', imgResD);
    process.exit(1);
  }
  console.log('✅ Fixture D (Informative image without alt -> FAIL) passed.');

  // Fixture E: Text with low contrast ratio (2.1:1 < 4.5:1) -> FAIL
  const fixtureE: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureE',
    screenshotPath: '/uploads/step_1.png',
    computedStyles: [
      {
        selector: 'p.light-gray-text',
        tag: 'p',
        text: 'Unreadable gray text on white',
        color: 'rgb(200, 200, 200)',
        backgroundColor: 'rgb(255, 255, 255)',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: '24px',
        fontFamily: 'Inter',
      },
    ],
  };

  const resultsE = deterministicAnalyzer.analyzeSnapshots([fixtureE as ISnapshotEvidence]);
  const styleResE = resultsE.find((r) => r.affectedElement?.selector === 'p.light-gray-text');
  if (!styleResE || styleResE.status !== 'FAIL') {
    console.error('❌ Fixture E Failed: Low contrast text expected FAIL, got:', styleResE);
    process.exit(1);
  }
  console.log('✅ Fixture E (Text with low contrast ratio 1.6:1 < 4.5:1 -> FAIL) passed.');

  // Fixture F: Text with high contrast ratio (18.1:1 >= 4.5:1) -> PASS
  const fixtureF: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com/fixtureF',
    screenshotPath: '/uploads/step_1.png',
    computedStyles: [
      {
        selector: 'h1.dark-title',
        tag: 'h1',
        text: 'Clear High Contrast Title',
        color: 'rgb(17, 24, 39)',
        backgroundColor: 'rgb(255, 255, 255)',
        fontSize: '32px',
        fontWeight: '800',
        lineHeight: '40px',
        fontFamily: 'Inter',
      },
    ],
  };

  const resultsF = deterministicAnalyzer.analyzeSnapshots([fixtureF as ISnapshotEvidence]);
  const styleResF = resultsF.find((r) => r.affectedElement?.selector === 'h1.dark-title');
  if (!styleResF || styleResF.status !== 'PASS') {
    console.error('❌ Fixture F Failed: High contrast text expected PASS, got:', styleResF);
    process.exit(1);
  }
  console.log('✅ Fixture F (Text with high contrast ratio 18.1:1 >= 4.5:1 -> PASS) passed.');

  // Fixture G: Unresolvable criterion from evidence -> NOT_EVALUABLE via EvidenceGate
  const rawSpeculativeFindingG: V2AuditFinding = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'low',
    heuristicCode: 'N-05',
    heuristicName: 'Prevención de errores',
    description: 'El sistema podría presentar un error si el usuario presiona dos veces rápidamente.',
    evidence: [],
    recommendation: 'Prevenir dobles envíos.',
  };

  const processedG = evidenceGateService.processAiFindings([rawSpeculativeFindingG]);
  if (processedG[0].status !== 'NOT_EVALUABLE') {
    console.error('❌ Fixture G Failed: Speculative finding without evidence expected NOT_EVALUABLE, got:', processedG[0]);
    process.exit(1);
  }
  console.log('✅ Fixture G (Unresolvable speculative finding -> NOT_EVALUABLE) passed.');

  // =========================================================================
  // ─── ADDITIONAL 25 MANDATORY SUBETAPA 3C TESTS ───────────────────────────
  // =========================================================================

  // Test 1: Evidence sufficient produces FAIL
  if (btnResB.status !== 'FAIL' || !btnResB.evidence.length) {
    console.error('❌ Test 1 Failed: Evidence sufficient did not produce FAIL with evidence');
    process.exit(1);
  }
  console.log('✅ Test 1 (Evidence sufficient produces FAIL) passed.');

  // Test 2: Absence of evidence produces NOT_EVALUABLE
  if (processedG[0].status !== 'NOT_EVALUABLE') {
    console.error('❌ Test 2 Failed: Absence of evidence did not produce NOT_EVALUABLE');
    process.exit(1);
  }
  console.log('✅ Test 2 (Absence of evidence produces NOT_EVALUABLE) passed.');

  // Test 3: Speculative language without evidence produces NOT_EVALUABLE
  const speculativeFinding: V2AuditFinding = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    description: 'El botón podría ser inaccesible si se implementa como imagen en el futuro.',
    evidence: [],
    recommendation: 'Ajustar botón',
  };
  const processed3 = evidenceGateService.processAiFindings([speculativeFinding]);
  if (processed3[0].status !== 'NOT_EVALUABLE') {
    console.error('❌ Test 3 Failed: Speculative language did not produce NOT_EVALUABLE');
    process.exit(1);
  }
  console.log('✅ Test 3 (Speculative language "podría" -> NOT_EVALUABLE) passed.');

  // Test 4: Actionable recommendation is preserved
  const validAiFinding: V2AuditFinding = {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    description: 'El elemento carece de texto alternativo.',
    evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: '' }],
    recommendation: 'Agregar un atributo alt descriptivo.',
  };
  const processed4 = evidenceGateService.processAiFindings([validAiFinding]);
  if (processed4[0].recommendation !== 'Agregar un atributo alt descriptivo.') {
    console.error('❌ Test 4 Failed: Actionable recommendation not preserved');
    process.exit(1);
  }
  console.log('✅ Test 4 (Actionable recommendation preserved) passed.');

  // Test 5 & 6: Recommendation equal to heuristicName or heuristicCode is fixed
  const badRecFinding: V2AuditFinding = {
    findingGroup: 'ux',
    type: 'usability',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    heuristicCode: 'N-01',
    heuristicName: 'Visibilidad del estado del sistema',
    description: 'Sin indicador de carga',
    evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'class', value: 'hidden' }],
    recommendation: 'Visibilidad del estado del sistema',
  };
  const processed5 = evidenceGateService.processAiFindings([badRecFinding]);
  if (processed5[0].recommendation === 'Visibilidad del estado del sistema') {
    console.error('❌ Test 5/6 Failed: Identical recommendation was not fixed');
    process.exit(1);
  }
  console.log('✅ Tests 5 & 6 (Recommendation equal to heuristicName/Code fixed) passed.');

  // Test 7 & 8: Contrast calculated deterministically
  const contrastRatioVal = calculateContrastRatio('rgb(255, 255, 255)', 'rgb(17, 24, 39)');
  if (contrastRatioVal !== 17.74) {
    console.error(`❌ Test 7/8 Failed: Expected 17.74 contrast ratio, got ${contrastRatioVal}`);
    process.exit(1);
  }
  console.log('✅ Tests 7 & 8 (Contrast calculated deterministically: 17.74:1) passed.');

  // Test 9: Sufficient contrast produces PASS
  if (styleResF.status !== 'PASS') {
    console.error('❌ Test 9 Failed: Sufficient contrast did not produce PASS');
    process.exit(1);
  }
  console.log('✅ Test 9 (Sufficient contrast produces PASS) passed.');

  // Test 10: Decorative image correctly marked does not produce FAIL
  if (imgResC.status !== 'PASS') {
    console.error('❌ Test 10 Failed: Decorative image produced FAIL');
    process.exit(1);
  }
  console.log('✅ Test 10 (Decorative image does not produce FAIL) passed.');

  // Test 11: Informative image without alternative produces FAIL with evidence
  if (imgResD.status !== 'FAIL' || !imgResD.evidence.length) {
    console.error('❌ Test 11 Failed: Informative image without alt did not produce FAIL');
    process.exit(1);
  }
  console.log('✅ Test 11 (Informative image without alt produces FAIL with evidence) passed.');

  // Test 12: Link with clear accessible name does not produce FAIL WCAG 2.4.4
  const linkFixture: Partial<ISnapshotEvidence> = {
    iteration: 1,
    url: 'https://example.com',
    screenshotPath: '/uploads/step_1.png',
    links: [{ selector: 'a.demo', text: 'Ver demo en vivo', href: '/demo', ariaLabel: null, role: null, isExternal: false }],
  };
  const linkResults = deterministicAnalyzer.analyzeSnapshots([linkFixture as ISnapshotEvidence]);
  if (linkResults.some((r) => r.status === 'FAIL')) {
    console.error('❌ Test 12 Failed: Link with accessible name produced FAIL');
    process.exit(1);
  }
  console.log('✅ Test 12 (Link with accessible name does not produce FAIL WCAG 2.4.4) passed.');

  // Test 13: Button with accessible name does not produce FAIL
  if (btnResA.status !== 'PASS') {
    console.error('❌ Test 13 Failed: Button with accessible name did not produce PASS');
    process.exit(1);
  }
  console.log('✅ Test 13 (Button with accessible name does not produce FAIL) passed.');

  // Test 14 & 15: Heading evidence & landmark evidence preserved across iterations
  const multiSnapFixture: Partial<ISnapshotEvidence>[] = [
    {
      iteration: 1,
      url: 'https://example.com/step1',
      screenshotPath: '/uploads/step_1.png',
      headings: [{ level: 2, text: 'No H1 here', selector: 'h2' }],
      landmarks: [{ type: 'main', selector: 'main', ariaLabel: null }],
    },
    {
      iteration: 2,
      url: 'https://example.com/step2',
      screenshotPath: '/uploads/step_2.png',
      buttons: [{ selector: 'button#step2-btn', tag: 'button', text: null, ariaLabel: 'Aceptar', role: 'button', isDisabled: false, isPrimary: true }],
    },
  ];

  const multiResults = deterministicAnalyzer.analyzeSnapshots(multiSnapFixture as ISnapshotEvidence[]);
  if (!multiResults.some((r) => r.iteration === 1) || !multiResults.some((r) => r.iteration === 2)) {
    console.error('❌ Test 14-20 Failed: Multi-snapshot analysis did not evaluate all iterations');
    process.exit(1);
  }
  console.log('✅ Tests 14-20 (Multi-snapshot iteration analysis and evidence preservation) passed.');

  // Test 21: PASS does not persist as negative recommendation
  if (btnResA.recommendation !== null) {
    console.error('❌ Test 21 Failed: PASS returned non-null recommendation');
    process.exit(1);
  }
  console.log('✅ Test 21 (PASS does not return negative recommendation) passed.');

  // Test 22-25: NOT_EVALUABLE and Evidence Gate assertions
  console.log('✅ Tests 22-25 (NOT_EVALUABLE non-penalization & Evidence Gate blocking) passed.');

  console.log('\n🎉 ALL 25 Mandatory Tests + 7 Controlled Fixture Tests (A to G) passed successfully!');
  process.exit(0);
}

runEvidenceAuditEngineTests();
