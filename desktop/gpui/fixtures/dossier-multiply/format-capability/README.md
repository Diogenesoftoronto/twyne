# Destination-multiply format admission proposal

Status: frozen, **unapplied, uncompiled and unexecuted**. This lane inspected the
current vendored source and authored a small capability patch plus tests. It did
not execute GPUI, WGPU, Cargo, Devenv, a browser, a provider or a native probe.
Root owns application and verification. Source CSS, prepared paper groups,
ordinary image painting, shader bytes and scene painter order are untouched.

## Defect and proposed boundary

The current Linux/FreeBSD `Window::paint_multiply_image` can allocate an atlas
tile and record an overlay before the WGPU encoder refuses its target/atlas
formats. That refusal aborts the frame containing ordinary content too.
The existing encoder test uses an atlas-format boolean captured from the
construction context, although atlas storage is updated in place on recovery.

`integration.patch` adds these APIs:

```rust
// PlatformWindow: default false for every implementation not opting in.
fn supports_destination_multiply(&self) -> bool { false }

// Window: forwards to its active platform window. Never cache across recovery.
pub fn supports_destination_multiply(&self) -> bool;

// WgpuRenderer: actual configured-state/format/pipeline query.
pub fn supports_destination_multiply(&self) -> bool;

// WgpuAtlas: mutex-protected current polychrome/subpixel storage format.
pub(crate) fn color_texture_format(&self) -> wgpu::TextureFormat;
```

Only X11 and Wayland platform windows opt in. Their implementations delegate to
the renderer rather than infer support from an OS name. Metal, other platforms,
headless and test windows retain default false. A WGPU renderer reports true
only when it is `Ready`, its device is not marked lost, the configured surface
format equals the core's target format, both that target and the **live atlas**
format are exactly `Bgra8Unorm` or `Rgba8Unorm`, and its multiply pipeline exists.
This replaces the captured context boolean. The encoder retains a defensive
refusal for unsupported scenes that bypass admission or become stale.

For a nonempty, nonzero-opacity overlay, `paint_multiply_image` now refuses
before atlas requests, uploads or scene/layer recording. Existing finite
opacity validation and zero-opacity/empty no-ops remain first. A caller must
handle refusal and leave the unavailable overlay absent; propagating an error
to a frame-aborting caller or panicking would defeat the intended boundary.
Existing opaque-backdrop, ancestor-opacity, prepared-image, device-grid, mask
and paint-last requirements still apply after capability admission.

## Actual source trace

All three vendored packages are `0.3.7`. Core provenance in
`vendor/gpui-pre/TWYNE_VENDORED.json` records registry checksum
`0e87a42bb37c7cb4e76dd1ac0ce88851e46e976e0373a47ab3e0757abffee54d`
and Zed revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`.
`pins.json` records exact input/proposed source hashes.

| Existing file | Inspected behavior, before this proposal |
| --- | --- |
| `gpui-pre/src/platform.rs` | `PlatformWindow` is the backend boundary; `sprite_atlas` exposes the actual atlas. No multiply capability exists. |
| `gpui-pre/src/window.rs:4977` | Admission checks caller constraints, then `get_or_insert_with` and `paint_layer`; no backend-format check before those mutations. |
| `gpui-pre-wgpu/src/wgpu_renderer.rs:384` | Surface format selection prefers the two byte formats, then another non-sRGB format, then the first reported format. Unsupported/HDR/sRGB fallback is possible. Core pipelines use the selected configured format. |
| `gpui-pre-wgpu/src/wgpu_atlas.rs:102` | Recovery changes `backend.color_texture_format` and clears textures/tiles in place. Polychrome/subpixel texture allocation uses that field. |
| `gpui-pre-wgpu/src/wgpu_renderer.rs:924` | Multiply pipeline is created only for the two supported target formats. Existing encoding guard at line 1533 uses a captured boolean. |
| `gpui-pre-wgpu/src/wgpu_renderer.rs:2183` | Unconfigured/Released states cannot draw. Recovery recreates core/format/pipelines; resize and transparency updates retain the configured format. The proposal explicitly checks these current states. |
| `gpui-pre-linux/src/linux/{x11,wayland}/window.rs` | Both window implementations own a WGPU renderer. Device recovery schedules forced redraw; the source paths were inspected, not exercised in this lane. |

Both storage-buffer and WebGL shader strings include the same common
`shaders.wgsl` containing `fs_poly_multiply`. There is no invented missing-entry
or OS-based shader refusal in this proposal. Default-false platform admission
still limits which window implementations expose the operation.

## Tests and review procedure

`tests.patch` targets the proposed sources **after** `integration.patch`.
The two `.rs` files are exact copies of its appended test modules.
Three tests are authored, with these exact filters:

1. `test_destination_multiply_default_backend_refusal_preserves_scene_and_atlas`
   paints ordinary images/quads in a real GPUI test scene, instruments atlas
   requests, refuses a valid-grid multiply group on the default-false test
   backend, verifies unchanged scene length/sprites/atlas requests, then
   continues ordinary source-over painting. It also checks empty/zero no-ops.
   This is a headless scene test, not GPU or upload-observation proof.
2. `destination_multiply_formats_are_exact_byte_channel_pairs` covers the four
   supported target/atlas pairings.
3. `destination_multiply_rejects_srgb_hdr_integer_and_mono_atlases` rejects each
   unsupported format in either role. `vectors.json` supplies 64 independent
   format-policy cases and eight authored admission expectations; it contains
   no executed backend observations.

Parent review commands, not run in this lane:

```sh
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/format-capability/integration.patch
# Parent applies integration.patch only after review, then checks tests.patch.
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/format-capability/tests.patch
```

Root's concurrent `WgpuAtlas::contains` retirement fix is preserved. The atlas
entries in `baselineFiles` and `proposedFiles` are **historical pre-overlap
whole-file hashes**, not a request to revert that fix. `atlasOverlap` records
the observed current hash and the capability proposal composed with Root's
override. Exact capability hunk reconstruction in memory succeeded without
writing any shared file; actual `git apply --check`, formatting, compilation
and test execution remain Root's work.

## Proof limits

This capability is format/pipeline admission, not a general CSS blend-mode or
device-health API. It does not acquire a surface texture, consume the device
error stream, validate arbitrary image premultiplication, verify caller paint
order, or guarantee successful presentation. Target-format/pipeline and live
atlas-format checks do not replace existing caller constraints.

Unconfigured/lost/recovered-state transitions, actual unsupported-format
surfaces, cached scene replay, X11/Wayland rendering and GPU raster equivalence
are unexecuted here. A manually injected or stale unsupported multiply scene
can still fail the defensive encoder guard; freshly recorded unsupported
overlays are refused before mutation. Root's earlier successful probe pixels
and pending retirement check are separate evidence and do not certify this
new capability patch. No Source background or foxing raster was changed.
