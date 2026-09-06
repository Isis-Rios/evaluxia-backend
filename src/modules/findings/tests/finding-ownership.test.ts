import { Types } from 'mongoose';
import { findingService } from '../finding.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { findingRepository } from '../finding.repository';
import { CreateFindingDto, UpdateFindingDto } from '../dto/finding.dto';

/**
 * Deterministic IDOR-fix tests for Findings (P0-2).
 *
 * These test FindingService directly with in-memory fakes swapped onto the
 * EvaluationRepository/FindingRepository singletons — no real MongoDB, no
 * HTTP layer, no Gemini. This matches the existing test-suite convention
 * (audit-metrics.test.ts, finding-contracts.test.ts, etc.) of testing
 * service/business logic in isolation without a live database.
 *
 * Scenario: two users, each with one evaluation and one finding.
 *   Usuario A → recurso de Usuario A → permitido
 *   Usuario A → recurso de Usuario B → rechazado (404, not "forbidden" —
 *     consistent with the existing EvaluationService.findById pattern of
 *     not revealing that the id belongs to someone else)
 */

const userA = 'user-a';
const userB = 'user-b';
const evalA = new Types.ObjectId().toString();
const evalB = new Types.ObjectId().toString();
const findingA = new Types.ObjectId().toString();
const findingB = new Types.ObjectId().toString();

interface FakeEvaluation {
  id: string;
  userId: string;
}

interface FakeFinding {
  id: string;
  evaluationId: { toString(): string };
  description: string;
  status: string;
}

const evaluationsById: Record<string, FakeEvaluation> = {
  [evalA]: { id: evalA, userId: userA },
  [evalB]: { id: evalB, userId: userB },
};

let findingsById: Record<string, FakeFinding> = {
  [findingA]: { id: findingA, evaluationId: { toString: () => evalA }, description: 'Finding A', status: 'FAIL' },
  [findingB]: { id: findingB, evaluationId: { toString: () => evalB }, description: 'Finding B', status: 'FAIL' },
};

function resetFixtures(): void {
  findingsById = {
    [findingA]: { id: findingA, evaluationId: { toString: () => evalA }, description: 'Finding A', status: 'FAIL' },
    [findingB]: { id: findingB, evaluationId: { toString: () => evalB }, description: 'Finding B', status: 'FAIL' },
  };
}

// ── Swap in-memory fakes onto the repository singletons ──────────────────
(evaluationRepository as unknown as Record<string, unknown>)['findByIdAndUserId'] = async (
  id: string,
  userId: string,
): Promise<FakeEvaluation | null> => {
  const evaluation = evaluationsById[id];
  if (!evaluation || evaluation.userId !== userId) return null;
  return evaluation;
};
(evaluationRepository as unknown as Record<string, unknown>)['findIdsByUserId'] = async (
  userId: string,
): Promise<string[]> =>
  Object.values(evaluationsById)
    .filter((e) => e.userId === userId)
    .map((e) => e.id);

(findingRepository as unknown as Record<string, unknown>)['findById'] = async (
  id: string,
): Promise<FakeFinding | null> => findingsById[id] ?? null;
(findingRepository as unknown as Record<string, unknown>)['update'] = async (
  id: string,
  dto: UpdateFindingDto,
): Promise<FakeFinding | null> => {
  if (!findingsById[id]) return null;
  findingsById[id] = { ...findingsById[id], ...(dto as Partial<FakeFinding>) };
  return findingsById[id];
};
(findingRepository as unknown as Record<string, unknown>)['delete'] = async (
  id: string,
): Promise<boolean> => {
  if (!findingsById[id]) return false;
  delete findingsById[id];
  return true;
};
(findingRepository as unknown as Record<string, unknown>)['create'] = async (
  dto: CreateFindingDto,
): Promise<FakeFinding> => {
  const newFinding: FakeFinding = {
    id: 'new-finding',
    evaluationId: { toString: () => dto.evaluationId },
    description: dto.description,
    status: dto.status,
  };
  findingsById[newFinding.id] = newFinding;
  return newFinding;
};
(findingRepository as unknown as Record<string, unknown>)['findByEvaluationId'] = async (
  evaluationId: string,
): Promise<FakeFinding[]> =>
  Object.values(findingsById).filter((f) => f.evaluationId.toString() === evaluationId);
(findingRepository as unknown as Record<string, unknown>)['findAll'] = async (
  query: { evaluationId?: string },
  ownedEvaluationIds?: string[],
): Promise<{ data: FakeFinding[]; total: number }> => {
  let all = Object.values(findingsById);
  if (query.evaluationId) {
    all = all.filter((f) => f.evaluationId.toString() === query.evaluationId);
  } else if (ownedEvaluationIds) {
    all = all.filter((f) => ownedEvaluationIds.includes(f.evaluationId.toString()));
  }
  return { data: all, total: all.length };
};

