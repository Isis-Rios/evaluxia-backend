import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

const SPECULATIVE_KEYWORDS = [
  'might',
  'could',
  'may',
  'possibly',
  'potentially',
  'if implemented',
  'if it is',
  'podría',
  'quizás',
  'tal vez',
  'si se implementa',
];

export class EvidenceGateService {
  private static instance: EvidenceGateService;

  private constructor() {}

  public static getInstance(): EvidenceGateService {
    if (!EvidenceGateService.instance) {
      EvidenceGateService.instance = new EvidenceGateService();
    }
    return EvidenceGateService.instance;
  }

  /**
   * Filters and validates findings from AI output to enforce the "NO EVIDENCE = NO FAIL" rule.
   */
  public processAiFindings(rawFindings: V2AuditFinding[]): V2AuditFinding[] {
    const validatedFindings: V2AuditFinding[] = [];

    for (const finding of rawFindings) {
      let status = finding.status || 'FAIL';
      let confidence = finding.confidence || 'high';

      // 1. Check for speculative conditional language in description
      const descLower = (finding.description || '').toLowerCase();
      const isSpeculative = SPECULATIVE_KEYWORDS.some((kw) => descLower.includes(kw));

      // 2. Gate Rule 1: Confidence LOW or speculative language cannot be a FAIL -> Convert to NOT_EVALUABLE
      if (status === 'FAIL' && (isSpeculative || confidence === 'low' || !finding.evidence || finding.evidence.length === 0)) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // 3. Gate Rule 2: Clean recommendation (Ensure recommendation is actionable, not a copy of heuristic)
      let recommendation = finding.recommendation;
      if (recommendation) {
        const recTrim = recommendation.trim();
        if (
          (finding.heuristicCode && recTrim === finding.heuristicCode.trim()) ||
          (finding.heuristicName && recTrim === finding.heuristicName.trim()) ||
          (finding.heuristic && recTrim === finding.heuristic.trim())
        ) {
          recommendation = `Proporcionar soporte visual y accesible adecuado según las directrices para ${finding.heuristicName || finding.heuristicCode || 'el criterio'}.`;
        }
      }

      // 4. Do not persist NOT_EVALUABLE or PASS as negative FAIL findings
      validatedFindings.push({
        ...finding,
        status,
        confidence,
        recommendation: status === 'FAIL' ? recommendation : null,
      });
    }

    return validatedFindings;
  }
}

export const evidenceGateService = EvidenceGateService.getInstance();
