#!/usr/bin/env python3
"""Create the exact unapplied integration patch; never write runtime files.

Every targeted source fragment is checked before transformation. Root owns
review/application and manifest/lock scheduling. Re-run after source drift to
fail explicitly rather than overwrite somebody else's changes.
"""
import difflib
import hashlib
import json
from pathlib import Path

fixture = Path(__file__).resolve().parent
root = fixture.parents[3]
changes = {}
bases = {}

def edit(path, replacements):
    source = (root / path).read_text()
    result = source
    for old, new in replacements:
        count = result.count(old)
        if count != 1:
            raise SystemExit(f"Source contract changed: {path}: expected one occurrence, got {count}: {old[:100]!r}")
        result = result.replace(old, new, 1)
    changes[path] = (source, result)
    bases[path] = hashlib.sha256(source.encode()).hexdigest()

exports = """Formats, PendingPublication, PendingRead, PublicationToken, ReceivedFormats,
    RichClipboardHandle, SelectionToken, current_rich_clipboard"""
edit("desktop/gpui/vendor/gpui-pre-linux/src/linux/wayland.rs", [
    ("mod clipboard;\n", "mod clipboard;\npub(crate) mod rich_clipboard;\n"),
])
edit("desktop/gpui/vendor/gpui-pre-linux/src/linux.rs", [
    ("pub use dispatcher::*;\n", f"pub use dispatcher::*;\n#[cfg(feature = \"wayland\")]\npub use wayland::rich_clipboard::{{\n    {exports},\n}};\n"),
])
edit("desktop/gpui/vendor/gpui-pre-linux/src/gpui_linux.rs", [
    ("pub use linux::current_platform;\n", f"pub use linux::current_platform;\n#[cfg(feature = \"wayland\")]\npub use linux::{{\n    {exports},\n}};\n"),
])