// ── Assertion helpers ──────────────────────────────────────────────────────
async function expectAllowed<T>(promise: Promise<T>, label: string): Promise<T> {
  try {
    const result = await promise;
    console.log(`✅ ${label}`);
    return result;
  } catch (err) {
    console.error(`❌ ${label} — expected to be allowed but was rejected:`, err);
    process.exit(1);
  }
}

async function expectRejectedNotFound(promise: Promise<unknown>, label: string): Promise<void> {
  try {
    await promise;
    console.error(`❌ ${label} — expected to be rejected but it succeeded`);
    process.exit(1);
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode !== 404) {
      console.error(`❌ ${label} — rejected, but not with a 404 (ownership) error:`, err);
      process.exit(1);
    }
    console.log(`✅ ${label} (rejected: ${(err as Error).message})`);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting Findings IDOR-fix ownership tests...');

  // Usuario A → recurso de Usuario A → permitido
  await expectAllowed(findingService.findById(userA, findingA), 'User A can GET their own finding');
  await expectAllowed(
    findingService.findByEvaluationId(userA, evalA),
    'User A can GET findings for their own evaluation',
  );

  // Usuario A → recurso de Usuario B → rechazado
  await expectRejectedNotFound(
    findingService.findById(userA, findingB),
    "User A CANNOT GET User B's finding by id",
  );
  await expectRejectedNotFound(
    findingService.findByEvaluationId(userA, evalB),
    "User A CANNOT GET findings for User B's evaluation",
  );

  // Usuario A → modificar recurso de Usuario B → rechazado
  await expectRejectedNotFound(
    findingService.update(userA, findingB, { description: 'hacked' } as UpdateFindingDto),
    "User A CANNOT PATCH User B's finding",
  );

  // Usuario A → eliminar recurso de Usuario B → rechazado
  await expectRejectedNotFound(
    findingService.delete(userA, findingB),
    "User A CANNOT DELETE User B's finding",
  );
  if (!findingsById[findingB]) {
    console.error("❌ User B's finding was deleted despite the ownership check rejecting the request");
    process.exit(1);
  }
  console.log("✅ User B's finding still exists after User A's rejected delete attempt");

  // POST: creating a finding against another user's evaluation is rejected
  await expectRejectedNotFound(
    findingService.create(userA, {
      evaluationId: evalB,
      iteration: 1,
      findingGroup: 'ux',
      status: 'FAIL',
      severity: 'high',
      confidence: 'high',
      description: 'Should not be created',
    } as CreateFindingDto),
    "User A CANNOT create a finding against User B's evaluation",
  );

  // POST against own evaluation is allowed
  await expectAllowed(
    findingService.create(userA, {
      evaluationId: evalA,
      iteration: 1,
      findingGroup: 'ux',
      status: 'FAIL',
      severity: 'high',
      confidence: 'high',
      description: 'Legit finding for evalA',
    } as CreateFindingDto),
    'User A can create a finding against their own evaluation',
  );

  // Usuario A → modificar/eliminar recurso propio → permitido
  resetFixtures();
  await expectAllowed(
    findingService.update(userA, findingA, { description: 'updated' } as UpdateFindingDto),
    'User A can PATCH their own finding',
  );
  await expectAllowed(findingService.delete(userA, findingA), 'User A can DELETE their own finding');

  // Unfiltered listing (GET /findings with no evaluationId) must be scoped
  // to the caller's own evaluations, not return every user's findings.
  resetFixtures();
  const listForUserA = await expectAllowed(
    findingService.findAll(userA, { page: 1, limit: 20 } as never),
    'User A can list findings without an evaluationId filter',
  );
  if (listForUserA.data.some((f) => f.id === findingB)) {
    console.error("❌ Unfiltered findings listing for User A leaked User B's finding");
    process.exit(1);
  }
  if (!listForUserA.data.some((f) => f.id === findingA)) {
    console.error("❌ Unfiltered findings listing for User A is missing User A's own finding");
    process.exit(1);
  }
  console.log("✅ Unfiltered findings listing is scoped to the caller's own evaluations only");

  // Symmetric check: User B can access their own resource too.
  await expectAllowed(findingService.findById(userB, findingB), 'User B can GET their own finding');

  console.log('🎉 All Findings IDOR-fix ownership tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running finding-ownership tests:', err);
  process.exit(1);
});
