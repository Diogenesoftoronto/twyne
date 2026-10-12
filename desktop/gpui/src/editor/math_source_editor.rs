//! Unmounted, source-preserving native math-source form.
//!
//! This view owns a retained textarea and qualified requests. It does not own
//! a manuscript, renderer, canonical conversion, or persistence acknowledgment.
//! A host must guard the owner and original node before applying a submission's
//! real `UpdateMathSource` command, then acknowledge that same submission.
use super::{Command, MathDisplay, Node, NodeData, NodeKind, NodePath};
use gpui_kit::base::{
    Button,
    input::{Enter, Escape, InputEvent, RopeExt, TextareaState},
};
use gpui_kit::component::{Sizable, input::Textarea};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, BoxShadow, Context, Entity, EntityId, EventEmitter, FocusHandle, Focusable,
    FontWeight, Image, IntoElement, KeyBinding, MouseButton, Render, Role, SharedString,
    Subscription, Task, TestSupportExt, Window, div, img, px, relative, rgb,
};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

pub const PREVIEW_DEBOUNCE: Duration = Duration::from_millis(300);
pub const PREVIEW_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_PREVIEW_SOURCE_BYTES: usize = 512 * 1024;
const MAX_PREVIEW_MESSAGE_BYTES: usize = 8192;
pub const PREVIEW_PLACEHOLDER: &str = "A live preview of the equation appears here.";
pub const PREVIEW_UNAVAILABLE: &str =
    "Preview unavailable. You can still edit the equation source.";

gpui_kit::actions!(
    twyne_math_source,
    [
        DismissMathSource,
        MathSourceSecondaryEnter,
        MathSourceAltEnter,
        MathSourceModifiedShiftEnter
    ]
);

