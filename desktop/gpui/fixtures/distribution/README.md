# Distribution integrity fixtures

The tools under [packaging](../../packaging) create a **flat tree of executables,
declared notices, icons and metadata**. They do not assemble an OS application
bundle, install file associations, register deep links, sign, update or run an
executable. macOS and Windows metadata is stored under `scaffolds/`, with explicit
version/build placeholders. The unimplemented `twyne` URL scheme is not registered.

`stage` requires a fresh destination with an existing real parent. It rejects
every existing destination, including empty directories and dangling symlinks,
and reads all required inputs before exclusive directory creation. It never
deletes or replaces an existing tree. An unexpected write failure leaves only
the newly created partial tree for inspection; use a new destination for retry.

`verify` validates the schema-2 manifest, required helper identities, canonical
portable relative paths, file types, hashes, sizes, POSIX modes and loader metadata.
Required notices, metadata and icons are checked against the current repository
contract and original source bytes, so removing a license from both the tree and
manifest cannot hide it. It rejects unlisted files/directories and symlinks. This
is repository-backed integrity verification, not a signed authenticity receipt or
a general adversarial-filesystem sandbox: inputs and output parents must not be
concurrently controlled by another writer.

```bash
# --out must not exist; choose a new path on every staging attempt.
rtk proxy bun desktop/gpui/packaging/stage.ts stage \
  --out desktop/gpui/target/distribution-review-1
rtk proxy bun desktop/gpui/packaging/stage.ts verify \
  --out desktop/gpui/target/distribution-review-1

# Keep analysis outside the verified tree; the report path must also be fresh.
rtk proxy bun desktop/gpui/packaging/portability.ts \
  --manifest desktop/gpui/target/distribution-review-1/distribution-manifest.json \
  --out desktop/gpui/target/distribution-review-1-portability.json

rtk proxy bun test desktop/gpui/fixtures/distribution/stage.test.ts

# For release CI: no skipping a missing helper. This only inspects headers.
rtk proxy env TWYNE_DISTRIBUTION_REQUIRE_REAL=1 bun test \
  desktop/gpui/fixtures/distribution/stage.test.ts

# Inspect an existing host release into a fresh receipt, without execution.
rtk proxy bun desktop/gpui/fixtures/distribution/generate-reference.ts \
  --out desktop/gpui/fixtures/distribution/release-inspection-new.json
```

The deterministic suite uses **non-runnable loader-table fixtures** for ELF,
Mach-O and PE, including x86-64 and ARM64, on any host. POSIX mode/symlink cases
are explicitly skipped on Windows. The separate actual-release check expects the
host format and architecture; absent release binaries are an explicit local skip
unless `TWYNE_DISTRIBUTION_REQUIRE_REAL=1`. A passing synthetic/header test cannot
establish executable, runtime, clean-install or cross-OS support.

See [HANDOFF.md](HANDOFF.md) for current results and unapplied integration patches.
`source-reference.json` and `portability-reference.json` are retained **historical
receipts from the earlier worker**, generated before these safety corrections.
They are not inputs to this suite and are not current release/distribution proof.
The earlier “real staged” claim included a dummy math helper and did not establish
a complete real distribution.
