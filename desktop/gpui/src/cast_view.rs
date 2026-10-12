//! The local Cast: retained editorial artifacts and recoverable writer replies.
//! Provider work and manuscript persona marks belong to the host application.

use crate::{
    cast::{
        self, AssistanceLevel, CastEdit, CastEffect, CastNoteRef, CastPersonaDraft, CastRecord,
        CastReplyDrafts, CastRequest, CastSession, Persona, PersonaFeedback, PersonaField,
        PersonaReply, PersonaReplyAuthor, RoomSettings,
    },
    exchange::OptionalField,
    house::is_js_whitespace,
    manuscript::timestamp,
    theme::{self, DISPLAY_FONT, SERIF_FONT, TYPEWRITER_FONT},
};
use anyhow::{Result, ensure};
use gpui_kit::base::text::{TextView, TextViewStyle};
use gpui_kit::component::{
    Disableable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::{IndentInline, Input, InputEvent, InputState, OutdentInline, Textarea, TextareaState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable,
    FontWeight, Render, ScrollHandle, SharedString, Subscription, TestSupportExt, TextAlign,
    Window, div, font, px, relative, rems, rgb,
};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CastSurface {
    #[default]
    Board,
    Manager,
    Analysis,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CastBriefLabel {
    pub title: Option<String>,
    pub format: Option<String>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CastCapabilities {
    pub persist: bool,
    pub generate_notes: bool,
    pub propose_edits: bool,
    pub generate_analysis: bool,
    pub ask_editor: bool,
    pub speak: bool,
    pub persona_anchors: bool,
    pub clear_room: bool,
    pub analytics: bool,
    pub background_reading: bool,
}
impl CastCapabilities {
    pub fn local() -> Self {
        Self {
            persist: true,
            ..Self::default()
        }
    }
}
#[derive(Clone, Debug)]
pub enum CastEvent {
    SaveRequested(CastRequest),
    Filed {
        request_id: Uuid,
        effects: Vec<CastEffect>,
    },
    SurfaceRequested(CastSurface),
    BackToDesk,
    DownloadAnalysis {
        folio_id: String,
        filename: String,
        markdown: String,
    },
    JumpToPersonaNote(CastNoteRef),
    GetNotesRequested {
        folio_id: String,
    },
    ProposeEditsRequested {
        folio_id: String,
    },
    RunAnalysisRequested {
        folio_id: String,
    },
    AskEditor {
        target: CastNoteRef,
        text: String,
    },
    AskForFix(CastNoteRef),
    Speak {
        persona_id: String,
        text: String,
    },
    ClearRoomRequested {
        folio_id: String,
    },
    FeedbackRequested {
        target: CastNoteRef,
        helpful: bool,
    },
}
/// File-only has its own visible action. Source Ctrl/Cmd+Enter asks a provider;
/// it is deliberately not rebound to a different offline operation here.
pub fn init(_: &mut App) {}

type ReplyKey = (String, String);
fn reply_key(target: &CastNoteRef) -> ReplyKey {
    (target.folio_id.clone(), target.id.clone())
}
enum FieldControl {
    Single(Entity<InputState>),
    Multi(Entity<TextareaState>),
}
impl FieldControl {
    fn text(&self, cx: &App) -> String {
        match self {
            Self::Single(input) => input.read(cx).text().to_string(),
            Self::Multi(input) => input.read(cx).text().to_string(),
        }
    }
}
#[derive(Clone)]
enum AfterAck {
    None,
    CloseRoster,
    CloseReply(CastNoteRef),
}

pub struct CastView {
    session: CastSession,
    active_folio_id: Option<String>,
    brief: CastBriefLabel,
    anchors: Option<HashSet<String>>,
    capabilities: CastCapabilities,
    surface: CastSurface,
    roster: Vec<Persona>,
    roster_draft: Option<CastPersonaDraft>,
    fields: BTreeMap<PersonaField, FieldControl>,
    reply_inputs: BTreeMap<ReplyKey, Entity<TextareaState>>,
    replying_to: Option<CastNoteRef>,
    subscriptions: Vec<Subscription>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    controls_collapsed: bool,
    settings_open: bool,
    group_by_persona: bool,
    compact: bool,
    expanded_notes: HashSet<String>,
    expanded_personas: HashSet<String>,
    collapsed_memos: HashSet<String>,
    show_prompt: Option<String>,
    confirm_reset: bool,
    after_ack: AfterAck,
    local_error: Option<String>,
    copied: Option<String>,
    analysis_filed_label: Option<String>,
}
impl EventEmitter<CastEvent> for CastView {}
impl Focusable for CastView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl CastView {
    pub fn new(
        record: Arc<CastRecord>,
        active_folio_id: Option<String>,
        brief: CastBriefLabel,
        anchors: Option<Vec<String>>,
        capabilities: CastCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let roster = cast::mounted_personas(&record.personas);
        let roster_draft = record.roster_draft.clone();
        let mut view = Self {
            session: CastSession::new(record),
            active_folio_id,
            brief,
            anchors: anchors.map(|ids| ids.into_iter().collect()),
            capabilities,
            surface: CastSurface::Board,
            roster,
            roster_draft,
            fields: BTreeMap::new(),
            reply_inputs: BTreeMap::new(),
            replying_to: None,
            subscriptions: Vec::new(),
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            controls_collapsed: false,
            settings_open: false,
            group_by_persona: true,
            compact: true,
            expanded_notes: HashSet::new(),
            expanded_personas: HashSet::new(),
            collapsed_memos: HashSet::new(),
            show_prompt: None,
            confirm_reset: false,
            after_ack: AfterAck::None,
            local_error: None,
            copied: None,
            analysis_filed_label: None,
        };
        view.hydrate_fields(window, cx);
        view
    }
    pub fn saved_record(&self) -> &Arc<CastRecord> {
        self.session.saved()
    }
    pub fn pending_request(&self) -> Option<&CastRequest> {
        self.session.pending()
    }
    pub fn active_folio_id(&self) -> Option<&str> {
        self.active_folio_id.as_deref()
    }
    pub fn surface(&self) -> CastSurface {
        self.surface
    }
    pub fn capabilities(&self) -> CastCapabilities {
        self.capabilities
    }
    pub fn set_capabilities(&mut self, capabilities: CastCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn set_anchors(&mut self, anchors: Option<Vec<String>>, cx: &mut Context<Self>) {
        self.anchors = anchors.map(|ids| ids.into_iter().collect());
        cx.notify();
    }
    /// Root supplies the original locale/date label when available. Otherwise
    /// exports use an explicitly deterministic local timestamp label.
    pub fn set_analysis_filed_label(&mut self, label: Option<String>, cx: &mut Context<Self>) {
        self.analysis_filed_label = label;
        cx.notify();
    }
    pub fn set_scope(
        &mut self,
        folio_id: Option<String>,
        brief: CastBriefLabel,
        anchors: Option<Vec<String>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.session.pending().is_some() && self.active_folio_id != folio_id {
            return false;
        }
        if self.active_folio_id != folio_id {
            self.replying_to = None;
            self.copied = None;
            self.analysis_filed_label = None;
            self.collapsed_memos.clear();
        }
        self.active_folio_id = folio_id;
        self.brief = brief;
        self.anchors = anchors.map(|ids| ids.into_iter().collect());
        cx.notify();
        true
    }
    pub fn set_surface(&mut self, surface: CastSurface, _: &mut Window, cx: &mut Context<Self>) {
        self.surface = surface;
        self.scroll_handle = ScrollHandle::new();
        cx.notify();
    }
    fn writable(&self) -> bool {
        self.capabilities.persist && self.session.pending().is_none()
    }
    fn navigate_form_tab(&mut self, reverse: bool, window: &mut Window, cx: &mut Context<Self>) {
        let focused = self.fields.values().any(|field| match field {
            FieldControl::Multi(input) => input.read(cx).focus_handle(cx).is_focused(window),
            FieldControl::Single(_) => false,
        }) || self
            .reply_inputs
            .values()
            .any(|input| input.read(cx).focus_handle(cx).is_focused(window));
        if focused {
            if reverse {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
            cx.stop_propagation();
            cx.notify();
        } else {
            cx.propagate();
        }
    }
    pub fn capture_reply_drafts(&self, cx: &App) -> CastReplyDrafts {
        let mut drafts = self.session.saved().reply_drafts.clone();
        for ((scope, id), input) in &self.reply_inputs {
            let text = input.read(cx).text().to_string();
            if text.is_empty() {
                if let Some(scoped) = drafts.get_mut(scope) {
                    scoped.remove(id);
                    if scoped.is_empty() {
                        drafts.remove(scope);
                    }
                }
            } else {
                drafts
                    .entry(scope.clone())
                    .or_default()
                    .insert(id.clone(), text);
            }
        }
        drafts
    }
    pub fn capture_roster_draft(&self, cx: &App) -> Option<CastPersonaDraft> {
        self.roster_draft.clone().map(|mut draft| {
            for (field, input) in &self.fields {
                let value = input.text(cx);
                // maxLength=2 in the source form is UTF-16, not Unicode scalars.
                let value = if *field == PersonaField::Icon {
                    limit_utf16(&value, 2)
                } else {
                    value
                };
                draft.fields.insert(*field, value);
            }
            draft
        })
    }
    pub fn has_unsaved_changes(&self, cx: &App) -> bool {
        self.session.pending().is_some()
            || self.capture_reply_drafts(cx) != self.session.saved().reply_drafts
            || self.capture_roster_draft(cx) != self.session.saved().roster_draft
    }
    fn recovery(&self, cx: &App) -> CastEdit {
        CastEdit::Recovery {
            reply_drafts: self.capture_reply_drafts(cx),
            roster_draft: self.capture_roster_draft(cx).map(Box::new),
        }
    }
    pub fn prepare_pending_edits(&mut self, cx: &mut Context<Self>) -> Result<Option<CastRequest>> {
        if let Some(request) = self.session.pending() {
            return Ok(Some(request.clone()));
        }
        if !self.has_unsaved_changes(cx) {
            return Ok(None);
        }
        ensure!(
            self.capabilities.persist,
            "Cast drafts are still held here; local filing is unavailable."
        );
        self.issue(self.recovery(cx), AfterAck::None, cx)
    }
    pub fn flush_pending_edits(
        &mut self,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<CastRequest>> {
        self.prepare_pending_edits(cx)
    }
    pub fn request_edit(
        &mut self,
        edit: CastEdit,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<CastRequest>> {
        ensure!(
            self.writable(),
            "Finish the previous Cast save before filing another change."
        );
        self.issue(
            CastEdit::Batch(vec![self.recovery(cx), edit]),
            AfterAck::None,
            cx,
        )
    }
    fn issue(
        &mut self,
        edit: CastEdit,
        after_ack: AfterAck,
        cx: &mut Context<Self>,
    ) -> Result<Option<CastRequest>> {
        ensure!(
            self.capabilities.persist,
            "Local Cast filing is unavailable."
        );
        let request = self.session.request(edit)?;
        self.local_error = None;
        if let Some(request) = &request {
            self.after_ack = after_ack;
            cx.emit(CastEvent::SaveRequested(request.clone()));
        }
        cx.notify();
        Ok(request)
    }
    fn local_result(&mut self, result: Result<Option<CastRequest>>, cx: &mut Context<Self>) {
        if let Err(error) = result {
            self.local_error = Some(error.to_string());
            cx.notify();
        }
    }
    pub fn ack_saved(
        &mut self,
        request_id: Uuid,
        record: Arc<CastRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let effects = self
            .session
            .pending()
            .map(|r| r.effects.clone())
            .unwrap_or_default();
        if !self.session.acknowledge_saved(request_id, record) {
            return false;
        }
        if effects
            .iter()
            .any(|effect| matches!(effect, CastEffect::RosterChanged))
        {
            self.roster = self
                .session
                .saved()
                .personas
                .as_ref()
                .cloned()
                .unwrap_or_default();
            self.confirm_reset = false;
        }
        match std::mem::replace(&mut self.after_ack, AfterAck::None) {
            AfterAck::CloseRoster => {
                self.roster_draft = None;
                self.fields.clear();
            }
            AfterAck::CloseReply(target) => {
                if let Some(input) = self.reply_inputs.get(&reply_key(&target)) {
                    input.update(cx, |input, cx| input.set_value("", window, cx));
                }
                if self.replying_to.as_ref() == Some(&target) {
                    self.replying_to = None;
                }
            }
            AfterAck::None => {}
        }
        self.local_error = None;
        cx.emit(CastEvent::Filed {
            request_id,
            effects,
        });
        cx.notify();
        true
    }
    pub fn report_error(
        &mut self,
        request_id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.session.report_error(request_id, message) {
            return false;
        }
        cx.notify();
        true
    }
    pub fn retry(&mut self, cx: &mut Context<Self>) -> Option<CastRequest> {
        let request = self.session.retry()?;
        cx.emit(CastEvent::SaveRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn replace_record(
        &mut self,
        record: Arc<CastRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.has_unsaved_changes(cx) {
            return false;
        }
        let roster_changed = self.session.saved().personas != record.personas;
        if !self.session.replace_record(record) {
            return false;
        }
        if roster_changed {
            self.roster = self
                .session
                .saved()
                .personas
                .as_ref()
                .cloned()
                .unwrap_or_default();
        }
        self.roster_draft = self.session.saved().roster_draft.clone();
        self.hydrate_fields(window, cx);
        for ((scope, id), input) in &self.reply_inputs {
            let text = self
                .session
                .saved()
                .reply_drafts
                .get(scope)
                .and_then(|d| d.get(id))
                .cloned()
                .unwrap_or_default();
            input.update(cx, |input, cx| input.set_value(text, window, cx));
        }
        cx.notify();
        true
    }
    fn hydrate_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.fields.clear();
        let Some(draft) = self.roster_draft.clone() else {
            return;
        };
        for field in PersonaField::ALL {
            let value = draft.get(field).to_owned();
            let control = if field.is_multiline() {
                let input = cx.new(|cx| TextareaState::new(window, cx).default_value(value));
                self.subscriptions
                    .push(cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify()));
                FieldControl::Multi(input)
            } else {
                let input = cx.new(|cx| InputState::new(window, cx).default_value(value));
                self.subscriptions
                    .push(cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify()));
                FieldControl::Single(input)
            };
            self.fields.insert(field, control);
        }
    }
    fn begin_editor(&mut self, id: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        if !self.writable() {
            return;
        }
        self.roster_draft = match id {
            Some(id) => self
                .roster
                .iter()
                .find(|p| p.id == id)
                .map(CastPersonaDraft::edit),
            None => Some(CastPersonaDraft::new_editor()),
        };
        self.hydrate_fields(window, cx);
        self.local_error = None;
        if let Some(FieldControl::Single(input)) = self.fields.get(&PersonaField::Name) {
            let focus = input.read(cx).focus_handle(cx);
            focus.focus(window, cx);
        }
        cx.notify();
    }
    fn save_editor(&mut self, cx: &mut Context<Self>) {
        let result = (|| {
            ensure!(self.writable(), "Local Cast filing is unavailable.");
            let draft = self
                .capture_roster_draft(cx)
                .ok_or_else(|| anyhow::anyhow!("No editor form is open."))?;
            let persona = draft.persona()?;
            let mut roster = self.roster.clone();
            if let Some(index) = roster.iter().position(|p| p.id == persona.id) {
                roster[index] = persona;
            } else {
                roster.push(persona);
            }
            self.issue(
                CastEdit::Batch(vec![
                    CastEdit::Recovery {
                        reply_drafts: self.capture_reply_drafts(cx),
                        roster_draft: None,
                    },
                    CastEdit::ReplaceRoster(roster),
                ]),
                AfterAck::CloseRoster,
                cx,
            )
        })();
        self.local_result(result, cx);
    }
    fn cancel_editor(&mut self, cx: &mut Context<Self>) {
        if !self.writable() {
            return;
        }
        self.roster_draft = None;
        self.fields.clear();
        self.local_error = None;
        let result = self.prepare_pending_edits(cx);
        self.local_result(result, cx);
        cx.notify();
    }
    fn roster_change(
        &mut self,
        roster: Vec<Persona>,
        settings: Option<RoomSettings>,
        cx: &mut Context<Self>,
    ) {
        if !self.writable() {
            return;
        }
        let mut edits = vec![self.recovery(cx), CastEdit::ReplaceRoster(roster)];
        if let Some(settings) = settings {
            edits.push(CastEdit::SetRoomSettings(settings));
        }
        let result = self.issue(CastEdit::Batch(edits), AfterAck::None, cx);
        self.local_result(result, cx);
    }
    fn move_editor(&mut self, id: &str, down: bool, cx: &mut Context<Self>) {
        let mut roster = self.roster.clone();
        if let Some(index) = roster.iter().position(|p| p.id == id) {
            let next = if down {
                index + 1
            } else {
                index.saturating_sub(1)
            };
            if next < roster.len() && next != index {
                roster.swap(index, next);
                self.roster_change(roster, None, cx);
            }
        }
    }
    fn remove_editor(&mut self, id: &str, cx: &mut Context<Self>) {
        let roster = self.roster.iter().filter(|p| p.id != id).cloned().collect();
        let mut settings = self.session.saved().settings();
        settings.removed_persona(id);
        self.roster_change(roster, Some(settings), cx);
    }
    fn settings_change(&mut self, change: impl FnOnce(&mut RoomSettings), cx: &mut Context<Self>) {
        if !self.writable() {
            return;
        }
        let mut settings = self.session.saved().settings();
        change(&mut settings);
        let result = self.issue(
            CastEdit::Batch(vec![self.recovery(cx), CastEdit::SetRoomSettings(settings)]),
            AfterAck::None,
            cx,
        );
        self.local_result(result, cx);
    }
    pub fn reply_input(
        &mut self,
        target: &CastNoteRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Entity<TextareaState>> {
        ensure!(
            self.active_folio_id.as_deref() == Some(target.folio_id.as_str())
                && self.session.saved().note(target).is_some(),
            "That retained Cast note is not in the current folio."
        );
        if let Some(input) = self.reply_inputs.get(&reply_key(target)) {
            return Ok(input.clone());
        }
        let text = self
            .session
            .saved()
            .reply_drafts
            .get(&target.folio_id)
            .and_then(|d| d.get(&target.id))
            .cloned()
            .unwrap_or_default();
        let input = cx.new(|cx| TextareaState::new(window, cx).default_value(text));
        self.subscriptions
            .push(cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify()));
        self.reply_inputs.insert(reply_key(target), input.clone());
        Ok(input)
    }
    fn open_reply(&mut self, target: CastNoteRef, window: &mut Window, cx: &mut Context<Self>) {
        if !self.writable() {
            return;
        }
        match self.reply_input(&target, window, cx) {
            Ok(input) => {
                self.replying_to = Some(target);
                input.read(cx).focus_handle(cx).focus(window, cx);
                cx.notify();
            }
            Err(error) => {
                self.local_error = Some(error.to_string());
                cx.notify();
            }
        }
    }
    fn file_reply(&mut self, target: CastNoteRef, cx: &mut Context<Self>) {
        let text = self
            .reply_inputs
            .get(&reply_key(&target))
            .map(|i| i.read(cx).text().to_string())
            .unwrap_or_default();
        let reply = PersonaReply::writer(&target, text, timestamp());
        let result = self.issue(
            CastEdit::Batch(vec![
                self.recovery(cx),
                CastEdit::FileReply {
                    target: target.clone(),
                    reply,
                },
            ]),
            AfterAck::CloseReply(target),
            cx,
        );
        self.local_result(result, cx);
    }
    fn scoped_notes(&self) -> &[PersonaFeedback] {
        self.active_folio_id
            .as_ref()
            .and_then(|id| self.session.saved().folios.get(id))
            .map_or(&[], |f| f.notes.as_slice())
    }
    fn can_jump(&self, target: &CastNoteRef) -> bool {
        self.capabilities.persona_anchors
            && self.active_folio_id.as_deref() == Some(target.folio_id.as_str())
            && self
                .anchors
                .as_ref()
                .is_some_and(|ids| ids.contains(&target.id))
    }
    fn analysis(&self) -> Option<&cast::RoomAnalysis> {
        self.active_folio_id
            .as_deref()
            .and_then(|id| self.session.saved().analysis(id))
    }
    fn request_surface(&mut self, surface: CastSurface, cx: &mut Context<Self>) {
        cx.emit(CastEvent::SurfaceRequested(surface));
    }
    fn status(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let error = self.session.error().or(self.local_error.as_deref());
        if let Some(error) = error {
            return div()
                .id("cast-save-error")
                .px(px(16.))
                .py(px(8.))
                .text_color(rgb(p.vermilion))
                .font_family(SERIF_FONT)
                .text_size(px(12.))
                .line_height(relative(1.5))
                .child(error.to_owned())
                .when(self.session.error().is_some(), |row| {
                    row.child(
                        text_button(
                            "cast-save-retry",
                            "Retry filing",
                            11.,
                            1.32,
                            p.vermilion,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.retry(cx);
                        })),
                    )
                })
                .test_support()
                .into_any_element();
        }
        if self.session.pending().is_some() {
            return div()
                .id("cast-saving")
                .px(px(16.))
                .py(px(6.))
                .child(tracked("Filing…", 10., 1., p.ink_muted))
                .test_support()
                .into_any_element();
        }
        div().into_any_element()
    }
    fn settings(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let settings = self.session.saved().settings();
        div()
            .mt(px(6.))
            .p(px(10.))
            .bg(rgb(p.paper_soft))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(tracked("Edit scope", 10., 1.4, p.ink_light))
            .child(
                div()
                    .flex()
                    .gap(px(4.))
                    .children(levels().into_iter().map(|level| {
                        let label = level_label(&level);
                        let selected = settings.level == level;
                        paper_button(
                            SharedString::from(format!("cast-level-{}", level.as_str())),
                            label,
                            cx,
                        )
                        .border_color(rgb(if selected { p.vermilion } else { p.rule }))
                        .disabled(!self.writable())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.settings_change(|s| s.level = level.clone(), cx)
                        }))
                    })),
            )
            .child(
                text_button(
                    "cast-background",
                    if settings.background_enabled() {
                        "☑ Read as I write"
                    } else {
                        "☐ Read as I write"
                    },
                    11.,
                    0.,
                    p.ink,
                    cx,
                )
                .disabled(!self.writable())
                .on_click(cx.listener(|this, _, _, cx| {
                    this.settings_change(
                        |s| s.background_room = OptionalField::Value(!s.background_enabled()),
                        cx,
                    )
                })),
            )
            .when(self.capabilities.background_reading, |column| {
                column.child(serif(
                    "Adds notes after 500 new words.",
                    10.,
                    1.6,
                    p.ink_muted,
                ))
            })
            .when(!self.capabilities.background_reading, |column| {
                column.child(serif(
                    "Background reading requires an available editor.",
                    10.,
                    1.6,
                    p.ink_muted,
                ))
            })
            .child(self.stepper(
                "cast-proposals",
                "Edits per pass",
                settings.max_proposals,
                (1, 20),
                false,
                cx,
            ))
            .child(self.stepper(
                "cast-large-edits",
                "Paragraph edits",
                settings.max_large_edits,
                (0, 10),
                true,
                cx,
            ))
            .into_any_element()
    }
    fn stepper(
        &self,
        id: &'static str,
        label: &str,
        value: u64,
        limits: (u64, u64),
        large: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let (min, max) = limits;
        let p = theme::palette(cx);
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(type_text(label, 11., p.ink))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        text_button(
                            SharedString::from(format!("{id}-less")),
                            "−",
                            12.,
                            0.,
                            p.ink,
                            cx,
                        )
                        .disabled(!self.writable() || value <= min)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.settings_change(
                                |s| {
                                    if large {
                                        s.max_large_edits = value.saturating_sub(1).clamp(min, max)
                                    } else {
                                        s.max_proposals = value.saturating_sub(1).clamp(min, max)
                                    }
                                },
                                cx,
                            )
                        })),
                    )
                    .child(type_text(&value.to_string(), 11., p.ink))
                    .child(
                        text_button(
                            SharedString::from(format!("{id}-more")),
                            "+",
                            12.,
                            0.,
                            p.ink,
                            cx,
                        )
                        .disabled(!self.writable() || value >= max)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.settings_change(
                                |s| {
                                    if large {
                                        s.max_large_edits = value.saturating_add(1).clamp(min, max)
                                    } else {
                                        s.max_proposals = value.saturating_add(1).clamp(min, max)
                                    }
                                },
                                cx,
                            )
                        })),
                    ),
            )
            .into_any_element()
    }
    fn board(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let count = self.scoped_notes().len();
        let scope = self.active_folio_id.clone();
        let settings = self.session.saved().settings();
        let has_analysis = self.analysis().is_some();
        let brief = format!(
            "{}{}",
            self.brief
                .title
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("Untitled project"),
            self.brief
                .format
                .as_deref()
                .filter(|s| !s.is_empty())
                .map(|s| format!(" · {s}"))
                .unwrap_or_default()
        );
        let mut controls = div()
            .px(px(12.))
            .py(px(10.))
            .border_b_1()
            .border_color(rgb(p.rule))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(tracked("Cast", 10., 1.6, p.vermilion))
                            .child(
                                div()
                                    .id("cast-roster-badges")
                                    .flex()
                                    .gap(px(4.))
                                    .children(
                                        self.roster
                                            .iter()
                                            .map(|persona| badge(persona, 21.6, 11.2, cx)),
                                    )
                                    .test_support(),
                            ),
                    )
                    .child(
                        text_button(
                            "cast-edit-roster",
                            "Edit cast →",
                            10.4,
                            1.248,
                            p.ink_light,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.request_surface(CastSurface::Manager, cx)
                        })),
                    ),
            )
            .child(
                div()
                    .mt(px(8.))
                    .flex()
                    .gap(px(8.))
                    .child(
                        press_button("cast-get-notes", "✦ Get notes", cx)
                            .flex_1()
                            .h(px(36.))
                            .disabled(!self.capabilities.generate_notes || scope.is_none())
                            .on_click(cx.listener(|this, _, _, cx| {
                                if this.capabilities.generate_notes
                                    && let Some(folio_id) = this.active_folio_id.clone()
                                {
                                    cx.emit(CastEvent::GetNotesRequested { folio_id });
                                }
                            })),
                    )
                    .when(settings.level != AssistanceLevel::Comments, |row| {
                        row.child(
                            room_action_button("cast-propose-edits", "✎ Propose edits", cx)
                                .flex_1()
                                .h(px(36.))
                                .disabled(!self.capabilities.propose_edits || scope.is_none())
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if this.capabilities.propose_edits
                                        && let Some(folio_id) = this.active_folio_id.clone()
                                    {
                                        cx.emit(CastEvent::ProposeEditsRequested { folio_id });
                                    }
                                })),
                        )
                    }),
            )
            .child(
                div().mt(px(4.)).flex().justify_center().child(
                    text_button(
                        "cast-analysis",
                        if has_analysis {
                            "❡ Open full analysis ↗"
                        } else {
                            "❡ Run full analysis ↗"
                        },
                        11.,
                        1.65,
                        p.ink_muted,
                        cx,
                    )
                    .py(px(3.2))
                    .disabled(!has_analysis && !self.capabilities.generate_analysis)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.analysis().is_some() {
                            this.request_surface(CastSurface::Analysis, cx);
                        } else if this.capabilities.generate_analysis
                            && let Some(folio_id) = this.active_folio_id.clone()
                        {
                            cx.emit(CastEvent::RunAnalysisRequested { folio_id });
                        }
                    })),
                ),
            )
            .child(
                div().mt(px(6.)).child(
                    text_button(
                        "cast-settings-toggle",
                        if self.settings_open {
                            "▾ Room settings"
                        } else {
                            "▸ Room settings"
                        },
                        11.,
                        0.,
                        p.ink_light,
                        cx,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.settings_open = !this.settings_open;
                        cx.notify();
                    })),
                ),
            );
        if self.settings_open {
            controls = controls.child(self.settings(cx));
        }
        let notes = self.note_indices();
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .child(
                div()
                    .px(px(16.))
                    .py(px(12.))
                    .bg(rgb(p.paper_soft))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .child(
                        div()
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(18.))
                            .line_height(relative(28. / 18.))
                            .child("The Room of Editors"),
                    )
                    .child(
                        div()
                            .mt(px(2.))
                            .font_family(SERIF_FONT)
                            .italic()
                            .text_size(px(11.2))
                            .line_height(relative(1.5))
                            .text_color(rgb(p.ink_light))
                            .child(brief),
                    ),
            )
            .child(
                text_button(
                    "cast-controls-toggle",
                    if self.controls_collapsed {
                        "▸ Show controls"
                    } else {
                        "▾ Hide controls"
                    },
                    11.,
                    0.,
                    p.ink_light,
                    cx,
                )
                .w_full()
                .px(px(16.))
                .py(px(6.))
                .border_b_1()
                .border_color(rgb(p.rule))
                .on_click(cx.listener(|this, _, _, cx| {
                    this.controls_collapsed = !this.controls_collapsed;
                    cx.notify();
                })),
            )
            .when(!self.controls_collapsed, |column| column.child(controls))
            .child(self.status(cx))
            .child(
                div()
                    .px(px(16.))
                    .py(px(6.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(type_text(
                        &format!("{count} note{}", if count == 1 { "" } else { "s" }),
                        10.,
                        p.ink_muted,
                    ))
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                text_button(
                                    "cast-group-toggle",
                                    if self.group_by_persona {
                                        "▾ grouped"
                                    } else {
                                        "▸ all notes"
                                    },
                                    10.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.group_by_persona = !this.group_by_persona;
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                text_button(
                                    "cast-compact-toggle",
                                    if self.compact {
                                        "▸ compact"
                                    } else {
                                        "▾ full"
                                    },
                                    10.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.compact = !this.compact;
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                text_button("cast-clear-room", "clear", 10., 0., p.ink_muted, cx)
                                    .disabled(!self.capabilities.clear_room || scope.is_none())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        if this.capabilities.clear_room
                                            && let Some(folio_id) = this.active_folio_id.clone()
                                        {
                                            cx.emit(CastEvent::ClearRoomRequested { folio_id });
                                        }
                                    })),
                            ),
                    ),
            )
            .child(
                div()
                    .id("cast-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll_handle)
                    .px(px(16.))
                    .py(px(12.))
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .when(count == 0, |feed| {
                        feed.child(
                            div()
                                .p(px(24.))
                                .flex()
                                .flex_col()
                                .items_center()
                                .child(serif("❦", 20., 1.5, p.vermilion))
                                .child(div().mt(px(8.)).child(serif(
                                    "No notes yet. Retained editorial notes appear here.",
                                    14.,
                                    1.5,
                                    p.ink_muted,
                                )))
                                .child(div().mt(px(4.)).child(serif(
                                    "Getting new notes requires an available editor.",
                                    11.,
                                    1.5,
                                    p.ink_muted,
                                ))),
                        )
                    })
                    .children(notes.into_iter().map(|index| self.note_card(index, cx)))
                    .test_support(),
            )
            .into_any_element()
    }
    fn note_indices(&self) -> Vec<usize> {
        let notes = self.scoped_notes();
        if !self.group_by_persona {
            return (0..notes.len()).collect();
        }
        let mut result: Vec<usize> = Vec::new();
        let mut rank = BTreeMap::<&str, usize>::new();
        for (index, note) in notes.iter().enumerate() {
            if let Some(slot) = rank.get(note.persona_id.as_str()) {
                if notes[result[*slot]].timestamp < note.timestamp {
                    result[*slot] = index;
                }
            } else {
                rank.insert(&note.persona_id, result.len());
                result.push(index);
            }
        }
        // The original older control changes its label/state, but current JSX
        // still renders one card per editor. All notes is the actual reader.
        result
    }
    fn note_card(&self, index: usize, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let note = &self.scoped_notes()[index];
        let color = color(&note.persona_color, cx);
        let persona = self.roster.iter().find(|p| p.id == note.persona_id);
        let key = format!(
            "{}-{index}",
            note.note_id
                .as_ref()
                .map(String::as_str)
                .unwrap_or(&note.persona_id)
        );
        let target = self
            .active_folio_id
            .as_deref()
            .and_then(|scope| note.reference(scope));
        let valid_target = target
            .as_ref()
            .filter(|t| self.session.saved().note(t).is_some())
            .cloned();
        let clamped = self.compact && !self.expanded_notes.contains(&key);
        let replies = self
            .active_folio_id
            .as_ref()
            .and_then(|s| self.session.saved().folios.get(s))
            .map(|f| {
                f.replies
                    .iter()
                    .filter(|r| note.note_id.as_ref() == Some(&r.note_id))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut card = div()
            .id(SharedString::from(format!("cast-note-{index}")))
            .px(px(14.4))
            .py(px(12.8))
            .flex()
            .flex_col()
            .gap(px(8.))
            .when(note.in_passing(), |card| {
                card.border_l(px(2.)).border_color(rgb(color)).opacity(0.86)
            })
            .when(!note.in_passing(), |card| {
                card.bg(rgb(p.paper))
                    .border_1()
                    .border_color(mix(color, 0.38, p.rule, 0.62))
                    .rounded(px(2.))
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.8))
                    .child(persona.map_or_else(
                        || badge_data("", color, 25.6, 13.6, cx),
                        |p| badge(p, 25.6, 13.6, cx),
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .flex()
                                    .items_start()
                                    .justify_between()
                                    .gap(px(8.8))
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .text_ellipsis()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(15.))
                                            .line_height(relative(1.25))
                                            .child(note.persona_name.clone()),
                                    )
                                    .child(
                                        div()
                                            .mt(px(0.8))
                                            .px(px(5.6))
                                            .py(px(0.8))
                                            .border_1()
                                            .border_color(rgb(color).opacity(0.55))
                                            .rounded(px(2.))
                                            .child(tracked(
                                                if note.in_passing() {
                                                    "in passing"
                                                } else {
                                                    note.kind.label()
                                                },
                                                10.,
                                                1.4,
                                                color,
                                            )),
                                    ),
                            )
                            .child(
                                div()
                                    .mt(px(1.6))
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(6.4))
                                    .child(crate::chrome::tracked_typewriter(
                                        &time_ago(note.timestamp),
                                        11.,
                                        1.1,
                                        p.ink_muted,
                                    ))
                                    .child(
                                        text_button(
                                            SharedString::from(format!("cast-speak-{index}")),
                                            "♪",
                                            11.,
                                            0.,
                                            p.ink_muted,
                                            cx,
                                        )
                                        .accessibility_label("Speak this note")
                                        .disabled(!self.capabilities.speak)
                                        .on_click(
                                            cx.listener({
                                                let persona_id = note.persona_id.clone();
                                                let text = note.feedback.clone();
                                                move |this, _, _, cx| {
                                                    if this.capabilities.speak {
                                                        cx.emit(CastEvent::Speak {
                                                            persona_id: persona_id.clone(),
                                                            text: text.clone(),
                                                        });
                                                    }
                                                }
                                            }),
                                        ),
                                    ),
                            ),
                    ),
            );
        if let Some(anchor) = note.anchor.as_ref().filter(|s| !s.is_empty()) {
            let target = target.clone();
            let can_jump = target.as_ref().is_some_and(|t| self.can_jump(t));
            card = card.child(
                Button::new(SharedString::from(format!("cast-anchor-{index}")))
                    .accessibility_label("Show this note in the manuscript")
                    .custom(
                        ButtonCustomVariant::new(cx)
                            .color(rgb(0).opacity(0.).into())
                            .foreground(rgb(p.ink_muted).into())
                            .hover(rgb(0).opacity(0.).into())
                            .active(rgb(0).opacity(0.).into()),
                    )
                    .h_auto()
                    .p_0()
                    .child(
                        div()
                            .pl(px(9.6))
                            .py(px(1.6))
                            .border_l(px(2.))
                            .border_color(rgb(color).opacity(0.7))
                            .font_family(SERIF_FONT)
                            .italic()
                            .text_size(px(13.))
                            .line_height(relative(1.5))
                            .child(format!("« {} »", truncate(anchor, 160))),
                    )
                    .disabled(!can_jump)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(target) = &target
                            && this.can_jump(target)
                        {
                            cx.emit(CastEvent::JumpToPersonaNote(target.clone()));
                        }
                    })),
            );
        }
        let body_key = key.clone();
        card = card.child(
            div()
                .id(SharedString::from(format!("cast-body-{index}")))
                .when(clamped, |body| body.max_h(px(67.2)).overflow_hidden())
                .child(markdown(
                    SharedString::from(format!("cast-note-body-{index}")),
                    &note.feedback,
                    14.,
                    1.6,
                    cx,
                ))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.compact {
                        if !this.expanded_notes.remove(&body_key) {
                            this.expanded_notes.insert(body_key.clone());
                        }
                        cx.notify();
                    }
                }))
                .test_support(),
        );
        if !replies.is_empty() {
            card = card.child(
                div()
                    .mt(px(9.6))
                    .pl(px(12.))
                    .border_l(px(2.))
                    .border_color(rgb(p.rule))
                    .flex()
                    .flex_col()
                    .gap(px(7.2))
                    .children(replies.iter().map(|reply| {
                        div()
                            .px(px(9.6))
                            .py(px(8.))
                            .border_1()
                            .border_color(rgb(p.rule))
                            .rounded(px(2.))
                            .bg(if reply.author_kind == PersonaReplyAuthor::Persona {
                                mix(color, 0.12, p.paper, 0.88)
                            } else {
                                rgb(p.paper_soft)
                            })
                            .child(
                                div()
                                    .flex()
                                    .items_baseline()
                                    .gap(px(6.4))
                                    .child(
                                        div()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(9.6))
                                            .line_height(relative(1.5))
                                            .text_color(rgb(color))
                                            .child(reply.author.clone()),
                                    )
                                    .child(tracked(
                                        &format!("· {}", time_ago(reply.timestamp)),
                                        9.6,
                                        1.536,
                                        p.ink_muted,
                                    )),
                            )
                            .child(div().mt(px(2.)).child(markdown(
                                SharedString::from(format!("cast-reply-{}", reply.id)),
                                &reply.text,
                                12.48,
                                1.45,
                                cx,
                            )))
                    })),
            );
        }
        let replying = valid_target
            .as_ref()
            .is_some_and(|t| self.replying_to.as_ref() == Some(t));
        if replying {
            let target = valid_target.unwrap();
            card = card.child(self.reply_box(target, index, cx));
        } else {
            let older = self
                .scoped_notes()
                .iter()
                .filter(|n| n.persona_id == note.persona_id)
                .count()
                .saturating_sub(1);
            let persona_id = note.persona_id.clone();
            let expanded = self.expanded_personas.contains(&persona_id);
            let mut foot = div()
                .pt(px(8.))
                .border_t_1()
                .border_color(rgb(p.rule).opacity(0.65))
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(
                    text_button(
                        SharedString::from(format!("cast-reply-open-{index}")),
                        "↩ reply",
                        9.92,
                        1.5872,
                        p.ink_light,
                        cx,
                    )
                    .disabled(!self.writable() || valid_target.is_none())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(target) = &valid_target {
                            this.open_reply(target.clone(), window, cx);
                        }
                    })),
                );
            if note.anchor.as_ref().is_some()
                && self
                    .session
                    .saved()
                    .settings()
                    .effective_level(&note.persona_id)
                    != &AssistanceLevel::Comments
            {
                let target = target.clone();
                foot = foot.child(
                    text_button(
                        SharedString::from(format!("cast-ask-fix-{index}")),
                        "✎ ask for a fix",
                        9.92,
                        1.5872,
                        p.ink_light,
                        cx,
                    )
                    .disabled(!self.capabilities.propose_edits || target.is_none())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if this.capabilities.propose_edits
                            && let Some(t) = &target
                        {
                            cx.emit(CastEvent::AskForFix(t.clone()));
                        }
                    })),
                );
            }
            if self.group_by_persona && older > 0 {
                foot = foot.child(
                    text_button(
                        SharedString::from(format!("cast-older-{index}")),
                        &if expanded {
                            "▾ hide older".into()
                        } else {
                            format!("▸ {older} older")
                        },
                        9.92,
                        1.5872,
                        p.ink_light,
                        cx,
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.expanded_personas.remove(&persona_id) {
                            this.expanded_personas.insert(persona_id.clone());
                        }
                        cx.notify();
                    })),
                );
            }
            card = card.child(foot);
        }
        card.test_support().into_any_element()
    }
    fn reply_box(&self, target: CastNoteRef, index: usize, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let Some(input) = self.reply_inputs.get(&reply_key(&target)) else {
            return div().into_any_element();
        };
        let empty = input
            .read(cx)
            .text()
            .to_string()
            .trim_matches(is_js_whitespace)
            .is_empty();
        let file = target.clone();
        let ask = target.clone();
        div()
            .mt(px(8.))
            .flex()
            .flex_col()
            .gap(px(6.4))
            .child(
                div()
                    .id(SharedString::from(format!("cast-reply-input-{index}")))
                    .child(
                        Textarea::new(input)
                            .accessibility_id(SharedString::from(format!(
                                "cast-reply-control-{index}"
                            )))
                            .aria_label("Reply to this editor")
                            .font_family(SERIF_FONT)
                            .text_size(px(12.8))
                            .line_height(relative(1.5))
                            .h(px(64.))
                            .disabled(!self.writable()),
                    )
                    .test_support(),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        press_button(
                            SharedString::from(format!("cast-ask-editor-{index}")),
                            "Ask the editor ↺",
                            cx,
                        )
                        .disabled(!self.capabilities.ask_editor || empty || !self.writable())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if this.capabilities.ask_editor
                                && let Some(input) = this.reply_inputs.get(&reply_key(&ask))
                            {
                                cx.emit(CastEvent::AskEditor {
                                    target: ask.clone(),
                                    text: input.read(cx).text().to_string(),
                                });
                            }
                        })),
                    )
                    .child(
                        text_button(
                            SharedString::from(format!("cast-file-reply-{index}")),
                            "File only",
                            9.92,
                            1.5872,
                            p.ink_light,
                            cx,
                        )
                        .disabled(!self.writable() || empty)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.file_reply(file.clone(), cx)),
                        ),
                    )
                    .child(
                        text_button(
                            SharedString::from(format!("cast-cancel-reply-{index}")),
                            "Cancel",
                            9.92,
                            1.5872,
                            p.ink_muted,
                            cx,
                        )
                        .disabled(!self.writable())
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.replying_to = None;
                            cx.notify();
                        })),
                    ),
            )
            .when(self.capabilities.ask_editor, |column| {
                column.child(tracked(
                    "⌘+Enter to ask the editor to come back",
                    10.,
                    1.2,
                    p.ink_muted,
                ))
            })
            .into_any_element()
    }
    fn manager(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let settings = self.session.saved().settings();
        let mut content=div().w_full().max_w(px(896.)).mx_auto().px(px(24.)).py(px(32.))
            .child(div().mb(px(24.)).flex().items_center().justify_between()
                .child(div().flex_shrink_1().min_w_0().child(tracked("Twyne",10.,3.2,p.ink_muted))
                    .child(div().mt(px(4.)).font_family(DISPLAY_FONT).font_weight(FontWeight::BOLD).text_size(px(28.)).line_height(relative(1.5)).child("Room of Editors"))
                    .child(div().mt(px(4.)).child(serif("Hire, edit, and tune the editorial board. Each editor's voice drives the notes they file.",14.,10./7.,p.ink_light))))
                .child(div().flex().flex_shrink_1().min_w_0().items_center().gap(px(12.))
                    .child(manager_button("cast-new-editor","+ New editor",true,cx).disabled(!self.writable()).on_click(cx.listener(|this,_,window,cx|this.begin_editor(None,window,cx))))
                    .child(manager_button("cast-reset-request","Reset defaults",false,cx).disabled(!self.writable()).on_click(cx.listener(|this,_,_,cx|{this.confirm_reset=true;cx.notify();})))
                    .child(manager_button("cast-back-to-desk","← Back to desk",false,cx).on_click(cx.listener(|_,_,_,cx|cx.emit(CastEvent::BackToDesk))))))
            .child(self.status(cx));
        if self.confirm_reset {
            content = content.child(
                room_card(cx)
                    .mb(px(24.))
                    .child(serif(
                        "Reset all editors to the default five? This will discard your changes.",
                        14.,
                        1.5,
                        p.ink_light,
                    ))
                    .child(
                        div()
                            .mt(px(12.))
                            .flex()
                            .gap(px(8.))
                            .child(
                                press_button("cast-reset-confirm", "Reset", cx)
                                    .disabled(!self.writable())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.roster_change(
                                            cast::resident_personas().to_vec(),
                                            None,
                                            cx,
                                        )
                                    })),
                            )
                            .child(
                                paper_button("cast-reset-cancel", "Cancel", cx)
                                    .disabled(!self.writable())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.confirm_reset = false;
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
        }
        if self.roster_draft.is_some() {
            content = content.child(self.editor_form(cx));
        }
        content=content.child(room_card(cx).mb(px(24.)).child(tracked("Tunable Assistance",10.,3.2,p.ink_muted))
            .child(div().mt(px(2.)).font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD).text_size(px(16.)).line_height(relative(1.5)).child("How much each editor edits"))
            .child(div().mt(px(4.)).child(serif("The room-wide ceiling lives in the right-rail Cast panel. Here you can override individual editors — useful if you want one editor filing notes only while another rewrites freely.",12.,4./3.,p.ink_light)))
            .child(div().mt(px(16.)).flex().flex_col().gap(px(12.)).children(self.roster.iter().enumerate().map(|(index,persona)|{
                let persona_id=persona.id.clone(); let level=settings.effective_level(&persona_id);
                let override_present=settings.per_persona.as_ref().and_then(|map|map.get(&persona_id)).and_then(OptionalField::as_ref).is_some();
                div().flex().flex_wrap().items_center().gap(px(12.)).py(px(6.))
                    .when(index+1<self.roster.len(),|row|row.border_b_1().border_dashed().border_color(rgb(p.rule)))
                    .child(div().flex().items_center().gap(px(6.)).min_w(px(160.)).font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD).text_size(px(16.)).line_height(relative(1.5))
                        .child(div().font(theme::cast_raw_glyph_font()).text_size(px(16.)).line_height(px(24.)).text_color(rgb(color(&persona.color,cx))).child(persona.icon.clone())).child(persona.name.clone()))
                    .child(div().flex().flex_wrap().items_center().gap(px(6.)).children(levels().into_iter().map(|choice|{
                        let id=persona_id.clone(); let active=level==&choice;
                        scope_pill(SharedString::from(format!("cast-override-{index}-{}",choice.as_str())),choice.as_str(),active,color(&persona.color,cx),cx)
                            .disabled(!self.writable()).on_click(cx.listener(move|this,_,_,cx|this.settings_change(|s|s.toggle_level(&id,choice.clone()),cx)))
                    })).when(override_present,|row|row.child(type_text("override",9.6,p.ink_muted))))
                    .child(scope_pill(SharedString::from(format!("cast-scope-{index}")),if settings.may_propose(&persona_id){"may propose"}else{"blocked"},settings.may_propose(&persona_id),p.success,cx)
                        .ml_auto().disabled(!self.writable()).on_click(cx.listener(move|this,_,_,cx|this.settings_change(|s|s.toggle_scope(&persona_id),cx))))
            }))));
        if self.roster.is_empty() {
            content = content.child(
                room_card(cx)
                    .child(serif("No editors on staff.", 14., 1.5, p.ink_muted))
                    .child(
                        press_button("cast-hire-first", "+ Hire your first editor", cx)
                            .disabled(!self.writable())
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.begin_editor(None, window, cx)
                            })),
                    ),
            );
        }
        content = content.children(
            self.roster
                .iter()
                .enumerate()
                .map(|(index, persona)| self.persona_card(persona, index, cx)),
        );
        div()
            .id("cast-scroll")
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .bg(rgb(p.paper_soft))
            .child(content)
            .test_support()
            .into_any_element()
    }
    fn persona_card(&self, persona: &Persona, index: usize, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let up = persona.id.clone();
        let down = up.clone();
        let edit = up.clone();
        let remove = up.clone();
        let prompt = up.clone();
        let preview = self.show_prompt.as_ref() == Some(&persona.id);
        room_card(cx)
            .mb(px(12.))
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(12.))
                    .child(
                        div()
                            .pt(px(4.))
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                text_button(
                                    SharedString::from(format!("cast-move-up-{index}")),
                                    "▲",
                                    12.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .accessibility_label("Move up")
                                .disabled(!self.writable() || index == 0)
                                .on_click(cx.listener(
                                    move |this, _, _, cx| this.move_editor(&up, false, cx),
                                )),
                            )
                            .child(
                                text_button(
                                    SharedString::from(format!("cast-move-down-{index}")),
                                    "▼",
                                    12.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .accessibility_label("Move down")
                                .disabled(!self.writable() || index + 1 == self.roster.len())
                                .on_click(cx.listener(
                                    move |this, _, _, cx| this.move_editor(&down, true, cx),
                                )),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .mb(px(4.))
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .font_family(SERIF_FONT)
                                            .text_size(px(20.))
                                            .line_height(relative(1.5))
                                            .text_color(rgb(color(&persona.color, cx)))
                                            .child(persona.icon.clone()),
                                    )
                                    .child(
                                        div()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(16.))
                                            .line_height(relative(1.5))
                                            .child(persona.name.clone()),
                                    )
                                    .child(tracked(&persona.id, 9.6, 1.44, p.ink_muted)),
                            )
                            .child(div().mb(px(4.)).child(type_text(
                                &persona.role,
                                12.,
                                p.vermilion,
                            )))
                            .child(div().mb(px(4.)).child(serif(
                                &persona.description,
                                14.,
                                1.625,
                                p.ink_light,
                            )))
                            .child(type_text(
                                &format!("Focus: {}", persona.focus),
                                11.2,
                                p.ink_muted,
                            ))
                            .when(
                                persona.backstory.as_ref().is_some_and(|s| !s.is_empty()),
                                |column| {
                                    column.child(
                                        div()
                                            .mt(px(8.))
                                            .font_family(SERIF_FONT)
                                            .italic()
                                            .text_size(px(12.))
                                            .line_height(px(20.))
                                            .text_color(rgb(p.ink_light))
                                            .child(persona.backstory.as_ref().unwrap().clone()),
                                    )
                                },
                            )
                            .child(
                                div().mt(px(8.)).child(
                                    text_button(
                                        SharedString::from(format!("cast-prompt-{index}")),
                                        if preview {
                                            "▾ Hide voice prompt"
                                        } else {
                                            "▸ Show voice prompt"
                                        },
                                        10.4,
                                        1.248,
                                        p.ink_muted,
                                        cx,
                                    )
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            this.show_prompt =
                                                if this.show_prompt.as_ref() == Some(&prompt) {
                                                    None
                                                } else {
                                                    Some(prompt.clone())
                                                };
                                            cx.notify();
                                        },
                                    )),
                                ),
                            )
                            .when(preview, |column| {
                                column.child(
                                    div()
                                        .id(SharedString::from(format!("cast-prompt-text-{index}")))
                                        .mt(px(8.))
                                        .max_h(px(224.))
                                        .overflow_y_scroll()
                                        .px(px(12.8))
                                        .py(px(9.6))
                                        .bg(rgb(p.paper_soft))
                                        .border_l(px(3.))
                                        .border_color(rgb(p.vermilion))
                                        .font_family(TYPEWRITER_FONT)
                                        .text_size(px(11.2))
                                        .line_height(relative(1.5))
                                        .child(cast::voice_preview(persona)),
                                )
                            }),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                text_button(
                                    SharedString::from(format!("cast-edit-{index}")),
                                    "Edit",
                                    12.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .disabled(!self.writable())
                                .on_click(cx.listener(
                                    move |this, _, window, cx| {
                                        this.begin_editor(Some(&edit), window, cx)
                                    },
                                )),
                            )
                            .child(
                                text_button(
                                    SharedString::from(format!("cast-remove-{index}")),
                                    "Remove",
                                    12.,
                                    0.,
                                    p.ink_muted,
                                    cx,
                                )
                                .disabled(!self.writable())
                                .on_click(cx.listener(
                                    move |this, _, _, cx| this.remove_editor(&remove, cx),
                                )),
                            ),
                    ),
            )
            .into_any_element()
    }
    fn editor_form(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let new = self
            .roster_draft
            .as_ref()
            .is_some_and(|d| d.base.as_ref().is_none());
        room_card(cx)
            .id("cast-editor-form")
            .mb(px(24.))
            .child(
                div()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(14.))
                    .line_height(relative(1.5))
                    .text_color(rgb(p.vermilion))
                    .child(if new { "New editor" } else { "Edit editor" }),
            )
            .child(
                div().mt(px(12.)).flex().flex_col().gap(px(12.)).children(
                    PersonaField::ALL
                        .into_iter()
                        .filter(|f| *f != PersonaField::Color)
                        .filter_map(|field| {
                            let control = self.fields.get(&field)?;
                            let id =
                                SharedString::from(format!("cast-field-{}", field_name(field)));
                            let child = match control {
                                FieldControl::Single(input) => Input::new(input)
                                    .id(id.clone())
                                    .accessibility_id(id)
                                    .aria_label(field.label())
                                    .font_family(TYPEWRITER_FONT)
                                    .text_size(px(14.))
                                    .line_height(relative(1.5))
                                    .disabled(!self.writable())
                                    .into_any_element(),
                                FieldControl::Multi(input) => div()
                                    .id(id.clone())
                                    .child(
                                        Textarea::new(input)
                                            .accessibility_id(id)
                                            .aria_label(field.label())
                                            .font_family(TYPEWRITER_FONT)
                                            .text_size(px(14.))
                                            .line_height(relative(1.5))
                                            .h(px(72.))
                                            .disabled(!self.writable()),
                                    )
                                    .test_support()
                                    .into_any_element(),
                            };
                            Some(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(type_text(field.label(), 11., p.ink_light))
                                    .child(child),
                            )
                        }),
                ),
            )
            .child(
                div()
                    .mt(px(12.))
                    .child(type_text("Color", 11., p.ink_light))
                    .child(div().mt(px(4.)).flex().flex_wrap().gap(px(8.)).children(
                        swatches().into_iter().enumerate().map(|(index, value)| {
                            let selected = self
                                .fields
                                .get(&PersonaField::Color)
                                .is_some_and(|f| f.text(cx) == value);
                            text_button(
                                SharedString::from(format!("cast-color-{index}")),
                                "●",
                                20.,
                                0.,
                                color(value, cx),
                                cx,
                            )
                            .accessibility_label(format!("Color {}", index + 1))
                            .border_1()
                            .border_color(rgb(if selected { p.ink } else { p.rule }))
                            .rounded(px(999.))
                            .size(px(28.))
                            .disabled(!self.writable())
                            .on_click(cx.listener(
                                move |this, _, window, cx| {
                                    if let Some(FieldControl::Single(input)) =
                                        this.fields.get(&PersonaField::Color)
                                    {
                                        input.update(cx, |input, cx| {
                                            input.set_value(value, window, cx)
                                        });
                                    }
                                    cx.notify();
                                },
                            ))
                        }),
                    )),
            )
            .child(
                div()
                    .mt(px(16.))
                    .flex()
                    .gap(px(8.))
                    .child(
                        press_button("cast-editor-save", "Save", cx)
                            .disabled(!self.writable())
                            .on_click(cx.listener(|this, _, _, cx| this.save_editor(cx))),
                    )
                    .child(
                        paper_button("cast-editor-cancel", "Cancel", cx)
                            .disabled(!self.writable())
                            .on_click(cx.listener(|this, _, _, cx| this.cancel_editor(cx))),
                    ),
            )
            .test_support()
            .into_any_element()
    }
    fn analysis_surface(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let Some(analysis) = self.analysis() else {
            return div()
                .size_full()
                .bg(rgb(p.paper))
                .p(px(32.))
                .child(serif(
                    "No retained analysis for this folio.",
                    14.,
                    1.5,
                    p.ink_muted,
                ))
                .child(
                    paper_button("cast-analysis-back", "← Back to desk", cx)
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(CastEvent::BackToDesk))),
                )
                .into_any_element();
        };
        let mut body = div().flex().flex_col().gap(px(20.));
        if !analysis.synthesis.is_empty() {
            let copy = analysis.synthesis.clone();
            body = body.child(
                div()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(tracked("The room's synthesis", 11., 1.65, p.vermilion))
                            .child(
                                text_button(
                                    "cast-copy-synthesis",
                                    if self.copied.as_deref() == Some("synthesis") {
                                        "✓ copied"
                                    } else {
                                        "copy"
                                    },
                                    10.,
                                    1.,
                                    p.ink_muted,
                                    cx,
                                )
                                .on_click(cx.listener(
                                    move |this, _, _, cx| {
                                        cx.write_to_clipboard(ClipboardItem::new_string(
                                            copy.clone(),
                                        ));
                                        this.copied = Some("synthesis".into());
                                        cx.notify();
                                    },
                                )),
                            ),
                    )
                    .child(div().mt(px(8.)).child(markdown(
                        "cast-analysis-synthesis",
                        &analysis.synthesis,
                        13.,
                        24. / 13.,
                        cx,
                    ))),
            );
        }
        body = body.children(analysis.memos.iter().enumerate().map(|(index, memo)| {
            let id = memo.persona_id.clone();
            let copy = memo.text.clone();
            let copy_id = id.clone();
            let collapsed = self.collapsed_memos.contains(&id);
            let color = color(&memo.persona_color, cx);
            div()
                .pl(px(12.))
                .border_l(px(3.))
                .border_color(rgb(color))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(
                            text_button(
                                SharedString::from(format!("cast-memo-toggle-{index}")),
                                &format!(
                                    "{} {}",
                                    if collapsed { "▸" } else { "▾" },
                                    memo.persona_name
                                ),
                                11.,
                                1.65,
                                color,
                                cx,
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    if !this.collapsed_memos.remove(&id) {
                                        this.collapsed_memos.insert(id.clone());
                                    }
                                    cx.notify();
                                },
                            )),
                        )
                        .child(
                            text_button(
                                SharedString::from(format!("cast-memo-copy-{index}")),
                                if self.copied.as_ref() == Some(&copy_id) {
                                    "✓ copied"
                                } else {
                                    "copy"
                                },
                                10.,
                                1.,
                                p.ink_muted,
                                cx,
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()));
                                    this.copied = Some(copy_id.clone());
                                    cx.notify();
                                },
                            )),
                        ),
                )
                .when(!collapsed, |memo_body| {
                    memo_body.child(
                        div()
                            .id(SharedString::from(format!("cast-memo-body-{index}")))
                            .mt(px(4.))
                            .child(markdown(
                                SharedString::from(format!("cast-memo-text-{index}")),
                                &memo.text,
                                13.,
                                24. / 13.,
                                cx,
                            ))
                            .test_support(),
                    )
                })
        }));
        div()
            .id("cast-scroll")
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .bg(rgb(p.paper_soft))
            .px(px(16.))
            .py(px(32.))
            .child(
                div()
                    .max_w(px(768.))
                    .mx_auto()
                    .w_full()
                    .bg(rgb(p.paper))
                    .border_1()
                    .border_color(rgb(p.rule))
                    .rounded(px(4.))
                    .child(
                        div()
                            .px(px(24.))
                            .py(px(16.))
                            .border_b_1()
                            .border_color(rgb(p.rule))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(12.))
                                    .child(tracked("The full analysis", 11., 1.76, p.vermilion))
                                    .child(
                                        div()
                                            .flex()
                                            .gap(px(8.))
                                            .child(
                                                paper_button(
                                                    "cast-analysis-download",
                                                    "⇩ download",
                                                    cx,
                                                )
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    if let Some(analysis) = this.analysis()
                                                        && let Some(folio_id) =
                                                            this.active_folio_id.clone()
                                                    {
                                                        let label = this
                                                            .analysis_filed_label
                                                            .clone()
                                                            .unwrap_or_else(|| {
                                                                chrono::DateTime::from_timestamp_millis(analysis.timestamp.min(i64::MAX as u64) as i64)
                                                                    .map(|at| at.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string())
                                                                    .unwrap_or_default()
                                                            });
                                                        cx.emit(CastEvent::DownloadAnalysis {
                                                            folio_id,
                                                            filename: cast::analysis_filename(
                                                                analysis,
                                                            ),
                                                            markdown: cast::analysis_markdown(
                                                                analysis, &label,
                                                            ),
                                                        });
                                                    }
                                                })),
                                            )
                                            .child(
                                                paper_button(
                                                    "cast-analysis-back",
                                                    "← Back to desk",
                                                    cx,
                                                )
                                                .on_click(cx.listener(|_, _, _, cx| {
                                                    cx.emit(CastEvent::BackToDesk)
                                                })),
                                            ),
                                    ),
                            )
                            .when(analysis.brief_title.as_ref().is_some(), |header| {
                                header.child(div().mt(px(4.)).child(serif(
                                    analysis.brief_title.as_ref().unwrap(),
                                    13.,
                                    1.5,
                                    p.ink_light,
                                )))
                            }),
                    )
                    .child(div().p(px(24.)).child(body)),
            )
            .test_support()
            .into_any_element()
    }
}
impl Render for CastView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(cx);
        div()
            .id("cast-root")
            .size_full()
            .min_h_0()
            .font_family(SERIF_FONT)
            .text_color(rgb(p.ink))
            .capture_action(cx.listener(|this, _: &IndentInline, window, cx| {
                this.navigate_form_tab(false, window, cx)
            }))
            .capture_action(cx.listener(|this, _: &OutdentInline, window, cx| {
                this.navigate_form_tab(true, window, cx)
            }))
            .child(match self.surface {
                CastSurface::Board => self.board(cx),
                CastSurface::Manager => self.manager(cx),
                CastSurface::Analysis => self.analysis_surface(cx),
            })
            .test_support()
            .track_focus(&self.focus_handle)
    }
}

