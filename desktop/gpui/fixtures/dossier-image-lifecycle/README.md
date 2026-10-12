# Prepared Dossier image retirement proposal

**Unapplied and unregistered.** The new sidecar and 13 deterministic Rust tests
are authored and syntax-formatted. No Cargo, GPUI frame, native input, GPU memory
measurement, presentation, compositor, close or multi-window test was run by
this worker. Source inspection establishes the conditional lifecycle below;
it is not an executed retirement receipt. Root owns compilation and proof.

The proposal adds `src/dossier_image_lifecycle.rs`. `integration.patch` touches
only `src/lib.rs`, `src/dossier_view.rs` and `src/app.rs`. It preserves all current
Source/editor/font/renderer patches. `patch-base.json` records those exact bases.
The existing `dossier_multiply` module is library-exported but not mounted in
the product, and its file is unchanged.

## Ownership and the actual pinned APIs

All pointers below are relative to `desktop/gpui/` and are pinned in
`source-pins.json` (current local `gpui-pre`, Linux and WGPU **0.3.7**):

| Finding | Source |
| --- | --- |
| X11 and Wayland call `WgpuRenderer::new` for each window. That constructor allocates a **new** `Arc<WgpuAtlas>`; the shared `WgpuContext` contains device/queue, not an atlas. | `vendor/gpui-pre-wgpu/src/wgpu_renderer.rs:305–350`, `wgpu_context.rs:10–18`; `vendor/gpui-pre-linux/src/linux/x11/window.rs:771`, `wayland/window.rs:581` |
| One `RenderImage` ID/frame is one atlas key. Dropping the CPU image/Arc is not an atlas eviction. Scenes retain copied `AtlasTile` values, not image ownership. | `vendor/gpui-pre/src/assets.rs:33–75`, `platform.rs:1380–1509`, `scene.rs:97–145`, `window.rs:4890–4956` |
| `Window::drop_image` synchronously removes every frame's key in that window's atlas; it does not refresh, clear scenes, wait for a GPU or report reclaimed bytes. | `vendor/gpui-pre/src/window.rs:5083–5093` |
| `App::drop_image` iterates all windows, including a supplied current window. Use of this global method for one Dossier would evict other windows' keys. | `vendor/gpui-pre/src/app.rs:2841–2858` |
| Ordinary cached views can replay old tile coordinates. A **full** window refresh before the qualifying frame disables that reuse. | `vendor/gpui-pre/src/window.rs:2272–2277`, `view.rs:483–511`, `window.rs:3919–3922` |
| `on_next_frame` is not an after-draw fence: callbacks actually run before draw. Scheduling two callbacks is not a receipt either. | `vendor/gpui-pre/src/window.rs:1780–1812`; the doc at2601 describes different ordering |
| The ordinary platform path wraps draw→present→arena.clear in a single `handle.update`. `Window::draw` swaps `rendered_frame` with `next_frame` and clears the former scene before returning. | `vendor/gpui-pre/src/window.rs:1801–1812`, `3342–3348`, `Frame::clear:1063–1080` |
| That window update is inside `App::update`; outer `finish_update` flushes effects only after the draw/update closure returns and the window is reinserted. Nested updates do not flush prematurely. An already-flushing effect completes its callback before consuming another effect. | `vendor/gpui-pre/src/app.rs:1160–1185`, `1784–1810`, `2882–2947`; `app/async_context.rs:88–98` |
| `Window::defer` queues an end-of-effect-cycle callback. A callback **enqueued by an actual marker paint** therefore follows old CPU-scene replacement on the preceding ordinary platform path. Defer from an arbitrary state change lacks this proof. | `vendor/gpui-pre/src/window.rs:2497–2505`; `app.rs:2070–2074` |

The deferred marker is a **CPU-scene/atlas-key boundary**, not “after successful
GPU presentation.” `Window::present` does not expose success; a WGPU surface can
timeout/be occluded before rendering. No public frame serial, scene-reference
query, atlas identity or submission fence is used here. Private APIs and
`has_image_atlas_entry`/`simulate_next_frame` test-only APIs are not used in
production. Arbitrary caller-driven or nested `Window::draw`, unwind/panic and
changed framework scheduling are outside this proposal's established boundary.

## Integration contract

`DossierImageLifecycle::new(window, app) -> Result<Handle>` creates one registry
per WritingRoom/window; it refuses uninspected non-Linux/FreeBSD targets. It
also qualifies the App by its weak text-system allocation, so coincident window
IDs from different Apps cannot exchange leases. It observes actual window close
and app quit to clear CPU accounting without evicting still-live scene tiles.

`lease(window, app) -> Result<DossierImageLease>` allocates a checked monotonic
consumer ID. `lease.replace(&[Arc<RenderImage>], window, app)` runs only at
constructor/theme/DPR/resize preparation boundaries. Its accepted set includes
paper and **every count 0–7 stamp**, including variants not uploaded yet. After
product multiply is mounted, add `premultiplied_group()` as the optional tenth
image; transparent Broadsheet contributes none. Never mount premultiplied bytes
as an ordinary alpha image. Changing only reviewed count uses retained images
and requires no rasterization, new lease or retirement.

Replace the lease **before committing** new prepared pointers. On refusal the
proposal restores old fields/lease; existing paint guards refuse a stale
palette/DPR rather than stretch or paint an untracked candidate. Error retains
all answers. Capacity refusal is not a successful preparation; a subsequent
explicit `prepare_paper` boundary can retry after retirement. The proposal does
not add a retry control or automatic per-key raster work.