channel_setup = """        let (rich_clipboard, rich_requests) = RichClipboard::new(conn.clone());
        handle.insert_source(rich_requests, |event, _, this: &mut WaylandClientStatePtr| {
            if let calloop::channel::Event::Msg(request) = event {
                let client = this.get_client();
                let mut state = client.borrow_mut();
                let manager = state.globals.data_device_manager.clone();
                let device = state.data_device.clone();
                let queue = state.globals.qh.clone();
                let serial = state.rich_clipboard.input_serial();
                let focused = state.keyboard_focused_window.is_some();
                let self_mime = state.clipboard.self_mime();
                let context = SelectionContext {
                    manager: manager.as_ref(), device: device.as_ref(), queue: &queue,
                    serial, focused, self_mime: &self_mime,
                };
                if let Some(formats) = state.rich_clipboard.dispatch(request, context, DataSourceKind::RichClipboard) {
                    // Preserve GPUI's self-MIME/internal metadata path only
                    // after the real application's publication request succeeds.
                    let item = match formats.native_metadata.as_ref() {
                        Some(metadata) => gpui::ClipboardItem::new_string_with_metadata(formats.text.to_string(), metadata.to_string()),
                        None => gpui::ClipboardItem::new_string(formats.text.to_string()),
                    };
                    state.clipboard.set(item);
                }
            }
        }).expect("Wayland rich clipboard channel registration failed");

"""
edit("desktop/gpui/vendor/gpui-pre-linux/src/linux/wayland/client.rs", [
    ("        clipboard::{Clipboard, DataOffer, FILE_LIST_MIME_TYPE, TEXT_MIME_TYPES},\n", "        clipboard::{Clipboard, DataOffer, FILE_LIST_MIME_TYPE, TEXT_MIME_TYPES},\n        rich_clipboard::{RichClipboard, SelectionContext},\n"),
    ("    clipboard: Clipboard,\n", "    clipboard: Clipboard,\n    rich_clipboard: RichClipboard,\n"),
    ("pub(crate) enum DataSourceKind {\n    Clipboard,\n", "pub(crate) enum DataSourceKind {\n    Clipboard,\n    RichClipboard(u64),\n"),
    ("        state.windows.clear();\n", "        state.rich_clipboard.shutdown();\n        state.windows.clear();\n"),
    ("        let state = Rc::new(RefCell::new(WaylandClientState {\n", channel_setup + "        let state = Rc::new(RefCell::new(WaylandClientState {\n"),
    ("            clipboard: Clipboard::new(conn.clone(), handle.clone()),\n", "            clipboard: Clipboard::new(conn.clone(), handle.clone()),\n            rich_clipboard,\n"),
    ("                state.keyboard_focused_window = None;\n", "                state.keyboard_focused_window = None;\n                state.rich_clipboard.focus_lost();\n"),
    ("            wl_keyboard::Event::Enter { surface, .. } => {\n", "            wl_keyboard::Event::Enter { surface, .. } => {\n                state.rich_clipboard.focus_entered();\n"),
    ("                    state.serial_tracker.update(SerialKind::KeyPress, serial);\n", "                    state.serial_tracker.update(SerialKind::KeyPress, serial);\n                    if state.keyboard_focused_window.is_some() { state.rich_clipboard.input_pressed(serial); }\n"),
    ("                    state.serial_tracker.update(SerialKind::MousePress, serial);\n", "                    state.serial_tracker.update(SerialKind::MousePress, serial);\n                    if state.keyboard_focused_window.as_ref().is_some_and(|keyboard| state.mouse_focused_window.as_ref().is_some_and(|pointer| keyboard.ptr_eq(pointer))) {\n                        state.rich_clipboard.input_pressed(serial);\n                    }\n"),
    ("                    state.mouse_focused_window = None;\n", "                    state.mouse_focused_window = None;\n                    if state.keyboard_focused_window.is_none() { state.rich_clipboard.focus_lost(); }\n"),
    ("                state.data_offers.push(DataOffer::new(data_offer));\n", "                state.rich_clipboard.announce(data_offer.clone());\n                state.data_offers.push(DataOffer::new(data_offer));\n"),
    ("                    state.data_offers.remove(0).inner.destroy();\n", "                    let old = state.data_offers.remove(0);\n                    state.rich_clipboard.offer_destroyed(&old.inner.id());\n                    old.inner.destroy();\n"),
    ("            wl_data_device::Event::Selection { id: data_offer } => {\n", "            wl_data_device::Event::Selection { id: data_offer } => {\n                state.rich_clipboard.selected(data_offer.as_ref());\n"),
    ("        if let wl_data_offer::Event::Offer { mime_type } = event {\n", "        if let wl_data_offer::Event::Offer { mime_type } = event {\n            state.rich_clipboard.mime(data_offer, &mime_type);\n"),
    ("        match (kind, event) {\n", """        match (kind, event) {
            (DataSourceKind::RichClipboard(generation), wl_data_source::Event::Send { mime_type, fd }) => {
                state.rich_clipboard.send(data_source, *generation, &mime_type, fd).log_err();
            }
            (DataSourceKind::RichClipboard(generation), wl_data_source::Event::Cancelled) => {
                state.rich_clipboard.cancelled(data_source, *generation);
            }
"""),
])

edit("desktop/gpui/Cargo.toml", [
    ('"dep:x11rb", "native-typst"]', '"dep:x11rb", "dep:gpui-linux", "native-typst"]'),
    ('x11rb = { version = "=0.13.2", optional = true }\n', 'x11rb = { version = "=0.13.2", optional = true }\ngpui-linux = { package = "gpui-pre-linux", version = "=0.3.7", default-features = false, features = ["wayland"], optional = true }\n'),
    ('[profile.dev]\n', '[[example]]\nname = "twyne-wayland-clipboard-probe"\npath = "fixtures/wayland-clipboard/native-probe.rs"\nrequired-features = ["desktop"]\n\n[profile.dev]\n'),
])
edit("desktop/gpui/src/editor/mod.rs", [
    ("pub mod clipboard_x11;\n", "pub mod clipboard_x11;\n#[cfg(all(feature = \"desktop\", target_os = \"linux\"))]\npub mod clipboard_wayland;\n"),
])
edit("desktop/gpui/src/editor/view.rs", [
    ("    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {\n", """    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(target_os = "linux")]
        if self.external_clipboard.as_ref().is_some_and(|external| external.transport.is_wayland()) {
            self.cut_wayland(window, cx);
            return;
        }
"""),
])

view_path = "desktop/gpui/src/editor/view_clipboard.rs"
view_original = (root / view_path).read_text()
if "struct ExternalClipboard" not in view_original or "owner_window_is_current" not in view_original:
    raise SystemExit("External clipboard source contract changed")
