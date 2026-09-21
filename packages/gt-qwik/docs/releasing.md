# Local packaging and possible future release

The package is private and used through Twyne's Bun workspace. Publication is deferred. The unscoped npm name `gt-qwik` is already a General Translation placeholder at version 0.0.0, as checked September 21, 2026. Installing that registry package does not install this adapter.

## Verify a local artifact

From the package directory:

```sh
bun run check
bun run test
npm pack --ignore-scripts --dry-run
npm pack --ignore-scripts
```

`test` builds the package before testing source and built exports. The tarball allowlist includes `dist`, README, license, changelog and docs. Inspect it for unexpected files. It must contain the files named by every export, including `index.qwik.mjs`, `qwik.qwik.mjs`, `runtime.js` and declarations. Build-generated supporting files and source maps are included by the `dist` allowlist; maps can contain source text. Tests, node_modules and credentials must not be included.

Install the tarball into a temporary project outside this repository with the supported Qwik peer version. Check runtime imports and TypeScript declarations. For Qwik integration, build a consumer with its optimizer and test SSR plus browser interaction; importing a package or rendering a string alone does not prove resume works. The host app generates its own Qwik manifest.

Twyne's verification record is in `docs/gt-qwik-verification.md` at the repository root. It records package tests, the independent runtime/type consumer, and the production browser smoke test separately.

## Before any future registry release

Choose a name the publisher controls or coordinate with General Translation. Update the package name and consumer imports if needed. Only then remove `private: true`, settle the version, update the changelog and repeat the artifact checks. Do not assume access to the reserved unscoped name.

Supported dependencies are currently exact pins. An upgrade must rerun the GT extractor/hash tests and the Qwik consumer build/resume tests. A breaking change during the 0.x series requires an explicit versioning decision and a migration note; compatible fixes can be patches.

Publication is a separate step after these checks and valid registry authentication. No publication or deployment occurred during this integration.