Before the actual root mounts a form, attach its lease. At root render call
`retain_only(actual_mounted_form.image_lease(), window, app)`; use `None` when
there is no mounted Dossier, including standalone routes. This operation is
only constant-sized identity bookkeeping on the key path. Failed departure
keeps the current lease. Cancel, filing success, folio/route switch and
same-scope reopen retire only **actually unmounted** leases. A held old entity
then cannot regain ownership from a later theme observer. The current product
has one mounted Dossier per root; a future multi-form root must provide an
explicit complete visible-consumer set instead of calling this single-form
`retain_only` API. Separate registries for consumers in the same atlas would be
incorrect.

Mount `lifecycle.marker()` as a persistent last child of the positioned
WritingRoom root, across all routes and after Dossier removal. The absolute
Canvas inserts no primitive, hitbox, focus stop or handlers. Preparation changes
queue one deferred `window.refresh()` and qualify the latest ownership epoch.
Only an actual subsequent marker paint can queue retirement. Its deferred
callback rechecks that exact epoch/full-refresh ticket and evicts only images
with **zero leases**. Late/duplicate marker receipts and later replacement,
same-cache reuse, unmount/reopen, counter exhaustion or close are neutral. Weak
captures retain no window/App/entity. No recursive or explicit draw is used.

## Cache and GPU limits

Existing global caches hold at most two paper preparations, two eight-stamp
sets and two multiply groups. Paper/group raster limits are 8,388,608 pixels each;
stamp limits total 1,048,576 pixels per set. Their three LRU caches therefore each
bound their own raw pixel bytes (64 MiB, 8 MiB, 64 MiB; 136 MiB combined), **excluding**
external Arc holders, SVG/shadow/font allocations and backend storage. They do
not evict GPU keys. Old retained form entities can also retain CPU preparations;
this proposal does not claim a process-wide CPU bound.

The registry bounds its own accepted active+pending refs to 4 consumers,
10 images per consumer, 64 unique images and 256 MiB of BGRA bytes, with checked
arithmetic/identities. Over-budget replacement is refused atomically. While an
occluded/parked window cannot paint, pending images remain within those limits;
elapsed time is never used to invent a safe fence. Retiring a never-uploaded
stamp is a no-op. Reusing a CPU cached preparation later uploads again as needed.

WGPU removal deallocates a tile and releases an atlas texture only when its last
key is removed (`wgpu_atlas.rs:137–158`). Other images/glyphs may share that
texture. Allocation has a 1024×1024 minimum (`:187–215`), so raw image bytes are not
texture-memory usage. Bind groups hold views and are pruned/replaced on a later
successful render (`wgpu_renderer.rs:1757–1802`); stale sprites can otherwise
reference missing/reused tiles. Generation-aware texture bindings do not make
old **tile coordinates** safe after reuse. That is why CPU-scene replacement is
required first. In-flight queue references/driver reclamation remain asynchronous
and unmeasured; this proposal guarantees neither GPU idle nor immediate VRAM
release nor a global atlas byte cap.

The successful WGPU render path submits its encoded scene before returning
(`wgpu_renderer.rs:1687–1692`). Future atlas uploads use the same queue in
`wgpu_atlas.rs:266–295`; the pinned wgpu 29.0.4 `src/api/queue.rs:121–128,226–228`
describes those transfers as queued for the next submission. This source-backed
ordering supports later tile reuse after the old CPU scene disappears; it is
not a measured completion fence. A failed/occluded render and bind-group/driver
reclamation remain the explicit boundaries above. No queue, device or test-only
backend handle is obtained by this proposal.

`renderer.destroy()` releases its core, but the renderer struct still owns its
atlas (`wgpu_renderer.rs:2254–2258`). X11/Wayland Drop retain window state in
deferred close tasks (`linux/x11/window.rs:875–922`, `wayland/window.rs:757–815`).
Window close is therefore not an immediate GPU-memory receipt. Shutdown/close
here only revoke CPU leases; platform/resource destruction remains separate.
Device recovery may clear/recreate an atlas independently and already forces
uncached redraw; the sidecar does not claim to control or acknowledge recovery.

## Review and Parent gates

Worker checks: scoped rustfmt syntax/check and `git apply --check` only. Rebuild
the patch without shared writes:

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-image-lifecycle/build-patch.py
rtk proxy git apply --check desktop/gpui/fixtures/dossier-image-lifecycle/integration.patch
```

After Root reviews/applies/exports, suggested Parent-only Rust gate:

```sh
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib dossier_image_lifecycle::tests -- --test-threads=1
```

The 13 authored tests cover refresh/marker ordering, stale and duplicate receipts,
same-cache reuse, shared consumers, independent ledgers, all eight stamp IDs,
transparent optional group, unchanged replacement, pending/consumer budgets,
malformed/ID collisions, close and counter exhaustion. Their constructed
receipts are **not executed scene or asynchronous race proof**.

Actual acceptance remains pending: mounted marker layout/interaction bounds;
all 0–7 stamp count transitions; repeated theme/DPR/resize and cancel/reopen;
occluded→visible recovery; actual key absence/reupload and pixel integrity;
same-window multi-consumer fixture; independent native two-window atlas proof;
clean WM close/Ctrl-Q; failed surface/device recovery behavior; bounded memory
observation over sustained transitions. Test-only atlas queries may be used
for Parent diagnostics, never to implement production quiescence.
