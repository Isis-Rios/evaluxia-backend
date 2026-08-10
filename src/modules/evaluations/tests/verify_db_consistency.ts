import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { reportRepository } from '@/modules/reports/report.repository';
import { findingRepository } from '@/modules/findings/finding.repository';
import mongoose from 'mongoose';

async function verifyConsistency() {
  await connectToDatabase();

  const evalId = '6a79272a72f669b7e4ba9170';
  const report = await reportRepository.findByEvaluationId(evalId);
  const findings = await findingRepository.findByEvaluationId(evalId);

  console.log('\n================================================================================');
  console.log('🔍 MONGODB DIRECT AUDIT FOR EVALUATION:', evalId);
  console.log('================================================================================');

  console.log('\n--- FINDINGS PERSISTED IN DB ---');
  findings.forEach((f, i) => {
    console.log(`\nFinding #${i + 1}:`);
    console.log(`  _id                 : ${f._id}`);
    console.log(`  findingGroup        : ${f.findingGroup}`);
    console.log(`  type                : ${f.type}`);
    console.log(`  status              : ${f.status}`);
    console.log(`  severity            : ${f.severity}`);
    console.log(`  confidence          : ${f.confidence}`);
    console.log(`  heuristicCode       : ${f.heuristicCode || 'N/A'}`);
    console.log(`  heuristicName       : ${f.heuristicName || 'N/A'}`);
    console.log(`  wcagCriterion       : ${f.wcagCriterion || 'N/A'}`);
    console.log(`  affectedElement.sel : ${f.affectedElement?.selector || 'N/A'}`);
    console.log(`  iteration           : ${f.iteration}`);
    console.log(`  description         : ${f.description.slice(0, 100)}...`);
  });

  console.log('\n--- REPORT PERSISTED IN DB ---');
  console.log(JSON.stringify(report, null, 2));

  await mongoose.connection.close();
  process.exit(0);
}

verifyConsistency();
