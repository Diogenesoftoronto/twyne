# GT Qwik integration verification

Verified locally on September 21, 2026. The adapter remains a private local workspace package; nothing was published or deployed.

## Authorship and review

The coordinator scaffolded the manifest, TypeScript contracts and runtime acceptance tests. Crush implemented the adapter and additional tests/documentation. Coordinator review corrected own-property dictionary lookups and Qwik library packaging, then integrated the app.

Jev (`jev-1.13.0`) reviewed the brief and initial acceptance suite. It selected Qwik resume/reactive switching as the highest-priority integration-test gap (choice probability 0.99). This was a prioritization judgment, not evidence of correctness. The subsequent production browser test supplies that evidence.

Jev also reviewed the first documentation draft and flagged registry installation as pointing at the wrong package. Coordinator revisions replaced those commands with workspace/tarball setup, supplied runnable examples, separated generic JSON translation from GT dictionary extraction, and removed unsupported claims about manifests and artifact contents.

## Checks

- Package: `bun run --cwd packages/gt-qwik check` and `bun run --cwd packages/gt-qwik test` pass. The latter builds first and runs 22 tests, including the coordinator's 13 acceptance cases, GT's actual dictionary extractor and concurrent Qwik SSR. Five redundant wrapper/hash tests from the initial handoff were removed; compatibility is checked against the real extractor instead.
- App language policy: `bun test src/i18n/locale.test.ts` passes six cases.
- App typecheck, client build and server build pass. Existing CSS highlight, Node-module compatibility and large-chunk warnings remain in build output.
- Focused ESLint checks pass for the new provider, language policy, Settings control, root and SSR entry.
- `bun run i18n:check` finds the English source JSON and performs no translation request.
- The final tarball was installed into `/tmp/gt-qwik-consumer-final`, outside the repository. Runtime imports, the public hash export, English fallback and a consumer TypeScript check pass. Its 21-file payload includes documentation and license, with no test directory, source directory or credentials.
- `I18N_TEST_URL=http://127.0.0.1:5188 bun scripts/check-i18n-browser.ts` passes against Vite's production preview. It checks French SSR output, regional browser detection, reactive Settings switching, persisted English SSR override, return to Automatic, reload and an independent English browser context.

## Integration defects found and resolved

The first library build used plain `.js` files. Development interaction worked, but production SSR could not map the provider's QRL symbol. The corrected package uses Qwik's `--mode lib`, `.qwik.mjs` output and `qwik` package field. Its provider symbol is now present in the consumer manifest, and production preview completes without the prior Q14 error.

Adding a workspace initially selected Bun's isolated linker, exposing imports that Twyne previously resolved through hoisting. `bunfig.toml` preserves the existing hoisted layout. Parent builds prepare i18n before launching child builds, avoiding concurrent package-output deletion.

French coverage currently comprises nine UI messages in the Settings/language slice. It does not mean the rest of the application is translated. The initial French catalog was authored locally; a paid GT translation workflow and production deployment were not exercised.

## Additional languages and model response policy — September 21, 2026

Added Spanish (`es`), Simplified Chinese (`zh`), Hindi (`hi`) and Japanese (`ja`) alongside English/French. Each target catalog covers the same nine Settings messages (45 translated messages across five target languages); this is not complete app localization.

- 35 focused tests pass: locale detection/persistence, prompt policy, storage-disabled in-memory preference, and mocked provider calls/retries in all six languages. Run `bun test --preload ./packages/gt-qwik/tests/preload.ts src/i18n/locale.test.ts src/i18n/model-language.test.ts src/utils/ai-client-reasoning.test.ts`.
- Production-preview browser checks pass for all six languages: regional detection, SSR text, live Settings changes, reload persistence, Automatic restoration, and isolated contexts.
- App and Convex TypeScript checks pass. Focused lint covers changed application/backend files. Standalone scripts are outside the root ESLint project; compiler/browser execution verifies those scripts instead.
- Jev reviewed protocol preservation and documentation scope; its judgments are advisory and do not prove provider behavior.

Hosted actions validate an optional per-request language; room fan-out, synthesis, judgments, rewrites and interviews propagate it. Backend validators must be deployed before the frontend sends the new field. No backend deployment or live provider-language evaluation was performed. Static fallback/error text remains part of the untranslated backlog.
