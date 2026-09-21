/**
 * Library build for `gt-qwik`. The published package ships ESM with type
 * declarations only; the runtime functions are framework-free so they work
 * in any environment, while the Qwik provider is wrapped by `qwikVite` so
 * that `component$` is properly extracted for consumers.
 *
 * Output layout:
 *   dist/index.qwik.mjs   — public package entry (re-exports everything)
 *   dist/runtime.js       — framework-free helpers
 *   dist/qwik.qwik.mjs    — Qwik provider, hook and QRLs
 *   dist/*.d.ts           — declarations emitted by tsc
 */
import { defineConfig } from "vite";
import { qwikVite } from "@qwik.dev/core/optimizer";

export default defineConfig({
  // The build script passes --mode lib, which selects Qwik's library mode.
  plugins: [qwikVite()],
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
    minify: false,
    rollupOptions: {
      // External dependencies must NOT be bundled into the library output.
      // `gt-i18n` and `@generaltranslation/format` are runtime deps;
      // `@qwik.dev/core` is the peer dependency that the consumer owns.
      external: [/^gt-i18n(?:\/|$)/, /^@generaltranslation\/format(?:\/|$)/, /^@qwik\.dev\/core(?:\/|$)/],
      output: {
        // Preserve ES module entry points as separate files. Without
        // `entryFileNames` Rollup would inline every entry into a single
        // `index.js` and lose the `./runtime` subpath contract.
        entryFileNames: (chunk) => chunk.name === "runtime" ? "runtime.js" : "[name].qwik.mjs",
        chunkFileNames: "_chunks/[name]-[hash].qwik.mjs",
        assetFileNames: "_assets/[name][extname]",
        format: "esm",
      },
    },
    lib: {
      entry: {
        index: "src/index.ts",
        runtime: "src/runtime.ts",
        qwik: "src/qwik.tsx",
      },
      formats: ["es"],
    },
  },
});
