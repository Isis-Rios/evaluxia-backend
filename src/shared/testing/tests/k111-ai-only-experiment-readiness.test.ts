import { EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { runMockedPhase2Pipeline, stubGeminiJsonResponses, buildValidAuditOutputJson } from '@/shared/testing/gemini-mock-harness';
import { matchFindings, ExpectedFinding } from '@/shared/testing/finding-matching';
import { loadFixture } from '@/shared/testing/fixture-loader';

/**
 * Fase K.1.1 — Parte M: mocks de preparación para el experimento AI-only.
 *
 * Candidato PRINCIPAL: EF-017 ("ambiguous-link-destination-nielsen", N-04),
 * agregado en esta fase al Ground Truth real de Landing V1 -- NO se tocó el
 * HTML, solo se agregó una nueva lectura (Nielsen) sobre contenido YA
 * existente (los 2 enlaces "Leer más"). Ver justificación completa en el
 * reporte final (Parte D/E).
 *
 * DESCUBRIMIENTO DURANTE ESTA FASE (no asumido, confirmado con un mock
 * real, ver M-EF016 abajo): EF-016 (WCAG 2.4.4, ya existente desde Fase
 * I.3) NUNCA puede resultar en TP bajo la arquitectura actual, sin importar
 * qué produzca Gemini -- el determinístico (analyzeLinks) ya escribe un
 * PASS decisivo para el MISMO criterio+selector, y la política de
 * consolidación (determinístico gana ante discrepancia) enmascara
 * cualquier FAIL de Gemini bajo ese PASS a nivel de `status` consolidado;
 * el matcher de Ground Truth juzga por `status`, nunca por `discrepancy`.
 * Por eso EF-017 (Nielsen N-04, clave de dedup distinta, CERO colisión) es
 * el candidato elegido para responder la pregunta real de esta fase.
 *
 * Objetivo de este archivo: rehearsar TODO el pipeline (Gemini mockeado ->
 * J1 -> cardinalidad -> J6 -> consolidación -> Ground Truth matcher) con el
 * mecanismo REAL de producción, usando la evidencia REAL de los 2 enlaces
 * "Leer más" de `landing-v1.html` (selectors/text/href reales, no
 * inventados), ANTES de autorizar la única llamada real. Ningún mock aquí
 * demuestra qué hará Gemini de verdad -- solo que, SI Gemini produjera cada
 * una de estas respuestas posibles, el pipeline la procesaría correctamente.
 *
 * Gemini calls: 0.
 */

const fixture = loadFixture('landing/landing-v1.html');
const EF_016 = fixture.groundTruth.expectedFindings!.find((e) => e.id === 'EF-016')!;
const EF_017 = fixture.groundTruth.expectedFindings!.find((e) => e.id === 'EF-017')!;

function landingLinksEvidence(): EvidenceInput[] {
  return [{
    iteration: 1, url: 'https://fixture.local/landing/landing-v1.html', screenshotPath: '/x.png',
    headings: [], images: [], buttons: [], forms: [], landmarks: [], computedStyles: [],
    links: [
      { selector: '#gt-link-leer-mas-1', text: 'Leer más', href: '/planes/basico', ariaLabel: null, role: null, isExternal: false },
      { selector: '#gt-link-leer-mas-2', text: 'Leer más', href: '/planes/pro', ariaLabel: null, role: null, isExternal: false },
    ],
  }];
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

async function runReadinessMocks() {
  console.log('🧪 Starting K.1.1 — AI-only experiment readiness mocks (EF-017 principal, EF-016 limitación conocida)...\n');

  expect(EF_017 !== undefined && EF_017.verifiableBy === 'ai' && EF_017.criterion === 'N-04', 'Precondición: EF-017 existe en el Ground Truth real de Landing V1, verifiableBy="ai", criterion="N-04".', EF_017);

  // M-EF016: CONFIRMA el límite arquitectónico de EF-016 (no es el candidato
  // de este experimento, pero se documenta con un mock real, no se asume).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'medium', confidence: 'high',
        wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
        description: 'Dos enlaces "Leer más" con el mismo texto llevan a destinos distintos.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' }],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto de enlace único y descriptivo para cada destino.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-ef016' });
      const gt = matchFindings([EF_016 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      const consolidated = result.metrics.consolidatedFindings.find((f: any) => f.affectedElement?.selector === '#gt-link-leer-mas-1' && f.wcagCriterion?.includes('2.4.4'));
      // FP=2 (no 1): EF-016 declara AMBOS selectores -- el selector #2 (que
      // Gemini ni siquiera mencionó en este mock) también tiene un PASS
      // determinístico puro que contradice el expectedStatus=FAIL de
      // EF-016 para ESE selector también. Esto reproduce EXACTAMENTE lo ya
      // observado en Gemini Real #1 (consolidado #27/#28, ambos FP).
      expect(gt.counts.FP === 2 && gt.counts.FN === 1 && consolidated?.status === 'PASS' && consolidated?.discrepancy?.status === 'FAIL', 'M-EF016 (límite conocido, confirmado, reproduce Gemini Real #1): AUNQUE Gemini acierte exactamente, EF-016 produce FP+FN -- el determinístico (PASS) enmascara el FAIL de Gemini a nivel de status consolidado; el FAIL real sobrevive SOLO en discrepancy, invisible para el matcher. Por esto EF-016 no es el candidato principal.', { counts: gt.counts, consolidatedStatus: consolidated?.status, discrepancy: consolidated?.discrepancy });
    } finally { stub.restore(); }
  }

  // M1: Gemini encuentra el finding correcto (N-04, evidencia real, ambos selectores) -> TP.
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'El uso de enlaces genéricos "Leer más" para distintas áreas de contenido es inconsistente.',
        evidence: [
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' },
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-2' },
        ],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto de enlace único y descriptivo para cada destino, en vez de repetir "Leer más".',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m1' });
      const gt = matchFindings([EF_017 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      expect(gt.counts.TP_EXACT === 1 || gt.counts.TP_SEMANTIC === 1, 'M1: Gemini encuentra el finding correcto (N-04) -> TP (sin colisión con ningún PASS determinístico).', gt.counts);
    } finally { stub.restore(); }
  }

  // M2: Gemini NO encuentra el finding -> FN.
  {
    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([])]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m2' });
      const gt = matchFindings([EF_017 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      expect(gt.counts.FN === 1, 'M2: Gemini no encuentra el finding -> FN.', gt.counts);
    } finally { stub.restore(); }
  }

  // M3: Gemini inventa un selector inexistente -> J1 lo degrada (bloqueado).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'Enlaces inconsistentes.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#selector-fantasma-inventado' }],
        affectedElement: { tag: 'a', selector: '#selector-fantasma-inventado' },
        recommendation: 'Usar texto único.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m3' });
      expect(result.validatedAiFindings[0]?.status === 'NOT_EVALUABLE', 'M3: selector inventado -> J1 degrada a NOT_EVALUABLE (bloqueado).', result.validatedAiFindings[0]);
    } finally { stub.restore(); }
  }

  // M4: Gemini cita una propiedad inexistente -> J6 la detecta (INSUFFICIENT).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'Enlaces inconsistentes.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'colorDeFondo', value: 'azul', selector: '#gt-link-leer-mas-1' }],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto único.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m4' });
      expect(result.j6Summary.insufficient === 1 && result.validatedAiFindings[0]?.status === 'NOT_EVALUABLE', 'M4: propiedad inexistente -> J6 INSUFFICIENT -> degradado.', { j6Summary: result.j6Summary, status: result.validatedAiFindings[0]?.status });
    } finally { stub.restore(); }
  }

  // M5: Gemini cita un valor incorrecto -> J6 lo detecta (INCONSISTENT).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'Enlaces inconsistentes.',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Haz clic aquí', selector: '#gt-link-leer-mas-1' }],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto único.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m5' });
      expect(result.j6Summary.inconsistent === 1 && result.validatedAiFindings[0]?.status === 'NOT_EVALUABLE', 'M5: valor citado incorrecto -> J6 INCONSISTENT -> degradado.', { j6Summary: result.j6Summary, status: result.validatedAiFindings[0]?.status });
    } finally { stub.restore(); }
  }

  // M6: Gemini produce un heurístico no soportado -> UNMATCHED, nunca FP.
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-99', heuristicName: 'Heurística inexistente',
        description: 'Enlaces inconsistentes (heurística inventada).',
        evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' }],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto único.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m6' });
      const gt = matchFindings([EF_017 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      // UNMATCHED=3: el finding de Gemini con heurístico inventado (1) + los
      // 2 PASS determinísticos de analyzeLinks bajo WCAG 2.4.4 (criterio
      // distinto a N-04, nunca colisionan con EF-017) -- ninguno es FP.
      expect(gt.counts.FP === 0 && gt.counts.UNMATCHED === 3 && gt.counts.FN === 1, 'M6: heurístico no soportado -> UNMATCHED (no colisiona por criterio), EF-017 sigue sin cubrir -> FN, nunca FP.', gt.counts);
    } finally { stub.restore(); }
  }

  // M7: Gemini produce el finding correcto + ruido -> el correcto sobrevive.
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([
        { findingGroup: 'ux', type: 'usability', status: 'NOT_EVALUABLE', severity: 'info', confidence: 'high', description: 'Ruido.', evidence: [] },
        {
          findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
          heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
          description: 'El uso de enlaces genéricos "Leer más" es inconsistente.',
          evidence: [
            { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' },
            { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-2' },
          ],
          affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
          recommendation: 'Usar texto único para cada destino.',
        },
      ]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m7' });
      const gt = matchFindings([EF_017 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      expect(gt.counts.TP_EXACT === 1 || gt.counts.TP_SEMANTIC === 1, 'M7: finding correcto + ruido irrelevante -> el finding correcto sigue siendo TP.', gt.counts);
    } finally { stub.restore(); }
  }

  // M8: la consolidación NO elimina silenciosamente el finding AI-only (y, a diferencia de EF-016, aquí NO hay PASS determinístico que lo enmascare -- debe sobrevivir con SU PROPIO status, sin necesitar discrepancy).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'El uso de enlaces genéricos "Leer más" es inconsistente.',
        evidence: [
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' },
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-2' },
        ],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto único para cada destino.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m8' });
      const consolidated = result.metrics.consolidatedFindings.find((f: any) => f.affectedElement?.selector === '#gt-link-leer-mas-1' && f.heuristicCode === 'N-04');
      expect(consolidated?.status === 'FAIL' && consolidated?.discrepancy === undefined, 'M8: el finding AI-only (N-04) sobrevive con SU PROPIO status FAIL -- sin colisión determinística, no necesita discrepancy, no se pierde en ninguna etapa.', consolidated);
    } finally { stub.restore(); }
  }

  // M9: finding duplicado -> deduplicado, no infla TP.
  {
    const dup = {
      findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
      heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
      description: 'El uso de enlaces genéricos "Leer más" es inconsistente.',
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' }],
      affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
      recommendation: 'Usar texto único.',
    };
    const stub = stubGeminiJsonResponses([buildValidAuditOutputJson([dup, { ...dup }])]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m9' });
      const gt = matchFindings([EF_017 as ExpectedFinding], result.metrics.consolidatedFindings as any, result.evidenceIndex);
      expect(gt.counts.TP_EXACT === 1 || gt.counts.TP_SEMANTIC === 1, 'M9: 2 findings de Gemini idénticos -> deduplicados antes del matcher (sin inflar TP).', gt.counts);
    } finally { stub.restore(); }
  }

  // M10: evidencia contextual legítima (ambos selectores citados) -> Gate Rule 0b NO bloquea (self-grounding presente).
  {
    const stub = stubGeminiJsonResponses([
      buildValidAuditOutputJson([{
        findingGroup: 'ux', type: 'content', status: 'FAIL', severity: 'medium', confidence: 'high',
        heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares',
        description: 'El uso de enlaces genéricos "Leer más" es inconsistente -- comparación explícita.',
        evidence: [
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-1' },
          { type: 'DOM_ATTRIBUTE', property: 'text', value: 'Leer más', selector: '#gt-link-leer-mas-2' },
        ],
        affectedElement: { tag: 'a', selector: '#gt-link-leer-mas-1' },
        recommendation: 'Usar texto único para cada destino.',
      }]),
    ]);
    try {
      const result = await runMockedPhase2Pipeline(landingLinksEvidence(), { evaluationId: 'k111-m10' });
      expect(result.validatedAiFindings[0]?.status === 'FAIL', 'M10: evidencia contextual legítima de un segundo elemento, CON grounding propio real -> Gate Rule 0b NO bloquea.', result.validatedAiFindings[0]);
    } finally { stub.restore(); }
  }

  console.log(`\n🎉 K.1.1 AI-only experiment readiness mocks completados (${passed} aserciones: EF-016 límite confirmado + M1-M10 sobre EF-017).`);
  process.exit(0);
}

runReadinessMocks().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
