The native writer publishes human-readable plain text plus versioned
`twyne.rich-fragment` metadata through GPUI's real `ClipboardItem` API.
Selected Unicode text, marks, comments/review wrappers, note bodies, unknown
attributes, and immutable math/Typst/image source atoms survive an internal
copy/cut/paste. A paste is one history transaction; unsupported cross-cell or
container replacements leave the document, selection, and history intact.
Copy/cut serialize only their selected fragment at the explicit clipboard
boundary. Ordinary typing does not serialize the document.

HTML slices share the bounded32MiB importer and its200,000-node,
5,242,880-text-scalar,512-depth limits; clipboard JSON is capped at64MiB.
Large data URLs remain exact. Cached normalized byte counts allow a paste or
image candidate to reject before document/caret/history changes. The root-owned
canonical Typst converter separately retains the web's5m UTF16 source limit;
a large HTML image fitting the parser does not establish canonical source
acceptance. Root checks original conversion before image insertion.

`RichDocument::copy_fragment(range)` returns `RichFragment`, whose inline/open
edges describe how the selected tree joins existing paragraphs. The fragment
exposes normalized HTML, plain text, and bounded metadata encode/decode.
`Command::PasteFragment(fragment)` inserts it through the existing structural
replacement checks. These operations handle the visual tree; canonical
authored Typst stays with the workspace/source session.

GPUI 0.3.7's public native clipboard entries support text, images, and files;
they do not expose HTML/RTF formats. Linux X11 and Wayland retain metadata for
clipboard reads within the same process and publish text to other applications.
macOS and Windows use native metadata formats with a hash of the plain text.
External HTML/RTF interoperability and rich Linux cross-process clipboard
transport require a separate native format adapter and remain pending.
Unrelated, stale, and future-version metadata falls back to plain text.

The native interaction checks use GPUI's test platform and actual key actions
with `read_from_clipboard`/`write_to_clipboard`. They establish the GPUI action
and fragment contract; they are not OS clipboard interoperability evidence.
The local-source platform implementations were inspected separately. Partial
table selections across cells are rejected; whole-table copies retain the
complete geometry. Nested block-container pastes into list/table passages are
also rejected until a dedicated structural insertion adapter exists.
