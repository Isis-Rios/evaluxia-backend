import { buildMetricsAudit, buildExplorationIntegrity, appendSummaryDisclaimer } from '@/shared/infrastructure/metrics-tracker';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * P1.1 — Partes B (trazabilidad de métricas), C (resumen narrativo) y D
 * (integridad de la exploración), motivadas por la auditoría post-piloto de
 * la evaluación real `6ae15b04ce94179ae8ad199b`.
 *
 * `buildMetricsAudit`/`buildExplorationIntegrity`/`appendSummaryDisclaimer`
 * son funciones puras (extraídas de `audit-engine.service.ts` sin cambiar
 * su resultado) — se prueban directamente, sin MongoDB. La propagación de
 * `explorationNote` hacia el prompt de Fase 2 se prueba vía el pipeline
 * mockeado real (mismo mecanismo que G1-G8), sin red ni llamadas a Gemini.
 */
async function main() {
  console.log('🧪 Starting P1.1 — Report integrity & traceability (Partes B/C/D)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // -----------------------------------------------------------------
  // Parte B — buildMetricsAudit: coherencia entre el desglose y el
  // conjunto real de hallazgos consolidados.
  // -----------------------------------------------------------------
  console.log('--- Parte B: buildMetricsAudit ---');
  {
    // Reproduce la forma real del incidente: 8 FAIL (persistidos), más
    // hallazgos PASS/NOT_EVALUABLE que NUNCA se persisten como Finding.
    const consolidated = [
      ...Array(8).fill({ status: 'FAIL' }),
      ...Array(4).fill({ status: 'NOT_EVALUABLE' }),
      { status: 'PASS' },
      { status: 'PASS' },
    ];
    const audit = buildMetricsAudit(consolidated);
    assert(audit.consolidatedByStatus.FAIL === 8, 'consolidatedByStatus.FAIL cuenta exactamente los 8 FAIL reales');
    assert(audit.consolidatedByStatus.NOT_EVALUABLE === 4, 'consolidatedByStatus.NOT_EVALUABLE cuenta los 4 hallazgos NOT_EVALUABLE');
    assert(audit.consolidatedByStatus.PASS === 2, 'consolidatedByStatus.PASS cuenta los 2 PASS');
    // P1.6.2 Parte A — expectedPersistedFindingsCount ahora refleja la
    // política real post-P1.5.2 (FAIL + NOT_EVALUABLE), no solo FAIL.
    assert(audit.expectedPersistedFindingsCount === 12, 'expectedPersistedFindingsCount = FAIL(8) + NOT_EVALUABLE(4) = 12, política P1.5.2');
    assert(
      audit.consolidatedByStatus.FAIL + audit.consolidatedByStatus.PASS + audit.consolidatedByStatus.NOT_EVALUABLE === consolidated.length,
      'La suma del desglose reconstruye el tamaño real del conjunto consolidado completo (14), no solo lo persistido',
    );
    assert(typeof audit.note === 'string' && audit.note.length > 0, 'Incluye una nota explicativa legible, no solo números');
    assert(!audit.note.includes('solo status=FAIL se persiste'), 'La nota ya NO afirma que únicamente se persisten hallazgos FAIL (texto obsoleto desde P1.5.2)');
    assert(audit.persistedFindingsCount === undefined, 'Sin un conteo real provisto, persistedFindingsCount queda undefined -- nunca se inventa un número como si fuera una verificación de MongoDB');

    const empty = buildMetricsAudit([]);
    assert(empty.expectedPersistedFindingsCount === 0 && empty.consolidatedByStatus.FAIL === 0, 'Conjunto vacío no produce conteos inventados');

    const unknownStatus = buildMetricsAudit([{ status: 'FAIL' }, { status: 'SOMETHING_UNEXPECTED' }]);
    assert(unknownStatus.consolidatedByStatus.FAIL === 1, 'Un status desconocido no se cuenta en ningún bucket conocido, pero tampoco rompe el cálculo de los que sí lo son');
  }

  // -----------------------------------------------------------------
  // Parte B.2 (P1.6.2 Parte A) — buildMetricsAudit con el conteo REAL de
  // persistencia provisto (2º argumento), reproduciendo exactamente el
  // defecto confirmado en la auditoría post-piloto P1.6.1: el piloto real
  // `6ae53c5ac54be00390d0ca8f` tenía 16 FAIL + 4 NOT_EVALUABLE
  // consolidados, 20 documentos realmente persistidos, pero
  // `persistedFindingsCount` reportaba 16.
  // -----------------------------------------------------------------
  console.log('\n--- Parte B.2: buildMetricsAudit con conteo real de persistencia (P1.6.2) ---');
  {
    const consolidatedRealPilot = [
      ...Array(16).fill({ status: 'FAIL' }),
      ...Array(4).fill({ status: 'NOT_EVALUABLE' }),
      ...Array(81).fill({ status: 'PASS' }),
    ];

    // Caso FAIL + NOT_EVALUABLE: el conteo real coincide con el esperado
    // (20 = 16 + 4) -- el comportamiento correcto post-P1.5.2.
    const auditMatching = buildMetricsAudit(consolidatedRealPilot, 20);
    assert(auditMatching.expectedPersistedFindingsCount === 20, 'expectedPersistedFindingsCount = 16 FAIL + 4 NOT_EVALUABLE = 20, reproduce el piloto real P1.6.1');
    assert(auditMatching.persistedFindingsCount === 20, 'persistedFindingsCount real (provisto) = 20, YA NO se queda congelado en 16 como antes de P1.6.2');
    assert(!auditMatching.note.includes('ADVERTENCIA'), 'Sin discrepancia entre esperado y real, no se agrega ninguna advertencia a la nota');

    // Caso PASS: confirmar explícitamente que un PASS nunca contribuye a
    // ninguno de los dos conteos de persistencia.
    const onlyPass = buildMetricsAudit([{ status: 'PASS' }, { status: 'PASS' }, { status: 'PASS' }], 0);
    assert(onlyPass.expectedPersistedFindingsCount === 0, 'PASS nunca cuenta para expectedPersistedFindingsCount');
    assert(onlyPass.persistedFindingsCount === 0, 'PASS nunca cuenta para persistedFindingsCount real');

    // Caso de discrepancia real (p. ej. una creación individual falló
    // silenciosamente antes del catch general): el real (19) no coincide
    // con el esperado (20) -- esto debe ser VISIBLE en la nota, no ocultado.
    const auditMismatch = buildMetricsAudit(consolidatedRealPilot, 19);
    assert(auditMismatch.expectedPersistedFindingsCount === 20 && auditMismatch.persistedFindingsCount === 19, 'Una discrepancia real entre esperado (20) y persistido (19) se preserva sin corregirse artificialmente');
    assert(auditMismatch.note.includes('ADVERTENCIA') && auditMismatch.note.includes('19') && auditMismatch.note.includes('20'), 'La nota señala explícitamente la discrepancia real detectada, con ambos números');
  }

  // -----------------------------------------------------------------
  // Parte D — buildExplorationIntegrity: exploración completa vs.
  // interrumpida.
  // -----------------------------------------------------------------
  console.log('\n--- Parte D: buildExplorationIntegrity ---');
  {
    const complete = buildExplorationIntegrity(null);
    assert(complete.complete === true && complete.interruptionReason === null, 'Sin blockingError -> exploración marcada como completa, sin razón de interrupción');

    const completeUndefined = buildExplorationIntegrity(undefined);
    assert(completeUndefined.complete === true, 'blockingError undefined se trata igual que null (completa)');

    const interrupted = buildExplorationIntegrity('Action failed: page.click: Timeout 10000ms exceeded.');
    assert(interrupted.complete === false, 'Con blockingError presente -> exploración marcada como incompleta');
    assert(interrupted.interruptionReason === 'Action failed: page.click: Timeout 10000ms exceeded.', 'La razón de interrupción se preserva tal cual, sin truncar en esta función (el truncado de 150 chars es responsabilidad del note para el prompt, no de esta señal estructurada)');

    const emptyStringError = buildExplorationIntegrity('');
    assert(emptyStringError.complete === true, 'Un blockingError vacío ("") se trata como ausencia real (JS falsy), consistente con cómo el resto del sistema ya trata blockingError:null vs texto real');
  }

  // -----------------------------------------------------------------
  // Parte C — appendSummaryDisclaimer: el resumen final no debe
  // presentarse como una lista de hallazgos plenamente verificados.
  // -----------------------------------------------------------------
  console.log('\n--- Parte C: appendSummaryDisclaimer ---');
  {
    const raw = 'La página presenta varios controles sin nombre accesible y una imagen sin texto alternativo.';
    const withDisclaimer = appendSummaryDisclaimer(raw);
    assert(withDisclaimer.startsWith(raw), 'El texto original de Gemini se preserva íntegro al inicio (no se reescribe ni se recorta)');
    assert(withDisclaimer.length > raw.length, 'Se añade contenido adicional (el aviso), no se reemplaza el resumen');
    assert(/orientativ|no.*verificad|hallazgos.*verificados/i.test(withDisclaimer), 'El texto añadido indica explícitamente que el resumen es orientativo y distinto de los hallazgos verificados');
    assert(!withDisclaimer.toLowerCase().includes('llamada a gemini'), 'No se implementó ninguna segunda llamada a Gemini para generar este texto (es estático/determinista)');
  }

  // -----------------------------------------------------------------
  // Parte C.2 (P1.6.2 Parte C) — appendSummaryDisclaimer debe comunicar
  // explícitamente una exploración incompleta, reproduciendo el defecto
  // confirmado en la auditoría post-piloto P1.6.1: el Report.summary de la
  // evaluación real `6ae53c5ac54be00390d0ca8f` (terminationReason
  // MAX_ITERATIONS_REACHED) solo llevaba el disclaimer general de P1.1, sin
  // ninguna mención a que la exploración se cortó por límite de iteraciones.
  // -----------------------------------------------------------------
  console.log('\n--- Parte C.2: appendSummaryDisclaimer + explorationIntegrity (P1.6.2) ---');
  {
    const raw = 'Resumen ejecutivo de prueba.';

    // Requisito 5: explorationIntegrity.complete === true -> ninguna nota nueva.
    const completeIntegrity = { complete: true, interruptionReason: null, terminationReason: 'NATURAL_STOP' as const };
    const withComplete = appendSummaryDisclaimer(raw, completeIntegrity);
    assert(!/alcance de la exploración/i.test(withComplete), 'Con explorationIntegrity.complete=true, no se añade ninguna nota de exploración incompleta');

    // Sin explorationIntegrity (compatibilidad 1-argumento): comportamiento
    // idéntico a antes de P1.6.2 -- ya cubierto por Parte C arriba, se repite
    // aquí explícitamente para dejar la regresión documentada en este bloque.
    const withoutArg = appendSummaryDisclaimer(raw);
    assert(!/alcance de la exploración/i.test(withoutArg), 'Sin explorationIntegrity (compatibilidad), tampoco se añade ninguna nota nueva -- comportamiento histórico intacto');

    // Reproduce el piloto real: MAX_ITERATIONS_REACHED, complete=false.
    const maxIterationsIntegrity = {
      complete: false,
      interruptionReason: null,
      terminationReason: 'MAX_ITERATIONS_REACHED' as const,
      evidenceFullyVerified: false,
      snapshotPersistenceFailureCount: 0,
    };
    const withMaxIterations = appendSummaryDisclaimer(raw, maxIterationsIntegrity);
    assert(withMaxIterations.startsWith(raw), 'El resumen original de Gemini sigue preservándose íntegro al inicio');
    assert(/orientativ|no.*verificad|hallazgos.*verificados/i.test(withMaxIterations), 'El disclaimer general de P1.1 NO se elimina ni se sobrescribe (requisito 6)');
    assert(/límite de iteraciones/i.test(withMaxIterations), 'Para MAX_ITERATIONS_REACHED, se menciona explícitamente el límite de iteraciones alcanzado');
    assert(/última acción.*(no haber sido verificada|puede no haber sido verificada)/i.test(withMaxIterations), 'Se menciona explícitamente que la última acción puede no haber sido verificada');
    assert(!/evaluación.*fall[óo]|auditoría.*fall[óo]/i.test(withMaxIterations), 'Nunca se afirma que la evaluación o la auditoría fallaron (requisito 7)');
    assert(/auditoría se completó correctamente/i.test(withMaxIterations), 'Se distingue explícitamente: la auditoría SÍ se completó, solo la exploración fue incompleta');

    // Los otros 4 terminationReason producen mensajes coherentes y DISTINTOS
    // entre sí -- nunca el mismo texto genérico para todos.
    const messages = new Map<string, string>();
    for (const reason of ['ACTION_FAILED', 'INVALID_ACTION_DECISION', 'EXPLORATION_ERROR', 'UNKNOWN'] as const) {
      const text = appendSummaryDisclaimer(raw, {
        complete: false,
        interruptionReason: reason === 'ACTION_FAILED' ? 'Action failed: timeout' : null,
        terminationReason: reason,
      });
      assert(text.startsWith(raw), `[${reason}] El resumen original se preserva íntegro`);
      assert(!/evaluación.*fall[óo]|auditoría.*fall[óo]/i.test(text), `[${reason}] Nunca se afirma que la evaluación/auditoría falló`);
      messages.set(reason, text);
    }
    const uniqueMessages = new Set(messages.values());
    assert(uniqueMessages.size === 4, 'Los 4 terminationReason restantes producen 4 textos distintos entre sí, coherentes con su propio significado, no un mensaje genérico compartido');
  }

  // -----------------------------------------------------------------
  // Parte D (extremo a extremo) — explorationNote llega realmente al
  // prompt de Fase 2 cuando se provee, y NO aparece cuando no hay
  // interrupción -- vía el pipeline mockeado real (sin red, sin Gemini).
  // -----------------------------------------------------------------
  console.log('\n--- Parte D (extremo a extremo): explorationNote en el prompt real ---');
  {
    const evidences: EvidenceInput[] = [
      { iteration: 1, url: 'https://fixture.local/p11d', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] },
    ];
    const emptyResponse = buildValidAuditOutputJson([]);

    // Caso interrumpido: explorationNote presente -> debe aparecer en el prompt real.
    {
      const stub = stubGeminiJsonResponses([emptyResponse]);
      try {
        const result = await runMockedPhase2Pipeline(evidences, {
          evaluationId: 'p11d-interrupted',
          explorationNote: 'The exploration session ended with an unresolved interruption at step 3: timeout clicking #desktopToggle.',
        });
        assert(result.prompt.includes('EXPLORATION STATUS'), 'El prompt real incluye la sección de estado de exploración cuando hay explorationNote');
        assert(result.prompt.includes('timeout clicking #desktopToggle'), 'El prompt real incluye el texto corto y acotado de la interrupción, no un placeholder genérico');
      } finally {
        stub.restore();
      }
    }

    // Caso completo: sin explorationNote -> NO debe aparecer esa sección.
    {
      const stub = stubGeminiJsonResponses([emptyResponse]);
      try {
        const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'p11d-complete' });
        assert(!result.prompt.includes('EXPLORATION STATUS'), 'Sin explorationNote, el prompt NO incluye ninguna sección de estado de exploración (sin ruido para el caso normal)');
      } finally {
        stub.restore();
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
