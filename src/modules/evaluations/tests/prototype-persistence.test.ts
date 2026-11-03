import { Evaluation } from '@/modules/evaluations/evaluation.model';
import { Report } from '@/modules/reports/report.model';
import { Finding } from '@/modules/findings/finding.model';
import { calculatePrototypeMetrics } from '@/modules/evaluations/services/prototype-metrics.service';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';

/**
 * P4 — Persistencia. Sigue la convención ya establecida en el proyecto para
 * `*.test.ts` (ver `evidence-deduplication-mongoose.test.ts`): construye
 * documentos Mongoose REALES en memoria (`new Model(...)`, sin `.save()`,
 * sin conexión a una base de datos -- este sandbox no tiene un MongoDB vivo
 * accesible) para validar el contrato de esquema (`validateSync`), que es
 * exactamente donde vive la lógica condicional nueva (`url` requerido solo
 * para `website`, `imageUrl`/`coverage` aditivos).
 */
function runTests() {
  console.log('🧪 Starting Prototype Persistence (P4) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 1. Evaluation type=prototype SIN url -- válido (no se requiere url)
  const prototypeEval = new Evaluation({
    userId: '507f1f77bcf86cd799439011',
    evaluatorProfileId: '507f1f77bcf86cd799439012',
    title: 'Prototipo de checkout',
    description: 'Pantalla de checkout ficticia.',
    type: 'prototype',
    imageUrl: '/uploads/prototypes/prototype_abc.png',
  });
  const prototypeValidationError = prototypeEval.validateSync();
  assert(!prototypeValidationError, 'Evaluation type=prototype SIN url pasa validateSync() (url ya no es globalmente requerida)');
  assert(prototypeEval.imageUrl === '/uploads/prototypes/prototype_abc.png', 'Evaluation persiste imageUrl correctamente');

  // 2. Evaluation type=website SIN url -- sigue siendo inválido (comportamiento WEB intacto)
  const websiteEvalNoUrl = new Evaluation({
    userId: '507f1f77bcf86cd799439011',
    evaluatorProfileId: '507f1f77bcf86cd799439012',
    title: 'Sitio sin URL',
    type: 'website',
  });
  const websiteValidationError = websiteEvalNoUrl.validateSync();
  assert(!!websiteValidationError && !!websiteValidationError.errors['url'], 'Evaluation type=website SIN url sigue siendo rechazada (regla WEB sin cambios)');

  // 3. Evaluation type=website CON url -- sigue siendo válido (comportamiento WEB intacto)
  const websiteEvalWithUrl = new Evaluation({
    userId: '507f1f77bcf86cd799439011',
    evaluatorProfileId: '507f1f77bcf86cd799439012',
    title: 'Sitio con URL',
    type: 'website',
    url: 'https://example.com',
  });
  assert(!websiteEvalWithUrl.validateSync(), 'Evaluation type=website CON url sigue pasando validateSync() sin cambios');

  // 4. Finding con evidence VISUAL_OBSERVATION + visualReference -- válido en el modelo Mongoose
  const visualFinding = new Finding({
    evaluationId: '507f1f77bcf86cd799439013',
    iteration: 1,
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'Encabezado no descriptivo.',
    evidence: [{ type: 'VISUAL_OBSERVATION', elementDescription: 'encabezado principal', region: 'top-center', property: 'visibleText', value: 'Página' }],
    affectedElement: { visualReference: { description: 'encabezado principal', region: 'top-center' } },
    recommendation: 'Usar un encabezado más descriptivo.',
  });
  assert(!visualFinding.validateSync(), 'Finding con evidence type=VISUAL_OBSERVATION + affectedElement.visualReference pasa validateSync()');
  assert(visualFinding.evidence![0].elementDescription === 'encabezado principal', 'elementDescription se persiste en el subdocumento de evidencia');
  assert(visualFinding.affectedElement!.visualReference!.region === 'top-center', 'affectedElement.visualReference.region se persiste');

  // 5. Finding WEB (sin ningún campo visual) sigue validando exactamente igual (regresión)
  const webFinding = new Finding({
    evaluationId: '507f1f77bcf86cd799439013',
    iteration: 1,
    findingGroup: 'accessibility',
    status: 'FAIL',
    severity: 'medium',
    confidence: 'high',
    description: 'Contraste insuficiente.',
    evidence: [{ type: 'COMPUTED_STYLE', property: 'contrastRatio', value: '2.1:1', selector: '.btn' }],
    affectedElement: { selector: '.btn', tag: 'button' },
    recommendation: 'Aumentar el contraste.',
  });
  assert(!webFinding.validateSync(), 'Finding WEB (selector-based, sin campos visuales) sigue validando sin cambios');

  // 6. Report con coverage -- aditivo, válido
  const reportWithCoverage = new Report({
    evaluationId: '507f1f77bcf86cd799439013',
    title: 'Reporte de prototipo',
    totalFindings: 2,
    coverage: { applicableCriteria: 15, evaluatedCriteria: 10, notEvaluableCriteria: 5, outOfCoverageCriteria: 4 },
  });
  assert(!reportWithCoverage.validateSync(), 'Report con coverage {applicableCriteria,evaluatedCriteria,notEvaluableCriteria,outOfCoverageCriteria} valida correctamente');
  assert(reportWithCoverage.coverage!.outOfCoverageCriteria === 4, 'coverage.outOfCoverageCriteria se persiste');

  // 7. Report WEB sin coverage -- sigue siendo válido (campo opcional, sin regresión)
  const reportWithoutCoverage = new Report({ evaluationId: '507f1f77bcf86cd799439013', title: 'Reporte web' });
  assert(!reportWithoutCoverage.validateSync(), 'Report WEB sin coverage sigue validando sin cambios (campo 100% opcional)');

  // 8. calculatePrototypeMetrics -- coverage nunca incluye OUT_OF_COVERAGE en el denominador
  const findings: PrototypeAuditFinding[] = [
    { findingGroup: 'accessibility', status: 'FAIL', severity: 'high', confidence: 'high', wcagCriterion: 'WCAG 2.4.6', description: 'd', evidence: [], recommendation: 'r' } as any,
    { findingGroup: 'accessibility', status: 'PASS', severity: 'info', confidence: 'high', wcagCriterion: 'WCAG 1.4.1', description: 'd', evidence: [] } as any,
  ];
  const metrics = calculatePrototypeMetrics(findings);
  assert(metrics.coverage.outOfCoverageCriteria > 0, 'calculatePrototypeMetrics reporta outOfCoverageCriteria > 0 (WCAG 4.1.2/2.1.1 + 4 Nielsen)');
  assert(metrics.coverage.applicableCriteria < metrics.coverage.applicableCriteria + metrics.coverage.outOfCoverageCriteria, 'applicableCriteria NUNCA incluye los criterios OUT_OF_COVERAGE');
  assert(metrics.coverage.evaluatedCriteria === 2, 'evaluatedCriteria cuenta exactamente los 2 criterios aplicables evaluados (1 FAIL + 1 PASS)');
  assert(metrics.overallScore !== null && metrics.overallScore >= 0 && metrics.overallScore <= 100, 'overallScore es un número válido en [0,100]');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
