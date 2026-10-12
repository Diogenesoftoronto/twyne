//! The original offline Marginalia board. Its threads advance only after a
//! durable ACK; actual editor marks, composer placement and providers are Root's.

use crate::{
    house::is_js_whitespace,
    manuscript::timestamp,
    marginalia::{
        CommentRef, MarginaliaEdit, MarginaliaEffect, MarginaliaRecord, MarginaliaRequest,
        MarginaliaSession, ReplyDrafts, UserComment, UserCommentAuthor, UserCommentReply,
    },
    theme::{self, DISPLAY_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT},
};
use anyhow::{Result, ensure};
use gpui_kit::base::text::{TextView, TextViewStyle};
use gpui_kit::component::{
    Disableable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::{Enter, IndentInline, InputEvent, OutdentInline, Textarea, TextareaState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Bounds, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight,
    HighlightStyle, KeyBinding, Render, ScrollHandle, SharedString, StyledText, Subscription,
    TestSupportExt, Window, canvas, div, px, relative, rems, rgb,
};
use std::{
    collections::{BTreeMap, HashSet},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MarginaliaCapabilities {
    pub persist: bool,
    pub erase_anchors: bool,
    pub jump_to_anchor: bool,
    pub ask_editor: bool,
    pub play_audio: bool,
    pub speak: bool,
}
impl MarginaliaCapabilities {
    pub fn local() -> Self {
        Self {
            persist: true,
            erase_anchors: true,
            ..Self::default()
        }
    }
}
#[derive(Clone, Debug)]
pub enum MarginaliaEvent {
    SaveRequested(MarginaliaRequest),
    Filed {
        request_id: Uuid,
        effects: Vec<MarginaliaEffect>,
    },
    JumpToComment(CommentRef),
    AskEditor(CommentRef),
    PlayAudio {
        target: CommentRef,
        audio_id: String,
    },
    Speak {
        target: CommentRef,
        text: String,
    },
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MarginaliaCounts {
    pub pending: usize,
    pub struck: usize,
    pub ghosts: usize,
    pub anchors_known: bool,
}
gpui_kit::actions!(marginalia, [FileReply]);
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("ctrl-enter", FileReply, Some("TwyneMarginalia")),
        KeyBinding::new("cmd-enter", FileReply, Some("TwyneMarginalia")),
    ]);
}
type DraftKey = (String, String);
fn key(target: &CommentRef) -> DraftKey {
    (target.folio_id.clone(), target.id.clone())
}
pub struct MarginaliaView {
    session: MarginaliaSession,
    active_folio_id: Option<String>,
    anchor_ids: Option<HashSet<String>>,
    capabilities: MarginaliaCapabilities,
    replying_to: Option<CommentRef>,
    inline_thread: Option<CommentRef>,
    ghosts_only: bool,
    inputs: BTreeMap<DraftKey, Entity<TextareaState>>,
    subscriptions: Vec<Subscription>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    reply_bounds: Arc<Mutex<Option<Bounds<gpui_kit::Pixels>>>>,
    reveal_reply: bool,
    close_reply_after_ack: bool,
    local_error: Option<String>,
}
impl EventEmitter<MarginaliaEvent> for MarginaliaView {}
impl Focusable for MarginaliaView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl MarginaliaView {
    pub fn new(
        record: Arc<MarginaliaRecord>,
        active_folio_id: Option<String>,
        anchor_ids: Option<Vec<String>>,
        capabilities: MarginaliaCapabilities,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            session: MarginaliaSession::new(record),
            active_folio_id,
            anchor_ids: anchor_ids.map(|ids| ids.into_iter().collect()),
            capabilities,
            replying_to: None,
            inline_thread: None,
            ghosts_only: false,
            inputs: BTreeMap::new(),
            subscriptions: Vec::new(),
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            reply_bounds: Arc::new(Mutex::new(None)),
            reveal_reply: false,
            close_reply_after_ack: false,
            local_error: None,
        }
    }
    pub fn saved_record(&self) -> &Arc<MarginaliaRecord> {
        self.session.saved()
    }
    pub fn pending_request(&self) -> Option<&MarginaliaRequest> {
        self.session.pending()
    }
    pub fn pending_request_id(&self) -> Option<Uuid> {
        self.session.pending().map(|request| request.request_id)
    }
    pub fn capture_reply_drafts(&self, cx: &App) -> ReplyDrafts {
        let mut drafts = self.session.saved().reply_drafts.clone();
        for ((folio, id), input) in &self.inputs {
            let text = input.read(cx).text().to_string();
            if text.is_empty() {
                if let Some(scoped) = drafts.get_mut(folio) {
                    scoped.remove(id);
                    if scoped.is_empty() {
                        drafts.remove(folio);
                    }
                }
            } else {
                drafts
                    .entry(folio.clone())
                    .or_default()
                    .insert(id.clone(), text);
            }
        }
        drafts
    }
    pub fn has_unsaved_changes(&self, cx: &App) -> bool {
        self.session.pending().is_some()
            || self.capture_reply_drafts(cx) != self.session.saved().reply_drafts
    }
    pub fn prepare_pending_edits(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Result<Option<MarginaliaRequest>> {
        if let Some(request) = self.session.pending() {
            return Ok(Some(request.clone()));
        }
        let drafts = self.capture_reply_drafts(cx);
        if drafts == self.session.saved().reply_drafts {
            return Ok(None);
        }
        ensure!(
            self.capabilities.persist,
            "Local Marginalia filing is unavailable. The reply drafts are still held here."
        );
        self.issue(MarginaliaEdit::ReplyDrafts(drafts), cx)
    }
    pub fn flush_pending_edits(
        &mut self,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<MarginaliaRequest>> {
        self.prepare_pending_edits(cx)
    }
    pub fn request_edit(
        &mut self,
        edit: MarginaliaEdit,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<MarginaliaRequest>> {
        ensure!(
            self.capabilities.persist,
            "Local Marginalia filing is unavailable."
        );
        ensure!(
            self.session.pending().is_none(),
            "Finish the previous margin change before filing another one."
        );
        ensure!(
            !edit_erases(&edit) || self.capabilities.erase_anchors,
            "Erasing a margin note is unavailable until its manuscript mark can be removed."
        );
        let drafts = self.capture_reply_drafts(cx);
        self.issue(
            MarginaliaEdit::Batch(vec![MarginaliaEdit::ReplyDrafts(drafts), edit]),
            cx,
        )
    }
    fn issue(
        &mut self,
        edit: MarginaliaEdit,
        cx: &mut Context<Self>,
    ) -> Result<Option<MarginaliaRequest>> {
        let request = self.session.request(edit, timestamp())?;
        self.local_error = None;
        if let Some(request) = &request {
            cx.emit(MarginaliaEvent::SaveRequested(request.clone()));
        }
        cx.notify();
        Ok(request)
    }
    pub fn ack_saved(
        &mut self,
        id: Uuid,
        record: Arc<MarginaliaRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let effects = self
            .session
            .pending()
            .map(|request| request.effects.clone())
            .unwrap_or_default();
        if !self.session.acknowledge_saved(id, record) {
            return false;
        }
        self.sync_controls(window, cx);
        if self.close_reply_after_ack {
            self.replying_to = None;
            self.close_reply_after_ack = false;
        }
        if self
            .replying_to
            .as_ref()
            .is_some_and(|target| self.session.saved().comment(target).is_none())
        {
            self.replying_to = None;
        }
        if self
            .inline_thread
            .as_ref()
            .is_some_and(|target| self.session.saved().comment(target).is_none())
        {
            self.inline_thread = None;
        }
        self.local_error = None;
        cx.emit(MarginaliaEvent::Filed {
            request_id: id,
            effects,
        });
        cx.notify();
        true
    }
    pub fn report_error(
        &mut self,
        id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.session.report_error(id, message) {
            return false;
        }
        cx.notify();
        true
    }
    pub fn replace_record(
        &mut self,
        record: Arc<MarginaliaRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.has_unsaved_changes(cx) || !self.session.replace_record(record) {
            return false;
        }
        self.sync_controls(window, cx);
        cx.notify();
        true
    }
    pub fn set_scope(
        &mut self,
        active_folio_id: Option<String>,
        anchor_ids: Option<Vec<String>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.has_unsaved_changes(cx) {
            return false;
        }
        self.active_folio_id = active_folio_id;
        self.anchor_ids = anchor_ids.map(|ids| ids.into_iter().collect());
        self.replying_to = None;
        self.inline_thread = None;
        self.ghosts_only = false;
        self.reveal_reply = false;
        *self.reply_bounds.lock().unwrap() = None;
        cx.notify();
        true
    }
    pub fn set_anchors(&mut self, ids: Option<Vec<String>>, cx: &mut Context<Self>) {
        self.anchor_ids = ids.map(|ids| ids.into_iter().collect());
        cx.notify();
    }
    pub fn set_capabilities(
        &mut self,
        capabilities: MarginaliaCapabilities,
        cx: &mut Context<Self>,
    ) {
        self.capabilities = capabilities;
        cx.notify();
    }
    fn scoped(&self) -> impl Iterator<Item = &UserComment> {
        self.session
            .saved()
            .comments
            .iter()
            .filter(|comment| self.active_folio_id.as_ref() == Some(&comment.folio_id))
    }
    fn ghost(&self, comment: &UserComment) -> bool {
        self.anchor_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(&comment.id))
    }
    fn live(&self, target: &CommentRef) -> bool {
        self.active_folio_id.as_ref() == Some(&target.folio_id)
            && self
                .anchor_ids
                .as_ref()
                .is_some_and(|ids| ids.contains(&target.id))
            && self.session.saved().comment(target).is_some()
    }
    pub fn counts(&self) -> MarginaliaCounts {
        MarginaliaCounts {
            pending: self
                .scoped()
                .filter(|comment| !comment.resolved && (!self.ghosts_only || self.ghost(comment)))
                .count(),
            struck: self.scoped().filter(|comment| comment.resolved).count(),
            ghosts: self.scoped().filter(|comment| self.ghost(comment)).count(),
            anchors_known: self.anchor_ids.is_some(),
        }
    }
    fn writable(&self) -> bool {
        self.capabilities.persist && self.session.pending().is_none()
    }
    fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let saved = self.session.saved().clone();
        self.inputs.retain(|(folio, id), input| {
            let draft = saved
                .reply_drafts
                .get(folio)
                .and_then(|drafts| drafts.get(id));
            if draft.is_none()
                && !saved
                    .comments
                    .iter()
                    .any(|comment| &comment.folio_id == folio && &comment.id == id)
            {
                return false;
            }
            let value = draft.cloned().unwrap_or_default();
            if *input.read(cx).text() != value {
                input.update(cx, |input, cx| input.set_value(value, window, cx));
            }
            true
        });
    }
    /// One retained rope for this placed thread, shared by the Board and Root's
    /// inline card. This never manufactures a missing or foreign-scope thread.
    pub fn reply_input(
        &mut self,
        target: &CommentRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Entity<TextareaState>> {
        ensure!(
            self.capabilities.persist,
            "Local reply filing is unavailable."
        );
        ensure!(
            self.active_folio_id.as_ref() == Some(&target.folio_id)
                && self.session.saved().comment(target).is_some(),
            "A reply needs an existing note in the active folio."
        );
        let draft_key = key(target);
        if !self.inputs.contains_key(&draft_key) {
            let value = self
                .session
                .saved()
                .reply_drafts
                .get(&target.folio_id)
                .and_then(|drafts| drafts.get(&target.id))
                .cloned()
                .unwrap_or_default();
            let input = cx.new(|cx| {
                TextareaState::new(window, cx)
                    .placeholder("Annotate… (@ to tag an editor)")
                    .default_value(value)
            });
            self.subscriptions
                .push(cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify()));
            self.inputs.insert(draft_key.clone(), input);
        }
        Ok(self.inputs[&draft_key].clone())
    }
    /// Root mounts the shared input beside its verified mark while this target's
    /// Board composer is suppressed. Clearing it returns the held Board reply.
    pub fn set_inline_thread(
        &mut self,
        target: Option<CommentRef>,
        cx: &mut Context<Self>,
    ) -> bool {
        if target.as_ref().is_some_and(|target| {
            self.active_folio_id.as_ref() != Some(&target.folio_id)
                || self.session.saved().comment(target).is_none()
                || !self.inputs.contains_key(&key(target))
        }) {
            return false;
        }
        if let Some(target) = &target {
            self.replying_to = Some(target.clone());
        }
        self.inline_thread = target;
        self.reveal_reply = self.inline_thread.is_none() && self.replying_to.is_some();
        *self.reply_bounds.lock().unwrap() = None;
        cx.notify();
        true
    }
    fn open_reply(&mut self, target: CommentRef, window: &mut Window, cx: &mut Context<Self>) {
        if !self.writable()
            || self.inline_thread.as_ref() == Some(&target)
            || self
                .session
                .saved()
                .comment(&target)
                .is_none_or(|comment| comment.resolved)
        {
            return;
        }
        let input = match self.reply_input(&target, window, cx) {
            Ok(input) => input,
            Err(error) => {
                self.local_error = Some(error.to_string());
                cx.notify();
                return;
            }
        };
        self.replying_to = Some(target);
        self.reveal_reply = true;
        *self.reply_bounds.lock().unwrap() = None;
        let focus = input.read(cx).focus_handle(cx);
        window.on_next_frame(move |window, cx| focus.focus(window, cx));
        cx.notify();
    }
    fn file_reply(&mut self, target: CommentRef, window: &mut Window, cx: &mut Context<Self>) {
        let Some(input) = self.inputs.get(&key(&target)) else {
            return;
        };
        let text = input.read(cx).text().to_string();
        if text.trim_matches(is_js_whitespace).is_empty() {
            return;
        }
        let reply = UserCommentReply::writer(text, timestamp());
        match self.request_edit(MarginaliaEdit::AppendReply { target, reply }, window, cx) {
            Ok(Some(_)) => self.close_reply_after_ack = true,
            Ok(None) => {}
            Err(error) => {
                self.local_error = Some(error.to_string());
                cx.notify();
            }
        }
    }
    fn cancel_reply(&mut self, target: &CommentRef, window: &mut Window, cx: &mut Context<Self>) {
        if !self.writable() {
            return;
        }
        if let Some(input) = self.inputs.get(&key(target)) {
            input.update(cx, |input, cx| input.set_value("", window, cx));
        }
        self.replying_to = None;
        self.reveal_reply = false;
        if let Err(error) = self.prepare_pending_edits(cx) {
            self.local_error = Some(error.to_string());
        }
        cx.notify();
    }
    fn act(&mut self, edit: MarginaliaEdit, window: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = self.request_edit(edit, window, cx) {
            self.local_error = Some(error.to_string());
            cx.notify();
        }
    }
    fn navigate_reply_tab(&mut self, reverse: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .replying_to
            .as_ref()
            .and_then(|target| self.inputs.get(&key(target)))
            .is_some_and(|input| input.read(cx).focus_handle(cx).is_focused(window))
        {
            if reverse {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
            cx.stop_propagation();
        } else {
            cx.propagate();
        }
    }
    fn focused_board_reply(&self, window: &Window, cx: &App) -> Option<CommentRef> {
        self.replying_to
            .as_ref()
            .filter(|target| {
                self.inline_thread.as_ref() != Some(*target)
                    && self
                        .inputs
                        .get(&key(target))
                        .is_some_and(|input| input.read(cx).focus_handle(cx).is_focused(window))
            })
            .cloned()
    }
    fn reveal_active_reply(&mut self, window: &Window, cx: &mut Context<Self>) {
        if !self.reveal_reply {
            return;
        }
        let Some(bounds) = *self.reply_bounds.lock().unwrap() else {
            return;
        };
        let viewport = self.scroll_handle.bounds();
        let mut offset = self.scroll_handle.offset();
        let top = viewport.top() + px(12.);
        let bottom = viewport.bottom() - px(12.);
        if bounds.top() < top {
            offset.y += top - bounds.top();
        } else if bounds.bottom() > bottom {
            offset.y -= bounds.bottom() - bottom;
        }
        if self.scroll_handle.offset() != offset {
            self.scroll_handle.set_offset(offset);
            cx.notify();
        }
        self.reveal_reply = false;
        let _ = window;
    }
    fn reply_editor(&self, target: &CommentRef, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let input = &self.inputs[&key(target)];
        let measured = self.reply_bounds.clone();
        let target_file = target.clone();
        let target_cancel = target.clone();
        let height: f32 = window.viewport_size().height.into();
        div()
            .mt(px(8.))
            .child(
                div()
                    .id(SharedString::from(control_id("reply-input", target)))
                    .test_support()
                    .relative()
                    .child(
                        Textarea::new(input)
                            .accessibility_id(control_id("reply-input", target))
                            .aria_label("Reply to note")
                            .appearance(false)
                            .bordered(true)
                            .font_family(SERIF_FONT)
                            .text_size(px(12.))
                            .line_height(px(16.))
                            .h(px((height * 0.16).clamp(96., 160.)))
                            .px(px(8.))
                            .py(px(6.))
                            .bg(rgb(p.paper_soft))
                            .border_1()
                            .border_color(rgb(p.rule))
                            .rounded(px(2.))
                            .disabled(!self.writable()),
                    )
                    .child(
                        canvas(
                            move |bounds, _, _| *measured.lock().unwrap() = Some(bounds),
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    ),
            )
            .child(
                div()
                    .mt(px(8.))
                    .flex()
                    .gap(px(12.))
                    .child(
                        text_button(
                            control_id("file-reply", target),
                            "File reply",
                            p.vermilion,
                            cx,
                        )
                        .disabled(
                            !self.writable()
                                || input
                                    .read(cx)
                                    .text()
                                    .to_string()
                                    .trim_matches(is_js_whitespace)
                                    .is_empty(),
                        )
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.file_reply(target_file.clone(), window, cx)
                            },
                        )),
                    )
                    .child(
                        text_button(
                            control_id("cancel-reply", target),
                            "Cancel",
                            p.ink_muted,
                            cx,
                        )
                        .disabled(!self.writable())
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.cancel_reply(&target_cancel, window, cx)
                            },
                        )),
                    ),
            )
            .into_any_element()
    }
    fn card(&self, comment: &UserComment, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let target = comment.reference();
        let target_toggle = target.clone();
        let target_erase = target.clone();
        let mut content = div().flex_1().min_w_0().child(
            div()
                .flex()
                .items_start()
                .gap(px(8.))
                .mb(px(4.))
                .child(
                    div()
                        .font_family(DISPLAY_FONT)
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_size(px(12.))
                        .line_height(px(16.))
                        .child(comment.author.clone()),
                )
                .child(author_date(
                    &time_ago(comment.updated_at, timestamp()),
                    p.ink_muted,
                )),
        );
        if let Some(anchor) = &comment.anchor
            && !anchor.is_empty()
        {
            let target_jump = target.clone();
            let quote = format!("« {} »", truncate_utf16(anchor, 120));
            let quote_body = div()
                .w_full()
                .font_family(SERIF_FONT)
                .font_weight(FontWeight::NORMAL)
                .italic()
                .text_size(px(12.))
                .line_height(px(16.))
                .text_color(rgb(p.ink_light))
                .pl(px(8.))
                .border_l_1()
                .border_color(rgb(p.writer_note))
                .child(quote);
            content = content.child(
                div()
                    .mb(px(4.))
                    .when(
                        self.capabilities.jump_to_anchor && self.live(&target),
                        |row| {
                            row.child(
                                Button::new(control_id("jump", &target))
                                    .accessibility_label("Show passage")
                                    .custom(
                                        ButtonCustomVariant::new(cx)
                                            .color(rgb(0).opacity(0.).into())
                                            .foreground(rgb(p.ink_light).into())
                                            .hover(rgb(0).opacity(0.).into()),
                                    )
                                    .h_auto()
                                    .p_0()
                                    .w_full()
                                    .child(quote_body)
                                    .on_click(cx.listener(move |_, _, _, cx| {
                                        cx.emit(MarginaliaEvent::JumpToComment(target_jump.clone()))
                                    })),
                            )
                        },
                    )
                    .when(
                        !self.capabilities.jump_to_anchor || !self.live(&target),
                        |row| {
                            row.child(
                                div()
                                    .font_family(SERIF_FONT)
                                    .italic()
                                    .text_size(px(12.))
                                    .line_height(px(16.))
                                    .text_color(rgb(p.ink_light))
                                    .pl(px(8.))
                                    .border_l_1()
                                    .border_color(rgb(p.writer_note))
                                    .child(format!("« {} »", truncate_utf16(anchor, 120))),
                            )
                        },
                    ),
            );
        }
        content = content.child(if comment.resolved {
            div()
                .font_family(SERIF_FONT)
                .text_size(px(14.))
                .line_height(px(20.))
                .text_color(rgb(p.ink_light))
                .line_through()
                .child(comment.text.clone())
                .into_any_element()
        } else {
            markdown(control_id("body", &target), &comment.text, false, cx)
        });
        if let Some(audio) = &comment.audio_id {
            let target_audio = target.clone();
            let audio = audio.clone();
            let label = comment
                .audio_duration_ms
                .filter(|ms| *ms != 0.)
                .map_or_else(
                    || "spoken".into(),
                    |ms| format!("spoken · {}", duration(ms)),
                );
            content = content.child(
                div()
                    .mt(px(6.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        icon_button(control_id("audio", &target), "Play the recording", "▶", cx)
                            .disabled(!self.capabilities.play_audio)
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.emit(MarginaliaEvent::PlayAudio {
                                    target: target_audio.clone(),
                                    audio_id: audio.clone(),
                                })
                            })),
                    )
                    .child(tracked_text(&label, 11., 1.1, p.ink_muted)),
            );
        }
        let resolved = comment.resolved;
        let mut card = div()
            .id(SharedString::from(control_id("card", &target)))
            .test_support()
            .mx(px(12.))
            .mb(px(8.))
            .px(px(16.))
            .py(px(12.))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .bg(if resolved {
                rgb(p.paper)
            } else {
                mix(p.writer_note, 0.06, p.paper, 0.94)
            })
            .when(resolved, |card| card.opacity(0.55))
            .child(
                div().flex().items_start().child(content).child(
                    div()
                        .flex()
                        .gap(px(4.))
                        .ml(px(8.))
                        .flex_shrink_0()
                        .child(
                            icon_button(
                                control_id("resolve", &target),
                                if resolved { "Restore note" } else { "Strike" },
                                if resolved { "↩" } else { "✓" },
                                cx,
                            )
                            .disabled(!self.writable())
                            .on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.act(
                                        MarginaliaEdit::SetResolved {
                                            target: target_toggle.clone(),
                                            resolved: !resolved,
                                        },
                                        window,
                                        cx,
                                    )
                                },
                            )),
                        )
                        .child(
                            icon_button(
                                control_id("erase", &target),
                                if resolved { "Erase note" } else { "Erase" },
                                "✕",
                                cx,
                            )
                            .disabled(!self.writable() || !self.capabilities.erase_anchors)
                            .on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.act(
                                        MarginaliaEdit::Erase(vec![target_erase.clone()]),
                                        window,
                                        cx,
                                    )
                                },
                            )),
                        ),
                ),
            );
        if !resolved && !comment.replies.is_empty() {
            card = card.child(
                div()
                    .mt(px(8.))
                    .ml(px(16.))
                    .pl(px(12.))
                    .border_l_1()
                    .border_dashed()
                    .border_color(rgb(p.rule))
                    .children(comment.replies.iter().enumerate().map(|(index, reply)| {
                        let persona = reply.author_kind == UserCommentAuthor::Persona;
                        let color = reply
                            .color
                            .as_deref()
                            .and_then(parse_color)
                            .unwrap_or(p.ink_light);
                        div()
                            .when(index > 0, |reply| reply.mt(px(8.)))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_start()
                                    .gap(px(8.))
                                    .mb(px(2.))
                                    .child(
                                        div()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(12.))
                                            .line_height(px(16.))
                                            .text_color(rgb(if persona {
                                                color
                                            } else {
                                                p.ink_light
                                            }))
                                            .child(reply.author.clone()),
                                    )
                                    .when(persona, |row| {
                                        row.child(tracked("editor", 8.8, 1.32, p.ink_muted))
                                    })
                                    .child(author_date(
                                        &time_ago(reply.created_at, timestamp()),
                                        p.ink_muted,
                                    )),
                            )
                            .child(markdown(
                                SharedString::from(format!(
                                    "marginalia-reply-body-{}-{}-{}",
                                    target.folio_id, target.id, reply.id
                                )),
                                &reply.text,
                                persona,
                                cx,
                            ))
                    })),
            );
        }
        if !resolved {
            if self.replying_to.as_ref() == Some(&target)
                && self.inline_thread.as_ref() != Some(&target)
            {
                card = card.child(self.reply_editor(&target, window, cx));
            } else {
                let target_reply = target.clone();
                let target_ask = target.clone();
                card = card.child(
                    div()
                        .mt(px(8.))
                        .flex()
                        .flex_wrap()
                        .gap(px(12.))
                        .child(
                            text_button(
                                control_id("annotate", &target),
                                "+ Annotate",
                                p.ink_muted,
                                cx,
                            )
                            .disabled(
                                !self.writable() || self.inline_thread.as_ref() == Some(&target),
                            )
                            .on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.open_reply(target_reply.clone(), window, cx)
                                },
                            )),
                        )
                        .child(
                            text_button(
                                control_id("ask", &target),
                                "✎ Ask an editor",
                                p.ink_muted,
                                cx,
                            )
                            .disabled(
                                !self.capabilities.ask_editor || self.session.pending().is_some(),
                            )
                            .on_click(cx.listener(
                                move |_, _, _, cx| {
                                    cx.emit(MarginaliaEvent::AskEditor(target_ask.clone()))
                                },
                            )),
                        ),
                );
            }
        }
        if self.capabilities.speak {
            let target_speak = target.clone();
            let text = comment.text.clone();
            card = card.child(
                text_button(control_id("speak", &target), "Read aloud", p.ink_muted, cx).on_click(
                    cx.listener(move |_, _, _, cx| {
                        cx.emit(MarginaliaEvent::Speak {
                            target: target_speak.clone(),
                            text: text.clone(),
                        })
                    }),
                ),
            );
        }
        card.into_any_element()
    }
    fn status(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let error = self.session.error().or(self.local_error.as_deref());
        let message = error.map(str::to_owned).unwrap_or_else(|| {
            if self.session.pending().is_some() {
                "Filing the margin change…".into()
            } else if self.has_unsaved_changes(cx) {
                "Reply draft held on this desk.".into()
            } else {
                String::new()
            }
        });
        div()
            .id("marginalia-save-status")
            .test_support()
            .when(!message.is_empty(), |status| {
                status
                    .px(px(16.))
                    .py(px(8.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
            })
            .font_family(SERIF_FONT)
            .text_size(px(12.))
            .line_height(relative(1.5))
            .text_color(rgb(if error.is_some() {
                p.vermilion
            } else {
                p.ink_muted
            }))
            .when(!message.is_empty(), |status| status.child(message))
            .when(self.session.error().is_some(), |status| {
                status.child(
                    div()
                        .mt(px(8.))
                        .flex()
                        .gap(px(12.))
                        .child(
                            text_button("marginalia-retry", "Retry filing", p.vermilion, cx)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(request) = this.session.retry() {
                                        cx.emit(MarginaliaEvent::SaveRequested(request));
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(
                            text_button("marginalia-discard", "Discard change", p.ink_muted, cx)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if this.session.discard_failed() {
                                        this.close_reply_after_ack = false;
                                        this.local_error = None;
                                        cx.notify();
                                    }
                                })),
                        ),
                )
            })
            .into_any_element()
    }
}
impl Render for MarginaliaView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.reveal_active_reply(window, cx);
        let p = theme::palette(cx);
        let counts = self.counts();
        let comments = self.scoped().cloned().collect::<Vec<_>>();
        let mut body = div()
            .id("marginalia-scroll")
            .test_support()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle);
        if comments.is_empty() {
            body = body.child(
                div()
                    .px(px(24.))
                    .py(px(40.))
                    .text_align(gpui_kit::TextAlign::Center)
                    .child(
                        div()
                            .font_family(DISPLAY_FONT)
                            .text_size(px(30.))
                            .line_height(relative(1.2))
                            .text_color(rgb(p.writer_note))
                            .child("✎"),
                    )
                    .child(
                        div()
                            .mt(px(12.))
                            .font_family(SERIF_FONT)
                            .italic()
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .text_color(rgb(p.ink_light))
                            .child("The margins are quiet."),
                    )
                    .child(div().mt(px(6.)).child(tracked(
                        "Select a passage to add the first note.",
                        11.,
                        1.98,
                        p.ink_muted,
                    ))),
            );
        }
        if counts.pending > 0 {
            body = body.child(div().px(px(16.)).pt(px(16.)).pb(px(8.)).child(tracked(
                "Pending",
                11.,
                2.42,
                p.ink_muted,
            )));
        }
        for comment in comments
            .iter()
            .filter(|comment| !comment.resolved && (!self.ghosts_only || self.ghost(comment)))
        {
            body = body.child(self.card(comment, window, cx));
        }
        if counts.struck > 0 {
            body = body.child(div().px(px(16.)).pt(px(20.)).pb(px(8.)).child(tracked(
                "Struck",
                11.,
                2.42,
                p.ink_muted,
            )));
        }
        for comment in comments.iter().filter(|comment| comment.resolved) {
            body = body.child(self.card(comment, window, cx));
        }
        let count_text = format!("{} pending · {} struck", counts.pending, counts.struck);
        let instructions = "Select a passage, then choose Add margin. Your note opens beside the text and appears here once placed.";
        let emphasis = instructions
            .find("Add margin")
            .expect("static instruction emphasis");
        div()
            .id("marginalia-panel")
            .test_support()
            .key_context("TwyneMarginalia")
            .track_focus(&self.focus_handle)
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(rgb(p.sidebar))
            .font_family(SERIF_FONT)
            .font_weight(FontWeight::NORMAL)
            .text_color(rgb(p.ink))
            .capture_action(cx.listener(|this, _: &IndentInline, window, cx| {
                this.navigate_reply_tab(false, window, cx)
            }))
            .capture_action(cx.listener(|this, _: &OutdentInline, window, cx| {
                this.navigate_reply_tab(true, window, cx)
            }))
            .capture_action(cx.listener(|this, _: &FileReply, window, cx| {
                if let Some(target) = this.focused_board_reply(window, cx) {
                    this.file_reply(target, window, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, action: &Enter, window, cx| {
                if action.secondary
                    && let Some(target) = this.focused_board_reply(window, cx)
                {
                    this.file_reply(target, window, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .child(
                div()
                    .flex_shrink_0()
                    .px(px(20.))
                    .py(px(16.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .bg(rgb(p.paper_soft))
                    .child(tracked("Notes in the Margin", 11., 2.42, p.ink_muted))
                    .child(
                        div()
                            .mt(px(2.))
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(20.))
                            .line_height(relative(1.4))
                            .child("Marginalia"),
                    )
                    .child(
                        div()
                            .id("marginalia-counts")
                            .test_support()
                            .mt(px(8.))
                            .flex()
                            .flex_wrap()
                            .child(tracked(&count_text, 11., 2.2, p.ink_muted))
                            .when(counts.ghosts > 0, |row| {
                                row.child(div().ml(px(4.)).child(tracked(
                                    &format!(
                                        "· {} ghost{}",
                                        counts.ghosts,
                                        if counts.ghosts == 1 { "" } else { "s" }
                                    ),
                                    11.,
                                    2.2,
                                    p.vermilion,
                                )))
                            }),
                    )
                    .when(counts.ghosts > 0, |head| {
                        head.child(
                            text_button(
                                "marginalia-ghosts",
                                if self.ghosts_only {
                                    "✓ ghosts only"
                                } else {
                                    "show ghosts only"
                                },
                                if self.ghosts_only {
                                    p.vermilion
                                } else {
                                    p.ink_muted
                                },
                                cx,
                            )
                            .mt(px(8.))
                            .px(px(8.))
                            .py(px(2.))
                            .border_1()
                            .border_color(rgb(if self.ghosts_only {
                                p.vermilion
                            } else {
                                p.rule
                            }))
                            .rounded(px(1.))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.ghosts_only = !this.ghosts_only;
                                cx.notify();
                            })),
                        )
                    }),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .px(px(16.))
                    .py(px(12.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .bg(rgb(p.paper_soft))
                    .font_family(SANS_FONT)
                    .text_size(px(14.))
                    .line_height(relative(1.6))
                    .text_color(rgb(p.ink_light))
                    .child(StyledText::new(instructions).with_highlights([(
                        emphasis..emphasis + 10,
                        HighlightStyle {
                            font_weight: Some(FontWeight::BOLD),
                            ..Default::default()
                        },
                    )])),
            )
            .child(self.status(cx))
            .child(body)
    }
}
fn edit_erases(edit: &MarginaliaEdit) -> bool {
    match edit {
        MarginaliaEdit::Erase(_) => true,
        MarginaliaEdit::Batch(edits) => edits.iter().any(edit_erases),
        _ => false,
    }
}
fn control_id(kind: &str, target: &CommentRef) -> String {
    format!("marginalia-{kind}-{}-{}", target.folio_id, target.id)
}
fn tracked(text: &str, size: f32, tracking: f32, color: u32) -> AnyElement {
    tracked_text(&text.to_uppercase(), size, tracking, color)
}
fn tracked_text(text: &str, size: f32, tracking: f32, color: u32) -> AnyElement {
    crate::chrome::tracked_typewriter(text, size, tracking, color)
}
fn author_date(text: &str, color: u32) -> AnyElement {
    // GPUI's measured nodes expose box size, rather than a font baseline to
    // Taffy. The original Libre 12/16 + Special Elite 11/16.5 row places the
    // date 2px below the author, yielding an 18.5px row. Preserve that measured
    // mixed-font alignment without fixing the height of a whole comment card.
    div()
        .mt(px(2.))
        .child(tracked(text, 11., 1.65, color))
        .into_any_element()
}
fn text_button(id: impl Into<gpui_kit::ElementId>, label: &str, color: u32, cx: &App) -> Button {
    let transparent = rgb(0).opacity(0.).into();
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(transparent)
                .foreground(rgb(color).into())
                .hover(transparent)
                .active(transparent),
        )
        .h_auto()
        .p_0()
        .rounded_none()
        .text_color(rgb(color))
        .child(tracked(label, 11., 1.98, color))
}
fn icon_button(id: impl Into<gpui_kit::ElementId>, label: &str, glyph: &str, cx: &App) -> Button {
    let p = theme::palette(cx);
    let transparent = rgb(0).opacity(0.).into();
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(transparent)
                .foreground(rgb(p.ink_muted).into())
                .hover(transparent)
                .active(transparent),
        )
        .h(px(28.))
        .w(px(28.))
        .p_0()
        .child(
            div()
                .font_family(TYPEWRITER_FONT)
                .text_size(px(14.))
                .line_height(relative(1.))
                .child(glyph.to_owned()),
        )
}
fn markdown(id: impl Into<gpui_kit::ElementId>, text: &str, italic: bool, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    TextView::markdown(id, text.to_owned())
        .style(
            TextViewStyle::default()
                .with_foreground(rgb(p.ink_light).into())
                .with_muted_foreground(rgb(p.ink_muted).into())
                .with_link(rgb(p.blue).into())
                .with_border(rgb(p.rule).into())
                .with_paragraph_gap(rems(0.39375)),
        )
        .font_family(SERIF_FONT)
        .text_size(px(14.))
        .line_height(relative(1.6))
        .when(italic, |view| view.italic())
        .into_any_element()
}
fn mix(left: u32, l: f32, right: u32, r: f32) -> gpui_kit::Rgba {
    let left = rgb(left);
    let right = rgb(right);
    gpui_kit::Rgba {
        r: left.r * l + right.r * r,
        g: left.g * l + right.g * r,
        b: left.b * l + right.b * r,
        a: 1.,
    }
}
fn parse_color(value: &str) -> Option<u32> {
    let value = value.strip_prefix('#')?;
    match value.len() {
        6 => u32::from_str_radix(value, 16).ok(),
        3 => u32::from_str_radix(value, 16).ok().map(|v| {
            ((v & 0xf00) << 12)
                | ((v & 0xf00) << 8)
                | ((v & 0xf0) << 8)
                | ((v & 0xf0) << 4)
                | ((v & 0xf) << 4)
                | (v & 0xf)
        }),
        _ => None,
    }
}
fn truncate_utf16(text: &str, limit: usize) -> String {
    if text.encode_utf16().count() <= limit {
        return text.into();
    }
    let units = text
        .encode_utf16()
        .take(limit.saturating_sub(1))
        .collect::<Vec<_>>();
    format!("{}…", String::from_utf16_lossy(&units))
}
fn time_ago(at: u64, now: u64) -> String {
    let s = now.saturating_sub(at) / 1000;
    if s < 60 {
        "just now".into()
    } else if s < 3600 {
        format!("{}m ago", s / 60)
    } else if s < 86400 {
        format!("{}h ago", s / 3600)
    } else {
        format!("{}d ago", s / 86400)
    }
}
fn duration(ms: f64) -> String {
    let seconds = (ms.max(0.) / 1000.).round() as u64;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::marginalia::MarginaliaStore;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Point, ScrollDelta, TestAppContext, WindowBounds, WindowOptions, size,
    };
    use tempfile::TempDir;

    const FOLIO: &str = "web/folio:café";
    const NOTE: &str = "web/comment:café";
    const ANNOTATE: &str = "marginalia-annotate-web/folio:café-web/comment:café";
    const REPLY: &str = "marginalia-reply-input-web/folio:café-web/comment:café";
    const RESOLVE: &str = "marginalia-resolve-web/folio:café-web/comment:café";
    const ERASE: &str = "marginalia-erase-web/folio:café-web/comment:café";

    fn target() -> CommentRef {
        CommentRef {
            folio_id: FOLIO.into(),
            id: NOTE.into(),
        }
    }
    fn source_record() -> MarginaliaRecord {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/marginalia/web-reference.json"))
                .unwrap();
        MarginaliaRecord::from_value(&fixture["base"]).unwrap()
    }
    fn panel(
        cx: &mut TestAppContext,
        record: MarginaliaRecord,
        anchors: Option<Vec<String>>,
        capabilities: MarginaliaCapabilities,
    ) -> (
        AnyWindowHandle,
        Entity<MarginaliaView>,
        MarginaliaStore,
        TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(dir.path()).unwrap();
        std::fs::write(store.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        let (handle, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(360.), px(860.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        MarginaliaView::new(
                            Arc::new(record),
                            Some(FOLIO.into()),
                            anchors,
                            capabilities,
                            window,
                            cx,
                        )
                    })
                },
            )
            .unwrap()
        });
        (handle, view, store, dir)
    }
    fn received(
        cx: &mut TestAppContext,
        view: &Entity<MarginaliaView>,
    ) -> Arc<Mutex<Vec<MarginaliaEvent>>> {
        let result = Arc::new(Mutex::new(Vec::new()));
        let handler = result.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &MarginaliaEvent, _| {
                handler.lock().unwrap().push(event.clone());
            })
            .detach();
        });
        result
    }
    fn ack(
        view: &Entity<MarginaliaView>,
        store: &MarginaliaStore,
        request: &MarginaliaRequest,
        window: &mut Window,
        cx: &mut App,
    ) {
        let record = store.save_request(request).unwrap();
        view.update(cx, |view, cx| {
            assert!(view.ack_saved(request.request_id, record, window, cx));
        });
        window.render_frame(cx);
    }
    fn reveal(window: &mut Window, id: &'static str, cx: &mut App) {
        for _ in 0..15 {
            window.render_frame(cx);
            if window.try_find(id).is_some_and(|element| element.visible()) {
                return;
            }
            let delta = window.try_find(id).map_or(-240., |element| {
                if element.bounds().origin.y < window.find("marginalia-scroll").bounds().top() {
                    240.
                } else {
                    -240.
                }
            });
            window.scroll(
                "marginalia-scroll",
                ScrollDelta::Pixels(gpui_kit::point(px(0.), px(delta))),
                cx,
            );
        }
        assert!(window.find(id).visible(), "{id} must be reachable at 860px");
    }
    fn open_reply(view: &Entity<MarginaliaView>, window: &mut Window, cx: &mut App) {
        reveal(window, ANNOTATE, cx);
        window.click(ANNOTATE, cx);
        window.render_frame(cx);
        window.simulate_next_frame(cx);
        window.render_frame(cx);
        assert!(window.find(REPLY).visible());
        assert!(
            view.read(cx).inputs[&key(&target())]
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
    }

    #[gpui_kit::test]
    fn actual_ghost_filter_uses_supplied_ids_and_keeps_struck_and_foreign_scopes(
        cx: &mut TestAppContext,
    ) {
        let mut record = source_record();
        let mut ghost = record.comments[0].clone();
        ghost.id = "same-quote-no-mark".into();
        ghost.text = "A missing mark with the same quotation".into();
        let mut struck = record.comments[0].clone();
        struck.id = "struck:note".into();
        struck.resolved = true;
        record.comments.extend([ghost, struck]);
        let (handle, view, _, _dir) = panel(
            cx,
            record,
            Some(vec![
                NOTE.into(),
                "struck:note".into(),
                "headless:mark".into(),
            ]),
            MarginaliaCapabilities::local(),
        );
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                view.read(cx).counts(),
                MarginaliaCounts {
                    pending: 2,
                    struck: 1,
                    ghosts: 1,
                    anchors_known: true,
                }
            );
            assert!(
                window
                    .try_find("marginalia-card-not-imported:folio-foreign:note")
                    .is_none()
            );
            assert!(
                window
                    .try_find("marginalia-card-web/folio:café-headless:mark")
                    .is_none()
            );
            window.click("marginalia-ghosts", cx);
            assert_eq!(view.read(cx).counts().pending, 1);
            assert_eq!(view.read(cx).counts().struck, 1);
            assert!(
                window
                    .try_find("marginalia-card-web/folio:café-web/comment:café")
                    .is_none()
            );
            assert!(
                window
                    .try_find("marginalia-card-web/folio:café-struck:note")
                    .is_some()
            );
            window.click("marginalia-ghosts", cx);
            view.update(cx, |view, cx| view.set_anchors(None, cx));
            window.render_frame(cx);
            assert_eq!(view.read(cx).counts().ghosts, 0);
            assert!(!view.read(cx).counts().anchors_known);
            assert_eq!(view.read(cx).counts().pending, 2);
            assert!(window.try_find("marginalia-ghosts").is_none());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn actual_reply_keyboard_files_raw_last_character_only_after_exact_durable_ack(
        cx: &mut TestAppContext,
    ) {
        let original = source_record();
        let foreign = original.comments[1].clone();
        let (handle, view, store, _dir) = panel(
            cx,
            original.clone(),
            Some(vec![NOTE.into()]),
            MarginaliaCapabilities::local(),
        );
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            open_reply(&view, window, cx);
            window.input("  Café — keep the final é.  ", cx);
            window.press("ctrl-enter", cx);
            let pending = view.read(cx).pending_request().unwrap().clone();
            assert_eq!(view.read(cx).saved_record().comments, original.comments);
            assert_eq!(
                pending
                    .candidate
                    .comment(&target())
                    .unwrap()
                    .replies
                    .last()
                    .unwrap()
                    .text,
                "  Café — keep the final é.  "
            );
            assert_eq!(pending.candidate.comments[1], foreign);
            assert!(!pending.candidate.reply_drafts.contains_key(FOLIO));
            assert_eq!(
                view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE],
                "  Café — keep the final é.  "
            );
            assert!(
                !events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| matches!(event, MarginaliaEvent::Filed { .. }))
            );
            view.update(cx, |view, cx| {
                assert!(!view.ack_saved(Uuid::new_v4(), pending.candidate.clone(), window, cx));
            });
            ack(&view, &store, &pending, window, cx);
            assert!(view.read(cx).capture_reply_drafts(cx).is_empty());
            assert!(window.try_find(REPLY).is_none());
            let saved = store.load().unwrap().record;
            assert_eq!(saved.comment(&target()).unwrap().replies.len(), 2);
            assert_eq!(saved.comments[1], foreign);
            assert_eq!(
                saved.comment(&target()).unwrap().extra,
                original.comments[0].extra
            );
            assert_eq!(
                saved.comment(&target()).unwrap().audio_id,
                original.comments[0].audio_id
            );
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, MarginaliaEvent::Filed { .. }))
                .count(),
            1
        );
    }

    #[gpui_kit::test]
    fn actual_failed_strike_retry_restore_and_erase_advance_only_durable_metadata(
        cx: &mut TestAppContext,
    ) {
        let original = source_record();
        let foreign = original.comments[1].clone();
        let (handle, view, store, _dir) = panel(
            cx,
            original,
            Some(vec![NOTE.into()]),
            MarginaliaCapabilities::local(),
        );
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(RESOLVE, cx);
            let strike = view.read(cx).pending_request().unwrap().clone();
            assert!(
                !view
                    .read(cx)
                    .saved_record()
                    .comment(&target())
                    .unwrap()
                    .resolved
            );
            let backup = store.path().with_extension("json.bak");
            std::fs::create_dir(&backup).unwrap();
            let error = store.save_request(&strike).unwrap_err();
            view.update(cx, |view, cx| {
                assert!(view.report_error(strike.request_id, error.to_string(), cx));
            });
            window.render_frame(cx);
            assert_eq!(view.read(cx).counts().pending, 1);
            assert_eq!(view.read(cx).counts().struck, 0);
            assert_eq!(store.load().unwrap().record.comments[1], foreign);
            assert!(
                !events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| matches!(event, MarginaliaEvent::Filed { .. }))
            );
            std::fs::remove_dir(backup).unwrap();
            window.click("marginalia-retry", cx);
            assert_eq!(view.read(cx).pending_request().unwrap(), &strike);
            ack(&view, &store, &strike, window, cx);
            assert_eq!(view.read(cx).counts().struck, 1);
            reveal(window, RESOLVE, cx);
            window.click(RESOLVE, cx);
            let restore = view.read(cx).pending_request().unwrap().clone();
            assert!(
                view.read(cx)
                    .saved_record()
                    .comment(&target())
                    .unwrap()
                    .resolved
            );
            ack(&view, &store, &restore, window, cx);
            assert_eq!(view.read(cx).counts().pending, 1);
            reveal(window, ERASE, cx);
            window.click(ERASE, cx);
            let erase = view.read(cx).pending_request().unwrap().clone();
            assert_eq!(erase.effects, vec![MarginaliaEffect::Erased(target())]);
            assert!(view.read(cx).saved_record().comment(&target()).is_some());
            ack(&view, &store, &erase, window, cx);
            assert!(store.load().unwrap().record.comment(&target()).is_none());
            assert_eq!(store.load().unwrap().record.comments, vec![foreign]);
        })
        .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, MarginaliaEvent::Filed { .. }))
                .count(),
            3
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, MarginaliaEvent::SaveRequested(_)))
                .count(),
            4
        );
    }

    #[gpui_kit::test]
    fn held_reply_draft_survives_scope_and_disk_recreation_with_window_free_capture(
        cx: &mut TestAppContext,
    ) {
        let original = source_record();
        let (handle, view, store, _dir) = panel(
            cx,
            original.clone(),
            Some(vec![NOTE.into()]),
            MarginaliaCapabilities::local(),
        );
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            open_reply(&view, window, cx);
            window.input("Draft with one final café", cx);
            window.press("tab", cx);
            assert_eq!(
                view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE],
                "Draft with one final café"
            );
            assert!(
                !view.read(cx).inputs[&key(&target())]
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            );
            view.update(cx, |view, cx| {
                assert!(!view.set_scope(Some("not-imported:folio".into()), None, window, cx));
            });
            let draft = view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert!(draft.effects.is_empty());
            assert_eq!(draft.candidate.comments, original.comments);
            assert_eq!(
                view.update(cx, |view, cx| view
                    .prepare_pending_edits(cx)
                    .unwrap()
                    .unwrap()),
                draft
            );
            ack(&view, &store, &draft, window, cx);
            view.update(cx, |view, cx| {
                assert!(view.set_scope(Some("not-imported:folio".into()), None, window, cx));
            });
            window.render_frame(cx);
            assert_eq!(view.read(cx).counts().struck, 1);
            view.update(cx, |view, cx| {
                assert!(view.set_scope(Some(FOLIO.into()), None, window, cx));
            });
            open_reply(&view, window, cx);
            assert_eq!(
                view.read(cx).inputs[&key(&target())]
                    .read(cx)
                    .text()
                    .to_string(),
                "Draft with one final café"
            );
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, MarginaliaEvent::SaveRequested(_)))
                .count(),
            1
        );

        let recovered = store.load().unwrap().record.as_ref().clone();
        let (fresh_window, fresh, _, _fresh_dir) =
            panel(cx, recovered, None, MarginaliaCapabilities::local());
        cx.update_window(fresh_window, |_, window, cx| {
            open_reply(&fresh, window, cx);
            assert_eq!(
                fresh.read(cx).inputs[&key(&target())]
                    .read(cx)
                    .text()
                    .to_string(),
                "Draft with one final café"
            );
            assert_eq!(fresh.read(cx).saved_record().comments, original.comments);
            window.click(
                "marginalia-cancel-reply-web/folio:café-web/comment:café",
                cx,
            );
            let cancel = fresh.read(cx).pending_request().unwrap();
            assert!(cancel.effects.is_empty());
            assert!(cancel.candidate.reply_drafts.is_empty());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn absent_mark_removal_provider_and_anchor_capabilities_cannot_publish_actions(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _, _dir) = panel(
            cx,
            source_record(),
            None,
            MarginaliaCapabilities {
                persist: true,
                ..Default::default()
            },
        );
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            for id in [
                ERASE,
                "marginalia-ask-web/folio:café-web/comment:café",
                "marginalia-audio-web/folio:café-web/comment:café",
            ] {
                window.click(id, cx);
            }
            assert!(view.read(cx).pending_request().is_none());
            assert_eq!(view.read(cx).counts().ghosts, 0);
            assert!(
                window
                    .try_find("marginalia-jump-web/folio:café-web/comment:café")
                    .is_none()
            );
            view.update(cx, |view, cx| {
                assert!(
                    view.request_edit(
                        MarginaliaEdit::Batch(vec![MarginaliaEdit::Batch(vec![
                            MarginaliaEdit::Erase(vec![target()])
                        ])]),
                        window,
                        cx
                    )
                    .is_err()
                );
                view.set_capabilities(MarginaliaCapabilities::default(), cx);
            });
            window.render_frame(cx);
            window.click(RESOLVE, cx);
            window.click(ANNOTATE, cx);
            assert!(view.read(cx).pending_request().is_none());
            assert!(view.read(cx).inputs.is_empty());
        })
        .unwrap();
        assert!(events.lock().unwrap().is_empty());
    }

    #[gpui_kit::test]
    fn real_lower_reply_is_revealed_and_tab_preserves_text_at_desktop_height(
        cx: &mut TestAppContext,
    ) {
        let mut record = source_record();
        for index in 0..4 {
            let mut comment = record.comments[0].clone();
            comment.id = format!("middle:{index}");
            record.comments.push(comment);
        }
        let mut last = record.comments[0].clone();
        last.id = "last:note".into();
        record.comments.push(last);
        let (handle, view, _, _dir) = panel(cx, record, None, MarginaliaCapabilities::local());
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            let annotate = "marginalia-annotate-web/folio:café-last:note";
            let reply = "marginalia-reply-input-web/folio:café-last:note";
            assert!(!window.find(annotate).visible());
            reveal(window, annotate, cx);
            window.click(annotate, cx);
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find(reply).visible());
            let bounds = window.find(reply).bounds();
            let viewport = window.find("marginalia-scroll").bounds();
            assert!(bounds.top() >= viewport.top());
            assert!(bounds.bottom() <= viewport.bottom());
            window.input("A lower note keeps its final character", cx);
            window.press("tab", cx);
            assert_eq!(
                view.read(cx).capture_reply_drafts(cx)[FOLIO]["last:note"],
                "A lower note keeps its final character"
            );
            assert!(view.read(cx).pending_request().is_none());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn inline_handoff_reuses_one_rope_and_returns_held_board_reply_before_filing(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _dir) = panel(
            cx,
            source_record(),
            Some(vec![NOTE.into()]),
            MarginaliaCapabilities::local(),
        );
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            open_reply(&view, window, cx);
            window.input("Held on the Board — café", cx);
            let held = view.read(cx).inputs[&key(&target())].clone();
            let handed = view.update(cx, |view, cx| {
                view.reply_input(&target(), window, cx).unwrap()
            });
            assert_eq!(held.entity_id(), handed.entity_id());
            view.update(cx, |view, cx| {
                assert!(view.set_inline_thread(Some(target()), cx));
                assert!(
                    view.reply_input(
                        &CommentRef {
                            folio_id: "not-imported:folio".into(),
                            id: "foreign:note".into()
                        },
                        window,
                        cx
                    )
                    .is_err()
                );
                assert!(!view.set_inline_thread(
                    Some(CommentRef {
                        folio_id: FOLIO.into(),
                        id: "unplaced-composer".into()
                    }),
                    cx
                ));
            });
            window.render_frame(cx);
            assert!(window.try_find(REPLY).is_none());
            window.click(ANNOTATE, cx);
            assert!(window.try_find(REPLY).is_none());
            let strike = view.update(cx, |view, cx| {
                view.request_edit(
                    MarginaliaEdit::SetResolved {
                        target: target(),
                        resolved: true,
                    },
                    window,
                    cx,
                )
                .unwrap()
                .unwrap()
            });
            ack(&view, &store, &strike, window, cx);
            view.update(cx, |view, cx| {
                let resolved_rope = view.reply_input(&target(), window, cx).unwrap();
                assert_eq!(held.entity_id(), resolved_rope.entity_id());
                assert!(view.set_inline_thread(Some(target()), cx));
            });
            assert!(window.try_find(ANNOTATE).is_none());
            let restore = view.update(cx, |view, cx| {
                view.request_edit(
                    MarginaliaEdit::SetResolved {
                        target: target(),
                        resolved: false,
                    },
                    window,
                    cx,
                )
                .unwrap()
                .unwrap()
            });
            ack(&view, &store, &restore, window, cx);
            // Root's real inline card owns mounting and focus. This checks the
            // additive shared-state contract without fabricating a mark/card.
            handed.update(cx, |input, cx| {
                input.set_value("The inline rope keeps its final café", window, cx)
            });
            assert_eq!(
                view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE],
                "The inline rope keeps its final café"
            );
            view.update(cx, |view, cx| assert!(view.set_inline_thread(None, cx)));
            window.render_frame(cx);
            window.render_frame(cx);
            assert!(window.find(REPLY).visible());
            window.click(REPLY, cx);
            window.press("ctrl-enter", cx);
            let request = view.read(cx).pending_request().unwrap().clone();
            assert_eq!(
                request
                    .candidate
                    .comment(&target())
                    .unwrap()
                    .replies
                    .last()
                    .unwrap()
                    .text,
                "The inline rope keeps its final café"
            );
            assert_eq!(
                held.read(cx).text().to_string(),
                "The inline rope keeps its final café"
            );
            ack(&view, &store, &request, window, cx);
            assert!(held.read(cx).text().to_string().is_empty());
            assert_eq!(
                store
                    .load()
                    .unwrap()
                    .record
                    .comment(&target())
                    .unwrap()
                    .replies
                    .last()
                    .unwrap()
                    .text,
                "The inline rope keeps its final café"
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn verified_orphan_ack_preserves_actual_unblurred_reply_without_erase_capability(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _dir) = panel(
            cx,
            source_record(),
            Some(vec![NOTE.into()]),
            MarginaliaCapabilities {
                persist: true,
                ..Default::default()
            },
        );
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            open_reply(&view, window, cx);
            window.input("The removed anchor keeps this final café", cx);
            let held = view.read(cx).inputs[&key(&target())].clone();
            let request = view.update(cx, |view, cx| {
                view.request_edit(
                    MarginaliaEdit::Reconcile {
                        folio_id: FOLIO.into(),
                        mark_ids: vec!["headless:verified".into()],
                    },
                    window,
                    cx,
                )
                .unwrap()
                .unwrap()
            });
            assert!(view.read(cx).saved_record().comment(&target()).is_some());
            assert_eq!(request.effects, vec![MarginaliaEffect::Orphaned(target())]);
            assert_eq!(
                request.candidate.reply_drafts[FOLIO][NOTE],
                "The removed anchor keeps this final café"
            );
            assert!(
                events
                    .lock()
                    .unwrap()
                    .iter()
                    .all(|event| !matches!(event, MarginaliaEvent::Filed { .. }))
            );
            ack(&view, &store, &request, window, cx);
            assert!(view.read(cx).saved_record().comment(&target()).is_none());
            assert!(
                view.read(cx)
                    .saved_record()
                    .comments
                    .iter()
                    .any(|note| note.folio_id == "not-imported:folio")
            );
            assert_eq!(view.read(cx).counts().pending, 0);
            assert!(window.try_find(REPLY).is_none());
            assert_eq!(
                view.read(cx).inputs[&key(&target())].entity_id(),
                held.entity_id()
            );
            assert_eq!(
                held.read(cx).text().to_string(),
                "The removed anchor keeps this final café"
            );
            assert_eq!(
                view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE],
                "The removed anchor keeps this final café"
            );
            view.update(cx, |view, cx| {
                assert!(view.reply_input(&target(), window, cx).is_err())
            });
            assert_eq!(
                store.load().unwrap().record.reply_drafts[FOLIO][NOTE],
                "The removed anchor keeps this final café"
            );
        })
        .unwrap();
    }
}
