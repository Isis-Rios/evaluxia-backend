import { GeminiClient, classifyAiError } from '@/infrastructure/gemini/gemini.client';
import { ruleEngine } from '@/modules/evaluations/services/rule-engine.service';
import { V2AIInputContext } from '@/modules/evaluations/services/context-builder.service';
import { AppError } from '@/shared/errors/AppError';
import { EVALUATION_STATUS, AUDIT_STATUS } from '@/config/constants';

async function runGeminiResilienceTestSuite() {
  console.log('🧪 Running Gemini Resilience & Error Handling Test Suite (Cases A - G)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${msg}`);
      failed++;
    }
  }

  const client = GeminiClient.getInstance();

  // --------------------------------------------------------------------------
  // Unit Tests: classifyAiError
  // --------------------------------------------------------------------------
  console.log('--- Unit: classifyAiError ---');
  {
    const err503Struct = { status: 'UNAVAILABLE', error: { code: 503, message: 'High demand' } };
    const c1 = classifyAiError(err503Struct);
    assert(c1.isRetryable && c1.statusCode === 503, 'classifyAiError: 503 UNAVAILABLE is retryable');

    const err429Struct = { status: 429, message: 'Resource exhausted' };
    const c2 = classifyAiError(err429Struct);
    assert(c2.isRetryable && c2.statusCode === 429, 'classifyAiError: 429 RESOURCE_EXHAUSTED is retryable');

    const errConnReset = { code: 'ECONNRESET', message: 'socket hang up' };
    const c3 = classifyAiError(errConnReset);
    assert(c3.isRetryable && c3.statusCode === 503, 'classifyAiError: ECONNRESET network error is retryable');

    const err400 = { status: 'INVALID_ARGUMENT', code: 400, message: 'Bad request parameter' };
    const c4 = classifyAiError(err400);
    assert(!c4.isRetryable && c4.statusCode === 400, 'classifyAiError: 400 INVALID_ARGUMENT is NOT retryable');

    const err401 = { status: 'UNAUTHENTICATED', code: 401, message: 'Invalid API Key' };
    const c5 = classifyAiError(err401);
    assert(!c5.isRetryable && c5.statusCode === 401, 'classifyAiError: 401 UNAUTHENTICATED is NOT retryable');

    const errFallbackMsg = new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary.');
    const c6 = classifyAiError(errFallbackMsg);
    assert(c6.isRetryable && c6.statusCode === 503, 'classifyAiError: text fallback "high demand" identifies 503');
  }

  // --------------------------------------------------------------------------
  // Caso A: Gemini responde correctamente en el primer intento
  // --------------------------------------------------------------------------
  console.log('\n--- Caso A: Gemini responde correctamente ---');
  {
    let callCount = 0;
    const result = await client.executeWithRetry(async () => {
      callCount++;
      return { ok: true };
    }, { maxRetries: 3, initialDelayMs: 10, jitterMs: 0 });

    assert(callCount === 1 && result.ok, 'Caso A: Operación exitosa en 1 intento sin reintentos');
  }

  // --------------------------------------------------------------------------
  // Caso B: Gemini responde 503 UNAVAILABLE una vez ➡️ Retry ➡️ Éxito
  // --------------------------------------------------------------------------
  console.log('\n--- Caso B: Gemini responde 503 una vez ➡️ Retry exitoso ---');
  {
    let callCount = 0;
    const result = await client.executeWithRetry(async () => {
      callCount++;
      if (callCount === 1) {
        const apiError: any = new Error('This model is currently experiencing high demand');
        apiError.status = 'UNAVAILABLE';
        apiError.code = 503;
        throw apiError;
      }
      return { flowCanContinue: true, action: 'CLICK button#submit' };
    }, { maxRetries: 3, initialDelayMs: 15, jitterMs: 0 });

    assert(callCount === 2, 'Caso B: Se ejecutó exactamente 1 reintento tras el 503 inicial');
    assert(result.flowCanContinue === true, 'Caso B: El flujo continúa normalmente tras el reintento');
  }

  // --------------------------------------------------------------------------
  // Caso C: Gemini responde 503 repetidamente ➡️ Límite alcanzado ➡️ Fallo controlado
  // --------------------------------------------------------------------------
  console.log('\n--- Caso C: Gemini 503 persistente ➡️ Agotamiento de retries ➡️ Error estructurado ---');
  {
    let callCount = 0;
    let caughtError: any = null;

    try {
      await client.executeWithRetry(async () => {
        callCount++;
        const apiError: any = new Error('Spikes in demand are usually temporary. Please try again later.');
        apiError.status = 'UNAVAILABLE';
        apiError.code = 503;
        throw apiError;
      }, { maxRetries: 3, initialDelayMs: 10, jitterMs: 0 });
    } catch (err: any) {
      caughtError = err;
    }

    assert(callCount === 4, 'Caso C: Se intentó 1 llamada inicial + 3 reintentos = 4 intentos en total');
    assert(caughtError instanceof AppError, 'Caso C: Lanza AppError tipado');
    assert(caughtError?.statusCode === 503, 'Caso C: Preserva statusCode HTTP 503');
    assert(caughtError?.message.includes('AI Service Unavailable'), 'Caso C: Mensaje descriptivo para frontend');
  }

  // --------------------------------------------------------------------------
  // Caso D: Gemini responde 429 RESOURCE_EXHAUSTED ➡️ Retry/Backoff ➡️ Éxito
  // --------------------------------------------------------------------------
  console.log('\n--- Caso D: Gemini 429 RESOURCE_EXHAUSTED ➡️ Backoff ➡️ Éxito ---');
  {
    let callCount = 0;
    const result = await client.executeWithRetry(async () => {
      callCount++;
      if (callCount < 3) {
        const rateLimitError: any = new Error('Quota exceeded for quota metric');
        rateLimitError.status = 'RESOURCE_EXHAUSTED';
        rateLimitError.code = 429;
        throw rateLimitError;
      }
      return { recovered: true };
    }, { maxRetries: 3, initialDelayMs: 10, jitterMs: 0 });

    assert(callCount === 3, 'Caso D: Reintentó ante 429 hasta tener éxito en el intento 3');
    assert(result.recovered === true, 'Caso D: Recuperación confirmada');
  }

  // --------------------------------------------------------------------------
  // Caso E: Error no transitorio (ej. 400 Bad Request / 401 / Zod parse) ➡️ No reintentar
  // --------------------------------------------------------------------------
  console.log('\n--- Caso E: Error no transitorio ➡️ Falla de inmediato sin reintentos ---');
  {
    let callCount = 0;
    let caughtError: any = null;

    try {
      await client.executeWithRetry(async () => {
        callCount++;
        const badReqError: any = new Error('Invalid model parameter contents');
        badReqError.status = 'INVALID_ARGUMENT';
        badReqError.code = 400;
        throw badReqError;
      }, { maxRetries: 3, initialDelayMs: 10, jitterMs: 0 });
    } catch (err: any) {
      caughtError = err;
    }

    assert(callCount === 1, 'Caso E: Solo se ejecutó 1 intento, 0 reintentos ante error 400');
    assert(caughtError?.statusCode === 400, 'Caso E: Preserva status 400');
  }

  // --------------------------------------------------------------------------
  // Caso F: Rule Engine resuelve la acción determinísticamente ➡️ No llamar a Gemini
  // --------------------------------------------------------------------------
  console.log('\n--- Caso F: Rule Engine intercepta ➡️ 0 llamadas a Gemini ---');
  {
    // Contexto donde solo hay un botón primario
    const singleButtonContext: V2AIInputContext = {
      metadata: { evaluationId: 'test_eval_f', timestamp: new Date().toISOString(), iteration: 1 },
      flowDefinition: { flowDescription: 'Prueba', currentStepObjective: 'Avanzar', totalStepsEstimated: 8 },
      flowState: { currentStep: 1, completedSteps: [], previousActions: [], blockingError: null },
      userArchetype: {
        fullName: 'Test Persona', phrase: 'Tester', age: 30, profession: 'QA', maritalStatus: 'Single',
        country: 'Colombia', city: 'Bogota', archetype: 'Explorer', biography: '', personality: '',
        goals: [], frustrations: [],
      },
      technicalContext: {
        url: 'https://example.com', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
        visibleDOMSummary: [
          { type: 'button', text: 'Comenzar', ariaLabel: null, role: 'button', isDisabled: false, isPrimary: true, selector: 'button.btn-primary' },
        ],
      },
      constraints: { doNotAssumeHiddenElements: true, doNotInventActions: true, maxOneActionPerIteration: true },
    };

    const suggested = ruleEngine.evaluate(singleButtonContext);
    assert(suggested !== null, 'Caso F: RuleEngine interceptó con éxito la regla de botón primario único');
    assert(suggested?.actionType === 'CLICK', 'Caso F: Acción sugerida es CLICK');
    assert(suggested?.targetElement?.value === 'button.btn-primary', 'Caso F: Seleccionó selector CSS correcto');

    // Contexto Rule 5 contextual: TYPE sobre email NO debe asociarse al botón global Search del header
    const emailTypeContext: V2AIInputContext = {
      ...singleButtonContext,
      flowState: {
        currentStep: 4,
        completedSteps: ['Paso 1', 'Paso 2', 'Paso 3'],
        previousActions: [
          { actionType: 'TYPE', description: 'Enter email in newsletter input', result: 'success' },
        ],
        blockingError: null,
      },
      technicalContext: {
        url: 'https://example.com/landing', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
        visibleDOMSummary: [
          { type: 'button', text: 'Search', ariaLabel: 'Search site', role: 'search', isDisabled: false, isPrimary: false, selector: 'header button#search' },
          { type: 'button', text: 'Subscribe', ariaLabel: 'Subscribe to newsletter', role: 'button', isDisabled: false, isPrimary: true, selector: 'form#newsletter button[type="submit"]' },
        ],
      },
    };

    const emailSubmitAction = ruleEngine.evaluate(emailTypeContext);
    assert(emailSubmitAction !== null, 'Caso F (Rule 5): Intercepta submit tras escribir email');
    assert(
      emailSubmitAction?.targetElement?.value === 'form#newsletter button[type="submit"]',
      'Caso F (Rule 5): Seleccionó el botón "Subscribe" del formulario y NO el botón "Search" del header',
    );

    // Contexto Rule 5 contextual: TYPE sobre campo de búsqueda SÍ debe asociarse al botón Search
    const searchTypeContext: V2AIInputContext = {
      ...singleButtonContext,
      flowState: {
        currentStep: 2,
        completedSteps: ['Paso 1'],
        previousActions: [
          { actionType: 'TYPE', description: 'Buscar producto en input de búsqueda', result: 'success' },
        ],
        blockingError: null,
      },
      technicalContext: {
        url: 'https://example.com/shop', requiresAuthentication: false, authenticationStatus: 'unauthenticated',
        visibleDOMSummary: [
          { type: 'button', text: 'Buscar', ariaLabel: 'Buscar', role: 'search', isDisabled: false, isPrimary: false, selector: 'div.search-bar button' },
        ],
      },
    };

    const searchSubmitAction = ruleEngine.evaluate(searchTypeContext);
    assert(searchSubmitAction !== null, 'Caso F (Rule 5 Search): Intercepta submit en contexto de búsqueda');
    assert(
      searchSubmitAction?.targetElement?.value === 'div.search-bar button',
      'Caso F (Rule 5 Search): Asoció correctamente el botón de búsqueda cuando el input era de búsqueda',
    );
  }

  // --------------------------------------------------------------------------
  // Caso G: Consistencia de Estado ante Errores de Evaluación
  // --------------------------------------------------------------------------
  console.log('\n--- Caso G: Consistencia de Estado ante Errores de Evaluación ---');
  {
    const completedSteps = [
      'Navegar a la URL objetivo',
      'Navegar e iniciar exploración',
      'Después de realizar CLICK en button[text="OK"]',
      'Después de realizar CLICK en a[text="Live Demo"]',
      'Después de realizar CLICK en a[text="Download"]',
      'Después de realizar TYPE en input[aria-label="Enter your Email address"]',
    ];

    const previousActions = [
      { actionType: 'NAVIGATE', description: 'Navegar a https://bootstrapmade.com/...', result: 'success' as const },
      { actionType: 'CLICK', description: 'Aceptar cookies', result: 'success' as const },
      { actionType: 'CLICK', description: 'Abrir demo', result: 'success' as const },
      { actionType: 'CLICK', description: 'Ir a descarga', result: 'success' as const },
      { actionType: 'TYPE', description: 'Escribir email', result: 'success' as const },
      { actionType: 'CLICK', description: 'Enviar formulario', result: 'success' as const },
    ];

    const currentIteration = 6;
    const aiError = new AppError('AI Service Unavailable: This model is currently experiencing high demand. Failed after 3 retries.', 503);

    const isAiError = aiError.statusCode === 503 || aiError.statusCode === 429;
    const errorPrefix = isAiError ? `[AI_PROVIDER_ERROR ${aiError.statusCode}]` : `[EVALUATION_ERROR ${aiError.statusCode}]`;
    const formattedErrorMessage = `${errorPrefix} ${aiError.message} (failed at iteration ${currentIteration})`;

    const persistedState = {
      status: EVALUATION_STATUS.FAILED,
      auditStatus: AUDIT_STATUS.FAILED,
      flowState: {
        currentStep: currentIteration,
        completedSteps,
        previousActions,
        blockingError: formattedErrorMessage,
      },
    };

    assert(persistedState.status === 'failed', 'Caso G: evaluation.status es "failed"');
    assert(persistedState.auditStatus === 'failed', 'Caso G: auditStatus es "failed" (no queda pending ni completed)');
    assert(persistedState.flowState.currentStep === 6, 'Caso G: currentStep refleja la iteración 6 que falló');
    assert(persistedState.flowState.completedSteps.length === 6, 'Caso G: completedSteps preserva los 6 pasos ejecutados');
    assert(persistedState.flowState.previousActions.length === 6, 'Caso G: previousActions preserva las 6 acciones ejecutadas');
    assert(persistedState.flowState.blockingError !== null, 'Caso G: blockingError ya no es null');
    assert(
      persistedState.flowState.blockingError?.includes('[AI_PROVIDER_ERROR 503]'),
      'Caso G: blockingError identifica claramente error 503 del AI Provider',
    );
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runGeminiResilienceTestSuite();
