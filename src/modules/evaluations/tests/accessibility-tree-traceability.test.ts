import { evidenceGateService } from '@/modules/evaluations/services/evidence-gate.service';
import { isAccessibilityTreeValueTraceable } from '@/modules/evaluations/services/evidence-traceability.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * [Revisión MVP, post-evaluación real `6ad2eddad9fe70084f43d58d`] Gate Rule
 * 0c — trazabilidad de evidencia ACCESSIBILITY_TREE. Reproduce el caso real
 * (botón de búsqueda "Search") y confirma el comportamiento ante valores
 * inventados y ante ausencia del árbol.
 */

// Fragmento REAL del árbol de accesibilidad capturado para la evaluación
// `6ad2eddad9fe70084f43d58d` (recortado, no inventado).
const REAL_ACCESSIBILITY_TREE_TEXT = `
  - link "Members":
    - /url: https://bootstrapmade.com/members/
    - img
    - text: Members
  - textbox "Enter search keyword":
    - /placeholder: Search
  - button "Search":
    - img
- main:
  - heading "Siimple - Free bootstrap landing page template" [level=1]
`;

function finding(overrides: Partial<V2AuditFinding> = {}): V2AuditFinding {
  return {
    findingGroup: 'accessibility',
    type: 'wcag',
    status: 'FAIL',
    severity: 'high',
    confidence: 'high',
    description: 'desc',
    evidence: [],
    recommendation: 'rec',
    affectedElement: { selector: 'header > div > div > form > button' },
    ...overrides,
  } as V2AuditFinding;
}

function runTests() {
  console.log('🧪 Starting Gate Rule 0c — ACCESSIBILITY_TREE Traceability Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // --- Pruebas directas de la función pura ---
  assert(
    isAccessibilityTreeValueTraceable('Search', REAL_ACCESSIBILITY_TREE_TEXT),
    'isAccessibilityTreeValueTraceable: "Search" SÍ aparece en el árbol real (caso real confirmado) -> trazable',
  );
  assert(
    !isAccessibilityTreeValueTraceable('Confirmar Compra Ahora', REAL_ACCESSIBILITY_TREE_TEXT),
    'isAccessibilityTreeValueTraceable: un valor inventado que no aparece en ningún lado -> NO trazable',
  );
  assert(
    isAccessibilityTreeValueTraceable('search', REAL_ACCESSIBILITY_TREE_TEXT),
    'isAccessibilityTreeValueTraceable: comparación case-insensitive ("search" minúscula también coincide)',
  );
  assert(
    isAccessibilityTreeValueTraceable('', REAL_ACCESSIBILITY_TREE_TEXT),
    'isAccessibilityTreeValueTraceable: un value vacío (afirmar ausencia de nombre) siempre es trazable',
  );
  assert(
    !isAccessibilityTreeValueTraceable('Search', ''),
    'isAccessibilityTreeValueTraceable: un value NO vacío contra un texto de árbol vacío -> no trazable (la función en sí no decide la política de "ausencia nunca penaliza" -- eso es responsabilidad del guard accessibilityTreeText en el Gate, probado abajo)',
  );

  // --- Caso real: el finding del botón "Search" NO debe degradarse ---
  const realSearchButtonFinding = finding({
    wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
    description: 'El elemento interactivo <button> en header > div > div > form > button carece de nombre accesible (texto visible o aria-label).',
    evidence: [
      { type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: 'header > div > div > form > button' },
      { type: 'DOM_ATTRIBUTE', property: 'text', value: 'null', selector: 'header > div > div > form > button' },
      { type: 'ACCESSIBILITY_TREE', property: 'name', value: 'Search', selector: 'header > div > div > form > button' },
      { type: 'ACCESSIBILITY_TREE', property: 'role', value: 'button', selector: 'header > div > div > form > button' },
    ] as any,
  });
  const [gatedReal] = evidenceGateService.processAiFindings([realSearchButtonFinding], undefined, REAL_ACCESSIBILITY_TREE_TEXT);
  assert(gatedReal.status === 'FAIL', '[CASO REAL] El hallazgo del botón "Search" con su evidencia ACCESSIBILITY_TREE real NO se degrada -- el valor citado es fiel al árbol realmente enviado');

  // --- Caso negativo: un valor ACCESSIBILITY_TREE inventado SÍ degrada ---
  const fabricatedFinding = finding({
    wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
    evidence: [
      { type: 'ACCESSIBILITY_TREE', property: 'name', value: 'Confirmar Compra Ahora', selector: 'header > div > div > form > button' },
    ] as any,
  });
  const [gatedFabricated] = evidenceGateService.processAiFindings([fabricatedFinding], undefined, REAL_ACCESSIBILITY_TREE_TEXT);
  assert(gatedFabricated.status === 'NOT_EVALUABLE', '[CASO INVENTADO] Un valor ACCESSIBILITY_TREE que no aparece en el árbol real se degrada a NOT_EVALUABLE');
  assert(gatedFabricated.confidence === 'low', '[CASO INVENTADO] confidence se normaliza a low, igual que el resto de degradaciones del Gate');
  assert(gatedFabricated.recommendation === null, '[CASO INVENTADO] la recomendación se limpia igual que cualquier otro NOT_EVALUABLE (Gate Rule 1c ya existente, sin cambios)');

  // --- Ausencia del árbol: nunca degrada, ni con un valor que luciría "inventado" ---
  const [gatedNoTreeProvided] = evidenceGateService.processAiFindings([fabricatedFinding], undefined, undefined);
  assert(gatedNoTreeProvided.status === 'FAIL', '[AUSENCIA DE ÁRBOL] Sin accessibilityTreeText (undefined, como cualquier llamador preexistente), la Gate Rule 0c nunca se activa -- comportamiento 100% igual al de antes de este cambio');

  const [gatedEmptyTree] = evidenceGateService.processAiFindings([fabricatedFinding], undefined, '');
  assert(gatedEmptyTree.status === 'FAIL', '[AUSENCIA DE ÁRBOL] accessibilityTreeText="" (captura del árbol falló para esa iteración) tampoco degrada -- ausencia de evidencia de verificación nunca se trata como prueba de cita falsa');

  // --- Otros tipos de evidencia nunca se ven afectados por esta regla ---
  const domOnlyFinding = finding({
    wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
    evidence: [
      { type: 'DOM_ATTRIBUTE', property: 'contrastRatio', value: '2.1:1', selector: 'header > div > div > form > button' },
      { type: 'COMPUTED_STYLE', property: 'color', value: 'rgb(0,0,0)', selector: 'header > div > div > form > button' },
    ] as any,
  });
  const [gatedDomOnly] = evidenceGateService.processAiFindings([domOnlyFinding], undefined, REAL_ACCESSIBILITY_TREE_TEXT);
  assert(gatedDomOnly.status === 'FAIL', '[REGRESIÓN] Un finding sin evidencia ACCESSIBILITY_TREE (solo DOM_ATTRIBUTE/COMPUTED_STYLE, con valores que no aparecen literalmente en el árbol) nunca se ve afectado por la Gate Rule 0c -- la regla solo inspecciona items type===ACCESSIBILITY_TREE');

  // --- Compatibilidad hacia atrás: llamar sin el 3er argumento en absoluto ---
  const [gatedTwoArgsOnly] = evidenceGateService.processAiFindings([realSearchButtonFinding]);
  assert(gatedTwoArgsOnly.status === 'FAIL', '[COMPATIBILIDAD] processAiFindings(findings) sin evidenceIndex ni accessibilityTreeText (firma preexistente de 1 argumento) sigue funcionando exactamente igual que antes de este cambio');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
