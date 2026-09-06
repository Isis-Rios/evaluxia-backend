// Triple-slash reference (type-only, emits no runtime require): ts-node's
// single-file execution (unlike `tsc --project`, which uses tsconfig's
// `include` to pick up every ambient .d.ts) only loads the global
// Express.Request.user augmentation if something in this file's compiled
// unit references it — needed here because this is the first test that
// assembles the full app (createApp() pulls in every controller).
/// <reference path="../../types/express.d.ts" />
import http from 'http';
import jwt from 'jsonwebtoken';
import { createApp } from '@/app/app';
import { automationService } from '@/modules/automation/automation.service';
import { aiService } from '@/modules/ai/ai.service';
import { env } from '@/config/env';
import { API_PREFIX } from '@/config/constants';

/**
 * Phase A.1: verifies that /api/v1/automation/* and /api/v1/ai/analyze-ux —
 * found unauthenticated during the Phase A checkpoint — now require a valid
 * JWT, using the SAME `authenticate` middleware already used everywhere else
 * (findings, reports, snapshots, evaluations).
 *
 * Uses the real `createApp()` wiring (identical to production, no test-only
 * app) started on an ephemeral local port, with AutomationService/AiService
 * methods stubbed so even an authenticated request never launches a real
 * Playwright browser or calls the real Gemini API.
 */

// A plain mutable object (rather than separate `let` counters) sidesteps
// TypeScript narrowing a module-level `let` to the literal it was declared
// with across the async gaps between these stub closures (invoked deep
// inside the Express request pipeline) and the assertions below.
const calls: { navigate: number; snapshot: number; screenshot: number; analyzeUx: number } = {
  navigate: 0,
  snapshot: 0,
  screenshot: 0,
  analyzeUx: 0,
};

(automationService as unknown as Record<string, unknown>)['startSession'] = async () => {
  calls.navigate += 1;
  return { success: true, finalUrl: 'https://example.com', loadTimeMs: 1 };
};
(automationService as unknown as Record<string, unknown>)['closeSession'] = async () => {};
(automationService as unknown as Record<string, unknown>)['extractCurrentSnapshot'] = async () => {
  calls.snapshot += 1;
  return {
    url: 'https://example.com',
    title: 'Example',
    domSnapshot: '<html></html>',
    headings: [],
    images: [],
    links: [],
    buttons: [],
    forms: [],
    landmarks: [],
    computedStyles: [],
  };
};
(automationService as unknown as Record<string, unknown>)['captureAndSaveScreenshot'] = async () => {
  calls.screenshot += 1;
  return '/uploads/fake.png';
};
(aiService as unknown as Record<string, unknown>)['analyzeUx'] = async () => {
  calls.analyzeUx += 1;
  return { overallScore: 80, summary: 'stub', findings: [], nextActions: [] };
};