view_new = r'''//! Opt-in native rich clipboard. X11 retains its existing dedicated transport;
//! Wayland uses the application's actual connection and input serial lifecycle.

use super::*;
use crate::editor::{clipboard_wayland as wayland, clipboard_x11 as x11};
use x11::{ClipboardPaste, X11Clipboard};

pub type ClipboardPreflight = Arc<dyn Fn(&RichDocument) -> Result<(), String> + Send + Sync>;

#[derive(Clone)]
pub(super) enum ExternalTransport {
    X11(Arc<X11Clipboard>),
    Wayland(Arc<wayland::WaylandClipboard>),
}
#[derive(Clone, Copy)]
enum Owner {
    X11(x11::SelectionOwner),
    Wayland(gpui_linux::SelectionToken),
}
enum Snapshot {
    X11(x11::ClipboardSnapshot),
    Wayland(wayland::ClipboardSnapshot),
}
enum Publication {
    X11(x11::ClipboardPublication),
    Wayland(wayland::ClipboardPublication),
}
enum PublicationReceipt {
    X11,
    Wayland(gpui_linux::PublicationToken),
}
impl Publication {
    fn wait(self) -> anyhow::Result<PublicationReceipt> {
        match self {
            Self::X11(publication) => publication.wait().map(|_| PublicationReceipt::X11),
            Self::Wayland(publication) => publication.wait().map(PublicationReceipt::Wayland),
        }
    }
}
impl Snapshot {
    fn text(&self) -> &str {
        match self { Self::X11(snapshot) => &snapshot.text, Self::Wayland(snapshot) => &snapshot.text }
    }
    fn owner(&self) -> Owner {
        match self { Self::X11(snapshot) => Owner::X11(snapshot.owner), Self::Wayland(snapshot) => Owner::Wayland(snapshot.selection) }
    }
    fn paste(&self) -> Result<ClipboardPaste, EditorError> {
        match self {
            Self::X11(snapshot) => snapshot.paste(),
            Self::Wayland(snapshot) => snapshot.paste().map(|paste| match paste {
                wayland::ClipboardPaste::Rich(fragment) => ClipboardPaste::Rich(fragment),
                wayland::ClipboardPaste::Plain(text) => ClipboardPaste::Plain(text),
                wayland::ClipboardPaste::Empty => ClipboardPaste::Empty,
            }),
        }
    }
}
impl ExternalTransport {
    pub(super) fn is_wayland(&self) -> bool { matches!(self, Self::Wayland(_)) }
    fn cancel_reads(&self) {
        if let Self::Wayland(transport) = self { transport.cancel_reads(); }
    }
    fn publication_current(&self, receipt: PublicationReceipt) -> bool {
        match (self, receipt) {
            (Self::X11(_), PublicationReceipt::X11) => true,
            (Self::Wayland(transport), PublicationReceipt::Wayland(token)) => transport.is_publication_current(token),
            _ => false,
        }
    }
    fn begin_publish(&self, fragment: &RichFragment) -> anyhow::Result<Publication> {
        match self {
            Self::X11(transport) => x11::ClipboardOffer::rich(fragment).and_then(|offer| transport.begin_publish(offer)).map(Publication::X11),
            Self::Wayland(transport) => wayland::ClipboardOffer::rich(fragment).and_then(|offer| transport.begin_publish(offer)).map(Publication::Wayland),
        }
    }
    fn read(&self) -> anyhow::Result<Option<Snapshot>> {
        match self {
            Self::X11(transport) => transport.read().map(|snapshot| snapshot.map(Snapshot::X11)),
            Self::Wayland(transport) => transport.read().map(|snapshot| snapshot.map(Snapshot::Wayland)),
        }
    }
    fn is_current(&self, owner: Owner) -> anyhow::Result<bool> {
        match (self, owner) {
            (Self::X11(transport), Owner::X11(owner)) => transport.is_current(owner),
            (Self::Wayland(transport), Owner::Wayland(owner)) => Ok(transport.is_current(owner)),
            _ => Ok(false),
        }
    }
    fn owner_window_is_current(&self, owner: Owner) -> anyhow::Result<bool> {
        match (self, owner) {
            (Self::X11(transport), Owner::X11(owner)) => transport.owner_window_is_current(owner),
            (Self::Wayland(transport), Owner::Wayland(owner)) => Ok(transport.is_current(owner)),
            _ => Ok(false),
        }
    }
}
#[derive(Clone)]
pub(super) struct ExternalClipboard {
    pub(super) transport: ExternalTransport,
    preflight: ClipboardPreflight,
}

impl RichEditorView {
    /// Existing API and X11 behavior retained. The original candidate converter
    /// still runs in the background before one atomic paste command.
    pub fn set_external_clipboard(&mut self, transport: Arc<X11Clipboard>, preflight: ClipboardPreflight, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        self.external_clipboard = Some(ExternalClipboard { transport: ExternalTransport::X11(transport), preflight });
        cx.notify();
    }
    pub fn set_wayland_clipboard(&mut self, transport: Arc<wayland::WaylandClipboard>, preflight: ClipboardPreflight, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        self.external_clipboard = Some(ExternalClipboard { transport: ExternalTransport::Wayland(transport), preflight });
        cx.notify();
    }
    pub(super) fn cancel_external_paste(&mut self) {
        if let Some(external) = &self.external_clipboard { external.transport.cancel_reads(); }
        self.clipboard_generation = self.clipboard_generation.wrapping_add(1);
        self.clipboard_task = None;
    }
    pub(super) fn publish_clipboard(&mut self, item: ClipboardItem, fragment: RichFragment, window: &mut Window, cx: &mut Context<Self>) {
        let Some(external) = self.external_clipboard.clone() else {
            cx.write_to_clipboard(item);
            return;
        };
        // Wayland must publish one source with all real MIME types, not first
        // replace selection with GPUI's competing plain-only data source.
        if !external.transport.is_wayland() { cx.write_to_clipboard(item); }
        let publication = match external.transport.begin_publish(&fragment) {
            Ok(publication) => publication,
            Err(error) => { self.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx); return; }
        };
        self.clipboard_publication = self.clipboard_publication.wrapping_add(1);
        let generation = self.clipboard_publication;
        cx.spawn_in(window, async move |this, cx| {
            let result = cx.background_executor().spawn(async move { publication.wait() }).await;
            if let Err(error) = result {
                let _ = this.update_in(cx, |this, _, cx| {
                    if this.clipboard_publication == generation { this.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx); }
                });
            }
        }).detach();
    }
    /// On Wayland only, don't delete the live selection before a valid serial
    /// publication request succeeds. A stale result never changes text/history.
    pub(super) fn cut_wayland(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        if self.is_read_only() { self.clipboard_error(EditorError::ReadOnly, cx); return; }
        if !self.focus.is_focused(window) || self.selection().is_empty() { return; }
        let Some(external) = self.external_clipboard.clone() else { return; };
        let fragment = match self.clipboard_item() {
            Ok((_, fragment)) => fragment,
            Err(error) => { self.clipboard_error(error, cx); return; }
        };
        let publication = match external.transport.begin_publish(&fragment) {
            Ok(publication) => publication,
            Err(error) => { self.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx); return; }
        };
        self.clipboard_publication = self.clipboard_publication.wrapping_add(1);
        let publication_generation = self.clipboard_publication;
        let generation = self.clipboard_generation;
        let revision = self.revision();
        let selection = self.selection();
        self.clipboard_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = cx.background_executor().spawn(async move { publication.wait() }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.clipboard_generation != generation || this.clipboard_publication != publication_generation
                    || this.revision() != revision || this.selection() != selection || this.is_read_only()
                    || !this.focus.is_focused(window) { return; }
                this.clipboard_task = None;
                match result {
                    Ok(receipt) => {
                        if !external.transport.publication_current(receipt) { return; }
                        this.close_typing_group();
                        if this.marked_range.take().is_some() { this.editor.end_history_group(); }
                        this.dispatch(Command::ReplaceSelection(String::new()), window, cx);
                    }
                    Err(error) => this.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx),
                }
            });
        }));
    }
    pub(super) fn paste_external(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        if self.is_read_only() { self.clipboard_error(EditorError::ReadOnly, cx); return; }
        if !self.focus.is_focused(window) { return; }
        let Some(external) = self.external_clipboard.clone() else { return; };
        let revision = self.revision();
        let selection = self.selection();
        let generation = self.clipboard_generation;
        let editor = self.editor.clone();
        self.clipboard_task = Some(cx.spawn_in(window, async move |this, cx| {
            let transport = external.transport.clone();
            let preflight = external.preflight.clone();
            let result = cx.background_executor().spawn(async move {
                let Some(snapshot) = transport.read().map_err(|error| EditorError::Clipboard(format!("{error:#}")))? else { return Ok(None); };
                let Some(command) = prepare(&editor, &snapshot, &preflight)? else { return Ok(None); };
                let owner = snapshot.owner();
                if !transport.is_current(owner).map_err(|error| EditorError::Clipboard(format!("{error:#}")))? {
                    return Err(EditorError::Clipboard("The clipboard changed before paste; paste again".into()));
                }
                Ok(Some((owner, command)))
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.clipboard_generation != generation || this.revision() != revision || this.selection() != selection
                    || this.is_read_only() || !this.focus.is_focused(window) { return; }
                this.clipboard_task = None;
                match result {
                    Ok(Some((owner, command))) => match external.transport.owner_window_is_current(owner) {
                        Ok(true) => this.dispatch(command, window, cx),
                        Ok(false) => this.clipboard_error(EditorError::Clipboard("The clipboard changed before paste; paste again".into()), cx),
                        Err(error) => this.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx),
                    },
                    Ok(None) => {},
                    Err(error) => this.clipboard_error(error, cx),
                }
                this.close_typing_group();
            });
        }));
    }
}

fn prepare(editor: &RichEditor, snapshot: &Snapshot, preflight: &ClipboardPreflight) -> Result<Option<Command>, EditorError> {
    let in_code = editor.document().block_at_offset(editor.selection().head).is_some_and(|block| block.kind == NodeKind::CodeBlock);
    let paste = if in_code && !snapshot.text().is_empty() { ClipboardPaste::Plain(snapshot.text().to_owned()) } else { snapshot.paste()? };
    let command = match paste {
        ClipboardPaste::Rich(fragment) => Command::PasteFragment(fragment),
        ClipboardPaste::Plain(text) => { let text = normalize_text(&text, in_code); if text.is_empty() { return Ok(None); } Command::ReplaceSelection(text) },
        ClipboardPaste::Empty => return Ok(None),
    };
    let mut candidate = editor.clone();
    candidate.end_history_group();
    candidate.execute(command.clone())?;
    candidate.document().validate_html_limits()?;
    preflight(candidate.document()).map_err(EditorError::Clipboard)?;
    Ok(Some(command))
}
fn normalize_text(text: &str, in_code: bool) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    if in_code { return text; }
    let mut result = String::with_capacity(text.len());
    let mut newline = false;
    for character in text.chars() { if character != '\n' || !newline { result.push(character); } newline = character == '\n'; }
    result
}
'''
changes[view_path] = (view_original, view_new)
bases[view_path] = hashlib.sha256(view_original.encode()).hexdigest()

