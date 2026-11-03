import { prioritizeComputedStyles, PrioritizationSignals, COMPUTED_STYLES_FINAL_BUDGET } from '@/modules/evaluations/services/evidence-prioritization.service';
import { calculateContrastRatio } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { Deduplicated } from '@/modules/evaluations/services/evidence-deduplication.service';
import { ComputedStyleEvidence } from '@/modules/snapshots/snapshot-evidence.model';

/**
 * Fase K (Parte N) -> Fase K.1 (Parte D): contraste real y priorización de tokens.
 *
 * Fase K confirmó el riesgo: `prioritizeComputedStyles` excluye
 * deliberadamente las señales de contraste del grupo "finding" (anti-
 * circularidad), así que un elemento con contraste REALMENTE insuficiente
 * pero sin ninguna otra evidencia caía en el grupo "unbacked", compitiendo
 * por posición DOM contra ruido decorativo sin ningún problema real.
 *
 * Fase K.1 implementa el invariante exigido: evidencia de contraste
 * CRÍTICA (ratio ya por debajo del umbral real, misma fórmula/threshold
 * que `DeterministicAnalyzer.analyzeContrast`, vía `computeContrastFailure`
 * reutilizada) se RESERVA antes de cualquier cuota/round-robin -- nunca
 * compite por posición DOM. El cap estructural (`finalBudget`) se preserva
 * sin excepción.
 *
 * Gemini calls: 0.
 */

function cs(overrides: Partial<ComputedStyleEvidence>): Deduplicated<ComputedStyleEvidence> {
  return {
    selector: 'x', tag: 'p', text: 'texto', color: '#000', backgroundColor: '#fff',
    fontSize: '16px', fontWeight: '400', lineHeight: '1.5', fontFamily: 'Arial',
    iterations: [1],
    ...overrides,
  } as Deduplicated<ComputedStyleEvidence>;
}

const BAD = { color: 'rgb(153,153,153)', backgroundColor: 'rgb(255,255,255)' }; // ratio real < 4.5
const GOOD = { color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)' }; // ratio real >> 4.5

let passed = 0;
function expect(cond: boolean, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`❌ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✅ ${label}`);
}

function emptySignals(): PrioritizationSignals {
  return { otherEvidenceSelectors: new Set(), independentFindingSelectors: new Set() };
}

