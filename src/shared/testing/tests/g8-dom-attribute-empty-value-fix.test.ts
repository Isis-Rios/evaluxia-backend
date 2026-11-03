import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { stubGeminiJsonResponses, runMockedPhase2Pipeline, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';

/**
 * Fase G — G8: regression test for the real incident in evaluation `6ae151a7c9e40a501f9cd885`
 * (`https://startbootstrap.com/previews/landing-page`, 2026-10-28): Phase 2
 * exhausted all retries and persisted ZERO findings/Report because
 * `TechnicalEvidenceItemSchema`'s superRefine treated an explicit
 * `value: ""` on a DOM_ATTRIBUTE evidence item identically to a missing
 * `value` — rejecting a real, legitimate observation (e.g. `alt=""`).
 *
 * Parte 1 confirms the fix: `value: ""` is now accepted on the FIRST
 * attempt (no wasted retry, no wasted Gemini cost).
 * Parte 2 confirms a REAL violation (still correctly rejected) produces a
 * bounded `[GeminiContractValidationAudit]` diagnostic log carrying
 * evaluationId/phase/kind, without dumping the full response payload.
 *
 * Gemini calls: 0. Todo mockeado vía stubGeminiJsonResponses (mismo
 * mecanismo ya validado por gemini-resilience.test.ts / G5).
 */
async function main() {
  console.log('🧪 Starting G8 — DOM_ATTRIBUTE empty-value fix + diagnostic logging (real incident regression)...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // ---------------------------------------------------------------------
  // Parte 1: value: "" ya NO requiere retry (el fix real).
  // ---------------------------------------------------------------------
  console.log('--- Parte 1: DOM_ATTRIBUTE value: "" se acepta en el primer intento ---');
  {
    const evidences: EvidenceInput[] = [
      {
        iteration: 1, url: 'https://fixture.local/g6', screenshotPath: '/x.png',
        headings: [],
        images: [{ selector: 'img.decorative', src: '/deco.png', alt: '', ariaLabel: null, role: null, isDecorative: true }],
        links: [], buttons: [], forms: [], landmarks: [], computedStyles: [],
      },
    ];

    const validResponseWithEmptyValue = buildValidAuditOutputJson([
      {
        findingGroup: 'accessibility', status: 'FAIL', severity: 'medium', confidence: 'high',
        wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
        description: 'Imagen decorativa con atributo alt vacío documentado explícitamente.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: '', selector: 'img.decorative' }],
        affectedElement: { tag: 'img', selector: 'img.decorative' },
        recommendation: 'Confirmar que el alt vacío es intencional para contenido decorativo.',
      },
    ]);

    // Segunda respuesta deliberadamente ausente de la lista de válidas: si
    // el fix fallara y SÍ se reintentara, este placeholder haría fallar el
    // JSON.parse de forma obvia en vez de enmascarar el problema.
    const stub = stubGeminiJsonResponses([validResponseWithEmptyValue, '{ esto no debería llamarse nunca']);

    try {
      const result = await runMockedPhase2Pipeline(evidences, { evaluationId: 'g6-empty-value', url: 'https://fixture.local/g6' });
      assert(stub.callCount() === 1, `value: "" se acepta en el PRIMER intento, sin retry (obtenido: ${stub.callCount()} llamadas)`);
      assert(
        result.rawAiFindings.length === 1 && result.rawAiFindings[0]?.evidence?.[0]?.value === '',
        'El valor vacío ("") se preserva tal cual en el finding resultante, no se descarta ni se reescribe',
      );
    } finally {
      stub.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Parte 2: una violación REAL (ni property, ni attribute, ni value)
  // sigue rechazándose, y el nuevo log de diagnóstico queda acotado,
  // identifica evaluationId/phase/motivo, y no filtra el payload completo.
  // ---------------------------------------------------------------------
  console.log('\n--- Parte 2: violación real sigue rechazada; log de diagnóstico acotado y sin fugas ---');
  {
    const canary = 'CANARIO_NO_DEBE_APARECER_EN_EL_LOG_' + 'X'.repeat(400);
    const invalidResponse = JSON.stringify({
      overallScore: 50,
      // Deliberadamente grande e IRRELEVANTE a la ruta que falla -- si el
      // log dumpeara el payload completo, este canario aparecería.
      executiveSummary: canary,
      findings: [
        {
          findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
          wcagCriterion: 'WCAG 1.1.1',
          description: 'Evidencia DOM_ATTRIBUTE sin property, attribute ni value.',
          evidence: [{ type: 'DOM_ATTRIBUTE', selector: 'img.x' }],
          recommendation: 'x',
        },
      ],
    });
    const validEmptyResponse = buildValidAuditOutputJson([]); // segundo intento: válido, recupera el flujo

    const originalConsoleError = console.error;
    const capturedLogs: string[] = [];
    console.error = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(' '));
    };

    const stub = stubGeminiJsonResponses([invalidResponse, validEmptyResponse]);
    try {
      await runMockedPhase2Pipeline(
        [{ iteration: 1, url: 'https://fixture.local/g6b', screenshotPath: '/x.png', headings: [], images: [], links: [], buttons: [], forms: [], landmarks: [], computedStyles: [] }],
        { evaluationId: 'g6-still-invalid', url: 'https://fixture.local/g6b' },
      );
    } finally {
      console.error = originalConsoleError;
      stub.restore();
    }

    const auditLog = capturedLogs.find((l) => l.includes('[GeminiContractValidationAudit]'));
    assert(!!auditLog, 'Se registró un log [GeminiContractValidationAudit] ante una violación real del contrato');
    assert(!!auditLog && auditLog.includes('evaluationId=g6-still-invalid'), 'El log incluye el evaluationId real de la evaluación');
    assert(!!auditLog && auditLog.includes('phase=2'), 'El log incluye la fase (2)');
    assert(!!auditLog && auditLog.includes('kind=ausente'), 'El log distingue "ausente" como motivo real del rechazo (no solo el mensaje genérico de Zod)');
    assert(!!auditLog && !auditLog.includes(canary), 'El log NO incluye el payload completo/irrelevante de Gemini (canario de 400+ caracteres ausente)');
    assert(!!auditLog && !auditLog.includes(String(process.env.GEMINI_API_KEY || '__never__')), 'El log no contiene la API key de Gemini');
    assert(!!auditLog && auditLog.length < 1500, `El log de diagnóstico está acotado, no crece con el tamaño del payload (longitud real: ${auditLog?.length})`);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
