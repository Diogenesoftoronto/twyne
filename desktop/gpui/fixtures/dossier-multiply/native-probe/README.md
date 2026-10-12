# Actual GPUI destination-multiply acceptance probe (unexecuted)

This is a new isolated fixture, not a product mount or recorded acceptance.
Parent owns the frozen renderer patch, vendoring, Cargo, Devenv, shader/native
execution and captures. No shared/Source/vendor file was edited here; no
Rust/Python/native test, browser, Cargo, Devenv, GPU, network or provider run
was made. `registration.patch` is an **unapplied** example-only manifest
registration. The files are authored and statically inspected, not compiled.

The example requires the already-reviewed `Window::paint_multiply_image` and
`SvgRenderer::render_parsed_premultiplied` proposal APIs. It does not need a
product `dossier_multiply` export or a Dossier app change. It creates a real
GPUI view with opaque black/white/red/green/blue/mixed quads, bundled-font
shaped black text, a retained native Input, a partially translucent live child,
ordinary polychrome sprites, and noninteractive canvases for the overlay.
No screenshot/backdrop is consumed by the application. No font/sheet/foxing
design changes are made.

## Inputs and deliberate wrong modes

The original frozen `../editorial-4-group.svg` and `../nightpress-4-group.svg`
are included without copying/regeneration. They retain the extracted five
Source radial layers and their order in a 4CSSpx diagnostic extent. All layers
are composited into one transparent premultiplied raster by the new public
API. Its raw BGRA bytes, image IDs and actual device extent are emitted in
`native.json`. At real DPR1 this is a 4×4 image; a supported DPR2 reparses it
at8×8. These small groups are blending inputs, not full-sheet Source raster
references.

`strong-group.svg` is explicitly **synthetic**: two different-color overlapping
rectangles. It makes group-opacity versus independent-layer-opacity differ
substantially after UNORM quantization, so the acceptance detector cannot pass
only because Source's small alpha difference is below one byte. It is not a
new Source approximation. A small premultiplied edge tile has transparent
outer texels and colored center texels. Hot magenta and translucent ordinary
images use the unchanged straight-BGRA SourceOver image path.

The executable accepts an explicit owned display, mode and output file:

```text
twyne-dossier-multiply-probe :OWNED_DISPLAY MODE /owned/native.json
MODE = baseline | multiply | normal-alpha | per-layer | beneath
```

It refuses to use a display unless `DISPLAY` and the runner's
`TWYNE_MULTIPLY_OWNED_DISPLAY` token both equal that explicit value. The actual
compositor must report X11. Only a newly created private display is allowed by
the runner. No user account/store, Source route, browser or production app is
opened.

- `baseline` draws the **same live descendants** with the group omitted.
- `multiply` calls the proposed destination-multiply API with `.7` once on
  the composed premultiplied group, after live descendants.
- `normal-alpha` paints a straight-color image with `.7` effective alpha via
  the unchanged ordinary SourceOver API. It must lift black and fail the
  correct-multiply pixel contract.
- `per-layer` calls multiply separately on the original individual layers,
  each with `.7`. The synthetic overlap must fail the correct group contract.
- `beneath` draws multiply before the opaque live quads/field. Those children
  overwrite it; the correct above-content contract must fail.

The same later translucent ordinary sprite is painted in an explicit later
`paint_layer`. It must use ordinary SourceOver after multiply, exercising the
blend-batch transition back to the unchanged pipeline. An ordinary sprite
before multiply supplies the opposite order. Untouched ordinary and hot
sentinel sprites must remain byte-identical to their native baselines.

## Pixel/reference protocol

The example emits actual root bounds, actual DPR, region offsets, individual
group pixels, individual-layer order, observed control content bounds, field
value/counter, submitted frames, paint errors and atlas-retirement receipts.
These are inputs/observations, **not a pixels-passed flag**. The app's receipt
explicitly sets `pixels_accepted=false`; only Root's actual captured pixels
can establish that claim.

`check_pixels.py` reads an actual native baseline and matched actual native
candidate. It samples every device texel of every declared tile region, using
the emitted root origin/DPR and raw prepared input. It does not guess a2px
window offset or resize the capture. Client/root extent or DPR mismatch
refuses. The expectation uses standard blend+SourceOver over opaque D:

```text
sourceAlpha = g*A
sourceColor = p/A (0 when A=0)
expectedRGB = D * ((1-sourceAlpha) + sourceAlpha*sourceColor)
```

The reference derives D from the same live baseline for glyph/field and
translucent-child samples. The application never sees that baseline. For the
later translucent sprite, the source code's explicit opaque white root is
multiplied first, then the actual ordinary sprite's straight BGRA/alpha is
composited. Baseline sanity also requires the six native quads and ordinary
sprites to render their specified colors; comparing two missing sprites
cannot pass as unchanged behavior.