/// Register after GPUI Kit initializes its ordinary input bindings.
pub fn init(cx: &mut App) {
    // Match the browser field's redo chord. Kit's Linux/Windows default uses
    // Ctrl+Y; an ancestor rich-editor Ctrl+Shift+Z must not own this field.
    #[cfg(not(target_os = "macos"))]
    cx.bind_keys([KeyBinding::new(
        "ctrl-shift-z",
        gpui_kit::base::input::Redo,
        Some("TwyneMathSourceForm > Input"),
    )]);
    cx.bind_keys([KeyBinding::new(
        "escape",
        DismissMathSource,
        Some("TwyneMathSourceForm"),
    )]);
    // Keep ordinary Enter/Shift+Enter on Kit's retained textarea path. Source
    // explicitly submits unshifted Ctrl/Meta combinations, or any unshifted
    // Enter inline. Chrome leaves other modified Enter combinations unchanged;
    // routing them through Kit's ordinary Enter would insert an unwanted LF.
    for prefix in [
        "alt-",
        "ctrl-",
        "cmd-",
        "ctrl-alt-",
        "cmd-alt-",
        "ctrl-cmd-",
        "ctrl-cmd-alt-",
    ] {
        let secondary = prefix.contains("ctrl") || prefix.contains("cmd");
        for shift in [false, true] {
            let key = format!("{prefix}{}enter", if shift { "shift-" } else { "" });
            // The form and its textarea occupy distinct dispatch contexts.
            let context = Some("TwyneMathSourceForm > Input");
            let binding = if shift {
                KeyBinding::new(&key, MathSourceModifiedShiftEnter, context)
            } else if secondary {
                KeyBinding::new(&key, MathSourceSecondaryEnter, context)
            } else {
                KeyBinding::new(&key, MathSourceAltEnter, context)
            };
            cx.bind_keys([binding]);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MathSourceOwner {
    pub editor: EntityId,
    /// Exact folio scope, never an alias inferred from a row or current route.
    pub folio: Arc<str>,
    /// Host visit/document generation; entity identity alone is insufficient.
    pub generation: u64,
}

#[derive(Clone, Debug)]
pub struct MathSourceTarget {
    pub owner: MathSourceOwner,
    /// Exact rich-document revision captured at opening, independently of the
    /// host's visit generation. A host must reject a changed document before
    /// using the captured scalar position or adopting a prepared candidate.
    pub revision: u64,
    pub path: NodePath,
    pub position: usize,
    pub expected: Node,
    pub display: MathDisplay,
    pub raw_source: Arc<str>,
}

impl MathSourceTarget {
    pub fn new(
        owner: MathSourceOwner,
        revision: u64,
        path: NodePath,
        position: usize,
        expected: Node,
    ) -> Option<Self> {
        let element = expected.as_element()?;
        let NodeKind::Math(display) = element.kind else {
            return None;
        };
        if path.is_empty() || owner.folio.is_empty() {
            return None;
        }
        let raw_source = element
            .shell
            .attr("data-latex")
            .map(Arc::from)
            .unwrap_or_else(|| {
                fn text(node: &Node, output: &mut String) {
                    match node.data() {
                        NodeData::Text(value) => output.push_str(value),
                        NodeData::Element(element) => {
                            for child in &element.children {
                                text(child, output);
                            }
                        }
                        NodeData::Comment(_) => {}
                    }
                }
                let mut source = String::new();
                for child in &element.children {
                    text(child, &mut source);
                }
                Arc::from(source)
            });
        Some(Self {
            owner,
            revision,
            path,
            position,
            expected,
            display,
            raw_source,
        })
    }
    pub fn label(&self) -> &'static str {
        if self.display == MathDisplay::Block {
            "Block LaTeX source"
        } else {
            "Inline LaTeX source"
        }
    }
    pub fn rows(&self) -> usize {
        if self.display == MathDisplay::Block {
            3
        } else {
            2
        }
    }
    /// Source line height, padding and borders, before native pixel snapping.
    pub fn textarea_height(&self) -> f32 {
        self.rows() as f32 * 19.6 + 18.
    }
    fn same_target(&self, other: &Self) -> bool {
        self.owner == other.owner
            && self.revision == other.revision
            && self.path == other.path
            && self.position == other.position
            && self.display == other.display
            && self.expected.shares_storage_with(&other.expected)
            && self.raw_source == other.raw_source
    }
}

#[derive(Clone, Debug)]
pub struct MathSourceSubmission {
    pub target: Arc<MathSourceTarget>,
    pub form_id: Uuid,
    pub generation: u64,
    pub request_id: Uuid,
    pub source: Arc<str>,
}
impl MathSourceSubmission {
    pub fn command(&self) -> Command {
        Command::UpdateMathSource {
            path: self.target.path.clone(),
            expected: self.target.expected.clone(),
            source: self.source.to_string(),
        }
    }
    fn matches(&self, other: &Self) -> bool {
        self.form_id == other.form_id
            && self.generation == other.generation
            && self.request_id == other.request_id
            && self.source == other.source
            && self.target.same_target(&other.target)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathSourceCancelReason {
    Escape,
    CancelButton,
}

#[derive(Clone, Debug)]
pub struct MathSourceCancellation {
    pub target: Arc<MathSourceTarget>,
    pub form_id: Uuid,
    pub generation: u64,
    pub reason: MathSourceCancelReason,
}
// Cancellation requests Source's node-selection focus only if that original
// target still exists. Otherwise the host focuses the original editor, without
// selecting a replacement atom that happens to occupy the same path.

#[derive(Clone, Debug)]
pub struct MathPreviewRequest {
    pub target: Arc<MathSourceTarget>,
    pub form_id: Uuid,
    pub generation: u64,
    pub request_id: Uuid,
    pub source: Arc<str>,
    pub font_size_px: f32,
    pub color: u32,
}
impl MathPreviewRequest {
    fn matches(&self, other: &Self) -> bool {
        self.form_id == other.form_id
            && self.generation == other.generation
            && self.request_id == other.request_id
            && self.source == other.source
            && self.font_size_px == other.font_size_px
            && self.color == other.color
            && self.target.same_target(&other.target)
    }
}

#[derive(Clone)]
pub enum MathPreviewOutcome {
    /// Injected diagnostic paint, never a certificate of Source math geometry.
    Rendered {
        image: Arc<Image>,
        width_px: f32,
        height_px: f32,
        provenance: Arc<str>,
    },
    InvalidLatex {
        message: Arc<str>,
    },
    Unavailable {
        message: Arc<str>,
    },
}

#[derive(Clone, Debug)]
pub enum MathPreviewAvailability {
    Unavailable(Arc<str>),
    Injected,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathPreviewStatus {
    Blank,
    Pending,
    RenderedDiagnostic,
    InvalidLatex,
    Unavailable,
    Retired,
}

#[derive(Clone, Debug)]
pub enum MathSourceEditorEvent {
    SubmitRequested(MathSourceSubmission),
    SubmissionCancelled(MathSourceSubmission),
    Cancelled(MathSourceCancellation),
    PreviewRequested(MathPreviewRequest),
    PreviewCancelled(MathPreviewRequest),
}

/// Canvas is a platform system color in Source. The host supplies its actual
/// native counterpart; defaults describe a light Canvas, not the paper theme.
#[derive(Clone)]
pub struct MathSourcePresentation {
    pub canvas: u32,
    pub canvas_text: u32,
    pub inherited_font_family: SharedString,
    pub inherited_font_size_px: f32,
    pub inherited_line_height: f32,
    pub preview: MathPreviewAvailability,
}
impl Default for MathSourcePresentation {
    fn default() -> Self {
        Self {
            canvas: 0xffffff,
            canvas_text: 0x000000,
            inherited_font_family: crate::theme::SERIF_FONT.into(),
            inherited_font_size_px: 18.,
            inherited_line_height: 1.8,
            preview: MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
        }
    }
}

enum PreviewContent {
    Empty,
    Hint,
    Outcome(MathPreviewOutcome),
}

pub struct MathSourceEditorView {
    target: Arc<MathSourceTarget>,
    form_id: Uuid,
    generation: u64,
    input: Entity<TextareaState>,
    presentation: MathSourcePresentation,
    retired: bool,
    read_only: bool,
    pending_submission: Option<MathSourceSubmission>,
    submit_error: Option<Arc<str>>,
    preview_generation: u64,
    active_preview: Option<MathPreviewRequest>,
    preview_content: PreviewContent,
    preview_timer: Option<Task<()>>,
    preview_deadline: Option<Task<()>>,
    _input_subscription: Subscription,
}

impl EventEmitter<MathSourceEditorEvent> for MathSourceEditorView {}
impl Focusable for MathSourceEditorView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl MathSourceEditorView {
    pub fn new(
        target: MathSourceTarget,
        presentation: MathSourcePresentation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let target = Arc::new(target);
        let input = cx.new(|cx| {
            TextareaState::new(window, cx)
                .rows(target.rows())
                .submit_on_enter(false)
                .default_value(textarea_value(&target.raw_source))
        });
        let _input_subscription =
            cx.subscribe_in(&input, window, |view, _, event: &InputEvent, _, cx| {
                if matches!(event, InputEvent::Change) && !view.retired {
                    // A final Change can be queued behind the actual submit
                    // click. It must not cancel that same freshly captured value.
                    if view
                        .pending_submission
                        .as_ref()
                        .is_some_and(|pending| !view.matches_input(&pending.source, cx))
                    {
                        view.abandon_submission(cx);
                    }
                    view.submit_error = None;
                    view.cancel_preview(cx);
                    view.schedule_preview(cx);
                }
            });
        // Both callbacks execute after the retained entity can be subscribed
        // to and mounted. They never recreate/reset its input during Render.
        cx.defer_in(window, |view, _, cx| view.request_preview(cx));
        cx.on_next_frame(window, |view, window, cx| {
            if !view.retired {
                view.focus_source_end(window, cx);
            }
        });
        Self {
            target,
            form_id: Uuid::new_v4(),
            generation: 0,
            input,
            presentation,
            retired: false,
            read_only: false,
            pending_submission: None,
            submit_error: None,
            preview_generation: 0,
            active_preview: None,
            preview_content: PreviewContent::Empty,
            preview_timer: None,
            preview_deadline: None,
            _input_subscription,
        }
    }
    pub fn target(&self) -> &MathSourceTarget {
        &self.target
    }
    pub fn form_id(&self) -> Uuid {
        self.form_id
    }
    /// Capture this epoch at opening. A Cancelled event carries that opening
    /// epoch; retire increments the live epoch before delivering the event.
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn input(&self) -> &Entity<TextareaState> {
        &self.input
    }
    pub fn is_retired(&self) -> bool {
        self.retired
    }
    pub fn pending_submission(&self) -> Option<&MathSourceSubmission> {
        self.pending_submission.as_ref()
    }
    /// Explicit boundary only: materializes this field, never the document.
    pub fn raw_source(&self, cx: &App) -> Arc<str> {
        Arc::from(self.input.read(cx).value().as_ref())
    }
    pub fn focus_source_end(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        self.input.update(cx, |input, cx| {
            let end = input.text().offset_to_position(input.text().len());
            input.set_cursor_position(end, window, cx);
        });
    }
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if self.read_only == read_only {
            return;
        }
        self.read_only = read_only;
        self.input
            .update(cx, |input, cx| input.set_readonly(read_only, cx));
        if read_only {
            self.abandon_submission(cx);
        }
        cx.notify();
    }
    /// Reads final unblurred input, including whitespace and invalid LaTeX.
    pub fn submit(&mut self, cx: &mut Context<Self>) -> Option<MathSourceSubmission> {
        if self.retired || self.read_only {
            return None;
        }
        if let Some(pending) = self.pending_submission.clone() {
            if self.matches_input(&pending.source, cx) {
                return None;
            }
            self.abandon_submission(cx);
        }
        let request = MathSourceSubmission {
            target: self.target.clone(),
            form_id: self.form_id,
            generation: self.generation,
            request_id: Uuid::new_v4(),
            source: self.raw_source(cx),
        };
        self.submit_error = None;
        self.pending_submission = Some(request.clone());
        cx.emit(MathSourceEditorEvent::SubmitRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn accepts_submission(&self, request: &MathSourceSubmission, cx: &App) -> bool {
        !self.retired
            && !self.read_only
            && self
                .pending_submission
                .as_ref()
                .is_some_and(|pending| pending.matches(request))
            && self.matches_input(&request.source, cx)
    }
    /// Call only after the host's exact candidate was accepted. This method
    /// does not certify a durable save or apply anything to the manuscript.
    pub fn acknowledge_submission(
        &mut self,
        request: &MathSourceSubmission,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts_submission(request, cx) {
            return false;
        }
        self.pending_submission = None;
        self.retire(cx);
        true
    }
    pub fn reject_submission(
        &mut self,
        request: &MathSourceSubmission,
        message: impl Into<Arc<str>>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts_submission(request, cx) {
            return false;
        }
        self.pending_submission = None;
        self.submit_error = Some(bounded_message(message.into()));
        cx.notify();
        true
    }
    pub fn cancel(&mut self, reason: MathSourceCancelReason, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        let event = MathSourceCancellation {
            target: self.target.clone(),
            form_id: self.form_id,
            generation: self.generation,
            reason,
        };
        self.retire(cx);
        cx.emit(MathSourceEditorEvent::Cancelled(event));
    }
    /// Owner replacement/hiding is destroy, not a Cancel focus request.
    pub fn retire(&mut self, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        self.retired = true;
        self.generation = self.generation.wrapping_add(1);
        self.preview_timer = None;
        self.cancel_preview(cx);
        self.abandon_submission(cx);
        cx.notify();
    }
    fn matches_input(&self, source: &str, cx: &App) -> bool {
        self.input.read(cx).text().chars().eq(source.chars())
    }
    fn abandon_submission(&mut self, cx: &mut Context<Self>) {
        if let Some(request) = self.pending_submission.take() {
            cx.emit(MathSourceEditorEvent::SubmissionCancelled(request));
        }
    }
    fn cancel_preview(&mut self, cx: &mut Context<Self>) {
        self.preview_generation = self.preview_generation.wrapping_add(1);
        self.preview_deadline = None;
        if let Some(request) = self.active_preview.take() {
            cx.emit(MathSourceEditorEvent::PreviewCancelled(request));
        }
    }
    fn schedule_preview(&mut self, cx: &mut Context<Self>) {
        let generation = self.preview_generation;
        let timer = cx.background_executor().timer(PREVIEW_DEBOUNCE);
        self.preview_timer = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |view, cx| {
                if !view.retired && view.preview_generation == generation {
                    view.request_preview(cx);
                }
            });
        }));
    }
    pub fn set_preview_availability(
        &mut self,
        availability: MathPreviewAvailability,
        cx: &mut Context<Self>,
    ) {
        if self.retired {
            return;
        }
        self.presentation.preview = availability;
        self.preview_timer = None;
        self.cancel_preview(cx);
        self.request_preview(cx);
    }
    fn request_preview(&mut self, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        self.preview_timer = None;
        self.cancel_preview(cx);
        let source = self.raw_source(cx);
        if source.chars().all(crate::house::is_js_whitespace) {
            self.preview_content = PreviewContent::Hint;
            cx.notify();
            return;
        }
        if source.len() > MAX_PREVIEW_SOURCE_BYTES {
            self.preview_content = PreviewContent::Outcome(MathPreviewOutcome::Unavailable {
                message: Arc::from(
                    "Preview unavailable: this source exceeds the native preview request limit. It can still be submitted.",
                ),
            });
            cx.notify();
            return;
        }
        if let MathPreviewAvailability::Unavailable(message) = &self.presentation.preview {
            self.preview_content = PreviewContent::Outcome(MathPreviewOutcome::Unavailable {
                message: bounded_message(message.clone()),
            });
            cx.notify();
            return;
        }
        let request = MathPreviewRequest {
            target: self.target.clone(),
            form_id: self.form_id,
            generation: self.preview_generation,
            request_id: Uuid::new_v4(),
            source,
            font_size_px: 15.2,
            color: self.presentation.canvas_text,
        };
        self.active_preview = Some(request.clone());
        cx.emit(MathSourceEditorEvent::PreviewRequested(request.clone()));
        let timer = cx.background_executor().timer(PREVIEW_TIMEOUT);
        self.preview_deadline = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |view, cx| {
                if view.accepts_preview(&request, cx) {
                    view.cancel_preview(cx);
                    view.preview_content =
                        PreviewContent::Outcome(MathPreviewOutcome::Unavailable {
                            message: Arc::from(
                                "Preview unavailable: the renderer did not respond in time.",
                            ),
                        });
                    cx.notify();
                }
            });
        }));
        cx.notify();
    }
    pub fn accepts_preview(&self, request: &MathPreviewRequest, cx: &App) -> bool {
        !self.retired
            && self
                .active_preview
                .as_ref()
                .is_some_and(|active| active.matches(request))
            && self.matches_input(&request.source, cx)
    }
    pub fn receive_preview(
        &mut self,
        request: &MathPreviewRequest,
        outcome: MathPreviewOutcome,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts_preview(request, cx) {
            return false;
        }
        self.active_preview = None;
        self.preview_deadline = None;
        self.preview_content = PreviewContent::Outcome(match outcome {
            MathPreviewOutcome::Rendered {
                image,
                width_px,
                height_px,
                provenance,
            } => {
                if !width_px.is_finite()
                    || !height_px.is_finite()
                    || !(0. ..=4096.).contains(&width_px)
                    || !(0. ..=4096.).contains(&height_px)
                    || width_px == 0.
                    || height_px == 0.
                    || provenance.trim().is_empty()
                {
                    MathPreviewOutcome::Unavailable {
                        message: Arc::from(
                            "Preview unavailable: the renderer returned an invalid or unqualified paint frame.",
                        ),
                    }
                } else {
                    MathPreviewOutcome::Rendered {
                        image,
                        width_px,
                        height_px,
                        provenance: bounded_message(provenance),
                    }
                }
            }
            MathPreviewOutcome::InvalidLatex { message } => MathPreviewOutcome::InvalidLatex {
                message: bounded_message(message),
            },
            MathPreviewOutcome::Unavailable { message } => MathPreviewOutcome::Unavailable {
                message: bounded_message(message),
            },
        });
        cx.notify();
        true
    }
    pub fn preview_status(&self) -> MathPreviewStatus {
        if self.retired {
            return MathPreviewStatus::Retired;
        }
        if self.active_preview.is_some() || self.preview_timer.is_some() {
            return MathPreviewStatus::Pending;
        }
        match &self.preview_content {
            PreviewContent::Empty => MathPreviewStatus::Pending,
            PreviewContent::Hint => MathPreviewStatus::Blank,
            PreviewContent::Outcome(MathPreviewOutcome::Rendered { .. }) => {
                MathPreviewStatus::RenderedDiagnostic
            }
            PreviewContent::Outcome(MathPreviewOutcome::InvalidLatex { .. }) => {
                MathPreviewStatus::InvalidLatex
            }
            PreviewContent::Outcome(MathPreviewOutcome::Unavailable { .. }) => {
                MathPreviewStatus::Unavailable
            }
        }
    }
    fn preview_element(&self) -> AnyElement {
        let colors = &self.presentation;
        let invalid = matches!(
            &self.preview_content,
            PreviewContent::Outcome(MathPreviewOutcome::InvalidLatex { .. })
        );
        let mut preview = div()
            .id("twyne-math-source-preview")
            .test_support()
            .role(Role::Status)
            .aria_label(if self.target.display == MathDisplay::Block {
                "Block equation preview"
            } else {
                "Inline equation preview"
            })
            .aria_description(match self.preview_status() {
                MathPreviewStatus::Pending => "Equation preview pending",
                MathPreviewStatus::Retired => "Equation source editor closed",
                _ => "Equation preview",
            })
            .w_full()
            .max_h(px(192.))
            .overflow_scroll()
            .py(px(8.))
            .px(px(10.4))
            .border_1()
            .rounded(px(4.))
            .text_size(px(15.2))
            .line_height(relative(colors.inherited_line_height))
            .border_color(
                rgb(if invalid {
                    0xa84632
                } else {
                    colors.canvas_text
                })
                .opacity(if invalid { 1. } else { 0.35 }),
            )
            .bg(rgb(if invalid { 0xfff2ee } else { colors.canvas }))
            .text_color(rgb(if invalid {
                0x742718
            } else {
                colors.canvas_text
            }));
        match &self.preview_content {
            PreviewContent::Empty => {}
            PreviewContent::Hint => {
                preview = preview.text_center().child(
                    div()
                        .font_family(crate::theme::MONO_FONT)
                        .text_size(px(12.8))
                        .text_color(rgb(colors.canvas_text).opacity(0.6))
                        .child(PREVIEW_PLACEHOLDER),
                );
            }
            PreviewContent::Outcome(MathPreviewOutcome::Unavailable { message }) => {
                preview = preview.text_center().child(
                    div()
                        .font_family(crate::theme::MONO_FONT)
                        .text_size(px(12.8))
                        .text_color(rgb(colors.canvas_text).opacity(0.6))
                        .child(SharedString::from(message.to_string())),
                );
            }
            PreviewContent::Outcome(MathPreviewOutcome::InvalidLatex { message }) => {
                preview = preview
                    .flex()
                    .flex_wrap()
                    .items_baseline()
                    .gap(px(6.4))
                    .child(div().font_weight(FontWeight::BOLD).child("Invalid LaTeX"))
                    .child(
                        div()
                            .min_w(px(0.))
                            .font_family(crate::theme::MONO_FONT)
                            .text_size(px(12.8))
                            .child(SharedString::from(message.to_string())),
                    );
            }
            PreviewContent::Outcome(MathPreviewOutcome::Rendered {
                image,
                width_px,
                height_px,
                provenance,
            }) => {
                preview = preview
                    .child(
                        div().flex().justify_center().child(
                            img(image.clone())
                                .w(px(*width_px))
                                .h(px(*height_px))
                                .flex_shrink_0(),
                        ),
                    )
                    .child(
                        div()
                            .font_family(crate::theme::MONO_FONT)
                            .text_size(px(12.8))
                            .text_center()
                            .child(SharedString::from(provenance.to_string())),
                    );
            }
        }
        preview.into_any_element()
    }
}

