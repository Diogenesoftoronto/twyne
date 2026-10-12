//! Debounced real renderer requests. Retired forms cannot adopt late images.
use super::*;
use crate::inline_proof::{AtomKind, AtomRenderImage, AtomRenderRequest, InlineProofRenderer};
use gpui_kit::{AnyElement, Task, img};
use std::{sync::Arc, time::Duration};

#[derive(Default)]
pub(super) struct PreviewState {
    pub generation: u64,
    pub task: Option<Task<()>>,
    renderer: Option<InlineProofRenderer>,
    state: Preview,
}
#[derive(Default)]
enum Preview {
    #[default]
    Empty,
    Busy,
    Image(AtomRenderImage),
    Error(String),
}

impl InsertFormView {
    pub(super) fn schedule_preview(&mut self, window: &Window, cx: &mut Context<Self>) {
        if self.kind != FormKind::Mermaid || self.retired {
            return;
        }
        self.preview.generation = self.preview.generation.saturating_add(1);
        self.preview.task = None;
        let source: Arc<str> = self.primary.read(cx).value().as_str().into();
        if source.trim().is_empty() {
            self.preview.state = Preview::Empty;
            return;
        }
        let generation = self.preview.generation;
        let p = *palette(cx);
        let width = (f32::from(window.viewport_size().width) - 32.).min(896.);
        let width = if width >= 736. {
            (width - 58.) / 2. - 34.
        } else {
            width - 76.
        };
        let request = AtomRenderRequest {
            kind: AtomKind::Mermaid,
            source: source.clone(),
            font_size_px: 16.,
            color: p.ink,
            width_px: width.max(1.),
            generation,
        };
        let existing = self.preview.renderer.clone();
        self.preview.state = Preview::Busy;
        self.preview.task = Some(cx.spawn(async move |view, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(400))
                .await;
            let result = cx
                .background_executor()
                .spawn(async move {
                    let renderer = existing
                        .map(Ok)
                        .unwrap_or_else(InlineProofRenderer::discover);
                    match renderer {
                        Ok(renderer) => {
                            let result = renderer.render(request);
                            (Some(renderer), result.result)
                        }
                        Err(error) => (
                            None,
                            Err(crate::inline_proof::AtomRenderError::new(
                                crate::inline_proof::AtomErrorKind::RendererUnavailable,
                                error.to_string(),
                            )),
                        ),
                    }
                })
                .await;
            let _ = view.update(cx, |view, cx| {
                if view.retired
                    || view.preview.generation != generation
                    || view.primary.read(cx).value().as_str() != source.as_ref()
                {
                    return;
                }
                view.preview.renderer = result.0;
                view.preview.state = match result.1 {
                    Ok(image) => Preview::Image(image),
                    Err(error) => Preview::Error(error.message),
                };
                view.preview.task = None;
                cx.notify();
            });
        }));
    }
    pub(super) fn preview_element(&self, cx: &Context<Self>) -> AnyElement {
        let p = *palette(cx);
        let content = match &self.preview.state {
            Preview::Image(image) => img(image.image.clone())
                .w(px(image.width_px))
                .h(px(image.height_px))
                .max_w_full()
                .into_any_element(),
            Preview::Empty | Preview::Busy | Preview::Error(_) => {
                let (text, error) = match &self.preview.state {
                    Preview::Empty => (
                        "A live preview of the diagram will appear here as you type.",
                        false,
                    ),
                    Preview::Busy => ("Rendering preview…", false),
                    Preview::Error(message) => (message.as_str(), true),
                    _ => unreachable!(),
                };
                div()
                    .id("slash-diagram-preview-status")
                    .test_support()
                    .role(if error { Role::Alert } else { Role::Status })
                    .font_family(crate::theme::TYPEWRITER_FONT)
                    .text_size(px(11.52))
                    .line_height(px(17.28))
                    .text_color(rgb(if error { p.vermilion } else { p.ink_muted }))
                    .child(text.to_owned())
                    .into_any_element()
            }
        };
        div()
            .id("slash-diagram-preview")
            .test_support()
            .min_h(px(224.))
            .max_h(px(384.))
            .h_full()
            .overflow_y_scroll()
            .px(px(16.))
            .py(px(12.))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .bg(rgb(p.paper))
            .child(content)
            .into_any_element()
    }
}
