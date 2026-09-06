/**
 * Application-wide constants for EvalUXIA.
 */
export const APP_NAME = 'EvalUXIA Backend';
export const APP_VERSION = '1.0.0';

export const API_PREFIX = '/api/v1';

// Evaluation statuses (Phase 1 Exploration)
export const EVALUATION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type EvaluationStatus = (typeof EVALUATION_STATUS)[keyof typeof EVALUATION_STATUS];

// Audit statuses (Phase 2 Specialized Audit)
export const AUDIT_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type AuditStatus = (typeof AUDIT_STATUS)[keyof typeof AUDIT_STATUS];

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

// AI Resilience / Retry configuration defaults
export const AI_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 10000,
  jitterMs: 200,
} as const;

export type AiRetryConfig = typeof AI_RETRY_CONFIG;
