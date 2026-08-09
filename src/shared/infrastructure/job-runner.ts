/**
 * JobRunner — Abstracción para la ejecución asíncrona de tareas en segundo plano.
 *
 * En esta versión MVP, las tareas se procesan en memoria usando setImmediate().
 * Esto aísla a los controladores de Express de la implementación concreta
 * y facilita una futura migración a BullMQ o colas distribuidas.
 */

export interface Job<T = any> {
  id: string;
  type: string;
  data: T;
}

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

export class JobRunner {
  private static instance: JobRunner;
  private handlers: Map<string, JobHandler> = new Map();

  private constructor() {}

  public static getInstance(): JobRunner {
    if (!JobRunner.instance) {
      JobRunner.instance = new JobRunner();
    }
    return JobRunner.instance;
  }

  /**
   * Registra un manejador para un tipo específico de tarea.
   */
  public registerHandler<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler);
  }

  /**
   * Agrega un trabajo a la cola de procesamiento.
   * En el MVP, se ejecuta de forma asíncrona no bloqueante e inmediata.
   */
  public async add<T>(type: string, jobId: string, data: T): Promise<void> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for job type: ${type}`);
    }

    const job: Job<T> = { id: jobId, type, data };

    // Desacoplamos la ejecución usando setImmediate
    setImmediate(async () => {
      try {
        console.log(`[JobRunner] 🚀 Starting job '${jobId}' [${type}]`);
        await handler(job);
        console.log(`[JobRunner] ✅ Completed job '${jobId}' [${type}]`);
      } catch (error) {
        console.error(`[JobRunner] ❌ Error in job '${jobId}' [${type}]:`, error);
      }
    });
  }
}

export const jobRunner = JobRunner.getInstance();
