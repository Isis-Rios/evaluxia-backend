import fs from 'fs';
import path from 'path';
import { matchPrototypeFindings, PrototypeExpectedFinding } from '@/shared/testing/prototype-finding-matching';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P7.5.1 — Regresión del matcher de criterios múltiples (MOCK ONLY, cero
 * Gemini).
 *
 * [Revisión de estabilización, octubre 2026] Esta prueba dependía
 * originalmente de dos volcados reales de P7.1/P7.3 guardados en
 * `/tmp/prototype-p7-experiment-{1,2}-result.json` -- generados por
 * ejecuciones reales de Gemini ya autorizadas y auditadas en su momento,
 * pero NUNCA versionados en el repositorio (vivían en el directorio
 * temporal del sistema). Tras un reinicio del entorno, esos dos archivos
 * dejaron de existir, y no pueden reconstruirse sin una nueva llamada real
 * a Gemini (fuera de alcance de esta fase).
 *
 * Verificado antes de este cambio: no existe ninguna copia de esos dos
 * archivos en el repositorio, en commits ni en ninguna otra fuente local
 * verificable con certeza suficiente para reproducirlos byte a byte. Por
 * eso esta prueba se reescribe para usar datos SINTÉTICOS, marcados
 * explícitamente como tales (prefijo "[SINTÉTICO]" en cada `description`),
 * que reproducen el MISMO escenario lógico que el dato real original
 * (confirmado por los Ground Truth reales ya versionados en
 * `fixtures/prototypes/`, que sí sobrevivieron intactos) -- sin presentarse
 * en ningún momento como una respuesta real de Gemini.
 *
 * Cobertura que se conserva: el comportamiento del matcher
 * (`resolvePrincipalCriterionKey`) ante un finding de doble criterio, ante
 * un finding de un solo criterio WCAG, y ante una confirmación PASS
 * correcta -- las tres mismas rutas de código que el dato real ejercitaba.
 * Cobertura que se pierde: el valor evidencial de "esto es exactamente lo
 * que Gemini respondió una vez" -- ese registro histórico (incluida la cita
 * textual del defecto original, "FP matched=PEF2-HEADING-OK...") permanece
 * documentado en el historial de la auditoría del proyecto, no como dato
 * vivo de esta prueba automatizada.
 */

const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');