/// The HTML textarea API normalizes CRLF and lone CR on assignment. All other
/// authored characters (including blank/invalid LaTeX) remain untouched.
fn textarea_value(source: &str) -> String {
    source.replace("\r\n", "\n").replace('\r', "\n")
}
fn bounded_message(message: Arc<str>) -> Arc<str> {
    if message.len() <= MAX_PREVIEW_MESSAGE_BYTES {
        return message;
    }
    let mut end = MAX_PREVIEW_MESSAGE_BYTES;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    Arc::from(format!("{}…", &message[..end]))
}

// Two spread shadows model an outside 2px outline with a 2px Canvas gap;
// neither one participates in layout or changes textarea content geometry.
fn focus_ring(ink: u32, canvas: u32) -> Vec<BoxShadow> {
    vec![
        BoxShadow::new(px(0.), px(0.), rgb(ink).into()).spread_radius(px(4.)),
        BoxShadow::new(px(0.), px(0.), rgb(canvas).into()).spread_radius(px(2.)),
    ]
}

/// ProseMirror's equation stopEvent protects the raw textarea from manuscript
/// input. Keep the same field boundary for explicit native rich actions, which
/// can otherwise bypass RichEditorView::dispatch's command-only focus guard.
/// Source's document/window listeners deliberately treat form buttons
/// differently, so this is not a blanket whole-form action barrier.
fn isolate_source_field<E: gpui_kit::InteractiveElement>(mut root: E, field: &FocusHandle) -> E {
    macro_rules! block_rich_field_actions {
        ($($action:ident),* $(,)?) => {
            $(
                {
                    let field = field.clone();
                    root = root.capture_action(
                        move |_: &super::view::$action, window, cx| {
                            if field.is_focused(window) {
                                cx.stop_propagation();
                            }
                        },
                    );
                }
            )*
        };
    }
    block_rich_field_actions![
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        DeleteWordBackward,
        DeleteWordForward,
        Home,
        End,
        SelectHome,
        SelectEnd,
        DocumentStart,
        DocumentEnd,
        SelectAll,
        Enter,
        HardBreak,
        Copy,
        Cut,
        Paste,
        Undo,
        Redo,
        Bold,
        Italic,
        Underline,
        Indent,
        Outdent,
    ];
    let forward_field = field.clone();
    root = root.capture_action(move |_: &gpui_kit::base::input::IndentInline, window, cx| {
        if forward_field.is_focused(window) {
            cx.stop_propagation();
            window.focus_next(cx);
        }
    });
    let backward_field = field.clone();
    root.capture_action(
        move |_: &gpui_kit::base::input::OutdentInline, window, cx| {
            if backward_field.is_focused(window) {
                cx.stop_propagation();
                window.focus_prev(cx);
            }
        },
    )
}

