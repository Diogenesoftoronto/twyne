# Wayland rich clipboard, bounded integration slice

The two runtime modules implement an application-owned Wayland clipboard.
Root applied the reviewed `integration.patch`, wired the editor and host, and
added the lockfile's direct optional edge to the **already pinned**
`gpui-pre-linux =0.3.7` package, plus the native fixture example. Root also
repaired two backend defects exposed by actual native acceptance: keyboard
focus/modifier events before a keymap, and a focused editor's input handler
retained during deferred window shutdown. No new package,
data-control requirement, secondary application connection, browser, provider,
font, primary-selection, or shared Source engine change is introduced.

## Interface and protocol ownership

- `editor::clipboard_wayland::WaylandClipboard::current()` obtains the weak
  foreground-thread handle installed by the actual GPUI Wayland client.
  `App::compositor_name()` is exactly `"Wayland"` in the pinned client. X11 and
  test/headless contexts retain their existing paths.
- `ClipboardOffer::rich(&RichFragment)` serializes the existing unchanged
  plain text, external HTML, and `twyne.rich-fragment` version1 envelope.
  `begin_publish(offer)` queues onto the application's existing calloop;
  `ClipboardPublication::wait()` runs on the background executor.
- Publication requires **current keyboard focus** and a real keyboard press,
  or a real pointer press on that same keyboard-focused application surface.
  Hover, keyboard enter, releases, and fabricated serials never qualify.
  Enter/Leave clear the press slot and advance a focus epoch. Each queued
  request binds that epoch. A receipt exposes generation/input serial, retains
  the epoch internally, and `is_publication_current(receipt)` guards the final
  foreground Cut deletion after the normal source/selection/read-only checks.
  A real `u32` serial may wrap to zero; `None` never becomes zero.
- A receipt acknowledges a **flushed request**, not global selection ownership.
  Core Wayland has no ownership-acceptance reply. Actual external consumption
  is therefore a separate acceptance check. This limitation remains explicit.
- `read()` queues actual `wl_data_offer.receive` requests on the application's
  connection and performs only pipe I/O in the background. `ClipboardSnapshot`
  retains an opaque client/observed-offer generation. `is_current(token)` is a
  cheap observed-event check, not a global clipboard-owner query. Focus loss,
  selection replacement, offer destruction, cancellation, and shutdown prevent
  a stale result from reaching the live editor.
- MIME preference is UTF8 plain aliases, the unchanged native envelope, then
  actual UTF8 HTML aliases. Semantic import prefers recognized native metadata,
  actual HTML, then actual plain text. Unrelated/future/stale-text envelopes may
  fall back; recognized malformed slices fail before editing. No HTML is made
  by wrapping plain text. RTF-only clipboard data reports unsupported import.
- Root's original converter runs on a cloned full-document candidate before
  publishing one `PasteFragment`/`ReplaceSelection` command. Its document and
  source limits, rich marks, comments, notes, math/raw atoms, image attributes,
  unknown fields, code-block plain-text behavior, revision/selection/focus
  freshness, and atomic Undo boundary remain authoritative.

The primary protocol basis is the official
[data-device specification](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_data_device),
[offer receive specification](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_data_offer),
and [source send/cancel specification](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_data_source).
The local implementation uses the pinned `wayland-client`, `calloop`, and
`filedescriptor` APIs already in the vendor dependency graph. Each source owns
immutable bytes; Send requests are associated with its actual proxy ID and
generation. Cancelled old sources cannot clear a later foreign offer. Shutdown
cancels local requests/writers and destroys owned source proxies; it never
calls `set_selection(None)` to clear an unrelated clipboard.

## Resource bounds

- Aggregate text + HTML + native metadata: 64MiB; HTML: 32MiB.
- Eight active transfers and eight queued requests, using nonblocking try-send.
- Absolute four-second queue/transfer deadline, 64KiB chunks, cancellation and
  ownership checks at most25ms apart; no inactivity timer that resets forever.
- Eight observed offers, at most64 MIME entries of at most256 bytes. Excess
  MIME announcements are ignored within those bounds; no unbounded catalog is
  allocated. The existing client still owns offer destruction.
- Pipes are nonblocking. Malformed UTF8, oversized bytes, backpressure,
  shutdown, and stale offers return an error instead of partial paste success.

## Checks actually run in this delivery

`/tmp/twyne-wayland-protocol-report.json` records **14/14** transport/state tests
and **5/5** semantic adapter tests. The tests compile the actual new modules
directly with an existing compatible rustc and cached dependencies, including
the real cached Twyne `RichDocument` implementation. No Cargo, Devenv, dependency
resolution, fake rich model, or compositor connection was used by this check.
It exercises a multi-megabyte UTF8/CRLF pipe, size rejection without partial
result, an absolute slow-trickle deadline, writer backpressure, cancellation,
offer changes, shutdown, transfer permits, and stale focus/source receipts.

