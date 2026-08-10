import { TechnicalEvidenceItem, AffectedElement } from '@/modules/findings/finding.model';

export type CriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';

export const SUPPORTED_NIELSEN_HEURISTICS = [
  'N-01',
  'N-02',
  'N-03',
  'N-04',
  'N-05',
  'N-06',
  'N-07',
  'N-08',
  'N-09',
  'N-10',
] as const;

export const SUPPORTED_WCAG_CRITERIA = [
  'WCAG 1.1.1',
  'WCAG 1.3.1',
  'WCAG 1.4.1',
  'WCAG 1.4.3',
  'WCAG 2.1.1',
  'WCAG 2.4.4',
  'WCAG 2.4.6',
  'WCAG 3.2.2',
  'WCAG 3.3.2',
  'WCAG 4.1.2',
] as const;

export interface InputAuditFinding {
  findingGroup: 'ux' | 'accessibility';
  type?: string;
  status: CriterionStatus;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: 'high' | 'medium' | 'low';
  heuristicCode?: string;
  heuristicName?: string;
  heuristic?: string;
  wcagCriterion?: string;
  description: string;
  evidence?: TechnicalEvidenceItem[];
  affectedElement?: AffectedElement;
  impact?: string;
  recommendation?: string | null;
  iteration: number;
  url?: string;
  screenshotUrl?: string;
}

export interface ConsolidatedFinding extends InputAuditFinding {
  observedIterations: number[];
  screenshotUrls: string[];
}

export interface DomainMetrics {
  evaluatedCount: number;
  passCount: number;
  failCount: number;
  notEvaluableCount: number;
  compliance: number | null;
  coverage: number;
}

export interface ComprehensiveAuditMetrics {
  overallScore: number | null;
  nielsenMetrics: DomainMetrics;
  wcagMetrics: DomainMetrics;
  auditCoverage: number;
  passCount: number;
  failCount: number;
  notEvaluableCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  totalFindings: number;
  evaluatedCriteria: number;
  totalCriteria: number;
  evidenceCount: number;
  consolidatedFindings: ConsolidatedFinding[];
}

export class AuditMetricsService {
  private static instance: AuditMetricsService;

  private constructor() {}

  public static getInstance(): AuditMetricsService {
    if (!AuditMetricsService.instance) {
      AuditMetricsService.instance = new AuditMetricsService();
    }
    return AuditMetricsService.instance;
  }

  /**
   * Deduplicates findings across iterations using problem identity key: ${criterion}_${selector}.
   * Consolidates evidence and retains all observed iterations/screenshots.
   */
  public deduplicateFindings(rawFindings: InputAuditFinding[]): ConsolidatedFinding[] {
    const map = new Map<string, ConsolidatedFinding>();

    for (const f of rawFindings) {
      const criterionKey = f.wcagCriterion || f.heuristicCode || f.heuristic || f.description;
      const selectorKey = f.affectedElement?.selector || f.affectedElement?.tag || 'global';
      const key = `${criterionKey}_${selectorKey}`;

      if (!map.has(key)) {
        map.set(key, {
          ...f,
          observedIterations: [f.iteration],
          screenshotUrls: f.screenshotUrl ? [f.screenshotUrl] : [],
        });
      } else {
        const existing = map.get(key)!;
        if (!existing.observedIterations.includes(f.iteration)) {
          existing.observedIterations.push(f.iteration);
        }
        if (f.screenshotUrl && !existing.screenshotUrls.includes(f.screenshotUrl)) {
          existing.screenshotUrls.push(f.screenshotUrl);
        }
        // Merge evidence items cleanly
        if (f.evidence && f.evidence.length > 0) {
          existing.evidence = existing.evidence || [];
          for (const evItem of f.evidence) {
            const evKey = `${evItem.type}_${evItem.selector}_${evItem.property}_${evItem.value}`;
            const exists = existing.evidence.some(
              (e) => `${e.type}_${e.selector}_${e.property}_${e.value}` === evKey,
            );
            if (!exists) existing.evidence.push(evItem);
          }
        }
      }
    }

    return Array.from(map.values());
  }