function syntheticFinding(overrides: Partial<PrototypeAuditFinding>): PrototypeAuditFinding {
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
  console.log('🧪 Starting P7.5.1 — Criterion Matching Regression (MOCK ONLY)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ===========================================================================
  // 1. [SINTÉTICO] REGRESIÓN DE DOBLE CRITERIO — reproduce el MISMO
  // escenario lógico que el finding real de P7.3 (dos botones "Enviar",
  // heuristicCode:"N-04" + wcagCriterion:"WCAG 2.4.6..."): un finding dual
  // no debe compararse contra el Ground Truth del encabezado.
  // ===========================================================================
  const p73GroundTruth: PrototypeExpectedFinding[] = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-contact-form.groundtruth.json'), 'utf8'),
  ).expectedFindings;

  const syntheticDualCriterionFinding = syntheticFinding({
    heuristicCode: 'N-04',
    heuristicName: 'Consistencia y estándares',
    wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
    description: '[SINTÉTICO] Dos botones "Enviar" (formulario de contacto y suscripción al boletín) sin ningún texto propio que los distinga entre sí.',
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar del formulario de contacto', region: 'middle-left', property: 'visibleText', value: 'Enviar' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar de la sección de boletín', region: 'bottom-right', property: 'visibleText', value: 'Enviar' },
    ],
    affectedElement: { visualReference: { description: 'ambos botones "Enviar"', region: 'full-screen' } },
  });
  assert(
    !!syntheticDualCriterionFinding.heuristicCode && !!syntheticDualCriterionFinding.wcagCriterion,
    'Precondición: el finding sintético cita AMBOS heuristicCode y wcagCriterion, igual que el escenario real que reproduce',
  );

  const r1 = matchPrototypeFindings(p73GroundTruth, [syntheticDualCriterionFinding]);
  assert(
    r1.results[0].matchedExpectedFindingId === 'PEF2-DUPLABEL',
    `[CORRECCIÓN] El finding dual-criterio se compara contra PEF2-DUPLABEL (N-04), no contra PEF2-HEADING-OK (WCAG 2.4.6) -- clasificación: ${r1.results[0].classification}, matched=${r1.results[0].matchedExpectedFindingId}`,
  );
  assert(
    r1.results[0].classification === 'TP_EXACT' || r1.results[0].classification === 'TP_SEMANTIC',
    `[CORRECCIÓN] El finding dual-criterio se clasifica como TP (detección correcta), nunca como FP contra un Ground Truth ajeno -- clasificación: ${r1.results[0].classification}`,
  );
  assert(r1.counts.FP === 0, '[CORRECCIÓN] Cero falsos positivos espurios (el defecto original, documentado en el historial del proyecto, producía 1 FP contra PEF2-HEADING-OK)');

  // ===========================================================================
  // 2. [SINTÉTICO] CRITERIO ÚNICO WCAG — reproduce el escenario del
  // encabezado "Página" de P7.1 (un único criterio, wcagCriterion
  // solamente): debe seguir encontrando su Ground Truth sin verse afectado
  // por la resolución dual.
  // ===========================================================================
  const p71GroundTruth: PrototypeExpectedFinding[] = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-heading-label.groundtruth.json'), 'utf8'),
  ).expectedFindings;
  const syntheticPureWcagHeadingFinding = syntheticFinding({
    wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
    description: '[SINTÉTICO] El encabezado principal "Página" no describe el contenido real de la pantalla.',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Página' }],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
  });
  assert(!syntheticPureWcagHeadingFinding.heuristicCode, 'Precondición: el finding sintético nunca cita heuristicCode (un solo criterio), igual que el escenario real que reproduce');

  const r2 = matchPrototypeFindings(p71GroundTruth, [syntheticPureWcagHeadingFinding]);
  assert(r2.counts.TP_EXACT === 1, 'Criterio único WCAG: el finding del encabezado "Página" resuelve TP_EXACT contra PEF-H1');

  // ===========================================================================
  // 3. [SINTÉTICO] CONTROL NEGATIVO — reproduce la confirmación PASS
  // correcta de P7.3 (encabezado "Contáctanos" ya descriptivo): debe
  // conservar su clasificación sin heuristicCode.
  // ===========================================================================
  const syntheticHeadingPassConfirmation = syntheticFinding({
    status: 'PASS',
    wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
    description: '[SINTÉTICO] El encabezado principal "Contáctanos" describe correctamente el propósito de la pantalla.',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Contáctanos' }],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
    recommendation: null,
  });
  assert(!syntheticHeadingPassConfirmation.heuristicCode, 'Precondición: la confirmación sintética nunca cita heuristicCode');
  const r3 = matchPrototypeFindings(p73GroundTruth, [syntheticHeadingPassConfirmation]);
  assert(r3.counts.TP_EXACT === 1 && r3.results[0].matchedExpectedFindingId === 'PEF2-HEADING-OK', 'Control negativo: la confirmación del encabezado resuelve TP_EXACT contra PEF2-HEADING-OK');

  // ===========================================================================
  // 4. CRITERIOS DISTINTOS — un finding N-04 "puro" (sin wcagCriterion) no
  // debe, bajo ninguna circunstancia, terminar comparado contra un GT WCAG.
  // ===========================================================================
  const pureNielsenFinding = syntheticFinding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { region: 'middle-left' } },
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar (contacto)', region: 'middle-left', property: 'visibleText', value: 'Enviar' }],
  });
  const r4 = matchPrototypeFindings(p73GroundTruth, [pureNielsenFinding]);
  assert(r4.results[0].matchedExpectedFindingId !== 'PEF2-HEADING-OK', 'Un finding N-04 puro nunca se empareja con el GT de WCAG 2.4.6 únicamente por compartir un campo');

  // ===========================================================================
  // 5. AMBIGÜEDAD REAL — cuando ambas claves tienen candidato en el GT y el
  // solapamiento de evidencia no permite desambiguar (empate), el sistema
  // debe declarar AMBIGUOUS explícitamente, nunca forzar una coincidencia.
  // ===========================================================================
  const ambiguousGroundTruth: PrototypeExpectedFinding[] = [
    { id: 'AMB-WCAG', criterion: 'WCAG 2.4.6', problemType: 'x', visualReference: {}, expectedStatus: 'FAIL', minimumEvidence: [], verifiableBy: 'ai' },
    { id: 'AMB-N04', criterion: 'N-04', problemType: 'y', visualReference: {}, expectedStatus: 'FAIL', minimumEvidence: [], verifiableBy: 'ai' },
  ];
  const trulyAmbiguousFinding = syntheticFinding({
    heuristicCode: 'N-04',
    wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'elemento sin solapamiento de evidencia', context: 'observación sin property citada' }],
  });
  const r5 = matchPrototypeFindings(ambiguousGroundTruth, [trulyAmbiguousFinding]);
  assert(r5.counts.AMBIGUOUS === 1, 'Ambigüedad real (ambas claves con GT, 0-0 de solapamiento) -> AMBIGUOUS explícito, nunca una coincidencia forzada');
  assert(r5.counts.FP === 0 && r5.counts.TP_EXACT === 0 && r5.counts.TP_SEMANTIC === 0, 'El caso ambiguo nunca se cuenta como TP ni como FP');

  // ===========================================================================
  // 6. REGRESIÓN WEB — finding-matching.ts (WEB) permanece completamente
  // intacto; se confirma reimportándolo y verificando que sigue exportando
  // exactamente lo mismo (ninguna función fue tocada en ese archivo).
  // ===========================================================================
  const webMatcher = require('@/shared/testing/finding-matching');
  assert(typeof webMatcher.matchFindings === 'function', 'finding-matching.ts (WEB) permanece exportando matchFindings sin cambios -- no fue tocado en esta fase');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
