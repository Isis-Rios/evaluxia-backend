import fs from 'fs';
import { evaluationRepository } from '../evaluation.repository';
import { IEvaluation } from '../evaluation.model';
import { CreatePrototypeEvaluationDto } from '@/modules/ai/contracts/prototype.contracts';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { aiService } from '@/modules/ai/ai.service';
import { findingService } from '@/modules/findings/finding.service';
import { reportRepository } from '@/modules/reports/report.repository';
import { metricsTracker } from '@/shared/infrastructure/metrics-tracker';
import { jobRunner } from '@/shared/infrastructure/job-runner';
import { EVALUATION_STATUS, AUDIT_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import {
  prototypeImageUploadService,
  mimeTypeForFormat,
  StoredPrototypeImage,
} from './prototype-image-upload.service';
import { visualEvidenceGateService } from './visual-evidence-gate.service';
import { applyVisualEvidenceConsistency } from './visual-evidence-consistency.service';
import { applyCardinalityEnforcement } from '@/shared/testing/wcag-criterion-cardinality';
import { calculatePrototypeMetrics } from './prototype-metrics.service';
import { RetryOptions } from '@/infrastructure/gemini/gemini.client';
import { PrototypeAuditFinding } from '@/modules/ai/contracts/prototype.contracts';
import { aiInteractionService } from '@/modules/ai-interactions/ai-interaction.service';

/**
 * P1.6.4.2 Parte 3 — protección determinista MÍNIMA del resumen ejecutivo de
 * prototipos, análoga en intención (no en texto -- el lenguaje de WEB habla
 * de "exploración", que no existe aquí) a `appendSummaryDisclaimer` de WEB.
 * Deliberadamente condicional (solo se agrega cuando SÍ hay al menos un
 * NOT_EVALUABLE) para no convertir el resumen en una lista de advertencias
 * cuando no hace falta -- requisito explícito de P1.6.4.2.
 *
 * Límite aceptado y documentado (no resoluble sin análisis semántico, ver
 * P1.6.4.2 Sección 3): esta función NO puede detectar ni corregir una
 * oración específica de Gemini que ya contradiga esta aclaración genérica
 * (p. ej. si `executiveSummary` afirma textualmente "el formulario carece
 * de validación" pese a que ese mismo hallazgo quedó NOT_EVALUABLE) -- solo
 * garantiza que, junto a esa afirmación, el reporte también declare
 * explícitamente qué criterios no pudieron verificarse y que cualquier
 * mención a ellos no debe tomarse como confirmada. Resolver la
 * contradicción específica requeriría editar o regenerar el texto de
 * Gemini, lo cual excede el alcance de una protección determinista.
 */
function appendNotEvaluableDisclaimer(executiveSummary: string, notEvaluableFindings: PrototypeAuditFinding[]): string {
  if (notEvaluableFindings.length === 0) return executiveSummary;

  const criteria = Array.from(
    new Set(
      notEvaluableFindings
        .map((f) => f.wcagCriterion || f.heuristicName || f.heuristicCode)
        .filter((c): c is string => !!c),
    ),
  );

  return (
    `${executiveSummary}\n\n` +
    `Nota: los siguientes aspectos no pudieron verificarse con la imagen disponible${criteria.length > 0 ? `: ${criteria.join(', ')}` : ''}. ` +
    'Si este resumen menciona alguno de ellos, debe interpretarse como una limitación de la evaluación, nunca como un problema confirmado -- consulte los hallazgos con status FAIL para los problemas verificados.'
  );
}

const JOB_TYPE = 'prototype-evaluation';

export interface PrototypeEvaluationJobData {
  userId: string;
  /**
   * [Validación MVP] SOLO PRUEBAS -- inalcanzable desde HTTP. El controlador
   * (`evaluation.controller.ts: createPrototype`) llama a `create()` con
   * exactamente 3 argumentos posicionales, así que este 4º parámetro nunca
   * puede poblarse desde una petición real. Existe ÚNICAMENTE para que un
   * script de validación con acceso directo al servicio (nunca vía HTTP)
   * pueda acotar `maxRetries` para esa ejecución puntual, sin tocar
   * `AI_RETRY_CONFIG` global ni el comportamiento de ningún otro llamador
   * -- mismo patrón ya aprobado que el `retryOpts` opcional de
   * `AiService.performPrototypeAuditAnalysis` (P7.0.1).
   */
  testRetryOverride?: RetryOptions;
}

/**
 * PrototypeEvaluationService (P4, sección 22) — orquesta el flujo completo
 * de una evaluación de prototipo visual, análogo combinado de
 * `EvaluationService`+`AuditEngine` para WEB (no hay fase de exploración
 * separada: una imagen estática no tiene navegación). Responsabilidades:
 * validar input, guardar imagen, construir contexto visual, resolver
 * criterios aplicables, construir prompt, invocar AI (multimodal, MOCK en
 * esta fase), ejecutar validaciones visuales (Gate V0 + Consistency +
 * cardinalidad), consolidar métricas, persistir Finding/Report, dejar
 * disponible el resultado para polling/frontend (mismo patrón de
 * status/auditStatus que WEB).
 */
export class PrototypeEvaluationService {
  constructor() {
    jobRunner.registerHandler<PrototypeEvaluationJobData>(JOB_TYPE, async (job) => {
      await this.run(job.id, job.data.userId, job.data.testRetryOverride);
    });
  }

  /**
   * Valida input, guarda la imagen (síncrono, rápido) y crea la Evaluation
   * en estado PENDING. Encola el resto del flujo (invocación AI +
   * validaciones + persistencia) como un job async, igual que WEB.
   */
  public async create(
    userId: string,
    dto: CreatePrototypeEvaluationDto,
    file: { buffer: Buffer; size: number; originalname?: string },
    /**
     * [Validación MVP] 4º parámetro OPCIONAL y aditivo -- ver el comentario
     * de `PrototypeEvaluationJobData.testRetryOverride`. `evaluation.
     * controller.ts` nunca lo pasa, así que por defecto es `undefined` y el
     * comportamiento de producción (política global `AI_RETRY_CONFIG`) no
     * cambia para ningún llamador existente.
     */
    testRetryOverride?: RetryOptions,
  ): Promise<IEvaluation> {
    await evaluatorProfileService.findById(userId, dto.evaluatorProfileId);

    const stored = prototypeImageUploadService.store(file);

    const evaluation = await evaluationRepository.create(userId, {
      evaluatorProfileId: dto.evaluatorProfileId,
      title: dto.title || dto.description.slice(0, 80),
      description: dto.description,
      type: 'prototype',
    } as any);

    await evaluationRepository.update(evaluation.id, userId, {
      imageUrl: stored.url,
      status: EVALUATION_STATUS.RUNNING,
      auditStatus: AUDIT_STATUS.RUNNING,
    });

    await jobRunner.add<PrototypeEvaluationJobData>(JOB_TYPE, evaluation.id, { userId, testRetryOverride });

    return (await evaluationRepository.findByIdAndUserId(evaluation.id, userId))!;
  }

  /**
   * Flujo async completo (sección 22, pasos 3-11). Steps 1-2 (validar
   * input, guardar imagen) ya ocurrieron síncronamente en `create` —
   * necesario para que `imageUrl` esté disponible de inmediato en la
   * respuesta 202, igual que WEB deja `screenshotUrl` disponible por
   * iteración sin esperar a la auditoría completa.
   */
  private async run(evaluationId: string, userId: string, testRetryOverride?: RetryOptions): Promise<void> {
    console.log(`[PrototypeEvaluationService] 🖼️ Starting prototype audit for evaluation ${evaluationId}...`);
    try {
      const evaluation = await evaluationRepository.findByIdAndUserId(evaluationId, userId);
      if (!evaluation || !evaluation.imageUrl) {
        throw new Error('Evaluation or imageUrl not found for prototype job');
      }

      const profile = await evaluatorProfileService.findById(userId, evaluation.evaluatorProfileId.toString());

      const imagePath = `${process.cwd()}${evaluation.imageUrl}`;
      const imageBuffer = fs.readFileSync(imagePath);
      const format = this.inferFormatFromUrl(evaluation.imageUrl);

      // 3-5. Construir contexto visual + resolver criterios (dentro de
      // AiService.performPrototypeAuditAnalysis) + construir prompt + invocar
      // AI multimodal. NUNCA una llamada real en esta fase -- este método
      // llama a `generateMultimodalStructuredWithUsage`, que en los tests de
      // esta fase está siempre mockeado (ver gemini-mock-harness.ts).
      let auditResult: Awaited<ReturnType<typeof aiService.performPrototypeAuditAnalysis>>;
      try {
        auditResult = await aiService.performPrototypeAuditAnalysis({
          evaluationId,
          title: evaluation.title,
          description: evaluation.description || '',
          archetype: {
            fullName: profile.fullName,
            archetype: profile.archetype,
            profession: profile.profession,
            phrase: profile.phrase,
            goals: profile.goals || [],
            frustrations: profile.frustrations || [],
            techSavviness: profile.techSavviness,
            accessibilityNeeds: profile.accessibilityNeeds || [],
            preferredDevice: profile.preferredDevice,
            biography: profile.biography,
          },
          imageMimeType: mimeTypeForFormat(format),
          imageBase64: imageBuffer.toString('base64'),
        }, testRetryOverride);
      } catch (prototypeAiError) {
        // P1.7.4-A: persistir el detalle de intentos físicos facturados antes
        // de propagar al catch exterior (que marca FAILED igual que siempre).
        // Sin intentos adjuntos, no se registra nada.
        await aiInteractionService.logFailedInvocationFromError(evaluationId, 'PROTOTYPE', undefined, prototypeAiError);
        throw prototypeAiError;
      }

      // P1.7.4-A: traza de la invocación PROTOTYPE exitosa (el retorno
      // temprano J2-CRITICAL no trae attempts — cero llamadas físicas — y no
      // registra nada). Un fallo de esta escritura nunca hace fallar la
      // evaluación ya exitosa.
      if (auditResult.attempts && auditResult.attempts.length > 0) {
        try {
          await aiInteractionService.logInvocation({
            evaluationId,
            phase: 'PROTOTYPE',
            executionTimeMs: auditResult.executionTimeMs,
            requestTokens: auditResult.usage.promptTokens,
            responseTokens: auditResult.usage.outputTokens,
            invocationOutcome: 'SUCCESS',
            attempts: auditResult.attempts,
          });
        } catch (traceError) {
          // P1.7.4-A (punto 2): nunca silencioso, con el mismo contexto
          // mínimo (evaluationId/phase/resultado) que el camino de fallo;
          // sin reintentar la escritura; no afecta a la evaluación, que ya
          // concluyó con éxito.
          console.error(
            `[PrototypeEvaluationService] ❌ Fallo al persistir AiInteraction (evaluationId=${evaluationId}, phase=PROTOTYPE, invocationOutcome=SUCCESS) — la traza de esta invocación se pierde; la evaluación continúa sin cambios:`,
            traceError,
          );
        }
      }

      const rawFindings = auditResult.result.findings;

      // 7. Validaciones visuales: Gate V0 -> cardinalidad (reutilizada
      // verbatim) -> VisualEvidenceConsistency (análogo J6).
      const gatedFindings = visualEvidenceGateService.processPrototypeFindings(rawFindings);
      const { findings: cardinalityCheckedFindings, summary: cardinalitySummary } =
        applyCardinalityEnforcement(gatedFindings);
      const { findings: validatedFindings, summary: consistencySummary } =
        applyVisualEvidenceConsistency(cardinalityCheckedFindings);

      console.log(
        `[PrototypeEvaluationService] 🛡️ Validated ${validatedFindings.length} findings ` +
        `(cardinality violations=${cardinalitySummary.violations}, ` +
        `consistency: consistent=${consistencySummary.consistent} inconsistent=${consistencySummary.inconsistent} insufficient=${consistencySummary.insufficient})`,
      );

      // 8-9. Consolidación/métricas + persistencia de Finding (FAIL,
      // NOT_EVALUABLE y PASS -- P1.7.2 corrige P1.5.2/Opción B: PASS AHORA
      // SÍ se persiste, mismo cambio aplicado en AuditEngine para WEB, por
      // la misma razón metodológica: sin el Finding individual, un
      // criterio "silencioso" era indistinguible entre "Gemini lo marcó
      // PASS y se descartó" y "nunca se evaluó", violando la regla de no
      // inferir PASS por ausencia de Finding). NOT_EVALUABLE aquí siempre
      // proviene de un hallazgo real emitido por Gemini para un criterio
      // aplicable concreto, nunca se sintetiza uno para un criterio no
      // mencionado.
      const metrics = calculatePrototypeMetrics(validatedFindings);

      for (const f of validatedFindings) {
        await findingService.create(userId, {
          evaluationId: evaluationId as any,
          iteration: 1,
          findingGroup: f.findingGroup,
          type: f.type ?? undefined,
          status: f.status,
          severity: f.severity,
          confidence: f.confidence,
          description: f.description,
          heuristicCode: f.heuristicCode ?? undefined,
          heuristicName: f.heuristicName ?? undefined,
          wcagCriterion: f.wcagCriterion ?? undefined,
          evidence: f.evidence as any,
          affectedElement: f.affectedElement as any,
          impact: f.impact,
          recommendation: f.recommendation,
        } as any);
      }

      // 10. Métricas de consumo (reutiliza metricsTracker tal cual --
      // phase1Calls=0 porque no existe fase de exploración para prototipos).
      const evaluationMetrics = metricsTracker.recordEvaluation({
        evaluationId,
        phase1Calls: 0,
        phase2Calls: 1,
        totalExecutionTimeMs: auditResult.executionTimeMs,
        promptTokens: auditResult.usage.promptTokens,
        outputTokens: auditResult.usage.outputTokens,
        thinkingTokens: auditResult.usage.thinkingTokens || 0,
      });

      // 11. Crear/actualizar Report (incluye `coverage`, K.2.1 §5).
      const existingReport = await reportRepository.findByEvaluationId(evaluationId);
      const notEvaluableFindings = validatedFindings.filter((f) => f.status === 'NOT_EVALUABLE');
      const reportData = {
        evaluationId,
        title: `Reporte de Evaluación de Prototipo: ${evaluation.title}`,
        status: 'ready' as const,
        summary: appendNotEvaluableDisclaimer(auditResult.result.executiveSummary, notEvaluableFindings),
        totalFindings: metrics.totalFindings,
        criticalCount: metrics.criticalCount,
        highCount: metrics.highCount,
        mediumCount: metrics.mediumCount,
        lowCount: metrics.lowCount,
        infoCount: metrics.infoCount,
        passCount: metrics.passCount,
        failCount: metrics.failCount,
        notEvaluableCount: metrics.notEvaluableCount,
        overallScore: metrics.overallScore,
        coverage: metrics.coverage,
        evidenceCount: validatedFindings.reduce((sum, f) => sum + (f.evidence?.length || 0), 0),
        screenshotsCount: 1,
        iterationsEvaluated: 1,
        metrics: evaluationMetrics,
        // P1.7.2 — ver nota equivalente en audit-engine.service.ts.
        findingPersistencePolicy: 'PASS_PERSISTED' as const,
        geminiModel: env.GEMINI_MODEL,
        generatedAt: new Date(),
      };

      if (existingReport) {
        await reportRepository.update(existingReport.id, reportData);
      } else {
        await reportRepository.create(reportData as any);
      }

      await evaluationRepository.update(evaluationId, userId, {
        status: EVALUATION_STATUS.COMPLETED,
        auditStatus: AUDIT_STATUS.COMPLETED,
      });

      console.log(
        `[PrototypeEvaluationService] ✅ Prototype audit completed for ${evaluationId}. ` +
        `Score=${metrics.overallScore} Coverage=${metrics.coverage.evaluatedCriteria}/${metrics.coverage.applicableCriteria} ` +
        `(+${metrics.coverage.outOfCoverageCriteria} fuera de alcance)`,
      );
    } catch (error) {
      console.error(`[PrototypeEvaluationService] ❌ Prototype audit failed for ${evaluationId}:`, error);
      await evaluationRepository.update(evaluationId, userId, {
        status: EVALUATION_STATUS.FAILED,
        auditStatus: AUDIT_STATUS.FAILED,
      });
    }
  }

  private inferFormatFromUrl(imageUrl: string): 'png' | 'jpeg' | 'webp' {
    if (imageUrl.endsWith('.webp')) return 'webp';
    if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) return 'jpeg';
    return 'png';
  }
}

export const prototypeEvaluationService = new PrototypeEvaluationService();
export type { StoredPrototypeImage };
