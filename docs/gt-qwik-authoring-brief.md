# Crush authoring brief: gt-qwik

Read `docs/gt-qwik-plan.md` first. Implement the package, not just another proposal. The user explicitly authorizes Crush to use its configured MiniMax service and send this plan and relevant source context for this work. Do not read environment files, credentials, customer data or unrelated source. Own only `packages/gt-qwik/**`; the coordinator owns all app integration and root manifests. Other changes in the worktree are protected.

The coordinator has now scaffolded the manifest, TS configs, source types and `tests/acceptance.test.ts`. Continue that scaffold. The acceptance tests are coordinator-owned: do not change them. Implement `createGTState(config, initialLocale?)`, `translate(state, id, variables?)` and `setLocale(state, locale)` as exported runtime functions. They currently fail because runtime.ts does not exist. Preserve those assertions; flag disagreements in your handoff. GT's actual metadata format is `[message, { $context, $maxChars }]`, not an invented object wrapper. The scaffold's tuple types reflect inspection of the installed CLI.

## Evidence to inspect before coding

- `node_modules/gt-i18n/package.json`, `dist/internal.d.mts`, `dist/internal-string.d.mts`, `dist/types.d.mts` and the implementation of helpers you actually use. Installed version: 1.0.28. Do not assume public `t()` works without framework initialization.
- `node_modules/gt/dist/react/parse/createDictionaryUpdates.js`, `react/utils/flattenDictionary.js`, `react/utils/getEntryAndMetadata.js`, and CLI config parsing. Installed CLI: 2.21.3. Extracted dictionary messages use ICU and a canonical content hash; metadata affects that hash. Verify with the real extractor, not a duplicate mock.
- `node_modules/@qwik.dev/core/public.d.ts`, `optimizer.d.ts`, `server.d.ts`, and package exports. Installed Qwik: 2.0.0-beta.42. Twyne uses `@qwik.dev/core`, not React.
- `src/utils/convex-context.tsx` for the existing Qwik context pattern; `src/root.tsx`, `vite.config.ts`, `tsconfig.json`, and `tests/qwik-test-preload.ts` for consumer constraints. Read only.
- Upstream references if needed: https://github.com/generaltranslation/gt ; https://generaltranslation.com/docs ; https://qwik.dev/docs/advanced/library/ ; https://qwik.dev/docs/advanced/dollar/ . Distinguish current Qwik 2 types from Qwik 1 documentation.

## Design guidance

Prefer small modules: `types.ts`, a GT compatibility bridge, pure catalog/translation functions, Qwik context/provider/hooks, public exports. Separate framework-free helpers into a runtime subpath if useful. No Twyne imports, root-relative dependencies, API keys, network translation or React dependencies.

Use explicit serializable provider config: source locale, supported locales, initial locale, source dictionary and available catalogs. All active locale state is per provider, never a global singleton. Avoid GT global initializer/cache mutation where possible: canonical hash and interpolation helpers can operate directly on passed catalogs. Pin any dependency whose internal API is used and document why.

Offer an ergonomic synchronous render API without making ordinary functions serializable state. A safe baseline is `useGT()` returning serializable context plus a module-level `translate(context, id, variables)` function; a Qwik-safe convenience hook is welcome if proven in an optimized consumer. Locale setters used from event handlers must be QRLs or mutate context through documented module-level helpers. Do not wrap all render-time translation in async QRLs. Provide a provider error that explains missing setup.

Dictionary lookup must support documented GT-compatible nested strings and metadata entries, or explicitly validate a narrower supported format. Hash the source with exactly the metadata used by the CLI. Catalog format must match real downloaded GT artifacts. Preserve ICU interpolation, plurals and locale-aware formatting. Missing locale or translation falls back to the source message. Define behavior for invalid IDs and invalid ICU rather than silently swallowing every error. Do not interpret translated strings as raw HTML.

Allow regional matching and expose resolved locale/direction as data. Twyne owns detection, cookies/localStorage and Settings UI. Its choices are Automatic/English/Français; French browser preferences select French, otherwise English; an explicit setting overrides detection. The library must not render a selector or manipulate global document state automatically.

Build Qwik-aware distributable output with valid exports and declarations. A plain TS transpilation of `component$` may leave optimizer work undone: verify consumer behavior and follow the installed optimizer's library mode. Qwik must remain a peer external. Do not claim Qwik 1 compatibility. Use an honest initial version and unscoped `gt-qwik` name; no publication by the worker.

## Required verification

1. Unit behavior: fallback, variables, ICU plurals, metadata hashing, unsupported locale handling, nested dictionary paths, and two independent contexts with different locales.
2. GT CLI/extractor fixture comparison proving canonical key compatibility. No paid/API translation is needed for this.
3. Qwik SSR smoke using real optimized output: two independent renders must keep locales separate and emit translated content without serialization errors.
4. Package build and declaration check; document exact commands. Ensure package development dependencies are declared even if existing root installations are reused to run tools.
5. Pack dry run; ensure all exported files exist, source is included only if intentional, and no tests/secrets/Twyne files leak into the tarball.
6. Report unresolved runtime/browser tests candidly; do not call a unit-only implementation production-ready.

## Required documents

- `README.md`: unofficial status; exact supported versions; install; minimal provider and translation example; switching locale in a Qwik handler; SSR initial-locale example; source dictionary/catalog workflow; commands; API overview and limitations.
- `docs/architecture.md`: serialization and request-isolation rationale, GT bridge contract, catalog/hash schema, dependency/version policy, and why no global locale is used.
- `docs/translation-workflow.md`: working `gt.config.json`, source dictionary fixture, CLI dry run, actual translate/download steps and environment-variable names only; distinguish catalogs generated by GT from manually authored fixtures.
- `docs/releasing.md`: clean build, checks, tarball inspection, fresh consumer test, registry name/ownership checks, semver/changelog and publication commands. Publication is coordinator-owned.
- `CHANGELOG.md`, `LICENSE`, and a minimal example/fixture that matches the documented public API.

Do not invent organization ownership, registry availability, successful browser tests or publication. Finish with a concise handoff listing API exports, files, passing commands, failures and remaining integration steps. Use `rtk` for shell commands (`rtk proxy` for unfiltered tools). Do not commit, push, deploy or publish.
