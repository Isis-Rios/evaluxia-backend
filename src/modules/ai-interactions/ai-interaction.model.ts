import { Schema, model, Document, Types } from 'mongoose';

/**
 * AiInteraction — Logs AI requests and responses for academic tracking,
 * debugging, and cost estimation (tokens).
 *
 * P1.7.4-A: un documento = una invocación lógica. Los campos nuevos
 * (`phase`, `invocationOutcome`, `attempts`) son estrictamente aditivos y
 * OPCIONALES: todo documento histórico carece de ellos, y esa ausencia es
 * en sí misma la señal de "registro anterior a la trazabilidad por
 * intento" — nunca se migra ni se retrocompleta un documento existente.
 */

export type AiInteractionPhase = 'PHASE_1' | 'PHASE_2' | 'PROTOTYPE';
export type AiInvocationOutcome = 'SUCCESS' | 'FAILED';

/**
 * Un intento físico individual contra Gemini (espejo estructural de
 * `GeminiAttemptRecord`, gemini.client.ts — se mantiene aquí la definición
 * propia para no acoplar el modelo de persistencia a la infraestructura).
 *
 * Semántica de ausencia (ver diseño P1.7.4-A):
 * - `modelVersionEffective` ausente = no hubo objeto de respuesta
 *   (PROVIDER_ERROR); `null` = respuesta sin el campo; string = informado.
 *   NUNCA se sustituye por `modelRequested`.
 * - `usage: null` = sin dato real ni estimable (PROVIDER_ERROR, o
 *   EMPTY_RESPONSE sin usageMetadata).
 * - `usageReported: true` SOLO indica que Google devolvió `usageMetadata`
 *   en ese intento — no es prueba de facturación confirmada.
 */
export interface AiInteractionAttempt {
  attemptNumber: number;
  modelRequested: string;
  modelVersionEffective?: string | null;
  outcome: 'SUCCESS' | 'SCHEMA_MISMATCH' | 'INVALID_JSON' | 'EMPTY_RESPONSE' | 'PROVIDER_ERROR';
  errorReason?: string;
  usage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    thinkingTokens?: number;
    cachedContentTokens?: number;
    toolUsePromptTokens?: number;
  } | null;
  usageReported: boolean;
  executedAt: Date;
}

export interface IAiInteraction extends Document {
  evaluationId: Types.ObjectId;
  /**
   * Obligatoria para los registros de iteración de Phase 1 (incluidos los
   * históricos, que no tienen `phase`); no aplica — y queda ausente, sin
   * valores sentinel — para PHASE_2 y PROTOTYPE.
   */
  iteration?: number;
  phase?: AiInteractionPhase;
  /**
   * Presente solo cuando la invocación lógica realizó ≥1 llamada física a
   * Gemini. Ausente en registros históricos y en iteraciones de Phase 1
   * resueltas por RuleEngine (que nunca llamaron a Gemini).
   */
  invocationOutcome?: AiInvocationOutcome;
  requestTokens: number;
  responseTokens: number;
  executionTimeMs: number;
  metadata: any; // model used, parameters, summary of inputs
  attempts?: AiInteractionAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

const AiInteractionAttemptSchema = new Schema<AiInteractionAttempt>(
  {
    attemptNumber: { type: Number, required: true, min: 1 },
    modelRequested: { type: String, required: true },
    // Sin `required`: ausente y null son estados distintos y ambos válidos.
    modelVersionEffective: { type: String, default: undefined },
    outcome: {
      type: String,
      enum: ['SUCCESS', 'SCHEMA_MISMATCH', 'INVALID_JSON', 'EMPTY_RESPONSE', 'PROVIDER_ERROR'],
      required: true,
    },
    errorReason: { type: String },
    usage: { type: Schema.Types.Mixed, default: null },
    usageReported: { type: Boolean, required: true },
    executedAt: { type: Date, required: true },
  },
  { _id: false },
);

const AiInteractionSchema = new Schema<IAiInteraction>(
  {
    evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', required: true },
    iteration: {
      type: Number,
      min: 1,
      // P1.7.4-A: `required` condicional, evaluado SOLO al escribir — los
      // documentos históricos no se revalidan ni se modifican. Phase 1 (y
      // los escritores históricos, que no envían `phase`) siguen obligados
      // a proveerla; PHASE_2/PROTOTYPE pueden omitirla legítimamente.
      required: function (this: { phase?: string }): boolean {
        return !this.phase || this.phase === 'PHASE_1';
      },
    },
    phase: { type: String, enum: ['PHASE_1', 'PHASE_2', 'PROTOTYPE'] },
    invocationOutcome: { type: String, enum: ['SUCCESS', 'FAILED'] },
    requestTokens: { type: Number, default: 0 },
    responseTokens: { type: Number, default: 0 },
    executionTimeMs: { type: Number, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    // `default: undefined` evita que Mongoose materialice `[]` en documentos
    // que no traen intentos (RuleEngine / históricos).
    attempts: { type: [AiInteractionAttemptSchema], default: undefined },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const AiInteraction = model<IAiInteraction>('AiInteraction', AiInteractionSchema);
