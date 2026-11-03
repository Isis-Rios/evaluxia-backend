import { z } from 'zod';

/**
 * Prototype visual evaluation — contratos Zod (P0, implementación post
 * K.2.1.1). Deliberadamente SEPARADO de `ai.contracts.ts`: WEB
 * (`V2AuditFindingSchema`/`TechnicalEvidenceItemSchema`) permanece 100%
 * intacto — ningún finding de imagen pasa jamás por esos schemas, y
 * viceversa. Mirror estructural de `V2AuditFinding`/`V2AuditOutput`, pero
 * con un tipo de evidencia propio (`VISUAL_OBSERVATION`) y sin ningún campo
 * que presuponga DOM (selector, tag, href, aria).
 */

export const VISUAL_REGIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
  'full-screen',
] as const;

export const VisualRegionSchema = z.enum(VISUAL_REGIONS);
export type VisualRegion = z.infer<typeof VisualRegionSchema>;

/**
 * Whitelist mínima de propiedades visuales observables (sección 7 del
 * prompt de implementación). Cada una documentada: qué SÍ permite afirmar
 * una imagen estática, qué NO. Deliberadamente pequeña (no sobrediseño) —
 * cubre exactamente los criterios WCAG/Nielsen resueltos como evaluables
 * por `prototype-criteria-resolver.ts`, nada especulativo.
 */
export const VISUAL_PROPERTY_DEFINITIONS = {
  visibleText: {
    meaning: 'Texto literalmente visible sobre o junto al elemento.',
    valueType: 'string',
    example: '"Guardar"',
    doesNotConfirm: 'El nombre accesible programático (aria-label/alt real) del elemento.',
  },
  visualLabel: {
    meaning: 'Etiqueta visualmente asociada por proximidad/agrupación a un control.',
    valueType: 'string',
    example: '"Correo electrónico"',
    doesNotConfirm: 'Una asociación programática real (<label for>, aria-labelledby).',
  },
  visualHierarchy: {
    meaning: 'Prominencia visual relativa (tamaño/peso/posición) que sugiere un nivel jerárquico.',
    valueType: 'string (ej. "heading-looking-level-1", "primary", "secondary")',
    example: '"heading-looking-level-1"',
    doesNotConfirm: 'La etiqueta semántica real (h1-h6) ni la estructura del DOM.',
  },
  grouping: {
    meaning: 'Qué elementos aparecen visualmente agrupados entre sí (proximidad/bordes/fondo compartido).',
    valueType: 'string (descripción de los elementos agrupados)',
    example: '"campo + mensaje de error agrupados bajo el mismo borde"',
    doesNotConfirm: 'Agrupación semántica real en el DOM (fieldset, landmark, aria-group).',
  },
  visualContrast: {
    meaning: 'Observación CUALITATIVA de contraste aparente entre texto y fondo.',
    valueType: 'string (ej. "appears-low", "appears-sufficient") — NUNCA una ratio numérica',
    example: '"appears-low"',
    doesNotConfirm: 'Una ratio WCAG medida (ej. "3.2:1") — prohibido explícitamente, ver Gate Rule de contraste.',
  },
  colorCoding: {
    meaning: 'Qué información parece comunicarse mediante color en el elemento observado.',
    valueType: 'string',
    example: '"borde rojo sin ícono ni texto acompañante"',
    doesNotConfirm: 'Cómo se percibe para un usuario con daltonismo real (no hay simulación).',
  },
  visibleState: {
    meaning: 'Estado aparente del control a partir de su apariencia (ej. deshabilitado, seleccionado).',
    valueType: 'string (ej. "appears-disabled", "appears-selected")',
    example: '"appears-disabled"',
    doesNotConfirm: 'El estado programático real (disabled/aria-pressed/aria-selected).',
  },
  layout: {
    meaning: 'Observación estructural del acomodo espacial (solapamiento, densidad, recorte).',
    valueType: 'string',
    example: '"el botón se superpone parcialmente con el texto adyacente"',
    doesNotConfirm: 'Comportamiento responsivo real en otros tamaños de viewport.',
  },
} as const;

export const VISUAL_PROPERTY_WHITELIST = Object.keys(VISUAL_PROPERTY_DEFINITIONS) as Array<
  keyof typeof VISUAL_PROPERTY_DEFINITIONS
>;

export const VisualPropertySchema = z.enum(
  VISUAL_PROPERTY_WHITELIST as [string, ...string[]],
);
export type VisualProperty = z.infer<typeof VisualPropertySchema>;

/**
 * Backstop regex del contrato de contraste (sección 8): ninguna
 * `visualContrast` puede contener una ratio numérica estilo WCAG
 * ("3.2:1", "4.5 : 1"). El prompt YA lo prohíbe explícitamente — esto es
 * la capa determinista de enforcement, nunca confía solo en la instrucción.
 */
