import fs from 'fs';
import path from 'path';
import { GroundTruth } from './ground-truth-oracle';

/**
 * Fase 2.3 — fixture loading infrastructure (testing-only module).
 *
 * Convention: `/fixtures/<relativePath>.html` always has a sibling
 * `/fixtures/<relativePath>.groundtruth.json` describing its expected
 * Ground Truth (see ground-truth-oracle.ts). This loader is the ONLY place
 * that should know that convention — tests never hardcode the sibling-file
 * naming themselves.
 *
 * Fixtures live at the repo root (`/fixtures`), not under `src/`, mirroring
 * the existing convention already used for `/uploads` (see
 * automation.service.ts, `path.join(process.cwd(), 'uploads')`).
 */

const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures');

export interface LoadedFixture {
  /** Relative path used to load it, e.g. "forms/login-good.html". */
  name: string;
  html: string;
  groundTruth: GroundTruth;
}

export function loadFixture(relativeHtmlPath: string): LoadedFixture {
  const htmlPath = path.join(FIXTURES_ROOT, relativeHtmlPath);
  if (!htmlPath.startsWith(FIXTURES_ROOT)) {
    throw new Error(`Fixture path escapes the fixtures root: ${relativeHtmlPath}`);
  }

  const groundTruthPath = htmlPath.replace(/\.html$/, '.groundtruth.json');

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Fixture HTML not found: ${htmlPath}`);
  }
  if (!fs.existsSync(groundTruthPath)) {
    throw new Error(`Fixture is missing its sibling Ground Truth file: ${groundTruthPath}`);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const groundTruth: GroundTruth = JSON.parse(fs.readFileSync(groundTruthPath, 'utf8'));

  if (!groundTruth.fixture || !Array.isArray(groundTruth.criteria)) {
    throw new Error(`Malformed Ground Truth for ${relativeHtmlPath}: missing "fixture" or "criteria"`);
  }

  return { name: relativeHtmlPath, html, groundTruth };
}

/** Lists every `.html` fixture under a given subdirectory (non-recursive), for suites that iterate a whole category. */
export function listFixtures(relativeDir: string): string[] {
  const dirPath = path.join(FIXTURES_ROOT, relativeDir);
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(relativeDir, f));
}
