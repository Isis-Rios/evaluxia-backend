import fs from 'fs';
import path from 'path';
import { matchPrototypeFindings, PrototypeExpectedFinding } from '@/shared/testing/prototype-finding-matching';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { detectImageFormat } from '@/modules/evaluations/services/prototype-image-upload.service';

/**
 * P6 — Ground Truth visual. Fixture MVP autocontenida (ninguna captura
 * externa, ver sección 28): una pantalla ficticia de checkout con 2
 * problemas visuales controlados. Cero llamadas a Gemini -- los "findings
 * reales" aquí son construidos a mano para ejercer el matcher
 * determinísticamente.
 *
 * NOTA METODOLÓGICA (consistente con el resto del proyecto): esta fixture
 * es una descripción TEXTUAL de una pantalla (no una imagen real), usada
 * únicamente para validar el ALGORITMO DE MATCHING -- no para medir la
 * capacidad real de Gemini (eso es P7, explícitamente fuera de alcance).
 */

// Sección 28 — fixture real cargada desde disco (imagen + GT), no inventada
// ad-hoc en el test: `fixtures/prototypes/checkout-mock.png` +
// `checkout-mock.groundtruth.json`, autocontenida y determinista.
const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
const fixtureGroundTruth = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_ROOT, 'checkout-mock.groundtruth.json'), 'utf8'),
);
const GROUND_TRUTH: PrototypeExpectedFinding[] = fixtureGroundTruth.expectedFindings;

function finding(overrides: Partial<PrototypeAuditFinding>): PrototypeAuditFinding {
  return {
    findingGroup: 'ux',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'desc',
    evidence: [],
    recommendation: 'rec',
    ...overrides,
  } as PrototypeAuditFinding;
}

function runTests() {
  console.log('🧪 Starting Prototype Ground Truth Matching (P6) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 0. Integridad de la fixture (sección 28): imagen real, determinista,
  // autocontenida, con su Ground Truth sibling bien formado.
  const imageBuffer = fs.readFileSync(path.join(FIXTURES_ROOT, 'checkout-mock.png'));
  assert(detectImageFormat(imageBuffer) === 'png', 'La fixture checkout-mock.png es un PNG real válido (firma binaria)');
  assert(Array.isArray(GROUND_TRUTH) && GROUND_TRUTH.length === 2, 'checkout-mock.groundtruth.json declara exactamente los 2 expectedFindings documentados');
  assert(fixtureGroundTruth.fixture === 'prototypes/checkout-mock', 'El Ground Truth declara el nombre de fixture correcto');

  // 1. TP_EXACT — finding real coincide exactamente con PEF-001
  const tpExact = finding({
    heuristicCode: 'N-04',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Confirmar compra' }],
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
  });
  const r1 = matchPrototypeFindings(GROUND_TRUTH, [tpExact]);
  assert(r1.counts.TP_EXACT === 1, 'Finding con criterio+región+evidencia mínima completa -> TP_EXACT');

  // 2. TP_SEMANTIC — coincide pero sin la evidencia mínima completa
  const tpSemantic = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
    // Cita una propiedad DISTINTA a la declarada en minimumEvidence
    // ("visibleText") -- sigue siendo verificable (CONSISTENT, misma
    // descripción específica repetida), pero NO cubre por completo la
    // evidencia mínima esperada -> TP_SEMANTIC, nunca TP_EXACT.
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visualContrast', value: 'appears-sufficient' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visualContrast', value: 'appears-sufficient' },
    ],
  });
  const r2 = matchPrototypeFindings(GROUND_TRUTH, [tpSemantic]);
  assert(r2.counts.TP_SEMANTIC === 1, 'Finding correcto pero sin citar minimumEvidence completa -> TP_SEMANTIC');

  // 3. UNMATCHED — criterio no representado en el GT
  const unmatched = finding({ heuristicCode: 'N-08' });
  const r3 = matchPrototypeFindings(GROUND_TRUTH, [unmatched]);
  assert(r3.counts.UNMATCHED === 1, 'Criterio ausente del Ground Truth -> UNMATCHED');

  // 4. FN — el GT espera un finding que el sistema nunca produjo
  const r4 = matchPrototypeFindings(GROUND_TRUTH, []);
  assert(r4.counts.FN === 2, 'Ningún finding real producido -> ambos expectedFindings cuentan como FN');

  // 5. FP por status distinto
  const wrongStatus = finding({
    status: 'PASS',
    heuristicCode: 'N-04',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Confirmar compra' }],
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
  });
  const r5 = matchPrototypeFindings(GROUND_TRUTH, [wrongStatus]);
  assert(r5.counts.FP === 1, 'PASS cuando el GT esperaba FAIL (mismo criterio/elemento) -> FP');

  // 6. Caso 10 (K.2.1) — matching correcto pero evidencia internamente
  // inconsistente -> FP (demuestra Matching != Consistency)
  const matchedButInconsistent = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Confirmar compra' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Enviar' },
    ],
  });
  const r6 = matchPrototypeFindings(GROUND_TRUTH, [matchedButInconsistent]);
  assert(r6.counts.FP === 1, 'Caso 10: matching correcto pero VisualEvidenceConsistency INCONSISTENT -> FP, nunca TP');

  // 7. Caso 9 (K.2.1) — internamente consistente pero no corresponde al GT -> UNMATCHED
  const consistentButUnmatched = finding({
    heuristicCode: 'N-02',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'ícono de carrito', property: 'visibleText', value: 'Carrito' }],
  });
  const r7 = matchPrototypeFindings(GROUND_TRUTH, [consistentButUnmatched]);
  assert(r7.counts.UNMATCHED === 1, 'Caso 9: finding internamente consistente pero criterio fuera del GT -> UNMATCHED, no TP');

  // 8. DUPLICATE — dos findings reales reclaman el mismo expectedFinding
  const dup1 = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Confirmar compra' }],
  });
  const dup2 = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { description: 'botón Confirmar compra', region: 'bottom-center' } },
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Confirmar compra', property: 'visibleText', value: 'Confirmar compra' }],
  });
  const r8 = matchPrototypeFindings(GROUND_TRUTH, [dup1, dup2]);
  assert(r8.counts.TP_EXACT === 1 && r8.counts.DUPLICATE === 1, 'Segundo finding reclamando el mismo expectedFinding -> DUPLICATE, nunca un TP/FP adicional');

  // 9. AMBIGUOUS — dos candidatos comparten criterio+región, solapamiento de evidencia empatado
  const ambiguousGT: PrototypeExpectedFinding[] = [
    { id: 'A1', criterion: 'N-04', problemType: 'x', visualReference: { regions: ['center'] }, expectedStatus: 'FAIL', minimumEvidence: [{ property: 'visibleText', expectedRealValue: 'A' }] },
    { id: 'A2', criterion: 'N-04', problemType: 'y', visualReference: { regions: ['center'] }, expectedStatus: 'FAIL', minimumEvidence: [{ property: 'visibleText', expectedRealValue: 'B' }] },
  ];
  const ambiguousFinding = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { region: 'center' } },
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'elemento central', context: 'sin propiedad citada' }],
  });
  const r9 = matchPrototypeFindings(ambiguousGT, [ambiguousFinding]);
  assert(r9.counts.AMBIGUOUS === 1, 'Dos candidatos sin desambiguar por evidencia -> AMBIGUOUS, nunca un TP forzado');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
