/**
 * EvalUXIA Backend — Entry Point
 *
 * Bootstrap sequence:
 * 1. Load + validate environment variables (fails fast if invalid)
 * 2. Connect to MongoDB
 * 3. Create Express app
 * 4. Start HTTP server
 * 5. Handle graceful shutdown
 */

// env must be imported first — validates all env vars before anything else loads
import { env } from '@/config/env';
import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { createApp } from './app';
import { APP_NAME, APP_VERSION } from '@/config/constants';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import http from 'http';

async function bootstrap(): Promise<void> {
  console.log(`\n🚀  ${APP_NAME} v${APP_VERSION} — Starting...`);
  console.log(`   Environment : ${env.NODE_ENV}`);
  console.log(`   Port        : ${env.PORT}\n`);

  // ─── Connect to MongoDB ──────────────────────────────────────────────────────
  await connectToDatabase();

  // ─── Reconcile evaluations orphaned by a previous process exit ─────────────────
  // JobRunner (shared/infrastructure/job-runner.ts) is purely in-memory: a
  // restart/crash while an evaluation was 'running' leaves it stuck there
  // forever, with the frontend polling indefinitely. Mark those terminal
  // before accepting new requests (see reconcileStuckRunning doc comment).
  const { evaluations: reconciledEvaluations, audits: reconciledAudits } =
    await evaluationRepository.reconcileStuckRunning();
  if (reconciledEvaluations > 0 || reconciledAudits > 0) {
    console.log(
      `   ⚠️  Reconciled ${reconciledEvaluations} evaluation(s) and ${reconciledAudits} audit(s) ` +
      `stuck in 'running' from a previous process exit -> marked 'failed'\n`,
    );
  }

  // ─── Create Express App ──────────────────────────────────────────────────────
  const app = createApp();

  // ─── Start HTTP Server ───────────────────────────────────────────────────────
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    console.log(`\n✅  Server listening on http://localhost:${env.PORT}`);
    console.log(`   Health check: http://localhost:${env.PORT}/health`);
    console.log(`   API prefix  : http://localhost:${env.PORT}/api/v1\n`);
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n⚠️   ${signal} received. Shutting down gracefully...`);

    server.close(async () => {
      console.log('   HTTP server closed');
      console.log('✅  Shutdown complete\n');
      process.exit(0);
    });

    // Force shutdown after 10s if graceful fails
    setTimeout(() => {
      console.error('❌  Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  console.error('❌  Bootstrap failed:', error);
  process.exit(1);
});
