import { z } from 'zod';
import { GeminiClient } from '@/infrastructure/gemini/gemini.client';
import { stubGeminiResponsesWithUsage } from '@/shared/testing/gemini-mock-harness';

/**
 * J3-retry-accounting (Hardening Post-Fase H) — deterministic, Gemini-free
 * test proving `retryAccounting.cumulativeUsage` correctly sums token usage
 * across a schema-invalid attempt (retried) followed by a valid one, while
 * `usage` (the pre-existing field) keeps meaning ONLY the final attempt.
 *
 * Uses the REAL `GeminiClient.generateStructuredWithUsage` and the REAL
 * `executeWithRetry` (nothing reimplemented) — only the underlying
 * `generateContent` call is stubbed, exactly like every other G-series test.
 *
 * Gemini calls: 0.
 */

const TestSchema = z.object({ ok: z.boolean() });

async function runJ3RetryAccountingTests() {
  console.log('🧪 Starting J3 retry-accounting tests...\n');

  const client = GeminiClient.getInstance();

  // Attempt 1: schema-invalid ("ok" must be boolean, got a string) -- this
  // throws InvalidAiResponseError inside the retry closure, AFTER usage was
  // already computed from a real (mocked) usageMetadata. Attempt 2: valid,
  // with intentionally DIFFERENT usage numbers so the two are distinguishable.
  const stub = stubGeminiResponsesWithUsage([
    {
      text: '{"ok": "not-a-boolean"}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150, thoughtsTokenCount: 20 },
    },
    {
      text: '{"ok": true}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80, totalTokenCount: 180, thoughtsTokenCount: 30, cachedContentTokenCount: 10 },
    },
  ]);

  let result: any;
  try {
    result = await client.generateStructuredWithUsage(
      'irrelevant prompt for this test',
      TestSchema,
      { maxRetries: 2, initialDelayMs: 1, backoffFactor: 1, maxDelayMs: 5, jitterMs: 0 },
    );
  } finally {
    stub.restore();
  }

  // Test 1-2: exactly 2 calls to generateContent happened (1 invalid + 1 valid).
  if (stub.callCount() !== 2) {
    console.error(`❌ Test 1-2 Failed: expected exactly 2 underlying calls, got ${stub.callCount()}`);
    process.exit(1);
  }
  console.log('✅ Test 1-2: attempt 1 (schema-invalid) + attempt 2 (valid) — exactly 2 underlying calls.');

  // Test 3: final `data` corresponds ONLY to attempt 2 (the valid one).
  if (result.data.ok !== true) {
    console.error('❌ Test 3 Failed: final data does not correspond to the valid (attempt 2) response.', result.data);
    process.exit(1);
  }
  console.log('✅ Test 3: final `data` corresponds only to attempt 2 (the valid response).');

  // Test 4: `usage` (pre-existing field) is EXACTLY attempt 2's usage, unchanged in meaning.
  if (
    result.usage.promptTokens !== 100 ||
    result.usage.outputTokens !== 80 ||
    result.usage.totalTokens !== 180 ||
    result.usage.thinkingTokens !== 30 ||
    result.usage.cachedContentTokens !== 10 ||
    result.usage.toolUsePromptTokens !== undefined
  ) {
    console.error('❌ Test 4 Failed: `usage` must equal exactly attempt 2 alone. Got:', result.usage);
    process.exit(1);
  }
  console.log('✅ Test 4: `usage` still means ONLY the final successful attempt (unchanged contract).');

  // Test 5: `retryAccounting.cumulativeUsage` is exactly the SUM of both attempts.
  const cu = result.retryAccounting?.cumulativeUsage;
  if (!cu) {
    console.error('❌ Test 5 Failed: retryAccounting.cumulativeUsage is missing.', result.retryAccounting);
    process.exit(1);
  }
  if (
    cu.promptTokens !== 200 ||   // 100 + 100
    cu.outputTokens !== 130 ||   // 50 + 80
    cu.totalTokens !== 330 ||    // 150 + 180
    cu.thinkingTokens !== 50     // 20 + 30 (both attempts reported it)
  ) {
    console.error('❌ Test 5 Failed: cumulativeUsage does not match the exact sum of both attempts.', cu);
    process.exit(1);
  }
  console.log('✅ Test 5: retryAccounting.cumulativeUsage is exactly the sum of both attempts (200/130/330/50).');

  // Test 6: retryAccounting.attempts reflects the 2 attempts executed.
  if (result.retryAccounting.attempts !== 2) {
    console.error(`❌ Test 6 Failed: expected attempts=2, got ${result.retryAccounting.attempts}`);
    process.exit(1);
  }
  console.log('✅ Test 6: retryAccounting.attempts === 2.');

  // Test 7: optional fields respect undefined when NOT reported by any attempt,
  // and sum ONLY across attempts that DID report them (cachedContentTokens was
  // only present in attempt 2 -- must be exactly 10, not 0+10 nor undefined).
  if (cu.cachedContentTokens !== 10) {
    console.error(`❌ Test 7a Failed: cachedContentTokens must be exactly 10 (only attempt 2 reported it), got ${cu.cachedContentTokens}`);
    process.exit(1);
  }
  if (cu.toolUsePromptTokens !== undefined) {
    console.error(`❌ Test 7b Failed: toolUsePromptTokens must stay undefined (no attempt reported it), got ${cu.toolUsePromptTokens}`);
    process.exit(1);
  }
  console.log('✅ Test 7: optional fields correctly summed only across reporting attempts, and left undefined when none report them.');

  console.log('\n🎉 ALL J3 retry-accounting tests passed.');
  process.exit(0);
}

runJ3RetryAccountingTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