function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const app = createApp();
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function makeValidToken(): string {
  return jwt.sign(
    { userId: 'test-user-id', email: 'test@example.com', role: 'user' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' },
  );
}

async function expectStatus(
  url: string,
  init: RequestInit,
  expectedStatus: number,
  label: string,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== expectedStatus) {
    const body = await res.text().catch(() => '<unreadable body>');
    console.error(`❌ ${label} — expected HTTP ${expectedStatus}, got ${res.status}. Body: ${body}`);
    process.exit(1);
  }
  console.log(`✅ ${label} (HTTP ${res.status})`);
  return res;
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting Phase A.1 route-authentication tests...');
  const { server, baseUrl } = await startServer();
  const token = makeValidToken();
  const jsonHeaders = { 'Content-Type': 'application/json' };

  try {
    // ── Unauthenticated requests are rejected, and the real service is
    //    NEVER reached — this is the specific Gemini-cost concern raised
    //    for /ai/analyze-ux. ──
    await expectStatus(
      `${baseUrl}${API_PREFIX}/ai/analyze-ux`,
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) },
      401,
      'POST /ai/analyze-ux without a token is rejected',
    );
    if (Number(calls.analyzeUx) !== 0) {
      console.error('❌ aiService.analyzeUx was called despite missing authentication');
      process.exit(1);
    }
    console.log('✅ aiService.analyzeUx was NOT invoked for the unauthenticated request (no Gemini call could occur)');

    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/navigate`,
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url: 'https://example.com' }) },
      401,
      'POST /automation/navigate without a token is rejected',
    );
    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/snapshot`,
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url: 'https://example.com' }) },
      401,
      'POST /automation/snapshot without a token is rejected',
    );
    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/screenshot`,
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url: 'https://example.com' }) },
      401,
      'POST /automation/screenshot without a token is rejected',
    );
    if (Number(calls.navigate) !== 0 || Number(calls.snapshot) !== 0 || Number(calls.screenshot) !== 0) {
      console.error('❌ An AutomationService method was invoked despite missing authentication — no real browser session should have started');
      process.exit(1);
    }
    console.log('✅ No AutomationService method was invoked for any unauthenticated automation request');

    // A garbage/invalid token must be rejected too — not just a missing header.
    await expectStatus(
      `${baseUrl}${API_PREFIX}/ai/analyze-ux`,
      { method: 'POST', headers: { ...jsonHeaders, Authorization: 'Bearer not-a-real-token' }, body: JSON.stringify({}) },
      401,
      'POST /ai/analyze-ux with an invalid/garbage token is rejected',
    );

    // ── Authenticated requests still reach the (stubbed) handler/service. ──
    const validUxBody = {
      url: 'https://example.com',
      pageTitle: 'Example',
      domSnapshot: '<html></html>',
      evaluatorProfile: {
        fullName: 'Test User',
        phrase: 'Just testing',
        age: 30,
        profession: 'QA',
        archetype: 'Tester',
        techSavviness: 'medium',
        accessibilityNeeds: [],
        goals: [],
        frustrations: [],
      },
    };
    await expectStatus(
      `${baseUrl}${API_PREFIX}/ai/analyze-ux`,
      {
        method: 'POST',
        headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
        body: JSON.stringify(validUxBody),
      },
      200,
      'POST /ai/analyze-ux with a valid token reaches the handler',
    );
    if (Number(calls.analyzeUx) !== 1) {
      console.error(`❌ Expected aiService.analyzeUx to be called exactly once for the authenticated request, got ${calls.analyzeUx}`);
      process.exit(1);
    }
    console.log('✅ aiService.analyzeUx WAS invoked exactly once for the authenticated request (stubbed — no real Gemini call made)');

    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/navigate`,
      {
        method: 'POST',
        headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: 'https://example.com' }),
      },
      200,
      'POST /automation/navigate with a valid token reaches the handler',
    );
    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/snapshot`,
      {
        method: 'POST',
        headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: 'https://example.com' }),
      },
      200,
      'POST /automation/snapshot with a valid token reaches the handler',
    );
    await expectStatus(
      `${baseUrl}${API_PREFIX}/automation/screenshot`,
      {
        method: 'POST',
        headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: 'https://example.com' }),
      },
      200,
      'POST /automation/screenshot with a valid token reaches the handler',
    );
    // automationService.startSession() ("navigate" counter) is called by all
    // three handlers (navigate/snapshot/screenshot each open their own
    // transient session first) — so it's expected to be 3 here, while
    // extractCurrentSnapshot/captureAndSaveScreenshot are each specific to
    // their own endpoint.
    if (Number(calls.navigate) !== 3 || Number(calls.snapshot) !== 1 || Number(calls.screenshot) !== 1) {
      console.error(
        `❌ Unexpected AutomationService call counts for authenticated requests: navigate=${calls.navigate} (expected 3), snapshot=${calls.snapshot} (expected 1), screenshot=${calls.screenshot} (expected 1)`,
      );
      process.exit(1);
    }
    console.log('✅ All three authenticated automation requests correctly reached AutomationService (startSession called once per request; snapshot/screenshot extraction called by their own endpoint only)');
  } finally {
    server.close();
  }

  console.log('🎉 All Phase A.1 route-authentication tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running route-authentication tests:', err);
  process.exit(1);
});
