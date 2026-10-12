# Native clipboard acceptance

The Linux writing view opts into this adapter only when GPUI's actual
`compositor_name()` is `X11`. An inherited `DISPLAY` alone does not enable it.
The GPUI test platform, Wayland, macOS and Windows keep their existing path.

`X11Clipboard` serves `text/html`, UTF-8 plain text and the versioned
`application/x-twyne-rich-fragment+json` MIME. The private MIME keeps the
original rich slice, marks, notes, review attributes, source atoms and unknown
metadata across native processes. Public HTML adds PM's transport annotation
without changing the manuscript tree. The original authored Typst is separate.

`RichEditorView::set_external_clipboard(transport, preflight, cx)` requires the
app's original canonical converter as `ClipboardPreflight`. Clipboard reading,
HTML parsing, full candidate construction and that callback run in the
background. A paste creates one undo boundary only after native HTML/resource
validation and original canonical source validation. Revision, selection,
interaction generation, focus, read-only state and selection owner are checked
before applying the result. Ordinary typing does not serialize the document.

The existing HTML limits remain 32 MiB, 200,000 nodes, 5 Mi text scalars and
depth 512. Each MIME offer/read has a combined 64 MiB transfer budget. Decoded
UTF-8 expansion is also bounded. Owner publication has a bounded queue;
outgoing INCR transfers have both count and retained-byte limits. Peer format
conversion and incremental waits use four-second deadlines. The reader accepts
xclip's empty format-32 INCR size hint without reserving an advertised buffer;
actual chunks still obey the same total limit. Incoming large properties are
read in bounded chunks before deleting the property.

Run from the repository root:

```sh
rtk proxy bun desktop/gpui/fixtures/editor/capture-clipboard-web.ts
rtk proxy devenv shell -- cargo build --locked --offline --example twyne-clipboard-probe --features desktop --manifest-path desktop/gpui/Cargo.toml
rtk proxy devenv shell -- python3 desktop/gpui/fixtures/editor/check-x11-clipboard.py
rtk proxy devenv shell -- cargo test --locked --offline --lib --features desktop,ui-tests --manifest-path desktop/gpui/Cargo.toml editor::
```

The browser reference executes the current Twyne extensions, original PM
clipboard serializer and original paste event handler in a fresh local Chrome
with zero external requests. `clipboard-web-reference.json` retains that output.
The cross-process fixture starts its own Xvfb using `-displayfd`, passes that
display explicitly to every producer/consumer, tracks processes and terminates
the display afterward. It never accesses the user desktop or browser profile.
It verifies native→native/xclip formats, original-browser HTML→native,
multi-megabyte INCR in both directions using actual transport counters,
plain-text fallback, oversized/stalled peers and selection owner replacement.

The same fixture opens a real GPUI X11 writing window using original fonts and
dispatches native Paste/Copy/Undo/Redo actions. Its source-aware preflight uses
the actual original semantic helper. A separate xclip process consumes the
native Copy's HTML. It proves one undo boundary, preservation of existing
custom Typst, and rejection without content/history/source mutation after late
selection, editor replacement, read-only, focus or clipboard owner changes. An
image candidate within native HTML bounds but above the original canonical
5 MB source budget is rejected before insertion.

Remaining boundaries:

- RTF-only import is explicitly unavailable. HTML is preferred when offered;
  otherwise plain text remains interoperable. No RTF codec or synthetic rich
  formatting has been added.
- This external-format adapter is implemented and proven on X11 only.
  GPUI's public clipboard item has no HTML/RTF variant; other platform adapters
  remain pending. The existing internal native clipboard behavior is retained.
- Direct PM slices with open depth 0/1 and empty context are supported. Deep
  list/table open contexts and partial table transport wrappers are rejected;
  complete supported containers retain their metadata. This does not prove all
  foreign word-processor CSS/layout or arbitrary PM slice fitting.
- StarterKit's trailing-node extension adds an empty paragraph after a final
  heading in the browser. Native clipboard tests identify that separate gap.
- X11 peers without TIMESTAMP cannot expose same-window republication. The
  adapter checks ownership and available timestamps, then the owner window
  again immediately before insertion; X11 provides no atomic clipboard lease.
- Local X server replies use x11rb's blocking reply API. Peer stalls are
  bounded; a frozen X server is outside that deadline guarantee.
- Clipboard-manager SAVE_TARGETS/MULTIPLE handover is not implemented. Rich
  selection ownership is retained while the application runs; preservation
  after its owner exits is not claimed.
