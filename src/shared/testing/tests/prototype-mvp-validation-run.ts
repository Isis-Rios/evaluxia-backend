import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { Evaluation } from '@/modules/evaluations/evaluation.model';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { prototypeEvaluationService } from '@/modules/evaluations/services/prototype-evaluation.service';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { findingRepository } from '@/modules/findings/finding.repository';
import { reportRepository } from '@/modules/reports/report.repository';
import { detectImageFormat } from '@/modules/evaluations/services/prototype-image-upload.service';

/**
 * [Validación MVP] Runner REAL de la Prueba A (preparado en esta fase, NO
 * ejecutado). A diferencia de `prototype-p7-real-gemini-run*.ts` (que llaman
 * directamente a `aiService.performPrototypeAuditAnalysis`, sin persistencia
 * ni cola de trabajos), este runner pasa por el servicio real COMPLETO:
 * `prototypeEvaluationService.create()` -> job encolado -> `run()` -> Gate
 * V0 -> cardinalidad -> Consistency -> métricas -> persistencia real de
 * Finding/Report -> recuperación desde MongoDB -- exactamente el camino que
 * seguiría un usuario real, nunca un script aislado que simule partes del
 * flujo.
 *
 * SIN NINGUNA LLAMADA REAL mientras `PROTOTYPE_MVP_VALIDATION_AUTHORIZED`
 * no sea exactamente 'yes' -- el preflight completo (incluida la conexión a
 * MongoDB) corre siempre; la llamada a Gemini solo se alcanza después del
 * gate de autorización.
 *
 * Variables de entorno requeridas:
 *   MONGODB_URI                              (ya en .env)
 *   GEMINI_API_KEY, GEMINI_MODEL              (ya en .env)
 *   MVP_VALIDATION_USER_ID                    ObjectId de un User real existente
 *   MVP_VALIDATION_EVALUATOR_PROFILE_ID        (opcional) ObjectId de un
 *                                              EvaluatorProfile de ese
 *                                              usuario; si se omite, se usa
 *                                              el primero que devuelva
 *                                              evaluatorProfileService.findAll
 *   PROTOTYPE_MVP_VALIDATION_AUTHORIZED=yes   autorización explícita, única
 *                                              y distinta de las de P7.1/P7.3
 *
 * No borra evaluaciones existentes bajo ninguna circunstancia. Si ya existe
 * una evaluación de esta prueba (identificada por MVP_VALIDATION_TITLE), el
 * script la reporta y se detiene SIN crear una nueva ni tocar la existente.
 */

