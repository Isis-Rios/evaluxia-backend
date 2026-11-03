import { estimateTokensFromChars } from './payload-budgets';

/**
 * Fase 2.3 — reusable payload composition breakdown (testing-only module).
 *
 * Formalizes the manual measurement method used throughout the Fase 2/2.1
 * payload audits (JSON.stringify each named piece that gets embedded into
 * the prompt, measure its share of the total) into a reusable function,
 * instead of a one-off investigation script. Answers "what is consuming the
 * tokens", not just "how many tokens".
 */

export interface CategoryBreakdown {
  category: string;
  chars: number;
  bytes: number;
  percentOfTotal: number;
  estimatedTokens: number;
}

/**
 * `parts` should be every named piece that gets embedded into `totalPrompt`
 * (e.g. { headings, images, links, buttons, forms, computedStyles,
 * dedupedLandmarks, dedupedLinks, dedupedButtons, accessibilityTrees,
 * flowState, profile }). String values are measured as-is; anything else is
 * measured via the same `JSON.stringify` call the real prompt builder uses,
 * so the reported size matches what actually gets embedded.
 *
 * The remainder (`totalPrompt.length` minus the sum of all parts) is
 * reported as a synthetic "fixed-instructions+other" category — this is
 * the fixed template text (Nielsen/WCAG rules, response-format
 * placeholders) plus any small interpolated metadata (title, url, archetype
 * fields) not passed explicitly in `parts`.
 */
export function analyzePromptComposition(
  totalPrompt: string,
  parts: Record<string, unknown>,
): CategoryBreakdown[] {
  const totalChars = totalPrompt.length;

  const measured = Object.entries(parts).map(([category, value]) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return { category, serialized };
  });

  const sumOfParts = measured.reduce((sum, m) => sum + m.serialized.length, 0);
  const remainderChars = Math.max(0, totalChars - sumOfParts);

  const breakdown: CategoryBreakdown[] = measured.map(({ category, serialized }) => ({
    category,
    chars: serialized.length,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    percentOfTotal: totalChars > 0 ? Number(((serialized.length / totalChars) * 100).toFixed(2)) : 0,
    estimatedTokens: estimateTokensFromChars(serialized.length),
  }));

  breakdown.push({
    category: 'fixed-instructions+other',
    chars: remainderChars,
    bytes: Buffer.byteLength(totalPrompt, 'utf8') - measured.reduce((s, m) => s + Buffer.byteLength(m.serialized, 'utf8'), 0),
    percentOfTotal: totalChars > 0 ? Number(((remainderChars / totalChars) * 100).toFixed(2)) : 0,
    estimatedTokens: estimateTokensFromChars(remainderChars),
  });

  return breakdown.sort((a, b) => b.chars - a.chars);
}

/**
 * The 3-level raw → compressed → final comparison from the Fase 2.3 plan
 * (section 4). Each stage is just a prompt-shaped string measurement;
 * callers build `rawPrompt`/`compressedPrompt`/`finalPrompt` however is
 * appropriate for what they're testing (e.g. building buildV2AuditPrompt
 * once with un-sanitized evidence and once with sanitizeEvidenceForGemini
 * applied).
 */
export interface CompressionStageComparison {
  raw: { chars: number; bytes: number; estimatedTokens: number };
  compressed: { chars: number; bytes: number; estimatedTokens: number };
  final: { chars: number; bytes: number; estimatedTokens: number };
  reductionPercent: number; // raw -> final
}

export function compareCompressionStages(
  rawPrompt: string,
  compressedPrompt: string,
  finalPrompt: string,
): CompressionStageComparison {
  const measure = (s: string) => ({
    chars: s.length,
    bytes: Buffer.byteLength(s, 'utf8'),
    estimatedTokens: estimateTokensFromChars(s.length),
  });

  const raw = measure(rawPrompt);
  const compressed = measure(compressedPrompt);
  const final = measure(finalPrompt);

  const reductionPercent = raw.chars > 0 ? Number((((raw.chars - final.chars) / raw.chars) * 100).toFixed(3)) : 0;

  return { raw, compressed, final, reductionPercent };
}
