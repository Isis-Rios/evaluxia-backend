import { deterministicAnalyzer } from '../services/deterministic-analyzer.service';
import { buildEvidenceIndex } from '../services/evidence-traceability.service';
import { checkClaimConsistency } from '../services/evidence-claim-consistency.service';

/**
 * Fase I.3.2 — analyzeButtons, sourceProperty/sourceValue (discrepancia 4,
 * reportada en Fase I.3.1 y corregida aquí) tests.
 * Gemini calls: 0. Todo determinístico, sin mocks de Gemini.
 *
 * Contexto: analyzeButtons citaba siempre `attribute: 'aria-label'` (con
 * guion, nombre inexistente en la whitelist -- el campo real es
 * `ariaLabel`), sin importar si el valor realmente provenía de `ariaLabel`
 * o de `text`. Esto causaba PROPERTY_NOT_FOUND -> INSUFFICIENT ->
 * NOT_EVALUABLE para TODO finding de botón al pasar por J6/el matcher.
 * Corregido con el mismo mecanismo sourceProperty/sourceValue que
 * analyzeForms (Fase I.2) ya usa: se cita la propiedad REAL de la que
 * proviene el valor (ariaLabel o text), con la misma prioridad que el
 * código previo ya aplicaba para elegir el valor (ariaLabel > text).
 */

