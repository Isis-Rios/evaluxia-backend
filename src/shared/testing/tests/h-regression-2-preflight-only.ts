import { automationService } from '@/modules/automation/automation.service';
import { deterministicAnalyzer } from '@/modules/evaluations/services/deterministic-analyzer.service';
import { buildDeduplicatedEvidenceContext, EvidenceInput } from '@/modules/evaluations/services/evidence-deduplication.service';
import { prioritizeComputedStyles, collectOtherEvidenceSelectors, collectIndependentFindingSelectors } from '@/modules/evaluations/services/evidence-prioritization.service';
import { aiService } from '@/modules/ai/ai.service';
import { measurePayload, shouldBlockBeforeSending } from '@/shared/testing/payload-budgets';
import { loadFixture } from '@/shared/testing/fixture-loader';

/**
 * Throwaway, Gemini-free verification that H-REGRESSION-2's preflight
 * (fixture load, evidence pipeline, prompt construction, J2 budget
 * measurement) is correctly defined BEFORE any real call is authorized.
 * Stops before aiService.performAuditAnalysis — no Gemini call happens.
 */
async function main() {
  const fixture = loadFixture('forms/login-missing-label.html');
  const evalId = 'h-regression-2-preflight-check';
  await automationService.attachTestSession(evalId, fixture.html);
  const snapshot = await automationService.extractCurrentSnapshot(evalId);
  await automationService.closeSession(evalId);

  const evidences: EvidenceInput[] = [{
    iteration: 1, url: 'https://fixture.local/forms/login-missing-label.html', screenshotPath: '/x.png',
    headings: snapshot.headings, images: snapshot.images, links: snapshot.links, buttons: snapshot.buttons,
    forms: snapshot.forms, landmarks: snapshot.landmarks, computedStyles: snapshot.computedStyles,
    computedStylesCandidates: snapshot.computedStylesCandidates,
  }];

  const deterministicFindings = deterministicAnalyzer.analyzeSnapshots(evidences as any);
  const { evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles: allDeduped } = buildDeduplicatedEvidenceContext(evidences);
  const otherEvidenceSelectors = collectOtherEvidenceSelectors({ dedupedLandmarks, dedupedLinks, dedupedButtons, evidencesSummary });
  const independentFindingSelectors = collectIndependentFindingSelectors(deterministicFindings as any);
  const prioritization = prioritizeComputedStyles(allDeduped, { otherEvidenceSelectors, independentFindingSelectors });
  const dedupedComputedStyles = prioritization.final;

  const promptInput: any = {
    evaluationId: evalId, title: 'H-REGRESSION-2-preflight-check', url: 'https://fixture.local/forms/login-missing-label.html',
    archetype: { fullName: 'Ana Torres', archetype: 'Explorer', profession: 'QA', phrase: 'Quiero iniciar sesión rápido', goals: ['Acceder a su cuenta'], frustrations: ['Formularios confusos'] },
    completedSteps: [], previousActions: [], snapshotsCount: 1,
    evidencesSummary, dedupedLandmarks, dedupedLinks, dedupedButtons, dedupedComputedStyles, accessibilityTrees: [],
  };
  const prompt: string = (aiService as any).buildV2AuditPrompt(promptInput);
  const measurement = measurePayload(2, prompt);
  const wouldBlock = shouldBlockBeforeSending(measurement);

  console.log('fixture: forms/login-missing-label.html — loaded OK');
  console.log(`payload chars: ${measurement.chars}`);
  console.log(`estimated input tokens: ${measurement.estimatedTokens}`);
  console.log(`budget level: ${measurement.level}`);
  console.log(`J2 bloquearía: ${wouldBlock}`);
  console.log(`prompt contiene regla de cardinalidad (rule 4): ${prompt.includes('EXACTLY ONE WCAG code')}`);
  console.log(`prompt contiene instrucción de split por criterio: ${prompt.includes('emit ONE SEPARATE finding per criterion')}`);
  console.log(`prompt contiene ejemplo reforzado de wcagCriterion: ${prompt.includes('never combine multiple codes here')}`);
  console.log('NO se llamó a Gemini en este script (se detiene aquí).');
  process.exit(0);
}
main().catch((e) => { console.error('crashed:', e); process.exit(1); });
