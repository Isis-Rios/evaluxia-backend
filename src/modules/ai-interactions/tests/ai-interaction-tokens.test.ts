import { aiInteractionService } from '../ai-interaction.service';
import { aiInteractionRepository } from '../ai-interaction.repository';
import { IAiInteraction } from '../ai-interaction.model';

/**
 * Phase C.1 — Cambio 3: AiInteraction.requestTokens/responseTokens must
 * reflect the real Gemini usage already available to the caller
 * (evaluation.service.ts's aiCall.usage), instead of being hardcoded to 0.
 * No real DB: aiInteractionRepository.create is swapped for an in-memory
 * capture, matching the pattern already used elsewhere in this test suite.
 */

// Captured calls accumulate in an array (rather than a reassigned `let`/
// object property) to avoid TypeScript narrowing the value to a literal
// across the async gap between the mocked create() call and the assertions
// that read it back — reassigning a single variable to null and back
// triggered that narrowing in this file; appending to an array does not.
const capturedCalls: Array<Partial<IAiInteraction>> = [];
(aiInteractionRepository as unknown as Record<string, unknown>)['create'] = async (
  data: Partial<IAiInteraction>,
) => {
  capturedCalls.push(data);
  return { ...data, id: 'fake-interaction-id' } as unknown as IAiInteraction;
};

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    console.error(`❌ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  console.log(`✅ ${label}`);
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting AiInteraction real-token-usage tests (Phase C.1)...');

  // Case 1: real Gemini usage is passed through and persisted, not hardcoded to 0.
  await aiInteractionService.logInteraction(
    'eval-1',
    1,
    1234,
    { suggestedAction: { actionType: 'CLICK' } },
    357, // requestTokens (e.g. aiCall.usage.promptTokens)
    82, // responseTokens (e.g. aiCall.usage.outputTokens)
  );
  assertEqual(capturedCalls[0]?.requestTokens, 357, 'logInteraction persists the real requestTokens passed in');
  assertEqual(capturedCalls[0]?.responseTokens, 82, 'logInteraction persists the real responseTokens passed in');

  // Case 2: a RuleEngine-resolved iteration (no real Gemini call that
  // iteration) correctly logs 0/0 — this is accurate, not a bug, since no
  // tokens were genuinely spent, and preserves the historical default shape.
  await aiInteractionService.logInteraction('eval-1', 2, 5, { suggestedAction: { actionType: 'CLICK' } });
  assertEqual(capturedCalls[1]?.requestTokens, 0, 'logInteraction defaults requestTokens to 0 when not provided (RuleEngine path)');
  assertEqual(capturedCalls[1]?.responseTokens, 0, 'logInteraction defaults responseTokens to 0 when not provided (RuleEngine path)');

  console.log('🎉 All AiInteraction real-token-usage tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running ai-interaction-tokens tests:', err);
  process.exit(1);
});
