import fs from 'fs';
import { prototypeEvaluationService } from '@/modules/evaluations/services/prototype-evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';
import { stubGeminiJsonResponses } from '@/shared/testing/gemini-mock-harness';
import { buildValidPrototypeAuditOutputJson } from '@/shared/testing/prototype-gemini-mock-harness';
import { EVALUATION_STATUS, AUDIT_STATUS } from '@/config/constants';

/**
 * [Validación MVP] Confirma que `testRetryOverride` (nuevo parámetro
 * OPCIONAL y aditivo de `prototypeEvaluationService.create()`/`run()`)
 * realmente llega hasta `GeminiClient` -- usando el camino REAL completo
 * (`run()` -> `AiService.performPrototypeAuditAnalysis` -> `GeminiClient.
 * generateMultimodalStructuredWithUsage`, ninguno de los tres mockeado),
 * con solo `client.models.generateContent` interceptado por el harness ya
 * establecido (cero red, cero costo). La prueba de propagación es el
 * NÚMERO DE INTENTOS FÍSICOS observado ante una primera respuesta
 * inválida -- la misma técnica ya usada en
 * `prototype-multimodal-mock.test.ts` (tests 4/5), aplicada ahora a través
 * del job en vez de a una llamada directa a `performPrototypeAuditAnalysis`.
 *
 * `evaluationRepository`/`evaluatorProfileService`/`findingService`/
 * `reportRepository`/`fs.readFileSync` se parchean temporalmente (mismo
 * mecanismo ya validado en `gemini-mock-harness.ts`: reemplazar el método
 * en el singleton real, restaurar el original al final) -- no hay MongoDB
 * vivo en este sandbox (ver `prototype-persistence.test.ts`), así que esto
 * evita cualquier conexión real sin dejar de ejercitar el código real de
 * `PrototypeEvaluationService`.
 */

const FAKE_EVALUATION_ID = 'fake-eval-id';
const FAKE_USER_ID = 'fake-user-id';

function fakeEvaluationDoc() {
  return {
    id: FAKE_EVALUATION_ID,
    title: 'Prototipo de prueba (retry override)',
    description: 'Formulario de contacto ficticio.',
    imageUrl: '/uploads/prototypes/fake-retry-override.png',
    evaluatorProfileId: { toString: () => 'fake-profile-id' },
  } as any;
}

function fakeProfile() {
  return {
    fullName: 'Perfil de prueba',
    archetype: 'El Explorador',
    profession: 'QA',
    phrase: 'frase',
    goals: ['probar'],
    frustrations: ['confusión'],
    techSavviness: 'medium',
    accessibilityNeeds: [],
    preferredDevice: 'desktop',
    biography: undefined,
  } as any;
}

/** Instala todos los parches comunes a ambos escenarios; devuelve una función `restore()` única. */
function patchDependencies() {
  const originals = {
    findByIdAndUserId: evaluationRepository.findByIdAndUserId,
    update: evaluationRepository.update,
    profileFindById: evaluatorProfileService.findById,
    findingCreate: findingService.create,
    reportFindByEvaluationId: reportRepository.findByEvaluationId,
    reportCreate: reportRepository.create,
    readFileSync: fs.readFileSync,
    logInvocation: aiInteractionService.logInvocation,
  };

  const updateCalls: any[] = [];

  (evaluationRepository as any).findByIdAndUserId = async () => fakeEvaluationDoc();
  (evaluationRepository as any).update = async (_id: string, _userId: string, dto: any) => {
    updateCalls.push(dto);
    return fakeEvaluationDoc();
  };
  (evaluatorProfileService as any).findById = async () => fakeProfile();
  (findingService as any).create = async () => ({});
  (reportRepository as any).findByEvaluationId = async () => null;
  (reportRepository as any).create = async () => ({});
  // P1.7.4-A: la traza de invocación PROTOTYPE (éxito o fallo) se captura en memoria (sin MongoDB vivo en este sandbox).
  (aiInteractionService as any).logInvocation = async (params: any) => params;
  (fs as any).readFileSync = ((path: string, ...rest: any[]) => {
    if (typeof path === 'string' && path.includes('fake-retry-override.png')) {
      return Buffer.from('fake-png-bytes');
    }
    return originals.readFileSync(path, ...rest);
  }) as any;

  return {
    updateCalls,
    restore: () => {
      (evaluationRepository as any).findByIdAndUserId = originals.findByIdAndUserId;
      (evaluationRepository as any).update = originals.update;
      (evaluatorProfileService as any).findById = originals.profileFindById;
      (findingService as any).create = originals.findingCreate;
      (reportRepository as any).findByEvaluationId = originals.reportFindByEvaluationId;
      (reportRepository as any).create = originals.reportCreate;
      (fs as any).readFileSync = originals.readFileSync;
      (aiInteractionService as any).logInvocation = originals.logInvocation;
    },
  };
}

