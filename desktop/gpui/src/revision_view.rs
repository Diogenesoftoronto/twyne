//! Native Version history panel. Persisting and activating a restoration stay
//! application-owned: events are requests, and only acknowledgements say saved.

use crate::{
    assets::{self, TwyneIcon},
    manuscript::Manuscript,
    revisions::{
        CheckpointOutcome, RevisionComparison, RevisionComparisonBasis, RevisionDiff,
        RevisionSnapshot, RevisionTaskStatus, RevisionTimeline, compare_manuscripts,
    },
    theme::{self, DISPLAY_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT},
};
use chrono::{DateTime, Local};
use gpui_kit::component::{
    Disableable, IndexPath, Sizable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    checkbox::Checkbox,
    searchable_list::SearchableVec,
    select::{Select, SelectEvent, SelectItem, SelectState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight, Global,
    IntoElement, KeyBinding, Render, Role, ScrollHandle, SharedString, Subscription,
    TestSupportExt, Window, div, px, relative, rgb,
};
use std::sync::Arc;
use uuid::Uuid;

gpui_kit::actions!(revision_history, [ConfirmRestore, CancelRestore]);
struct RevisionBindingsRegistered;
impl Global for RevisionBindingsRegistered {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RevisionCapabilities {
    pub local_history: bool,
    pub checkpoint: bool,
    pub restore: bool,
    pub tasks: bool,
    pub read_only: bool,
    pub source_pending: bool,
    pub source_conflict: bool,
}
impl RevisionCapabilities {
    pub fn local() -> Self {
        Self {
            local_history: true,
            checkpoint: true,
            restore: true,
            tasks: true,
            ..Self::default()
        }
    }
    pub fn writable(&self) -> bool {
        self.local_history && !self.read_only && !self.source_pending && !self.source_conflict
    }
    pub fn write_blocked_reason(&self) -> Option<&'static str> {
        if !self.local_history {
            Some("Version history is unavailable for this manuscript.")
        } else if self.read_only {
            Some("This manuscript is read-only. You can compare saved checkpoints.")
        } else if self.source_conflict {
            Some("Resolve the Source conflict before saving or restoring a checkpoint.")
        } else if self.source_pending {
            Some(
                "Apply or discard the pending Source changes before saving or restoring a checkpoint.",
            )
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RevisionEvent {
    CheckpointRequested {
        request_id: Uuid,
        folio_id: Uuid,
        generation: u64,
    },
    RestoreRequested {
        request_id: Uuid,
        folio_id: Uuid,
        snapshot_id: Uuid,
        generation: u64,
    },
    TaskStatusRequested {
        request_id: Uuid,
        folio_id: Uuid,
        task_id: Uuid,
        status: RevisionTaskStatus,
        generation: u64,
    },
}

#[derive(Clone)]
struct Choice {
    label: SharedString,
    value: String,
}
impl SelectItem for Choice {
    type Value = String;
    fn title(&self) -> SharedString {
        self.label.clone()
    }
    fn value(&self) -> &String {
        &self.value
    }
}
type Choices = SearchableVec<Choice>;
type ChoiceState = Entity<SelectState<Choices>>;

#[derive(Clone, Debug)]
enum PendingKind {
    Checkpoint,
    Restore { label: String },
    Task,
}
#[derive(Clone, Debug)]
struct PendingRequest {
    id: Uuid,
    folio_id: Uuid,
    generation: u64,
    kind: PendingKind,
}

pub struct RevisionView {
    current: Arc<Manuscript>,
    timeline: Arc<RevisionTimeline>,
    capabilities: RevisionCapabilities,
    generation: u64,
    selected_id: Option<Uuid>,
    compared_id: Option<Uuid>,
    earlier: ChoiceState,
    compared: ChoiceState,
    diff: Option<RevisionDiff>,
    confirm_restore: bool,
    tasks_expanded: bool,
    pending: Option<PendingRequest>,
    message: Option<String>,
    error: Option<String>,
    loading: bool,
    focus_handle: FocusHandle,
    restore_focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    reveal_restore: bool,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<RevisionEvent> for RevisionView {}
impl Focusable for RevisionView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl RevisionView {
    pub fn new(
        current: Arc<Manuscript>,
        timeline: Arc<RevisionTimeline>,
        capabilities: RevisionCapabilities,
        generation: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        if cx.try_global::<RevisionBindingsRegistered>().is_none() {
            cx.bind_keys([
                KeyBinding::new("enter", ConfirmRestore, Some("RevisionRestore")),
                KeyBinding::new("escape", CancelRestore, Some("RevisionRestore")),
            ]);
            cx.set_global(RevisionBindingsRegistered);
        }
        let scroll_handle = ScrollHandle::new();
        let invalid = if timeline.validate(current.id).is_err() {
            Some("Version history belongs to another manuscript or could not be opened.".into())
        } else {
            None
        };
        let timeline = if invalid.is_some() {
            Arc::new(RevisionTimeline::new(current.id))
        } else {
            timeline
        };
        let selected_id = timeline.revisions.first().map(|snapshot| snapshot.id);
        let earlier = cx.new(|cx| {
            SelectState::new(
                choices(&timeline.revisions, None, false),
                selected_id.map(|_| IndexPath::new(0)),
                window,
                cx,
            )
        });
        let compared = cx.new(|cx| {
            SelectState::new(
                choices(&timeline.revisions, selected_id, true),
                Some(IndexPath::new(0)),
                window,
                cx,
            )
        });
        let earlier_subscription = cx.subscribe_in(
            &earlier,
            window,
            |this, _, event: &SelectEvent<Choices>, window, cx| {
                if this.pending.is_some() {
                    return;
                }
                if let SelectEvent::Confirm(Some(value)) = event {
                    this.selected_id = Uuid::parse_str(value).ok();
                    if this.compared_id == this.selected_id {
                        this.compared_id = None;
                    }
                    this.confirm_restore = false;
                    this.sync_choices(window, cx);
                    this.refresh_diff();
                    cx.notify();
                }
            },
        );
        let compared_subscription = cx.subscribe_in(
            &compared,
            window,
            |this, _, event: &SelectEvent<Choices>, _, cx| {
                if this.pending.is_some() {
                    return;
                }
                if let SelectEvent::Confirm(Some(value)) = event {
                    this.compared_id = Uuid::parse_str(value).ok();
                    this.refresh_diff();
                    cx.notify();
                }
            },
        );
        let mut view = Self {
            current,
            timeline,
            capabilities,
            generation,
            selected_id,
            compared_id: None,
            earlier,
            compared,
            diff: None,
            confirm_restore: false,
            tasks_expanded: false,
            pending: None,
            message: None,
            error: invalid,
            loading: false,
            focus_handle: cx.focus_handle(),
            restore_focus_handle: cx.focus_handle(),
            scroll_handle,
            reveal_restore: false,
            _subscriptions: vec![earlier_subscription, compared_subscription],
        };
        view.refresh_diff();
        view
    }
    pub fn current(&self) -> &Arc<Manuscript> {
        &self.current
    }
    pub fn timeline(&self) -> &Arc<RevisionTimeline> {
        &self.timeline
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn pending_request_id(&self) -> Option<Uuid> {
        self.pending.as_ref().map(|pending| pending.id)
    }
    pub fn set_capabilities(&mut self, capabilities: RevisionCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        if !capabilities.writable() {
            self.confirm_restore = false;
        }
        cx.notify();
    }
    pub fn set_loading(&mut self, loading: bool, cx: &mut Context<Self>) {
        self.loading = loading;
        cx.notify();
    }
    /// Refresh at open/settled/save boundaries after the application flushes the
    /// editor. Diff scans are not part of the rich editor's typing transaction.
    pub fn replace_data(
        &mut self,
        current: Arc<Manuscript>,
        timeline: Arc<RevisionTimeline>,
        generation: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if timeline.validate(current.id).is_err() || current.validate().is_err() {
            return false;
        }
        if current.id == self.current.id && generation < self.generation {
            return false;
        }
        if current.id != self.current.id || generation != self.generation {
            self.pending = None;
            self.confirm_restore = false;
            self.message = None;
            self.error = None;
        }
        self.current = current;
        self.timeline = timeline;
        self.generation = generation;
        self.loading = false;
        self.preserve_selection();
        self.sync_choices(window, cx);
        self.refresh_diff();
        cx.notify();
        true
    }
    pub fn acknowledge_checkpoint(
        &mut self,
        request_id: Uuid,
        outcome: CheckpointOutcome,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts(request_id)
            || !matches!(
                self.pending.as_ref().map(|pending| &pending.kind),
                Some(PendingKind::Checkpoint)
            )
            || outcome.timeline.validate(self.current.id).is_err()
            || outcome.timeline.generation < self.timeline.generation
        {
            return false;
        }
        self.pending = None;
        self.timeline = outcome.timeline;
        self.selected_id = self.timeline.revisions.first().map(|snapshot| snapshot.id);
        self.compared_id = None;
        self.confirm_restore = false;
        self.error = None;
        self.message = Some(
            if outcome.created.is_some() {
                "Checkpoint saved."
            } else {
                "The current manuscript already has a checkpoint."
            }
            .into(),
        );
        self.sync_choices(window, cx);
        self.refresh_diff();
        cx.notify();
        true
    }
    pub fn acknowledge_restored(
        &mut self,
        request_id: Uuid,
        saved: Arc<Manuscript>,
        timeline: Arc<RevisionTimeline>,
        generation: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts(request_id)
            || saved.id != self.current.id
            || saved.validate().is_err()
            || timeline.validate(saved.id).is_err()
            || timeline.generation < self.timeline.generation
            || generation < self.generation
        {
            return false;
        }
        let Some(PendingKind::Restore { label }) =
            self.pending.as_ref().map(|pending| &pending.kind)
        else {
            return false;
        };
        let label = label.clone();
        self.pending = None;
        self.current = saved;
        self.timeline = timeline;
        self.generation = generation;
        self.compared_id = None;
        self.confirm_restore = false;
        self.error = None;
        self.message = Some(format!(
            "Restored “{label}”. Your previous draft was saved as a checkpoint."
        ));
        self.preserve_selection();
        self.sync_choices(window, cx);
        self.refresh_diff();
        cx.notify();
        true
    }
    pub fn acknowledge_tasks(
        &mut self,
        request_id: Uuid,
        timeline: Arc<RevisionTimeline>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts(request_id)
            || !matches!(
                self.pending.as_ref().map(|pending| &pending.kind),
                Some(PendingKind::Task)
            )
            || timeline.validate(self.current.id).is_err()
            || timeline.generation < self.timeline.generation
        {
            return false;
        }
        self.pending = None;
        self.timeline = timeline;
        self.error = None;
        self.preserve_selection();
        self.sync_choices(window, cx);
        cx.notify();
        true
    }
    pub fn report_error(
        &mut self,
        request_id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts(request_id) {
            return false;
        }
        self.pending = None;
        self.message = None;
        self.error = Some(message.into());
        cx.notify();
        true
    }
    fn accepts(&self, id: Uuid) -> bool {
        self.pending.as_ref().is_some_and(|pending| {
            pending.id == id
                && pending.folio_id == self.current.id
                && pending.generation == self.generation
        })
    }
    fn can_write(&self) -> bool {
        self.capabilities.writable()
            && self.pending.is_none()
            && !self.loading
            && self.timeline.folio_id == self.current.id
    }
    fn checkpoint(&mut self, cx: &mut Context<Self>) {
        if !self.can_write() || !self.capabilities.checkpoint {
            return;
        }
        let request_id = self.begin(PendingKind::Checkpoint);
        cx.emit(RevisionEvent::CheckpointRequested {
            request_id,
            folio_id: self.current.id,
            generation: self.generation,
        });
        cx.notify();
    }
    fn restore(&mut self, cx: &mut Context<Self>) {
        if !self.can_write() || !self.capabilities.restore || !self.confirm_restore {
            return;
        }
        let Some(snapshot) = self.selected_id.and_then(|id| self.timeline.snapshot(id)) else {
            return;
        };
        let snapshot_id = snapshot.id;
        let label = snapshot.label.clone();
        let request_id = self.begin(PendingKind::Restore { label });
        cx.emit(RevisionEvent::RestoreRequested {
            request_id,
            folio_id: self.current.id,
            snapshot_id,
            generation: self.generation,
        });
        cx.notify();
    }
    fn toggle_task(&mut self, task_id: Uuid, done: bool, cx: &mut Context<Self>) {
        if !self.can_write() || !self.capabilities.tasks {
            return;
        }
        let request_id = self.begin(PendingKind::Task);
        cx.emit(RevisionEvent::TaskStatusRequested {
            request_id,
            folio_id: self.current.id,
            task_id,
            status: if done {
                RevisionTaskStatus::Done
            } else {
                RevisionTaskStatus::Open
            },
            generation: self.generation,
        });
        cx.notify();
    }
    fn begin(&mut self, kind: PendingKind) -> Uuid {
        let id = Uuid::new_v4();
        self.pending = Some(PendingRequest {
            id,
            folio_id: self.current.id,
            generation: self.generation,
            kind,
        });
        self.message = None;
        self.error = None;
        id
    }
    fn preserve_selection(&mut self) {
        if self
            .selected_id
            .is_none_or(|id| self.timeline.snapshot(id).is_none())
        {
            self.selected_id = self.timeline.revisions.first().map(|snapshot| snapshot.id);
        }
        if self.compared_id == self.selected_id
            || self
                .compared_id
                .is_some_and(|id| self.timeline.snapshot(id).is_none())
        {
            self.compared_id = None;
        }
    }
    fn sync_choices(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let earlier = choices(&self.timeline.revisions, None, false);
        let selected = self.selected_id.map(|id| id.to_string());
        self.earlier.update(cx, |state, cx| {
            state.set_items(earlier, window, cx);
            if let Some(selected) = selected {
                state.set_selected_value(&selected, window, cx);
            } else {
                state.set_selected_index(None, window, cx);
            }
        });
        let compared = choices(&self.timeline.revisions, self.selected_id, true);
        let selected = self
            .compared_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "current".into());
        self.compared.update(cx, |state, cx| {
            state.set_items(compared, window, cx);
            state.set_selected_value(&selected, window, cx);
        });
    }
    fn refresh_diff(&mut self) {
        self.diff = self
            .selected_id
            .and_then(|id| self.timeline.snapshot(id))
            .map(|selected| {
                let compared = self
                    .compared_id
                    .and_then(|id| self.timeline.snapshot(id))
                    .map(|snapshot| snapshot.manuscript.as_ref())
                    .unwrap_or(self.current.as_ref());
                compare_manuscripts(&selected.manuscript, compared)
            });
    }
    fn header(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        div().pb(px(16.)).border_b_1().border_color(rgb(colors.rule))
            .child(div().font_family(TYPEWRITER_FONT).text_size(px(10.)).text_color(rgb(colors.ink_muted))
                .child(tracked_label("VERSION HISTORY", TYPEWRITER_FONT, 10., 3.2)))
            .child(div().mt(px(4.)).flex().flex_wrap().items_start().justify_between().gap(px(12.))
                .child(div().flex_1().min_w_0()
                    .child(div().font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD).text_size(px(18.))
                        .truncate().child(self.current.display_title().to_owned()))
                    .child(div().mt(px(4.)).text_size(px(14.)).line_height(px(20.)).text_color(rgb(colors.ink_light))
                        .child("Review what changed, save a checkpoint, or restore an earlier manuscript without leaving the editor.")))
                .child(press_button("revision-save-checkpoint", "Save checkpoint", Some(TwyneIcon::Add), cx)
                    .disabled(!self.can_write() || !self.capabilities.checkpoint)
                    .on_click(cx.listener(|this, _, _, cx| this.checkpoint(cx)))))
            .into_any_element()
    }
    fn selectors(&self) -> AnyElement {
        div()
            .mt(px(20.))
            .flex()
            .flex_wrap()
            .gap(px(12.))
            .child(
                div()
                    .flex_1()
                    .min_w(px(240.))
                    .text_size(px(12.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Earlier checkpoint")
                    .child(
                        div().mt(px(4.)).child(
                            Select::new(&self.earlier)
                                .id("revision-earlier")
                                .accessibility_label("Earlier checkpoint")
                                .w_full()
                                .disabled(self.pending.is_some()),
                        ),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(240.))
                    .text_size(px(12.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Compare with")
                    .child(
                        div().mt(px(4.)).child(
                            Select::new(&self.compared)
                                .id("revision-compare")
                                .accessibility_label("Compare with")
                                .w_full()
                                .disabled(self.pending.is_some()),
                        ),
                    ),
            )
            .into_any_element()
    }
    fn passage_changes(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let selected = self.selected_id.and_then(|id| self.timeline.snapshot(id));
        let compared_label = self
            .compared_id
            .and_then(|id| self.timeline.snapshot(id))
            .map(|snapshot| snapshot.label.as_str())
            .unwrap_or("Current manuscript");
        let mut content = div().mt(px(20.))
            .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(div().child(div().font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(16.)).child("Changed passages"))
                    .when_some(selected, |this, selected| this.child(div().mt(px(4.)).text_size(px(12.))
                        .text_color(rgb(colors.ink_light)).child(format!("{} compared with {compared_label}", selected.label)))))
                .when(selected.is_some(), |this| this.child(paper_button("revision-restore-checkpoint", "Restore checkpoint", cx)
                    .disabled(!self.can_write() || !self.capabilities.restore)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.confirm_restore = true;
                        this.reveal_restore = true;
                        this.restore_focus_handle.focus(window, cx);
                        cx.notify();
                    })))))
            .when(self.diff.as_ref().is_some_and(|diff| diff.basis == RevisionComparisonBasis::CanonicalSource), |this| {
                this.child(div().mt(px(12.)).text_size(px(12.)).line_height(px(18.))
                    .text_color(rgb(colors.ink_light)).child("The rich projection is unavailable; this comparison uses canonical source."))
            });
        if let Some(diff) = &self.diff {
            if diff.passages.is_empty() {
                let mut same = div()
                    .mt(px(16.))
                    .bg(rgb(colors.paper_soft))
                    .p(px(16.))
                    .text_size(px(14.))
                    .text_color(rgb(colors.ink_light))
                    .child("These versions have the same manuscript text.");
                if diff.canonical_source_changed {
                    same = same.child(div().mt(px(8.)).child("Their canonical source differs."));
                }
                if diff.metadata_changed {
                    same = same.child(
                        div()
                            .mt(px(8.))
                            .child("Their page settings or document metadata differ."),
                    );
                }
                content = content.child(same);
            } else {
                let changes = diff.passages.iter().enumerate().map(|(index, change)| {
                    div()
                        .id(SharedString::from(format!("revision-passage-{index}")))
                        .border_1()
                        .border_color(rgb(colors.rule))
                        .bg(rgb(colors.paper_soft))
                        .p(px(12.))
                        .when_some(change.before.as_ref(), |this, text| {
                            this.child(passage(
                                "Removed",
                                text,
                                rgb(mix_color(colors.vermilion, colors.paper, 0.07)).into(),
                                colors,
                                false,
                            ))
                        })
                        .when_some(change.after.as_ref(), |this, text| {
                            this.child(passage(
                                "Added",
                                text,
                                rgb(mix_color(colors.sage, colors.paper, 0.09)).into(),
                                colors,
                                change.before.is_some(),
                            ))
                        })
                });
                content = content.child(
                    div()
                        .mt(px(16.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .children(changes),
                );
            }
        }
        content.into_any_element()
    }
    fn restore_confirmation(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let selected = self.selected_id.and_then(|id| self.timeline.snapshot(id))?;
        if !self.confirm_restore {
            return None;
        }
        let colors = *theme::palette(cx);
        Some(
            div()
                .id("revision-restore-confirmation")
                .test_support()
                .track_focus(&self.restore_focus_handle)
                .key_context("RevisionRestore")
                .on_action(cx.listener(|this, _: &ConfirmRestore, _, cx| {
                    this.restore(cx);
                    cx.stop_propagation();
                }))
                .on_action(cx.listener(|this, _: &CancelRestore, window, cx| {
                    if this.pending.is_none() {
                        this.confirm_restore = false;
                        this.focus_handle.focus(window, cx);
                        cx.notify();
                    }
                    cx.stop_propagation();
                }))
                .mt(px(20.))
                .border_1()
                .border_color(rgb(colors.vermilion))
                .bg(rgb(colors.paper_soft))
                .p(px(16.))
                .child(div().text_size(px(14.)).line_height(px(24.)).child(format!(
                    "Twyne will save the current manuscript first, then restore “{}”.",
                    selected.label
                )))
                .child(
                    div()
                        .mt(px(12.))
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .child(
                            press_button(
                                "revision-confirm-restore",
                                "Save current and restore",
                                None,
                                cx,
                            )
                            .disabled(!self.can_write() || !self.capabilities.restore)
                            .on_click(cx.listener(|this, _, _, cx| this.restore(cx))),
                        )
                        .child(
                            paper_button("revision-cancel-restore", "Keep current manuscript", cx)
                                .disabled(self.pending.is_some())
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.confirm_restore = false;
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }
    fn tasks(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.timeline.tasks.is_empty() {
            return None;
        }
        let colors = *theme::palette(cx);
        let mut section = div()
            .mt(px(20.))
            .border_t_1()
            .border_color(rgb(colors.rule))
            .pt(px(16.))
            .child(
                Button::new("revision-tasks-toggle")
                    .ghost()
                    .small()
                    .font_family(SANS_FONT)
                    .text_size(px(14.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .label(format!(
                        "Revision tasks ({} open)",
                        self.timeline.open_task_count()
                    ))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.tasks_expanded = !this.tasks_expanded;
                        cx.notify();
                    })),
            );
        if self.tasks_expanded {
            section = section.child(div().mt(px(12.)).flex().flex_col().gap(px(8.)).children(
                self.timeline.tasks.iter().map(|task| {
                    let task_id = task.id;
                    div()
                        .bg(rgb(colors.paper_soft))
                        .p(px(12.))
                        .flex()
                        .items_start()
                        .gap(px(12.))
                        .child(
                            Checkbox::new(SharedString::from(format!("revision-task-{}", task.id)))
                                .accessibility_label(task.title.clone())
                                .checked(task.status == RevisionTaskStatus::Done)
                                .disabled(!self.can_write() || !self.capabilities.tasks)
                                .on_click(cx.listener(move |this, done, _, cx| {
                                    this.toggle_task(task_id, *done, cx)
                                })),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_size(px(14.))
                                .line_height(px(20.))
                                .when(task.status == RevisionTaskStatus::Done, |this| {
                                    this.line_through().text_color(rgb(colors.ink_light))
                                })
                                .child(task.title.clone())
                                .when_some(task.detail.as_ref(), |this, detail| {
                                    this.child(
                                        div()
                                            .mt(px(4.))
                                            .text_size(px(12.))
                                            .text_color(rgb(colors.ink_light))
                                            .child(detail.clone()),
                                    )
                                }),
                        )
                }),
            ));
        }
        Some(section.into_any_element())
    }
}

impl Render for RevisionView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *theme::palette(cx);
        let mut panel = div()
            .id("revision-history-panel")
            .test_support()
            .track_focus(&self.focus_handle)
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .bg(rgb(colors.paper))
            .text_color(rgb(colors.ink))
            .font_family(SANS_FONT)
            .p(px(16.))
            .child(self.header(cx));
        if let Some(reason) = self.capabilities.write_blocked_reason() {
            panel = panel.child(
                div()
                    .id("revision-capability-status")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(reason)
                    .mt(px(16.))
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .text_color(rgb(colors.ink_light))
                    .child(reason),
            );
        }
        if let Some(message) = &self.message {
            panel = panel.child(
                div()
                    .id("revision-saved-status")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(message.clone())
                    .mt(px(16.))
                    .text_size(px(14.))
                    .text_color(rgb(colors.sage))
                    .child(message.clone()),
            );
        }
        if let Some(error) = &self.error {
            panel = panel.child(
                div()
                    .id("revision-error")
                    .test_support()
                    .role(Role::Alert)
                    .aria_label(error.clone())
                    .mt(px(16.))
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .text_color(rgb(colors.vermilion))
                    .child(error.clone()),
            );
        }
        if let Some(pending) = &self.pending {
            let pending_label = match pending.kind {
                PendingKind::Checkpoint => "Saving checkpoint…",
                PendingKind::Restore { .. } => "Restoring checkpoint…",
                PendingKind::Task => "Saving revision task…",
            };
            panel = panel.child(
                div()
                    .id("revision-pending-status")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(pending_label)
                    .mt(px(16.))
                    .text_size(px(14.))
                    .text_color(rgb(colors.ink_light))
                    .child(pending_label),
            );
        }
        if self.loading {
            panel = panel.child(
                div()
                    .py(px(32.))
                    .text_size(px(14.))
                    .text_color(rgb(colors.ink_light))
                    .child("Opening version history…"),
            );
        } else if self.timeline.revisions.is_empty() {
            panel = panel.child(div().py(px(40.)).text_center()
                .child(div().font_family(DISPLAY_FONT).text_size(px(18.)).child("No checkpoints yet"))
                .child(div().mt(px(8.)).text_size(px(14.)).line_height(px(24.)).text_color(rgb(colors.ink_light))
                    .child("Save the current manuscript to start a history you can compare and restore.")));
        } else if self.capabilities.local_history {
            panel = panel.child(self.selectors());
            if let Some(diff) = &self.diff {
                panel = panel.child(summary(&diff.summary, colors));
            }
            panel = panel.child(self.passage_changes(cx));
            if let Some(confirmation) = self.restore_confirmation(cx) {
                panel = panel.child(confirmation);
                if self.reveal_restore {
                    // This is a direct panel child. Use this frame's measured
                    // bounds, including the newly opened confirmation.
                    let status_count =
                        usize::from(self.capabilities.write_blocked_reason().is_some())
                            + usize::from(self.message.is_some())
                            + usize::from(self.error.is_some())
                            + usize::from(self.pending.is_some());
                    let index = 1 + status_count + 1 + usize::from(self.diff.is_some()) + 1;
                    self.scroll_handle.scroll_to_item(index);
                    self.reveal_restore = false;
                }
            }
        }
        if self.capabilities.local_history
            && let Some(tasks) = self.tasks(cx)
        {
            panel = panel.child(tasks);
        }
        panel
    }
}

fn choices(
    revisions: &[RevisionSnapshot],
    excluded: Option<Uuid>,
    include_current: bool,
) -> Choices {
    let mut items = Vec::new();
    if include_current {
        items.push(Choice {
            label: "Current manuscript".into(),
            value: "current".into(),
        });
    }
    items.extend(
        revisions
            .iter()
            .filter(|snapshot| Some(snapshot.id) != excluded)
            .map(|snapshot| Choice {
                label: checkpoint_label(snapshot).into(),
                value: snapshot.id.to_string(),
            }),
    );
    SearchableVec::new(items)
}
pub fn checkpoint_label(snapshot: &RevisionSnapshot) -> String {
    let date = i64::try_from(snapshot.created_at)
        .ok()
        .and_then(DateTime::from_timestamp_millis)
        .map(|date| date.with_timezone(&Local).format("%x, %X").to_string())
        .unwrap_or_else(|| "Unknown date".into());
    format!("{} · {date}", snapshot.label)
}
fn press_button(
    id: &'static str,
    label: &'static str,
    icon: Option<TwyneIcon>,
    cx: &App,
) -> Button {
    let colors = *theme::palette(cx);
    Button::new(id)
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(colors.ink).into())
                .foreground(rgb(colors.paper).into())
                .hover(rgb(colors.vermilion_deep).into())
                .active(rgb(colors.vermilion_deep).into()),
        )
        .font_family(TYPEWRITER_FONT)
        .text_size(px(11.2))
        .rounded(px(2.))
        .h(px(36.4))
        .px(px(16.))
        .border_1()
        .border_color(rgb(colors.ink))
        .bg(rgb(colors.ink))
        .text_color(rgb(colors.paper))
        .accessibility_label(label)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .when_some(icon, |this, icon| {
                    this.child(assets::icon(icon).size(px(16.)))
                })
                .child(tracked_label(
                    label.to_uppercase(),
                    TYPEWRITER_FONT,
                    11.2,
                    2.016,
                )),
        )
}
fn paper_button(id: &'static str, label: &'static str, cx: &App) -> Button {
    let colors = *theme::palette(cx);
    Button::new(id)
        .ghost()
        .small()
        .font_family(SANS_FONT)
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(12.))
        .rounded(px(2.))
        .h(px(32.4))
        .px(px(14.4))
        .border_1()
        .border_color(rgb(colors.rule))
        .bg(rgb(colors.paper_soft))
        .accessibility_label(label)
        .child(
            div()
                .font_family(SANS_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .child(label),
        )
}
fn summary(comparison: &RevisionComparison, colors: theme::Palette) -> AnyElement {
    let mut summary = div()
        .mt(px(16.))
        .py(px(12.))
        .border_y_1()
        .border_color(rgb(colors.rule))
        .text_size(px(12.))
        .line_height(px(18.))
        .text_color(rgb(colors.ink_light))
        .child(
            div()
                .mb(px(12.))
                .flex()
                .items_baseline()
                .gap(px(6.4))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(colors.ink))
                        .child(format_number(comparison.words_changed)),
                )
                .child("words changed"),
        );
    for (index, (label, before, after)) in [
        ("Words", comparison.words_before, comparison.words_after),
        (
            "Passages",
            comparison.paragraphs_before,
            comparison.paragraphs_after,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let maximum = before.max(after).max(1) as f32;
        let delta = if before == after {
            "No change".into()
        } else {
            format!(
                "{}{} net",
                if after > before { "+" } else { "−" },
                format_number(after.abs_diff(before))
            )
        };
        let mut metric = div().when(index > 0, |this| this.mt(px(16.))).child(
            div()
                .mb(px(4.8))
                .flex()
                .items_baseline()
                .justify_between()
                .gap(px(8.))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(colors.ink))
                        .child(label),
                )
                .child(delta),
        );
        for (label, value, ink) in [
            ("Before", before, colors.ink_light),
            ("After", after, colors.vermilion_deep),
        ] {
            metric = metric.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .min_h(px(22.4))
                    .child(div().w(px(60.)).flex_shrink_0().child(label))
                    .child(
                        div().h(px(6.)).flex_1().bg(rgb(colors.rule)).child(
                            div()
                                .h_full()
                                .w(relative(value as f32 / maximum))
                                .bg(rgb(ink)),
                        ),
                    )
                    .child(
                        div()
                            .w(px(72.))
                            .flex_shrink_0()
                            .text_right()
                            .text_color(rgb(colors.ink))
                            .child(format_number(value)),
                    ),
            );
        }
        summary = summary.child(metric);
    }
    summary.into_any_element()
}
fn passage(
    label: &'static str,
    text: &str,
    background: gpui_kit::Hsla,
    colors: theme::Palette,
    margin_top: bool,
) -> AnyElement {
    div()
        .when(margin_top, |this| this.mt(px(8.)))
        .bg(background)
        .p(px(12.))
        .child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(10.))
                .text_color(rgb(if label == "Added" {
                    colors.sage
                } else {
                    colors.vermilion
                }))
                .child(tracked_label(label.to_uppercase(), SANS_FONT, 10., 1.)),
        )
        .child(
            div()
                .mt(px(4.))
                .font_family(SERIF_FONT)
                .text_size(px(14.))
                .line_height(px(24.))
                .text_color(rgb(colors.ink))
                .child(text.to_owned()),
        )
        .into_any_element()
}
/// Chrome labels are bounded static strings. GPUI has no letter-spacing style;
/// native cells retain the source CSS advance without changing document text.
fn tracked_label(
    label: impl Into<String>,
    font: &'static str,
    size: f32,
    tracking: f32,
) -> gpui_kit::Div {
    div()
        .flex()
        .items_center()
        .gap(px(tracking))
        .pr(px(tracking))
        .font_family(font)
        .text_size(px(size))
        .children(label.into().chars().map(|character| {
            div().flex_shrink_0().child(if character == ' ' {
                "\u{a0}".into()
            } else {
                character.to_string()
            })
        }))
}
fn mix_color(ink: u32, paper: u32, amount: f32) -> u32 {
    let mut mixed = 0;
    for shift in [0, 8, 16] {
        let channel = ((ink >> shift) & 0xff) as f32 * amount
            + ((paper >> shift) & 0xff) as f32 * (1. - amount);
        mixed |= (channel.round() as u32) << shift;
    }
    mixed
}
fn format_number(value: usize) -> String {
    let raw = value.to_string();
    let mut result = String::with_capacity(raw.len() + raw.len() / 3);
    for (index, character) in raw.chars().enumerate() {
        if index > 0 && (raw.len() - index).is_multiple_of(3) {
            result.push(',');
        }
        result.push(character);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_and_read_only_capabilities_gate_all_mutations() {
        let mut capabilities = RevisionCapabilities::local();
        assert!(capabilities.writable());
        capabilities.source_pending = true;
        assert!(!capabilities.writable());
        assert!(
            capabilities
                .write_blocked_reason()
                .unwrap()
                .contains("Apply or discard")
        );
        capabilities.source_pending = false;
        capabilities.source_conflict = true;
        assert!(!capabilities.writable());
        capabilities.source_conflict = false;
        capabilities.read_only = true;
        assert!(!capabilities.writable());
        capabilities.read_only = false;
        capabilities.local_history = false;
        assert!(!capabilities.writable());
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod ui_tests {
    use super::*;
    use crate::revisions::{CheckpointOptions, RevisionStore};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size,
    };
    use std::sync::Mutex;
    use tempfile::{TempDir, tempdir};

    fn panel(
        cx: &mut TestAppContext,
        with_checkpoint: bool,
    ) -> (
        AnyWindowHandle,
        Entity<RevisionView>,
        RevisionStore,
        TempDir,
    ) {
        panel_at_size(cx, with_checkpoint, 760., 1000.)
    }
    fn panel_at_size(
        cx: &mut TestAppContext,
        with_checkpoint: bool,
        width: f32,
        height: f32,
    ) -> (
        AnyWindowHandle,
        Entity<RevisionView>,
        RevisionStore,
        TempDir,
    ) {
        let directory = tempdir().unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let mut current = Manuscript::new("A writer’s manuscript");
        current.body = "An original opening.".into();
        if with_checkpoint {
            history
                .checkpoint(Arc::new(current.clone()), CheckpointOptions::manual(1))
                .unwrap();
            current.body = "A stronger opening with evidence.".into();
            current.touch();
        }
        let current = Arc::new(current);
        let timeline = history.load(current.id).unwrap().timeline;
        let (handle, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(width), px(height)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        RevisionView::new(
                            current,
                            timeline,
                            RevisionCapabilities::local(),
                            7,
                            window,
                            cx,
                        )
                    })
                },
            )
            .unwrap()
        });
        (handle, view, history, directory)
    }
    fn events(
        cx: &mut TestAppContext,
        view: &Entity<RevisionView>,
    ) -> Arc<Mutex<Vec<RevisionEvent>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let receiver = events.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &RevisionEvent, _| {
                receiver.lock().unwrap().push(event.clone())
            })
            .detach()
        });
        events
    }

    #[gpui_kit::test]
    fn checkpoint_click_is_only_a_request_and_failure_can_retry(cx: &mut TestAppContext) {
        let (handle, view, history, _directory) = panel(cx, false);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                window.find("revision-save-checkpoint").label(),
                Some("Save checkpoint")
            );
            window.click("revision-save-checkpoint", cx);
            assert!(view.read(cx).message.is_none());
            assert!(view.read(cx).timeline.revisions.is_empty());
        })
        .unwrap();
        let RevisionEvent::CheckpointRequested {
            request_id,
            generation,
            ..
        } = received.lock().unwrap()[0]
        else {
            panic!("checkpoint event");
        };
        assert_eq!(generation, 7);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(view.report_error(request_id, "Disk unavailable", cx));
                assert!(!view.report_error(Uuid::new_v4(), "Stale error", cx));
            });
            window.render_frame(cx);
            assert_eq!(
                window.find("revision-error").label(),
                Some("Disk unavailable")
            );
            window.click("revision-save-checkpoint", cx);
        })
        .unwrap();
        let retry_id = cx.update(|cx| view.read(cx).pending_request_id().unwrap());
        let current = cx.update(|cx| view.read(cx).current().clone());
        let outcome = history
            .checkpoint(current, CheckpointOptions::manual(2))
            .unwrap();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(!view.acknowledge_checkpoint(request_id, outcome.clone(), window, cx));
                assert!(view.acknowledge_checkpoint(retry_id, outcome, window, cx));
            });
            window.render_frame(cx);
            assert_eq!(
                window.find("revision-saved-status").label(),
                Some("Checkpoint saved.")
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn restore_requires_confirmation_and_acknowledges_actual_saved_source(cx: &mut TestAppContext) {
        let (handle, view, history, directory) = panel(cx, true);
        let library = crate::storage::Store::open(directory.path().into()).unwrap();
        let current = cx.update(|cx| view.read(cx).current().clone());
        library.save(&current).unwrap();
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("revision-restore-checkpoint", cx);
            window.click("revision-cancel-restore", cx);
            assert!(view.read(cx).pending_request_id().is_none());
            window.click("revision-restore-checkpoint", cx);
            window.click("revision-confirm-restore", cx);
            assert_eq!(view.read(cx).current.body, current.body);
            assert!(view.read(cx).message.is_none());
        })
        .unwrap();
        let RevisionEvent::RestoreRequested {
            request_id,
            snapshot_id,
            ..
        } = received.lock().unwrap()[0]
        else {
            panic!("restore event");
        };
        let plan = history
            .prepare_restore(request_id, snapshot_id, current.clone(), 100)
            .unwrap();
        assert!(plan.matches_current(&current));
        assert_eq!(library.load().unwrap().documents[0].body, current.body);
        library
            .save_if_revision(&plan.replacement, current.revision)
            .unwrap();
        let saved = Arc::new(library.load().unwrap().documents.remove(0));
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(view.acknowledge_restored(
                    request_id,
                    saved.clone(),
                    plan.timeline,
                    8,
                    window,
                    cx
                ))
            });
            window.render_frame(cx);
            assert_eq!(view.read(cx).current.body, "An original opening.");
            assert_eq!(
                window.find("revision-saved-status").label(),
                Some(
                    "Restored “Manual checkpoint”. Your previous draft was saved as a checkpoint."
                )
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn narrow_panel_reveals_confirmation_and_keyboard_can_cancel_or_confirm(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _, _directory) = panel_at_size(cx, true, 464., 580.);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.scroll(
                "revision-history-panel",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-360.))),
                cx,
            );
            window.click("revision-restore-checkpoint", cx);
            assert!(view.read(cx).restore_focus_handle.is_focused(window));
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.render_frame(cx);
            assert!(window.find("revision-confirm-restore").visible());
            window.press("escape", cx);
            assert!(!view.read(cx).confirm_restore);
            assert!(view.read(cx).pending_request_id().is_none());
            view.read(cx).scroll_handle.set_offset(Point::default());
            window.render_frame(cx);
            window.scroll(
                "revision-history-panel",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-360.))),
                cx,
            );
            window.click("revision-restore-checkpoint", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("enter", cx);
            assert!(view.read(cx).pending_request_id().is_some());
            assert!(view.read(cx).message.is_none());
        })
        .unwrap();
        assert!(matches!(
            received.lock().unwrap().as_slice(),
            [RevisionEvent::RestoreRequested { .. }]
        ));
    }

    #[gpui_kit::test]
    fn pending_source_and_read_only_do_not_emit_mutations_and_stale_ack_is_ignored(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, history, _directory) = panel(cx, true);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            for capabilities in [
                RevisionCapabilities {
                    source_pending: true,
                    ..RevisionCapabilities::local()
                },
                RevisionCapabilities {
                    source_conflict: true,
                    ..RevisionCapabilities::local()
                },
                RevisionCapabilities {
                    read_only: true,
                    ..RevisionCapabilities::local()
                },
            ] {
                view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
                window.render_frame(cx);
                window.click("revision-save-checkpoint", cx);
                window.click("revision-restore-checkpoint", cx);
                assert!(view.read(cx).pending_request_id().is_none());
                assert!(!view.read(cx).confirm_restore);
            }
            view.update(cx, |view, cx| {
                view.set_capabilities(RevisionCapabilities::local(), cx)
            });
            window.click("revision-save-checkpoint", cx);
        })
        .unwrap();
        assert_eq!(received.lock().unwrap().len(), 1);
        let request_id = cx.update(|cx| view.read(cx).pending_request_id().unwrap());
        let current = cx.update(|cx| view.read(cx).current().clone());
        let outcome = history
            .checkpoint(current.clone(), CheckpointOptions::manual(2))
            .unwrap();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                let timeline = view.timeline().clone();
                assert!(view.replace_data(current.clone(), timeline, 8, window, cx));
                assert!(!view.acknowledge_checkpoint(request_id, outcome, window, cx));
                assert!(view.message.is_none());
            });
        })
        .unwrap();
    }
}
