import { deterministicAnalyzer } from '../services/deterministic-analyzer.service';
import { buildEvidenceIndex } from '../services/evidence-traceability.service';
import { checkClaimConsistency } from '../services/evidence-claim-consistency.service';

/**
 * Fase I.3.1 — analyzeImages, convención "null" (discrepancia 3) tests.
 * Gemini calls: 0. Todo determinístico, sin mocks de Gemini.
 *
 * Contexto: analyzeImages citaba 'null/missing' (en vez de 'null') para el
 * atributo alt ausente -- una representación no estándar que J6
 * (evidence-claim-consistency.service.ts) nunca reconoce como equivalente a
 * la string "null" que normalizeActualValueForComparison produce para un
 * valor real null/undefined, causando que un finding real y correcto se
 * clasificara como INCONSISTENT. Corregido a 'null' en
 * deterministic-analyzer.service.ts; estas pruebas confirman el valor
 * citado y su coherencia con J6.
 */

function snapshot(overrides: any = {}) {
  return {
    iteration: 1,
    url: 'https://fixture.local/images-test',
    screenshotPath: '/x.png',
    headings: [],
    images: [],
    links: [],
    buttons: [],
    forms: [],
    landmarks: [],
    computedStyles: [],
    ...overrides,
  };
}

function image(overrides: any) {
  return {
    selector: 'img.x', src: '/x.png', alt: null, ariaLabel: null, role: null, isDecorative: false,
    ...overrides,
  };
}

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function findingFor(findings: any[], selector: string) {
  return findings.find((f) => f.affectedElement?.selector === selector && f.wcagCriterion === 'WCAG 1.1.1 Contenido no textual');
}

function runDeterministicImagesTests() {
  console.log('🧪 Starting Fase I.3.1 — analyzeImages (null/missing) tests...\n');

  // Test 1: alt ausente (null) -> FAIL con valor normalizado coherente ("null", no "null/missing")
  {
    const ev = snapshot({ images: [image({ selector: '#img-missing-alt', alt: null })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#img-missing-alt');
    const altItem = f?.evidence?.find((e: any) => e.attribute === 'alt' || e.property === 'alt');
    expect(f?.status === 'FAIL' && altItem?.value === 'null', 'Test 1: alt ausente -> FAIL, evidencia cita value="null" (convención normalizada, no "null/missing").', altItem);
  }

  // Test 1b (Hardening post Gemini Real #1, hallazgo B): analyzeImages ahora
  // cita `property: 'alt'` (contrato canónico), NO `attribute: 'alt'` --
  // confirma la migración, no solo la tolerancia defensiva de arriba.
  {
    const ev = snapshot({ images: [image({ selector: '#img-missing-alt-prop', alt: null })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#img-missing-alt-prop');
    expect(f?.evidence?.[0]?.property === 'alt' && f?.evidence?.[0]?.attribute === undefined, 'Test 1b: analyzeImages cita property="alt" (contrato canónico), ya no attribute.', f?.evidence?.[0]);
  }

  // Test 2: J6 NO marca INCONSISTENT únicamente por la diferencia de representación
  {
    const ev = snapshot({ images: [image({ selector: '#img-missing-alt-2', alt: null })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#img-missing-alt-2');
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [{ selector: '#img-missing-alt-2', src: '/x.png', alt: null, ariaLabel: null, role: null, isDecorative: false } as any], forms: [], computedStyles: [] }],
      dedupedLandmarks: [],
      dedupedLinks: [],
      dedupedButtons: [],
    });
    const r = checkClaimConsistency(f, index);
    expect(r.overallStatus === 'CONSISTENT', 'Test 2: J6 evalúa la evidencia real de analyzeImages (alt=null) -> CONSISTENT, nunca INCONSISTENT por la representación.', r);
  }

  // Test 3: imagen con alt real (no vacío) preserva su valor correctamente (no afectado por el fix)
  {
    const ev = snapshot({ images: [image({ selector: '#img-with-alt', alt: 'Equipo de EvalUXIA trabajando en la oficina' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#img-with-alt');
    const altItem = f?.evidence?.find((e: any) => e.attribute === 'alt' || e.property === 'alt');
    expect(f?.status === 'PASS' && altItem?.value === 'Equipo de EvalUXIA trabajando en la oficina', 'Test 3: imagen con alt real -> PASS, valor real preservado sin alterar.', altItem);
  }

  console.log(`\n🎉 ALL Fase I.3.1 analyzeImages (null/missing) tests passed (${passed} assertions).`);
  process.exit(0);
}

runDeterministicImagesTests();
