import { Schema, model, Document, Types } from 'mongoose';
import {
  EVALUATION_STATUS,
  EvaluationStatus,
  AUDIT_STATUS,
  AuditStatus,
} from '@/config/constants';

/**
 * Evaluation — Core entity representing a UX evaluation session (State Machine).
 */
export interface IEvaluation extends Document {
  userId: Types.ObjectId;
  evaluatorProfileId: Types.ObjectId;
  title: string;
  description?: string;
  type: 'prototype' | 'website';
  /** Requerido únicamente cuando `type === 'website'` (ver `EvaluationSchema.url` abajo). */
  url?: string;
  /**
   * Prototype visual evaluation (P4) — ruta estática servida (`/uploads/
   * prototypes/<uuid>.<ext>`), nunca el binario embebido en Mongo. Presente
   * únicamente cuando `type === 'prototype'`.
   */
  imageUrl?: string;
  status: EvaluationStatus;
  auditStatus: AuditStatus;

  // JSON Contract Mapping
  flowDefinition: {
    flowDescription: string;
    totalStepsEstimated: number;
  };
  flowState: {
    currentStep: number;
    completedSteps: string[];
    previousActions: Array<{ actionType: string; description: string; result: string }>;
    blockingError: string | null;
    /**
     * P1.2 — por qué terminó el bucle de exploración (evaluation.service.ts,
     * runEvaluation), calculado UNA VEZ al salir, nunca inferido después.
     * Opcional/aditivo: ausente en documentos anteriores a este cambio — su
     * ausencia NUNCA debe interpretarse como "terminación natural confirmada",
     * solo como "dato no disponible" (ver buildExplorationIntegrity).
     */
    terminationReason?: 'NATURAL_STOP' | 'MAX_ITERATIONS_REACHED' | 'ACTION_FAILED' | 'INVALID_ACTION_DECISION' | 'EXPLORATION_ERROR' | 'UNKNOWN';
    /** P1.2 — límite de iteraciones efectivamente usado (calculado dinámicamente en la iteración 1). Nunca persistido antes de este cambio. */
    maxIterationsUsed?: number;
    /**
     * P1.2 — integridad de la EVIDENCIA capturada, dimensión separada de
     * `terminationReason` (por qué terminó el bucle) a propósito: un fallo de
     * guardado de un snapshot no es un agotamiento de iteraciones ni un fallo
     * de acción de Playwright, es una tercera causa independiente.
     */
    snapshotIntegrity?: {
      /** Iteraciones en las que `snapshotEvidenceService.saveEvidence` lanzó una excepción (antes solo se registraba con `console.warn`, sin dejar rastro persistido). */
      persistenceFailures: Array<{ iteration: number; error: string }>;
      /**
       * `false` únicamente cuando la última acción registrada en
       * `previousActions` fue técnicamente exitosa pero el bucle terminó
       * (por `MAX_ITERATIONS_REACHED`) antes de capturar un snapshot que
       * reflejara su efecto -- nunca se infiere evidencia donde no la hay.
       */
      lastActionVerifiedBySnapshot: boolean;
    };
  };

  createdAt: Date;
  updatedAt: Date;
}

const EvaluationSchema = new Schema<IEvaluation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    evaluatorProfileId: { type: Schema.Types.ObjectId, ref: 'EvaluatorProfile', required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    type: { type: String, enum: ['prototype', 'website'], required: true },
    url: {
      type: String,
      required: [
        function (this: IEvaluation) {
          return this.type === 'website';
        },
        'URL is required for website evaluations',
      ],
      trim: true,
    },
    imageUrl: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(EVALUATION_STATUS),
      default: EVALUATION_STATUS.PENDING,
    },
    auditStatus: {
      type: String,
      enum: Object.values(AUDIT_STATUS),
      default: AUDIT_STATUS.PENDING,
    },
    flowDefinition: {
      flowDescription: { type: String },
      totalStepsEstimated: { type: Number },
    },
    flowState: {
      currentStep: { type: Number, default: 1 },
      completedSteps: [{ type: String }],
      previousActions: [
        {
          actionType: { type: String },
          description: { type: String },
          result: { type: String, enum: ['success', 'failure'] },
        },
      ],
      blockingError: { type: String, default: null },
      terminationReason: { type: String, enum: ['NATURAL_STOP', 'MAX_ITERATIONS_REACHED', 'ACTION_FAILED', 'INVALID_ACTION_DECISION', 'EXPLORATION_ERROR', 'UNKNOWN'] },
      maxIterationsUsed: { type: Number },
      snapshotIntegrity: {
        persistenceFailures: [
          {
            iteration: { type: Number },
            error: { type: String },
          },
        ],
        lastActionVerifiedBySnapshot: { type: Boolean },
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

EvaluationSchema.index({ status: 1 });
EvaluationSchema.index({ auditStatus: 1 });
EvaluationSchema.index({ createdAt: -1 });

export const Evaluation = model<IEvaluation>('Evaluation', EvaluationSchema);