const MVP_VALIDATION_TITLE = '[MVP-VALIDATION] Formulario de contacto (p7-contact-form)';
const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures', 'prototypes');
const IMAGE_PATH = path.join(FIXTURES_ROOT, 'p7-contact-form.png');
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚨 VALIDACIÓN MVP — Prototipo, servicio real completo (create()->run()), n=1\n');

  // ── 1. Preflight (siempre corre, sin llamar a Gemini) ──────────────────
  console.log('========================================');
  console.log('1. PREFLIGHT');
  console.log('========================================');

  const imageExists = fs.existsSync(IMAGE_PATH);
  const imageBuffer = imageExists ? fs.readFileSync(IMAGE_PATH) : null;
  const format = imageBuffer ? detectImageFormat(imageBuffer) : null;
  console.log(`[${imageExists ? 'x' : ' '}] Fixture presente: ${IMAGE_PATH}`);
  console.log(`[${format ? 'x' : ' '}] Formato real (firma binaria): ${format ?? 'N/A'}`);

  const userId = process.env.MVP_VALIDATION_USER_ID;
  console.log(`[${userId ? 'x' : ' '}] MVP_VALIDATION_USER_ID presente: ${userId ? 'sí' : 'NO -- requerido'}`);

  let mongoConnected = false;
  try {
    await connectToDatabase();
    mongoConnected = true;
  } catch (err: any) {
    console.log(`[ ] MongoDB inalcanzable: ${err?.message || err}`);
  }
  console.log(`[${mongoConnected ? 'x' : ' '}] MongoDB conectado (MONGODB_URI real)`);

  const authorized = process.env.PROTOTYPE_MVP_VALIDATION_AUTHORIZED === 'yes';
  console.log(`[${authorized ? 'x' : ' '}] Autorización explícita (PROTOTYPE_MVP_VALIDATION_AUTHORIZED=yes)`);

  if (!imageExists || !format || !userId || !mongoConnected) {
    console.error('\n⛔ BLOCKED: preflight incompleto. No se toca MongoDB más allá de la conexión ni se llama a Gemini.');
    if (mongoConnected) await mongoose.disconnect();
    process.exit(1);
  }

  // ── 2. Evitar duplicados: buscar una ejecución previa de esta prueba ────
  const existing = await Evaluation.findOne({ userId, title: MVP_VALIDATION_TITLE }).lean();
  if (existing) {
    console.log('\n========================================');
    console.log('YA EXISTE UNA EJECUCIÓN PREVIA DE ESTA PRUEBA -- NO SE CREA OTRA');
    console.log('========================================');
    console.log(`evaluationId: ${existing._id}  status: ${existing.status}  auditStatus: ${existing.auditStatus}`);
    console.log('Si quieres repetir la prueba, decide explícitamente si conservar o borrar ese registro antes de reejecutar este script (este script nunca borra nada).');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── 3. Resolver EvaluatorProfile ─────────────────────────────────────────
  let evaluatorProfileId = process.env.MVP_VALIDATION_EVALUATOR_PROFILE_ID;
  if (!evaluatorProfileId) {
    const { data: profiles } = await evaluatorProfileService.findAll(userId, { page: 1, limit: 1 } as any);
    if (profiles.length === 0) {
      console.error('\n⛔ BLOCKED: el usuario no tiene ningún EvaluatorProfile y MVP_VALIDATION_EVALUATOR_PROFILE_ID no fue provisto.');
      await mongoose.disconnect();
      process.exit(1);
    }
    evaluatorProfileId = profiles[0].id;
    console.log(`\nEvaluatorProfile resuelto automáticamente: ${evaluatorProfileId}`);
  }

  if (!authorized) {
    console.log('\n========================================');
    console.log('DETENIDO ANTES DE GEMINI (preparación, no ejecución)');
    console.log('========================================');
    console.log('Preflight OK pero no autorizado. Se requiere PROTOTYPE_MVP_VALIDATION_AUTHORIZED=yes.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // =======================================================================
  // EJECUCIÓN REAL — NUNCA alcanzada sin autorización. Pasa por el servicio
  // real completo; testRetryOverride:{maxRetries:0} limita esta ejecución
  // puntual a 1 intento físico sin tocar AI_RETRY_CONFIG global.
  // =======================================================================
  console.log('\n========================================');
  console.log('EJECUTANDO LA ÚNICA LLAMADA REAL AUTORIZADA A GEMINI (vía servicio real)...');
  console.log('========================================\n');

  const startedAt = Date.now();
  const created = await prototypeEvaluationService.create(
    userId,
    {
      evaluatorProfileId,
      title: MVP_VALIDATION_TITLE,
      description: 'Pantalla de contacto de un sitio web. Incluye un formulario para enviar un mensaje de soporte y, debajo, una opción para suscribirse al boletín de novedades por correo.',
    } as any,
    { buffer: imageBuffer!, size: imageBuffer!.length, originalname: 'p7-contact-form.png' },
    { maxRetries: 0 },
  );

  console.log(`Evaluation creada: ${created.id} (status=${created.status} auditStatus=${created.auditStatus}) -- esperando a que el job encolado termine...`);

  // ── Polling hasta estado terminal (mismo patrón que el frontend real) ──
  let finalEvaluation = created;
  while (
    finalEvaluation.auditStatus !== 'completed' &&
    finalEvaluation.auditStatus !== 'failed' &&
    Date.now() - startedAt < POLL_TIMEOUT_MS
  ) {
    await sleep(POLL_INTERVAL_MS);
    finalEvaluation = (await evaluationRepository.findByIdAndUserId(created.id, userId))!;
  }
  const wallClockMs = Date.now() - startedAt;

  if (finalEvaluation.auditStatus !== 'completed' && finalEvaluation.auditStatus !== 'failed') {
    console.error(`\n⚠️  TIMEOUT tras ${wallClockMs}ms esperando un estado terminal (auditStatus=${finalEvaluation.auditStatus}). No se reintenta automáticamente -- revisa el estado manualmente en MongoDB.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\nEstado final tras ${wallClockMs}ms: status=${finalEvaluation.status} auditStatus=${finalEvaluation.auditStatus}`);

  if (finalEvaluation.auditStatus === 'failed') {
    console.error('\n========================================');
    console.error('RESULTADO: FAILED -- diagnosticar en los logs de consola de arriba');
    console.error('(buscar "[PrototypeEvaluationService] ❌" y "[GeminiClient]") antes de decidir si reintentar manualmente.');
    console.error('========================================');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── Recuperación real desde MongoDB (confirma persistencia) ────────────
  const [report, findings] = await Promise.all([
    reportRepository.findByEvaluationId(created.id),
    findingRepository.findByEvaluationId(created.id),
  ]);

  console.log('\n========================================');
  console.log('INFORME RECUPERADO DESDE MONGODB');
  console.log('========================================');
  console.log(`report encontrado: ${!!report}`);
  if (report) {
    console.log(`overallScore=${report.overallScore} coverage=${JSON.stringify(report.coverage)}`);
    console.log(`tokens: ${JSON.stringify(report.metrics)}`); // nunca incluye la API key
  }
  console.log(`findings persistidos (solo FAIL): ${findings.length}`);
  findings.forEach((f, i) => console.log(`  #${i} [${f.severity}] ${f.wcagCriterion || f.heuristicCode || 'criterio general'}: ${f.description.slice(0, 100)}...`));

  console.log('\n(Este registro se conserva como evidencia de la validación -- no se borra automáticamente. Identifícalo por su título si necesitas limpiarlo manualmente más adelante.)');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ crashed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
