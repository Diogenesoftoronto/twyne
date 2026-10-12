//! Opt-in native rich clipboard. X11 retains its existing dedicated transport;
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
        match self {
            Self::X11(snapshot) => &snapshot.text,
            Self::Wayland(snapshot) => &snapshot.text,
        }
    }
    fn owner(&self) -> Owner {
        match self {
            Self::X11(snapshot) => Owner::X11(snapshot.owner),
            Self::Wayland(snapshot) => Owner::Wayland(snapshot.selection),
        }
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
    pub(super) fn is_wayland(&self) -> bool {
        matches!(self, Self::Wayland(_))
    }
    fn cancel_reads(&self) {
        if let Self::Wayland(transport) = self {
            transport.cancel_reads();
        }
    }
    fn publication_current(&self, receipt: PublicationReceipt) -> bool {
        match (self, receipt) {
            (Self::X11(_), PublicationReceipt::X11) => true,
            (Self::Wayland(transport), PublicationReceipt::Wayland(token)) => {
                transport.is_publication_current(token)
            }
            _ => false,
        }
    }
    fn begin_publish(&self, fragment: &RichFragment) -> anyhow::Result<Publication> {
        match self {
            Self::X11(transport) => x11::ClipboardOffer::rich(fragment)
                .and_then(|offer| transport.begin_publish(offer))
                .map(Publication::X11),
            Self::Wayland(transport) => wayland::ClipboardOffer::rich(fragment)
                .and_then(|offer| transport.begin_publish(offer))
                .map(Publication::Wayland),
        }
    }
    fn read(&self) -> anyhow::Result<Option<Snapshot>> {
        match self {
            Self::X11(transport) => transport.read().map(|snapshot| snapshot.map(Snapshot::X11)),
            Self::Wayland(transport) => transport
                .read()
                .map(|snapshot| snapshot.map(Snapshot::Wayland)),
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
    pub fn set_external_clipboard(
        &mut self,
        transport: Arc<X11Clipboard>,
        preflight: ClipboardPreflight,
        cx: &mut Context<Self>,
    ) {
        self.cancel_external_paste();
        self.external_clipboard = Some(ExternalClipboard {
            transport: ExternalTransport::X11(transport),
            preflight,
        });
        cx.notify();
    }
    pub fn set_wayland_clipboard(
        &mut self,
        transport: Arc<wayland::WaylandClipboard>,
        preflight: ClipboardPreflight,
        cx: &mut Context<Self>,
    ) {
        self.cancel_external_paste();
        self.external_clipboard = Some(ExternalClipboard {
            transport: ExternalTransport::Wayland(transport),
            preflight,
        });
        cx.notify();
    }
    pub(super) fn cancel_external_paste(&mut self) {
        if let Some(external) = &self.external_clipboard {
            external.transport.cancel_reads();
        }
        self.clipboard_generation = self.clipboard_generation.wrapping_add(1);
        self.clipboard_task = None;
    }
    pub(super) fn publish_clipboard(
        &mut self,
        item: ClipboardItem,
        fragment: RichFragment,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(external) = self.external_clipboard.clone() else {
            cx.write_to_clipboard(item);
            return;
        };
        // Wayland must publish one source with all real MIME types, not first
        // replace selection with GPUI's competing plain-only data source.
        if !external.transport.is_wayland() {
            cx.write_to_clipboard(item);
        }
        let publication = match external.transport.begin_publish(&fragment) {
            Ok(publication) => publication,
            Err(error) => {
                self.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx);
                return;
            }
        };
        self.clipboard_publication = self.clipboard_publication.wrapping_add(1);
        let generation = self.clipboard_publication;
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { publication.wait() })
                .await;
            if let Err(error) = result {
                let _ = this.update_in(cx, |this, _, cx| {
                    if this.clipboard_publication == generation {
                        this.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx);
                    }
                });
            }
        })
        .detach();
    }
    /// On Wayland only, don't delete the live selection before a valid serial
    /// publication request succeeds. A stale result never changes text/history.
    pub(super) fn cut_wayland(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        if self.is_read_only() {
            self.clipboard_error(EditorError::ReadOnly, cx);
            return;
        }
        if !self.focus.is_focused(window) || self.selection().is_empty() {
            return;
        }
        let Some(external) = self.external_clipboard.clone() else {
            return;
        };
        let fragment = match self.clipboard_item() {
            Ok((_, fragment)) => fragment,
            Err(error) => {
                self.clipboard_error(error, cx);
                return;
            }
        };
        let publication = match external.transport.begin_publish(&fragment) {
            Ok(publication) => publication,
            Err(error) => {
                self.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx);
                return;
            }
        };
        self.clipboard_publication = self.clipboard_publication.wrapping_add(1);
        let publication_generation = self.clipboard_publication;
        let generation = self.clipboard_generation;
        let revision = self.revision();
        let selection = self.selection();
        self.clipboard_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { publication.wait() })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.clipboard_generation != generation
                    || this.clipboard_publication != publication_generation
                    || this.revision() != revision
                    || this.selection() != selection
                    || this.is_read_only()
                    || !this.focus.is_focused(window)
                {
                    return;
                }
                this.clipboard_task = None;
                match result {
                    Ok(receipt) => {
                        if !external.transport.publication_current(receipt) {
                            return;
                        }
                        this.close_typing_group();
                        if this.marked_range.take().is_some() {
                            this.editor.end_history_group();
                        }
                        this.dispatch(Command::ReplaceSelection(String::new()), window, cx);
                    }
                    Err(error) => {
                        this.clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx)
                    }
                }
            });
        }));
    }
    pub(super) fn paste_external(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.cancel_external_paste();
        if self.is_read_only() {
            self.clipboard_error(EditorError::ReadOnly, cx);
            return;
        }
        if !self.focus.is_focused(window) {
            return;
        }
        let Some(external) = self.external_clipboard.clone() else {
            return;
        };
        let revision = self.revision();
        let selection = self.selection();
        let generation = self.clipboard_generation;
        let editor = self.editor.clone();
        self.clipboard_task = Some(cx.spawn_in(window, async move |this, cx| {
            let transport = external.transport.clone();
            let preflight = external.preflight.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let Some(snapshot) = transport
                        .read()
                        .map_err(|error| EditorError::Clipboard(format!("{error:#}")))?
                    else {
                        return Ok(None);
                    };
                    let Some(command) = prepare(&editor, &snapshot, &preflight)? else {
                        return Ok(None);
                    };
                    let owner = snapshot.owner();
                    if !transport
                        .is_current(owner)
                        .map_err(|error| EditorError::Clipboard(format!("{error:#}")))?
                    {
                        return Err(EditorError::Clipboard(
                            "The clipboard changed before paste; paste again".into(),
                        ));
                    }
                    Ok(Some((owner, command)))
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.clipboard_generation != generation
                    || this.revision() != revision
                    || this.selection() != selection
                    || this.is_read_only()
                    || !this.focus.is_focused(window)
                {
                    return;
                }
                this.clipboard_task = None;
                match result {
                    Ok(Some((owner, command))) => {
                        match external.transport.owner_window_is_current(owner) {
                            Ok(true) => this.dispatch(command, window, cx),
                            Ok(false) => this.clipboard_error(
                                EditorError::Clipboard(
                                    "The clipboard changed before paste; paste again".into(),
                                ),
                                cx,
                            ),
                            Err(error) => this
                                .clipboard_error(EditorError::Clipboard(format!("{error:#}")), cx),
                        }
                    }
                    Ok(None) => {}
                    Err(error) => this.clipboard_error(error, cx),
                }
                this.close_typing_group();
            });
        }));
    }
}

fn prepare(
    editor: &RichEditor,
    snapshot: &Snapshot,
    preflight: &ClipboardPreflight,
) -> Result<Option<Command>, EditorError> {
    let in_code = editor
        .document()
        .block_at_offset(editor.selection().head)
        .is_some_and(|block| block.kind == NodeKind::CodeBlock);
    let paste = if in_code && !snapshot.text().is_empty() {
        ClipboardPaste::Plain(snapshot.text().to_owned())
    } else {
        snapshot.paste()?
    };
    let command = match paste {
        ClipboardPaste::Rich(fragment) => Command::PasteFragment(fragment),
        ClipboardPaste::Plain(text) => {
            let text = normalize_text(&text, in_code);
            if text.is_empty() {
                return Ok(None);
            }
            Command::ReplaceSelection(text)
        }
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
    if in_code {
        return text;
    }
    let mut result = String::with_capacity(text.len());
    let mut newline = false;
    for character in text.chars() {
        if character != '\n' || !newline {
            result.push(character);
        }
        newline = character == '\n';
    }
    result
}
