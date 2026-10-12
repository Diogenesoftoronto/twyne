# Reviewed native AI foundation

This is an **unconnected foundation**, not working provider/model/account/UI support. Live `send_completion`, `stream_completion`, and enabled LiteRT startup return `CapabilityUnavailable`. They never fabricate a successful generation or ready model. Disabled startup returns `None`. Captured-response success always carries `CompletionEvidence::SyntheticFixture` and its coordinator terminal state is `SucceededSynthetic`.

Ownership: this review changes only the seven assigned native-AI files and this new fixture directory. Parent owns `stream_accumulator.rs` and `stream-contract/**`; their implementation and tests are not copied here. Existing Gemini fixture claims outside this directory have not been validated by this review.

## Executed Source checks

Run from repository root:

```sh
rtk proxy bun desktop/gpui/fixtures/native-ai/runtime-review/generate-source-vectors.ts
rtk proxy bun test desktop/gpui/fixtures/native-ai/runtime-review/source-contracts.test.ts
```

Observed: **4 passed, 0 failed, 20 explicit expectations**, plus deep equality of all retained Source output vectors and six current Source hashes. The 48 cases comprise 10 judge replies, 3 fence projections, 4 tagged replies, 10 research replies, 10 routing cases and 11 lifecycle cases. Fixture generation writes only `source-vectors.json` here.

`llm-parsing.ts` and `reasoning-tags.ts` execute directly. TypeScript AST selection runs unchanged declarations from `research-targets.ts`, `ai-client.ts`, `types/index.ts` and `desktop/litert-server.ts`; only the `export` modifier is removed. No SDK/provider module or original lifecycle module initialization executes. Routing receives already-normalized inputs through an explicit identity normalization dependency: managed local/browser provider stripping/injection and complete settings persistence are excluded. Lifecycle dependencies are fake environment, file existence, port allocation/readiness, clock, subprocess and console. They execute original startup ordering/argv/failure handling without reading model files or real environment values, spawning a child or opening a socket. Public network fetch is disabled in the Bun gate.

The lifecycle vectors show an important proof limit: original Source checks a bare TCP listener before checking child exit, so its synthetic `listener-before-exit` case returns ready. Native startup deliberately remains unavailable until an owned-child/model-readiness executor exists. These fixtures do not prove real child cleanup, registry import, device inference or provider behavior.

## Native tests scheduled by Parent

`runtime-tests.rs` contains **12 authored Rust checks**, included by `native_ai/mod.rs` once Parent registers that module. They are not reported as passed until Parent compiles/runs them. They compare native structured projections and normalized routing to the actual Source corpus; exercise captured UTF8/HTTP chunk/SSE byte partitions, event boundaries and terminal/error framing; verify bounds, cancellation and redacted diagnostics; and test bounded request tickets, duplicate IDs, scope revisits/settings changes, terminal-once transitions and callback-unwind cleanup. No Rust test starts a network listener or child or calls environment configuration.

Parent's separate stream differential tests remain the authority for stream/text/reasoning/interview behavior. These tests consume their public accumulator API and do not implement another reasoning parser.

## Exact limits and representation boundaries

- Native policy: request JSON 4 MiB, decoded response 8 MiB, captured wire `2 * 8 MiB + 32 KiB`, HTTP headers 32 KiB/128 fields, SSE line 64 KiB/event 128 KiB/4096 events, four active coordinator requests and 64 terminal tickets. JSON quoting expansion is checked after actual serialization, before any dispatch. Captured decoding is buffered and bounded; it is not an incremental network client.
- HTTP supports a bounded HTTP/1.0/1.1, identity-encoded, content-length/chunked/EOF body subset. Conflicting/duplicate framing, truncated chunks/lengths, invalid UTF8, unexpected media types and malformed typed deltas refuse. Only one chat choice is supported; Responses API, provider-specific SDK schemas, compression and full HTTP transport are pending.
- SSE blank lines dispatch events; multiline `data` joins with LF, BOM/comment/CRLF/lone-CR handling is explicit. An observed, dispatched nonempty `finish_reason` or `[DONE]` is required. A single final newline does not dispatch pending data. EOF pending data, absent terminal, deltas after terminal, or data after DONE fail without a Finish snapshot. Callback cancellation or context invalidation refuses adoption.
- Strict configured endpoint policy: authored `http://127.0.0.1:<nonzero port>/v1`, including explicitly written port 80. No shorthand/hex/decimal IP, DNS, TLS downgrade, credentials, query/fragment or silently ignored path. A valid URL never proves the endpoint belongs to Twyne; no connection is made.
- Source JS offsets in tagged replies are UTF16, not bytes/scalars. Research IDs hash UTF16, dedupe anchor and query independently, sort stably by importance, and apply the explicit native cap after Source normalization. Native refuses a JS slice producing an unpaired surrogate, rather than corrupting it. Native also refuses nonfinite JSON numbers that `serde_json` cannot represent. The Source judge `1e400` fixture yields score 5; native returns parse failure, rather than falsely extracting score 1. This difference is recorded explicitly. Unknown Unicode-version/casing and other unsupported JSON representations have no all-input parity claim.
- Provider DTO serialization excludes `apiKey` and `baseUrl`; Debug of provider/request/message/result/error excludes keys, prompts and raw outputs. This **redacted view DTO is not a lossless settings backup**. A future host must retain original raw settings separately and must not replace them with this serialization. Explicit captured payload construction serializes only its supplied synthetic wire messages; these tests contain no user manuscript or actual key. Diagnostics never echo provider error bodies.

## Adoption boundary

Set a concrete active folio/revision before `begin_request`. The coordinator refuses absent revision, mismatches, duplicate IDs and full queues. Revision revisits, settings changes and stop rotate a private epoch, cancel/drain old work, and invalidate even otherwise-equal folio/generation tickets. A private nonce protects a reused ID after terminal-history eviction. Snapshot callbacks are checked before and after delivery. Terminal transition is accepted once; RAII unregisters on panic/early return.

`can_apply_result(ticket)` is a local freshness check for a synthetic receipt, **not verified authentication or provider success**. Host adoption additionally needs its own entity/visit/scope/revision/selection checks and full canonical candidate CAS. The receipt guard is not a metadata store or one-time document commit. There is no default live adapter, AI UI, account bridge, usage ledger or automatic content generation here.
