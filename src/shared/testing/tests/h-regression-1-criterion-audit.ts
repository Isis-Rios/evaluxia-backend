import { auditMetricsService, InputAuditFinding } from '@/modules/evaluations/services/audit-metrics.service';

/**
 * Diagnóstico local, sin Gemini: reconstruye los 11 findings EXACTOS de
 * H-REGRESSION-1 (5 determinísticos + 6 de Gemini, texto/criterion
 * verbatim del log real) y los pasa por AuditMetricsService.calculateMetrics
 * REAL para inspeccionar wcagMetrics/consolidatedFindings sin volver a
 * llamar a Gemini.
 */
const deterministicFindings: InputAuditFinding[] = [
  { findingGroup: 'accessibility', type: 'wcag', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor', description: 'Botón con texto', evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'text', value: 'Iniciar sesión', selector: 'button' } as any], affectedElement: { tag: 'button', selector: 'button' }, recommendation: null, iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'accessibility', type: 'wcag', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'h1 contraste ok', evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '15:1', selector: 'h1' } as any], affectedElement: { tag: 'h1', selector: 'h1' }, recommendation: null, iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'accessibility', type: 'wcag', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'email contraste ok', evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '15:1', selector: '[name="email"]' } as any], affectedElement: { tag: 'input', selector: '[name="email"]' }, recommendation: null, iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'accessibility', type: 'wcag', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'password contraste ok', evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '15:1', selector: '[name="password"]' } as any], affectedElement: { tag: 'input', selector: '[name="password"]' }, recommendation: null, iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'accessibility', type: 'wcag', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)', description: 'button contraste ok', evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '5:1', selector: 'button' } as any], affectedElement: { tag: 'button', selector: 'button' }, recommendation: null, iteration: 1, url: 'x', screenshotUrl: 'x' },
];

const aiFindings: InputAuditFinding[] = [
  { findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones', description: 'email sin label', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="email"]' } as any], affectedElement: { tag: 'input', selector: '[name="email"]' }, recommendation: 'Agregar label', iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'accessibility', type: 'wcag', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones, WCAG 4.1.2 Nombre, función y valor, WCAG 1.3.1 Información y relaciones', description: 'password sin label', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: '[name="password"]' } as any], affectedElement: { tag: 'input', selector: '[name="password"]' }, recommendation: 'Agregar label', iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'ux', type: 'usability', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-06', heuristicName: 'Reconocimiento antes que recuerdo', description: 'email placeholder desaparece', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' } as any], affectedElement: { tag: 'input', selector: '[name="email"]' }, recommendation: 'Label persistente', iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'ux', type: 'usability', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-06', heuristicName: 'Reconocimiento antes que recuerdo', description: 'password placeholder desaparece', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Contraseña', selector: '[name="password"]' } as any], affectedElement: { tag: 'input', selector: '[name="password"]' }, recommendation: 'Label persistente', iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'ux', type: 'usability', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares', description: 'email sin label visible, no estándar', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Correo electrónico', selector: '[name="email"]' } as any], affectedElement: { tag: 'input', selector: '[name="email"]' }, recommendation: 'Seguir estándar', iteration: 1, url: 'x', screenshotUrl: 'x' },
  { findingGroup: 'ux', type: 'usability', status: 'FAIL', severity: 'high', confidence: 'high', heuristicCode: 'N-04', heuristicName: 'Consistencia y estándares', description: 'password sin label visible, no estándar', evidence: [{ type: 'DOM_ATTRIBUTE', property: 'placeholder', value: 'Contraseña', selector: '[name="password"]' } as any], affectedElement: { tag: 'input', selector: '[name="password"]' }, recommendation: 'Seguir estándar', iteration: 1, url: 'x', screenshotUrl: 'x' },
];

const metrics = auditMetricsService.calculateMetrics([...deterministicFindings, ...aiFindings]);

console.log('=== consolidatedFindings (criterion field, status) ===');
metrics.consolidatedFindings.forEach((f: any) => console.log(`  selector=${f.affectedElement?.selector} status=${f.status} wcagCriterion=${JSON.stringify(f.wcagCriterion)} heuristicCode=${f.heuristicCode}`));

console.log('\n=== wcagMetrics (compliance map) ===');
console.log(JSON.stringify(metrics.wcagMetrics, null, 2));

console.log('\n=== nielsenMetrics ===');
console.log(JSON.stringify(metrics.nielsenMetrics, null, 2));

console.log(`\noverallScore: ${metrics.overallScore}`);
console.log(`totalFindings: ${metrics.totalFindings}`);
