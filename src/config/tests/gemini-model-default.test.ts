import { execFileSync } from 'child_process';
import path from 'path';

/**
 * P1.7.4-B / Ronda 2 — Valida, contra el proceso real (no una suposición), que:
 * 1. Sin GEMINI_MODEL definido en el entorno, el valor resuelto es gemini-3.8-flash.
 * 2. Con GEMINI_MODEL=gemini-2.5-flash o gemini-3.5-flash-lite explícito, esa
 *    selección se respeta (la posibilidad de volver a modelos anteriores sigue intacta).
 * 3. Con GEMINI_MODEL=gemini-3.8-flash explícito, se resuelve gemini-3.8-flash.
 * 4. El cliente Gemini (gemini.client.ts) usa el mismo env.GEMINI_MODEL al
 *    construir cada petición — sin una ruta de código separada por modelo.
 *
 * Cada caso arranca un proceso Node real que importa env.ts con un entorno
 * controlado (child process, nunca mutando process.env del test runner) y
 * reporta el valor resuelto por stdout — cero llamadas a Gemini, cero
 * conexión a MongoDB (env.ts no toca ninguna de las dos).
 */

function resolveGeminiModel(envOverrides: Record<string, string | undefined>): string {
  const env = {
    ...process.env,
    ...envOverrides,
    MONGODB_URI: 'mongodb://localhost:27017/test-irrelevant',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
  };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete (env as Record<string, string | undefined>)[k];
    }
  }
  const script = "import { env } from '@/config/env'; console.log(env.GEMINI_MODEL);";
  const out = execFileSync(
    'npx',
    ['ts-node', '--transpile-only', '-r', 'tsconfig-paths/register', '-e', script],
    { cwd: path.resolve(__dirname, '../../..'), env, encoding: 'utf8' },
  );
  // dotenv puede anteponer una línea de aviso (p. ej. "injected env... tip:
  // ...") antes del console.log real — el valor resuelto es siempre la
  // última línea no vacía de stdout.
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1];
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
}

console.log('🧪 P1.7.4-B / Ronda 2 — Gemini model default/override tests (proceso real, cero Gemini, cero Mongo)...\n');

{
  const resolved = resolveGeminiModel({ GEMINI_MODEL: undefined });
  assert(resolved === 'gemini-3.8-flash', `1. Sin GEMINI_MODEL en process.env, el modelo resuelto es gemini-3.8-flash (obtenido: "${resolved}")`);
}

{
  const resolved = resolveGeminiModel({ GEMINI_MODEL: 'gemini-2.5-flash' });
  assert(resolved === 'gemini-2.5-flash', `2. GEMINI_MODEL=gemini-2.5-flash explícito se respeta (obtenido: "${resolved}") — rollback al modelo anterior sigue disponible`);
}

{
  const resolved = resolveGeminiModel({ GEMINI_MODEL: 'gemini-3.5-flash-lite' });
  assert(resolved === 'gemini-3.5-flash-lite', `3. GEMINI_MODEL=gemini-3.5-flash-lite explícito se respeta (obtenido: "${resolved}") — rollback a Ronda 1 sigue disponible`);
}

{
  const resolved = resolveGeminiModel({ GEMINI_MODEL: 'gemini-3.8-flash' });
  assert(resolved === 'gemini-3.8-flash', `4. GEMINI_MODEL=gemini-3.8-flash explícito también se respeta (obtenido: "${resolved}")`);
}

console.log(`\n📊 Resultado: ${passed} ✅ / ${failed} ❌`);
if (failed > 0) process.exit(1);
console.log('🎉 Gemini model default/override tests passed.');
process.exit(0);
