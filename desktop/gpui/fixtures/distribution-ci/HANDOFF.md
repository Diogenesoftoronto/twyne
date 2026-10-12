# Reviewed distribution CI proposal

## Parent workflow integration update

The parent applied the reviewed workflow patch and reran the retained checks: **40 passed, 0 failed, 162 expectations**. The shared workflow exactly matches `workflow.after.yml`; see `parent-gates.json`. The single pre-RTK bootstrap uses the already installed Bun runtime; subsequent commands use `rtk proxy`. Actual hosted CI, real archive extraction/execution and cross-platform runtime remain pending. The frozen worker proposal below is retained as history.

Status: **frozen, UNAPPLIED**. Ownership and changes are confined to this
directory. The repository workflow, package scripts, runtime, manifests and
lockfiles were not changed. This replaces the earlier CI proposal and its
8-check receipt; the two older workflow patches under `../distribution/` are
superseded, not edited. Parent already applied the three packaging scripts.

## Proposed workflow

[workflow.patch](workflow.patch) changes only
`.github/workflows/gpui-desktop.yml`. It keeps the current three-OS matrix and
`contents: read` permission. Checkout and the existing `setup-bun` action run
first; [bootstrap-rtk.ts](bootstrap-rtk.ts) then provisions the pinned RTK
archive. Every subsequent shell command has its own `rtk proxy` prefix,
including the previously unprefixed Bun, apt and Cargo commands. No extra
setup action or token is required.

The bootstrap is the one explicit command-prefix exception: RTK is not yet on
PATH. It invokes Bun and system tar directly, with argument arrays and no
shell-script download. It does not execute the downloaded binary. Subsequent
CI commands would exercise RTK after GitHub adds the fresh bin directory to
PATH. This is a proposed bootstrap exception for Parent review, not an
instruction to execute it during this review.

After the release build, the workflow makes the existing distribution test
mandatory with `TWYNE_DISTRIBUTION_REQUIRE_REAL: "1"`, then stages and verifies
the same `${{ steps.rtk.outputs.stage_path }}`. That path is an **absent child
of a newly created `mkdtemp` directory**, not a fixed runner-temp destination.
This matches `packaging/files.ts:188` and the real `stage.ts` CLI. The upload
retains the original documents/notices, adds both math-helper suffixes, and
includes the verified staged tree. No platform bundle or installer assembly
is added.

## Pinned bootstrap contract

[rtk-release.json](rtk-release.json) embeds the exact archive names, byte sizes
and SHA-256 values for Linux X64/ARM64, macOS X64/ARM64, and Windows X64 from
the [official v0.36.0 release](https://github.com/rtk-ai/rtk/releases/tag/v0.36.0)
and its [public release metadata](https://api.github.com/repos/rtk-ai/rtk/releases/tags/v0.36.0).
The published [checksums file](https://github.com/rtk-ai/rtk/releases/download/v0.36.0/checksums.txt)
is retained byte-for-byte as [rtk-checksums.txt](rtk-checksums.txt): 838 bytes,
SHA-256 `2206d1e92ce695ad8a210ffd629822cce457afffee908a4c09c33aabab435348`.
All five selected names occur exactly once and match their embedded digest.
Only public metadata and these checksum bytes were fetched during review;
no release archive or executable was downloaded.

The future bootstrap verifies the selected archive's **exact size and exact
embedded SHA-256**, before extraction. It uses `node:crypto` through Bun, so
it does not assume `sha256sum` on macOS or use `--ignore-missing`. Bun documents
its [Node API compatibility](https://bun.sh/docs/runtime/nodejs-compat), and
the [Node crypto API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)
defines the hash operation.

The [pinned upstream packaging workflow](https://github.com/rtk-ai/rtk/blob/v0.36.0/.github/workflows/release.yml#L82-L94)
creates a single root `rtk` or `rtk.exe` entry. The adapter rejects any other
inventory, including extra, duplicate, nested or traversing entries. It
extracts that exact entry, accepts one nonempty regular/nonlinked file under
32 MiB, copies exclusively into the fresh bin, and sets executable mode.
It neither searches for the first matching file nor overwrites a prior bin.
Runner and GitHub command-file paths must be absolute, free of control
characters, and of the expected file type. Publication appends to the actual
GitHub command files without erasing their existing contents.

The future Windows path uses `SystemRoot/System32/tar.exe`; Microsoft's
[tar documentation](https://learn.microsoft.com/en-us/windows/tar/)
describes built-in list/extract and ZIP support. GitHub documents
[runner variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
and [PATH/output command files](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands).
These are source contracts, not Windows or macOS execution evidence.

## Retained checks

[workflow.before.yml](workflow.before.yml) records the exact current workflow;
[workflow.after.yml](workflow.after.yml) is the proposed target. Tests accept
either exact shared state, so applying the proposal does not break the
retained fixture. Unrelated workflow drift fails explicitly. Patch application
and reversal occur only inside a freshly copied scratch tree, which is then
removed. The shared workflow stays byte-identical.

[workflow-policy.ts](workflow-policy.ts) parses YAML and validates the reviewed
command subset, ordering, permissions, actual schema-2 executable IDs,
mandatory release gate, and stage/upload bindings. Negative specimens cover
permission changes, missing/conditional steps, bootstrap ordering/identity,
unprefixed commands or hidden shell chains, skipped real-file checks, fixed
or mismatched destinations, missing helper/tree uploads, and ignored failures.
It is a bounded policy, not a general Bash or GitHub Actions interpreter.

[bootstrap-rtk.test.ts](bootstrap-rtk.test.ts) exercises exact checksum selection,
byte tampering, streamed oversize/truncation, invalid budgets, ambiguous
archive inventories, preserved colliding data, distinct fresh workspaces,
exclusive copies, file types/links/size/mode and command-file publication.
All executable-like copy specimens are inert bytes and are never run. The
file-symlink specimen is explicitly POSIX-only; Windows directory-junction
specimens and mode handling are authored but have not run on Windows.

Commands actually run on this Linux host:

```bash
rtk proxy bun test desktop/gpui/fixtures/distribution-ci
rtk proxy bunx --no-install tsc --noEmit --strict --target ESNext --module ESNext --moduleResolution Bundler --resolveJsonModule --esModuleInterop --skipLibCheck --types bun --lib ESNext,DOM desktop/gpui/fixtures/distribution-ci/*.ts
rtk proxy git apply --check desktop/gpui/fixtures/distribution-ci/workflow.patch
```

Results: **40 pass, 0 fail, 162 assertions**; scoped strict TypeScript and
patch check pass. Formatting was checked only within this owned directory.
[review-gates.json](review-gates.json) records the scope and fixture hashes.

## Remaining proof

Parent integration and a real three-OS CI run remain pending. No archive
listing/extraction of a real RTK release, downloaded executable execution,
macOS/Windows runner, Cargo/Devenv run, install, signing, clean-host launch or
account/provider operation was performed. The proposal retains the existing
CI build/test commands; local synthetic checks do not establish that those
commands will pass on any runner. Existing flat staging remains
`bundleStatus: not-assembled`, and the math helper remains diagnostic-only.