const NUMERIC_CONTRAST_RATIO_PATTERN = /\d+(\.\d+)?\s*:\s*1\b/;

export const VisualEvidenceItemSchema = z
  .object({
    type: z.literal('VISUAL_OBSERVATION'),
    elementDescription: z
      .string()
      .trim()
      .min(1)
      .nullish()
      .transform((v) => (v ? v : undefined)),
    region: VisualRegionSchema.nullish().transform((v) => v ?? undefined),
    property: VisualPropertySchema.nullish().transform((v) => v ?? undefined),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .nullish()
      .transform((v) => (v === undefined || v === null ? undefined : String(v))),
    context: z
      .string()
      .trim()
      .min(1)
      .nullish()
      .transform((v) => (v ? v : undefined)),
  })
  .superRefine((item, ctx) => {
    if (!item.elementDescription && !item.context) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VISUAL_OBSERVATION evidence requires elementDescription or context.',
        path: ['elementDescription'],
      });
    }

    const hasProp = item.property !== undefined;
    const hasVal = item.value !== undefined;
    if (hasProp !== hasVal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'property and value must appear together (both present or both absent).',
        path: ['value'],
      });
    }

    if (item.property === 'visualContrast' && hasVal && NUMERIC_CONTRAST_RATIO_PATTERN.test(item.value!)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'visualContrast must be a qualitative observation (e.g. "appears-low"), never a numeric WCAG ratio such as "3.2:1". WCAG 1.4.3 for prototypes is VISUAL_OBSERVATION_ONLY.',
        path: ['value'],
      });
    }
  });

export type VisualEvidenceItem = z.output<typeof VisualEvidenceItemSchema>;

export const PrototypeAffectedElementSchema = z.object({
  visualReference: z
    .object({
      description: z
        .string()
        .trim()
        .min(1)
        .nullish()
        .transform((v) => (v ? v : undefined)),
      region: VisualRegionSchema.nullish().transform((v) => v ?? undefined),
    })
    .nullish()
    .transform((v) => v ?? undefined),
});

export const PrototypeAuditFindingSchema = z
  .object({
    findingGroup: z.enum(['ux', 'accessibility']),
    type: z.enum(['usability', 'content', 'interaction', 'visual', 'wcag']).nullish(),
    status: z.enum(['PASS', 'FAIL', 'NOT_EVALUABLE']).default('FAIL'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
    confidence: z.enum(['high', 'medium', 'low']).default('high'),
    heuristicCode: z.string().nullish(),
    heuristicName: z.string().nullish(),
    wcagCriterion: z.string().nullish(),
    description: z.string(),
    evidence: z.array(VisualEvidenceItemSchema).default([]),
    affectedElement: PrototypeAffectedElementSchema.optional(),
    impact: z.string().optional(),
    recommendation: z.string().nullable().optional(),
    affectedArchetypeTraits: z.array(z.string()).nullish(),
  })
  .refine(
    (data) => {
      if (data.status === 'FAIL') {
        if (!data.evidence || data.evidence.length === 0) return false;
        if (!data.recommendation || data.recommendation.trim().length === 0) return false;
      }
      return true;
    },
    { message: 'FAIL findings require non-empty visual evidence and an actionable recommendation' },
  )
  .refine(
    (data) => {
      if (data.recommendation) {
        const rec = data.recommendation.trim();
        if (data.heuristicCode && rec === data.heuristicCode.trim()) return false;
        if (data.heuristicName && rec === data.heuristicName.trim()) return false;
      }
      return true;
    },
    { message: 'Recommendation cannot be identical to heuristicCode or heuristicName' },
  );

export type PrototypeAuditFinding = z.output<typeof PrototypeAuditFindingSchema>;

export const PrototypeAuditOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  executiveSummary: z.string(),
  findings: z.array(PrototypeAuditFindingSchema),
});

export type PrototypeAuditOutput = z.output<typeof PrototypeAuditOutputSchema>;

/**
 * Input de creación de evaluación de prototipo (P0, sección 3 del prompt).
 * La imagen NUNCA viaja en este schema -- llega como `multipart/form-data`
 * vía multer (`req.file`), validada por separado
 * (`prototype-image-upload.service.ts`). `description` es obligatoria
 * (sección 3.2): a diferencia de WEB, no hay URL/DOM real del que derivar
 * contexto, así que el texto libre es la única fuente de intención del
 * usuario fuera de la imagen y el perfil.
 */
export const CreatePrototypeEvaluationSchema = z.object({
  evaluatorProfileId: z.string().min(1, 'evaluatorProfileId is required'),
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters')
    .optional(),
  description: z
    .string()
    .trim()
    .min(10, 'description is required and must explain the screen/prototype context (min 10 characters)')
    .max(1000, 'Description cannot exceed 1000 characters'),
});

export type CreatePrototypeEvaluationDto = z.infer<typeof CreatePrototypeEvaluationSchema>;
