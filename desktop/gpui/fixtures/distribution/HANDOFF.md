# Parent verification update

Parent built the actual document and math helper executables, then re-ran the mandatory real-input check: **1 pass,7 assertions** for all three actual Linux ELF files. A fresh47-file tree with3 executables was staged and integrity-verified; see [parent-gates.json](parent-gates.json). The document helper passed22 checks/258 assertions;6 compiled-math cases confirmed current CSS refusal versus explicitly diagnostic glyph vectors. The earlier missing-math-helper checkpoint below is historical. The staged app release predates the latest unmounted foundation exports; installation, portability, current-source release and target-platform runtime remain unproven.

Only the three package stage/verify/test scripts were applied. CI patches remain unapplied because the current workflow does not provision RTK.

# Packaging handoff: corrected integrity staging

Status: ready for parent review; integration patches remain unapplied. Ownership
was limited to `desktop/gpui/packaging/**` and `fixtures/distribution/**`. No Cargo,
Devenv, shared workflow/manifest edits, package installation, accounts, staged
binary execution, signing or OS installation was performed.

## Concrete corrections

- [files.ts](../../packaging/files.ts) validates portable relative paths, checks
  each child with `lstat`, refuses symlinks/special-file leaves, opens no-follow
  where supported, compares opened identities and detects changing/truncated
  inputs. Reads are limited to 1 GiB per file (8 MiB for manifests), paths to
  32 components/1024 UTF-8 bytes, inventories to 10,000 files. Aliases above an
  explicitly declared root, such as macOS `/tmp`, may be canonicalized; no
  symlink below that root is followed. This does not provide an openat sandbox
  against a hostile concurrent filesystem writer.
- [stage.ts](../../packaging/stage.ts) refuses an existing destination and
  preflights all helpers, notices, mappings and versions before exclusive `mkdir`.
  There is no `rm` or replacement operation. An I/O failure leaves the new partial
  tree for inspection. It preserves recorded POSIX modes, requires executable
  permissions on POSIX targets, rejects scripts/wrong platform headers, and
  detects case aliases and file/directory target collisions before writing.
- Schema **2** records the exact contract hash, logical source provenance, modes,
  `layout: flat-executables-and-metadata` and `bundleStatus: not-assembled`.
  Verification checks helper **ID + exact path/name + required flag**, validates
  every manifest path before reading, reconstructs required license inventories
  from the source contract, compares original notice/metadata/icon bytes, checks
  actual file presence, and recomputes loader fields. Removed/rehash-replaced
  licenses, duplicate inventories, symlinks and unlisted directories are errors.
- macOS has no apparent `.app` output. Plist and original PNG are under
  `scaffolds/macos/`; versions, minimum OS and ICNS assembly are explicit pending
  work. `CFBundleURLTypes` was removed because native callback handling is absent.
  Windows has uncompiled `.rc.in`/`.manifest.in` scaffolds and original ICO under
  `scaffolds/windows/`, with release/build placeholders. Global native IDs, source
  fonts, artwork and helper wiring were not changed.
- [portability.ts](../../packaging/portability.ts) verifies the tree before its
  CLI reads a bounded manifest and writes a fresh report **outside** the tree.
  OS-supplied macOS libraries are not mislabeled as Nix-store paths; loader
  analysis remains distinct from runtime/host availability. The receipt generator
  now uses host suffix/format, fails required missing inputs and refuses output
  replacement instead of silently recording failures or following symlinks.

## Public entry points

```ts
stage({ platform, releaseDir, outDir, productVersion?, nativeCrateVersion?,
        contractPath?, sourceRoot? }): Promise<DistributionManifest>;
verify(outDir, { manifest?, contractPath?, sourceRoot? }?): Promise<VerifyResult>;
loadContract(path?): Promise<Contract>;
```

`contractPath`/`sourceRoot` allow bounded owned negative fixtures; defaults use the
current repository. `manifest` remains a test/reviewer override, while the actual
manifest file must still be a safe regular file. Verification depends on this
repository's current declared metadata/notices; it is not a standalone signed
release validator. Executable hashes bind the staged bytes to the manifest, not
to an independently trusted build receipt.

## Checks actually run

```bash
rtk proxy bun test desktop/gpui/fixtures/distribution/stage.test.ts
rtk proxy bun node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --target es2022 --module esnext --moduleResolution bundler --types bun \
  --lib es2022,dom desktop/gpui/packaging/{files,stage,binary-deps,portability}.ts \
  desktop/gpui/fixtures/distribution/{binary-fixtures,generate-reference,stage.test}.ts
rtk proxy git apply --check desktop/gpui/fixtures/distribution/ci-stage-verify.patch \
  desktop/gpui/fixtures/distribution/artifact-upload.patch \
  desktop/gpui/fixtures/distribution/package-scripts.patch
```

Current result: **65 pass, 1 explicit real-release skip, 0 fail; 238 assertions**
on Linux using cached Bun 1.4.2. TypeScript strict check and combined unapplied
patch check passed. All three formats and their original platform metadata were
staged/verified with owned non-runnable binary fixtures on this host; no macOS
or Windows runtime was exercised.

The targeted mandatory-real check was also exercised with
`TWYNE_DISTRIBUTION_REQUIRE_REAL=1`: it **failed as intended** (exit 1, `ENOENT`
for `target/release/twyne-math-write`). The other existing release binaries were
read only; no replacement/dummy helper was introduced. Consequently a complete
real release distribution is **not verified** here.

## Unapplied parent integration

- [ci-stage-verify.patch](ci-stage-verify.patch): after release build, test all
  required actual host binaries (`REQUIRE_REAL=1`) and stage/verify a fresh runner
  temp tree. New commands use `rtk proxy` and Bash consistently across the matrix.
  **RTK is not provisioned by the current workflow**; the parent must provide a
  reviewed three-OS RTK setup before applying this proposal. This patch was only
  apply-checked locally, not run in CI.
- [artifact-upload.patch](artifact-upload.patch): include both math-helper suffixes
  and the staged tree with all its declared notices. This depends on the CI staging
  patch. Artifact download/permission preservation is not verified.
- [package-scripts.patch](package-scripts.patch): separate stage/verify scripts so
  `--out` can be supplied consistently without an ambiguous command chain. A
  repeated default stage refuses the existing directory; choose a fresh `--out`.

No dependency or runtime export is required. The contract still honestly records
the math-write helper as required but not currently constructed by the main app;
its runtime integration is separate parent work.

## Remaining delivery boundaries

No runnable macOS app bundle, Windows installer/resources, clean-host Linux
package, relocation/minimum-libc validation, OS association/open-file round trip,
native deep-link transport, code signature, updater or platform launch is claimed.
The dependency reader covers ordinary ELF/Mach-O/PE loader tables, not every
possible loader variant/delay-import/minimum-version rule. Declared licenses are
mandatory; complete legal review of the transitive binary dependency closure is
not performed by an inventory checker. Historical old-worker reference JSONs are
retained but not used as current evidence, and the earlier dummy-helper “real
stage” claim is superseded by the explicit missing-release boundary above.
