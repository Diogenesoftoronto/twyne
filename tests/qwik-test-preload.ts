/**
 * Qwik 2's published runtime expects Vite to replace this feature table at
 * build time. Bun's test runner imports source modules directly, so install
 * the non-experimental defaults before any test can import Qwik. Keep these in
 * sync if `qwikVite({ experimental: [...] })` is enabled later.
 */
(
  globalThis as typeof globalThis & {
    __EXPERIMENTAL__?: Record<string, boolean>;
  }
).__EXPERIMENTAL__ ??= {
  each: false,
  errorBoundary: false,
  show: false,
  suspense: false,
};
