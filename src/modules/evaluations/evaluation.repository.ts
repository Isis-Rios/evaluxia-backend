import { Evaluation, IEvaluation } from './evaluation.model';
import { Types } from 'mongoose';
import { CreateEvaluationDto, GetEvaluationsQuery } from './dto/evaluation.dto';
import { EVALUATION_STATUS, AUDIT_STATUS } from '@/config/constants';

const STUCK_RECONCILIATION_MESSAGE =
  'La evaluación quedó inconclusa porque el servidor se reinició o se detuvo mientras se procesaba (JobRunner en memoria, sin persistencia de cola). Vuelve a intentar la evaluación.';

/**
 * EvaluationRepository — Encapsulates all Mongoose operations for Evaluation.
 *
 * All read queries are scoped by userId to enforce data ownership.
 */
export class EvaluationRepository {
  async findAll(
    userId: string,
    query: GetEvaluationsQuery,
  ): Promise<{ data: IEvaluation[]; total: number }> {
    const filter = query.status ? { userId, status: query.status } : { userId };
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      Evaluation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
      Evaluation.countDocuments(filter),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findById(id);
  }

  async findByIdAndUserId(id: string, userId: string): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOne({ _id: id, userId });
  }

  /**
   * Returns the ids of every evaluation owned by `userId`. Used to scope
   * cross-evaluation queries (e.g. an unfiltered findings listing) to
   * resources the caller actually owns.
   */
  async findIdsByUserId(userId: string): Promise<string[]> {
    const docs = await Evaluation.find({ userId }).select('_id').lean();
    return docs.map((doc) => doc._id.toString());
  }

  async create(userId: string, dto: CreateEvaluationDto): Promise<IEvaluation> {
    return Evaluation.create({ ...dto, userId });
  }

  async update(
    id: string,
    userId: string,
    dto: Partial<IEvaluation> | Record<string, any>,
  ): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOneAndUpdate({ _id: id, userId }, dto, {
      new: true,
      runValidators: true,
    });
  }

  async delete(id: string, userId: string): Promise<IEvaluation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return Evaluation.findOneAndDelete({ _id: id, userId });
  }

  /**
   * [Revisión MVP] Mitigación mínima para el JobRunner en memoria
   * (shared/infrastructure/job-runner.ts): no persiste su cola, así que un
   * reinicio/caída del proceso mientras una evaluación está en
   * status/auditStatus='running' la deja atascada ahí para siempre -- el
   * frontend (useEvaluations.ts) sondea indefinidamente sin ninguna señal de
   * error. Esto NO recupera el trabajo perdido (eso requeriría una cola
   * persistente, fuera de alcance de un cambio mínimo); solo garantiza que,
   * al arrancar, cualquier evaluación que quedó 'running' de una ejecución
   * anterior del proceso se marque FAILED de inmediato, para que el usuario
   * vea un estado terminal real en vez de un spinner infinito. Deliberadamente
   * NO se escopa por userId (es una operación de arranque sobre toda la base,
   * no una consulta a nombre de un usuario) -- único método de este
   * repositorio con esa excepción, documentada aquí.
   */
  async reconcileStuckRunning(): Promise<{ evaluations: number; audits: number }> {
    const [evaluations, audits] = await Promise.all([
      Evaluation.updateMany(
        { status: EVALUATION_STATUS.RUNNING },
        {
          $set: {
            status: EVALUATION_STATUS.FAILED,
            'flowState.blockingError': STUCK_RECONCILIATION_MESSAGE,
          },
        },
      ),
      Evaluation.updateMany(
        { auditStatus: AUDIT_STATUS.RUNNING },
        { $set: { auditStatus: AUDIT_STATUS.FAILED } },
      ),
    ]);
    return { evaluations: evaluations.modifiedCount, audits: audits.modifiedCount };
  }
}

export const evaluationRepository = new EvaluationRepository();
