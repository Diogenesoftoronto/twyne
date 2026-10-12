# Native collaboration foundation fixtures

This is an unintegrated offline foundation, not completion of the collaboration/publishing row. It contains pure request/response projections, role-policy previews, private-label filtering, typed ProseMirror wire positions and an adapter that always refuses connected operations. No request, invitation, email, publication, account verification or native remote cursor is produced.

## Executable original-source observations

`source-functions.ts` imports `account-display.ts`, `standard-site-paths.ts` and `micropub.ts` directly. For private helpers, it parses the current TypeScript AST and executes the **unchanged original declarations** for `pickColor`, `slugify`, `sanitizeHtml`, `safeEndpoint`, `requireIdentity`, `getCollaborator`, `requireRole`, `hasAuthenticatedConvexIdentity` and `buildDecorations`. It does not import registered Convex handlers, inspect credentials or execute provider code. Selected source files are SHA256-recorded in `source-reference.json`.

The actual `publishViaMicropub` is called only with an injected fixture fetcher. One regeneration test replaces the real global fetch with a throwing sentinel. The inert fixture authorization header is checked but excluded from retained JSON. The cursor fixture executes the original decoration builder with a real ProseMirror Schema/document and decorations, including emoji, combining marks, atoms, hard breaks and block boundaries. It demonstrates why PM tree/UTF16 positions cannot be interpreted as native plain scalar offsets.

```sh
rtk proxy bun desktop/gpui/fixtures/native-collaboration/generate-source-fixtures.ts
rtk proxy bun test ./desktop/gpui/fixtures/native-collaboration/source-backed-test.ts
```

The repaired Bun suite passed **8/8, 42 assertions** on Bun 1.4.2. These are executable original-source observations, not browser/native-renderer or authenticated-network proof. The prior draft's authored-only expected-vector checks and standalone Rust claims have been superseded.

`native-collaboration-tests.rs` is included by the owned module under `cfg(test)`. Its nine tests compare native functions to retained actual-source outputs, exercise unconditionally enabled serde/camelCase DTOs, malformed projections, unknown receipt fields, PM-specific bounds and all nine offline dispatch refusals. **The repairing worker did not run Cargo, Devenv or rustc.** Root must register the module and run the crate tests/strict checks before accepting the native implementation.

## Boundaries

- `WriterMetadata::new` validates labels only. IDs, roles and `is_pro` are caller-supplied metadata, never credentials, verified subscription or accepted membership. Source server authority comes from `ctx.auth.getUserIdentity()` and exact `lixId`/`tokenIdentifier` membership queries; the fixture context is synthetic.
- `PresenceUser` retains a raw received name for the DTO. Only the `RemoteCursor` projection sanitizes it for public display. Private email metadata is separate and redacted from `WriterMetadata` Debug; that private DTO is not a public presence payload. Other projections must use the account display helpers as well.
- Known DTOs are typed projections, not lossless backup envelopes. Unknown/malformed role or position shapes fail deserialization; optional `null` and missing fields may both project to `None`. Retain original response JSON separately if future transport/persistence needs full fidelity. Convex receipt `extra` retains unknown fields, but it does not establish receipt acceptance.
- Wire positions are `ProseMirrorPosition(f64)` with `ProseMirrorContentSize(usize)` supplied from the **actual Source schema**. Nonfinite/negative caret projections are omitted; Source candidate caret max is root content end+1, selection max is root content end. Native editor conversion, transaction remapping and overlay drawing remain unimplemented.
- `sanitize_html` implements only the original Convex/SSR best-effort string replacements. It preserves their malformed-tag quirks; it is not the browser DOM sanitizer or a complete untrusted-HTML safety guarantee. Unicode normalization/case/URL edge parity is bounded by the recorded adversarial corpus and pinned libraries, not all runtimes.
- Convex requests retain authored title/content/author/summary and requested kind. Title UTF16 slicing, sanitization, admin/owner gating, slug collision lookup and timestamps remain server-owned; the foundation does not approximate them or issue an accepted receipt.
- Micropub endpoint parsing uses exact parsed localhost/127.0.0.1 host checks and form encoding. Source currently permits HTTPS credentials in URLs and HTTP credentials at a parsed loopback host; the foundation mirrors that policy rather than claiming extra SSRF protection. No token is stored by this offline adapter, but an argument signature cannot prove the lifecycle of a future caller's credentials.
- `SharedSession::observe_remote_snapshot` only deduplicates retained strings. It does not merge Lix changes, apply to the editor, reconcile canonical Typst, mark remote provenance, protect pending drafts or manage ACK/CAS/lifecycle races.
