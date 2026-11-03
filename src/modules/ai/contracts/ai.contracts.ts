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
  // Phase C.1: no longer requested from Gemini in the Phase 1 prompt (it had
  // zero downstream consumer — see ai-interaction.service.ts). Defaulted
  // rather than required so a response that omits it still validates.
  notes: z.string().default(''),
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
        'NONE',
      ]).nullish().transform((v) => v || 'CSS'),
      value: z.string().nullish().transform((v) => v || undefined),
    })
    .nullable(),
  // P-01 fix: text to type when actionType is TYPE or option value for SELECT.
  inputData: z.string().nullish().transform((v) => v || undefined),
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

import type { TechnicalEvidenceType } from '@/modules/findings/finding.model';

const KNOWN_EVIDENCE_TYPE_ALIASES: Record<string, { type: TechnicalEvidenceType; defaultProperty?: string }> = {
  CURRENT_URL: { type: 'INTERACTION', defaultProperty: 'url' },
  URL: { type: 'INTERACTION', defaultProperty: 'url' },
  LOCATION: { type: 'INTERACTION', defaultProperty: 'url' },
  BUTTON_PROPERTIES: { type: 'DOM_ATTRIBUTE' },
  FORM_PROPERTIES: { type: 'DOM_ATTRIBUTE' },
  LINK_PROPERTIES: { type: 'DOM_ATTRIBUTE' },
  IMAGE_PROPERTIES: { type: 'DOM_ATTRIBUTE' },
  ELEMENT_PROPERTIES: { type: 'DOM_ATTRIBUTE' },
  ARIA_SNAPSHOT: { type: 'ACCESSIBILITY_TREE' },
  ACCESSIBILITY_PROPERTIES: { type: 'ACCESSIBILITY_TREE' },
  TEXT_CONTRAST: { type: 'COMPUTED_STYLE' },
  COLOR_CONTRAST: { type: 'COMPUTED_STYLE' },
};

