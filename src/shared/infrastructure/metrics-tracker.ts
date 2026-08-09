import { env } from '@/config/env';

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface EvaluationMetrics {
  evaluationId: string;
  modelUsed: string;
  phase1Calls: number;
  phase2Calls: number;
  totalExecutionTimeMs: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cumulativeCostUsd: number;
}

/**
 * MetricsTracker — Singleton in-memory metric collector for LLM token consumption and costs.
 *
 * Pricing rates (USD per 1,000,000 tokens):
 * - gemini-2.5-flash: $0.30 input / $2.50 output
 * - gemini-2.0-flash: $0.10 input / $0.40 output
 * - default fallback: $0.30 input / $2.50 output
 */
export class MetricsTracker {
  private static instance: MetricsTracker;

  // Cumulative in-memory counters since backend startup
  private cumulativeCostUsd = 0;
  private cumulativePromptTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeTotalTokens = 0;
  private cumulativePhase1Calls = 0;
  private cumulativePhase2Calls = 0;
  private cumulativeEvaluationsCount = 0;

  private constructor() {}

  public static getInstance(): MetricsTracker {
    if (!MetricsTracker.instance) {
      MetricsTracker.instance = new MetricsTracker();
    }
    return MetricsTracker.instance;
  }

  /**
   * Calculates the estimated cost in USD based on model and token counts.
   */
  public calculateCost(modelName: string, promptTokens: number, outputTokens: number): number {
    const model = modelName.toLowerCase();

    let inputRatePerMillion = 0.30;
    let outputRatePerMillion = 2.50;

    if (model.includes('2.0-flash')) {
      inputRatePerMillion = 0.10;
      outputRatePerMillion = 0.40;
    } else if (model.includes('2.5-flash')) {
      inputRatePerMillion = 0.30;
      outputRatePerMillion = 2.50;
    }

    const inputCost = (promptTokens / 1_000_000) * inputRatePerMillion;
    const outputCost = (outputTokens / 1_000_000) * outputRatePerMillion;

    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Records completed evaluation metrics and updates cumulative counters.
   */
  public recordEvaluation(params: {
    evaluationId: string;
    modelUsed?: string;
    phase1Calls: number;
    phase2Calls: number;
    totalExecutionTimeMs: number;
    promptTokens: number;
    outputTokens: number;
  }): EvaluationMetrics {
    const modelUsed = params.modelUsed || env.GEMINI_MODEL;
    const promptTokens = params.promptTokens;
    const outputTokens = params.outputTokens;
    const totalTokens = promptTokens + outputTokens;

    const estimatedCostUsd = this.calculateCost(modelUsed, promptTokens, outputTokens);

    // Update cumulative state
    this.cumulativeCostUsd = Number((this.cumulativeCostUsd + estimatedCostUsd).toFixed(6));
    this.cumulativePromptTokens += promptTokens;
    this.cumulativeOutputTokens += outputTokens;
    this.cumulativeTotalTokens += totalTokens;
    this.cumulativePhase1Calls += params.phase1Calls;
    this.cumulativePhase2Calls += params.phase2Calls;
    this.cumulativeEvaluationsCount += 1;

    const metrics: EvaluationMetrics = {
      evaluationId: params.evaluationId,
      modelUsed,
      phase1Calls: params.phase1Calls,
      phase2Calls: params.phase2Calls,
      totalExecutionTimeMs: params.totalExecutionTimeMs,
      promptTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      cumulativeCostUsd: this.cumulativeCostUsd,
    };

    this.logConsoleReport(metrics);

    return metrics;
  }

  /**
   * Returns current cumulative metrics since backend startup.
   */
  public getCumulativeStats() {
    return {
      modelConfigured: env.GEMINI_MODEL,
      evaluationsEvaluated: this.cumulativeEvaluationsCount,
      totalPhase1Calls: this.cumulativePhase1Calls,
      totalPhase2Calls: this.cumulativePhase2Calls,
      totalCalls: this.cumulativePhase1Calls + this.cumulativePhase2Calls,
      totalPromptTokens: this.cumulativePromptTokens,
      totalOutputTokens: this.cumulativeOutputTokens,
      totalTokens: this.cumulativeTotalTokens,
      cumulativeCostUsd: this.cumulativeCostUsd,
    };
  }

  /**
   * Prints an elegant terminal summary card for each completed evaluation.
   */
  private logConsoleReport(metrics: EvaluationMetrics): void {
    console.log(`\n================================================================================`);
    console.log(`📊 EVALUXIA COST & CONSUMPTION REPORT — Evaluation ${metrics.evaluationId}`);
    console.log(`================================================================================`);
    console.log(`• Model Used              : ${metrics.modelUsed}`);
    console.log(`• Phase 1 Calls (Nav)     : ${metrics.phase1Calls}`);
    console.log(`• Phase 2 Calls (Audit)   : ${metrics.phase2Calls}`);
    console.log(`• Prompt Tokens (Input)   : ${metrics.promptTokens.toLocaleString()} tokens`);
    console.log(`• Candidate Tokens (Output): ${metrics.outputTokens.toLocaleString()} tokens`);
    console.log(`• Total Tokens            : ${metrics.totalTokens.toLocaleString()} tokens`);
    console.log(`• Total Execution Time    : ${metrics.totalExecutionTimeMs} ms`);
    console.log(`• Estimated Eval Cost     : $${metrics.estimatedCostUsd.toFixed(6)} USD`);
    console.log(`• CUMULATIVE BACKEND COST : $${metrics.cumulativeCostUsd.toFixed(6)} USD (since startup)`);
    console.log(`================================================================================\n`);
  }
}

export const metricsTracker = MetricsTracker.getInstance();
