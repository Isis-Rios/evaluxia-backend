import { deterministicAnalyzer } from '../services/deterministic-analyzer.service';
import { buildEvidenceIndex } from '../services/evidence-traceability.service';
import { matchFindings, ExpectedFinding } from '@/shared/testing/finding-matching';
import { countWcagCodesInCriterion } from '@/shared/testing/wcag-criterion-cardinality';

/**
 * Fase I.2 — analyzeForms (WCAG 3.3.2, determinístico) tests.
 * Gemini calls: 0. Todo determinístico, sin mocks de Gemini.
 */

function snapshot(overrides: any = {}) {
  return {
    iteration: 1,
    url: 'https://fixture.local/forms-test',
    screenshotPath: '/x.png',
    headings: [],
    images: [],
    links: [],
    buttons: [],
    forms: [],
    landmarks: [],
    computedStyles: [],
    ...overrides,
  };
}

function formElement(overrides: any) {
  return {
    selector: '[name="x"]', type: 'text', name: 'x', label: null, ariaLabel: null,
    ariaLabelledBy: null, ariaDescribedBy: null, required: false, placeholder: null, ariaInvalid: false,
    ...overrides,
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

function findingFor(findings: any[], selector: string) {
  return findings.find((f) => f.affectedElement?.selector === selector && f.wcagCriterion === 'WCAG 3.3.2 Etiquetas o instrucciones');
}

function runDeterministicFormsTests() {
  console.log('🧪 Starting Fase I.2 — analyzeForms tests...\n');

  // Test 1: input con label asociado (for/id) -> PASS
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#email', label: 'Correo electrónico' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#email');
    expect(f?.status === 'PASS', 'Test 1: label asociado (for/id) -> PASS.', f);
  }

  // Test 2: input con label envolvente -> PASS
  // NOTA (limitación de evidencia documentada, no inventada): el extractor
  // (automation.service.ts) resuelve AMBOS mecanismos (for/id y wrapping) al
  // MISMO campo `label` (texto ya resuelto) -- la evidencia no distingue
  // CÓMO se asoció el label, solo que existe. Este test ejercita el mismo
  // branch de código que el Test 1 porque, a este nivel de evidencia, ambos
  // casos son indistinguibles -- no se puede fingir una distinción que la
  // evidencia no sostiene.
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#nombre', label: 'Nombre completo' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#nombre');
    expect(f?.status === 'PASS', 'Test 2: label envolvente -> PASS (mismo mecanismo evidencial que Test 1, documentado).', f);
  }

  // Test 3: input con aria-label -> PASS
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#search', ariaLabel: 'Buscar productos' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#search');
    expect(f?.status === 'PASS' && f.evidence[0].property === 'ariaLabel', 'Test 3: aria-label -> PASS, evidencia cita la propiedad correcta.', f);
  }

  // Test 4 + 10: input con SOLO aria-labelledby -> NOT_EVALUABLE (no PASS, no FAIL)
  // DECISIÓN DE DISEÑO EXPLÍCITA: automation.service.ts captura únicamente
  // el string de referencia (el atributo crudo), NUNCA resuelve el texto del
  // elemento apuntado -- la evidencia demuestra que la referencia EXISTE,
  // pero no que produzca un nombre accesible real. Forzar PASS inventaría
  // una demostración inexistente; forzar FAIL violaría la instrucción
  // explícita de no convertir ausencia de evidencia en FAIL automático.
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#qty', ariaLabelledBy: 'qty-heading' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#qty');
    expect(f?.status === 'NOT_EVALUABLE' && f.confidence === 'low', 'Test 4/10: solo aria-labelledby -> NOT_EVALUABLE (evidencia insuficiente para demostrar la relación), nunca FAIL ni PASS forzado.', f);
  }

  // Test 5: input sin label/nombre -> FAIL
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '[name="email"]', type: 'email', placeholder: 'Correo electrónico' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '[name="email"]');
    expect(f?.status === 'FAIL' && f.severity === 'high', 'Test 5: input sin ninguna fuente de nombre accesible -> FAIL, severity alta.', f);
  }

  // Test 6: select sin label/nombre -> FAIL
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#country', type: 'select' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#country');
    expect(f?.status === 'FAIL', 'Test 6: select sin nombre accesible -> FAIL.', f);
  }

  // Test 7: textarea sin label/nombre -> FAIL
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '#comments', type: 'textarea' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#comments');
    expect(f?.status === 'FAIL', 'Test 7: textarea sin nombre accesible -> FAIL.', f);
  }

  // Test 8: múltiples controles, algunos correctos y otros incorrectos -> sin contaminación
  {
    const ev = snapshot({
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [
          formElement({ selector: '#ok1', label: 'Nombre' }),
          formElement({ selector: '#bad1' }),
          formElement({ selector: '#ok2', ariaLabel: 'Teléfono' }),
          formElement({ selector: '#bad2', type: 'select' }),
        ],
      }],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    expect(findingFor(findings, '#ok1')?.status === 'PASS', 'Test 8a: #ok1 -> PASS.');
    expect(findingFor(findings, '#bad1')?.status === 'FAIL', 'Test 8b: #bad1 -> FAIL, sin contaminarse por #ok1.');
    expect(findingFor(findings, '#ok2')?.status === 'PASS', 'Test 8c: #ok2 -> PASS.');
    expect(findingFor(findings, '#bad2')?.status === 'FAIL', 'Test 8d: #bad2 -> FAIL, resultados totalmente independientes.');
  }

  // Test 9: controles tipo botón dentro de <form> -> comportamiento EXPLÍCITO: excluidos de analyzeForms (siguen siendo 100% responsabilidad de analyzeButtons/WCAG 4.1.2, sin duplicar el finding)
  {
    const ev = snapshot({
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [
          formElement({ selector: 'button[type="submit"]', type: 'submit' }),
          formElement({ selector: 'button.reset', type: 'button' }),
        ],
      }],
      buttons: [
        { selector: 'button[type="submit"]', tag: 'button', text: 'Enviar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true },
      ],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const formFindingsFor333 = findings.filter((f: any) => f.wcagCriterion === 'WCAG 3.3.2 Etiquetas o instrucciones');
    expect(formFindingsFor333.length === 0, 'Test 9: controles tipo botón (submit/button) dentro de <form> son excluidos de analyzeForms -- 0 findings 3.3.2 para ellos (evita duplicar con analyzeButtons/4.1.2).', formFindingsFor333);
    const buttonFinding = findings.find((f: any) => f.wcagCriterion === 'WCAG 4.1.2 Nombre, función y valor' && f.affectedElement?.selector === 'button[type="submit"]');
    expect(!!buttonFinding, 'Test 9b: el botón sigue siendo evaluado normalmente por analyzeButtons (4.1.2), sin interferencia.', buttonFinding);
  }

  // Test 11: dos controles con resultados diferentes -> findings independientes (ya demostrado en Test 8, reafirmado con conteo exacto)
  {
    const ev = snapshot({
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [formElement({ selector: '[name="email"]', placeholder: 'Correo' }), formElement({ selector: '[name="password"]', label: 'Contraseña' })],
      }],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const form333Findings = findings.filter((f: any) => f.wcagCriterion === 'WCAG 3.3.2 Etiquetas o instrucciones');
    expect(form333Findings.length === 2, 'Test 11: 2 controles -> exactamente 2 findings 3.3.2 independientes.', form333Findings.length);
    expect(findingFor(findings, '[name="email"]')?.status === 'FAIL' && findingFor(findings, '[name="password"]')?.status === 'PASS', 'Test 11b: cada uno con su status correcto, sin mezclarse.');
  }

  // Test 12: ningún control candidato -> no generar findings
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const form333Findings = findings.filter((f: any) => f.wcagCriterion === 'WCAG 3.3.2 Etiquetas o instrucciones');
    expect(form333Findings.length === 0, 'Test 12: sin elementos de formulario -> 0 findings 3.3.2.', form333Findings.length);
  }

  // Test 13: nunca más de un código WCAG por finding (reutiliza el helper ya existente de cardinalidad, no reimplementado)
  {
    const ev = snapshot({
      forms: [{
        selector: 'form', name: null, action: null,
        elements: [formElement({ selector: '#a' }), formElement({ selector: '#b', label: 'x' }), formElement({ selector: '#c', ariaLabelledBy: 'y' })],
      }],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const form333Findings = findings.filter((f: any) => f.wcagCriterion === 'WCAG 3.3.2 Etiquetas o instrucciones');
    expect(form333Findings.every((f: any) => countWcagCodesInCriterion(f.wcagCriterion) === 1), 'Test 13: cada finding de analyzeForms contiene exactamente 1 código WCAG (reutilizando countWcagCodesInCriterion existente).', form333Findings);
  }

  // Test 14: selector/evidencia del finding corresponde exactamente al control real
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '[data-testid="unique-selector-42"]' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '[data-testid="unique-selector-42"]');
    expect(
      f?.affectedElement?.selector === '[data-testid="unique-selector-42"]' && f.evidence.every((e: any) => e.selector === '[data-testid="unique-selector-42"]'),
      'Test 14: selector del finding y de TODOS los ítems de evidencia coinciden exactamente con el control real.',
      f,
    );
  }

  // Test 15: regresión -- analyzeForms convive con las 5 reglas existentes sin alterarlas (mismo snapshot con contraste + imagen + botón + link + heading + forms)
  {
    const ev = snapshot({
      headings: [],
      images: [{ selector: 'img.deco', src: 'x.png', alt: '', ariaLabel: null, role: null, isDecorative: true }],
      links: [{ selector: 'a.real', text: 'Ver más', href: '/x', ariaLabel: null, role: null, isExternal: false }],
      buttons: [{ selector: 'button.ok', tag: 'button', text: 'Enviar', ariaLabel: null, role: null, isDisabled: false, isPrimary: true }],
      computedStyles: [{ selector: 'p.low-contrast', tag: 'p', text: 'texto', color: 'rgb(200,200,200)', backgroundColor: 'rgb(255,255,255)', fontSize: '14px', fontWeight: '400', lineHeight: 'normal', fontFamily: 'Arial' }],
      forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '[name="email"]' })] }],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const byCriterion = (c: string) => findings.filter((f: any) => f.wcagCriterion === c);
    expect(byCriterion('WCAG 1.1.1 Contenido no textual').length === 1, 'Test 15a: regla de imágenes (1.1.1) sigue funcionando, no alterada.');
    expect(byCriterion('WCAG 2.4.4 Propósito de los enlaces').length === 1, 'Test 15b: regla de enlaces (2.4.4) sigue funcionando.');
    expect(byCriterion('WCAG 4.1.2 Nombre, función y valor').length === 1, 'Test 15c: regla de botones (4.1.2) sigue funcionando.');
    expect(byCriterion('WCAG 1.4.3 Contraste (Mínimo)').length === 1, 'Test 15d: regla de contraste (1.4.3) sigue funcionando.');
    expect(byCriterion('WCAG 3.3.2 Etiquetas o instrucciones').length === 1, 'Test 15e: analyzeForms (3.3.2) convive con las demás sin interferir.');
  }

  // ===== Sección 8 del pedido: validar que los findings de analyzeForms son clasificables por el matcher de Fase I.1, sin nueva lógica =====
  {
    const ev = snapshot({ forms: [{ selector: 'form', name: null, action: null, elements: [formElement({ selector: '[name="email"]', placeholder: 'Correo electrónico' })] }] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);

    const evidenceIndex = buildEvidenceIndex({
      evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: ev.forms, computedStyles: [] } as any],
      dedupedLandmarks: [], dedupedLinks: [], dedupedButtons: [],
    });

    const expected: ExpectedFinding[] = [
      { id: 'EF-FORM-001', problemType: 'missing-form-label', criterion: 'WCAG 3.3.2', relevantSelectors: ['[name="email"]'], expectedStatus: 'FAIL', minimumEvidence: [{ property: 'label', expectedRealValue: null }] },
    ];
    const summary = matchFindings(expected, findings as any, evidenceIndex);
    expect(summary.counts.TP_EXACT === 1, 'Sección 8: un finding real de analyzeForms (FAIL) es clasificado TP_EXACT por el matcher de Fase I.1 sin ninguna lógica nueva.', summary.counts);
  }

  console.log(`\n🎉 ALL Fase I.2 analyzeForms tests passed (${passed} assertions).`);
  process.exit(0);
}

runDeterministicFormsTests();