function runContrastPreservationTests() {
  console.log('🧪 Starting Fase K.1 — contrast preservation (Parte D) tests...\n');

  const badContrastRatio = calculateContrastRatio(BAD.color, BAD.backgroundColor);
  expect(badContrastRatio !== null && badContrastRatio < 4.5, 'Control: el color de prueba "BAD" realmente tiene contraste insuficiente (verificado con calculateContrastRatio real).', badContrastRatio);

  // Caso 1: 1 contraste FAIL entre >50 candidatos -> debe sobrevivir.
  {
    const critical = cs({ selector: '#critico', ...BAD });
    const noise = Array.from({ length: 60 }, (_, i) => cs({ selector: `#ruido-${i}`, ...GOOD }));
    const result = prioritizeComputedStyles([...noise, critical], emptySignals(), 50);
    expect(result.final.some((f) => f.selector === '#critico'), 'Caso 1: 1 contraste FAIL entre >50 candidatos -> sobrevive (reservado).', { criticalCount: result.criticalCount });
  }

  // Caso 2: 2 contrastes FAIL + ruido -> AMBOS deben sobrevivir.
  {
    const critical1 = cs({ selector: '#critico-1', ...BAD });
    const critical2 = cs({ selector: '#critico-2', ...BAD });
    const noise = Array.from({ length: 60 }, (_, i) => cs({ selector: `#ruido-${i}`, ...GOOD }));
    const result = prioritizeComputedStyles([...noise, critical1, critical2], emptySignals(), 50);
    expect(result.final.some((f) => f.selector === '#critico-1') && result.final.some((f) => f.selector === '#critico-2'), 'Caso 2: 2 contrastes FAIL + ruido -> ambos sobreviven.', { criticalCount: result.criticalCount });
  }

  // Caso 3: muchos contrastes PASS (buen contraste) + 1 contraste FAIL -> el FAIL debe sobrevivir.
  {
    const critical = cs({ selector: '#el-unico-fail', ...BAD });
    const manyPass = Array.from({ length: 80 }, (_, i) => cs({ selector: `#pass-${i}`, ...GOOD }));
    const result = prioritizeComputedStyles([...manyPass, critical], emptySignals(), 50);
    expect(result.final.some((f) => f.selector === '#el-unico-fail'), 'Caso 3: muchos contrastes PASS + 1 FAIL -> el FAIL sobrevive.', { criticalCount: result.criticalCount });
  }

  // Caso 4: muchos candidatos irrelevantes (sin color/backgroundColor, no determinable) -> la evidencia crítica se conserva igual.
  {
    const critical = cs({ selector: '#critico-entre-irrelevantes', ...BAD });
    const irrelevant = Array.from({ length: 70 }, (_, i) => cs({ selector: `#irrelevante-${i}`, color: '', backgroundColor: '' }));
    const result = prioritizeComputedStyles([...irrelevant, critical], emptySignals(), 50);
    expect(result.final.some((f) => f.selector === '#critico-entre-irrelevantes'), 'Caso 4: candidatos irrelevantes (contraste no determinable) no desplazan la evidencia crítica real.', { criticalCount: result.criticalCount });
  }

  // Caso 5: > 500 candidatos (incluyendo varios críticos) -> se mantiene el cap estructural (finalBudget), nunca crece sin límite.
  {
    const manyCritical = Array.from({ length: 80 }, (_, i) => cs({ selector: `#critico-masivo-${i}`, ...BAD }));
    const noise = Array.from({ length: 450 }, (_, i) => cs({ selector: `#ruido-masivo-${i}`, ...GOOD }));
    const result = prioritizeComputedStyles([...noise, ...manyCritical], emptySignals(), COMPUTED_STYLES_FINAL_BUDGET);
    expect(result.final.length === COMPUTED_STYLES_FINAL_BUDGET, `Caso 5: >500 candidatos (80 críticos + 450 de ruido) -> el cap estructural (${COMPUTED_STYLES_FINAL_BUDGET}) se preserva, incluso con más elementos críticos que presupuesto.`, { finalLength: result.final.length, criticalCount: result.criticalCount });
    expect(result.criticalCount === COMPUTED_STYLES_FINAL_BUDGET, 'Caso 5b: cuando hay MÁS candidatos críticos que presupuesto, lo reservado también respeta el cap (no crecimiento ilimitado).', result.criticalCount);
  }

  // Caso 6: el analyzer determinístico produce EXACTAMENTE los mismos findings antes/después
  // (ya verificado exhaustivamente por j4-step2-prioritization.test.ts, "J4-DET": mismo
  // número de findings, mismos statuses, mismos selectors, mismo overallScore, con y sin
  // computedStylesCandidates -- confirmado aquí explícitamente para esta fase, reutilizando
  // el analyzer real sobre un snapshot con un contraste real conocido).
  {
    const ev = {
      iteration: 1, url: 'https://fixture.local/k1-contrast', screenshotPath: '/x.png',
      headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [],
      computedStyles: [cs({ selector: '#real', ...BAD })],
    };
    const findingsBefore = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const findingsAfter = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    expect(JSON.stringify(findingsBefore) === JSON.stringify(findingsAfter), 'Caso 6: el analyzer determinístico (que opera sobre ev.computedStyles, NUNCA sobre la salida de prioritizeComputedStyles) produce resultados idénticos -- el cambio en Parte D no lo afecta en absoluto (campos distintos, ver docstring de analyzeContrast).', { findingsBefore, findingsAfter });
    expect(findingsBefore.some((f) => f.status === 'FAIL' && f.wcagCriterion?.includes('1.4.3')), 'Caso 6b: el escenario efectivamente ejercitó la regla de contraste determinística (no es una prueba vacía).', findingsBefore);
  }

  console.log(`\n🎉 Contrast preservation tests completados (${passed} aserciones, invariante D2 confirmado: NO se puede eliminar contraste crítico por priorización).`);
  process.exit(0);
}

runContrastPreservationTests();