coordinator = "desktop/gpui/src/app/clipboard_coordinator.rs"
edit(coordinator, [
    ("use twyne_desktop::editor::{clipboard_x11::X11Clipboard, view::ClipboardPreflight};\n", "use twyne_desktop::editor::{clipboard_wayland::WaylandClipboard, clipboard_x11::X11Clipboard, view::ClipboardPreflight};\n\n#[derive(Clone)]\nenum ClipboardTransport { X11(Arc<X11Clipboard>), Wayland(Arc<WaylandClipboard>) }\n"),
    ("    transport: Option<Arc<X11Clipboard>>,\n", "    transport: Option<ClipboardTransport>,\n"),
    ("Ok(transport) => (Some(Arc::new(transport)), None),", "Ok(transport) => (Some(ClipboardTransport::X11(Arc::new(transport))), None),"),
    ("        } else {\n            (None, None)\n", "        } else if cx.compositor_name() == \"Wayland\" {\n            match WaylandClipboard::current() {\n                Ok(transport) => (Some(ClipboardTransport::Wayland(Arc::new(transport))), None),\n                Err(error) => (None, Some(format!(\"Rich Wayland clipboard could not be opened: {error:#}\"))),\n            }\n        } else {\n            (None, None)\n"),
    ("            editor.set_external_clipboard(transport, preflight, cx)\n", "            match transport {\n                ClipboardTransport::X11(transport) => editor.set_external_clipboard(transport, preflight, cx),\n                ClipboardTransport::Wayland(transport) => editor.set_wayland_clipboard(transport, preflight, cx),\n            }\n"),
])

patch = []
for path, (source, result) in changes.items():
    patch.extend(difflib.unified_diff(source.splitlines(True), result.splitlines(True), fromfile="a/"+path, tofile="b/"+path))
(fixture / "integration.patch").write_text("".join(patch))
(fixture / "integration-bases.json").write_text(json.dumps(bases, indent=2) + "\n")
print(f"Wrote unapplied integration.patch for {len(changes)} frozen files; no runtime file was changed.")
