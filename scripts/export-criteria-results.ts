/**
 * P1.7.2 — Herramienta de extracción metodológica (diagnóstico, NO forma
 * parte del pipeline de producción). Exporta, por evaluación y criterio,
 * el estado recuperable (PASS confirmado / FAIL confirmado / NOT_EVALUABLE
 * / OUT_OF_COVERAGE / SIN_RESULTADO_RECUPERABLE) para alimentar los Anexos
 * B/D/E del proyecto de grado.
 *
 * EXCLUSIVAMENTE DE LECTURA: solo ejecuta `.find()`/`findById` sobre
 * MongoDB. Nunca escribe, actualiza ni elimina ningún documento.
 *
 * Uso:
 *   npx tsx scripts/export-criteria-results.ts <evaluationId> [<evaluationId> ...]
 *   npx tsx scripts/export-criteria-results.ts --all
 *
 * Salida: ./methodology-exports/export-<timestamp>.json y .csv
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { Evaluation } from '@/modules/evaluations/evaluation.model';
import { reportRepository } from '@/modules/reports/report.repository';
import { findingRepository } from '@/modules/findings/finding.repository';
import {
  buildCriterionExport,
  toCsv,
  EvaluationExportResult,
  MinimalEvaluationForExport,
  MinimalFindingForExport,
  MinimalReportForExport,
} from '@/shared/testing/methodology-export';

async function loadEvaluationIds(args: string[]): Promise<string[]> {
  if (args.includes('--all')) {
    // Lectura pura (`.find({}, '_id')`), sin alcance por usuario -- esto es
    // deliberado: es una herramienta de diagnóstico/investigación, no un
    // endpoint de la API de producción, y el proyecto de grado necesita
    // poder exportar TODAS las evaluaciones de la muestra, sin importar
    // bajo qué cuenta se crearon.
    const docs = await Evaluation.find({}, '_id').lean();
    return docs.map((d: any) => String(d._id));
  }
  return args;
}

async function exportOne(evaluationId: string): Promise<EvaluationExportResult | null> {
  const evaluationDoc = await Evaluation.findById(evaluationId).lean();
  if (!evaluationDoc) {
    console.error(`[export-criteria-results] ⚠️  Evaluación ${evaluationId} no encontrada -- se omite.`);
    return null;
  }

  const evaluation: MinimalEvaluationForExport = {
    id: evaluationId,
    type: (evaluationDoc as any).type,
    status: (evaluationDoc as any).status,
    auditStatus: (evaluationDoc as any).auditStatus,
  };

  const reportDoc = await reportRepository.findByEvaluationId(evaluationId);
  const report: MinimalReportForExport | null = reportDoc
    ? {
        passCount: reportDoc.passCount,
        failCount: reportDoc.failCount,
        notEvaluableCount: reportDoc.notEvaluableCount,
        totalCriteria: reportDoc.totalCriteria,
        coverage: reportDoc.coverage as any,
        findingPersistencePolicy: reportDoc.findingPersistencePolicy,
        geminiModel: reportDoc.geminiModel,
      }
    : null;

  const findingDocs = await findingRepository.findByEvaluationId(evaluationId);
  const findings: MinimalFindingForExport[] = findingDocs.map((f: any) => ({
    wcagCriterion: f.wcagCriterion,
    heuristicCode: f.heuristicCode,
    status: f.status,
    severity: f.severity,
    description: f.description,
    recommendation: f.recommendation,
    evidence: f.evidence,
  }));

  return buildCriterionExport({ evaluation, report, findings });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: npx tsx scripts/export-criteria-results.ts <evaluationId> [...] | --all');
    process.exit(1);
  }

  await connectToDatabase();

  const ids = await loadEvaluationIds(args);
  console.log(`[export-criteria-results] Exportando ${ids.length} evaluación(es)...`);

  const results: EvaluationExportResult[] = [];
  const invalidIds: string[] = [];

  for (const id of ids) {
    const result = await exportOne(id);
    if (!result) continue;
    results.push(result);
    if (!result.validation.valid) {
      invalidIds.push(id);
      console.warn(
        `[export-criteria-results] ❌ Evaluación ${id}: NO VÁLIDA -- ${result.validation.discrepancies.join(' | ')}`,
      );
    }
  }

  const outDir = path.join(process.cwd(), 'methodology-exports');
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `export-${timestamp}.json`);
  const csvPath = path.join(outDir, `export-${timestamp}.csv`);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalEvaluations: results.length,
        invalidEvaluations: invalidIds,
        results,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(csvPath, toCsv(results));

  console.log(`\n[export-criteria-results] ✅ ${results.length} evaluación(es) exportada(s).`);
  if (invalidIds.length > 0) {
    console.warn(
      `[export-criteria-results] ⚠️  ${invalidIds.length} evaluación(es) marcadas NO VÁLIDAS (discrepancia contra Report) -- ` +
      `revisar antes de usar esos datos en los Anexos: ${invalidIds.join(', ')}`,
    );
  }
  console.log(`[export-criteria-results] JSON: ${jsonPath}`);
  console.log(`[export-criteria-results] CSV:  ${csvPath}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('[export-criteria-results] ❌ crashed:', e);
  process.exit(1);
});
