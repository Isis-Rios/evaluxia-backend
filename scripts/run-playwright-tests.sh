#!/usr/bin/env bash
# P1.5.4 — Runs the backend test files that launch a real Playwright
# browser via `ts-node --transpile-only` (same compiler as `npm run dev`,
# i.e. `ts-node-dev`) instead of `npx tsx`.
#
# Why this script exists (see P1.5.3's diagnosis): `tsx` transforms every
# file with esbuild's `keepNames: true` hardcoded, which wraps named
# const/arrow functions in a call to an internal `__name(...)` helper that
# only exists inside esbuild's own bundle scope. `automation.service.ts`'s
# `extractCurrentSnapshot` ships a function's source (via `.toString()`) into
# a real Playwright browser page to reconstruct it there — a separate JS
# realm where that helper was never defined, causing
# `ReferenceError: __name is not defined`. `ts-node` uses the TypeScript
# compiler directly and never introduces this helper, so the exact same
# source runs unmodified.
#
# This script changes ONLY how these files are invoked. It does not change,
# mock, skip, or reduce any assertion in any of them.
#
# Usage:
#   npm run test:playwright
#   bash scripts/run-playwright-tests.sh

set -uo pipefail

FILES=(
  "src/modules/automation/tests/attach-test-session.test.ts"
  "src/modules/automation/tests/extract-snapshot-svg-classname.test.ts"
  "src/modules/automation/tests/get-css-selector.test.ts"
  "src/shared/testing/tests/d1-automation-signal-isolation.test.ts"
  "src/shared/testing/tests/d2-selector-traceability.test.ts"
  "src/shared/testing/tests/d3-selector-cost-in-context.test.ts"
  "src/shared/testing/tests/e1-modal-trigger.test.ts"
  "src/shared/testing/tests/e2-accordion.test.ts"
  "src/shared/testing/tests/e3-tabs-inactive-content.test.ts"
  "src/shared/testing/tests/e4-dropdown-hover-reveal.test.ts"
  "src/shared/testing/tests/f2-oversized-field.test.ts"
  "src/shared/testing/tests/f3-computed-styles-cap.test.ts"
  "src/shared/testing/tests/f4-deep-selector-scaling.test.ts"
  "src/shared/testing/tests/f7-selector-cost-times-growth.test.ts"
  "src/shared/testing/tests/fase-b-p0-fixtures.test.ts"
  "src/shared/testing/tests/fixture-infrastructure.test.ts"
  "src/shared/testing/tests/h0-harness-self-check.test.ts"
  "src/shared/testing/tests/j4-3-final-validation.test.ts"
  "src/shared/testing/tests/j4-step2-prioritization.test.ts"
  "src/shared/testing/tests/t4-large-text.test.ts"
  "src/shared/testing/tests/t5-many-computed-styles.test.ts"
  "src/shared/testing/tests/t7-selector-cost.test.ts"
)

failed=0
total=${#FILES[@]}
i=0

for f in "${FILES[@]}"; do
  i=$((i + 1))
  echo ""
  echo "=== [$i/$total] $f ==="
  if npx ts-node -r tsconfig-paths/register --transpile-only "$f"; then
    echo "--- PASS: $f ---"
  else
    echo "--- FAIL: $f ---"
    failed=$((failed + 1))
  fi
done

echo ""
echo "========================================"
echo "Playwright test files: $((total - failed))/$total passed"
echo "========================================"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
exit 0