impl Render for MathSourceEditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let inline = self.target.display == MathDisplay::Inline;
        let width = if inline {
            352_f32.min(f32::from(window.viewport_size().width) * 0.7)
        } else {
            448_f32.min(f32::from(window.viewport_size().width) * 0.8)
        };
        let color = self.presentation.canvas_text;
        let canvas = self.presentation.canvas;
        let focus = self.input.focus_handle(cx);
        // The ring tracks the input's identity without adding another tab
        // stop for it. A duplicate before the textarea makes reverse Tab
        // return to the same field in GPUI's ordered tab-stop map.
        let mut container_focus = focus.clone();
        container_focus.tab_stop = false;
        let disabled = self.retired || self.read_only;
        let submit_disabled = disabled || self.pending_submission.is_some();
        let root = div()
            .id("twyne-math-source-editor")
            .test_support()
            .role(Role::Form)
            .aria_label(self.target.label())
            .key_context("TwyneMathSourceForm")
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .flex()
            .flex_col()
            .min_w(px(width))
            .when(inline, |this| this.w(px(width)))
            .when(!inline, |this| this.w_full())
            .gap(px(8.))
            .p(px(10.4))
            .border_1()
            .border_color(rgb(color))
            .rounded(px(6.4))
            .bg(rgb(canvas))
            .text_color(rgb(color))
            .font_family(self.presentation.inherited_font_family.clone())
            .text_size(px(self.presentation.inherited_font_size_px))
            .line_height(relative(self.presentation.inherited_line_height))
            .capture_action(cx.listener(|view, action: &Enter, _, cx| {
                if !action.shift && (action.secondary || view.target.display == MathDisplay::Inline)
                {
                    cx.stop_propagation();
                    view.submit(cx);
                }
            }))
            .capture_action(cx.listener(|view, _: &MathSourceSecondaryEnter, _, cx| {
                cx.stop_propagation();
                view.submit(cx);
            }))
            .capture_action(cx.listener(|view, _: &MathSourceAltEnter, _, cx| {
                cx.stop_propagation();
                if view.target.display == MathDisplay::Inline {
                    view.submit(cx);
                }
            }))
            .capture_action(cx.listener(|_, _: &MathSourceModifiedShiftEnter, _, cx| {
                cx.stop_propagation();
            }))
            .capture_action(cx.listener(|view, _: &Escape, _, cx| {
                cx.stop_propagation();
                view.cancel(MathSourceCancelReason::Escape, cx);
            }))
            .on_action(cx.listener(|view, _: &DismissMathSource, _, cx| {
                cx.stop_propagation();
                view.cancel(MathSourceCancelReason::Escape, cx);
            }))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.8))
                    .w_full()
                    .text_size(px(12.8))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.target.label())
                    .child(
                        div()
                            .id("twyne-math-source-field")
                            .test_support()
                            .w_full()
                            .track_focus(&container_focus)
                            .focus_visible(move |style| style.shadow(focus_ring(color, canvas)))
                            .child(
                                Textarea::new(&self.input)
                                    .accessibility_id("twyne-math-source-input")
                                    .aria_label(self.target.label())
                                    .appearance(false)
                                    .xsmall()
                                    .w_full()
                                    .h(px(self.target.textarea_height()))
                                    .px(px(4.))
                                    .py(px(8.))
                                    .border_1()
                                    .border_color(rgb(color).opacity(0.35))
                                    .rounded(px(4.))
                                    .bg(rgb(canvas))
                                    .text_color(rgb(color))
                                    .font_family(crate::theme::MATH_SOURCE_MONO_FONT)
                                    .font_weight(FontWeight::NORMAL)
                                    .text_size(px(14.))
                                    .line_height(relative(1.4))
                                    .readonly(disabled),
                            ),
                    ),
            )
            .child(self.preview_element())
            .when_some(self.submit_error.clone(), |this, error| {
                this.child(
                    div()
                        .id("twyne-math-source-submit-error")
                        .test_support()
                        .role(Role::Status)
                        .text_size(px(12.8))
                        .font_family(crate::theme::MONO_FONT)
                        .text_color(rgb(0x742718))
                        .child(SharedString::from(error.to_string())),
                )
            })
            .child(
                div()
                    .id("twyne-math-source-actions")
                    .test_support()
                    .flex()
                    .flex_wrap()
                    .justify_end()
                    .gap(px(6.4))
                    .child(
                        Button::new("twyne-math-source-save")
                            .accessibility_label("Render equation")
                            .disabled(submit_disabled)
                            .min_h(px(32.))
                            .border_1()
                            .border_color(rgb(color))
                            .rounded(px(4.))
                            .px(px(10.4))
                            .line_height(relative(self.presentation.inherited_line_height))
                            .bg(rgb(color))
                            .text_color(rgb(canvas))
                            .focus_visible(move |style| style.shadow(focus_ring(canvas, color)))
                            .child("Render equation")
                            .on_click(cx.listener(|view, _, _, cx| {
                                cx.stop_propagation();
                                view.submit(cx);
                            })),
                    )
                    .child(
                        Button::new("twyne-math-source-cancel")
                            .accessibility_label("Cancel")
                            .disabled(self.retired)
                            .min_h(px(32.))
                            .border_1()
                            .border_color(rgb(color))
                            .rounded(px(4.))
                            .px(px(10.4))
                            .line_height(relative(self.presentation.inherited_line_height))
                            .bg(rgb(canvas))
                            .text_color(rgb(color))
                            .focus_visible(move |style| style.shadow(focus_ring(color, canvas)))
                            .child("Cancel")
                            .on_click(cx.listener(|view, _, _, cx| {
                                cx.stop_propagation();
                                view.cancel(MathSourceCancelReason::CancelButton, cx);
                            })),
                    ),
            );
        isolate_source_field(root, &focus)
    }
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "../../fixtures/math-write/native-source-form/view_tests.rs"]
mod tests;
