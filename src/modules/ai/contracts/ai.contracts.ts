import { z } from 'zod';

// =============================================================================
// ─── V1 LEGACY SCHEMAS (For backward compatibility in Tarea 5) ───────────────
// =============================================================================

export const UxFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: z.enum([
    'accessibility',
    'usability',
    'performance',
    'content',
    'navigation',
    'visual',
  ]),
  title: z.string(),
  description: z.string(),
  affectedElement: z.string().nullish(),
  recommendation: z.string(),
  wcagCriteria: z.string().nullish(),
});

export const UxAnalysisOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(UxFindingSchema),
  nextActions: z.array(z.string()),
});

export type UxFinding = z.infer<typeof UxFindingSchema>;
export type UxAnalysisOutput = z.infer<typeof UxAnalysisOutputSchema>;

export const UxAnalysisInputSchema = z.object({
  url: z.string().url(),
  pageTitle: z.string(),
  domSnapshot: z.string(),
  screenshots: z.array(z.string()).optional(),
  evaluationContext: z.string().optional(),
  evaluatorProfile: z.object({
    fullName: z.string(),
    phrase: z.string(),
    age: z.number(),
    profession: z.string(),
    archetype: z.string(),
    techSavviness: z.string(),
    accessibilityNeeds: z.array(z.string()),
    goals: z.array(z.string()),
    frustrations: z.array(z.string()),
  }),
});

export type UxAnalysisInput = z.infer<typeof UxAnalysisInputSchema>;


// =============================================================================
// ─── V2 NEW SCHEMAS (Conforme a System Instructions oficiales) ──────────────
// =============================================================================

export const EvaluationMetadataSchema = z.object({
  evaluationId: z.string(),
  timestamp: z.string().datetime(),
  iteration: z.number().int().min(1),
});

export const FlowDefinitionSchema = z.object({
  flowDescription: z.string(),
  currentStepObjective: z.string(),
  totalStepsEstimated: z.number().int().min(1),
});

export const FlowStateSchema = z.object({
  currentStep: z.number().int().min(1),
  completedSteps: z.array(z.string()),
  previousActions: z.array(
    z.object({
      actionType: z.string(),
      description: z.string(),
      result: z.enum(['success', 'failure']),
    })
  ),
  blockingError: z.string().nullable(),
});

export const UserArchetypeSchema = z.object({
  fullName: z.string(),
  phrase: z.string(),
  age: z.number().int().min(0),
  profession: z.string(),
  maritalStatus: z.string(),
  country: z.string(),
  city: z.string(),
  archetype: z.string(),
  biography: z.string(),
  personality: z.string(),
  goals: z.array(z.string()),
  frustrations: z.array(z.string()),
});

export const VisibleElementSchema = z.object({
  type: z.enum([
    'button',
    'input',
    'link',
    'select',
    'checkbox',
    'radio',
    'textarea',
    'image',
    'other',
  ]),
  text: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  role: z.string().nullable(),
  isDisabled: z.boolean(),
  isPrimary: z.boolean(),
});

export const TechnicalContextSchema = z.object({
  url: z.string().url(),
  requiresAuthentication: z.boolean(),
  authenticationStatus: z.enum(['authenticated', 'unauthenticated']),
  visibleDOMSummary: z.array(VisibleElementSchema),
});

export const ConstraintsSchema = z.object({
  doNotAssumeHiddenElements: z.boolean(),
  doNotInventActions: z.boolean(),
  maxOneActionPerIteration: z.boolean(),
});

export const V2AIInputContextSchema = z.object({
  metadata: EvaluationMetadataSchema,
  flowDefinition: FlowDefinitionSchema,
  flowState: FlowStateSchema,
  userArchetype: UserArchetypeSchema,
  technicalContext: TechnicalContextSchema,
  constraints: ConstraintsSchema,
});

export type V2AIInputContext = z.infer<typeof V2AIInputContextSchema>;

// ─── V2 OUTPUT SCHEMAS ───────────────────────────────────────────────────────

export const EvaluationSummarySchema = z.object({
  flowCanContinue: z.boolean(),
  confidenceLevel: z.enum(['low', 'medium', 'high']).default('high'),
  notes: z.string(),
});

export const UserIntentionSchema = z.object({
  description: z.string().default('Navegación táctica'),
  derivedFromArchetype: z.boolean().default(false),
});

export const SuggestedActionSchema = z.object({
  actionType: z.string(),
  targetElement: z
    .object({
      matchStrategy: z.enum([
        'CSS',
        'XPATH',
        'TEXT',
        'ROLE',
        'LABEL',
        'PLACEHOLDER',
        'ALT_TEXT',
        'TEST_ID',
      ]),
      value: z.string(),
    })
    .nullable(),
  // P-01 fix: text to type when actionType is TYPE or option value for SELECT.
  inputData: z.string().optional(),
  rationale: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
}).nullable();

export const V2UxFindingSchema = z.object({
  type: z.enum(['usability', 'content', 'interaction', 'visual']),
  heuristic: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  affectedArchetypeTraits: z.array(z.string()),
});

export const AccessibilityFindingSchema = z.object({
  wcagCriterion: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
});

export const RiskAssessmentSchema = z.object({
  confusionProbability: z.enum(['low', 'medium', 'high']).default('low'),
  abandonmentRisk: z.enum(['low', 'medium', 'high']).default('low'),
  errorRisk: z.enum(['low', 'medium', 'high']).default('low'),
});

export const FlowControlSchema = z.object({
  isStopper: z.boolean(),
  stopperReason: z.string().nullable(),
  recommendedNextStep: z.enum([
    'executeSuggestedAction',
    'requestMoreContext',
    'stopFlow',
  ]),
});

export const V2AIOutputDecisionSchema = z.object({
  evaluationSummary: EvaluationSummarySchema,
  userIntention: UserIntentionSchema.default({
    description: 'Navegación táctica',
    derivedFromArchetype: false,
  }),
  suggestedAction: SuggestedActionSchema,
  uxFindings: z.array(V2UxFindingSchema).default([]),
  accessibilityFindings: z.array(AccessibilityFindingSchema).default([]),
  riskAssessment: RiskAssessmentSchema.default({
    confusionProbability: 'low',
    abandonmentRisk: 'low',
    errorRisk: 'low',
  }),
  flowControl: FlowControlSchema,
});

export type V2AIOutputDecision = z.output<typeof V2AIOutputDecisionSchema>;

// =============================================================================
// ─── FASE 2 AUDIT SCHEMAS (Auditoría Asíncrona Especializada) ────────────────
// =============================================================================

export const V2AuditFindingSchema = z.object({
  findingGroup: z.enum(['ux', 'accessibility']),
  type: z.enum(['usability', 'content', 'interaction', 'visual', 'wcag']).nullish(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).nullish().transform((s) => s || 'medium'),
  heuristic: z.string().nullish(),
  wcagCriterion: z.string().nullish(),
  description: z.string(),
  recommendation: z.string(),
  affectedArchetypeTraits: z.array(z.string()).nullish(),
});

export const V2AuditOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  executiveSummary: z.string(),
  findings: z.array(V2AuditFindingSchema),
});

export type V2AuditFinding = z.output<typeof V2AuditFindingSchema>;
export type V2AuditOutput = z.output<typeof V2AuditOutputSchema>;