function snapshot(overrides: any = {}) {
  return {
    iteration: 1,
    url: 'https://fixture.local/buttons-test',
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

function button(overrides: any) {
  return {
    selector: 'button.x', tag: 'button', text: null, ariaLabel: null, role: null, isDisabled: false, isPrimary: false,
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
  return findings.find((f) => f.affectedElement?.selector === selector && f.wcagCriterion === 'WCAG 4.1.2 Nombre, función y valor');
}

function indexFor(selector: string, record: Record<string, unknown>) {
  return buildEvidenceIndex({
    evidencesSummary: [{ iteration: 1, headings: [], images: [], forms: [], computedStyles: [], buttons: [{ selector, tag: 'button', isDisabled: false, isPrimary: false, role: null, text: null, ariaLabel: null, ...record } as any] } as any],
    dedupedLandmarks: [],
    dedupedLinks: [],
    dedupedButtons: [{ selector, tag: 'button', isDisabled: false, isPrimary: false, role: null, text: null, ariaLabel: null, ...record, iterations: [1] } as any],
  });
}

function runDeterministicButtonsTests() {
  console.log('🧪 Starting Fase I.3.2 — analyzeButtons (sourceProperty/sourceValue) tests...\n');

  // Test 1 (Caso A): botón con texto visible -> PASS, evidencia cita 'text'
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-text', text: 'Comprar' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-text');
    const item = f?.evidence?.[0];
    expect(f?.status === 'PASS' && item?.property === 'text' && item?.value === 'Comprar', 'Test 1 (Caso A): botón con texto visible -> PASS, evidencia cita property="text", value="Comprar" (no "ariaLabel" inventado).', item);
  }

  // Test 2 (Caso B): botón con aria-label -> PASS, evidencia cita 'ariaLabel'
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-arialabel', ariaLabel: 'Cerrar' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-arialabel');
    const item = f?.evidence?.[0];
    expect(f?.status === 'PASS' && item?.property === 'ariaLabel' && item?.value === 'Cerrar', 'Test 2 (Caso B): botón con aria-label -> PASS, evidencia cita property="ariaLabel", value="Cerrar".', item);
  }

  // Test 3 (Caso C): botón sin nombre -> FAIL, evidencia cita ambos mecanismos como "null"
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-sin-nombre' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-sin-nombre');
    const ariaItem = f?.evidence?.find((e: any) => e.property === 'ariaLabel');
    const textItem = f?.evidence?.find((e: any) => e.property === 'text');
    expect(f?.status === 'FAIL' && ariaItem?.value === 'null' && textItem?.value === 'null', 'Test 3 (Caso C): botón sin nombre -> FAIL, evidencia cita ariaLabel="null" y text="null" (convención, no "missing").', f?.evidence);
  }

  // Test 4 (Caso D): botón con texto Y aria-label -> PASS, prioridad ariaLabel (preexistente, no una heurística nueva)
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-ambos', text: 'Comprar ahora', ariaLabel: 'Comprar producto destacado' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-ambos');
    const item = f?.evidence?.[0];
    expect(f?.status === 'PASS' && item?.property === 'ariaLabel' && item?.value === 'Comprar producto destacado', 'Test 4 (Caso D): ambas fuentes presentes -> prioridad ariaLabel sobre text (misma precedencia que el código previo ya aplicaba al elegir el valor).', item);
  }

  // Test 5: J6 marca CONSISTENT cuando la evidencia realmente coincide (caso texto)
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-j6-text', text: 'Guardar cambios' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-j6-text');
    const index = indexFor('#btn-j6-text', { text: 'Guardar cambios' });
    const r = checkClaimConsistency(f, index);
    expect(r.overallStatus === 'CONSISTENT', 'Test 5: J6 CONSISTENT -- el valor citado (property="text") coincide con el dato real.', r);
  }

  // Test 5b: J6 CONSISTENT también para el caso aria-label
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-j6-aria', ariaLabel: 'Cerrar notificación' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-j6-aria');
    const index = indexFor('#btn-j6-aria', { ariaLabel: 'Cerrar notificación' });
    const r = checkClaimConsistency(f, index);
    expect(r.overallStatus === 'CONSISTENT', 'Test 5b: J6 CONSISTENT -- el valor citado (property="ariaLabel") coincide con el dato real.', r);
  }

  // Test 6: J6 marca INCONSISTENT cuando se altera deliberadamente el valor citado
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-j6-wrong', text: 'Guardar cambios' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-j6-wrong');
    const tampered = { ...f, evidence: [{ ...f.evidence[0], value: 'Texto alterado deliberadamente' }] };
    const index = indexFor('#btn-j6-wrong', { text: 'Guardar cambios' });
    const r = checkClaimConsistency(tampered, index);
    expect(r.overallStatus === 'INCONSISTENT', 'Test 6: J6 INCONSISTENT -- valor citado alterado deliberadamente no coincide con el dato real.', r);
  }

  // Test 7: ya NO aparece NOT_EVALUABLE artificial por usar la propiedad incorrecta
  // (regresión directa del bug original: con 'aria-label' con guion, TODO
  // finding de botón colapsaba a PROPERTY_NOT_FOUND -> INSUFFICIENT ->
  // NOT_EVALUABLE al aplicarse applyClaimConsistency/J6, incluso siendo
  // evidencia real y correcta).
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-no-not-evaluable', text: 'Enviar formulario' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f = findingFor(findings, '#btn-no-not-evaluable');
    const index = indexFor('#btn-no-not-evaluable', { text: 'Enviar formulario' });
    const r = checkClaimConsistency(f, index);
    expect(r.items[0].status !== 'PROPERTY_NOT_FOUND' && r.overallStatus !== 'INSUFFICIENT', 'Test 7: ya no colapsa a PROPERTY_NOT_FOUND/INSUFFICIENT/NOT_EVALUABLE por citar la propiedad equivocada.', r);
  }

  // Test 8: no se crean findings duplicados (1 botón -> exactamente 1 finding WCAG 4.1.2)
  {
    const ev = snapshot({ buttons: [button({ selector: '#btn-unico', text: 'Continuar' })] });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const matches = findings.filter((f: any) => f.affectedElement?.selector === '#btn-unico' && f.wcagCriterion === 'WCAG 4.1.2 Nombre, función y valor');
    expect(matches.length === 1, 'Test 8: un botón produce exactamente 1 finding WCAG 4.1.2, sin duplicados.', matches.length);
  }

  // Test 9: regresión -- múltiples botones mixtos en un mismo snapshot, cada uno con su propio resultado correcto (sin contaminación cruzada)
  {
    const ev = snapshot({
      buttons: [
        button({ selector: '#btn-r1', text: 'Guardar' }),
        button({ selector: '#btn-r2', ariaLabel: 'Cerrar' }),
        button({ selector: '#btn-r3' }),
      ],
    });
    const findings = deterministicAnalyzer.analyzeSnapshots([ev] as any);
    const f1 = findingFor(findings, '#btn-r1');
    const f2 = findingFor(findings, '#btn-r2');
    const f3 = findingFor(findings, '#btn-r3');
    expect(
      f1?.status === 'PASS' && f1?.evidence[0].property === 'text' &&
      f2?.status === 'PASS' && f2?.evidence[0].property === 'ariaLabel' &&
      f3?.status === 'FAIL',
      'Test 9: 3 botones mixtos en un mismo batch -> cada uno con su propio resultado correcto, sin confusión entre ellos.',
      { f1, f2, f3 },
    );
  }

  console.log(`\n🎉 ALL Fase I.3.2 analyzeButtons tests passed (${passed} assertions).`);
  process.exit(0);
}

runDeterministicButtonsTests();