`/tmp/twyne-wayland-owned-driver-smoke.json` records **2/2** actual private Sway
checks: a new0700 runtime/headless1280×860 output with an owned virtual keyboard,
and exact external HTML through `wl-copy`/`wl-paste`. This is actual compositor
and external-tool proof **only**. Root subsequently compiled the integrated
native fixture and passed29 actual native acceptance checks after the focus
and shutdown repairs. A final repeat after NoKeymap transition invalidation is
in progress; `progress.json` distinguishes these successive checkpoints.

The direct compiler reproduction, using existing matching Nix artifacts, is:

```sh
rtk proxy python3 desktop/gpui/fixtures/wayland-clipboard/check-protocol.py \
  --rustc /nix/store/hr3npzrq9l029s5hf948by203m6qz3lw-rustc-wrapper-1.98.1/bin/rustc \
  --linker /nix/store/j1938gsbvbhkyz4kbmvjk56r479mkw3s-gcc-wrapper-16.2.0/bin/cc \
  --semantic \
  --native-library-dir /nix/store/cdpwb5vckqp8il7p70jqvn27isflyxxz-libxcb-1.17.0/lib \
  --native-library-dir /nix/store/n2wqk78za8grzs9088ya5qy6vw280p8x-libxkbcommon-1.13.2/lib \
  --native-library-dir /nix/store/hrxf1fxrp7qwxrlv5k4aqxlwlam952aa-fontconfig-2.18.3-lib/lib \
  --native-library-dir /nix/store/85v143gw8jcqjg04gxb38c4han2z7myb-freetype-2.14.3/lib
rtk proxy python3 desktop/gpui/fixtures/wayland-clipboard/check-native.py --smoke
```

## Root integration and actual native acceptance

The historical `prepare-integration.py` handoff checks exact source fragments, records original-file
SHA256 values in `integration-bases.json`, and writes only the patch/evidence.
It fails on drift rather than reverting another worker's edits. A final
`git apply --check` passed before Root applied it. The patch is already applied;
do not regenerate/reapply it over the integrated runtime or subsequent fixes.
Root owns formatting of affected existing files, the manifest/lock direct edge,
and the single Cargo schedule.

```sh
rtk proxy devenv shell -- rtk proxy cargo check --manifest-path desktop/gpui/Cargo.toml --locked --offline --all-targets --features ui-tests
rtk proxy devenv shell -- rtk proxy cargo check --manifest-path desktop/gpui/Cargo.toml --locked --offline --no-default-features --lib
rtk proxy devenv shell -- rtk proxy cargo build --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --example twyne-wayland-clipboard-probe
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/wayland-clipboard/check-native.py
```

The private driver opens Sway1.12 from pinned nixpkgs
`c7def046b9a883d46974757852106483d741586f`, `WLR_BACKENDS=headless`,
`WLR_RENDERER=pixman`, and wtype0.4, all provisioned by Root under existing Nix
store paths. It removes inherited X11/Wayland/IPC/DBus variables, supplies private
config/data/cache/runtime paths, disables Xwayland, and checks its own IPC/output
before launching any client. Every child process group belongs to the fixture
and is terminated on success/failure. It never reads the user's clipboard or
attaches to their compositor. Test tools/ICD paths are explicit overridable
arguments; the driver never installs them.

The authored native cases exercise two actual GPUI processes, real keyboard
serials, rich native→external→native exchange, source/mark/atom metadata,
foreign HTML, a large literal UTF8/CRLF transfer, malformed native data,
original-converter preflight, one actual Undo/Redo, actual Copy/Cut, refusal of
Cut after focus away/return without a new press, owner/typing/selection/read-only/
editor/focus races during held preflight, and clean shutdown preserving foreign
selection. The held conversion barrier is a fixture boundary, not a new product
flow. The fixture checks private runtime/socket identity and actual backend
before obtaining the application-owned bridge. Programmatic negative copy/cut
controls intentionally lack a new input press and must fail.

Remaining proof includes the final NoKeymap repeat, existing X11 regression
checks, a normal desktop-application build, primary selection, other
compositors/device configurations, and a malicious slow/oversized source on a
real compositor. Pipe tests establish the bounded I/O behavior separately.
The real focused-editor shutdown originally leaked its input entity. Root
releases the input handler synchronously after its state borrow, following the
existing X11 repair. Deferred protocol cleanup and close callbacks retain their
existing semantics. Pending note-frame callbacks still need a separate shutdown
check; ordinary editor shutdown has passed on the owned compositor.
