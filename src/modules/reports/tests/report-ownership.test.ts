import { Types } from 'mongoose';
import { reportService } from '../report.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { reportRepository } from '../report.repository';

/**
 * Deterministic IDOR-fix tests for Reports (P0-2): GET /reports/evaluation/:id
 * must resolve ownership through the parent Evaluation, since Report itself
 * doesn't carry a userId. No real MongoDB — the repository singletons are
 * swapped with in-memory fakes, matching the Findings ownership test.
 */

const userA = 'user-a';
const userB = 'user-b';
const evalA = new Types.ObjectId().toString();
const evalB = new Types.ObjectId().toString();

const evaluationsById: Record<string, { id: string; userId: string }> = {
  [evalA]: { id: evalA, userId: userA },
  [evalB]: { id: evalB, userId: userB },
};

const reportsByEvaluationId: Record<string, { evaluationId: string; overallScore: number }> = {
  [evalA]: { evaluationId: evalA, overallScore: 42 },
  [evalB]: { evaluationId: evalB, overallScore: 77 },
};

(evaluationRepository as unknown as Record<string, unknown>)['findByIdAndUserId'] = async (
  id: string,
  userId: string,
) => {
  const evaluation = evaluationsById[id];
  if (!evaluation || evaluation.userId !== userId) return null;
  return evaluation;
};

(reportRepository as unknown as Record<string, unknown>)['findByEvaluationId'] = async (
  evaluationId: string,
) => reportsByEvaluationId[evaluationId] ?? null;

async function runTests(): Promise<void> {
  console.log('🧪 Starting Reports IDOR-fix ownership tests...');

  const ownReport = await reportService.getReportForEvaluation(userA, evalA);
  if (ownReport.overallScore !== 42) {
    console.error('❌ User A did not get their own report data back');
    process.exit(1);
  }
  console.log("✅ User A can GET their own evaluation's report");

  try {
    await reportService.getReportForEvaluation(userA, evalB);
    console.error("❌ User A was able to GET User B's report — IDOR not fixed");
    process.exit(1);
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode !== 404) {
      console.error("❌ User A's request for User B's report was rejected, but not with 404:", err);
      process.exit(1);
    }
    console.log(`✅ User A CANNOT GET User B's report (rejected: ${(err as Error).message})`);
  }

  const bOwnReport = await reportService.getReportForEvaluation(userB, evalB);
  if (bOwnReport.overallScore !== 77) {
    console.error('❌ User B did not get their own report data back');
    process.exit(1);
  }
  console.log("✅ User B can GET their own evaluation's report");

  console.log('🎉 All Reports IDOR-fix ownership tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running report-ownership tests:', err);
  process.exit(1);
});
