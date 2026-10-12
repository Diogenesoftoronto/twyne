use super::*;
use std::sync::RwLock;
use twyne_desktop::editor::{
    clipboard_wayland::WaylandClipboard, clipboard_x11::X11Clipboard, view::ClipboardPreflight,
};

#[derive(Clone)]
enum ClipboardTransport {
    X11(Arc<X11Clipboard>),
    Wayland(Arc<WaylandClipboard>),
}

pub(super) struct ClipboardState {
    transport: Option<ClipboardTransport>,
    document: Option<Arc<RwLock<Manuscript>>>,
}

impl ClipboardState {
    pub(super) fn open(cx: &App) -> (Self, Option<String>) {
        // An inherited DISPLAY can belong to a different session. Only the
        // actual GPUI backend opts in; tests and other platforms never connect.
        let (transport, warning) = if cx.compositor_name() == "X11" {
            match X11Clipboard::connect(None) {
                Ok(transport) => (Some(ClipboardTransport::X11(Arc::new(transport))), None),
                Err(error) => (
                    None,
                    Some(format!("Rich clipboard could not be opened: {error:#}")),
                ),
            }
        } else if cx.compositor_name() == "Wayland" {
            match WaylandClipboard::current() {
                Ok(transport) => (Some(ClipboardTransport::Wayland(Arc::new(transport))), None),
                Err(error) => (
                    None,
                    Some(format!(
                        "Rich Wayland clipboard could not be opened: {error:#}"
                    )),
                ),
            }
        } else {
            (None, None)
        };
        (
            Self {
                transport,
                document: None,
            },
            warning,
        )
    }
}

impl WritingRoom {
    pub(super) fn install_external_clipboard(
        &mut self,
        editor: &Entity<RichEditorView>,
        cx: &mut Context<Self>,
    ) {
        self.clipboard.document = None;
        let Some(transport) = self.clipboard.transport.clone() else {
            return;
        };
        let document = Arc::new(RwLock::new(self.active_document().clone()));
        self.clipboard.document = Some(document.clone());
        let preflight: ClipboardPreflight = Arc::new(move |candidate| {
            let document = document
                .read()
                .map_err(|_| "The manuscript context could not be read. Paste again.".to_owned())?
                .clone();
            // The original converter enforces its canonical source budget and
            // preserves authored source. This runs before a live paste, undo
            // entry or autosave, on the editor's background executor.
            twyne_desktop::document_edit::apply_html(document, &candidate.to_html())
                .map(|_| ())
                .map_err(|error| format!("The pasted content could not be converted: {error:#}"))
        });
        editor.update(cx, |editor, cx| match transport {
            ClipboardTransport::X11(transport) => {
                editor.set_external_clipboard(transport, preflight, cx)
            }
            ClipboardTransport::Wayland(transport) => {
                editor.set_wayland_clipboard(transport, preflight, cx)
            }
        });
    }

    /// Update only at a save boundary; ordinary typing never clones source.
    pub(super) fn refresh_clipboard_context(&mut self) {
        if let Some(context) = &self.clipboard.document
            && let Ok(mut document) = context.write()
        {
            *document = self.active_document().clone();
        }
    }
}
