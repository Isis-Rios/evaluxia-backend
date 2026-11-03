import { matchFindings, ExpectedFinding } from '@/shared/testing/finding-matching';
import { buildEvidenceIndex } from '@/modules/evaluations/services/evidence-traceability.service';
import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';

/**
 * Hardening post Gemini Real #1 — hallazgo B: contrato canónico
 * `property`/`attribute` sobre evidence items. `property` es el nombre
 * autoritativo (Gemini y la mayoría de reglas determinísticas ya lo usan);
 * `attribute` es un alias legacy (lo usaban `analyzeImages`/`analyzeLinks`
 * antes de esta fase, ya migradas). Estas pruebas confirman que los dos
 * consumidores que NO normalizaban (`finding-matching.ts` y
 * `AuditMetricsService.mergeEvidence`) ahora leen ambos nombres por igual
 * -- matriz adversarial sobre varias propiedades reales del sistema.
 *
 * Gemini calls: 0. Todo sintético/determinístico.
 */

function expectedFinding(id: string, props: string[]): ExpectedFinding {
  return {
    id, problemType: `test-${id}`, criterion: 'WCAG 1.1.1', relevantSelectors: ['#x'],
    expectedStatus: 'FAIL', minimumEvidence: props.map((property) => ({ property, expectedRealValue: 'x' })),
  };
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

function runPropertyAttributeContractTests() {
  console.log('🧪 Starting property/attribute contract (hallazgo B) tests...\n');

  // Matriz: matcher (minimumEvidenceFullyCited/evidencePropertyOverlap) debe
  // reconocer una propiedad citada bajo `attribute` tan bien como bajo
  // `property` -- cada propiedad con su propio índice sintético e índice
  // real correcto (J6 debe devolver CONSISTENT, no solo "campo reconocido").
  const PROPERTY_MATRIX: Array<{ property: string; kind: 'image' | 'link' | 'formElement' | 'computedStyle'; record: Record<string, unknown>; value: string }> = [
    { property: 'alt', kind: 'image', record: { selector: '#x', src: '/x.png', alt: 'Logo', ariaLabel: null, role: null, isDecorative: false }, value: 'Logo' },
    { property: 'href', kind: 'link', record: { selector: '#x', text: 'Ir', href: '/destino', ariaLabel: null, role: null, isExternal: false }, value: '/destino' },
    { property: 'ariaLabel', kind: 'link', record: { selector: '#x', text: 'Ir', href: '/destino', ariaLabel: 'Ir a destino', role: null, isExternal: false }, value: 'Ir a destino' },
    { property: 'text', kind: 'link', record: { selector: '#x', text: 'Leer más', href: '/destino', ariaLabel: null, role: null, isExternal: false }, value: 'Leer más' },
    { property: 'placeholder', kind: 'formElement', record: { selector: '#x', type: 'text', name: 'x', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: false, placeholder: 'Empresa', ariaInvalid: false }, value: 'Empresa' },
    { property: 'name', kind: 'formElement', record: { selector: '#x', type: 'text', name: 'empresa', label: null, ariaLabel: null, ariaLabelledBy: null, ariaDescribedBy: null, required: false, placeholder: null, ariaInvalid: false }, value: 'empresa' },
  ];
  for (const { property, kind, record, value } of PROPERTY_MATRIX) {
    const index = buildEvidenceIndex({
      evidencesSummary: [{
        iteration: 1, headings: [], forms: kind === 'formElement' ? [{ selector: 'form', name: null, action: null, elements: [record] } as any] : [],
        images: kind === 'image' ? [record as any] : [], computedStyles: [],
      }],
      dedupedLandmarks: [], dedupedLinks: kind === 'link' ? [{ ...record, iterations: [1] } as any] : [], dedupedButtons: [],
    });
    const ef = expectedFinding(`EF-${property}`, [property]);
    const real = { status: 'FAIL', wcagCriterion: 'WCAG 1.1.1', affectedElement: { selector: '#x' }, evidence: [{ attribute: property, value, selector: '#x' }] };
    const r = matchFindings([ef], [real], index);
    expect(r.counts.TP_EXACT === 1, `Matcher: property="${property}" citado bajo "attribute" (legacy) + valor real correcto -> TP_EXACT (J6 CONSISTENT, minimumEvidence satisfecho).`, r.counts);
  }

  // contrastRatio por separado: es una propiedad DERIVADA (ver J6
  // DERIVED_PROPERTY_RESOLVERS, Fase I.3.1) -- confirma que el matcher
  // también la reconoce bajo "attribute".
  {
    const index = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], forms: [], images: [], computedStyles: [{ selector: '#x', tag: 'p', text: 'x', color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', fontSize: '16px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' } as any] }],
      dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
    });
    const ef = expectedFinding('EF-contrastRatio', ['contrastRatio']);
    const real = { status: 'FAIL', wcagCriterion: 'WCAG 1.1.1', affectedElement: { selector: '#x' }, evidence: [{ attribute: 'contrastRatio', value: '18.88:1', selector: '#x' }] };
    const r = matchFindings([ef], [real], index);
    expect(r.counts.TP_EXACT === 1, 'Matcher: property="contrastRatio" (derivada) citada bajo "attribute" -> TP_EXACT.', r.counts);
  }

  // mergeEvidence: un item citado bajo `attribute` y otro bajo `property` con
  // el MISMO type+selector+property-lógico+value deben deduplicarse (no
  // producir 2 entradas de evidencia para el mismo dato).
  {
    const detFinding: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'det', wcagCriterion: 'WCAG 1.1.1', affectedElement: { selector: '#y' },
      evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: 'null', selector: '#y' }],
      iteration: 1, origin: 'deterministic',
    };
    const aiFinding: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'ai', wcagCriterion: 'WCAG 1.1.1', affectedElement: { selector: '#y' },
      evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'null', selector: '#y' }],
      iteration: 1, origin: 'ai',
    };
    const [c] = auditMetricsService.deduplicateFindings([detFinding, aiFinding]);
    expect(c.evidence?.length === 1, 'mergeEvidence: mismo dato citado bajo "attribute" (det) y "property" (IA) -> deduplicado a 1 ítem, no 2.', c.evidence);
  }

  // mergeEvidence: el guard de contrastRatio (preferir el determinístico)
  // debe reconocer contrastRatio sin importar si se citó bajo `attribute` o `property`.
  {
    const detFinding: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'det contraste', wcagCriterion: 'WCAG 1.4.3', affectedElement: { selector: '#z' },
      evidence: [{ type: 'COMPUTED_STYLE', attribute: 'contrastRatio', value: '2.32:1', selector: '#z' }],
      iteration: 1, origin: 'deterministic',
    };
    const aiFinding: InputAuditFinding = {
      findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high',
      description: 'ai contraste', wcagCriterion: 'WCAG 1.4.3', affectedElement: { selector: '#z' },
      evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '3.12:1', selector: '#z' }],
      iteration: 1, origin: 'ai',
    };
    const [c] = auditMetricsService.deduplicateFindings([detFinding, aiFinding]);
    const ratios = c.evidence?.map((e: any) => e.value);
    expect(ratios?.length === 1 && ratios[0] === '2.32:1', 'mergeEvidence: guard de contrastRatio reconoce la propiedad citada bajo "attribute" (det) y descarta el "property" de IA (3.12:1) -- preserva el determinístico.', ratios);
  }

  console.log(`\n🎉 ALL property/attribute contract (hallazgo B) tests passed (${passed} assertions).`);
  process.exit(0);
}

runPropertyAttributeContractTests();
