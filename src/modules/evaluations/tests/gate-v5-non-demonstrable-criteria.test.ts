import { visualEvidenceGateService } from '@/modules/evaluations/services/visual-evidence-gate.service';
import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P1.6.6.7 — Gate Rule V5: para WCAG 1.3.1, 1.4.3, 1.1.1 y 3.3.2, ninguna
 * evidencia visual posible (por buena y estructurada que esté) puede
 * demostrar el criterio completo, en NINGUNA dirección (ni PASS ni FAIL) --
 * diseño auditado en P1.6.6.4/P1.6.6.5/P1.6.6.6. A diferencia de la Gate
 * Rule V4 (que degrada un PASS solo cuando la evidencia carece de
 * estructura), esta regla actúa por IDENTIDAD del criterio y degrada
 * incluso con `property`+`value`+`elementDescription` perfectamente
 * estructurados. Prueba la función REAL `processPrototypeFindings`
 * directamente, sin ninguna llamada real a Gemini.
 */

const structuredEvidence = {
  type: 'VISUAL_OBSERVATION' as const,
  property: 'visualLabel' as const,
  value: 'Correo electrónico',
  elementDescription: 'etiqueta sobre el campo de correo electrónico',
  region: 'middle-right' as const,
};

const unstructuredEvidence = {
  type: 'VISUAL_OBSERVATION' as const,
  context: 'Observación visual narrativa, sin property/value estructurado.',
  elementDescription: 'elemento de prueba',
};

function finding(overrides: Partial<PrototypeAuditFinding> = {}): PrototypeAuditFinding {
  return {
    findingGroup: 'accessibility',
    status: 'PASS',
    severity: 'medium',
    confidence: 'high',
    wcagCriterion: 'WCAG 1.3.1 Información y relaciones',
    description: 'Observación visual de prueba.',
    evidence: [structuredEvidence],
    recommendation: null,
    ...overrides,
  } as PrototypeAuditFinding;
}

