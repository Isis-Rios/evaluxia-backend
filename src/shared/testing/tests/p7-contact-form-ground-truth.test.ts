import fs from 'fs';
import path from 'path';
import { matchPrototypeFindings, PrototypeExpectedFinding } from '@/shared/testing/prototype-finding-matching';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { detectImageFormat } from '@/modules/evaluations/services/prototype-image-upload.service';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';
import { checkVisualEvidenceConsistency } from '@/modules/evaluations/services/visual-evidence-consistency.service';

/**
 * P7.3.2 — Validación local (MOCK ONLY, cero Gemini) de la fixture/Ground
 * Truth dedicados a la segunda prueba real. Confirma que el contrato real
 * (matcher + Gate + Consistency, vía findings sintéticos construidos a
 * mano) produce las clasificaciones esperadas ANTES de gastar ningún
 * crédito real -- mismo propósito que `p7-experiment-readiness.test.ts`
 * (P7.0) pero para el escenario de P7.3.
 */

const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
const groundTruthRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-contact-form.groundtruth.json'), 'utf8'));
const GROUND_TRUTH: PrototypeExpectedFinding[] = groundTruthRaw.expectedFindings;

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
  console.log('🧪 Starting P7.3.2 — Contact Form Ground Truth Validation (MOCK ONLY)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 0. Integridad de la fixture.
  const imageBuffer = fs.readFileSync(path.join(FIXTURES_ROOT, 'p7-contact-form.png'));
  assert(detectImageFormat(imageBuffer) === 'png', 'p7-contact-form.png es un PNG real válido');
  assert(GROUND_TRUTH.length === 3, 'El Ground Truth declara exactamente 3 expectedFindings (PEF2-ICON, PEF2-DUPLABEL, PEF2-HEADING-OK)');

  // 0b. Los 3 criterios del GT son realmente APLICABLES (nunca OUT_OF_COVERAGE) según el resolver real.
  const applicableCodes = new Set(resolveApplicablePrototypeCriteria().map((c) => c.code));
  assert(applicableCodes.has('N-06'), 'N-06 (PEF2-ICON) es un criterio aplicable según el resolver real');
  assert(applicableCodes.has('N-04'), 'N-04 (PEF2-DUPLABEL) es un criterio aplicable según el resolver real');
  assert(applicableCodes.has('WCAG 2.4.6'), 'WCAG 2.4.6 (PEF2-HEADING-OK) es un criterio aplicable según el resolver real');

  // 0c. [P7.3.3 -> CORREGIDO en la revisión funcional MVP post-P7.5.2]
  // En P7.3.3 esta prueba confirmaba que una evidencia exclusivamente
  // narrativa (solo `context`/`elementDescription`, sin NINGÚN property/value
  // en el finding) degradaba a INSUFFICIENT -- en ese momento se consideraba
  // un límite conocido y aceptado. La revisión funcional consolidada del MVP
  // encontró que esto era, en realidad, un DEFECTO: la regla 7 del prompt
  // (ai.service.ts) instruye explícitamente a Gemini a usar justo este
  // patrón (narrar vía `context` en vez de forzar una property que no
  // representa fielmente lo observado) para problemas de usabilidad sin
  // propiedad visual asociada -- y el propio Ground Truth de este finding
  // (PEF2-ICON) ya declaraba `minimumEvidence: []`, es decir, nunca exigió
  // una property concreta. VisualEvidenceConsistency degradaba este caso de
  // todos modos, contradiciendo la propia intención del Ground Truth. El fix
  // (visual-evidence-consistency.service.ts): cuando NINGÚN ítem de
  // evidencia afirma property+value en ningún lugar del finding, no hay
  // ninguna afirmación que esta función pueda contradecir -- el resultado es
  // CONSISTENT (vacuamente), nunca INSUFFICIENT. Los Casos C/D (property+value
  // presente pero identidad insuficiente) NO cambiaron -- ver
  // visual-evidence-validation.test.ts.
  const narrativeOnlyIcon = finding({
    heuristicCode: 'N-06',
    evidence: [{
      type: 'VISUAL_OBSERVATION',
      elementDescription: 'ícono de guion horizontal (esquina superior derecha)',
      region: 'top-right',
      context: 'El glifo no corresponde a ninguna convención de ícono reconocible de forma única, y no hay texto adyacente.',
    }],
    affectedElement: { visualReference: { description: 'ícono de guion horizontal', region: 'top-right' } },
  });
  const narrativeOnlyConsistency = checkVisualEvidenceConsistency(narrativeOnlyIcon);
  assert(narrativeOnlyConsistency.overallStatus === 'CONSISTENT', '[CORRECCIÓN MVP] Evidencia exclusivamente narrativa (sin NINGÚN property/value) ya NO se degrada a INSUFFICIENT -- no hay ninguna afirmación property=value que contradecir, y el Ground Truth (minimumEvidence:[]) nunca la exigió');
  const narrativeOnlyMatch = matchPrototypeFindings(GROUND_TRUTH, [narrativeOnlyIcon]);
  assert(narrativeOnlyMatch.counts.TP_EXACT + narrativeOnlyMatch.counts.TP_SEMANTIC === 1, '[CORRECCIÓN MVP] Ese mismo finding narrativo-solo ahora se clasifica como TP (coincide con PEF2-ICON) -- antes se perdía como NOT_EVALUABLE pese a que el GT nunca exigió una property concreta');

  // 0d. [P7.3.3] Confirma que `property:"visibleText", value:""` (la forma
  // que el prompt ahora sugiere para documentar una ausencia) SÍ se procesa
  // como verificable -- sin que esto haya requerido tocar Gate/Consistency:
  // la propiedad y el mecanismo ya existían, solo se instruyó su uso.
  const emptyValueIcon = finding({
    heuristicCode: 'N-06',
    evidence: [{
      type: 'VISUAL_OBSERVATION',
      elementDescription: 'ícono de guion horizontal (esquina superior derecha)',
      region: 'top-right',
      property: 'visibleText',
      value: '',
      context: 'El glifo no corresponde a ninguna convención de ícono reconocible de forma única, y no hay texto adyacente.',
    }],
    affectedElement: { visualReference: { description: 'ícono de guion horizontal', region: 'top-right' } },
  });
  const emptyValueConsistency = checkVisualEvidenceConsistency(emptyValueIcon);
  assert(emptyValueConsistency.overallStatus === 'CONSISTENT', '[P7.3.3] property:"visibleText", value:"" se procesa como CONSISTENT (verificable) sin relajar nada del Gate/Consistency ya aprobado');

  // 1. Caso ideal — PEF2-ICON detectado correctamente.
  //
  // DESCUBRIMIENTO ORIGINAL de esta validación (P7.3.2, ya CORREGIDO -- ver
  // 0c arriba y visual-evidence-consistency.service.ts): en su momento, un
  // ítem con SOLO `context`/`elementDescription` (sin property/value) era
  // NOT_CHECKABLE y, si era el ÚNICO ítem, degradaba el finding completo a
  // NOT_EVALUABLE, sin importar que `minimumEvidence: []` en el GT no
  // exigiera ninguna property. Esa inconsistencia entre el Gate y la
  // intención del Ground Truth fue el defecto corregido en la revisión MVP.
  // `property: "visibleText", value: ""` sigue siendo una forma igualmente
  // válida y más explícita de afirmar "no hay texto visible" -- se conserva
  // aquí como el caso "ideal" porque es la que el prompt sugiere cuando SÍ
  // hay una property de la whitelist que encaja, no porque sea la única que
  // sobrevive el Gate.
  const idealIcon = finding({
    heuristicCode: 'N-06',
    evidence: [{
      type: 'VISUAL_OBSERVATION',
      elementDescription: 'ícono de guion horizontal (esquina superior derecha)',
      region: 'top-right',
      property: 'visibleText',
      value: '',
      context: 'El glifo no corresponde a ninguna convención de ícono reconocible de forma única, y no hay texto adyacente.',
    }],
    affectedElement: { visualReference: { description: 'ícono de guion horizontal', region: 'top-right' } },
  });
  const r1 = matchPrototypeFindings(GROUND_TRUTH, [idealIcon]);
  assert(r1.counts.TP_EXACT + r1.counts.TP_SEMANTIC === 1, 'Caso ideal (con property+value citados): ícono ambiguo identificado -> TP');

  // 2. Caso ideal — PEF2-DUPLABEL con evidencia comparativa genuina (ambos botones citados).
  const idealDuplicate = finding({
    heuristicCode: 'N-04',
    affectedElement: { visualReference: { description: 'botón Enviar (contacto)', region: 'middle-left' } },
    evidence: [
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar del formulario de contacto', region: 'middle-left', property: 'visibleText', value: 'Enviar' },
      { type: 'VISUAL_OBSERVATION', elementDescription: 'botón Enviar de la fila de newsletter', region: 'bottom-right', property: 'visibleText', value: 'Enviar' },
    ],
  });
  const r2 = matchPrototypeFindings(GROUND_TRUTH, [idealDuplicate]);
  assert(r2.counts.TP_EXACT + r2.counts.TP_SEMANTIC === 1, 'Caso ideal: duplicación de "Enviar" citando ambos botones -> TP');

  // 3. Control negativo — PASS explícito y correcto sobre el encabezado.
  const headingPass = finding({
    status: 'PASS',
    wcagCriterion: 'WCAG 2.4.6',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Contáctanos' }],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
    recommendation: undefined,
  });
  const r3 = matchPrototypeFindings(GROUND_TRUTH, [headingPass]);
  assert(r3.counts.TP_EXACT === 1, 'Control negativo: PASS explícito y evidenciado sobre el encabezado -> TP_EXACT (confirmación limpia)');

  // 4. Falso positivo genuino — Gemini marca el encabezado descriptivo como FAIL.
  const headingFalsePositive = finding({
    status: 'FAIL',
    wcagCriterion: 'WCAG 2.4.6',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Contáctanos' }],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
  });
  const r4 = matchPrototypeFindings(GROUND_TRUTH, [headingFalsePositive]);
  assert(r4.counts.FP === 1, 'Falso positivo genuino: FAIL sobre un encabezado ya descriptivo -> FP real (no UNMATCHED), confirmado contra el matcher real');

  // 5. Silencio — ningún finding sobre el encabezado en absoluto -> FN (a reinterpretar como "sin pronunciamiento", nunca "detección correcta").
  const r5 = matchPrototypeFindings(GROUND_TRUTH, []);
  const headingCoverage = r5.coverage.find((c) => c.expectedFindingId === 'PEF2-HEADING-OK');
  assert(headingCoverage?.status === 'FN', 'Silencio total sobre el encabezado -> FN en el dato crudo (requiere la reinterpretación manual documentada en el informe, el sistema no lo distingue solo)');

  // 6. Hallazgo adicional fuera del GT -> UNMATCHED, nunca FP.
  const unrelated = finding({ heuristicCode: 'N-08', description: 'El formulario se ve recargado visualmente.' });
  const r6 = matchPrototypeFindings(GROUND_TRUTH, [unrelated]);
  assert(r6.counts.UNMATCHED === 1 && r6.counts.FP === 0, 'Hallazgo adicional fuera del GT -> UNMATCHED, nunca FP');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
