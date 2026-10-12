# Parent integration update

The library export is now integrated. Parent Cargo checked all16 native-AI checks (12 reviewed runtime checks plus4 stream checks): **16 pass** with locked offline/no-default-feature execution. The initial numeric fixture mismatch was repaired with exact typed `f64` comparison; production routing was unchanged. See [integration-gates.json](integration-gates.json) for byte hashes and the log. Strict aggregate Clippy, mounted UI and actual providers remain pending. The integration patch below is historical and should not be reapplied.

# Frozen reviewed AI handoff

Apply `integration.patch` only when Parent wants to compile the foundation. `regex = 1.13.1`, `url = 2.5.8`, UUID, serde and serde_json are already direct cached dependencies; no dependency/lock edit is required by this slice. No default-feature GPUI dependency is introduced.

Public seams:

- Existing `GenerationStreamAccumulator::{push,snapshot}` and `GenerationStreamSnapshot::completed` remain Parent-owned/unchanged by this review.
- `LoopbackClient::build_payload(&CompletionRequest) -> Result<String,AiError>` validates actual JSON size. Live send/stream always return `CapabilityUnavailable`. `decode_captured_response(&request,&[&[u8]],callback)` is explicitly synthetic and returns `CompletionResult{evidence:SyntheticFixture,...}` only after valid terminal/framing.
- `NativeAiCoordinator::set_active_revision`, `begin_request`, `accepts_snapshot`, `finish_request`, `terminal_state`, `can_apply_result`, `cancel_request`, `cancel_all_for_folio` and settings/stop invalidation provide bounded local freshness. `execute_captured_request` returns `GuardedCompletion{ticket,result}`; live execute returns unavailable. Request tickets cannot be reconstructed from caller fields.
- `LiteRtConfig::default` is disabled and does not read environment/files. Explicit `from_env` remains a host configuration-only operation, uncalled by this review/tests. `launch_plan(port)` exposes Source-shaped CLI argv plus native bounds. `LiteRtProcessManager::start` cannot become Ready. `LiteRtServerHandle::from_owned_child` derives PID from a supplied actual `Child` and owns kill/wait; it does not verify model/readiness/descendants. No review test constructs it.
- Typed provider/feature enums preserve unknown strings. DTO projection/routing are not full raw-settings retention. See README for managed normalization, persona voice-provider Source quirk, numeric/surrogate refusal and exact Source proof boundaries.

Gate performed: owned Bun Source corpus **4/4 pass**, no network/provider/model/child/socket; seven owned runtime files and owned Rust test are rustfmt-clean with `skip_children=true`. Authored Rust **12 checks not run by this worker**, per Parent's exclusive Cargo/Devenv ownership. Parent must run the isolated native-AI tests and strict compile before counting native Rust proof. Stream checks are separate Parent-owned evidence.

No existing Source/backend, app/lib/manifest/lock, editor or other worker file was edited. No provider output, real key or user manuscript was read/written. No claim that the AI rows of the full GPUI port are fulfilled: remote transports/SDKs, verified account/session authority, actual LiteRT lifecycle/model/device readiness, connected cancellation and native host/UI adoption remain unimplemented.
