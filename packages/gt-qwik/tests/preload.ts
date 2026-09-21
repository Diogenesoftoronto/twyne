/**
 * Preload for the `gt-qwik` test runner. Two jobs:
 *
 *   1. Install Qwik 2's `__EXPERIMENTAL__` feature flags before any test
 *      imports `@qwik.dev/core`. Bun's test runner imports source modules
 *      directly, so Vite never gets the chance to inject these.
 *   2. Supply the library manifest for this isolated string-render test.
 *      This does not verify client resume. A real consumer generates its
 *      own manifest; Twyne's production browser smoke covers that path.
 */
import { readFileSync } from "node:fs";

const g = globalThis as typeof globalThis & {
  __EXPERIMENTAL__?: Record<string, boolean>;
  __QWIK_MANIFEST__?: unknown;
};

g.__EXPERIMENTAL__ ??= {
  each: false,
  errorBoundary: false,
  show: false,
  suspense: false,
};

const manifestPath = new URL("../dist/q-manifest.json", import.meta.url);
try {
  g.__QWIK_MANIFEST__ = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch {
  // dist/ has not been built yet — leave undefined so tests that don't
  // render Qwik trees still pass. The SSR test will report a clear error.
}
