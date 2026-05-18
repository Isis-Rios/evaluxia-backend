/**
 * Application-wide constants for EvalUXIA.
 */
export const APP_NAME = 'EvalUXIA Backend';
export const APP_VERSION = '1.0.0';

export const API_PREFIX = '/api/v1';

// Evaluation statuses
export const EVALUATION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type EvaluationStatus = (typeof EVALUATION_STATUS)[keyof typeof EVALUATION_STATUS];

// AI contract types
export const AI_CONTRACT_TYPE = {
  UX_ANALYSIS: 'ux_analysis',
  ACCESSIBILITY_CHECK: 'accessibility_check',
  HEURISTIC_EVALUATION: 'heuristic_evaluation',
} as const;

export type AiContractType = (typeof AI_CONTRACT_TYPE)[keyof typeof AI_CONTRACT_TYPE];

// Playwright browser config defaults
export const BROWSER_CONFIG = {
  headless: true,
  timeout: 30_000,
  viewport: { width: 1280, height: 720 },
} as const;
