//! The retained Rubric at the Board and its read-only full Galley.
//! The host supplies freshness, locale labels, exact room arithmetic and saves.

use crate::{
    assets::{self, TwyneAssets, TwyneIcon},
    cast,
    house::is_js_whitespace,
    rubric::{
        self, CachedScoreSet, CriterionSource, PassageKind, RubricCriterion, RubricCriterionSpec,
        RubricDisplay, RubricEdit, RubricEffect, RubricRecord, RubricRequest, RubricResult,
        RubricSession, ScoringMethod,
    },
    semantic_bridge::RubricRoomParts,
    theme::{self, BUTTON_FONT, DISPLAY_FONT, MONO_FONT, SERIF_FONT, TYPEWRITER_FONT},
};
use anyhow::{Result, ensure};
use gpui_kit::base::text::{TextView, TextViewStyle};
use gpui_kit::component::{
    Disableable, Sizable,
    checkbox::Checkbox,
    input::{Input, InputEvent, InputState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, AssetSource, Bounds, Context, Corners, Entity, EventEmitter, FocusHandle,
    Focusable, FontWeight, PathBuilder, Render, RenderImage, ScrollHandle, SharedString,
    Subscription, Task, TestSupportExt, Window, canvas, div, fill, img, point, px, relative, rems,
    rgb, size,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RubricSurface {
    #[default]
    Board,
    Galley,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RubricSection {
    Criteria,
    Editors,
    #[default]
    Passages,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RubricFreshness {
    #[default]
    Unknown,
    Fresh,
    Stale,
}
#[derive(Clone, Debug)]
pub struct RubricViewContext {
    pub freshness: RubricFreshness,
    pub draft_word_count: Option<usize>,
    pub minimum_words: usize,
    pub result_filed_label: Option<String>,
    pub live_review_filed_label: Option<String>,
    pub live_review_status: Option<String>,
    pub room_parts: Option<RubricRoomParts>,
}
impl Default for RubricViewContext {
    fn default() -> Self {
        Self {
            freshness: RubricFreshness::Unknown,
            draft_word_count: None,
            minimum_words: 500,
            result_filed_label: None,
            live_review_filed_label: None,
            live_review_status: None,
            room_parts: None,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RubricCapabilities {
    pub persist: bool,
    pub grade: bool,
    pub ask_editors: bool,
    pub suggest_criteria: bool,
    pub review_guide: bool,
    pub refine_dossier: bool,
    pub tools: bool,
}
impl RubricCapabilities {
    pub fn local() -> Self {
        Self {
            persist: true,
            ..Self::default()
        }
    }
}
#[derive(Clone, Debug)]
pub enum RubricEvent {
    SaveRequested(RubricRequest),
    Filed {
        request_id: Uuid,
        effects: Vec<RubricEffect>,
    },
    SurfaceRequested(RubricSurface),
    BackToDesk,
    GradeRequested {
        folio_id: String,
    },
    AskEditorsRequested {
        folio_id: String,
    },
    SuggestCriteriaRequested {
        folio_id: String,
    },
    ReviewGuideRequested,
    RefineDossierRequested {
        folio_id: String,
    },
    OpenToolRequested {
        folio_id: String,
        criterion_id: String,
        tool: String,
    },
}
pub fn init(_: &mut App) {}

struct CustomForm {
    label: Entity<InputState>,
    description: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}
struct WeightInput {
    input: Entity<InputState>,
    accepted_weight: f64,
    _subscription: Subscription,
}
pub struct RubricView {
    session: RubricSession,
    active_folio_id: Option<String>,
    context: RubricViewContext,
    capabilities: RubricCapabilities,
    surface: RubricSurface,
    section: RubricSection,
    display: Option<RubricDisplay>,
    score_set: CachedScoreSet,
    forms: BTreeMap<String, CustomForm>,
    weights: BTreeMap<(String, String), WeightInput>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    local_error: Option<String>,
    add_after_ack: Option<String>,
    criteria_open: bool,
    explainer_open: bool,
    open_criteria: BTreeSet<String>,
    open_probabilities: BTreeSet<String>,
    open_passages: BTreeSet<String>,
    weight_commit: Option<Task<()>>,
}
impl EventEmitter<RubricEvent> for RubricView {}
impl Focusable for RubricView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl RubricView {
    pub fn new(
        record: Arc<RubricRecord>,
        scope: Option<String>,
        context: RubricViewContext,
        capabilities: RubricCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut view = Self {
            session: RubricSession::new(record),
            active_folio_id: scope,
            context,
            capabilities,
            surface: RubricSurface::Board,
            section: RubricSection::Passages,
            display: None,
            score_set: CachedScoreSet::VisibleCriteria,
            forms: BTreeMap::new(),
            weights: BTreeMap::new(),
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            local_error: None,
            add_after_ack: None,
            criteria_open: false,
            explainer_open: false,
            open_criteria: BTreeSet::new(),
            open_probabilities: BTreeSet::new(),
            open_passages: BTreeSet::new(),
            weight_commit: None,
        };
        view.refresh_display(window, cx);
        view
    }
    pub fn saved_record(&self) -> &Arc<RubricRecord> {
        self.session.saved()
    }
    pub fn pending_request(&self) -> Option<&RubricRequest> {
        self.session.pending()
    }
    pub fn active_folio_id(&self) -> Option<&str> {
        self.active_folio_id.as_deref()
    }
    pub fn surface(&self) -> RubricSurface {
        self.surface
    }
    pub fn section(&self) -> RubricSection {
        self.section
    }
    pub fn display(&self) -> Option<&RubricDisplay> {
        self.display.as_ref()
    }
    pub fn set_context(&mut self, context: RubricViewContext, cx: &mut Context<Self>) {
        self.context = context;
        cx.notify();
    }
    pub fn set_capabilities(&mut self, capabilities: RubricCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn set_surface(&mut self, surface: RubricSurface, _: &mut Window, cx: &mut Context<Self>) {
        self.surface = surface;
        self.scroll_handle.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }
    pub fn set_section(&mut self, section: RubricSection, cx: &mut Context<Self>) {
        self.section = section;
        self.scroll_handle.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }
    pub fn set_scope(
        &mut self,
        scope: Option<String>,
        context: RubricViewContext,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.active_folio_id != scope && self.has_unsaved_changes(cx) {
            return false;
        }
        if self.active_folio_id != scope {
            self.active_folio_id = scope;
            self.score_set = CachedScoreSet::VisibleCriteria;
            self.open_criteria.clear();
            self.open_probabilities.clear();
            self.open_passages.clear();
            self.refresh_display(window, cx);
            self.scroll_handle.set_offset(point(px(0.), px(0.)));
        }
        self.context = context;
        cx.notify();
        true
    }
    pub fn has_unsaved_changes(&self, cx: &App) -> bool {
        self.session.pending().is_some() || !self.capture_weight_edits(cx).is_empty()
    }
    /// Only an explicitly submitted custom criterion is metadata. Navigation
    /// keeps its unsubmitted fields in this retained entity without filing them.
    pub fn prepare_pending_edits(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Result<Option<RubricRequest>> {
        if let Some(request) = self.session.pending() {
            return Ok(Some(request.clone()));
        }
        let edits = self.capture_weight_edits(cx);
        if edits.is_empty() {
            return Ok(None);
        }
        self.issue(RubricEdit::Batch(edits), cx)
    }
    pub fn flush_pending_edits(
        &mut self,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<RubricRequest>> {
        self.prepare_pending_edits(cx)
    }
    pub fn request_edit(
        &mut self,
        edit: RubricEdit,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<RubricRequest>> {
        ensure!(
            self.editable(),
            "Local Rubric criteria cannot be filed here."
        );
        ensure!(
            self.session.pending().is_none(),
            "Finish the previous Rubric save first."
        );
        ensure!(
            edit_is_scoped(&edit, self.active_folio_id()),
            "That edit belongs to another Rubric folio."
        );
        let mut edits = self.capture_weight_edits(cx);
        edits.push(edit);
        self.issue(RubricEdit::Batch(edits), cx)
    }
    pub fn ack_saved(
        &mut self,
        request_id: Uuid,
        record: Arc<RubricRecord>,
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
        if effects.iter().any(|effect| {
            matches!(effect, RubricEffect::CriteriaChanged{folio_id}
            if Some(folio_id.as_str()) == self.active_folio_id())
        }) {
            self.score_set = CachedScoreSet::AllJudgement;
        }
        if let Some(scope) = self.add_after_ack.take()
            && let Some(form) = self.forms.get(&scope)
        {
            form.label
                .update(cx, |input, cx| input.set_value("", window, cx));
            form.description
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        self.refresh_display(window, cx);
        self.local_error = None;
        cx.emit(RubricEvent::Filed {
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
    pub fn retry(&mut self, cx: &mut Context<Self>) -> Option<RubricRequest> {
        let request = self.session.retry()?;
        cx.emit(RubricEvent::SaveRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn replace_record(
        &mut self,
        record: Arc<RubricRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.has_unsaved_changes(cx) || !self.session.replace_record(record) {
            return false;
        }
        self.refresh_display(window, cx);
        cx.notify();
        true
    }
    fn editable(&self) -> bool {
        self.capabilities.persist
            && self.surface == RubricSurface::Board
            && self
                .display
                .as_ref()
                .is_some_and(|display| display.criteria_editable && display.result.value.is_some())
    }
    fn capture_weight_edits(&self, cx: &App) -> Vec<RubricEdit> {
        self.weights
            .iter()
            .filter_map(|((scope, id), field)| {
                let text = field.input.read(cx).text().to_string();
                // Source type=number ignores null/invalid input. It never replaces
                // an empty rope with an invented 1x change.
                let weight = text
                    .trim_matches(is_js_whitespace)
                    .parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())?;
                let weight = rubric::clamp_weight(weight);
                if weight == field.accepted_weight {
                    return None;
                }
                Some(RubricEdit::SetWeight {
                    folio_id: scope.clone(),
                    id: id.clone(),
                    weight,
                })
            })
            .collect()
    }
    fn issue(&mut self, edit: RubricEdit, cx: &mut Context<Self>) -> Result<Option<RubricRequest>> {
        ensure!(
            self.capabilities.persist,
            "Local Rubric filing is unavailable."
        );
        let request = self.session.request(edit)?;
        self.local_error = None;
        if let Some(request) = &request {
            cx.emit(RubricEvent::SaveRequested(request.clone()));
        }
        cx.notify();
        Ok(request)
    }
    fn refresh_display(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.weight_commit = None;
        self.display = self.active_folio_id.as_deref().and_then(|scope| {
            match self.session.saved().display(scope) {
                Ok(display) => Some(display),
                Err(error) => {
                    self.local_error = Some(error.to_string());
                    None
                }
            }
        });
        let mut prior_weights = std::mem::take(&mut self.weights);
        let Some(display) = &self.display else { return };
        let scope = display.folio_id.clone();
        if !self.forms.contains_key(&scope) {
            let label =
                cx.new(|cx| InputState::new(window, cx).placeholder("Add a criterion of your own"));
            let description = cx.new(|cx| {
                InputState::new(window, cx).placeholder("What does a strong version look like?")
            });
            let mut subscriptions = Vec::new();
            for input in [&label, &description] {
                subscriptions.push(cx.subscribe_in(
                    input,
                    window,
                    |this, _, event: &InputEvent, window, cx| {
                        if matches!(event, InputEvent::PressEnter { .. }) {
                            this.add_custom(window, cx);
                        }
                        cx.notify();
                    },
                ));
            }
            self.forms.insert(
                scope.clone(),
                CustomForm {
                    label,
                    description,
                    _subscriptions: subscriptions,
                },
            );
        }
        for criterion in &display.criteria {
            let key = (scope.clone(), criterion.id.clone());
            if let Some(mut field) = prior_weights.remove(&key) {
                let text = field.input.read(cx).text().to_string();
                let parsed = text.trim_matches(is_js_whitespace).parse::<f64>().ok();
                if parsed.is_some_and(|value| value != criterion.weight) {
                    field.input.update(cx, |input, cx| {
                        input.set_value(weight_label(criterion.weight), window, cx)
                    });
                }
                field.accepted_weight = criterion.weight;
                self.weights.insert(key, field);
                continue;
            }
            let accepted_text = weight_label(criterion.weight);
            let input =
                cx.new(|cx| InputState::new(window, cx).default_value(accepted_text.clone()));
            let subscription =
                cx.subscribe_in(&input, window, |this, _, event: &InputEvent, _, cx| {
                    if matches!(event, InputEvent::PressEnter { .. })
                        && this.editable()
                        && this.session.pending().is_none()
                    {
                        let result = this.prepare_pending_edits(cx);
                        this.local_result(result, cx);
                    }
                    if matches!(event, InputEvent::Change)
                        && this.editable()
                        && this.session.pending().is_none()
                    {
                        this.schedule_weight_commit(cx);
                    }
                    cx.notify();
                });
            self.weights.insert(
                (scope.clone(), criterion.id.clone()),
                WeightInput {
                    input,
                    accepted_weight: criterion.weight,
                    _subscription: subscription,
                },
            );
        }
    }
    fn local_result(&mut self, result: Result<Option<RubricRequest>>, cx: &mut Context<Self>) {
        if let Err(error) = result {
            self.local_error = Some(error.to_string());
            cx.notify();
        }
    }
    fn schedule_weight_commit(&mut self, cx: &mut Context<Self>) {
        let timer = cx.background_executor().timer(Duration::from_millis(350));
        self.weight_commit = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |this, cx| {
                if this.editable() && this.session.pending().is_none() {
                    let result = this.prepare_pending_edits(cx);
                    this.local_result(result, cx);
                }
            });
        }));
    }
    fn add_custom(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.editable() || self.session.pending().is_some() {
            return;
        }
        let result = (|| {
            let scope = self
                .active_folio_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("Choose a folio first."))?;
            let form = self
                .forms
                .get(&scope)
                .ok_or_else(|| anyhow::anyhow!("No criterion form is open."))?;
            let criterion = RubricCriterionSpec::custom(
                &form.label.read(cx).text().to_string(),
                &form.description.read(cx).text().to_string(),
            )?;
            let request = self.request_edit(
                RubricEdit::AddCustom {
                    folio_id: scope.clone(),
                    criterion,
                },
                window,
                cx,
            )?;
            if request.is_some() {
                self.add_after_ack = Some(scope);
            }
            Ok(request)
        })();
        self.local_result(result, cx);
    }
}
fn edit_is_scoped(edit: &RubricEdit, scope: Option<&str>) -> bool {
    match edit {
        RubricEdit::ToggleCriterion { folio_id, .. }
        | RubricEdit::SetWeight { folio_id, .. }
        | RubricEdit::RemoveCustom { folio_id, .. }
        | RubricEdit::AddCustom { folio_id, .. } => Some(folio_id.as_str()) == scope,
        RubricEdit::Batch(edits) => edits.iter().all(|edit| edit_is_scoped(edit, scope)),
        _ => false,
    }
}
fn weight_label(weight: f64) -> String {
    let s = format!("{weight:.2}");
    s.trim_end_matches('0').trim_end_matches('.').into()
}
impl Render for RubricView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(cx);
        div()
            .id("rubric-root")
            .test_support()
            .track_focus(&self.focus_handle)
            .size_full()
            .flex()
            .flex_col()
            .font_family(SERIF_FONT)
            .bg(rgb(p.paper_soft))
            .text_color(rgb(p.ink))
            .child(match self.surface {
                RubricSurface::Board => self.board(window, cx),
                RubricSurface::Galley => self.galley(window, cx),
            })
    }
}

impl RubricView {
    fn writable(&self) -> bool {
        self.editable() && self.session.pending().is_none()
    }
    fn provider_ready(&self) -> bool {
        self.active_folio_id.is_some()
            && self.session.pending().is_none()
            && self
                .context
                .draft_word_count
                .is_some_and(|n| n >= self.context.minimum_words)
    }
    fn status(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let p = *theme::palette(cx);
        if let Some(message) = self.session.error().or(self.local_error.as_deref()) {
            let retry = self.session.error().is_some();
            return Some(
                div()
                    .id("rubric-save-error")
                    .test_support()
                    .px(px(16.))
                    .py(px(8.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .child(prose(message, 12., 16., p.danger))
                    .when(retry, |error| {
                        error.child(
                            paper_button("rubric-save-retry", "Retry", cx)
                                .mt(px(6.))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.retry(cx);
                                })),
                        )
                    })
                    .into_any_element(),
            );
        }
        self.session.pending().map(|_| {
            div()
                .id("rubric-saving")
                .test_support()
                .px(px(16.))
                .py(px(8.))
                .child(prose("Saving criteria…", 12., 16., p.ink_muted))
                .into_any_element()
        })
    }
    fn board(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let guide = div()
            .flex()
            .justify_end()
            .px(px(16.))
            .pt(px(8.))
            .pb(px(12.))
            .flex_shrink_0()
            .child(
                gpui_kit::base::Button::new("rubric-review-guide")
                    .accessibility_label("Review guide")
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.4))
                            .text_color(rgb(p.ink_light))
                            .child(assets::icon(TwyneIcon::Page))
                            .child(
                                div()
                                    .font_family(theme::SANS_FONT)
                                    .text_size(px(12.))
                                    .line_height(relative(1.5))
                                    .underline()
                                    .child("Review guide"),
                            ),
                    )
                    .disabled(!self.capabilities.review_guide)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.capabilities.review_guide {
                            cx.emit(RubricEvent::ReviewGuideRequested)
                        }
                    })),
            );
        let mut body = div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(rgb(p.sidebar))
            .child(guide);
        if let Some(status) = self.status(cx) {
            body = body.child(status);
        }
        let Some(result) = self.display.as_ref().and_then(|d| d.result.value.as_ref()) else {
            let ready = self.capabilities.grade && self.provider_ready();
            body=body.child(div().px(px(16.)).py(px(16.)).flex_shrink_0()
                .child(press_button("rubric-grade","Grade this draft",cx).disabled(!ready)
                    .on_click(cx.listener(|this,_,_,cx| {
                        if this.capabilities.grade&&this.provider_ready()
                            && let Some(folio_id)=this.active_folio_id.clone(){cx.emit(RubricEvent::GradeRequested{folio_id});}
                    })))
                .when(!self.capabilities.grade,|empty|empty.child(div().mt(px(8.)).child(prose(
                    "Saved marks remain available here. Grading needs an available AI provider.",12.,16.,p.ink_muted)))));
            if let Some(issues) = self.issues(cx) {
                body = body.child(issues);
            }
            return body
                .child(self.scroll(self.passages(cx)))
                .into_any_element();
        };
        body = body.child(self.verdict(result, cx));
        if let Some(history) = self.history(cx) {
            body = body.child(history);
        }
        body = body.child(self.section_tabs(result, cx));
        if self.section == RubricSection::Passages {
            body = body.child(self.result_footer(cx));
            body = body.child(self.scroll(self.passages(cx)));
        } else {
            let content = match self.section {
                RubricSection::Criteria => self.criteria(result, window, cx),
                RubricSection::Editors => self.editors(result, cx),
                RubricSection::Passages => unreachable!(),
            };
            body = body
                .child(self.scroll(content))
                .child(self.result_footer(cx));
        }
        body.into_any_element()
    }
    fn scroll(&self, child: AnyElement) -> AnyElement {
        div()
            .id("rubric-scroll")
            .test_support()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .child(child)
            .into_any_element()
    }
    fn issues(&self, cx: &App) -> Option<AnyElement> {
        let display = self.display.as_ref()?;
        if display.issues.is_empty() {
            return None;
        }
        let p = *theme::palette(cx);
        Some(
            div()
                .id("rubric-retained-issues")
                .test_support()
                .px(px(16.))
                .py(px(12.))
                .children(display.issues.iter().map(|issue| {
                    div().mb(px(6.)).child(prose(
                        &format!("{}: {}", issue.path, issue.message),
                        12.,
                        16.,
                        p.danger,
                    ))
                }))
                .into_any_element(),
        )
    }
    fn verdict(&self, result: &RubricResult, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let weakest = rubric::weakest_criterion(&result.criteria);
        let mut score = div().flex_1().min_w_0().child(
            div()
                .flex()
                .items_baseline()
                .gap(px(6.))
                .child(display_text(&number(result.overall_score), 24., 32., p.ink))
                .child(prose("/ 100", 14., 20., p.ink_muted)),
        );
        if let Some(weakest) = weakest {
            let tool = tool_for(&weakest.id);
            let criterion_id = weakest.id.clone();
            score = score
                .child(tracked(
                    &format!("Needs most work: {}", weakest.label),
                    11.,
                    1.32,
                    p.ink_muted,
                ))
                .child(
                    gpui_kit::base::Button::new("rubric-work-on-weakest")
                        .accessibility_label("Work on it in the draft")
                        .child(crate::chrome::tracked_typewriter(
                            "Work on it in the draft",
                            11.,
                            1.32,
                            p.vermilion_deep,
                        ))
                        .disabled(!self.capabilities.tools || tool.is_none())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if this.capabilities.tools
                                && let Some(tool) = tool
                                && let Some(folio_id) = this.active_folio_id.clone()
                            {
                                cx.emit(RubricEvent::OpenToolRequested {
                                    folio_id,
                                    criterion_id: criterion_id.clone(),
                                    tool: tool.into(),
                                });
                            }
                        })),
                );
        }
        let mut card = div()
            .id("rubric-verdict")
            .test_support()
            .relative()
            .overflow_hidden()
            .flex_shrink_0()
            .px(px(16.))
            .py(px(12.))
            .border_b_2()
            .border_color(rgb(p.ink))
            .bg(rgb(p.paper_soft))
            .child(proof_fibers())
            .child(
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(grade_stamp(result, 88., cx))
                    .child(score),
            )
            .child(div().relative().mt(px(8.)).italic().child(prose(
                &rubric::summary_preview(&result.summary),
                14.,
                22.4,
                p.ink_light,
            )))
            .child(div().relative().mt(px(8.)).child(
                text_button("rubric-explainer", "How this was scored", cx).on_click(cx.listener(
                    |this, _, _, cx| {
                        this.explainer_open = !this.explainer_open;
                        cx.notify();
                    },
                )),
            ));
        if self.explainer_open {
            card = card.child(
                div()
                    .relative()
                    .mt(px(8.))
                    .child(self.explainer(result, cx)),
            );
        }
        card.into_any_element()
    }
    fn explainer(&self, result: &RubricResult, cx: &App) -> AnyElement {
        let p = *theme::palette(cx);
        let mut body = div().flex().flex_col().gap(px(6.));
        if result.scoring_method.as_ref() != Some(&ScoringMethod::Judgement) {
            if let Some(parts) = &self.context.room_parts {
                body=body.child(prose(&format!("{} editors each scored the draft out of 10. Three things make up the grade:",result.judges.len()),14.,22.4,p.ink_light));
                let average = if parts.judge_mean < parts.raw_mean - 0.05 {
                    "The editors' average, less a penalty for each score under 4"
                } else {
                    "The editors' average"
                };
                let style = if parts.effective_static < parts.static_total - 0.05 {
                    format!(
                        "Measured style (rhythm, words, paragraphs), held down from {:.1} because the draft is off brief",
                        parts.static_total
                    )
                } else {
                    "Measured style (rhythm, words, paragraphs)".into()
                };
                for (label, value, share) in [
                    (average, parts.judge_mean, 45),
                    ("The toughest editor's score", parts.min_judge, 35),
                    (&style, parts.effective_static, 20),
                ] {
                    body = body.child(
                        div()
                            .flex()
                            .items_start()
                            .py(px(3.2))
                            .border_b_1()
                            .border_color(rgb(p.rule))
                            .child(div().flex_1().min_w_0().child(prose(
                                label,
                                13.,
                                20.8,
                                p.ink_light,
                            )))
                            .child(div().pl(px(12.)).flex_shrink_0().child(type_text(
                                &format!("{value:.1} · {share}%"),
                                13.,
                                20.8,
                                p.ink,
                            ))),
                    );
                }
                body=body.child(prose("The total is then scaled so most drafts land between 40 and 65. A 90 is rare on purpose.",14.,22.4,p.ink_light));
            } else {
                body=body.child(prose("The saved grade combines the editors' readings and measured style. Its arithmetic is unavailable until the saved context is loaded.",14.,22.4,p.ink_light));
            }
        } else {
            body=body.child(prose(&format!("A quick model check scored each of the {} criteria out of 10, and the grade is their average. Treat it as an estimate: for written notes, ask the editors.",result.criteria.len()),14.,22.4,p.ink_light));
        }
        if let Some(score) = self
            .display
            .as_ref()
            .and_then(|d| d.writer_score(self.score_set))
        {
            body=body.child(prose(&format!("With your own weights, the same scores come to {}. Changing a weight recounts the scores; it doesn't reread the draft.",number(score)),14.,22.4,p.ink_light));
        }
        body.into_any_element()
    }
    fn history(&self, cx: &App) -> Option<AnyElement> {
        let display = self.display.as_ref()?;
        let entries = display.comparable_history();
        if entries.len() < 2 {
            return None;
        }
        let p = *theme::palette(cx);
        let delta = rubric::score_delta(&entries).unwrap_or(0.);
        let label = if delta == 0. {
            String::new()
        } else {
            format!(
                "{} {} since last",
                if delta > 0. { "▲" } else { "▼" },
                number(delta.abs())
            )
        };
        let line_points: Vec<_> = rubric::sparkline_points(&entries)
            .iter()
            .map(|point| (point.x as f32, 1. - point.y as f32))
            .collect();
        let last = line_points.last().copied().unwrap_or((0., 0.));
        Some(
            div()
                .id("rubric-history")
                .test_support()
                .px(px(16.))
                .py(px(8.))
                .border_b_1()
                .border_color(rgb(p.rule))
                .flex_shrink_0()
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .child(tracked("Your recent grades", 11., 2.42, p.ink_muted))
                        .child(type_text(
                            &label,
                            11.,
                            16.5,
                            if delta == 0. {
                                p.ink_muted
                            } else if delta > 0. {
                                p.success
                            } else {
                                p.danger
                            },
                        )),
                )
                .child(
                    canvas(
                        move |bounds, _, _| {
                            let mut path = PathBuilder::stroke(px(1.5));
                            for (index, (x, y)) in line_points.iter().enumerate() {
                                let pos = bounds.origin
                                    + point(bounds.size.width * *x, bounds.size.height * *y);
                                if index == 0 {
                                    path.move_to(pos)
                                } else {
                                    path.line_to(pos)
                                }
                            }
                            path.build().ok()
                        },
                        move |bounds, path, window, _| {
                            if let Some(path) = path {
                                window.paint_path(path, rgb(p.vermilion));
                            }
                            window.paint_quad(
                                fill(
                                    Bounds::new(
                                        bounds.origin
                                            + point(
                                                bounds.size.width * last.0 - px(2.),
                                                bounds.size.height * last.1 - px(2.),
                                            ),
                                        size(px(4.), px(4.)),
                                    ),
                                    rgb(p.vermilion),
                                )
                                .corner_radii(px(2.)),
                            );
                        },
                    )
                    .w_full()
                    .h(px(28.))
                    .mt(px(6.)),
                )
                .child(div().mt(px(2.)).child(type_text(
                    &format!(
                        "{} passes · {} → {}",
                        entries.len(),
                        number(entries[0].overall),
                        number(entries.last().unwrap().overall)
                    ),
                    10.,
                    15.,
                    p.ink_muted,
                )))
                .into_any_element(),
        )
    }
    fn section_tabs(&self, result: &RubricResult, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        div()
            .flex()
            .flex_shrink_0()
            .border_b_1()
            .border_color(rgb(p.rule))
            .bg(rgb(p.paper_soft))
            .children(
                [
                    (
                        RubricSection::Criteria,
                        "rubric-tab-criteria",
                        "Criteria",
                        Some(result.criteria.len()),
                        TwyneIcon::Checklist,
                    ),
                    (
                        RubricSection::Editors,
                        "rubric-tab-editors",
                        "Editors",
                        Some(result.judges.len()),
                        TwyneIcon::CommentAdd,
                    ),
                    (
                        RubricSection::Passages,
                        "rubric-tab-passages",
                        "Passages",
                        None,
                        TwyneIcon::Search,
                    ),
                ]
                .into_iter()
                .map(|(section, id, label, count, icon)| {
                    let active = self.section == section;
                    let text = if let Some(n) = count {
                        format!("{label} {n}")
                    } else {
                        label.into()
                    };
                    gpui_kit::base::Button::new(id)
                        .accessibility_label(label)
                        .flex_1()
                        .min_w_0()
                        .px(px(8.))
                        .py(px(8.))
                        .border_b_2()
                        .border_color(if active {
                            rgb(p.vermilion_deep)
                        } else {
                            rgb(0).opacity(0.)
                        })
                        .bg(if active {
                            rgb(p.paper)
                        } else {
                            rgb(0).opacity(0.)
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_center()
                                .gap(px(6.))
                                .text_color(rgb(if active { p.ink } else { p.ink_muted }))
                                .child(assets::icon(icon))
                                .child(tracked(
                                    &text,
                                    11.,
                                    1.32,
                                    if active { p.ink } else { p.ink_muted },
                                )),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| this.set_section(section, cx)))
                }),
            )
            .into_any_element()
    }
    fn result_footer(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        div()
            .flex()
            .items_center()
            .gap(px(12.))
            .px(px(16.))
            .py(px(10.))
            .border_t_1()
            .border_color(rgb(p.rule))
            .bg(rgb(p.paper_soft))
            .flex_shrink_0()
            .child(
                paper_button_frame("rubric-grade-again", "Grade again", cx)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap(px(8.))
                            .child(assets::icon(TwyneIcon::Redo).with_size(px(16.)))
                            .child(
                                div()
                                    .font_family(BUTTON_FONT)
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_size(px(12.))
                                    .line_height(relative(4. / 3.))
                                    .child("Grade again"),
                            ),
                    )
                    .flex_1()
                    .disabled(!self.capabilities.grade || !self.provider_ready())
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.capabilities.grade
                            && this.provider_ready()
                            && let Some(folio_id) = this.active_folio_id.clone()
                        {
                            cx.emit(RubricEvent::GradeRequested { folio_id });
                        }
                    })),
            )
            .child(
                text_button("rubric-full-report", "Full report ↗", cx).on_click(cx.listener(
                    |_, _, _, cx| cx.emit(RubricEvent::SurfaceRequested(RubricSurface::Galley)),
                )),
            )
            .into_any_element()
    }
    fn criteria(
        &self,
        result: &RubricResult,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *theme::palette(cx);
        let mut list = div().px(px(16.)).py(px(12.));
        for (index, criterion) in result.criteria.iter().enumerate() {
            let open = self.open_criteria.contains(&criterion.id);
            let id = criterion.id.clone();
            let color = score_color(criterion.score, criterion.max_score, cx);
            let mut row = div().when(index + 1 < result.criteria.len(), |row| {
                row.border_b_1().border_color(rgb(p.rule))
            });
            row = row.child(
                gpui_kit::base::Button::new(SharedString::from(format!(
                    "rubric-criterion-{}",
                    criterion.id
                )))
                .accessibility_label(format!("{} reasoning", criterion.label))
                .w_full()
                .py(px(8.))
                .child(
                    div()
                        .w_full()
                        .child(
                            div()
                                .flex()
                                .items_baseline()
                                .gap(px(10.))
                                .child(div().w(px(12.)).flex_shrink_0().child(type_text(
                                    if open { "▾" } else { "▸" },
                                    11.2,
                                    16.8,
                                    p.ink_muted,
                                )))
                                .child(div().flex_1().min_w_0().truncate().child(display_text(
                                    &criterion.label,
                                    15.,
                                    22.5,
                                    p.ink,
                                )))
                                .child(div().flex_shrink_0().child(type_text(
                                    &format!(
                                        "{}  {}/{}",
                                        rubric::score_word(criterion.score, criterion.max_score),
                                        number(criterion.score),
                                        number(criterion.max_score)
                                    ),
                                    13.,
                                    19.5,
                                    color,
                                ))),
                        )
                        .child(
                            div()
                                .ml(px(22.))
                                .mt(px(6.))
                                .child(score_bar(criterion, 3., cx)),
                        ),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    toggle(&mut this.open_criteria, &id);
                    cx.notify();
                })),
            );
            if open {
                let mut reasoning = div().ml(px(22.)).pb(px(12.)).flex().flex_col().gap(px(8.));
                if !criterion.description.is_empty() {
                    reasoning =
                        reasoning.child(type_text(&criterion.description, 11., 16.5, p.ink_muted));
                }
                reasoning = reasoning.child(prose(&criterion.feedback, 14., 22.4, p.ink));
                if ((criterion.score / criterion.max_score) * 100.).round() < 60. {
                    reasoning = reasoning.child(
                        div()
                            .border_l_2()
                            .border_color(rgb(p.vermilion))
                            .pl(px(10.))
                            .child(tracked("Try this", 11., 1.32, p.vermilion))
                            .child(prose(
                                rubric::next_move_for(&criterion.id),
                                14.,
                                22.4,
                                p.ink,
                            )),
                    );
                }
                row = row.child(reasoning);
            }
            list = list.child(row);
        }
        list = list.child(
            div()
                .mt(px(16.))
                .pt(px(12.))
                .border_t_1()
                .border_color(rgb(p.ink_muted))
                .child(
                    text_button(
                        "rubric-change-graded",
                        if self.criteria_open {
                            "▾ Change what's graded"
                        } else {
                            "▸ Change what's graded"
                        },
                        cx,
                    )
                    .w_full()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.criteria_open = !this.criteria_open;
                        cx.notify();
                    })),
                )
                .when(self.criteria_open, |section| {
                    section.child(div().mt(px(8.)).child(self.criteria_editor(cx)))
                }),
        );
        if let Some(issues) = self.issues(cx) {
            list = list.child(issues);
        }
        list.into_any_element()
    }
    fn criteria_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let Some(display) = &self.display else {
            return div().into_any_element();
        };
        let mut editor = div()
            .id("rubric-criteria-editor")
            .test_support()
            .rounded(px(2.))
            .border_1()
            .border_color(rgb(p.rule))
            .bg(rgb(p.paper))
            .p(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(div().text_right().mr(px(28.8)).mb(px(-3.2)).child(tracked(
                "How much each counts",
                9.6,
                0.768,
                p.ink_muted,
            )));
        let spine = display
            .criteria
            .iter()
            .filter(|s| s.source == CriterionSource::Spine);
        editor = editor.child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .children(spine.map(|s| self.config_row(s, cx))),
        );
        let custom: Vec<_> = display
            .criteria
            .iter()
            .filter(|s| s.source == CriterionSource::Custom)
            .collect();
        if !custom.is_empty() {
            editor = editor.child(
                div()
                    .border_t_1()
                    .border_color(rgb(p.rule))
                    .pt(px(8.))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(tracked("Your criteria", 11., 2.42, p.ink_muted))
                    .children(custom.into_iter().map(|s| self.config_row(s, cx))),
            );
        }
        let Some(form) = self.forms.get(&display.folio_id) else {
            return editor.into_any_element();
        };
        let can_add = self.writable()
            && !form
                .label
                .read(cx)
                .text()
                .to_string()
                .trim_matches(is_js_whitespace)
                .is_empty();
        let new = div()
            .border_t_1()
            .border_color(rgb(p.rule))
            .pt(px(8.))
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
                Input::new(&form.label)
                    .id("rubric-custom-name")
                    .accessibility_id("rubric-custom-name")
                    .aria_label("New criterion name")
                    .font_family(SERIF_FONT)
                    .text_size(px(12.))
                    .line_height(relative(4. / 3.))
                    .h(px(26.))
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(px(2.))
                    .bg(rgb(p.paper_soft))
                    .disabled(!self.writable()),
            )
            .child(
                Input::new(&form.description)
                    .id("rubric-custom-description")
                    .accessibility_id("rubric-custom-description")
                    .aria_label("What a strong version looks like")
                    .font_family(SERIF_FONT)
                    .text_size(px(12.))
                    .line_height(relative(4. / 3.))
                    .h(px(26.))
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(px(2.))
                    .bg(rgb(p.paper_soft))
                    .disabled(!self.writable()),
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        paper_button("rubric-custom-add", "+ Add", cx)
                            .flex_1()
                            .disabled(!can_add)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.add_custom(window, cx)),
                            ),
                    )
                    .child(
                        paper_button("rubric-custom-suggest", "✦ Suggest", cx)
                            .flex_1()
                            .disabled(!self.capabilities.suggest_criteria || !self.writable())
                            .on_click(cx.listener(|this, _, _, cx| {
                                if this.capabilities.suggest_criteria
                                    && this.writable()
                                    && let Some(folio_id) = this.active_folio_id.clone()
                                {
                                    cx.emit(RubricEvent::SuggestCriteriaRequested { folio_id });
                                }
                            })),
                    ),
            );
        editor.child(new).into_any_element()
    }
    fn config_row(&self, spec: &RubricCriterionSpec, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let scope = self.active_folio_id.clone().unwrap_or_default();
        let id = spec.id.clone();
        let toggle_scope = scope.clone();
        let toggle_id = id.clone();
        let mut row = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                Checkbox::new(SharedString::from(format!("rubric-enable-{id}")))
                    .accessibility_label(format!("Grade {}", spec.label))
                    .checked(spec.enabled)
                    .disabled(!self.writable())
                    .on_change(cx.listener(move |this, _: &bool, window, cx| {
                        let result = this.request_edit(
                            RubricEdit::ToggleCriterion {
                                folio_id: toggle_scope.clone(),
                                id: toggle_id.clone(),
                            },
                            window,
                            cx,
                        );
                        this.local_result(result, cx);
                    })),
            )
            .child(div().flex_1().min_w_0().truncate().child(prose(
                &spec.label,
                13.,
                19.5,
                if spec.enabled { p.ink } else { p.ink_muted },
            )));
        let disabled = !self.writable() || !spec.enabled;
        let weight = self.weights.get(&(scope.clone(), id.clone()));
        let mut control = div()
            .flex()
            .items_center()
            .h(px(26.))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .flex_shrink_0();
        for direction in [-1, 1] {
            let step_scope = scope.clone();
            let step_id = id.clone();
            let button = gpui_kit::base::Button::new(SharedString::from(format!(
                "rubric-weight-{}-{id}",
                if direction < 0 { "less" } else { "more" }
            )))
            .accessibility_label(format!(
                "{} weight for {}",
                if direction < 0 {
                    "Decrease"
                } else {
                    "Increase"
                },
                spec.label
            ))
            .w(px(24.))
            .h_full()
            .items_center()
            .justify_center()
            .bg(rgb(p.paper_soft))
            .disabled(
                disabled
                    || if direction < 0 {
                        spec.weight <= rubric::MIN_WEIGHT
                    } else {
                        spec.weight >= rubric::MAX_WEIGHT
                    },
            )
            .child(prose(
                if direction < 0 { "−" } else { "+" },
                13.,
                19.5,
                p.ink,
            ))
            .on_click(cx.listener(move |this, _, window, cx| {
                let accepted = this
                    .display
                    .as_ref()
                    .and_then(|d| d.criteria.iter().find(|s| s.id == step_id))
                    .map(|s| s.weight)
                    .unwrap_or(1.);
                let current = this
                    .weights
                    .get(&(step_scope.clone(), step_id.clone()))
                    .and_then(|field| {
                        field
                            .input
                            .read(cx)
                            .text()
                            .to_string()
                            .trim_matches(is_js_whitespace)
                            .parse::<f64>()
                            .ok()
                    })
                    .filter(|value| value.is_finite())
                    .map(rubric::clamp_weight)
                    .unwrap_or(accepted);
                let result = this.request_edit(
                    RubricEdit::SetWeight {
                        folio_id: step_scope.clone(),
                        id: step_id.clone(),
                        weight: rubric::step_weight(current, direction),
                    },
                    window,
                    cx,
                );
                this.local_result(result, cx);
            }));
            if direction < 0 {
                control = control.child(button);
                if let Some(weight) = weight {
                    let control_id = SharedString::from(format!("rubric-weight-{id}"));
                    control = control
                        .child(
                            Input::new(&weight.input)
                                .id(control_id.clone())
                                .accessibility_id(control_id)
                                .aria_label(format!("weight for {}", spec.label))
                                .font_family(MONO_FONT)
                                .text_size(px(11.))
                                .line_height(relative(1.5))
                                .w(px(40.))
                                .h_full()
                                .p_0()
                                .border_0()
                                .rounded_none()
                                .disabled(disabled),
                        )
                        .child(type_text("×", 11., 16.5, p.ink_muted));
                }
            } else {
                control = control.child(button);
            }
        }
        row = row.child(control);
        if spec.source == CriterionSource::Custom {
            row = row.child(
                text_button(SharedString::from(format!("rubric-remove-{id}")), "✕", cx)
                    .accessibility_label(format!("Remove {}", spec.label))
                    .disabled(!self.writable())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let result = this.request_edit(
                            RubricEdit::RemoveCustom {
                                folio_id: scope.clone(),
                                id: id.clone(),
                            },
                            window,
                            cx,
                        );
                        this.local_result(result, cx);
                    })),
            );
        }
        row.into_any_element()
    }
    fn editors(&self, result: &RubricResult, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let residents = cast::resident_personas();
        let mut content = div().px(px(16.)).py(px(12.)).flex().flex_col().gap(px(12.));
        if result.judges.is_empty() {
            content=content.child(div().py(px(16.)).text_center()
                .child(prose("These scores came from a quick model check. Ask the editors for their own reading, with written notes.",14.,20.,p.ink_light))
                .child(paper_button("rubric-ask-editors","Ask the editors",cx).mt(px(12.)).disabled(!self.capabilities.ask_editors||!self.provider_ready())
                    .on_click(cx.listener(|this,_,_,cx|if this.capabilities.ask_editors&&this.provider_ready()&&let Some(folio_id)=this.active_folio_id.clone(){cx.emit(RubricEvent::AskEditorsRequested{folio_id});}))));
        }
        for (index, judge) in result.judges.iter().enumerate() {
            let persona = residents.iter().find(|p| p.id == judge.persona_id);
            let color = persona
                .map(|persona| persona_color(&persona.id, cx))
                .unwrap_or(p.ink);
            let mut head = div().flex().flex_wrap().items_baseline().gap(px(8.));
            if let Some(persona) = persona {
                head = head.child(
                    div()
                        .size(px(21.6))
                        .rounded_full()
                        .border_1()
                        .border_color(rgb(color))
                        .bg(rgb(p.paper_soft))
                        .flex()
                        .items_center()
                        .justify_center()
                        .font(theme::cast_badge_font())
                        .text_size(px(11.2))
                        .line_height(relative(1.5))
                        .text_color(rgb(color))
                        .child(persona.icon.clone()),
                );
            }
            head = head
                .child(div().flex_1().min_w_0().child(display_text(
                    persona.map_or(judge.persona_id.as_str(), |p| p.name.as_str()),
                    15.,
                    22.5,
                    p.ink,
                )))
                .child(type_text(
                    &format!("{}/10", number(judge.score)),
                    13.,
                    19.5,
                    if judge.score >= 7. {
                        p.success
                    } else if judge.score >= 4. {
                        p.warning
                    } else {
                        p.danger
                    },
                ));
            let mut card = div()
                .border_1()
                .border_l_2()
                .border_color(rgb(color))
                .bg(rgb(p.paper))
                .rounded(px(2.))
                .child(
                    div()
                        .px(px(12.))
                        .pt(px(9.))
                        .pb(px(8.))
                        .child(head)
                        .when(persona.is_some(), |head| {
                            head.child(type_text(&persona.unwrap().role, 11., 16.5, color))
                        }),
                );
            card = card.child(
                div()
                    .border_t_1()
                    .border_color(rgb(p.rule))
                    .px(px(12.))
                    .py(px(12.))
                    .child(markdown(
                        SharedString::from(format!("rubric-judge-body-{index}")),
                        &judge.rationale,
                        14.,
                        22.4,
                        cx,
                    )),
            );
            content = content.child(card);
        }
        content.into_any_element()
    }
    fn passages(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let mut panel = div().px(px(16.)).py(px(16.)).min_w_0().child(type_text(
            self.context
                .live_review_status
                .as_deref()
                .unwrap_or("Your draft is saved as usual."),
            11.,
            17.6,
            p.ink_muted,
        ));
        let Some(review) = self
            .display
            .as_ref()
            .and_then(|d| d.live_review.value.as_ref())
        else {
            return panel.into_any_element();
        };
        // The enclosing scope is authority. A foreign row is retained but never
        // promoted to an active live-review snapshot, even if its quote matches.
        if Some(review.folio_id.as_str()) != self.active_folio_id() {
            return panel
                .child(div().mt(px(8.)).child(prose(
                    "The retained reading names another folio. Its metadata was kept.",
                    12.,
                    16.,
                    p.ink_muted,
                )))
                .into_any_element();
        }
        panel = panel.child(type_text(
            "Previous reading. These findings may no longer match your draft.",
            11.,
            17.6,
            p.ink_muted,
        ));
        let weakest = review
            .brief
            .as_ref()
            .and_then(|brief| brief.get("weakest"))
            .and_then(|v| v.as_array());
        if let Some(weakest) = weakest.filter(|items| !items.is_empty()) {
            let mut section = div()
                .py(px(16.))
                .border_b_1()
                .border_color(rgb(p.rule))
                .child(tracked("Sharpen the dossier", 11., 2.42, p.ink_muted));
            for field in weakest.iter().take(3) {
                if let (Some(name), Some(diagnosis)) = (
                    field.get("field").and_then(|v| v.as_str()),
                    field.get("diagnosis").and_then(|v| v.as_str()),
                ) {
                    section = section.child(prose(
                        &format!(
                            "{}: {diagnosis}",
                            if name == "successSignal" {
                                "Success signal"
                            } else {
                                name
                            }
                        ),
                        14.,
                        22.4,
                        p.ink,
                    ));
                }
            }
            section = section.child(
                text_button("rubric-refine-dossier", "Refine the dossier ↗", cx)
                    .disabled(!self.capabilities.refine_dossier)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.capabilities.refine_dossier
                            && let Some(folio_id) = this.active_folio_id.clone()
                        {
                            cx.emit(RubricEvent::RefineDossierRequested { folio_id });
                        }
                    })),
            );
            panel = panel.child(section);
        }
        let mut section = div()
            .py(px(16.))
            .border_b_1()
            .border_color(rgb(p.rule))
            .child(tracked("Passages to consider", 11., 2.42, p.ink_muted))
            .child(type_text(&review.coverage, 11., 17.6, p.ink_muted));
        for item in review
            .passages
            .iter()
            .filter(|item| item.kind != PassageKind::Nothing)
            .take(4)
        {
            let id = item.passage.id.clone();
            let open = self.open_passages.contains(&id);
            let kind = match item.kind {
                PassageKind::Advice => "Consider a revision",
                PassageKind::Question => "Clarify for the reader",
                PassageKind::Evidence => "Check supporting evidence",
                PassageKind::Cut => "Check what this adds",
                _ => "Retained finding",
            };
            let label = format!(
                "{} {kind}{}",
                if open { "▾" } else { "▸" },
                if item.confidence.as_ref().copied().unwrap_or(0.) < 0.5 {
                    " · tentative"
                } else {
                    ""
                }
            );
            let mut passage = div().py(px(8.)).child(
                gpui_kit::base::Button::new(SharedString::from(format!("rubric-passage-{id}")))
                    .accessibility_label(kind)
                    .w_full()
                    .min_h(px(32.))
                    .child(div().w_full().child(prose(&label, 14., 22.4, p.ink)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        toggle(&mut this.open_passages, &id);
                        cx.notify();
                    })),
            );
            if open {
                passage = passage.child(
                    div()
                        .my(px(8.))
                        .border_l_2()
                        .border_color(rgb(p.cobalt))
                        .pl(px(12.))
                        .child(prose(&item.passage.text, 14., 22.4, p.ink)),
                );
            }
            section = section.child(passage);
        }
        if review
            .passages
            .iter()
            .all(|item| item.kind == PassageKind::Nothing)
        {
            section = section.child(prose(
                "No clear issue in the passages checked.",
                14.,
                22.4,
                p.ink,
            ));
        }
        panel = panel.child(section);
        if let Some(notes) = review.notes.as_ref() {
            let failures: Vec<_> = notes
                .iter()
                .filter(|note| {
                    note.get("verdict")
                        .and_then(|v| v.get("pass"))
                        .and_then(|v| v.as_bool())
                        == Some(false)
                })
                .collect();
            if !failures.is_empty() {
                let mut section = div()
                    .py(px(16.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .child(tracked("Check the advice, too", 11., 2.42, p.ink_muted));
                for note in failures {
                    if let (Some(author), Some(reasons)) = (
                        note.get("author").and_then(|v| v.as_str()),
                        note.get("verdict")
                            .and_then(|v| v.get("reasons"))
                            .and_then(|v| v.as_array()),
                    ) {
                        let reasons = reasons
                            .iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join(" ");
                        section =
                            section.child(prose(&format!("{author}: {reasons}"), 14., 22.4, p.ink));
                    }
                }
                panel=panel.child(section.child(type_text("Tentative checks against your dossier and feedback preferences. The original notes remain available in Cast.",11.,17.6,p.ink_muted)));
            }
        }
        panel.into_any_element()
    }
    fn galley(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let mut page = div()
            .max_w(px(1024.))
            .w_full()
            .mx_auto()
            .px(px(24.))
            .py(px(32.));
        page=page.child(div().flex().items_center().justify_between().mb(px(24.))
            .child(div().flex_1().min_w_0().child(tracked("Twyne",10.,3.2,p.ink_muted))
                .child(div().mt(px(4.)).font_family(DISPLAY_FONT).font_weight(FontWeight::BOLD).text_size(px(28.)).line_height(relative(1.5)).child("The Galley Proof"))
                .child(div().mt(px(4.)).child(prose("Your saved marks, the reading behind them, and possibilities for the next revision.",14.,20.,p.ink_light))))
            .child(paper_button("rubric-galley-back","← Back to desk",cx).flex_shrink_1()
                .on_click(cx.listener(|_,_,_,cx|cx.emit(RubricEvent::BackToDesk)))));
        if let Some(status) = self.status(cx) {
            page = page.child(status);
        }
        if let Some(issues) = self.issues(cx) {
            page = page.child(issues);
        }
        if let Some(result) = self.display.as_ref().and_then(|d| d.result.value.as_ref()) {
            let mut sections = div().flex().flex_col().gap(px(24.));
            if self.context.freshness == RubricFreshness::Stale {
                sections=sections.child(prose(if self.capabilities.grade {
                    "These saved marks may describe an earlier draft. Run the rubric at the desk for a current reading."
                }else{"These saved marks may describe an earlier draft. A current reading needs an available AI provider."},14.,20.,p.ink_light));
            }
            let mut overall = div()
                .flex()
                .items_stretch()
                .gap(px(24.))
                .child(grade_stamp(result, 144., cx));
            let mut text = div()
                .flex_1()
                .min_w_0()
                .child(tracked(
                    if result.scoring_method.as_ref() == Some(&ScoringMethod::Judgement) {
                        "Judgement marks"
                    } else {
                        "Editor's Mark"
                    },
                    10.,
                    3.2,
                    p.ink_muted,
                ))
                .child(
                    div()
                        .mt(px(2.))
                        .flex()
                        .items_baseline()
                        .gap(px(6.))
                        .child(display_text(&number(result.overall_score), 24., 32., p.ink))
                        .child(prose("/ 100", 14., 20., p.ink_muted)),
                );
            if let Some(score) = self
                .display
                .as_ref()
                .and_then(|d| d.writer_score(CachedScoreSet::VisibleCriteria))
            {
                text = text.child(prose(
                    &format!("{}/100 by your current weights", number(score)),
                    14.,
                    20.,
                    p.ink_muted,
                ));
            }
            text = text.child(div().mt(px(8.)).child(prose(
                &result.summary,
                14.,
                24.,
                p.ink_light,
            )));
            if let Some(label) = &self.context.result_filed_label {
                text = text.child(
                    div()
                        .mt(px(12.))
                        .child(tracked(label, 10.4, 1.04, p.ink_muted)),
                );
            }
            overall = overall.child(text);
            sections = sections.child(report_card(overall.into_any_element(), cx));
            sections = sections.child(self.report_explainer(result, cx));
            if let Some(review) = result.review.as_ref().filter(|text| !text.is_empty()) {
                sections = sections.child(report_card(
                    div()
                        .child(tracked("The Critic's Full Review", 10., 3.2, p.ink_muted))
                        .child(div().mt(px(12.)).child(markdown(
                            "rubric-full-review",
                            review,
                            15.,
                            28.,
                            cx,
                        )))
                        .into_any_element(),
                    cx,
                ));
            }
            if !result.judges.is_empty() {
                let judges = div()
                    .child(tracked("The Judges' Verdict", 10., 3.2, p.ink_muted))
                    .child(div().mt(px(2.)).child(display_text(
                        "Persona-by-persona",
                        18.,
                        28.,
                        p.ink,
                    )));
                let mut list = div().mt(px(12.)).flex().flex_col().gap(px(10.));
                for (index, judge) in result.judges.iter().enumerate() {
                    list = list.child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(12.))
                            .when(index + 1 < result.judges.len(), |row| {
                                row.pb(px(10.)).border_b_1().border_color(rgb(p.rule))
                            })
                            .child(
                                div()
                                    .w(px(32.))
                                    .flex_shrink_0()
                                    .text_right()
                                    .font_family(MONO_FONT)
                                    .font_weight(FontWeight::BOLD)
                                    .text_size(px(16.))
                                    .line_height(relative(1.5))
                                    .text_color(rgb(score_color(judge.score, 10., cx)))
                                    .child(number(judge.score)),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .child(display_text(&judge.persona_id, 14., 20., p.ink))
                                    .child(div().mt(px(2.)).child(prose(
                                        &judge.rationale,
                                        12.,
                                        16.,
                                        p.ink_light,
                                    )))
                                    .child(div().mt(px(2.)).child(tracked(
                                        &format!("provider: {}", judge.provider),
                                        9.6,
                                        0.96,
                                        p.ink_muted,
                                    ))),
                            ),
                    );
                }
                sections = sections.child(report_card(judges.child(list).into_any_element(), cx));
            }
            sections = sections.child(self.report_criteria(result, cx));
            sections = sections.child(self.report_static(result, window, cx));
            page = page.child(sections);
        } else {
            page=page.child(report_card(div().p(px(8.)).text_center()
                .child(display_text("❧",36.,40.,p.cobalt)).child(div().mt(px(12.)).max_w(px(448.)).mx_auto().child(prose(
                    if self.capabilities.grade{"No galley on file yet. Open the proof desk in the right panel and choose Run rubric to start."}
                    else{"No galley on file yet. Saved marks will appear here when a reading is imported or filed."},14.,20.,p.ink_light)))
                .child(press_button("rubric-empty-back","← Back to desk",cx).mt(px(16.)).on_click(cx.listener(|_,_,_,cx|cx.emit(RubricEvent::BackToDesk))))
                .into_any_element(),cx));
        }
        self.scroll(page.into_any_element())
    }
    fn report_explainer(&self, result: &RubricResult, cx: &App) -> AnyElement {
        let p = *theme::palette(cx);
        if result.scoring_method.as_ref() == Some(&ScoringMethod::Judgement) {
            return report_card(div().child(tracked("How these marks work",10.,3.2,p.ink_muted))
                .child(div().mt(px(8.)).child(prose("The grade averages the enabled criteria equally. Your weighted score applies the weights you choose at the desk. These model judgements are starting points for revision; they do not establish publication readiness.",14.,24.,p.ink_light)))
                .child(div().mt(px(8.)).child(prose(&format!("Reading by {}. No persona opinions are included in this grade. Ask the room at the desk for a separate reading.",result.judgement_grade.as_ref().map_or("Jev",|grade|grade.model.as_str())),12.,16.,p.ink_muted)))
                .into_any_element(),cx);
        }
        let mut body=div().child(tracked("The Brutal Curve",10.,3.2,p.ink_muted))
            .child(div().mt(px(2.)).child(display_text("Why a \"good\" draft is still a C",18.,28.,p.ink)))
            .child(div().mt(px(8.)).child(prose("The raw score is a blend, not a plain average: the judges' mean opinion counts for 45%, but the single harshest judge's score also counts on its own for 35% — so one editor who really isn't convinced can drag the grade down even if the rest of the room liked it. Mechanical polish (structure, pacing, citations) is the remaining 20%, deliberately a minor share, since clean prose around a hollow argument shouldn't read as a good draft. That raw blend is then curved: Twyne compresses the middle of the scale and stretches the top, so a 90+ is reserved for genuinely excellent work.",12.,20.,p.ink_light)));
        let mut anchors = div().mt(px(16.));
        for (index, (raw, final_score, note)) in CURVE_ANCHORS.iter().enumerate() {
            anchors = anchors.child(
                div()
                    .flex()
                    .gap(px(16.))
                    .px(px(13.6))
                    .py(px(10.4))
                    .when(index + 1 < CURVE_ANCHORS.len(), |row| {
                        row.border_b_1().border_color(rgb(p.rule))
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_wrap()
                            .items_baseline()
                            .gap(px(8.))
                            .child(mono(&format!("raw {raw}"), 14., 20., p.ink_muted))
                            .child(tracked(
                                &format!("→ final {final_score}"),
                                11.2,
                                1.12,
                                p.ink_muted,
                            )),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(prose(note, 12., 16., p.ink_light)),
                    ),
            );
        }
        body = body.child(anchors);
        report_card(body.into_any_element(), cx)
    }
    fn report_criteria(&self, result: &RubricResult, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let mut body = div()
            .child(tracked("The Criteria", 10., 3.2, p.ink_muted))
            .child(
                div()
                    .mt(px(2.))
                    .child(display_text("What the rubric counts", 18., 28., p.ink)),
            );
        let mut list = div().mt(px(16.)).flex().flex_col().gap(px(16.));
        for (index, criterion) in result.criteria.iter().enumerate() {
            let color = score_color(criterion.score, criterion.max_score, cx);
            let percent = ((criterion.score / criterion.max_score) * 100.).round();
            let mut row = div()
                .when(index + 1 < result.criteria.len(), |row| {
                    row.pb(px(16.)).border_b_1().border_color(rgb(p.rule))
                })
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .gap(px(12.))
                        .mb(px(6.))
                        .child(
                            div()
                                .min_w_0()
                                .flex()
                                .items_baseline()
                                .gap(px(8.))
                                .child(tracked(&format!("§{}", index + 1), 11.2, 1.68, p.ink_muted))
                                .child(display_text(&criterion.label, 14., 20., p.ink)),
                        )
                        .child(div().flex_shrink_0().child(mono(
                            &format!(
                                "{}/{} · {}%",
                                number(criterion.score),
                                number(criterion.max_score),
                                number(percent)
                            ),
                            12.,
                            16.,
                            color,
                        ))),
                )
                .child(div().mb(px(8.)).child(score_bar(criterion, 4., cx)))
                .child(prose(&criterion.feedback, 12., 20., p.ink_light));
            if let Some(grade) = result
                .judgement_grade
                .as_ref()
                .and_then(|grade| grade.criteria.get(&criterion.id))
            {
                let id = criterion.id.clone();
                let open = self.open_probabilities.contains(&id);
                let mut probabilities = div().mt(px(8.)).child(
                    gpui_kit::base::Button::new(SharedString::from(format!("rubric-ratings-{id}")))
                        .accessibility_label(format!("Possible ratings for {}", criterion.label))
                        .child(prose(
                            if open {
                                "▾ Possible ratings"
                            } else {
                                "▸ Possible ratings"
                            },
                            12.,
                            16.,
                            p.ink_muted,
                        ))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            toggle(&mut this.open_probabilities, &id);
                            cx.notify();
                        })),
                );
                if open {
                    probabilities=probabilities.child(div().mt(px(8.)).child(prose("The spread shows which ratings the model considered plausible. Concentration is not a probability that the assessment is correct.",12.,16.,p.ink_muted)))
                        .child(div().mt(px(8.)).flex().flex_col().gap(px(4.)).children(grade.probabilities.iter().map(|(level,probability)|prose(
                            &format!("{}: {}%",grade.legend.get(level).unwrap_or(level),number((probability*100.).round())),12.,16.,p.ink_muted))));
                }
                row = row.child(probabilities);
            }
            if criterion.score / criterion.max_score < 0.6 {
                row = row.child(div().mt(px(6.)).child(type_text(
                    &format!("Try this → {}", rubric::next_move_for(&criterion.id)),
                    11.,
                    20.,
                    p.vermilion,
                )));
            }
            list = list.child(row);
        }
        body = body.child(list);
        report_card(body.into_any_element(), cx)
    }
    fn report_static(&self, result: &RubricResult, window: &Window, cx: &App) -> AnyElement {
        let p = *theme::palette(cx);
        let features = &result.static_score.features;
        let scores = &result.static_score.per_feature;
        let mut body = div()
            .child(tracked("Static Features", 10., 3.2, p.ink_muted))
            .child(div().mt(px(2.)).child(display_text(
                "What the rubric counted",
                18.,
                28.,
                p.ink,
            )));
        if result.scoring_method.as_ref() == Some(&ScoringMethod::Judgement) {
            body=body.child(div().mt(px(8.)).child(prose("These local measurements provide context and do not contribute to the judgement grade.",12.,16.,p.ink_muted)));
        }
        let columns = if f32::from(window.viewport_size().width) >= 768. {
            3.
        } else {
            2.
        };
        let width =
            (f32::from(window.viewport_size().width).min(1024.) - 48. - 50. - 12. * (columns - 1.))
                / columns;
        body = body.child(
            div().flex().flex_wrap().gap(px(12.)).mt(px(16.)).children(
                [
                    ("Length", scores.length),
                    ("Structure", scores.structure),
                    ("Pacing", scores.pacing),
                    ("Evidence", scores.evidence),
                    ("Vocabulary", scores.vocabulary),
                    ("Paragraph shape", scores.paragraph_shape),
                ]
                .into_iter()
                .map(|(label, value)| {
                    div()
                        .w(px(width.max(0.)))
                        .border_1()
                        .border_color(rgb(p.rule))
                        .rounded(px(2.))
                        .p(px(12.))
                        .bg(rgb(p.sidebar))
                        .child(tracked(label, 9.6, 0.96, p.ink_muted))
                        .child(div().mt(px(4.)).child(mono(
                            &format!("{value:.1}/10"),
                            16.,
                            24.,
                            score_color(value, 10., cx),
                        )))
                }),
            ),
        );
        body = body.child(div().mt(px(12.)).child(tracked(
            &format!(
                "{} words · {} paragraphs · {} sentences · {} citations",
                locale_integer(features.word_count),
                number(features.paragraph_count),
                number(features.sentence_count),
                number(features.citation_count)
            ),
            12.,
            1.2,
            p.ink_light,
        )));
        if !result.static_score.feedback.is_empty() {
            body =
                body.child(
                    div()
                        .mt(px(12.))
                        .pl(px(20.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .children(result.static_score.feedback.iter().map(|feedback| {
                            prose(&format!("• {feedback}"), 12., 16., p.ink_light)
                        })),
                );
        }
        report_card(body.into_any_element(), cx)
    }
}

const CURVE_ANCHORS: [(u8, u8, &str); 7] = [
    (
        50,
        50,
        "A C-grade draft stays a C. It may have a promising idea, but it is not ready to carry the reader yet.",
    ),
    (
        60,
        58,
        "A coherent draft with a clear point, still needing substantial revision before publication.",
    ),
    (
        70,
        67,
        "A strong first pass: an engaging class essay, blog post, or early magazine draft with room to sharpen.",
    ),
    (
        80,
        76,
        "A polished, publishable-feeling essay or reported feature, with a few visible limits keeping it from the top tier.",
    ),
    (
        90,
        86,
        "A prize-caliber essay, reported feature, or literary piece may fit here, possibly Pulitzer-level if that is what the draft is aiming to be and the execution earns it.",
    ),
    (
        95,
        93,
        "Rare, field-leading work: the kind of piece an editor would build a cover, issue, or shortlist around.",
    ),
    (
        100,
        100,
        "A virtually unimprovable draft for its purpose, audience, and form.",
    ),
];
fn toggle(set: &mut BTreeSet<String>, id: &str) {
    if !set.remove(id) {
        set.insert(id.into());
    }
}
fn number(value: f64) -> String {
    if value.fract() == 0. {
        format!("{value:.0}")
    } else {
        format!("{value}")
    }
}
fn locale_integer(value: f64) -> String {
    // Deterministic English fallback until a host supplies locale presentation;
    // this never changes the raw retained measurement.
    let value = number(value);
    let (whole, fraction) = value
        .split_once('.')
        .map_or((value.as_str(), None), |(a, b)| (a, Some(b)));
    let mut out = String::new();
    for (index, ch) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if let Some(fraction) = fraction {
        out.push('.');
        out.push_str(fraction);
    }
    out
}
fn tool_for(id: &str) -> Option<&'static str> {
    Some(match id {
        "pacing" | "paragraph" | "paragraphShape" | "structure" | "length" => "rhythm-strip",
        "evidence" | "integrity" | "thesis" => "claim-check",
        "voice" | "vocabulary" => "sentence-lab",
        _ => "reader-questions",
    })
}
fn persona_color(id: &str, cx: &App) -> u32 {
    let p = theme::palette(cx);
    match id {
        "devil" => p.vermilion,
        "angel" => p.sage,
        "scholar" => p.periwinkle,
        "editor" => p.mustard,
        "reader" => p.cobalt,
        _ => p.ink,
    }
}
fn score_color(score: f64, max: f64, cx: &App) -> u32 {
    let p = theme::palette(cx);
    if score / max >= 0.8 {
        p.success
    } else if score / max >= 0.6 {
        p.warning
    } else {
        p.danger
    }
}
fn prose(text: &str, font_size: f32, line_height: f32, color: u32) -> AnyElement {
    div()
        .font_family(SERIF_FONT)
        .text_size(px(font_size))
        .line_height(relative(line_height / font_size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn display_text(text: &str, font_size: f32, line_height: f32, color: u32) -> AnyElement {
    div()
        .font_family(DISPLAY_FONT)
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(font_size))
        .line_height(relative(line_height / font_size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn type_text(text: &str, font_size: f32, line_height: f32, color: u32) -> AnyElement {
    div()
        .font_family(TYPEWRITER_FONT)
        .text_size(px(font_size))
        .line_height(relative(line_height / font_size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn mono(text: &str, font_size: f32, line_height: f32, color: u32) -> AnyElement {
    div()
        .font_family(MONO_FONT)
        .text_size(px(font_size))
        .line_height(relative(line_height / font_size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn tracked(text: &str, font_size: f32, spacing: f32, color: u32) -> AnyElement {
    crate::chrome::tracked_typewriter(&text.to_uppercase(), font_size, spacing, color)
        .into_any_element()
}
fn text_button(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    cx: &App,
) -> gpui_kit::base::Button {
    let p = theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.to_owned())
        .h_auto()
        .p_0()
        .child(div().w_full().child(tracked(label, 11., 1.32, p.ink_muted)))
}
fn paper_button(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    cx: &App,
) -> gpui_kit::base::Button {
    paper_button_frame(id, label, cx).child(
        div()
            .font_family(DISPLAY_FONT)
            .font_weight(FontWeight::SEMIBOLD)
            .text_size(px(12.))
            .line_height(relative(10. / 7.))
            .child(label.to_owned()),
    )
}
fn paper_button_frame(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    cx: &App,
) -> gpui_kit::base::Button {
    let p = *theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.to_owned())
        .h_auto()
        .px(px(14.4))
        .py(px(7.2))
        .border_1()
        .border_color(rgb(p.rule))
        .rounded(px(2.))
        .bg(rgb(p.paper_soft))
}
fn press_button(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    cx: &App,
) -> gpui_kit::base::Button {
    let p = *theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.to_owned())
        .h_auto()
        .px(px(16.))
        .py(px(8.8))
        .border_1()
        .border_color(rgb(p.ink))
        .rounded(px(2.))
        .bg(rgb(p.ink))
        .child(tracked(label, 11.2, 2.016, p.paper))
}
fn markdown(
    id: impl Into<gpui_kit::ElementId>,
    text: &str,
    font_size: f32,
    line_height: f32,
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
        .text_size(px(font_size))
        .line_height(relative(line_height / font_size))
        .into_any_element()
}
fn score_bar(criterion: &RubricCriterion, height: f32, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    let width = ((criterion.score / criterion.max_score) * 100.).round() as f32 / 100.;
    div()
        .h(px(height))
        .bg(rgb(p.sidebar))
        .overflow_hidden()
        .child(div().h_full().w(relative(width)).bg(rgb(score_color(
            criterion.score,
            criterion.max_score,
            cx,
        ))))
        .into_any_element()
}
fn report_card(content: AnyElement, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .relative()
        .overflow_hidden()
        .border_1()
        .border_color(rgb(p.rule))
        .rounded(px(4.))
        .bg(rgb(p.paper))
        .p(px(24.))
        .child(proof_fibers())
        .child(div().relative().child(content))
        .into_any_element()
}
fn proof_fibers() -> AnyElement {
    static FIBERS: OnceLock<Option<Arc<RenderImage>>> = OnceLock::new();
    let image = FIBERS
        .get_or_init(|| embedded_image("/assets/rubric-proof-fibers.png"))
        .clone();
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let Some(image) = &image else { return };
            for row in 0..(f32::from(bounds.size.height) / 384.).ceil() as u32 {
                for col in 0..(f32::from(bounds.size.width) / 384.).ceil() as u32 {
                    let target = Bounds::new(
                        bounds.origin + point(px(col as f32 * 384.), px(row as f32 * 384.)),
                        size(px(384.), px(384.)),
                    );
                    let _ = window.paint_image(
                        target.intersect(&bounds),
                        target,
                        Corners::default(),
                        image.clone(),
                        0,
                        false,
                    );
                }
            }
        },
    )
    .absolute()
    .inset_0()
    .size_full()
    .into_any_element()
}
fn embedded_image(path: &str) -> Option<Arc<RenderImage>> {
    let bytes = TwyneAssets.load(path).ok()??;
    let mut image = image::load_from_memory(&bytes).ok()?.into_rgba8();
    for pixel in image.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    Some(Arc::new(RenderImage::new([image::Frame::new(image)])))
}
fn grade_asset(grade: &str) -> (&'static str, f32) {
    let key = grade.trim_matches(is_js_whitespace).to_uppercase();
    let angle = match key.chars().next() {
        Some('A') => -5.,
        Some('B') => 3.,
        Some('C') => -2.,
        _ => 4.,
    };
    let path = match key.as_str() {
        "A+" => "sunburst-a-plus.png",
        "A" => "sunburst-a.png",
        "A-" => "sunburst-a-minus.png",
        "B+" => "sunburst-b-plus.png",
        "B" => "sunburst-b.png",
        "B-" => "sunburst-b-minus.png",
        "C+" => "sunburst-c-plus.png",
        "C" => "sunburst-c.png",
        "C-" => "sunburst-c-minus.png",
        "D+" => "sunburst-d-plus.png",
        "D" => "sunburst-d.png",
        "D-" => "sunburst-d-minus.png",
        "F" => "sunburst-f.png",
        _ => "f.svg",
    };
    (path, angle)
}
fn grade_color(grade: &str, cx: &App) -> u32 {
    let p = theme::palette(cx);
    match grade {
        "A+" | "A" | "A-" => p.success,
        "B+" | "B" | "B-" => p.blue,
        "C+" | "C" | "C-" => p.warning,
        "D+" | "D" | "D-" | "F" => p.vermilion,
        _ => p.ink,
    }
}
type StampImage = Option<(Arc<RenderImage>, f32)>;
type StampCache = Mutex<BTreeMap<(String, u32), StampImage>>;
fn stamped_image(asset: &str, angle: f32, color: u32) -> StampImage {
    static CACHE: OnceLock<StampCache> = OnceLock::new();
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .ok()?;
    let key = (asset.to_owned(), color);
    if let Some(image) = cache.get(&key) {
        return image.clone();
    }
    let result = (|| {
        let bytes = TwyneAssets
            .load(&format!("/assets/rubric-stamps/{asset}"))
            .ok()??;
        let source = image::load_from_memory(&bytes).ok()?.into_rgba8();
        let angle = angle.to_radians();
        let (sin, cos) = angle.sin_cos();
        let width = source.width();
        let height = source.height();
        let output_width = (width as f32 * cos.abs() + height as f32 * sin.abs()).ceil() as u32;
        let output_height = (height as f32 * cos.abs() + width as f32 * sin.abs()).ceil() as u32;
        let mut output = image::RgbaImage::new(output_width, output_height);
        for (x, y, pixel) in output.enumerate_pixels_mut() {
            let dx = x as f32 + 0.5 - output_width as f32 / 2.;
            let dy = y as f32 + 0.5 - output_height as f32 / 2.;
            let sx = cos * dx + sin * dy + width as f32 / 2. - 0.5;
            let sy = -sin * dx + cos * dy + height as f32 / 2. - 0.5;
            let ix = sx.floor() as i32;
            let iy = sy.floor() as i32;
            let fx = sx - ix as f32;
            let fy = sy - iy as f32;
            let mut alpha = 0.;
            for (ox, oy, weight) in [
                (0, 0, (1. - fx) * (1. - fy)),
                (1, 0, fx * (1. - fy)),
                (0, 1, (1. - fx) * fy),
                (1, 1, fx * fy),
            ] {
                let px = ix + ox;
                let py = iy + oy;
                if px >= 0 && py >= 0 && (px as u32) < width && (py as u32) < height {
                    alpha += source.get_pixel(px as u32, py as u32)[3] as f32 * weight;
                }
            }
            // StampPress's source imprint has 0.88 opacity. GPUI uses BGRA.
            *pixel = image::Rgba([
                (color & 255) as u8,
                ((color >> 8) & 255) as u8,
                ((color >> 16) & 255) as u8,
                (alpha * 0.88).round() as u8,
            ]);
        }
        Some((
            Arc::new(RenderImage::new([image::Frame::new(output)])),
            output_width as f32 / width as f32,
        ))
    })();
    if cache.len() >= 64 {
        cache.pop_first();
    }
    cache.insert(key, result.clone());
    result
}
fn grade_stamp(result: &RubricResult, extent: f32, cx: &App) -> AnyElement {
    let (asset, angle) = grade_asset(&result.overall_grade);
    let color = grade_color(&result.overall_grade, cx);
    let image = stamped_image(asset, angle, color);
    div()
        .id(SharedString::from(format!(
            "rubric-grade-stamp-{}",
            extent as u32
        )))
        .test_support()
        .relative()
        .flex_shrink_0()
        .size(px(extent))
        .child(if let Some((image, scale)) = image {
            let overflow = extent * (scale - 1.) / 2.;
            img(image)
                .absolute()
                .left(px(-overflow))
                .top(px(-overflow))
                .size(px(extent * scale))
                .into_any_element()
        } else {
            gpui_kit::component::Icon::default()
                .path("/assets/rubric-stamps/f.svg")
                .with_size(px(extent))
                .text_color(rgb(color))
                .transform(gpui_kit::Transformation::rotate(gpui_kit::radians(
                    angle.to_radians(),
                )))
                .into_any_element()
        })
        .into_any_element()
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::{
        exchange::OptionalField,
        rubric::{RubricStore, parse_rubric_json},
    };
    use gpui_kit::{
        AnyWindowHandle, Point, ScrollDelta, TestAppContext, WindowBounds, WindowOptions,
        test::TestWindowExt,
    };
    use serde_json::{Value, json};
    use tempfile::TempDir;

    const FOLIO: &str = "original/path/folio:café";
    struct Room {
        window: AnyWindowHandle,
        view: Entity<RubricView>,
        store: RubricStore,
        events: Arc<Mutex<Vec<RubricEvent>>>,
        _directory: TempDir,
    }
    fn fixture() -> RubricRecord {
        parse_rubric_json(include_bytes!("../fixtures/rubric/retained-native.json")).unwrap()
    }
    fn reference() -> Value {
        serde_json::from_str(include_str!(
            "../fixtures/rubric-view/source-presentation.json"
        ))
        .unwrap()
    }
    fn room(
        cx: &mut TestAppContext,
        record: RubricRecord,
        surface: RubricSurface,
        width: f32,
    ) -> Room {
        let directory = tempfile::tempdir().unwrap();
        let store = RubricStore::open(directory.path()).unwrap();
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
                        let mut view = RubricView::new(
                            Arc::new(record),
                            Some(FOLIO.into()),
                            RubricViewContext {
                                draft_word_count: Some(700),
                                ..Default::default()
                            },
                            RubricCapabilities::local(),
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
            cx.subscribe(&view, move |_, event: &RubricEvent, _| {
                receiver.lock().unwrap().push(event.clone())
            })
            .detach()
        });
        Room {
            window,
            view,
            store,
            events,
            _directory: directory,
        }
    }
    fn reveal(window: &mut Window, id: &str, cx: &mut App) {
        let id = SharedString::from(id.to_owned());
        for _ in 0..35 {
            window.render_frame(cx);
            let viewport = window.find("rubric-scroll").bounds();
            if window.try_find(id.clone()).is_some_and(|element| {
                element.visible()
                    && element.bounds().top() >= viewport.top()
                    && element.bounds().bottom() <= viewport.bottom()
            }) {
                return;
            }
            let delta = window.try_find(id.clone()).map_or(-200., |element| {
                if element.bounds().top() < viewport.top() {
                    200.
                } else {
                    -200.
                }
            });
            window.scroll(
                "rubric-scroll",
                ScrollDelta::Pixels(point(px(0.), px(delta))),
                cx,
            );
        }
        panic!("{} must be fully reachable at 860px", id);
    }
    fn config(room: &Room, window: &mut Window, cx: &mut App) {
        window.activate_window();
        window.render_frame(cx);
        window.click("rubric-tab-criteria", cx);
        window.render_frame(cx);
        reveal(window, "rubric-change-graded", cx);
        window.click("rubric-change-graded", cx);
        window.simulate_next_frame(cx);
        window.render_frame(cx);
        assert!(room.view.read(cx).criteria_open);
    }
    fn type_weight(window: &mut Window, text: &str, cx: &mut App) {
        reveal(window, "rubric-weight-thesis", cx);
        window.click("rubric-weight-thesis", cx);
        window.press("ctrl-a", cx);
        window.input(text, cx);
    }
    fn ack(room: &Room, window: &mut Window, cx: &mut App) -> RubricRequest {
        let request = room.view.read(cx).pending_request().unwrap().clone();
        let record = room.store.save_request(&request).unwrap();
        room.view.update(cx, |view, cx| {
            assert!(view.ack_saved(request.request_id, record, window, cx))
        });
        window.render_frame(cx);
        request
    }
    #[gpui_kit::test]
    fn typed_weight_then_real_step_uses_held_value_and_saved_score_projection(
        cx: &mut TestAppContext,
    ) {
        let source = reference();
        let room = room(cx, fixture(), RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            assert_eq!(
                room.view
                    .read(cx)
                    .display()
                    .unwrap()
                    .writer_score(CachedScoreSet::VisibleCriteria),
                source["initialWriterScore"].as_f64()
            );
            config(&room, window, cx);
            type_weight(window, "2", cx);
            window.click("rubric-weight-more-thesis", cx);
            let request = room.view.read(cx).pending_request().unwrap().clone();
            assert_eq!(
                request
                    .candidate
                    .display(FOLIO)
                    .unwrap()
                    .criteria
                    .iter()
                    .find(|c| c.id == "thesis")
                    .unwrap()
                    .weight,
                source["typedTwoThenIncrease"].as_f64().unwrap()
            );
            assert_eq!(room.view.read(cx).saved_record().generation, 0);
            ack(&room, window, cx);
            let view = room.view.read(cx);
            assert_eq!(
                view.display().unwrap().writer_score(view.score_set),
                source["editedWriterScore"].as_f64()
            );
            assert_eq!(
                view.display()
                    .unwrap()
                    .writer_score(CachedScoreSet::VisibleCriteria),
                source["fullReportAfterEdit"].as_f64()
            );
            assert_eq!(
                view.display()
                    .unwrap()
                    .result
                    .value
                    .as_ref()
                    .unwrap()
                    .overall_score,
                65.
            );
            window.click("rubric-full-report", cx);
        })
        .unwrap();
        let events = room.events.lock().unwrap();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, RubricEvent::SurfaceRequested(RubricSurface::Galley)))
        );
    }
    #[gpui_kit::test]
    fn idle_weight_ack_preserves_entity_focus_and_continued_typing(cx: &mut TestAppContext) {
        let room = room(cx, fixture(), RubricSurface::Board, 464.);
        let mut input = None;
        cx.update_window(room.window, |_, window, cx| {
            config(&room, window, cx);
            type_weight(window, "2", cx);
            input = Some(
                room.view.read(cx).weights[&(FOLIO.into(), "thesis".into())]
                    .input
                    .clone(),
            );
        })
        .unwrap();
        cx.executor().advance_clock(Duration::from_millis(351));
        cx.run_until_parked();
        cx.update_window(room.window, |_, window, cx| {
            let prior = input.as_ref().unwrap();
            assert!(room.view.read(cx).pending_request().is_some());
            ack(&room, window, cx);
            assert_eq!(
                prior.entity_id(),
                room.view.read(cx).weights[&(FOLIO.into(), "thesis".into())]
                    .input
                    .entity_id()
            );
            let focus = prior.read(cx).focus_handle(cx);
            assert!(focus.is_focused(window));
            window.press("end", cx);
            window.input(".5", cx);
            let request = room.view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert_eq!(
                request
                    .candidate
                    .display(FOLIO)
                    .unwrap()
                    .criteria
                    .iter()
                    .find(|c| c.id == "thesis")
                    .unwrap()
                    .weight,
                2.5
            );
            ack(&room, window, cx);
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn final_unblurred_weight_failed_save_retry_exact_ack_and_foreign_retention(
        cx: &mut TestAppContext,
    ) {
        let original = fixture();
        let room = room(cx, original.clone(), RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            config(&room, window, cx);
            type_weight(window, "2.75", cx);
            let request = room.view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert_eq!(
                room.view
                    .update(cx, |view, cx| view.prepare_pending_edits(cx).unwrap())
                    .unwrap()
                    .request_id,
                request.request_id
            );
            assert_eq!(
                request.candidate.folios[FOLIO].result,
                original.folios[FOLIO].result
            );
            assert_eq!(
                request.candidate.folios["unmounted/foreign"],
                original.folios["unmounted/foreign"]
            );
            assert_eq!(request.candidate.legacy, original.legacy);
            room.view.update(cx, |view, cx| {
                assert!(!view.set_scope(
                    Some("unmounted/foreign".into()),
                    RubricViewContext::default(),
                    window,
                    cx
                ))
            });
            std::fs::create_dir(room.store.path().with_file_name("rubric.json.bak")).unwrap();
            let error = room.store.save_request(&request).unwrap_err().to_string();
            room.view.update(cx, |view, cx| {
                assert!(view.report_error(request.request_id, error, cx))
            });
            assert_eq!(room.view.read(cx).saved_record().as_ref(), &original);
            window.render_frame(cx);
            window.click("rubric-save-retry", cx);
            assert_eq!(
                room.view.read(cx).pending_request().unwrap().request_id,
                request.request_id
            );
            std::fs::remove_dir(room.store.path().with_file_name("rubric.json.bak")).unwrap();
            ack(&room, window, cx);
            room.view.update(cx, |view, cx| {
                assert!(!view.report_error(request.request_id, "late failure", cx));
                assert!(!view.ack_saved(request.request_id, request.candidate.clone(), window, cx));
            });
            assert_eq!(room.store.load().unwrap().record.generation, 1);
        })
        .unwrap();
        let events = room.events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, RubricEvent::Filed { .. }))
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, RubricEvent::SaveRequested(_)))
                .count(),
            2
        );
    }
    #[gpui_kit::test]
    fn custom_form_is_scope_retained_and_only_explicit_add_files_once(cx: &mut TestAppContext) {
        let room = room(cx, fixture(), RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            config(&room, window, cx);
            reveal(window, "rubric-custom-name", cx);
            window.click("rubric-custom-name", cx);
            window.input("Keep the café concrete", cx);
            assert!(
                room.view
                    .update(cx, |view, cx| view.prepare_pending_edits(cx).unwrap())
                    .is_none()
            );
            room.view.update(cx, |view, cx| {
                assert!(view.set_scope(
                    Some("unmounted/foreign".into()),
                    RubricViewContext::default(),
                    window,
                    cx
                ));
                assert!(view.set_scope(
                    Some(FOLIO.into()),
                    RubricViewContext::default(),
                    window,
                    cx
                ));
            });
            assert_eq!(
                room.view.read(cx).forms[FOLIO]
                    .label
                    .read(cx)
                    .text()
                    .to_string(),
                "Keep the café concrete"
            );
            reveal(window, "rubric-custom-description", cx);
            window.click("rubric-custom-description", cx);
            window.input("Finish with an object.", cx);
            reveal(window, "rubric-custom-add", cx);
            window.click("rubric-custom-add", cx);
            let request = room.view.read(cx).pending_request().unwrap().clone();
            let custom = request
                .candidate
                .display(FOLIO)
                .unwrap()
                .criteria
                .into_iter()
                .find(|c| c.label == "Keep the café concrete")
                .unwrap();
            assert_eq!(custom.description, "Finish with an object.");
            assert!(custom.id.starts_with("custom-"));
            assert_eq!(
                room.view.read(cx).forms[FOLIO]
                    .label
                    .read(cx)
                    .text()
                    .to_string(),
                "Keep the café concrete"
            );
            ack(&room, window, cx);
            assert!(
                room.view.read(cx).forms[FOLIO]
                    .label
                    .read(cx)
                    .text()
                    .to_string()
                    .is_empty()
            );
            reveal(window, &format!("rubric-remove-{}", custom.id), cx);
            window.click(
                SharedString::from(format!("rubric-remove-{}", custom.id)),
                cx,
            );
            ack(&room, window, cx);
            assert!(
                !room
                    .view
                    .read(cx)
                    .display()
                    .unwrap()
                    .criteria
                    .iter()
                    .any(|c| c.id == custom.id)
            );
            assert!(window.try_find("rubric-remove-thesis").is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn original_enabled_control_changes_only_local_criteria_and_spine_stays_undeletable(
        cx: &mut TestAppContext,
    ) {
        let original = fixture();
        let room = room(cx, original.clone(), RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            config(&room, window, cx);
            reveal(window, "rubric-enable-thesis", cx);
            window.click("rubric-enable-thesis", cx);
            ack(&room, window, cx);
            assert!(
                !room
                    .view
                    .read(cx)
                    .display()
                    .unwrap()
                    .criteria
                    .iter()
                    .find(|c| c.id == "thesis")
                    .unwrap()
                    .enabled
            );
            assert_eq!(
                room.view.read(cx).saved_record().folios[FOLIO].result,
                original.folios[FOLIO].result
            );
            assert_eq!(
                room.view.read(cx).saved_record().folios[FOLIO].history,
                original.folios[FOLIO].history
            );
            let result = room.view.update(cx, |view, cx| {
                view.request_edit(
                    RubricEdit::RemoveCustom {
                        folio_id: FOLIO.into(),
                        id: "thesis".into(),
                    },
                    window,
                    cx,
                )
                .unwrap()
            });
            assert!(result.is_none());
            assert!(
                room.view
                    .read(cx)
                    .display()
                    .unwrap()
                    .criteria
                    .iter()
                    .any(|c| c.id == "thesis")
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn malformed_and_missing_artifacts_never_display_a_grade_or_file_defaults(
        cx: &mut TestAppContext,
    ) {
        let mut record = fixture();
        record.folios.get_mut(FOLIO).unwrap().result =
            OptionalField::Value(json!({"overallGrade":"A+","overallScore":"not a number"}));
        let original = record.clone();
        let room = room(cx, record, RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("rubric-retained-issues").visible());
            assert!(window.try_find("rubric-grade-stamp-88").is_none());
            assert!(window.try_find("rubric-change-graded").is_none());
            assert_eq!(window.find("rubric-grade").disabled(), Some(true));
            window.click("rubric-grade", cx);
            assert!(
                room.view
                    .update(cx, |view, cx| view.prepare_pending_edits(cx).unwrap())
                    .is_none()
            );
            assert_eq!(room.view.read(cx).saved_record().as_ref(), &original);
            room.view.update(cx, |view, cx| {
                assert!(view.set_scope(
                    Some("absent/folio".into()),
                    RubricViewContext::default(),
                    window,
                    cx
                ))
            });
            assert!(room.view.read(cx).display().unwrap().result.value.is_none());
        })
        .unwrap();
        assert!(room.events.lock().unwrap().is_empty());
    }
    #[gpui_kit::test]
    fn original_passage_order_repeated_quotes_and_foreign_live_scope_do_not_jump(
        cx: &mut TestAppContext,
    ) {
        let source = reference();
        let mut record = fixture();
        let mut review = record.folios[FOLIO].live_review.as_ref().unwrap().clone();
        review["folioId"] = json!(FOLIO);
        review["passages"]=Value::Array(source["passages"].as_array().unwrap().iter().map(|p|json!({"passage":{"id":p["id"],"text":"The same quote.","from":0,"to":15},"kind":p["kind"],"priority":p["priority"]})).collect());
        record.folios.get_mut(FOLIO).unwrap().live_review = OptionalField::Value(review);
        let room = room(cx, record, RubricSurface::Board, 464.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("rubric-passage-nothing-first").is_none());
            assert!(window.try_find("rubric-passage-fifth-not-shown").is_none());
            let mut y = px(0.);
            for id in source["visiblePassageIds"].as_array().unwrap() {
                let id = format!("rubric-passage-{}", id.as_str().unwrap());
                reveal(window, &id, cx);
                let element = window.find(SharedString::from(id.clone()));
                assert!(element.bounds().top() >= y);
                y = element.bounds().top();
            }
            reveal(window, "rubric-passage-first-same-quote", cx);
            window.click("rubric-passage-first-same-quote", cx);
            assert!(
                room.view
                    .read(cx)
                    .open_passages
                    .contains("first-same-quote")
            );
            let mut foreign = room.view.read(cx).saved_record().as_ref().clone();
            foreign.generation += 1;
            if let OptionalField::Value(review) =
                &mut foreign.folios.get_mut(FOLIO).unwrap().live_review
            {
                review["folioId"] = json!("foreign/quoted-match");
            }
            room.view.update(cx, |view, cx| {
                assert!(view.replace_record(Arc::new(foreign), window, cx))
            });
            window.render_frame(cx);
            assert!(window.try_find("rubric-passage-first-same-quote").is_none());
        })
        .unwrap();
        assert!(room.events.lock().unwrap().is_empty());
    }
    #[gpui_kit::test]
    fn actual_grade_masks_first_frame_resize_and_full_report_remain_read_only(
        cx: &mut TestAppContext,
    ) {
        let source = reference();
        for stamp in source["stamps"].as_array().unwrap() {
            let (asset, _) = grade_asset(stamp["grade"].as_str().unwrap());
            assert_eq!(
                format!("/assets/rubric-stamps/{asset}"),
                stamp["asset"].as_str().unwrap()
            );
        }
        let room = room(cx, fixture(), RubricSurface::Galley, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            for width in [1280., 620., 1280.] {
                window.resize(size(px(width), px(860.)));
                window.render_frame(cx);
                assert!(window.find("rubric-galley-back").visible());
                assert_eq!(
                    window.find("rubric-grade-stamp-144").bounds().size,
                    size(px(144.), px(144.))
                );
                assert!(window.try_find("rubric-change-graded").is_none());
                assert!(window.try_find("rubric-custom-add").is_none());
                assert!(
                    room.view
                        .update(cx, |view, cx| view.prepare_pending_edits(cx).unwrap())
                        .is_none()
                );
            }
            window.click("rubric-galley-back", cx);
        })
        .unwrap();
        assert!(
            room.events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, RubricEvent::BackToDesk))
        );
        let (image, scale) = stamped_image("sunburst-c-plus.png", -2., 0x345678).unwrap();
        assert!(scale > 1.);
        let bytes = image.as_bytes(0).unwrap();
        assert!(bytes.as_chunks::<4>().0.iter().any(|pixel| pixel[3] > 0));
        assert!(
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .all(|pixel| pixel[0..3] == [0x78, 0x56, 0x34] && pixel[3] <= 224)
        );
    }
}
