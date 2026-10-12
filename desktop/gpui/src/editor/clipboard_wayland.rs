//! Rich clipboard adapter for the actual GPUI-owned Wayland connection.
//! No environment lookup, secondary connection, plain-text-to-HTML synthesis,
//! provider, or document mutation occurs here. Reads/preflight are explicit
//! background paste boundaries; the live view rechecks source/selection/focus.

use std::sync::Arc;

use anyhow::{Result, bail};
use gpui_linux::{
    Formats, PendingPublication, PublicationToken, RichClipboardHandle, SelectionToken,
    current_rich_clipboard,
};

use super::{EditorError, HTML_LIMITS, RichFragment};

pub const NATIVE_MIME: &str = "application/x-twyne-rich-fragment+json";
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ClipboardOffer {
    pub text: Arc<str>,
    pub html: Option<Arc<str>>,
    pub native_metadata: Option<Arc<str>>,
}

impl ClipboardOffer {
    pub fn rich(fragment: &RichFragment) -> Result<Self> {
        let offer = Self {
            text: fragment.plain_text().into(),
            html: Some(fragment.to_external_html()?.into()),
            native_metadata: Some(fragment.to_clipboard_metadata()?.into()),
        };
        offer.validate()?;
        Ok(offer)
    }

    pub fn validate(&self) -> Result<()> {
        let total = self
            .text
            .len()
            .saturating_add(self.html.as_ref().map_or(0, |value| value.len()))
            .saturating_add(self.native_metadata.as_ref().map_or(0, |value| value.len()));
        if total > MAX_BYTES
            || self
                .html
                .as_ref()
                .is_some_and(|value| value.len() > HTML_LIMITS.bytes)
        {
            bail!("The clipboard exceeds the 64 MiB transfer or 32 MiB HTML budget");
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct ClipboardSnapshot {
    pub selection: SelectionToken,
    pub text: String,
    pub html: Option<String>,
    pub native_metadata: Option<String>,
    pub rtf_offered: bool,
}

#[derive(Clone, Debug)]
pub enum ClipboardPaste {
    Rich(RichFragment),
    Plain(String),
    Empty,
}

impl ClipboardSnapshot {
    /// Same priority and bounded semantic import as the X11 path. Recognized
    /// malformed rich data is rejected; unrelated/stale metadata may fall back
    /// to actual offered HTML, then actual offered plain text.
    pub fn paste(&self) -> Result<ClipboardPaste, EditorError> {
        decode_paste(
            &self.text,
            self.html.as_deref(),
            self.native_metadata.as_deref(),
            self.rtf_offered,
        )
    }
}

fn decode_paste(
    text: &str,
    html: Option<&str>,
    metadata: Option<&str>,
    rtf_offered: bool,
) -> Result<ClipboardPaste, EditorError> {
    if let Some(metadata) = metadata
        && let Some(fragment) = RichFragment::from_clipboard_metadata(metadata, text)?
    {
        return Ok(ClipboardPaste::Rich(fragment));
    }
    if let Some(html) = html
        && !html.is_empty()
    {
        return RichFragment::from_external_html(html).map(ClipboardPaste::Rich);
    }
    if !text.is_empty() {
        return Ok(ClipboardPaste::Plain(text.to_owned()));
    }
    if rtf_offered {
        return Err(EditorError::Clipboard(
            "This clipboard offers RTF without HTML or plain text; RTF import is not yet available"
                .into(),
        ));
    }
    Ok(ClipboardPaste::Empty)
}

/// Publication.wait acknowledges the actual connection's flushed request,
/// not global ownership acceptance (core Wayland has no such reply).
pub struct ClipboardPublication(PendingPublication);
impl ClipboardPublication {
    pub fn wait(self) -> Result<PublicationToken> {
        self.0.wait()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::RichDocument;

    #[test]
    fn native_envelope_has_priority_and_preserves_all_atoms_and_marks() {
        let html = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/wayland-clipboard/rich.html"
        ))
        .trim();
        let document = RichDocument::from_html(html).unwrap();
        let fragment = document.copy_fragment(0..document.text_len()).unwrap();
        let offer = ClipboardOffer::rich(&fragment).unwrap();
        let pasted = decode_paste(
            &offer.text,
            Some("<p>foreign alternative</p>"),
            offer.native_metadata.as_deref(),
            false,
        )
        .unwrap();
        let ClipboardPaste::Rich(pasted) = pasted else {
            panic!("Native rich MIME was not preferred");
        };
        assert_eq!(pasted.to_html(), fragment.to_html());
        assert_eq!(pasted.plain_text(), offer.text.as_ref());
        for value in [
            "data-comment-id=\"review\"",
            "data-future-math=\"keep\"",
            "data-endnote-text=\"Authored note\"",
            "data-typst-source=\"#keep[原稿]\"",
            "data-image-src=\"data:image/png;base64,Kept\"",
        ] {
            assert!(pasted.to_html().contains(value), "Missing {value}");
        }
        assert_eq!(
            offer.html.as_deref(),
            Some(fragment.to_external_html().unwrap().as_str())
        );
    }

    #[test]
    fn foreign_html_is_used_before_plain_text() {
        let ClipboardPaste::Rich(fragment) = decode_paste(
            "Actual plain fallback",
            Some("<p><strong>Actual foreign HTML</strong></p>"),
            None,
            false,
        )
        .unwrap() else {
            panic!("Foreign HTML was not preserved");
        };
        assert!(
            fragment
                .to_html()
                .contains("<strong>Actual foreign HTML</strong>")
        );
    }

    #[test]
    fn stale_or_future_metadata_falls_back_to_actual_formats() {
        let document = RichDocument::from_html("<p><em>old</em></p>").unwrap();
        let fragment = document.copy_fragment(0..document.text_len()).unwrap();
        let metadata = fragment.to_clipboard_metadata().unwrap();
        let ClipboardPaste::Rich(paste) = decode_paste(
            "new",
            Some("<p><strong>new</strong></p>"),
            Some(&metadata),
            false,
        )
        .unwrap() else {
            panic!("Actual HTML fallback missing");
        };
        assert!(paste.to_html().contains("<strong>new</strong>"));
        let future = metadata.replace("\"version\":1", "\"version\":2");
        assert!(
            matches!(decode_paste("old", None, Some(&future), false).unwrap(), ClipboardPaste::Plain(text) if text == "old")
        );
    }

    #[test]
    fn recognized_malformed_slice_is_rejected_before_editing() {
        let malformed = r#"{"format":"twyne.rich-fragment","version":1,"html":"<p>block</p>","text":"block","inline":true,"open_start":true,"open_end":true}"#;
        assert!(decode_paste("block", Some("<p>fallback</p>"), Some(malformed), false).is_err());
    }

    #[test]
    fn plain_text_is_never_wrapped_as_html_and_rtf_is_honest() {
        let text = "<b>literal 🦊</b>\r\nline";
        assert!(
            matches!(decode_paste(text, None, None, false).unwrap(), ClipboardPaste::Plain(value) if value == text)
        );
        assert!(matches!(
            decode_paste("", None, None, false).unwrap(),
            ClipboardPaste::Empty
        ));
        assert!(
            decode_paste("", None, None, true)
                .unwrap_err()
                .to_string()
                .contains("RTF")
        );
    }
}

#[derive(Clone)]
pub struct WaylandClipboard {
    handle: RichClipboardHandle,
}

impl WaylandClipboard {
    /// Call on the application's foreground thread after its actual backend
    /// reports Wayland. A headless/X11 context never gains selection ownership.
    pub fn current() -> Result<Self> {
        let handle = current_rich_clipboard().ok_or_else(|| {
            anyhow::anyhow!("The actual GPUI Wayland rich clipboard is unavailable")
        })?;
        Ok(Self { handle })
    }

    pub fn begin_publish(&self, offer: ClipboardOffer) -> Result<ClipboardPublication> {
        offer.validate()?;
        self.handle
            .begin_publish(Formats {
                text: offer.text,
                html: offer.html,
                native_metadata: offer.native_metadata,
            })
            .map(ClipboardPublication)
    }

    /// Run only on the background executor. Every MIME pipe belongs to one
    /// observed offer generation and shares an aggregate absolute budget.
    pub fn read(&self) -> Result<Option<ClipboardSnapshot>> {
        Ok(self
            .handle
            .begin_read()?
            .wait()?
            .map(|received| ClipboardSnapshot {
                selection: received.selection,
                text: received.text.unwrap_or_default(),
                html: received.html,
                native_metadata: received.native_metadata,
                rtf_offered: received.rtf_offered,
            }))
    }

    /// Cheap observed-offer check; the live view also rechecks focus, selection,
    /// read-only state, visit/revision and its own request generation.
    pub fn is_current(&self, selection: SelectionToken) -> bool {
        self.handle.is_current(selection)
    }

    pub fn is_publication_current(&self, publication: PublicationToken) -> bool {
        self.handle.is_publication_current(publication)
    }

    pub fn cancel_reads(&self) {
        self.handle.cancel_reads();
    }
}