fn levels() -> [AssistanceLevel; 3] {
    [
        AssistanceLevel::Comments,
        AssistanceLevel::Sentence,
        AssistanceLevel::Paragraph,
    ]
}
fn level_label(level: &AssistanceLevel) -> &str {
    match level {
        AssistanceLevel::Comments => "Notes only",
        AssistanceLevel::Sentence => "Sentence",
        AssistanceLevel::Paragraph => "Paragraph",
        AssistanceLevel::Other(value) => value,
    }
}
fn field_name(field: PersonaField) -> &'static str {
    match field {
        PersonaField::Name => "name",
        PersonaField::Role => "role",
        PersonaField::Description => "description",
        PersonaField::Focus => "focus",
        PersonaField::Backstory => "backstory",
        PersonaField::CriticalMethod => "critical-method",
        PersonaField::Voice => "voice",
        PersonaField::SignatureMoves => "signature-moves",
        PersonaField::Avoidances => "avoidances",
        PersonaField::SampleLines => "sample-lines",
        PersonaField::Icon => "icon",
        PersonaField::Color => "color",
    }
}
fn swatches() -> [&'static str; 8] {
    [
        "var(--color-vermilion)",
        "var(--color-mustard)",
        "var(--color-cobalt)",
        "var(--color-accent-green)",
        "var(--color-periwinkle)",
        "var(--color-sage)",
        "var(--color-blush)",
        "var(--color-ink)",
    ]
}
fn tracked(text: &str, size: f32, spacing: f32, color: u32) -> AnyElement {
    crate::chrome::tracked_typewriter(&text.to_uppercase(), size, spacing, color)
}
fn type_text(text: &str, size: f32, color: u32) -> AnyElement {
    div()
        .font_family(TYPEWRITER_FONT)
        .text_size(px(size))
        .line_height(relative(1.5))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn serif(text: &str, size: f32, line: f32, color: u32) -> AnyElement {
    div()
        .font_family(SERIF_FONT)
        .text_size(px(size))
        .line_height(relative(line))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn text_button(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    size: f32,
    spacing: f32,
    color: u32,
    cx: &App,
) -> Button {
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
        .child(div().w_full().child(if spacing == 0. {
            type_text(label, size, color)
        } else {
            tracked(label, size, spacing, color)
        }))
}
/// The source manager allows normal word wrapping within each shrinking button.
/// Kit's ordinary button label is clipped to one line and its custom fill is translucent.
fn manager_button(
    id: &'static str,
    label: &'static str,
    press: bool,
    cx: &App,
) -> gpui_kit::base::Button {
    let p = *theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label)
        .flex_shrink_1()
        .min_w_0()
        .px(px(if press { 16. } else { 14.4 }))
        .py(px(if press { 8.8 } else { 7.2 }))
        .border_1()
        .border_color(rgb(if press { p.ink } else { p.rule }))
        .rounded(px(2.))
        .bg(rgb(if press { p.ink } else { p.paper_soft }))
        .text_color(rgb(if press { p.paper } else { p.ink }))
        .hover(move |button| {
            button
                .bg(rgb(if press { p.vermilion_deep } else { p.sidebar }))
                .border_color(rgb(if press { p.vermilion_deep } else { p.ink_muted }))
        })
        .styles(|styles| styles.disabled(|style| style.opacity(0.4)))
        .child(if press {
            div()
                .min_w_0()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap_x(px(5.226_831))
                .children(["+ NEW", "EDITOR"].into_iter().map(|word| {
                    crate::chrome::tracked_text(word, font(DISPLAY_FONT), 11.2, 2.016, p.paper, 16.)
                }))
                .into_any_element()
        } else {
            div()
                .min_w_0()
                .whitespace_normal()
                .text_align(TextAlign::Center)
                .font_family(DISPLAY_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .line_height(relative(10. / 7.))
                .child(label)
                .into_any_element()
        })
}
fn scope_pill(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    active: bool,
    accent: u32,
    cx: &App,
) -> Button {
    let p = theme::palette(cx);
    text_button(
        id,
        label,
        10.4,
        1.04,
        if active { p.paper } else { p.ink_light },
        cx,
    )
    .px(px(8.8))
    .py(px(2.4))
    .border_1()
    .border_color(rgb(if active { accent } else { p.rule }))
    .rounded_full()
    .bg(rgb(if active { accent } else { p.paper_soft }))
    .toggled(active)
}
fn paper_button(id: impl Into<gpui_kit::ElementId>, label: &str, cx: &App) -> Button {
    let p = theme::palette(cx);
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(p.paper).into())
                .foreground(rgb(p.ink).into())
                .hover(rgb(p.paper_soft).into())
                .active(rgb(p.paper_soft).into()),
        )
        .h_auto()
        .px(px(12.))
        .py(px(7.2))
        .border_1()
        .rounded(px(2.))
        .child(
            div()
                .font_family(DISPLAY_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .line_height(relative(10. / 7.))
                .child(label.to_owned()),
        )
}
fn press_button(id: impl Into<gpui_kit::ElementId>, label: &str, cx: &App) -> Button {
    let p = theme::palette(cx);
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(p.ink).into())
                .foreground(rgb(p.paper).into())
                .hover(rgb(p.vermilion_deep).into())
                .active(rgb(p.vermilion_deep).into()),
        )
        .h_auto()
        .px(px(12.))
        .py(px(8.8))
        .border_1()
        .rounded(px(2.))
        .child(tracked(label, 11., 1.32, p.paper))
}
fn room_action_button(id: impl Into<gpui_kit::ElementId>, label: &str, cx: &App) -> Button {
    let p = theme::palette(cx);
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(p.paper).into())
                .foreground(rgb(p.ink).into())
                .hover(rgb(p.paper_soft).into())
                .active(rgb(p.paper_soft).into()),
        )
        .h_auto()
        .px(px(12.))
        .py(px(8.8))
        .border_1()
        .border_color(rgb(p.ink_light))
        .rounded(px(2.))
        .child(tracked(label, 11., 1.32, p.ink))
}
fn room_card(cx: &App) -> gpui_kit::Div {
    let p = theme::palette(cx);
    div()
        .bg(rgb(p.paper))
        .border_1()
        .border_color(rgb(p.rule))
        .rounded(px(4.))
        .p(px(16.))
}
fn badge(persona: &Persona, diameter: f32, font: f32, cx: &App) -> AnyElement {
    badge_data(&persona.icon, color(&persona.color, cx), diameter, font, cx)
}
fn badge_data(icon: &str, color: u32, diameter: f32, font: f32, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .size(px(diameter))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(999.))
        .border_1()
        .border_color(rgb(color))
        .bg(rgb(p.paper_soft))
        .text_color(rgb(color))
        .font(theme::cast_badge_font())
        .text_size(px(font))
        .line_height(relative(1.5))
        .child(icon.to_owned())
        .into_any_element()
}
fn markdown(
    id: impl Into<gpui_kit::ElementId>,
    text: &str,
    size: f32,
    line: f32,
    cx: &App,
) -> AnyElement {
    let p = theme::palette(cx);
    TextView::markdown(id, text.to_owned())
        .style(
            TextViewStyle::default()
                .with_foreground(rgb(p.ink_light).into())
                .with_muted_foreground(rgb(p.ink_muted).into())
                .with_link(rgb(p.blue).into())
                .with_border(rgb(p.rule).into())
                .with_paragraph_gap(rems(0.4)),
        )
        .font_family(SERIF_FONT)
        .text_size(px(size))
        .line_height(relative(line))
        .into_any_element()
}
fn color(value: &str, cx: &App) -> u32 {
    let p = theme::palette(cx);
    match value {
        "var(--color-persona-devil)" | "var(--color-vermilion)" => p.vermilion,
        "var(--color-persona-angel)" | "var(--color-sage)" => p.sage,
        "var(--color-persona-scholar)" | "var(--color-periwinkle)" => p.periwinkle,
        "var(--color-persona-editor)" | "var(--color-mustard)" => p.mustard,
        "var(--color-persona-reader)" | "var(--color-cobalt)" => p.cobalt,
        "var(--color-accent-green)" => p.success,
        "var(--color-blush)" => p.blush,
        "var(--color-ink)" => p.ink,
        _ => value
            .strip_prefix('#')
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .unwrap_or(p.ink),
    }
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
fn limit_utf16(text: &str, limit: usize) -> String {
    String::from_utf16_lossy(&text.encode_utf16().take(limit).collect::<Vec<_>>())
}
fn truncate(text: &str, limit: usize) -> String {
    let units = text.encode_utf16().take(limit + 1).collect::<Vec<_>>();
    if units.len() <= limit {
        return text.into();
    };
    format!(
        "{}…",
        String::from_utf16_lossy(&units[..limit.saturating_sub(1)])
            .trim_end_matches(is_js_whitespace)
    )
}
fn time_ago(at: u64) -> String {
    let seconds = timestamp().saturating_sub(at) / 1000;
    if seconds < 60 {
        "just now".into()
    } else if seconds < 3600 {
        format!("{}m", seconds / 60)
    } else if seconds < 86400 {
        format!("{}h", seconds / 3600)
    } else {
        format!("{}d", seconds / 86400)
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::{
        cast::{CastFolioArtifacts, CastStore},
        workspace::ExtraFields,
    };
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Point, ScrollDelta, TestAppContext, WindowBounds, WindowOptions,
        size,
    };
    use std::sync::Mutex;
    use tempfile::TempDir;

    const FOLIO: &str = "web/folio:café";
    const NOTE: &str = "pn-source:one";
    struct Room {
        window: AnyWindowHandle,
        view: Entity<CastView>,
        store: CastStore,
        _directory: TempDir,
        events: Arc<Mutex<Vec<CastEvent>>>,
    }
    fn target() -> CastNoteRef {
        CastNoteRef {
            folio_id: FOLIO.into(),
            id: NOTE.into(),
        }
    }
    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../fixtures/cast/web-reference.json")).unwrap()
    }
    fn record() -> CastRecord {
        let fixture = fixture();
        let mut record = CastRecord::default();
        record.import_scoped(
            FOLIO.into(),
            CastFolioArtifacts {
                notes: serde_json::from_value(fixture["notes"].clone()).unwrap(),
                replies: serde_json::from_value(fixture["replies"].clone()).unwrap(),
                analysis: OptionalField::Value(
                    serde_json::from_value(fixture["analysis"].clone()).unwrap(),
                ),
                extra: ExtraFields::new(),
            },
        );
        record.import_scoped("unimported/foreign".into(), record.folios[FOLIO].clone());
        record
    }
    fn room(cx: &mut TestAppContext, record: CastRecord, surface: CastSurface, width: f32) -> Room {
        let directory = tempfile::tempdir().unwrap();
        let store = CastStore::open(directory.path()).unwrap();
        std::fs::write(store.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        let (window, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(width), px(860.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        let mut view = CastView::new(
                            Arc::new(record),
                            Some(FOLIO.into()),
                            CastBriefLabel {
                                title: Some("The retained notebook".into()),
                                format: Some("Essay".into()),
                            },
                            None,
                            CastCapabilities::local(),
                            window,
                            cx,
                        );
                        view.set_surface(surface, window, cx);
                        view
                    })
                },
            )
            .unwrap()
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let receiver = events.clone();
        cx.update(|cx| {
            cx.subscribe(&view, move |_, event: &CastEvent, _| {
                receiver.lock().unwrap().push(event.clone())
            })
            .detach()
        });
        Room {
            window,
            view,
            store,
            _directory: directory,
            events,
        }
    }
    fn reveal(window: &mut Window, id: &'static str, cx: &mut App) {
        for _ in 0..30 {
            window.render_frame(cx);
            let viewport = window.find("cast-scroll").bounds();
            if window.try_find(id).is_some_and(|element| {
                element.visible()
                    && element.bounds().top() >= viewport.top()
                    && element.bounds().bottom() <= viewport.bottom()
            }) {
                return;
            }
            let delta = window.try_find(id).map_or(-220., |element| {
                if element.bounds().origin.y < window.find("cast-scroll").bounds().top() {
                    220.
                } else {
                    -220.
                }
            });
            window.scroll(
                "cast-scroll",
                ScrollDelta::Pixels(gpui_kit::point(px(0.), px(delta))),
                cx,
            );
        }
        assert!(window.find(id).visible(), "{id} must be reachable at 860px");
    }
    fn ack(room: &Room, window: &mut Window, cx: &mut App) -> CastRequest {
        let request = room.view.read(cx).pending_request().unwrap().clone();
        let record = room.store.save_request(&request).unwrap();
        room.view.update(cx, |view, cx| {
            assert!(view.ack_saved(request.request_id, record, window, cx))
        });
        window.render_frame(cx);
        request
    }
    fn reply(room: &Room, window: &mut Window, cx: &mut App) {
        reveal(window, "cast-reply-open-0", cx);
        window.click("cast-reply-open-0", cx);
        window.render_frame(cx);
        window.simulate_next_frame(cx);
        window.render_frame(cx);
        assert!(window.find("cast-reply-input-0").visible());
        assert!(
            room.view.read(cx).reply_inputs[&reply_key(&target())]
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
    }

    #[gpui_kit::test]
    fn file_only_final_character_failed_write_retry_and_late_ack_are_real(cx: &mut TestAppContext) {
        let original = record();
        let foreign = original.folios["unimported/foreign"].clone();
        let room = room(cx, original.clone(), CastSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            reply(&room, window, cx);
            window.input("  Café — keep the final é.  ", cx);
            reveal(window, "cast-file-reply-0", cx);
            window.click("cast-file-reply-0", cx);
            let request = room.view.read(cx).pending_request().unwrap().clone();
            assert_eq!(*room.view.read(cx).saved_record().as_ref(), original);
            assert_eq!(request.candidate.folios["unimported/foreign"], foreign);
            assert_eq!(
                request.candidate.folios[FOLIO].replies.last().unwrap().text,
                "Café — keep the final é."
            );
            assert_eq!(
                room.view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE],
                "  Café — keep the final é.  "
            );
            std::fs::create_dir(room.store.path().with_file_name("cast.json.bak")).unwrap();
            let error = room.store.save_request(&request).unwrap_err().to_string();
            room.view.update(cx, |view, cx| {
                assert!(view.report_error(request.request_id, error, cx))
            });
            window.render_frame(cx);
            window.click("cast-save-retry", cx);
            assert_eq!(room.view.read(cx).pending_request(), Some(&request));
            assert_eq!(
                room.view.read(cx).saved_record().folios[FOLIO].replies,
                original.folios[FOLIO].replies
            );
            std::fs::remove_dir(room.store.path().with_file_name("cast.json.bak")).unwrap();
            ack(&room, window, cx);
            assert_eq!(
                room.view.read(cx).saved_record().folios[FOLIO]
                    .replies
                    .len(),
                original.folios[FOLIO].replies.len() + 1
            );
            assert!(
                room.view.read(cx).reply_inputs[&reply_key(&target())]
                    .read(cx)
                    .text()
                    .to_string()
                    .is_empty()
            );
            room.view.update(cx, |view, cx| {
                assert!(!view.report_error(request.request_id, "late failure", cx))
            });
            room.view.update(cx, |view, cx| {
                assert!(!view.ack_saved(request.request_id, request.candidate.clone(), window, cx))
            });
        })
        .unwrap();
        let events = room.events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, CastEvent::SaveRequested(_)))
                .count(),
            2
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, CastEvent::Filed { .. }))
                .count(),
            1
        );
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, CastEvent::AskEditor { .. }))
        );
    }
    #[gpui_kit::test]
    fn cancel_scope_switch_and_quit_capture_keep_reply_rope_without_provider_shortcut(
        cx: &mut TestAppContext,
    ) {
        let room = room(cx, record(), CastSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            reply(&room, window, cx);
            window.input("Unfiled café.", cx);
            window.press("ctrl-enter", cx);
            assert!(room.view.read(cx).pending_request().is_none());
            reveal(window, "cast-cancel-reply-0", cx);
            window.click("cast-cancel-reply-0", cx);
            room.view.update(cx, |view, cx| {
                assert!(view.set_scope(
                    Some("unimported/foreign".into()),
                    CastBriefLabel::default(),
                    None,
                    window,
                    cx
                ))
            });
            room.view.update(cx, |view, cx| {
                assert!(view.set_scope(
                    Some(FOLIO.into()),
                    CastBriefLabel::default(),
                    None,
                    window,
                    cx
                ))
            });
            reply(&room, window, cx);
            assert!(
                room.view.read(cx).reply_inputs[&reply_key(&target())]
                    .read(cx)
                    .text()
                    .to_string()
                    .starts_with("Unfiled café.")
            );
            let request = room.view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert_eq!(
                request.candidate.folios[FOLIO].replies,
                room.view.read(cx).saved_record().folios[FOLIO].replies
            );
            assert_eq!(
                request.candidate.reply_drafts[FOLIO][NOTE],
                room.view.read(cx).capture_reply_drafts(cx)[FOLIO][NOTE]
            );
            assert_eq!(
                room.view
                    .update(cx, |view, cx| view.prepare_pending_edits(cx).unwrap()),
                Some(request.clone())
            );
            ack(&room, window, cx);
            assert_eq!(
                room.store.load().unwrap().record.reply_drafts[FOLIO][NOTE],
                request.candidate.reply_drafts[FOLIO][NOTE]
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn actual_manager_edit_move_remove_and_reset_preserve_imported_preferences(
        cx: &mut TestAppContext,
    ) {
        let mut original = record();
        let retained: Persona =
            serde_json::from_value(fixture()["optionalPersona"].clone()).unwrap();
        original.personas =
            OptionalField::Value(vec![retained.clone(), cast::resident_personas()[0].clone()]);
        let room = room(cx, original, CastSurface::Manager, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            reveal(window, "cast-edit-0", cx);
            window.click("cast-edit-0", cx);
            reveal(window, "cast-field-name", cx);
            window.click("cast-field-name", cx);
            window.press("ctrl-a", cx);
            window.input("Retained café", cx);
            reveal(window, "cast-editor-save", cx);
            window.click("cast-editor-save", cx);
            ack(&room, window, cx);
            let edited = &room.view.read(cx).saved_record().personas.as_ref().unwrap()[0];
            assert_eq!(edited.name, "Retained café");
            assert_eq!(edited.speech_voice, retained.speech_voice);
            assert_eq!(edited.speech_voices, retained.speech_voices);
            assert_eq!(edited.extra, retained.extra);
            assert_eq!(edited.id, retained.id);
            reveal(window, "cast-move-down-0", cx);
            window.click("cast-move-down-0", cx);
            ack(&room, window, cx);
            assert_eq!(
                room.store.load().unwrap().record.personas.as_ref().unwrap()[1].id,
                retained.id
            );
            reveal(window, "cast-remove-1", cx);
            window.click("cast-remove-1", cx);
            ack(&room, window, cx);
            assert!(
                room.view.read(cx).saved_record().folios[FOLIO]
                    .notes
                    .iter()
                    .any(|n| n.note_id.as_ref() == Some(&NOTE.to_string()))
            );
            reveal(window, "cast-reset-request", cx);
            window.click("cast-reset-request", cx);
            assert!(room.view.read(cx).pending_request().is_none());
            window.click("cast-reset-cancel", cx);
            window.click("cast-reset-request", cx);
            window.click("cast-reset-confirm", cx);
            ack(&room, window, cx);
            assert_eq!(room.view.read(cx).roster, cast::resident_personas());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn new_editor_validation_and_unblurred_global_form_recovery(cx: &mut TestAppContext) {
        let room = room(cx, record(), CastSurface::Manager, 620.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            assert_ne!(window.find("cast-new-editor").disabled(), Some(true));
            window.click("cast-new-editor", cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            reveal(window, "cast-editor-save", cx);
            window.click("cast-editor-save", cx);
            assert!(room.view.read(cx).pending_request().is_none());
            assert!(room.view.read(cx).local_error.is_some());
            reveal(window, "cast-field-name", cx);
            window.click("cast-field-name", cx);
            window.input("New café", cx);
            let request = room.view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert_eq!(
                request
                    .candidate
                    .roster_draft
                    .as_ref()
                    .unwrap()
                    .get(PersonaField::Name),
                "New café"
            );
            assert_eq!(
                request.candidate.personas,
                room.view.read(cx).saved_record().personas
            );
            ack(&room, window, cx);
            assert_eq!(
                room.store
                    .load()
                    .unwrap()
                    .record
                    .roster_draft
                    .as_ref()
                    .unwrap()
                    .get(PersonaField::Name),
                "New café"
            );
            reveal(window, "cast-editor-save", cx);
            window.click("cast-editor-save", cx);
            ack(&room, window, cx);
            let saved = room.store.load().unwrap().record;
            let added = saved.personas.as_ref().unwrap().last().unwrap();
            assert_eq!(added.name, "New café");
            assert_eq!(added.role, "The Editor");
            assert_eq!(added.icon, "❧");
            assert_eq!(added.color, "var(--color-vermilion)");
            assert!(saved.roster_draft.is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn local_assistance_scope_and_disclosure_do_not_publish_provider_success(
        cx: &mut TestAppContext,
    ) {
        let room = room(cx, record(), CastSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("cast-get-notes").disabled(), Some(true));
            assert_eq!(window.find("cast-propose-edits").disabled(), Some(true));
            assert_eq!(window.find("cast-clear-room").disabled(), Some(true));
            window.click("cast-settings-toggle", cx);
            window.click("cast-level-comments", cx);
            ack(&room, window, cx);
            assert!(window.try_find("cast-propose-edits").is_none());
            window.click("cast-proposals-more", cx);
            ack(&room, window, cx);
            assert_eq!(
                room.view.read(cx).saved_record().settings().max_proposals,
                7
            );
            room.view.update(cx, |view, cx| {
                view.set_surface(CastSurface::Manager, window, cx)
            });
            reveal(window, "cast-scope-0", cx);
            window.click("cast-scope-0", cx);
            ack(&room, window, cx);
            assert_eq!(
                room.view.read(cx).saved_record().settings().persona_scope,
                vec!["devil"]
            );
            window.click("cast-override-0-paragraph", cx);
            ack(&room, window, cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .saved_record()
                    .settings()
                    .effective_level("devil"),
                &AssistanceLevel::Paragraph
            );
            window.click("cast-override-0-paragraph", cx);
            ack(&room, window, cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .saved_record()
                    .settings()
                    .effective_level("devil"),
                &AssistanceLevel::Comments
            );
        })
        .unwrap();
        assert!(
            room.events
                .lock()
                .unwrap()
                .iter()
                .all(|e| matches!(e, CastEvent::SaveRequested(_) | CastEvent::Filed { .. }))
        );
    }
    #[gpui_kit::test]
    fn retained_analysis_copy_download_grouping_and_known_anchor_gates(cx: &mut TestAppContext) {
        let room = room(cx, record(), CastSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(room.view.read(cx).note_indices(), vec![0, 2, 3]);
            reveal(window, "cast-older-0", cx);
            window.click("cast-older-0", cx);
            assert_eq!(room.view.read(cx).note_indices(), vec![0, 2, 3]);
            window.click("cast-group-toggle", cx);
            assert_eq!(room.view.read(cx).note_indices(), vec![0, 1, 2, 3]);
            room.view.update(cx, |view, cx| {
                view.set_capabilities(
                    CastCapabilities {
                        persona_anchors: true,
                        ..CastCapabilities::local()
                    },
                    cx,
                );
                view.set_anchors(None, cx);
            });
            reveal(window, "cast-anchor-0", cx);
            assert_eq!(window.find("cast-anchor-0").disabled(), Some(true));
            room.view
                .update(cx, |view, cx| view.set_anchors(Some(vec![NOTE.into()]), cx));
            window.render_frame(cx);
            window.click("cast-anchor-0", cx);
            room.view.update(cx, |view, cx| {
                view.set_surface(CastSurface::Analysis, window, cx);
                view.set_analysis_filed_label(Some("11/14/2023, 5:13:20 PM".into()), cx);
            });
            window.render_frame(cx);
            window.click("cast-copy-synthesis", cx);
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().unwrap(),
                room.view.read(cx).analysis().unwrap().synthesis
            );
            window.click("cast-memo-toggle-0", cx);
            window.render_frame(cx);
            assert!(window.try_find("cast-memo-body-0").is_none());
            window.click("cast-memo-toggle-0", cx);
            window.render_frame(cx);
            assert!(window.try_find("cast-memo-body-0").is_some());
            window.click("cast-analysis-download", cx);
            assert!(room.view.read(cx).pending_request().is_none());
        })
        .unwrap();
        let events = room.events.lock().unwrap();
        assert!(
            events
                .iter()
                .any(|e| matches!(e,CastEvent::JumpToPersonaNote(t) if *t==target()))
        );
        let download = events
            .iter()
            .find_map(|e| {
                if let CastEvent::DownloadAnalysis {
                    markdown, filename, ..
                } = e
                {
                    Some((markdown, filename))
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(
            download.0,
            fixture()["analysisExport"]["markdown"].as_str().unwrap()
        );
        assert_eq!(
            download.1,
            fixture()["analysisExport"]["filename"].as_str().unwrap()
        );
    }
    #[gpui_kit::test]
    fn first_frame_and_resized_board_keep_local_controls_inside_original_rail(
        cx: &mut TestAppContext,
    ) {
        let room = room(cx, CastRecord::default(), CastSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            for width in [464., 360., 464.] {
                window.resize(size(px(width), px(860.)));
                window.render_frame(cx);
                let badges = window.find("cast-roster-badges").bounds();
                assert!(badges.size.width > px(100.));
                assert!(badges.right() <= px(width));
                let controls = window.find("cast-get-notes").bounds();
                assert!(controls.left() >= px(12.));
                assert!(controls.right() <= px(width - 12.));
                assert_eq!(controls.size.height, px(36.));
                assert!(window.find("cast-edit-roster").visible());
                assert!(window.find("cast-settings-toggle").visible());
                assert!(!room.view.read(cx).has_unsaved_changes(cx));
            }
        })
        .unwrap();
    }
}