The detector allows **at most2 bytes/channel** for genuine nonidentity blend
samples (8-bit input, f32 multiplication and framebuffer rounding). Transparent
group texels, masked-out pixels and untouched ordinary sprites require exact
identity. It requires actual black glyph pixels in the live plain-text region;
selecting only empty field padding is not a sufficient text check. Input ink
uses its actual editor-theme foreground and is checked against its own live
baseline. The correct
mode must have zero mismatching samples. Each deliberately wrong mode must
produce at least8 mismatching pixels and a channel error of at least8 bytes.
All per-region statistics and first64 failures are retained. These authored
thresholds have not been tuned against a GPU run; a failure must be inspected,
not silently widened.

The half-tile content mask tests both unchanged outside and multiplied inside
pixels at an integral device clip boundary. Transparent edge texels and an
uploaded hot sprite exercise sampling isolation. **Public GPUI APIs do not
expose atlas allocation coordinates here, so actual adjacency is unknown.**
The hot sentinel is a candidate neighbor, not certified adjacent-tile coverage.
Root may add a separate renderer-owned atlas inspection gate after review.

## Parent build/run

First Parent vendors/applies the frozen five-file core/WGPU patch and its
approved crates-io override. Do not apply this fixture's registration before
the public APIs exist. All commands below are **instructions, not executed
checks**. They use existing dependencies (`image`, `roxmltree`, `serde_json`,
GPUI Kit); no dependency additions/installations are required.

```sh
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/native-probe/registration.patch
rtk proxy git apply desktop/gpui/fixtures/dossier-multiply/native-probe/registration.patch
rtk proxy devenv shell -- rtk proxy cargo build --locked --offline --manifest-path desktop/gpui/Cargo.toml --features ui-tests --example twyne-dossier-multiply-probe
```

The UI-test feature is required for the existing public test-support
`has_image_atlas_entry`. Parent should compile/format/check this authored
example and preserve any diagnostics; no all-target/build proof is claimed.

Root supplies an already saved runtime-env JSON containing only noncredential
keys from the runner's allowlist (PATH/LD_LIBRARY_PATH/Vulkan ICD/data/font
paths and optional software/present flags). No Devenv entry is made by the
runner. It uses already present Xvfb, xwd, ImageMagick, xdotool and RTK. It never
prints the runtime environment and never carries provider credentials.

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/native-probe/run_native.py --binary desktop/gpui/target/debug/examples/twyne-dossier-multiply-probe --runtime-env /owned/runtime-env.json --output desktop/gpui/target/verification/multiply-probe-NEW
```

Use a new output directory for every run. It allocates its own Xvfb with
`-displayfd` and `-nolisten tcp`, captures the exact named client, keeps two
pixel-identical frames, and runs five separate native clients. Captures,
inputs, native logs, pixel mismatches, Xvfb log and acceptance/errors are
retained even on failure. Cleanup signals only the process groups the runner
created. Every external command is prefixed with `rtk proxy`.

The correct mode additionally clicks observed native controls: the live
button, the real Input (types fixture text), palette replacement and retired
atlas release, then resizes the actual client. Ctrl-Q must exit cleanly. These
interaction frames are separate from the matched initial pixel comparison;
they cannot be substituted for an unchanged-source baseline.

## Supported bounds and honest lifecycle limits

This probe is **Linux private X11** acceptance of the reviewed Linux/FreeBSD
WGPU API, not proof on FreeBSD/Wayland/Metal/Windows/WebGL/mobile. A software
Vulkan adapter still executes the real shader/framebuffer path; it is not
physical-GPU proof. Root retains adapter/target logs. The required target and
atlas are non-sRGB BGRA8/RGBA8 UNORM, with an opaque window, explicit opaque
root beneath all descendants, ancestor opacity1, one-frame premultiplied
groups, exact1:1 device extent and integral origins/masks. Unsupported formats
or pipeline failures must refuse and leave their native logs.

Tiny tile preparation is bounded to `.5..4` DPR and integral `4*DPR`; this
probe's half-tile mask additionally requires integral `2*DPR`. That narrower
mask means real DPR1.25 is refused here, although other integral masks can be
supported by the proposed core. Supported real DPR requires a separately
matched baseline/capture; the default Xvfb runner does not manufacture a real
DPR transition or call a scale override. The observer reparses/reprepares at a
reported DPR change, including a same-logical-size change. Its actual callback
and pixels still require a real Root-owned transition run.

Palette replacement retains old prepared images, invalidates this one view,
renders the new epoch, and retires only after a later actual frame callback.
The public `has_image_atlas_entry` and `drop_image` APIs record before/after
entry presence and errors. The driver requires some old uploaded entries and
no entries remaining for that retired preparation. This is **individual atlas
entry lifetime**, not measured GPU bytes or a complete application/multiwindow
ownership proof. The probe has one consumer. Resize keeps4px group extent and
records the actual root geometry; it does not establish Dossier's full-size
preparation/resize geometry. Root must prove its actual product retirement
barrier/consumers independently before mounting.

RGB xwd screenshots cannot measure framebuffer alpha. General transparent
destination/group isolation is unsupported. Source Chromium versus resvg
radial sampling/antialiasing is unproved even if all blend samples pass. This
fixture never claims Source radial-raster equivalence, a complete resource
bound, or product Dossier parity.

`pins.json` and `freeze.json` record exact inspected baseline/input and authored
artifact hashes. No apply-check/build/native receipt exists until Parent runs
the commands; the unexecuted status is intentional.