  /**
   * Consolidates criteria status: maps findings to Nielsen (10) and WCAG (10) spaces.
   * Multiple findings under 1 criterion produce 1 single criterion status (FAIL takes precedence).
   */
  public calculateMetrics(rawFindings: InputAuditFinding[]): ComprehensiveAuditMetrics {
    const consolidatedFindings = this.deduplicateFindings(rawFindings);

    // 1. Map Nielsen 10 Heuristics (N-01 to N-10)
    const nielsenStatusMap = new Map<string, { status: CriterionStatus; maxSeverity: string }>();
    for (const hCode of SUPPORTED_NIELSEN_HEURISTICS) {
      nielsenStatusMap.set(hCode, { status: 'NOT_EVALUABLE', maxSeverity: 'info' });
    }

    // 2. Map WCAG 10 Core Criteria
    const wcagStatusMap = new Map<string, { status: CriterionStatus; maxSeverity: string }>();
    for (const wCrit of SUPPORTED_WCAG_CRITERIA) {
      wcagStatusMap.set(wCrit, { status: 'NOT_EVALUABLE', maxSeverity: 'info' });
    }

    // Process consolidated findings into criteria status maps
    for (const f of consolidatedFindings) {
      // Process Nielsen
      if (f.heuristicCode && nielsenStatusMap.has(f.heuristicCode)) {
        const current = nielsenStatusMap.get(f.heuristicCode)!;
        if (f.status === 'FAIL') {
          current.status = 'FAIL';
          current.maxSeverity = this.getHigherSeverity(current.maxSeverity, f.severity);
        } else if (f.status === 'PASS' && current.status !== 'FAIL') {
          current.status = 'PASS';
        }
      }

      // Process WCAG
      if (f.wcagCriterion) {
        // Match canonical WCAG criterion name e.g. "WCAG 1.4.3" inside "WCAG 1.4.3 Contraste Mínimo"
        const matchedWCAG = SUPPORTED_WCAG_CRITERIA.find((c) => f.wcagCriterion!.includes(c));
        if (matchedWCAG && wcagStatusMap.has(matchedWCAG)) {
          const current = wcagStatusMap.get(matchedWCAG)!;
          if (f.status === 'FAIL') {
            current.status = 'FAIL';
            current.maxSeverity = this.getHigherSeverity(current.maxSeverity, f.severity);
          } else if (f.status === 'PASS' && current.status !== 'FAIL') {
            current.status = 'PASS';
          }
        }
      }
    }

    // Calculate Nielsen Domain Metrics
    let nPass = 0, nFail = 0, nNotEval = 0;
    for (const [_, val] of nielsenStatusMap) {
      if (val.status === 'PASS') nPass++;
      else if (val.status === 'FAIL') nFail++;
      else nNotEval++;
    }
    const nEvaluable = nPass + nFail;
    const nielsenCompliance = nEvaluable > 0 ? parseFloat(((nPass / nEvaluable) * 100).toFixed(2)) : null;
    const nielsenCoverage = parseFloat((((nPass + nFail) / 10) * 100).toFixed(2));

    // Calculate WCAG Domain Metrics
    let wPass = 0, wFail = 0, wNotEval = 0;
    for (const [_, val] of wcagStatusMap) {
      if (val.status === 'PASS') wPass++;
      else if (val.status === 'FAIL') wFail++;
      else wNotEval++;
    }
    const wEvaluable = wPass + wFail;
    const wcagCompliance = wEvaluable > 0 ? parseFloat(((wPass / wEvaluable) * 100).toFixed(2)) : null;
    const wcagCoverage = parseFloat((((wPass + wFail) / SUPPORTED_WCAG_CRITERIA.length) * 100).toFixed(2));

    // Consolidated Global Totals
    const totalPass = nPass + wPass;
    const totalFail = nFail + wFail;
    const totalNotEval = nNotEval + wNotEval;
    const totalEvaluable = totalPass + totalFail;
    const totalSpace = SUPPORTED_NIELSEN_HEURISTICS.length + SUPPORTED_WCAG_CRITERIA.length;

    const auditCoverage = totalSpace > 0 ? parseFloat(((totalEvaluable / totalSpace) * 100).toFixed(2)) : 0;

    // Calculate 100% Deterministic Overall Score (Alternativa C)
    let overallScore: number | null = null;
    if (totalEvaluable > 0) {
      const globalCompliance = (totalPass / totalEvaluable) * 100;
      
      // Calculate severity deductions normalized over evaluated criteria
      let totalSeverityPenalty = 0;
      for (const [_, val] of nielsenStatusMap) {
        if (val.status === 'FAIL') totalSeverityPenalty += this.getSeverityWeight(val.maxSeverity);
      }
      for (const [_, val] of wcagStatusMap) {
        if (val.status === 'FAIL') totalSeverityPenalty += this.getSeverityWeight(val.maxSeverity);
      }

      const severityPenaltyNormalized = totalSeverityPenalty / totalEvaluable;
      const baseQuality = Math.max(0, globalCompliance - severityPenaltyNormalized);
      const gammaCoverage = 0.5 + 0.5 * (auditCoverage / 100);

      overallScore = Math.min(100, Math.max(0, Math.round(baseQuality * gammaCoverage)));
    }

    // Counts by severity across element-level findings
    const failFindings = consolidatedFindings.filter((f) => f.status === 'FAIL');
    const criticalCount = failFindings.filter((f) => f.severity === 'critical').length;
    const highCount = failFindings.filter((f) => f.severity === 'high').length;
    const mediumCount = failFindings.filter((f) => f.severity === 'medium').length;
    const lowCount = failFindings.filter((f) => f.severity === 'low').length;
    const infoCount = consolidatedFindings.filter((f) => f.severity === 'info').length;

    // Count evidence items
    let evidenceCount = 0;
    for (const f of consolidatedFindings) {
      evidenceCount += f.evidence?.length || 0;
    }

    return {
      overallScore,
      nielsenMetrics: {
        evaluatedCount: nEvaluable,
        passCount: nPass,
        failCount: nFail,
        notEvaluableCount: nNotEval,
        compliance: nielsenCompliance,
        coverage: nielsenCoverage,
      },
      wcagMetrics: {
        evaluatedCount: wEvaluable,
        passCount: wPass,
        failCount: wFail,
        notEvaluableCount: wNotEval,
        compliance: wcagCompliance,
        coverage: wcagCoverage,
      },
      auditCoverage,
      passCount: totalPass,
      failCount: totalFail,
      notEvaluableCount: totalNotEval,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
      totalFindings: failFindings.length,
      evaluatedCriteria: totalEvaluable,
      totalCriteria: totalSpace,
      evidenceCount,
      consolidatedFindings,
    };
  }

  private getSeverityWeight(sev: string): number {
    switch (sev) {
      case 'critical':
        return 20;
      case 'high':
        return 12;
      case 'medium':
        return 6;
      case 'low':
        return 2;
      default:
        return 0;
    }
  }

  private getHigherSeverity(sev1: string, sev2: string): string {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    const idx1 = order.indexOf(sev1);
    const idx2 = order.indexOf(sev2);
    if (idx1 === -1) return sev2;
    if (idx2 === -1) return sev1;
    return idx1 <= idx2 ? sev1 : sev2;
  }
}

export const auditMetricsService = AuditMetricsService.getInstance();
