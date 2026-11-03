import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { buildCatalogLinks, buildCatalogButtons } from '@/shared/testing/stress-generators';
import { runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { measurePayload, shouldBlockBeforeSending, PHASE2_BUDGET } from '@/shared/testing/payload-budgets';

/**
 * Fase G — G7: demostración DINÁMICA (no solo estática por grep, como en
 * F8) de la relación entre CLASIFICACIÓN y ENFORCEMENT de un payload
 * CRITICAL. Intercepta la llamada real a `client.models.generateContent`
 * (el punto exacto donde el enforcement debe bloquear ANTES de llegar).
 *
 * HISTORIAL: cuando esta prueba se escribió (Fase G), confirmó que el
 * payload SÍ llegaba íntegro al cliente pese a clasificarse CRITICAL (gap
 * de enforcement, registrado como deuda técnica). Ese gap fue cerrado por
 * el Hardening Post-Fase H (J2 — CRITICAL Payload Enforcement):
 * `ai.service.ts` ahora bloquea la llamada ANTES de construir siquiera la
 * solicitud al cliente. Esta prueba se actualizó para confirmar el
 * enforcement real — dejarla exigiendo que la llamada SÍ ocurriera habría
 * marcado la corrección como una "regresión" cada vez que corriera la suite.
 *
 * SEPARACIÓN EXPLÍCITA (se mantiene, por ser el punto central de J2):
 *   - CLASIFICACIÓN: shouldBlockBeforeSending()/measurePayload() clasifican
 *     el prompt como CRITICAL. Esto se verifica de forma completamente
 *     independiente de si la llamada ocurre o no.
 *   - ENFORCEMENT: se verifica, por separado y dinámicamente, que la
 *     llamada al cliente (mockeado) NUNCA ocurre para este payload.
 */
async function main() {
  console.log('🧪 Starting G7 — CRITICAL Payload Dynamically Reaches the (Mocked) Client (Fase G)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // Reutiliza el generador de F1/F6 a un volumen que F1 ya demostró
  // aterrizar en CRITICAL para textChars altos (ver F6: 400×600c ~286K;
  // aquí se sube el volumen para cruzar el umbral CRITICAL de Phase 2 —
  // 1,000,000 chars — de forma clara e inequívoca).
  const N = 1500;
  const links = buildCatalogLinks(N, { textChars: 700 });
  const buttons = buildCatalogButtons(N);
  const evidences: EvidenceInput[] = [
    { iteration: 1, url: 'https://fixture.local/g7', screenshotPath: '/x.png', headings: [], images: [], links, buttons, forms: [], landmarks: [], computedStyles: [] } as any,
  ];

  // --- Instrumentación DINÁMICA del punto de llamada real (no un stub genérico) ---
  const client = GeminiClient.getInstance();
  const original = (client as any).client.models.generateContent;
  let capturedContentsLength = -1;
  let callHappened = false;
  (client as any).client.models.generateContent = async (args: any) => {
    callHappened = true;
    capturedContentsLength = typeof args?.contents === 'string' ? args.contents.length : -1;
    return { text: buildValidAuditOutputJson([]), usageMetadata: undefined };
  };

  try {
    const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g7', url: 'https://fixture.local/g7' });

    // --- 1. CLASIFICACIÓN (independiente de si la llamada ocurrió) ---
    const measurement = measurePayload(2, result.prompt);
    console.log(`  ℹ️  Prompt real: chars=${measurement.chars} estimatedTokens=${measurement.estimatedTokens} level=${measurement.level} (umbral CRITICAL Phase 2: >${PHASE2_BUDGET.warningMaxChars} chars)`);
    assert(measurement.level === 'CRITICAL', `El prompt real construido para esta evidencia se clasifica como CRITICAL (obtenido: ${measurement.level})`);
    assert(shouldBlockBeforeSending(measurement) === true, 'shouldBlockBeforeSending() clasifica correctamente que este payload "debería" bloquearse antes de enviarse');

    // --- 2. ENFORCEMENT (verificado por separado, dinámicamente) ---
    assert(!callHappened, 'CORREGIDO (J2): la llamada al cliente de Gemini (mockeado) NUNCA ocurrió — ai.service.ts bloqueó el payload CRITICAL antes de construir la solicitud');
    assert(capturedContentsLength === -1, `CORREGIDO (J2): ningún contenido llegó al punto de llamada (capturedContentsLength=${capturedContentsLength}, valor inicial nunca sobrescrito)`);
    assert(result.rawAiFindings.length === 0, 'CORREGIDO (J2): el resultado del pipeline no contiene findings de IA inventados -- performAuditAnalysis devolvió el resultado sintético de bloqueo');

    console.log(
      '  ℹ️  CONCLUSIÓN (clasificación Y enforcement, post-J2): el sistema SABE que este payload es CRITICAL (aserciones 1-2) ' +
      'y, en consecuencia, NUNCA lo envía (aserciones 3-5) — la clasificación ahora sí actúa. ' +
      'Este es el mismo gap confirmado dinámicamente en Fase G y estáticamente en F8, cerrado por J2 (Hardening Post-Fase H).',
    );
  } finally {
    (client as any).client.models.generateContent = original;
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