export const TechnicalEvidenceItemSchema = z.preprocess(
  (raw: any) => {
    if (raw && typeof raw === 'object' && typeof raw.type === 'string') {
      const upper = raw.type.trim().toUpperCase();
      const alias = KNOWN_EVIDENCE_TYPE_ALIASES[upper];
      if (alias) {
        const hasProp = raw.property !== undefined && raw.property !== null && String(raw.property).trim().length > 0;
        return {
          ...raw,
          type: alias.type,
          property: hasProp ? raw.property : alias.defaultProperty || undefined,
        };
      }
    }
    return raw;
  },
  z
    .object({
      type: z.enum([
        'DOM_ATTRIBUTE',
        'COMPUTED_STYLE',
        'ACCESSIBILITY_TREE',
        'SCREENSHOT',
        'INTERACTION',
        'HEADING_STRUCTURE',
        // Prototype visual evaluation (P0) — nunca emitido por el pipeline
        // WEB (V2AuditFindingSchema no lo usa en ningún flujo real); listado
        // aquí ÚNICAMENTE para que el tipo TS exportado `TechnicalEvidenceItem`
        // coincida con su homólogo Mongoose (finding.model.ts), que SÍ lo
        // persiste para prototipos. Aditivo, no cambia ninguna validación
        // existente para los otros 6 valores.
        'VISUAL_OBSERVATION',
      ]),
      property: z
        .union([z.string(), z.number()])
        .nullish()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      value: z
        .union([z.string(), z.number(), z.boolean()])
        .nullish()
        .transform((v) => (v === undefined ? undefined : v === null ? 'null' : String(v))),
      selector: z
        .string()
        .nullish()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      attribute: z
        .string()
        .nullish()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      measurement: z
        .union([z.string(), z.number()])
        .nullish()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      context: z
        .string()
        .nullish()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      relatedValue: z
        .object({
          property: z
            .union([z.string(), z.number()])
            .nullish()
            .transform((v) => (v === undefined || v === null ? undefined : String(v))),
          value: z
            .union([z.string(), z.number(), z.boolean()])
            .nullish()
            .transform((v) => (v === undefined || v === null ? undefined : String(v))),
        })
        .optional(),
    })
    .superRefine((item, ctx) => {
      const isNonEmpty = (v: string | undefined | null): boolean =>
        v !== undefined && v !== null && String(v).trim().length > 0;

      const hasProp = isNonEmpty(item.property);
      const hasAttr = isNonEmpty(item.attribute);
      const hasVal = isNonEmpty(item.value);

      switch (item.type) {
        case 'DOM_ATTRIBUTE': {
          if (!hasProp && !hasAttr) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'DOM_ATTRIBUTE evidence must specify property or attribute.',
              path: ['property'],
            });
          }
          // Real incident (evaluation 6ae151a7c9e40a501f9cd885, 2026-10-28):
          // a genuinely empty DOM attribute (e.g. alt="", aria-label="") is a
          // real, meaningful observed value, not a missing one -- but the old
          // `!hasVal` check (isNonEmpty, i.e. trim().length > 0) rejected an
          // explicit `value: ""` exactly like an omitted field, aborting
          // Phase 2 after exhausting all retries with zero findings
          // persisted. `item.value` already went through the field-level
          // transform above (undefined stays undefined; null becomes the
          // 'null' sentinel string; "" stays ""), so "absent" and "explicit
          // empty string" are still distinguishable here by identity, not by
          // trimmed length. A value that ONLY contains whitespace (e.g.
          // "   ") is still rejected as missing -- that is not a real
          // attribute value, just padding (see contracts.test.ts, "DOM_ATTRIBUTE
          // empty string value" case, left intact on purpose).
          const valueMissing = item.value === undefined || (item.value !== '' && item.value.trim().length === 0);
          if (valueMissing) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'DOM_ATTRIBUTE evidence must specify observed value.',
              path: ['value'],
            });
          }
          break;
        }

        case 'COMPUTED_STYLE':
          if (!hasProp) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'COMPUTED_STYLE evidence must specify style property (e.g. contrastRatio, fontSize).',
              path: ['property'],
            });
          }
          if (!hasVal) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'COMPUTED_STYLE evidence must specify calculated value (e.g. 2.32:1).',
              path: ['value'],
            });
          }
          break;

        case 'ACCESSIBILITY_TREE':
        case 'SCREENSHOT':
        case 'INTERACTION':
        case 'HEADING_STRUCTURE':
          const hasContext = isNonEmpty(item.context);
          if (!hasProp && !hasVal && !hasContext) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${item.type} evidence must specify property, value, or context describing the observation.`,
              path: ['value'],
            });
          }
          break;
      }
    }),
);

export type TechnicalEvidenceItem = z.output<typeof TechnicalEvidenceItemSchema>;

export const AffectedElementSchema = z.object({
  tag: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  text: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  selector: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  role: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  ariaLabel: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  href: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  id: z.string().nullish().transform((v) => (v === undefined || v === null ? undefined : String(v))),
  attributes: z
    .record(z.string(), z.string())
    .nullish()
    .transform((v) => (v === undefined || v === null ? undefined : v)),
});

export const V2AuditFindingSchema = z
  .object({
    findingGroup: z.enum(['ux', 'accessibility']),
    type: z.enum(['usability', 'content', 'interaction', 'visual', 'wcag']).nullish(),
    status: z.enum(['PASS', 'FAIL', 'NOT_EVALUABLE']).default('FAIL'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
    confidence: z.enum(['high', 'medium', 'low']).default('high'),
    heuristicCode: z.string().nullish(),
    heuristicName: z.string().nullish(),
    heuristic: z.string().nullish(), // legacy field
    wcagCriterion: z.string().nullish(),
    description: z.string(),
    evidence: z.array(TechnicalEvidenceItemSchema).default([]),
    affectedElement: AffectedElementSchema.optional(),
    impact: z.string().optional(),
    recommendation: z.string().nullable().optional(),
    screenshotUrl: z.string().optional(),
    affectedArchetypeTraits: z.array(z.string()).nullish(),
  })
  .refine(
    (data) => {
      // Barrier: FAIL status requires non-empty evidence and non-empty recommendation
      if (data.status === 'FAIL') {
        if (!data.evidence || data.evidence.length === 0) return false;
        if (!data.recommendation || data.recommendation.trim().length === 0) return false;
      }
      return true;
    },
    { message: 'FAIL findings require non-empty technical evidence and an actionable recommendation' },
  )
  .refine(
    (data) => {
      // Barrier: recommendation cannot be equal to heuristicCode, heuristicName or heuristic
      if (data.recommendation) {
        const rec = data.recommendation.trim();
        if (data.heuristicCode && rec === data.heuristicCode.trim()) return false;
        if (data.heuristicName && rec === data.heuristicName.trim()) return false;
        if (data.heuristic && rec === data.heuristic.trim()) return false;
      }
      return true;
    },
    { message: 'Recommendation cannot be identical to heuristicCode or heuristicName' },
  );

export const V2AuditOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  executiveSummary: z.string(),
  findings: z.array(V2AuditFindingSchema),
});

export type V2AuditFinding = z.output<typeof V2AuditFindingSchema>;
export type V2AuditOutput = z.output<typeof V2AuditOutputSchema>;

