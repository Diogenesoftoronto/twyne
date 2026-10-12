# Launch arguments handoff: capture size parsing

## Parent integration update

The parent registered this slice in the library and adopted it in `main.rs`. Review retained the original integer parse-error causes using typed `ParseIntError` payloads, preserving actual CLI error chains. The reviewed standalone fixture passed **20 tests** with warnings denied; the fresh UI-test executable passed **9 prelaunch CLI cases** without a display. See `parent-gates.json`. The broader launch parser was not extracted; worker claims below describe the earlier unregistered19-test draft.

## Status

Done and validated for the `--capture-size` slice only. Parent still owns flag
registration/adoption and the original `anyhow` context chain.

## Files

- `desktop/gpui/src/launch_arguments.rs` (new)
  - `pub enum CaptureSizeError { MissingSeparator, InvalidWidth, InvalidHeight, OutOfBounds }`
    with `Display` (exact strings) and `std::error::Error`.
  - `pub fn parse_capture_size(value: &std::ffi::OsStr) -> Result<(u32, u32), CaptureSizeError>`.
  - Behavior preserved exactly: `to_string_lossy()` OS-string conversion,
    `split_once('x')`, `u32::parse` semantics (including a leading `+`),
    inclusive bounds width `320..=3840`, height `360..=2160`.
  - Displayed errors, exact:
    - missing split: `--capture-size needs WIDTHxHEIGHT`
    - width parse: `Invalid capture width`
    - height parse: `Invalid capture height`
    - bounds: `Capture size must be 320–3840 by 360–2160 pixels.` (en dash)
  - Exposes bound constants `MIN_CAPTURE_WIDTH`, `MAX_CAPTURE_WIDTH`,
    `MIN_CAPTURE_HEIGHT`, `MAX_CAPTURE_HEIGHT`.
  - No other flags implemented.
- `desktop/gpui/fixtures/launch-arguments/capture-size-tests.rs` (new)
  - `include!("../../src/launch_arguments.rs")` then 19 tests covering inclusive
    edges, `+` signs, negative signs, whitespace rejection, uppercase/missing/
    extra separators, overflow, error precedence, exact Display strings,
    `std::error::Error`, and Unix non-UTF8 lossy values.

## Validation

The pinned rustc needs a system `cc`; the default Nix linker failed with a
glibc mismatch, so the compile command sets `PATH=/usr/bin:/bin:$PATH`.

Compile (run from repo root):

```
rtk proxy env PATH=/usr/bin:/bin:$PATH /home/diogenes/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc --edition 2024 --test -D warnings desktop/gpui/fixtures/launch-arguments/capture-size-tests.rs -o /tmp/twyne-gpui-launch-capture-size-tests
```

Result: exit 0, no warnings (compiled clean under `-D warnings`).

Run:

```
rtk proxy env PATH=/usr/bin:$PATH /tmp/twyne-gpui-launch-capture-size-tests
```

Result:

```
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

## Pending main integration

1. Register the module in `main`/`lib` (parent-owned; not done here).
2. Adopt `parse_capture_size` in the `--capture-size` flag handling and attach
   the original `anyhow` context chain (parent-owned; not done here).
3. No edits were made to any existing file, manifest, lock, packaging, or test.