function runTests() {
  console.log('🧪 Starting Gate Rule V5 — Non-Demonstrable WCAG Criteria (P1.6.6.7) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  const NON_DEMONSTRABLE = [
    { code: 'WCAG 1.3.1 Información y relaciones', label: 'WCAG 1.3.1' },
    { code: 'WCAG 1.4.3 Contraste mínimo', label: 'WCAG 1.4.3' },
    { code: 'WCAG 1.1.1 Contenido no textual', label: 'WCAG 1.1.1' },
    { code: 'WCAG 3.3.2 Etiquetas o instrucciones', label: 'WCAG 3.3.2' },
  ];

  // ==================================================================
  // SECCIÓN 1 — Regla de los cuatro criterios (16 casos: 4 criterios x
  // {PASS,FAIL} x {estructurada,no estructurada})
  // ==================================================================
  console.log('--- Sección 1: los cuatro criterios degradan en ambas direcciones ---');
  for (const { code, label } of NON_DEMONSTRABLE) {
    for (const status of ['PASS', 'FAIL'] as const) {
      for (const [evidenceLabel, evidence] of [
        ['estructurada', [structuredEvidence]],
        ['no estructurada', [unstructuredEvidence]],
      ] as const) {
        const [result] = visualEvidenceGateService.processPrototypeFindings([
          finding({
            wcagCriterion: code,
            status,
            severity: status === 'FAIL' ? 'high' : 'medium',
            recommendation: status === 'FAIL' ? 'Recomendación de prueba.' : null,
            evidence: [...evidence],
          }),
        ]);
        assert(
          result.status === 'NOT_EVALUABLE',
          `${label}: ${status} con evidencia ${evidenceLabel} -> NOT_EVALUABLE`,
        );
        assert(result.confidence === 'low', `${label}: ${status} con evidencia ${evidenceLabel} -> confidence normalizada a low`);
        assert(result.severity === 'info', `${label}: ${status} con evidencia ${evidenceLabel} -> severity normalizada a info (Gate V3)`);
      }
    }
  }

  // ==================================================================
  // SECCIÓN 2 — Protección de alcance: V5 nunca se generaliza
  // ==================================================================
  console.log('--- Sección 2: protección de alcance -- criterios fuera del conjunto de 4 permanecen intactos ---');

  // WCAG 2.4.4 -- sub-caso visualmente demostrable (texto de enlace +
  // contexto visible suficiente): PASS y FAIL deben sobrevivir intactos.
  {
    const [pass244] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
        status: 'PASS',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'Descargar informe anual 2025 en PDF', elementDescription: 'enlace en el pie de página', region: 'bottom-center' }],
      }),
    ]);
    assert(pass244.status === 'PASS', 'WCAG 2.4.4: PASS en el sub-caso único-enlace visualmente demostrable permanece intacto');

    const [fail244] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
        status: 'FAIL',
        severity: 'medium',
        recommendation: 'Usar un texto de enlace descriptivo.',
        evidence: [{ type: 'VISUAL_OBSERVATION', property: 'visibleText', value: 'haga clic aquí', elementDescription: 'enlace en el cuerpo del formulario', region: 'center' }],
      }),
    ]);
    assert(fail244.status === 'FAIL', 'WCAG 2.4.4: FAIL en el sub-caso único-enlace visualmente demostrable permanece intacto');
  }

  // WCAG 1.4.1 (DIRECTLY_EVALUABLE) -- PASS y FAIL intactos.
  {
    const [pass141] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 1.4.1 Uso del color', status: 'PASS' }),
    ]);
    assert(pass141.status === 'PASS', 'WCAG 1.4.1: PASS permanece intacto (fuera del alcance de V5)');

    const [fail141] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 1.4.1 Uso del color', status: 'FAIL', recommendation: 'Agregar un indicador alternativo al color.' }),
    ]);
    assert(fail141.status === 'FAIL', 'WCAG 1.4.1: FAIL permanece intacto (fuera del alcance de V5)');
  }

  // WCAG 2.4.6 (DIRECTLY_EVALUABLE) -- PASS y FAIL intactos.
  {
    const [pass246] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas', status: 'PASS' }),
    ]);
    assert(pass246.status === 'PASS', 'WCAG 2.4.6: PASS permanece intacto (fuera del alcance de V5)');

    const [fail246] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas', status: 'FAIL', recommendation: 'Usar un encabezado más descriptivo.' }),
    ]);
    assert(fail246.status === 'FAIL', 'WCAG 2.4.6: FAIL permanece intacto (fuera del alcance de V5)');
  }

  // Nielsen N-02/N-04/N-06/N-08 -- `wcagCriterion` null, V5 nunca puede
  // coincidir (normalizeCriterionKey(null) === 'unknown').
  for (const heuristicCode of ['N-02', 'N-04', 'N-06', 'N-08']) {
    const [pass] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: undefined, heuristicCode, heuristicName: 'Heurística de prueba', status: 'PASS' }),
    ]);
    assert(pass.status === 'PASS', `${heuristicCode}: PASS permanece intacto (criterio Nielsen, nunca coincide con V5)`);

    const [fail] = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: undefined, heuristicCode, heuristicName: 'Heurística de prueba', status: 'FAIL', recommendation: 'Recomendación de prueba.' }),
    ]);
    assert(fail.status === 'FAIL', `${heuristicCode}: FAIL permanece intacto (criterio Nielsen, nunca coincide con V5)`);
  }

  // N-05 -- las reglas existentes (Gate Rule V1, dynamic behavior absence)
  // no se alteran: un FAIL con una frase de ausencia dinámica y sin
  // evidencia estructurada independiente sigue degradando por V1 (no por
  // V5, que ni siquiera aplica a Nielsen); un PASS/FAIL genuino con el
  // indicio SÍ visible permanece intacto.
  {
    const [degradedByV1] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: undefined,
        heuristicCode: 'N-05',
        heuristicName: 'Prevención de errores',
        status: 'FAIL',
        severity: 'medium',
        recommendation: 'Agregar validación.',
        description: 'El formulario carece de validación en tiempo real.',
        evidence: [unstructuredEvidence],
      }),
    ]);
    assert(degradedByV1.status === 'NOT_EVALUABLE', 'N-05: la Gate Rule V1 (ausencia de comportamiento dinámico) sigue degradando igual, sin interferencia de V5');

    const [genuineN05] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: undefined,
        heuristicCode: 'N-05',
        heuristicName: 'Prevención de errores',
        status: 'FAIL',
        severity: 'medium',
        recommendation: 'Mejorar la ubicación del mensaje de confirmación.',
        description: 'El mensaje de confirmación visible es poco perceptible por su bajo contraste y tamaño reducido.',
        evidence: [structuredEvidence],
      }),
    ]);
    assert(genuineN05.status === 'FAIL', 'N-05: un FAIL genuino sobre un indicio SÍ visible permanece intacto, sin cambios en esta fase');
  }

  // N-03 -- explícitamente fuera de alcance de esta fase: su clasificación
  // y comportamiento NO cambian (sanity check: ningún hallazgo Nielsen
  // puede ser alcanzado por V5, que solo lee `wcagCriterion`).
  {
    const [n03] = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: undefined,
        heuristicCode: 'N-03',
        heuristicName: 'Control y libertad del usuario',
        status: 'FAIL',
        severity: 'medium',
        recommendation: 'Agregar un botón de cancelar/salir visible.',
        description: 'No se observa ningún botón de cancelar o volver atrás en esta pantalla.',
        evidence: [unstructuredEvidence],
      }),
    ]);
    assert(n03.status === 'FAIL', 'N-03: comportamiento NO modificado en esta fase (pendiente de una auditoría independiente, P1.6.6.6 H4)');
  }

  // ==================================================================
  // SECCIÓN 3 — Contraste WCAG 1.4.3 (protección categórica)
  // ==================================================================
  console.log('--- Sección 3: WCAG 1.4.3 -- protección categórica de contraste ---');
  for (const value of ['appears-low', 'appears-sufficient'] as const) {
    for (const status of ['PASS', 'FAIL'] as const) {
      const contrastEvidence = {
        type: 'VISUAL_OBSERVATION' as const,
        property: 'visualContrast' as const,
        value,
        elementDescription: 'texto del botón principal',
        region: 'bottom-center' as const,
      };
      const original = finding({
        wcagCriterion: 'WCAG 1.4.3 Contraste mínimo',
        status,
        confidence: 'high',
        severity: status === 'FAIL' ? 'high' : 'medium',
        recommendation: status === 'FAIL' ? 'Aumentar el contraste.' : null,
        evidence: [contrastEvidence],
      });
      const [result] = visualEvidenceGateService.processPrototypeFindings([original]);
      assert(result.status === 'NOT_EVALUABLE', `WCAG 1.4.3: ${status} con visualContrast="${value}" (confidence=high) -> NOT_EVALUABLE, nunca una conclusión de conformidad`);
      assert(
        JSON.stringify(result.evidence) === JSON.stringify(original.evidence.map((e) => ({ ...e }))),
        `WCAG 1.4.3: ${status} con visualContrast="${value}" conserva la evidencia original íntegra`,
      );
      assert(result.description === original.description, `WCAG 1.4.3: ${status} con visualContrast="${value}" conserva la description original íntegra`);
    }
  }

  // ==================================================================
  // SECCIÓN 4 — Métricas, persistencia y consolidación (sin modificar
  // prototype-metrics.service.ts; se prueba su comportamiento REAL, sin
  // cambios, alimentado con la salida REAL del gate ya corregido).
  // ==================================================================
  console.log('--- Sección 4: métricas, persistencia y consolidación ---');

  // 1-2. Un finding degradado por V5 no es 'PASS' -> nunca sería excluido
  // por la condición de persistencia de prototype-evaluation.service.ts
  // (`if (f.status === 'PASS') continue;`, no modificada en esta fase) --
  // y no cuenta como PASS ni como FAIL en las métricas.
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 1.3.1 Información y relaciones', status: 'PASS', evidence: [structuredEvidence] }),
    ]);
    assert(gated[0].status !== 'PASS', 'Persistencia: un finding degradado por V5 nunca satisface status===\'PASS\' -> nunca sería excluido por la política P1.5.2 (se conservaría en Finding)');
    const metrics = calculatePrototypeMetrics(gated);
    assert(metrics.passCount === 0 && metrics.failCount === 0, 'Métricas: un PASS degradado por V5 no cuenta como PASS ni como FAIL (passCount=0, failCount=0)');
  }

  // 3-4. No incrementa `evaluated` ni `compliance`, no contribuye a overallScore.
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 1.1.1 Contenido no textual', status: 'FAIL', severity: 'critical', recommendation: 'rec', evidence: [structuredEvidence] }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(metrics.coverage.evaluatedCriteria === 0, 'Métricas: un FAIL degradado por V5 no incrementa evaluatedCriteria (0 de 13)');
    assert(metrics.overallScore === null, `Métricas: con el único criterio mencionado degradado por V5, overallScore=null, nunca un número (obtenido: ${metrics.overallScore})`);
  }

  // 5. Se reflejan correctamente en los contadores de cobertura existentes.
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({ wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones', status: 'PASS', evidence: [structuredEvidence] }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(metrics.coverage.applicableCriteria === 13, 'Cobertura: applicableCriteria=13 (sin cambios, V5 no modifica el resolver)');
    assert(metrics.coverage.notEvaluableCriteria === 13, 'Cobertura: el criterio degradado por V5 se refleja como no evaluado (13 de 13 pendientes, ninguno evaluado)');
    assert(metrics.notEvaluableCount === 1, 'Cobertura: notEvaluableCount (hallazgo crudo) = 1, el finding degradado por V5 se cuenta igual que cualquier otro NOT_EVALUABLE');
  }

  // 6. Un FAIL válido de otro criterio sigue dominando sobre un
  // NOT_EVALUABLE del MISMO criterio consolidado (política P1.6.6.1
  // intacta, sin relación con V5 -- regresión explícita pedida por el
  // encargo).
  {
    const gated = visualEvidenceGateService.processPrototypeFindings([
      finding({
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        status: 'FAIL',
        severity: 'high',
        recommendation: 'Usar un encabezado descriptivo.',
        evidence: [structuredEvidence],
      }),
      finding({
        wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
        status: 'NOT_EVALUABLE',
        confidence: 'low',
        evidence: [unstructuredEvidence],
      }),
    ]);
    const metrics = calculatePrototypeMetrics(gated);
    assert(metrics.failCount === 1 && metrics.passCount === 0, 'Consolidación: FAIL válido + NOT_EVALUABLE del MISMO criterio -> FAIL domina (política FAIL > PASS > NOT_EVALUABLE de P1.6.6.1 intacta)');
    assert(metrics.highCount === 1, 'Consolidación: la severidad del FAIL consolidado se preserva correctamente');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