async function runTests() {
  console.log('🧪 Starting Prototype Evaluation — testRetryOverride propagation (MOCK ONLY) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 1. CON testRetryOverride:{maxRetries:0} -- una primera respuesta JSON
  // inválida debe propagarse como error SIN un segundo intento físico, y la
  // evaluación debe quedar FAILED (camino real de manejo de errores de run()).
  {
    const deps = patchDependencies();
    const stub = stubGeminiJsonResponses(['esto no es JSON válido', buildValidPrototypeAuditOutputJson([])]);
    try {
      await (prototypeEvaluationService as any).run(FAKE_EVALUATION_ID, FAKE_USER_ID, { maxRetries: 0 });
      assert(stub.callCount() === 1, '[PROPAGACIÓN] Con testRetryOverride:{maxRetries:0}, NUNCA ocurre un segundo intento físico (callCount=1) aunque existía una segunda respuesta válida disponible para servir');
      const failedUpdate = deps.updateCalls.find((u) => u.status === EVALUATION_STATUS.FAILED);
      assert(!!failedUpdate && failedUpdate.auditStatus === AUDIT_STATUS.FAILED, '[PROPAGACIÓN] run() marca la evaluación FAILED/FAILED tras el error propagado (maxRetries:0 impidió el reintento que la habría salvado)');
    } finally {
      stub.restore();
      deps.restore();
    }
  }

  // 2. SIN testRetryOverride (comportamiento de producción) -- la misma
  // secuencia de respuestas (inválida, luego válida) SÍ se reintenta una
  // vez (política global AI_RETRY_CONFIG.maxRetries=3), y la evaluación
  // termina COMPLETED/COMPLETED.
  {
    const deps = patchDependencies();
    const stub = stubGeminiJsonResponses(['esto tampoco es JSON válido', buildValidPrototypeAuditOutputJson([])]);
    try {
      await (prototypeEvaluationService as any).run(FAKE_EVALUATION_ID, FAKE_USER_ID, undefined);
      assert(stub.callCount() === 2, '[PRODUCCIÓN INTACTA] Sin testRetryOverride, la política global SÍ reintenta una vez ante la misma respuesta inválida (callCount=2) -- el comportamiento de producción no cambió');
      const completedUpdate = deps.updateCalls.find((u) => u.status === EVALUATION_STATUS.COMPLETED);
      assert(!!completedUpdate && completedUpdate.auditStatus === AUDIT_STATUS.COMPLETED, '[PRODUCCIÓN INTACTA] run() completa exitosamente (COMPLETED/COMPLETED) usando la respuesta válida obtenida en el reintento');
    } finally {
      stub.restore();
      deps.restore();
    }
  }

  // 3. create() propaga testRetryOverride hacia el job encolado (job.data),
  // sin tocar ningún otro campo del job ni requerir base de datos real.
  {
    const deps = patchDependencies();
    const originalEvaluationCreate = evaluationRepository.create;
    const originalImageStore = (await import('@/modules/evaluations/services/prototype-image-upload.service')).prototypeImageUploadService.store;
    const { prototypeImageUploadService } = await import('@/modules/evaluations/services/prototype-image-upload.service');
    const { jobRunner } = await import('@/shared/infrastructure/job-runner');
    const originalJobRunnerAdd = jobRunner.add;
    let capturedJobData: any = null;
    try {
      (evaluationRepository as any).create = async () => fakeEvaluationDoc();
      (prototypeImageUploadService as any).store = () => ({ url: '/uploads/prototypes/fake-retry-override.png' });
      (jobRunner as any).add = async (_type: string, _id: string, data: any) => {
        capturedJobData = data;
      };

      await prototypeEvaluationService.create(
        FAKE_USER_ID,
        { evaluatorProfileId: 'fake-profile-id', description: 'Formulario de contacto ficticio para pruebas de propagación de retryOpts.' } as any,
        { buffer: Buffer.from('fake'), size: 4, originalname: 'fake.png' },
        { maxRetries: 0 },
      );

      assert(
        !!capturedJobData && capturedJobData.testRetryOverride && capturedJobData.testRetryOverride.maxRetries === 0,
        '[PROPAGACIÓN] create() encola el job con testRetryOverride:{maxRetries:0} intacto en job.data',
      );
    } finally {
      (evaluationRepository as any).create = originalEvaluationCreate;
      (prototypeImageUploadService as any).store = originalImageStore;
      (jobRunner as any).add = originalJobRunnerAdd;
      deps.restore();
    }
  }

  // 4. create() SIN testRetryOverride -- job.data.testRetryOverride es
  // undefined, igual que lo hace el controlador HTTP real (que nunca pasa
  // un 4º argumento), confirmando que el comportamiento por defecto no cambió.
  {
    const deps = patchDependencies();
    const originalEvaluationCreate = evaluationRepository.create;
    const { prototypeImageUploadService } = await import('@/modules/evaluations/services/prototype-image-upload.service');
    const originalImageStore = prototypeImageUploadService.store;
    const { jobRunner } = await import('@/shared/infrastructure/job-runner');
    const originalJobRunnerAdd = jobRunner.add;
    let capturedJobData: any = null;
    try {
      (evaluationRepository as any).create = async () => fakeEvaluationDoc();
      (prototypeImageUploadService as any).store = () => ({ url: '/uploads/prototypes/fake-retry-override.png' });
      (jobRunner as any).add = async (_type: string, _id: string, data: any) => {
        capturedJobData = data;
      };

      await prototypeEvaluationService.create(
        FAKE_USER_ID,
        { evaluatorProfileId: 'fake-profile-id', description: 'Formulario de contacto ficticio para pruebas de propagación de retryOpts.' } as any,
        { buffer: Buffer.from('fake'), size: 4, originalname: 'fake.png' },
      );

      assert(
        !!capturedJobData && capturedJobData.testRetryOverride === undefined,
        '[PRODUCCIÓN INTACTA] create() llamado como lo hace el controlador HTTP real (sin 4º argumento) deja job.data.testRetryOverride === undefined',
      );
    } finally {
      (evaluationRepository as any).create = originalEvaluationCreate;
      (prototypeImageUploadService as any).store = originalImageStore;
      (jobRunner as any).add = originalJobRunnerAdd;
      deps.restore();
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((e) => { console.error('❌ crashed:', e); process.exit(1); });
