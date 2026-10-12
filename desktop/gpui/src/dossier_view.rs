//! The native ten-section Dossier form, filed into the same two-leaf sheet as
//! Twyne's existing form. Provider capabilities are explicit events; the form
//! itself works entirely offline.

use crate::{
    assets::{self, TwyneIcon},
    chrome::{tracked_text, tracked_typewriter},
    dossier::{
        self, ANSWER_FIELDS, DossierDraft, DossierMode, DossierSession, DossierSubmission,
        FIELD_LABELS, FilingState, PriorMaterial, STEPS, StepKind, TemplatePiece,
        WRITING_FORMAT_SUGGESTIONS,
    },
    dossier_image_lifecycle::{DossierImageLease, DossierImageLifecycle},
    dossier_multiply::DossierMultiply,
    dossier_paper::{DossierPaper, DossierPaperMetrics},
    dossier_stamp::DossierStampSet,
    manuscript::timestamp,
    theme::{self, DISPLAY_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT},
    workspace::{AttachmentKind, BriefField, ProbeAnswer, ProbeKind},
};
use anyhow::Result;
use gpui_kit::component::{
    Disableable, Sizable,
    button::{Button, ButtonVariants},
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    slider::{Slider, SliderEvent, SliderState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Canvas, ContentMask, Context, Entity, EventEmitter, FocusHandle, Focusable,
    FontWeight, ImageId, IntoElement, KeyBinding, MouseButton, PathPromptOptions, Render, Role,
    SharedString, Subscription, Task, TestSupportExt, Window, WindowId, canvas, div, font,
    linear_color_stop, linear_gradient, px, relative, rgb,
};
use std::{cell::Cell, collections::BTreeMap, rc::Rc, sync::Arc, time::Duration};

#[cfg(all(test, feature = "ui-tests"))]
use gpui_kit::Pixels;

gpui_kit::actions!(
    dossier,
    [
        DossierBack,
        DossierNext,
        DossierCancel,
        DossierAnswerEnter,
        DossierMaterialModifiedEnter
    ]
);

#[derive(Clone, Copy, Debug, Default)]
pub struct DossierCapabilities {
    pub conversation: bool,
    pub read_draft: bool,
    pub start_over: bool,
}

#[derive(Clone, Debug)]
pub enum DossierEvent {
    /// The application must persist this payload and call acknowledge_filed()
    /// or report_filing_error(). Emission alone is not a successful disk save.
    FilingRequested {
        token: u64,
        submission: DossierSubmission,
    },
    Cancelled,
    ConversationRequested {
        draft: DossierDraft,
    },
    ReadDraftRequested {
        draft: DossierDraft,
    },
    StartOverRequested {
        draft: DossierDraft,
    },
}

enum AnswerControl {
    Input(Entity<InputState>),
    Textarea(Entity<TextareaState>),
}

impl AnswerControl {
    fn text(&self, cx: &App) -> String {
        match self {
            Self::Input(state) => state.read(cx).text().to_string(),
            Self::Textarea(state) => state.read(cx).text().to_string(),
        }
    }
    fn preview(&self, cx: &App, max: usize) -> String {
        // A preview samples a bounded prefix. It never serializes a pasted
        // manuscript on every native text-input repaint.
        match self {
            Self::Input(state) => state.read(cx).text().chars().take(max).collect(),
            Self::Textarea(state) => state.read(cx).text().chars().take(max).collect(),
        }
    }
    fn focus(&self, window: &mut Window, cx: &mut Context<DossierView>) {
        match self {
            Self::Input(state) => state.update(cx, |state, cx| state.focus(window, cx)),
            Self::Textarea(state) => state.update(cx, |state, cx| state.focus(window, cx)),
        }
    }
}

enum ProbeControl {
    Choice,
    Multi(Vec<String>),
    Blanks(Vec<Entity<InputState>>),
    Scale(Entity<SliderState>),
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ImportTicket {
    request: u64,
    generation: u64,
    reference: bool,
}

// A scene recording receipt is deliberately distinct from GPU presentation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DossierFoxingPaintStatus {
    #[default]
    Unprepared,
    Transparent,
    Prepared,
    Recorded,
    Untracked,
    UnsupportedBackend,
    StalePreparation,
    Clipped,
    PaintRefused,
}

#[derive(Clone, Copy, Default)]
struct DossierFoxingPaintReceipt {
    window: Option<WindowId>,
    active_image: Option<ImageId>,
    status: DossierFoxingPaintStatus,
}

pub struct DossierView {
    pub session: DossierSession,
    capabilities: DossierCapabilities,
    answers: [AnswerControl; 7],
    prior_material: Entity<TextareaState>,
    material_word_count: usize,
    reference_title: Entity<InputState>,
    reference_url: Entity<InputState>,
    reference_text: Entity<TextareaState>,
    reference_why: Entity<InputState>,
    probes: BTreeMap<String, ProbeControl>,
    focus_handle: FocusHandle,
    error: Option<String>,
    recovery_task: Option<Task<()>>,
    import_task: Option<Task<()>>,
    import_generation: u64,
    import_request: Option<ImportTicket>,
    retired: bool,
    filing_generation: u64,
    filing_request: Option<u64>,
    dirty: bool,
    start_over_confirm: bool,
    image_lease: Option<DossierImageLease>,
    paper: Option<Arc<DossierPaper>>,
    reviewed_stamps: Option<Arc<DossierStampSet>>,
    foxing: Option<Arc<DossierMultiply>>,
    foxing_paint: Rc<Cell<DossierFoxingPaintReceipt>>,
    _subscriptions: Vec<Subscription>,
    probe_subscriptions: Vec<Subscription>,
}

impl EventEmitter<DossierEvent> for DossierView {}
impl Focusable for DossierView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("alt-left", DossierBack, Some("Dossier")),
        KeyBinding::new("alt-right", DossierNext, Some("Dossier")),
        KeyBinding::new("escape", DossierCancel, Some("Dossier")),
    ]);
    // Source's ordinary input commits every Enter. Its answer textarea
    // commits Ctrl/Meta+Enter even when Shift or Alt is also held. Keep these
    // bindings below the Dossier answer frame and above Kit's Input context.
    for modifiers in [
        "",
        "alt-",
        "ctrl-",
        "cmd-",
        "ctrl-alt-",
        "cmd-alt-",
        "ctrl-cmd-",
        "ctrl-cmd-alt-",
    ] {
        for shift in ["", "shift-"] {
            let key = format!("{modifiers}{shift}enter");
            cx.bind_keys([KeyBinding::new(
                &key,
                DossierAnswerEnter,
                Some("DossierSingleAnswer > Input"),
            )]);
            if modifiers.contains("ctrl") || modifiers.contains("cmd") {
                cx.bind_keys([KeyBinding::new(
                    &key,
                    DossierAnswerEnter,
                    Some("DossierTextareaAnswer > Input"),
                )]);
            }
            if !modifiers.is_empty() {
                // Browser textarea defaults leave modified Enter unchanged
                // when prior material has no Source advance handler.
                cx.bind_keys([KeyBinding::new(
                    &key,
                    DossierMaterialModifiedEnter,
                    Some("DossierMaterial > Input"),
                )]);
            }
        }
    }
}

impl DossierView {
    pub fn new(session: DossierSession, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_capabilities(session, DossierCapabilities::default(), window, cx)
    }

    pub fn with_capabilities(
        session: DossierSession,
        capabilities: DossierCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subscriptions = Vec::new();
        let answers = std::array::from_fn(|index| {
            let step = STEPS[index];
            let value = dossier::answer(&session.draft.answers, ANSWER_FIELDS[index]);
            if step.kind == StepKind::Input {
                let state = cx.new(|cx| InputState::new(window, cx).placeholder(step.placeholder));
                state.update(cx, |state, cx| state.set_value(value, window, cx));
                subscriptions.push(cx.subscribe_in(
                    &state,
                    window,
                    move |this, _, event, window, cx| match event {
                        InputEvent::Change => this.changed(window, cx),
                        InputEvent::PressEnter { .. } if this.session.draft.step == index => {
                            this.next(window, cx)
                        }
                        _ => {}
                    },
                ));
                AnswerControl::Input(state)
            } else {
                let state =
                    cx.new(|cx| TextareaState::new(window, cx).placeholder(step.placeholder));
                state.update(cx, |state, cx| state.set_value(value, window, cx));
                subscriptions.push(cx.subscribe_in(
                    &state,
                    window,
                    move |this, _, event, window, cx| match event {
                        InputEvent::Change => this.changed(window, cx),
                        InputEvent::PressEnter {
                            secondary: true, ..
                        } if this.session.draft.step == index => this.next(window, cx),
                        _ => {}
                    },
                ));
                AnswerControl::Textarea(state)
            }
        });
        let prior_material =
            cx.new(|cx| TextareaState::new(window, cx).placeholder(STEPS[8].placeholder));
        prior_material.update(cx, |state, cx| {
            state.set_value(session.draft.prior_material.text.clone(), window, cx)
        });
        let input = |value: &str,
                     placeholder: &'static str,
                     window: &mut Window,
                     cx: &mut Context<Self>| {
            let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
            state.update(cx, |state, cx| state.set_value(value, window, cx));
            state
        };
        let reference_title = input(&session.draft.reference.title, "Title", window, cx);
        let reference_url = input(&session.draft.reference.url, "https://…", window, cx);
        let reference_why = input(
            &session.draft.reference.why,
            "Why does this matter to the piece? (one line)",
            window,
            cx,
        );
        let reference_text =
            cx.new(|cx| TextareaState::new(window, cx).placeholder("Paste the document text"));
        reference_text.update(cx, |state, cx| {
            state.set_value(session.draft.reference.text.clone(), window, cx)
        });
        for state in [&reference_title, &reference_url, &reference_why] {
            subscriptions.push(
                cx.subscribe_in(state, window, |this, _, event, window, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.changed(window, cx);
                    }
                }),
            );
        }
        for state in [&prior_material, &reference_text] {
            subscriptions.push(
                cx.subscribe_in(state, window, |this, _, event, window, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.changed(window, cx);
                    }
                }),
            );
        }
        subscriptions.push(cx.on_app_quit(|this, cx| {
            let _ = this.flush_recovery(cx);
            async {}
        }));
        subscriptions.push(cx.observe_window_bounds(window, |this, window, cx| {
            #[cfg(feature = "ui-tests")]
            let mut diagnostic = crate::dossier_paper::resize_diagnostics::Operation::for_window(
                crate::dossier_paper::resize_diagnostics::Kind::BoundsObserver,
                window,
            );
            this.prepare_paper(window, cx);
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("returned");
        }));
        subscriptions.push(cx.observe_global_in::<theme::NativePalette>(
            window,
            |this, window, cx| {
                #[cfg(feature = "ui-tests")]
                let mut diagnostic =
                    crate::dossier_paper::resize_diagnostics::Operation::for_window(
                        crate::dossier_paper::resize_diagnostics::Kind::PaletteObserver,
                        window,
                    );
                this.prepare_paper(window, cx);
                #[cfg(feature = "ui-tests")]
                diagnostic.outcome("returned");
            },
        ));
        let material_word_count = dossier::material_word_count(&session.draft.prior_material.text);
        let mut view = Self {
            session,
            capabilities,
            answers,
            prior_material,
            material_word_count,
            reference_title,
            reference_url,
            reference_text,
            reference_why,
            probes: BTreeMap::new(),
            focus_handle: cx.focus_handle(),
            error: None,
            recovery_task: None,
            import_task: None,
            import_generation: 0,
            import_request: None,
            retired: false,
            filing_generation: 0,
            filing_request: None,
            dirty: false,
            start_over_confirm: false,
            image_lease: None,
            paper: None,
            reviewed_stamps: None,
            foxing: None,
            foxing_paint: Rc::new(Cell::new(DossierFoxingPaintReceipt::default())),
            _subscriptions: subscriptions,
            probe_subscriptions: Vec::new(),
        };
        if view.session.draft.step == 7 {
            view.rebuild_probe_controls(window, cx);
        }
        view.prepare_paper(window, cx);
        view.focus_current(window, cx);
        view
    }

    // Explicit constructor/theme/resize boundary only; never called by render,
    // InputEvent::Change or a paint callback. Public for manual DPR test/host
    // transitions that do not invoke GPUI's platform bounds callbacks.
    /// The root attaches this before mounting a newly created form.
    pub fn attach_image_lifecycle(
        &mut self,
        lifecycle: &DossierImageLifecycle,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Result<()> {
        anyhow::ensure!(
            self.image_lease.is_none(),
            "Dossier images are already attached"
        );
        let lease = lifecycle.lease(window, cx)?;
        lease.replace(&self.prepared_images(), window, cx)?;
        self.image_lease = Some(lease);
        self.commit_foxing_receipt(window);
        Ok(())
    }

    pub fn image_lease(&self) -> Option<&DossierImageLease> {
        self.image_lease.as_ref()
    }

    /// Explicit host return from a route which unmounted this retained draft.
    /// Theme callbacks cannot revive the retired lease; prepare current images
    /// and attach a fresh consumer only when the host decides to remount it.
    pub fn resume_image_lifecycle(
        &mut self,
        lifecycle: &DossierImageLifecycle,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Result<()> {
        if self
            .image_lease
            .as_ref()
            .is_some_and(|lease| lease.is_current())
        {
            return Ok(());
        }
        let previous_lease = self.image_lease.take();
        let previous_paper = self.paper.clone();
        let previous_stamps = self.reviewed_stamps.clone();
        let previous_foxing = self.foxing.clone();
        let previous_foxing_paint = self.foxing_paint.get();
        self.prepare_paper_candidate(window, cx);
        if let Err(error) = self.attach_image_lifecycle(lifecycle, window, cx) {
            self.image_lease = previous_lease;
            self.paper = previous_paper;
            self.reviewed_stamps = previous_stamps;
            self.foxing = previous_foxing;
            self.foxing_paint.set(previous_foxing_paint);
            return Err(error);
        }
        Ok(())
    }

    fn prepared_images(&self) -> Vec<Arc<gpui_kit::RenderImage>> {
        let mut images = Vec::with_capacity(10);
        if let Some(paper) = &self.paper {
            images.push(paper.raster_image().clone());
        }
        if let Some(stamps) = &self.reviewed_stamps {
            for count in 0..crate::dossier_stamp::COUNT_VARIANTS {
                images.push(
                    stamps
                        .stamp(count)
                        .expect("Complete prepared stamp set")
                        .raster_image()
                        .clone(),
                );
            }
        }
        // Broadsheet has no group. Include a prepared group once after the
        // available ordinary images (tenth only with all eight stamps),
        // even if this backend cannot upload it.
        if let Some(image) = self
            .foxing
            .as_ref()
            .and_then(|foxing| foxing.premultiplied_group())
        {
            images.push(image.clone());
        }
        images
    }

    /// Preparation/atlas audit seam. Never mount this premultiplied image with
    /// ordinary img/paint_image; use the guarded final overlay below.
    pub fn prepared_multiply(&self) -> Option<&Arc<DossierMultiply>> {
        self.foxing.as_ref()
    }

    /// Recorded means a scene primitive was recorded, not presented. A
    /// retained form whose lease has retired is never an active image consumer.
    pub fn foxing_paint_status(&self) -> DossierFoxingPaintStatus {
        if self
            .foxing
            .as_ref()
            .is_some_and(|foxing| !foxing.is_transparent())
            && self
                .image_lease
                .as_ref()
                .is_none_or(|lease| !lease.is_current())
        {
            return DossierFoxingPaintStatus::Untracked;
        }
        self.foxing_paint.get().status
    }

    // Commit only after the accepted image lease replacement/resume succeeds.
    // An old canvas retains this same cell, so identity protects against its
    // uploading a retired image or overwriting a newer preparation receipt.
    fn commit_foxing_receipt(&self, window: &Window) {
        let (active_image, status) = match self.foxing.as_ref() {
            Some(foxing) if foxing.is_transparent() => {
                (None, DossierFoxingPaintStatus::Transparent)
            }
            Some(foxing) => (
                foxing.premultiplied_group().map(|image| image.id),
                DossierFoxingPaintStatus::Prepared,
            ),
            None => (None, DossierFoxingPaintStatus::Unprepared),
        };
        self.foxing_paint.set(DossierFoxingPaintReceipt {
            window: Some(window.window_handle().window_id()),
            active_image,
            status,
        });
    }

    // Constructor/theme/viewport/DPR/resume boundaries only, independently of
    // whether the ordinary paper preparation matched its existing cache key.
    fn prepare_multiply_candidate(
        &mut self,
        colors: theme::Palette,
        metrics: Option<DossierPaperMetrics>,
    ) {
        let Some(metrics) = metrics else {
            self.foxing = None;
            return;
        };
        if self
            .foxing
            .as_ref()
            .is_some_and(|foxing| foxing.matches(colors, metrics))
        {
            return;
        }
        match DossierMultiply::prepare(colors, metrics) {
            Ok(foxing) => self.foxing = Some(foxing),
            Err(error) => {
                self.foxing = None;
                eprintln!("Could not prepare Dossier foxing: {error:#}");
            }
        }
    }

    // Paint-only and LAST: no layout, hitbox, focus/accessibility node, text
    // capture, rasterization, cache lookup or atlas retirement occurs here.
    fn foxing_overlay(&self) -> Option<Canvas<()>> {
        let foxing = self.foxing.as_ref()?.clone();
        let image_id = foxing.premultiplied_group()?.id;
        let lease = self.image_lease.as_ref()?.clone();
        if !lease.is_current() {
            return None;
        }
        let receipt = self.foxing_paint.clone();
        Some(
            canvas(
                |_, _, _| (),
                move |bounds, (), window, cx| {
                    let current = receipt.get();
                    if current.window != Some(window.window_handle().window_id())
                        || !lease.is_current()
                        || current.active_image != Some(image_id)
                    {
                        return;
                    }
                    let record = |status| {
                        receipt.set(DossierFoxingPaintReceipt { status, ..current });
                    };
                    let metrics = foxing.metrics();
                    if f32::from(bounds.size.width).to_bits() != metrics.width().to_bits()
                        || f32::from(bounds.size.height).to_bits() != metrics.height().to_bits()
                        || window.scale_factor().to_bits() != metrics.scale_factor().to_bits()
                        || !foxing.matches(*theme::palette(cx), metrics)
                    {
                        record(DossierFoxingPaintStatus::StalePreparation);
                        return;
                    }
                    if !window.supports_destination_multiply() {
                        record(DossierFoxingPaintStatus::UnsupportedBackend);
                        return;
                    }
                    let visible = bounds.intersect(&window.content_mask().bounds);
                    if visible.is_empty() {
                        record(DossierFoxingPaintStatus::Clipped);
                        return;
                    }
                    let result = window
                        .with_content_mask(Some(ContentMask { bounds: visible }), |window| {
                            foxing.paint_on_opaque_backdrop(bounds, window, cx)
                        });
                    record(if result.is_ok() {
                        DossierFoxingPaintStatus::Recorded
                    } else {
                        // The core's opaque-window, ancestor opacity, mask and
                        // exact device-grid checks refuse before any upload.
                        // Refusal leaves ordinary descendants paintable.
                        DossierFoxingPaintStatus::PaintRefused
                    });
                },
            )
            .absolute()
            .inset_0()
            .size_full(),
        )
    }

    pub fn prepare_paper(&mut self, window: &Window, cx: &mut Context<Self>) {
        #[cfg(feature = "ui-tests")]
        let mut diagnostic = crate::dossier_paper::resize_diagnostics::Operation::for_window(
            crate::dossier_paper::resize_diagnostics::Kind::HostPreparation,
            window,
        );
        // A retained unmounted form is not a new consumer on a theme event.
        if self
            .image_lease
            .as_ref()
            .is_some_and(|lease| !lease.is_current())
        {
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("retiredLeaseSkipped");
            return;
        }
        let previous_paper = self.paper.clone();
        let previous_stamps = self.reviewed_stamps.clone();
        let previous_foxing = self.foxing.clone();
        let previous_foxing_paint = self.foxing_paint.get();
        self.prepare_paper_candidate(window, cx);
        if let Some(lease) = &self.image_lease {
            #[cfg(feature = "ui-tests")]
            let lease_start = std::time::Instant::now();
            let replacement = lease.replace(&self.prepared_images(), window, cx);
            #[cfg(feature = "ui-tests")]
            diagnostic.measure_since(
                crate::dossier_paper::resize_diagnostics::Phase::LeaseReplacement,
                lease_start,
            );
            if let Err(error) = replacement {
                // Candidate preparation cannot upload. Preserve the accepted
                // pointers/lease on refusal, rather than paint untracked data.
                // Existing paint guards refuse a now-stale palette/DPR.
                self.paper = previous_paper;
                self.reviewed_stamps = previous_stamps;
                self.foxing = previous_foxing;
                self.foxing_paint.set(previous_foxing_paint);
                self.error = Some(
                    "The Dossier paper could not be prepared. Your answers remain here.".into(),
                );
                #[cfg(feature = "ui-tests")]
                diagnostic.outcome("leaseRefused");
                eprintln!("Could not track Dossier prepared images: {error:#}");
                cx.notify();
                return;
            }
        }
        self.commit_foxing_receipt(window);
        #[cfg(feature = "ui-tests")]
        diagnostic.outcome("returned");
    }

    fn prepare_paper_candidate(&mut self, window: &Window, cx: &mut Context<Self>) {
        #[cfg(feature = "ui-tests")]
        let mut diagnostic = crate::dossier_paper::resize_diagnostics::Operation::for_window(
            crate::dossier_paper::resize_diagnostics::Kind::CandidatePreparation,
            window,
        );
        self.prepare_reviewed_stamps(window, cx);
        let viewport = window.viewport_size();
        let colors = *theme::palette(cx);
        let metrics = DossierPaperMetrics::new(
            f32::from(viewport.width),
            f32::from(viewport.height),
            window.scale_factor(),
        );
        self.prepare_multiply_candidate(colors, metrics.as_ref().ok().copied());
        if metrics.as_ref().is_ok_and(|metrics| {
            self.paper
                .as_ref()
                .is_some_and(|paper| paper.matches(colors, *metrics))
        }) {
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("paperKeyMatched");
            return;
        }
        match metrics.and_then(|metrics| DossierPaper::prepare(colors, metrics)) {
            Ok(paper) => self.paper = Some(paper),
            Err(error) => {
                self.paper = None;
                eprintln!("Could not prepare Dossier paper: {error:#}");
            }
        }
        #[cfg(feature = "ui-tests")]
        diagnostic.outcome("returned");
        cx.notify();
    }

    // All eight count variants are retained at the existing constructor,
    // theme and DPR boundaries. Count changes never shape/rasterize in Render.
    fn prepare_reviewed_stamps(&mut self, window: &Window, cx: &mut Context<Self>) {
        #[cfg(feature = "ui-tests")]
        let mut diagnostic = crate::dossier_paper::resize_diagnostics::Operation::for_window(
            crate::dossier_paper::resize_diagnostics::Kind::StampBoundary,
            window,
        );
        let color = theme::palette(cx).vermilion;
        let scale = window.scale_factor();
        if self
            .reviewed_stamps
            .as_ref()
            .is_some_and(|set| set.matches(color, scale))
        {
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("retainedKeyMatched");
            return;
        }
        match DossierStampSet::prepare(color, scale, window.text_system(), cx) {
            Ok(set) => {
                #[cfg(feature = "ui-tests")]
                diagnostic.outcome("prepareReturnedSet");
                self.reviewed_stamps = Some(set);
            }
            Err(error) => {
                #[cfg(feature = "ui-tests")]
                diagnostic.outcome("failed");
                self.reviewed_stamps = None;
                eprintln!("Could not prepare reviewed stamp: {error:#}");
            }
        }
        cx.notify();
    }

    pub fn set_capabilities(&mut self, capabilities: DossierCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }

    fn sync_session(&mut self, cx: &App) {
        for (index, control) in self.answers.iter().enumerate() {
            self.session
                .edit_answer(ANSWER_FIELDS[index], control.text(cx));
        }
        let material = self.prior_material.read(cx).text().to_string();
        if self.session.draft.prior_material.text != material {
            self.material_word_count = dossier::material_word_count(&material);
            self.session.edit_prior_material(material);
        }
        let mut reference = self.session.draft.reference.clone();
        reference.title = self.reference_title.read(cx).text().to_string();
        reference.url = self.reference_url.read(cx).text().to_string();
        reference.why = self.reference_why.read(cx).text().to_string();
        let text = self.reference_text.read(cx).text().to_string();
        if reference.text != text {
            reference.replace_text(&text);
        }
        if reference != self.session.draft.reference {
            self.session.draft.reference = reference;
            self.session.draft.touch();
        }
    }

    fn changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.retired || self.session.filing != FilingState::Idle {
            return;
        }
        self.dirty = true;
        let timer = cx.background_executor().timer(Duration::from_millis(350));
        self.recovery_task = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let Ok(Some((draft, recovery))) = this.update(cx, |this, cx| {
                if this.retired || this.session.filing != FilingState::Idle {
                    return None;
                }
                this.sync_session(cx);
                this.dirty = false;
                Some((
                    this.session.draft.clone(),
                    this.session.options.recovery.clone(),
                ))
            }) else {
                return;
            };
            let Some(recovery) = recovery else {
                return;
            };
            let generation = draft.generation;
            let result = cx
                .background_executor()
                .spawn(async move { recovery.save(&draft, timestamp()) })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.retired
                    || this.session.draft.generation != generation
                    || this.session.filing != FilingState::Idle
                {
                    return;
                }
                this.session.recovery_error = result.err().map(|error| error.to_string());
                cx.notify();
            });
        }));
        cx.notify();
    }

    /// Departure/navigation/filing reads controls directly, even when their
    /// native Change notification is still queued.
    pub fn flush_recovery(&mut self, cx: &App) -> Result<()> {
        if self.retired {
            return Ok(());
        }
        self.recovery_task = None;
        self.sync_session(cx);
        self.dirty = false;
        if self.session.filing == FilingState::Filed {
            return Ok(());
        }
        self.session.persist_recovery(timestamp())
    }

    /// Called before the host replaces or removes this form. The recovery
    /// writer is retired under its disk-write lock, not just a UI callback.
    pub fn retire(&mut self) -> Result<()> {
        self.recovery_task = None;
        self.invalidate_import();
        if let Some(recovery) = &self.session.options.recovery {
            recovery.retire()?;
        }
        self.retired = true;
        self.filing_request = None;
        Ok(())
    }

    fn focus_current(&self, window: &mut Window, cx: &mut Context<Self>) {
        match self.session.draft.step {
            index @ 0..=6 => self.answers[index].focus(window, cx),
            8 => self
                .prior_material
                .update(cx, |state, cx| state.focus(window, cx)),
            9 => self
                .reference_title
                .update(cx, |state, cx| state.focus(window, cx)),
            _ => window.focus(&self.focus_handle, cx),
        }
    }

    pub fn go_to(&mut self, step: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.retired || self.session.filing != FilingState::Idle {
            return;
        }
        let _ = self.flush_recovery(cx);
        match self.session.go_to(step) {
            Ok(()) => {
                self.error = None;
                if step == 7 {
                    self.rebuild_probe_controls(window, cx);
                }
                self.focus_current(window, cx);
                self.changed(window, cx);
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub fn next(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.retired || self.session.filing != FilingState::Idle {
            return;
        }
        if self.session.draft.step < STEPS.len() - 1 {
            self.go_to(self.session.draft.step + 1, window, cx);
            return;
        }
        let _ = self.flush_recovery(cx);
        let Some(token) = self.filing_generation.checked_add(1) else {
            self.error = Some("Reopen the Dossier before filing it again.".into());
            cx.notify();
            return;
        };
        match self.session.prepare_filing(timestamp()) {
            Ok(submission) => {
                self.invalidate_import();
                self.error = None;
                self.filing_generation = token;
                self.filing_request = Some(token);
                cx.emit(DossierEvent::FilingRequested { token, submission });
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub fn filing_token(&self) -> Option<u64> {
        self.filing_request
    }

    pub fn accepts_filing(&self, token: u64) -> bool {
        !self.retired
            && self.filing_request == Some(token)
            && self.session.filing == FilingState::Filing
    }

    pub fn acknowledge_filed(&mut self, token: u64, cx: &mut Context<Self>) -> Result<bool> {
        if !self.accepts_filing(token) {
            return Ok(false);
        }
        self.filing_request = None;
        self.recovery_task = None;
        self.invalidate_import();
        let result = self.session.acknowledge_filed();
        self.error = result.as_ref().err().map(ToString::to_string);
        cx.notify();
        result.map(|()| true)
    }

    pub fn report_filing_error(
        &mut self,
        token: u64,
        error: impl Into<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.accepts_filing(token) {
            return false;
        }
        self.filing_request = None;
        self.session.filing_failed();
        self.error = Some(error.into());
        self.focus_current(window, cx);
        cx.notify();
        true
    }

    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        if let Err(error) = self.flush_recovery(cx).and_then(|()| self.retire()) {
            self.error = Some(error.to_string());
            cx.notify();
            return;
        }
        if self.session.filing == FilingState::Filing {
            self.session.filing_failed();
        }
        cx.emit(DossierEvent::Cancelled);
    }

    fn rebuild_probe_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.probes.clear();
        self.probe_subscriptions.clear();
        for probe in &self.session.draft.probes {
            let control = match probe.kind {
                ProbeKind::Choice => ProbeControl::Choice,
                ProbeKind::Multi => ProbeControl::Multi(match &probe.answer {
                    Some(ProbeAnswer::Texts(texts)) => texts.clone(),
                    _ => Vec::new(),
                }),
                ProbeKind::Blanks => {
                    let count = probe
                        .template
                        .as_ref()
                        .map(|template| {
                            dossier::split_template(template)
                                .iter()
                                .filter(|piece| matches!(piece, TemplatePiece::Blank))
                                .count()
                        })
                        .unwrap_or(0);
                    if count == 0 {
                        ProbeControl::Invalid
                    } else {
                        let mut controls = Vec::new();
                        for index in 0..count {
                            let state = cx.new(|cx| {
                                InputState::new(window, cx)
                                    .placeholder(format!("Blank {}", index + 1))
                            });
                            if let Some(ProbeAnswer::Texts(texts)) = &probe.answer
                                && let Some(value) = texts.get(index)
                            {
                                state.update(cx, |state, cx| state.set_value(value, window, cx));
                            }
                            self.probe_subscriptions
                                .push(cx.subscribe(&state, |_, _, _: &InputEvent, cx| cx.notify()));
                            controls.push(state);
                        }
                        ProbeControl::Blanks(controls)
                    }
                }
                ProbeKind::Scale => {
                    let (min, max) = (probe.min.unwrap_or(1.0), probe.max.unwrap_or(5.0));
                    if !min.is_finite() || !max.is_finite() || min >= max {
                        ProbeControl::Invalid
                    } else {
                        let value = match probe.answer {
                            Some(ProbeAnswer::Number(number)) if number.is_finite() => number,
                            _ => ((min + max) / 2.0).round(),
                        };
                        let state = cx.new(|_| {
                            SliderState::new()
                                .min(min as f32)
                                .max(max as f32)
                                .step(1.0)
                                .default_value(value as f32)
                        });
                        self.probe_subscriptions
                            .push(cx.subscribe(&state, |_, _, _: &SliderEvent, cx| cx.notify()));
                        ProbeControl::Scale(state)
                    }
                }
            };
            self.probes.insert(probe.id.clone(), control);
        }
    }

    fn commit_probe(
        &mut self,
        id: &str,
        answer: ProbeAnswer,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match self.session.answer_probe(id, Some(answer)) {
            Ok(()) => {
                self.error = None;
                self.changed(window, cx);
            }
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
            }
        }
    }

    fn choose(&mut self, id: &str, option: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ProbeControl::Multi(selected)) = self.probes.get_mut(id) {
            if let Some(index) = selected.iter().position(|value| value == &option) {
                selected.remove(index);
            } else {
                selected.push(option);
            }
            cx.notify();
        } else {
            self.commit_probe(id, ProbeAnswer::Text(option), window, cx);
        }
    }

    fn confirm_probe(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let answer = match self.probes.get(id) {
            Some(ProbeControl::Multi(texts)) => Some(ProbeAnswer::Texts(texts.clone())),
            Some(ProbeControl::Blanks(states)) => Some(ProbeAnswer::Texts(
                states
                    .iter()
                    .map(|state| state.read(cx).text().to_string())
                    .collect(),
            )),
            Some(ProbeControl::Scale(state)) => Some(ProbeAnswer::Number(f64::from(
                state.read(cx).value().start(),
            ))),
            _ => None,
        };
        if let Some(answer) = answer {
            self.commit_probe(id, answer, window, cx);
        }
    }

    fn invalidate_import(&mut self) {
        self.import_request = None;
        self.import_task = None;
    }

    fn begin_import(&mut self, reference: bool, cx: &mut Context<Self>) -> Option<ImportTicket> {
        if self.retired || self.session.filing != FilingState::Idle {
            return None;
        }
        self.sync_session(cx);
        let Some(request) = self.import_generation.checked_add(1) else {
            self.error = Some("Reopen the Dossier before importing another file.".into());
            cx.notify();
            return None;
        };
        self.invalidate_import();
        self.import_generation = request;
        let ticket = ImportTicket {
            request,
            generation: self.session.draft.generation,
            reference,
        };
        self.import_request = Some(ticket);
        Some(ticket)
    }

    fn finish_import(
        &mut self,
        ticket: ImportTicket,
        result: Result<PriorMaterial>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.retired
            || self.session.filing != FilingState::Idle
            || self.import_request != Some(ticket)
        {
            return false;
        }
        // Read controls before checking the generation: a native Change event
        // can still be queued when a file picker or background read returns.
        self.sync_session(cx);
        self.import_request = None;
        if self.session.draft.generation != ticket.generation {
            return false;
        }
        match result {
            Ok(material) if ticket.reference => {
                self.session.draft.reference.import_text(
                    &material.text,
                    material.imported_filename().unwrap_or("Imported document"),
                );
                let reference = &self.session.draft.reference;
                self.reference_text.update(cx, |state, cx| {
                    state.set_value(reference.text.clone(), window, cx)
                });
                self.reference_title.update(cx, |state, cx| {
                    state.set_value(reference.title.clone(), window, cx)
                });
                self.session.draft.touch();
                self.error = None;
                self.changed(window, cx);
            }
            Ok(material) => {
                self.material_word_count = dossier::material_word_count(&material.text);
                self.session.replace_prior_material(material);
                self.prior_material.update(cx, |state, cx| {
                    state.set_value(self.session.draft.prior_material.text.clone(), window, cx)
                });
                self.error = None;
                self.changed(window, cx);
            }
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
            }
        }
        true
    }

    fn upload(&mut self, reference: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ticket) = self.begin_import(reference, cx) else {
            return;
        };
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Upload a .txt, .md, or .html file".into()),
        });
        self.import_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = match picker.await {
                Ok(Ok(Some(paths))) if !paths.is_empty() => {
                    let path = paths.into_iter().next().unwrap();
                    cx.background_executor()
                        .spawn(async move { dossier::read_prior_material(&path) })
                        .await
                }
                Ok(Ok(_)) => {
                    let _ = this.update(cx, |this, _| {
                        if this.import_request == Some(ticket) {
                            this.import_request = None;
                        }
                    });
                    return;
                }
                result => Err(anyhow::anyhow!(
                    "Could not open the file picker: {result:?}"
                )),
            };
            let _ = cx.update(|window, cx| {
                this.update(cx, |this, cx| {
                    this.finish_import(ticket, result, window, cx);
                })
            });
        }));
    }

    fn clear_material(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.material_word_count = 0;
        self.session.clear_prior_material();
        self.prior_material
            .update(cx, |state, cx| state.set_value("", window, cx));
        self.changed(window, cx);
    }

    fn add_reference(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_session(cx);
        match self.session.add_reference(timestamp()) {
            Ok(()) => {
                for state in [
                    &self.reference_title,
                    &self.reference_url,
                    &self.reference_why,
                ] {
                    state.update(cx, |state, cx| state.set_value("", window, cx));
                }
                self.reference_text
                    .update(cx, |state, cx| state.set_value("", window, cx));
                self.error = None;
                self.changed(window, cx);
            }
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
            }
        }
    }

    fn top_bar(&self, small: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(16.))
            .h(px(31.4))
            .flex_shrink_0()
            .px(px(16.))
            .border_b_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.sidebar).opacity(0.7))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        Button::new("dossier-exit")
                            .ghost()
                            .small()
                            .text_size(px(11.2))
                            .font_family(TYPEWRITER_FONT)
                            .font_weight(FontWeight::NORMAL)
                            .text_color(rgb(colors.ink_light))
                            .h(px(18.4))
                            .px(px(0.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .font_family(TYPEWRITER_FONT)
                                    .font_weight(FontWeight::NORMAL)
                                    .text_size(px(11.2))
                                    .line_height(px(16.8))
                                    .child("←")
                                    .child(if self.session.options.mode == DossierMode::Create {
                                        "Back home"
                                    } else {
                                        "Back to desk"
                                    }),
                            )
                            .accessibility_label(
                                if self.session.options.mode == DossierMode::Create {
                                    "Back home"
                                } else {
                                    "Back to desk"
                                },
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.cancel(cx))),
                    )
                    .when(
                        self.session.options.mode == DossierMode::Refine
                            && self.capabilities.start_over,
                        |this| {
                            this.child(
                                Button::new("dossier-start-over")
                                    .ghost()
                                    .small()
                                    .text_size(px(9.6))
                                    .font_family(TYPEWRITER_FONT)
                                    .text_color(rgb(colors.ink_muted))
                                    .label("START OVER")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.start_over_confirm = true;
                                        cx.notify();
                                    })),
                            )
                        },
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(9.6))
                    .when(!small, |this| {
                        this.child(
                            div()
                                .id("dossier-surface-caption")
                                .test_support()
                                .mr(px(4.))
                                .text_color(rgb(colors.ink_muted))
                                .child(tracked_typewriter(
                                    "SURFACE:",
                                    9.6,
                                    1.728,
                                    colors.ink_muted,
                                )),
                        )
                    })
                    .child(
                        Button::new("dossier-surface-form")
                            .ghost()
                            .small()
                            .rounded_full()
                            .h(px(18.4))
                            .px(px(10.))
                            .font_family(TYPEWRITER_FONT)
                            .font_weight(FontWeight::NORMAL)
                            .text_size(px(9.6))
                            .bg(rgb(colors.vermilion))
                            .text_color(rgb(colors.paper))
                            .child(tracked_typewriter("Form", 9.6, 1.728, colors.paper))
                            .accessibility_label("Form surface selected"),
                    )
                    .child(
                        Button::new("dossier-surface-conversation")
                            .ghost()
                            .small()
                            .rounded_full()
                            .h(px(18.4))
                            .px(px(10.))
                            .font_family(TYPEWRITER_FONT)
                            .font_weight(FontWeight::NORMAL)
                            .text_size(px(9.6))
                            .text_color(rgb(colors.ink_muted))
                            .child(tracked_typewriter(
                                "Conversation",
                                9.6,
                                1.728,
                                colors.ink_muted,
                            ))
                            .disabled(!self.capabilities.conversation)
                            .accessibility_label("Conversation surface")
                            .on_click(cx.listener(|this, _, _, cx| {
                                let _ = this.flush_recovery(cx);
                                cx.emit(DossierEvent::ConversationRequested {
                                    draft: this.session.draft.clone(),
                                });
                            })),
                    ),
            )
            .into_any_element()
    }

    fn preview(&self, small: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let reviewed = if self.session.options.mode == DossierMode::Refine {
            7
        } else {
            self.session.draft.step.min(7)
        };
        let reviewed_stamp = self
            .reviewed_stamps
            .as_ref()
            .and_then(|set| set.stamp(reviewed))
            .map(|stamp| stamp.element())
            .unwrap_or_else(|| {
                // Preserve the existing readable count if preparation fails.
                // This fallback is deliberately not claimed as rotated parity.
                div()
                    .border_2()
                    .border_color(rgb(colors.vermilion))
                    .rounded(px(2.))
                    .bg(rgb(colors.vermilion).opacity(0.04))
                    .px(px(8.))
                    .py(px(2.4))
                    .font_family(TYPEWRITER_FONT)
                    .text_color(rgb(colors.vermilion))
                    .text_size(px(8.8))
                    .child(tracked_typewriter(
                        &format!("{reviewed} / 7 REVIEWED"),
                        8.8,
                        1.936,
                        colors.vermilion,
                    ))
                    .into_any_element()
            });
        let title = self.answers[0].preview(cx, 120);
        let cards: Vec<_> = (0..7)
            .map(|index| {
                let active = index == self.session.draft.step;
                let value = self.answers[index].preview(cx, 500);
                let missing = value.is_empty();
                Button::new(("dossier-preview-field", index))
                    .ghost()
                    .h_auto()
                    .px(px(10.))
                    .py(px(6.))
                    .rounded(px(0.))
                    .border_1()
                    .border_color(rgb(if active {
                        colors.vermilion
                    } else {
                        colors.rule
                    }))
                    .bg(rgb(if active {
                        colors.paper
                    } else {
                        colors.paper_soft
                    }))
                    .flex_1()
                    .min_w_0()
                    .accessibility_label(format!("Edit {}", FIELD_LABELS[index]))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_start()
                            .w_full()
                            .whitespace_normal()
                            .gap(px(2.))
                            .child(department_sized(FIELD_LABELS[index], 8.8, 2.112, cx))
                            .child(
                                div()
                                    .w_full()
                                    .whitespace_normal()
                                    .font_family(SERIF_FONT)
                                    .text_size(px(12.16))
                                    .line_height(relative(1.35))
                                    .text_color(rgb(colors.ink_light))
                                    .when(!active, |this| this.line_clamp(3))
                                    .when(missing, |this| {
                                        this.italic().text_color(rgb(colors.ink_muted))
                                    })
                                    .child(if missing {
                                        "Not decided yet.".into()
                                    } else {
                                        value
                                    }),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| this.go_to(index, window, cx)))
                    .into_any_element()
            })
            .collect();
        let mut preview = div()
            .id("dossier-preview")
            .test_support()
            .flex()
            .flex_col()
            .min_w_0()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(department(
                                if self.session.options.mode == DossierMode::Refine {
                                    "Edition · Revised"
                                } else {
                                    "Working copy"
                                },
                                cx,
                            ))
                            .child(
                                div()
                                    .mt(px(2.))
                                    .font_family(DISPLAY_FONT)
                                    .font_weight(FontWeight::BOLD)
                                    .text_size(px(18.4))
                                    .line_height(relative(1.25))
                                    .truncate()
                                    .child(if title.trim().is_empty() {
                                        "Untitled dossier".into()
                                    } else {
                                        title
                                    }),
                            ),
                    )
                    .child(reviewed_stamp),
            )
            .child(
                div()
                    .id("dossier-preview-grid")
                    .test_support()
                    .mt(px(12.))
                    .grid()
                    .grid_cols(if small { 1 } else { 2 })
                    .gap(px(6.))
                    .children(cards),
            )
            .child(self.particulars_preview(cx));
        if self.capabilities.read_draft {
            preview = preview.child(
                paper_button("dossier-read-draft", "Read against the draft", cx).on_click(
                    cx.listener(|this, _, _, cx| {
                        let _ = this.flush_recovery(cx);
                        cx.emit(DossierEvent::ReadDraftRequested {
                            draft: this.session.draft.clone(),
                        });
                    }),
                ),
            );
        }
        if !self.session.draft.attachments.is_empty() {
            preview = preview.child(department("References", cx));
            for attachment in &self.session.draft.attachments {
                preview = preview.child(
                    div()
                        .font_family(SERIF_FONT)
                        .text_size(px(12.))
                        .child(attachment.title.clone())
                        .child(
                            div()
                                .italic()
                                .text_color(rgb(colors.ink_light))
                                .child(attachment.why.clone()),
                        ),
                );
            }
        }
        preview.into_any_element()
    }

    fn particulars_preview(&self, cx: &App) -> AnyElement {
        let colors = *theme::palette(cx);
        let probes = &self.session.draft.probes;
        let answered = probes
            .iter()
            .filter(|probe| dossier::is_answered(probe))
            .count();
        let mut summary = div()
            .mt(px(10.))
            .border_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper_soft))
            .px(px(10.))
            .py(px(6.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_baseline()
                    .justify_between()
                    .gap_x(px(12.))
                    .gap_y(px(4.))
                    .child(department_sized("Particulars", 8.8, 2.816, cx))
                    .child(tracked_typewriter(
                        &format!(
                            "{answered}/{} answered · {} words · {} refs",
                            probes.len(),
                            self.material_word_count,
                            self.session.draft.attachments.len()
                        )
                        .to_uppercase(),
                        9.6,
                        1.344,
                        colors.ink_muted,
                    )),
            );
        let mut list = div()
            .mt(px(4.))
            .flex()
            .flex_col()
            .gap(px(2.))
            .font_family(SERIF_FONT)
            .text_size(px(11.2))
            .line_height(relative(1.4))
            .text_color(rgb(colors.ink_muted));
        if probes.is_empty() {
            list = list
                .child("The Particulars questions will sharpen the softest parts of this brief.");
        } else {
            for (index, probe) in probes.iter().enumerate() {
                list = list.child(
                    div()
                        .flex()
                        .gap(px(6.))
                        .child(
                            div()
                                .flex_shrink_0()
                                .font_family(TYPEWRITER_FONT)
                                .text_color(rgb(colors.vermilion))
                                .child(format!("{}.", index + 1)),
                        )
                        .child(div().min_w_0().truncate().child(format!(
                            "{} {}",
                            probe.prompt,
                            if dossier::is_answered(probe) {
                                dossier::probe_answer_text(probe)
                            } else {
                                "Awaiting an answer.".into()
                            }
                        ))),
                );
            }
        }
        summary = summary.child(list);
        summary.into_any_element()
    }

    fn answer_input(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let busy = self.session.filing == FilingState::Filing;
        match &self.answers[index] {
            AnswerControl::Input(state) => {
                let focus = state.focus_handle(cx);
                let focus_rule = canvas(
                    |_, _, _| (),
                    move |bounds, _, window, _| {
                        // Read focus at paint, so blur never leaves an old
                        // focused rule behind on a retained input frame.
                        if focus.is_focused(window) {
                            window.paint_quad(gpui_kit::fill(
                                bounds,
                                linear_gradient(
                                    90.,
                                    linear_color_stop(rgb(colors.vermilion), 0.),
                                    linear_color_stop(rgb(colors.mustard), 1.),
                                ),
                            ));
                        }
                    },
                )
                .absolute()
                .bottom_0()
                .left_0()
                .w_full()
                .h(px(2.));
                div()
                    .relative()
                    .w_full()
                    .key_context("DossierSingleAnswer")
                    .capture_action(
                        cx.listener(move |this, _: &DossierAnswerEnter, window, cx| {
                            cx.stop_propagation();
                            if this.session.draft.step == index {
                                this.next(window, cx);
                            }
                        }),
                    )
                    .child(
                        Input::new(state)
                            .id(SharedString::from(format!("dossier-answer-{index}")))
                            .accessibility_id(format!("dossier-answer-{index}"))
                            .aria_label(STEPS[index].question)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            // Kit's Input::h only affects multiline inputs.
                            // Constrain the actual single-line frame instead.
                            .min_h(px(45.6))
                            .max_h(px(45.6))
                            .px(px(4.))
                            .py(px(8.))
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::MEDIUM)
                            .text_size(px(18.4))
                            .text_color(rgb(colors.ink))
                            .border_b_2()
                            .border_color(rgb(colors.ink))
                            .rounded(px(0.))
                            .disabled(busy),
                    )
                    .child(focus_rule)
                    .into_any_element()
            }
            AnswerControl::Textarea(state) => div()
                .id(SharedString::from(format!("dossier-answer-{index}")))
                .test_support()
                .relative()
                .key_context("DossierTextareaAnswer")
                // The retained text element covers its laid-out lines. The
                // Source textarea also focuses from blank rows and padding.
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, _, window, cx| {
                        if !busy && this.session.draft.step == index {
                            this.answers[index].focus(window, cx);
                            window.prevent_default();
                            cx.stop_propagation();
                        }
                    }),
                )
                .capture_action(
                    cx.listener(move |this, _: &DossierAnswerEnter, window, cx| {
                        cx.stop_propagation();
                        if this.session.draft.step == index {
                            this.next(window, cx);
                        }
                    }),
                )
                .child(
                    Textarea::new(state)
                        .accessibility_id(format!("dossier-answer-{index}"))
                        .aria_label(STEPS[index].question)
                        // Four Source rows at 28px, 12px vertical padding,
                        // and a 1px border on each edge.
                        .h(px(138.))
                        .appearance(false)
                        .bordered(false)
                        .xsmall()
                        .font_family(SERIF_FONT)
                        .text_size(px(16.))
                        .line_height(relative(1.75))
                        .bg(rgb(colors.paper_soft))
                        .border_1()
                        .border_color(rgb(colors.rule))
                        .rounded(px(2.))
                        // Kit adds 4px horizontally for XSmall, and no
                        // vertical padding. The final text inset is 16px.
                        .px(px(12.))
                        .py(px(12.))
                        .disabled(busy),
                )
                .child(textarea_focus_outline(state, cx))
                .into_any_element(),
        }
    }

    fn prior_material_input(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let material = &self.session.draft.prior_material;
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .id("dossier-prior-material")
                    .test_support()
                    .relative()
                    .key_context("DossierMaterial")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, window, cx| {
                            if this.session.draft.step == 8 {
                                this.prior_material
                                    .update(cx, |state, cx| state.focus(window, cx));
                                window.prevent_default();
                                cx.stop_propagation();
                            }
                        }),
                    )
                    .capture_action(cx.listener(|_, _: &DossierMaterialModifiedEnter, _, cx| {
                        cx.stop_propagation();
                    }))
                    .child(
                        Textarea::new(&self.prior_material)
                            .accessibility_id("dossier-prior-material")
                            .aria_label(STEPS[8].question)
                            // Source renders eight rows for prior material.
                            .h(px(250.))
                            .appearance(false)
                            .bordered(false)
                            .xsmall()
                            .font_family(SERIF_FONT)
                            .text_size(px(16.))
                            .line_height(relative(1.75))
                            .bg(rgb(colors.paper_soft))
                            .border_1()
                            .border_color(rgb(colors.rule))
                            .rounded(px(2.))
                            .px(px(12.))
                            .py(px(12.)),
                    )
                    .child(textarea_focus_outline(&self.prior_material, cx)),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        paper_button("dossier-import-material", "Upload a file", cx)
                            .child(assets::icon(TwyneIcon::FileUp))
                            .on_click(
                                cx.listener(|this, _, window, cx| this.upload(false, window, cx)),
                            ),
                    )
                    .when(material.has_material(), |this| {
                        this.child(
                            div()
                                .id("dossier-material-status")
                                .test_support()
                                .role(Role::Status)
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(12.))
                                .text_color(rgb(colors.ink_muted))
                                .aria_label(format!(
                                    "{} · {} words",
                                    material
                                        .imported_filename()
                                        .map(|name| format!("Filed · {name}"))
                                        .unwrap_or_else(|| "Pasted".into()),
                                    self.material_word_count
                                ))
                                .child(format!(
                                    "{} · {} words",
                                    material
                                        .imported_filename()
                                        .map(|name| format!("Filed · {name}"))
                                        .unwrap_or_else(|| "Pasted".into()),
                                    self.material_word_count
                                )),
                        )
                        .child(
                            Button::new("dossier-clear-material")
                                .ghost()
                                .small()
                                .label("Clear")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.clear_material(window, cx)
                                })),
                        )
                    })
                    .when(!material.has_material(), |this| {
                        this.child(
                            div()
                                .font_family(SERIF_FONT)
                                .italic()
                                .text_size(px(12.))
                                .text_color(rgb(colors.ink_muted))
                                .child(".txt, .md, .html accepted — optional"),
                        )
                    }),
            )
            .into_any_element()
    }

    fn probe_inputs(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let mut result = div().flex().flex_col().gap(px(12.))
            .child(div().id("dossier-local-question-status").role(Role::Status).font_family(SERIF_FONT).text_size(px(14.)).text_color(rgb(colors.ink_muted)).child("These questions were prepared on this device from the brief above. They work without an account or provider."));
        for probe in &self.session.draft.probes {
            let id = probe.id.clone();
            let mut group = div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .font_family(SERIF_FONT)
                .text_size(px(14.))
                .child(probe.prompt.clone());
            let mut control = div()
                .border_1()
                .border_color(rgb(colors.rule))
                .bg(rgb(colors.paper_soft))
                .rounded(px(3.))
                .p(px(12.))
                .flex()
                .flex_col()
                .gap(px(8.));
            control = control.child(
                department(
                    match probe.kind {
                        ProbeKind::Choice => "Pick one",
                        ProbeKind::Multi => "Pick any that apply",
                        ProbeKind::Blanks => "Fill in the blanks",
                        ProbeKind::Scale => "Slide to answer",
                    },
                    cx,
                )
                .text_size(px(9.6)),
            );
            match self.probes.get(&id) {
                Some(ProbeControl::Choice) | Some(ProbeControl::Multi(_)) => {
                    let mut options = div().flex().flex_wrap().gap(px(6.));
                    for (index, option) in probe.options.iter().flatten().enumerate() {
                        let chosen = match self.probes.get(&id) { Some(ProbeControl::Multi(selected)) => selected.contains(option), _ => probe.answer.as_ref() == Some(&ProbeAnswer::Text(option.clone())) };
                        let (id, value) = (id.clone(), option.clone());
                        options = options.child(Button::new((SharedString::from(format!("dossier-probe-choice-{id}")), index)).ghost().small().rounded_full().border_1().border_color(rgb(if chosen { colors.vermilion } else { colors.rule })).bg(rgb(if chosen { colors.vermilion } else { colors.paper })).text_color(rgb(if chosen { colors.paper } else { colors.ink })).font_family(SERIF_FONT).text_size(px(12.8)).label(option.clone()).on_click(cx.listener(move |this, _, window, cx| this.choose(&id, value.clone(), window, cx))));
                    }
                    control = control.child(options);
                    if probe.kind == ProbeKind::Multi {
                        let disabled = !matches!(self.probes.get(&id), Some(ProbeControl::Multi(values)) if !values.is_empty());
                        control = control.child(self.probe_confirm(&id, disabled, cx));
                    }
                }
                Some(ProbeControl::Blanks(states)) => {
                    let mut row = div().flex().flex_wrap().items_center().gap(px(6.)).font_family(SERIF_FONT).text_size(px(14.4));
                    let mut states = states.iter().enumerate();
                    for piece in dossier::split_template(probe.template.as_deref().unwrap_or_default()) {
                        row = match piece {
                            TemplatePiece::Text(text) => row.child(text),
                            TemplatePiece::Blank => row.when_some(states.next(), |this, (index, state)| this.child(Input::new(state).id(SharedString::from(format!("dossier-probe-blank-{id}-{index}"))).accessibility_id(format!("dossier-probe-blank-{id}-{index}")).aria_label("Fill in the blank").appearance(false).bordered(false).h(px(32.)).w(px(128.)).font_family(SERIF_FONT).border_b_1().border_color(rgb(colors.vermilion)).rounded(px(0.)))),
                        };
                    }
                    let disabled = !states_have_text(match self.probes.get(&id) { Some(ProbeControl::Blanks(states)) => states, _ => unreachable!() }, cx);
                    control = control.child(row).child(self.probe_confirm(&id, disabled, cx));
                }
                Some(ProbeControl::Scale(state)) => {
                    control = control.child(Slider::new(state).bg(rgb(colors.vermilion)).text_color(rgb(colors.paper)))
                        .child(div().flex().items_center().justify_between().font_family(TYPEWRITER_FONT).text_size(px(10.4)).text_color(rgb(colors.ink_muted))
                            .child(probe.min_label.clone().unwrap_or_else(|| probe.min.unwrap_or(1.0).to_string()))
                            .child(div().text_color(rgb(colors.vermilion)).child(state.read(cx).value().to_string()))
                            .child(probe.max_label.clone().unwrap_or_else(|| probe.max.unwrap_or(5.0).to_string())))
                        .child(self.probe_confirm(&id, false, cx));
                }
                _ => control = control.child(div().id(SharedString::from(format!("dossier-unusable-probe-{id}"))).role(Role::Status).child("This saved question has no usable control. You can continue without answering it.")),
            }
            group = group.child(control);
            result = result.child(group);
        }
        result.into_any_element()
    }

    fn probe_confirm(&self, id: &str, disabled: bool, cx: &mut Context<Self>) -> AnyElement {
        let id = id.to_owned();
        let colors = *theme::palette(cx);
        Button::new(format!("dossier-probe-confirm-{id}"))
            .ghost()
            .small()
            .rounded_full()
            .bg(rgb(colors.vermilion))
            .text_color(rgb(colors.paper))
            .font_family(DISPLAY_FONT)
            .label("Answer")
            .disabled(disabled)
            .on_click(cx.listener(move |this, _, window, cx| this.confirm_probe(&id, window, cx)))
            .into_any_element()
    }

    fn references(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let reference = &self.session.draft.reference;
        let mut result = div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().flex().gap(px(8.)).children(
                [AttachmentKind::Document, AttachmentKind::Link].map(|kind| {
                    Button::new(if kind == AttachmentKind::Document {
                        "dossier-reference-document"
                    } else {
                        "dossier-reference-link"
                    })
                    .ghost()
                    .small()
                    .flex_1()
                    .border_1()
                    .border_color(rgb(if kind == reference.kind {
                        colors.vermilion
                    } else {
                        colors.rule
                    }))
                    .rounded(px(3.))
                    .font_family(TYPEWRITER_FONT)
                    .label(if kind == AttachmentKind::Document {
                        "Document"
                    } else {
                        "Link"
                    })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.sync_session(cx);
                        this.session.draft.reference.kind = kind;
                        this.session.draft.touch();
                        this.changed(window, cx);
                    }))
                }),
            ))
            .child(
                Input::new(&self.reference_title)
                    .id("dossier-reference-title")
                    .accessibility_id("dossier-reference-title")
                    .aria_label("Reference title")
                    .font_family(SERIF_FONT)
                    .bg(rgb(colors.paper_soft))
                    .rounded(px(2.)),
            );
        if reference.kind == AttachmentKind::Link {
            result = result.child(
                Input::new(&self.reference_url)
                    .id("dossier-reference-url")
                    .accessibility_id("dossier-reference-url")
                    .aria_label("Source URL")
                    .font_family(SERIF_FONT)
                    .bg(rgb(colors.paper_soft))
                    .rounded(px(2.)),
            );
        } else {
            result =
                result
                    .child(
                        div()
                            .id("dossier-reference-text")
                            .test_support()
                            .key_context("DossierMaterial")
                            .capture_action(cx.listener(
                                |_, _: &DossierMaterialModifiedEnter, _, cx| {
                                    cx.stop_propagation();
                                },
                            ))
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _, window, cx| {
                                    if this.session.draft.step == 9 {
                                        this.reference_text
                                            .update(cx, |state, cx| state.focus(window, cx));
                                        window.prevent_default();
                                        cx.stop_propagation();
                                    }
                                }),
                            )
                            .child(
                                Textarea::new(&self.reference_text)
                                    .accessibility_id("dossier-reference-text")
                                    .aria_label("Document text")
                                    .h(px(128.))
                                    .font_family(SERIF_FONT)
                                    .text_size(px(14.))
                                    .line_height(relative(1.7))
                                    .bg(rgb(colors.paper_soft))
                                    .rounded(px(2.)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(
                                paper_button("dossier-reference-upload", "Upload a file", cx)
                                    .child(assets::icon(TwyneIcon::FileUp))
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.upload(true, window, cx)
                                    })),
                            )
                            .when(!reference.file_name.is_empty(), |this| {
                                this.child(
                                    div()
                                        .font_family(TYPEWRITER_FONT)
                                        .text_size(px(12.))
                                        .text_color(rgb(colors.ink_muted))
                                        .child(format!("Filed · {}", reference.file_name)),
                                )
                            }),
                    );
            if reference.truncated {
                result = result.child(
                    div()
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(12.))
                        .text_color(rgb(colors.ink_muted))
                        .child("Trimmed to 2000 characters for the dossier."),
                );
            }
        }
        result = result
            .child(
                Input::new(&self.reference_why)
                    .id("dossier-reference-why")
                    .accessibility_id("dossier-reference-why")
                    .aria_label("Why does this reference matter to the piece?")
                    .font_family(SERIF_FONT)
                    .bg(rgb(colors.paper_soft))
                    .rounded(px(2.)),
            )
            .child(
                paper_button("dossier-reference-add", "+ Add to dossier", cx)
                    .on_click(cx.listener(|this, _, window, cx| this.add_reference(window, cx))),
            );
        for attachment in &self.session.draft.attachments {
            let id = attachment.id.clone();
            result = result.child(
                div()
                    .flex()
                    .items_start()
                    .justify_between()
                    .gap(px(12.))
                    .border_1()
                    .border_color(rgb(colors.rule))
                    .rounded(px(2.))
                    .px(px(12.))
                    .py(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .font_family(DISPLAY_FONT)
                            .text_size(px(14.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(format!(
                                "[{}] {}",
                                if attachment.kind == AttachmentKind::Link {
                                    "link"
                                } else {
                                    "doc"
                                },
                                attachment.title
                            ))
                            .child(
                                div()
                                    .mt(px(2.))
                                    .font_family(SERIF_FONT)
                                    .text_size(px(12.))
                                    .font_weight(FontWeight::NORMAL)
                                    .italic()
                                    .text_color(rgb(colors.ink_light))
                                    .child(attachment.why.clone()),
                            )
                            .when_some(attachment.url.clone(), |this, url| {
                                this.child(
                                    div()
                                        .mt(px(4.))
                                        .font_family(TYPEWRITER_FONT)
                                        .text_size(px(11.))
                                        .text_color(rgb(colors.ink_muted))
                                        .truncate()
                                        .child(url),
                                )
                            }),
                    )
                    .child(
                        Button::new(format!("dossier-reference-remove-{id}"))
                            .ghost()
                            .small()
                            .label("×")
                            .accessibility_label(format!("Remove {}", attachment.title))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.session.remove_reference(&id);
                                this.changed(window, cx);
                            })),
                    ),
            );
        }
        result.into_any_element()
    }

    fn ghost(&self, index: Option<usize>, above: bool, cx: &mut Context<Self>) -> AnyElement {
        let Some(index) = index.filter(|index| *index < STEPS.len()) else {
            return div().h(px(20.)).flex_shrink_0().into_any_element();
        };
        let colors = *theme::palette(cx);
        let step = STEPS[index];
        Button::new(if above {
            "dossier-ghost-above"
        } else {
            "dossier-ghost-below"
        })
        .ghost()
        .small()
        .w_full()
        .h(px(20.))
        .px(px(0.))
        .py(px(0.))
        .flex_shrink_0()
        .when(above, |this| this.mb(px(24.)).opacity(0.6))
        .when(!above, |this| this.mt(px(24.)).opacity(0.5))
        .text_size(px(11.2))
        .font_family(SERIF_FONT)
        .text_color(rgb(colors.ink_muted))
        .accessibility_label(format!(
            "{} {}. {}",
            if above { "↑" } else { "↓" },
            step.numeral,
            step.question
        ))
        .child(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(px(3.))
                .child(
                    div()
                        .font_family(TYPEWRITER_FONT)
                        .text_color(rgb(colors.vermilion))
                        .child(format!(
                            "{} {}.",
                            if above { "↑" } else { "↓" },
                            step.numeral
                        )),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(rgb(colors.ink_light))
                        .child({
                            let value = if above {
                                self.answers
                                    .get(index)
                                    .map(|answer| answer.preview(cx, 240))
                                    .unwrap_or_default()
                            } else {
                                String::new()
                            };
                            if value.trim().is_empty() {
                                step.question.to_owned()
                            } else {
                                format!("{} — {}", step.question, value.trim())
                            }
                        }),
                ),
        )
        .on_click(cx.listener(move |this, _, window, cx| this.go_to(index, window, cx)))
        .into_any_element()
    }

    fn footer(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let index = self.session.draft.step;
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .flex_shrink_0()
            .px(px(20.))
            .py(px(10.))
            .border_t_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.sidebar))
            .child(
                paper_button("dossier-back", "← Back", cx)
                    .flex_shrink_0()
                    .disabled(index == 0 || self.session.filing == FilingState::Filing)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.go_to(this.session.draft.step.saturating_sub(1), window, cx)
                    })),
            )
            .child(
                div()
                    .id("dossier-section-rail")
                    .test_support()
                    .role(Role::Navigation)
                    .aria_label("Folio sections")
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap(px(2.))
                    .min_w_0()
                    // The stable keyed Div retains its own scroll offset.
                    // No new view/owner/atlas lease is captured by the rail.
                    .overflow_x_scroll()
                    .restrict_scroll_to_axis()
                    .children(STEPS.iter().enumerate().map(|(step_index, step)| {
                        let selected = index == step_index;
                        let filled = self.session.draft.is_section_filed(step_index);
                        Button::new(("dossier-section", step_index))
                            .flex_shrink_0()
                            .ghost()
                            .small()
                            .h(px(21.52))
                            .px(px(5.12))
                            .rounded(px(0.))
                            .border_b_2()
                            .border_color(if selected {
                                rgb(colors.vermilion).into()
                            } else if filled {
                                rgb(colors.ink_muted).into()
                            } else {
                                gpui_kit::Hsla::transparent_black()
                            })
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(9.6))
                            .text_color(rgb(if selected {
                                colors.vermilion
                            } else {
                                colors.ink_muted
                            }))
                            .child(tracked_text(
                                step.numeral,
                                font(TYPEWRITER_FONT),
                                9.6,
                                0.96,
                                if selected {
                                    colors.vermilion
                                } else {
                                    colors.ink_muted
                                },
                                9.6,
                            ))
                            .accessibility_label(format!("{} · {}", step.numeral, step.department))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.go_to(step_index, window, cx)
                            }))
                    })),
            )
            .child(
                Button::new("dossier-next")
                    .flex_shrink_0()
                    .ghost()
                    .small()
                    .rounded(px(2.))
                    .border_1()
                    .border_color(rgb(colors.ink))
                    .bg(rgb(colors.ink))
                    .text_color(rgb(colors.paper))
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(11.2))
                    .h(px(36.4))
                    .px(px(16.))
                    .accessibility_label(if self.session.filing == FilingState::Filing {
                        "Sending…"
                    } else if index == 9 {
                        "Send to press"
                    } else {
                        "Next"
                    })
                    .child(tracked_typewriter(
                        if self.session.filing == FilingState::Filing {
                            "SENDING…"
                        } else if index == 9 {
                            "SEND TO PRESS"
                        } else {
                            "NEXT"
                        },
                        11.2,
                        2.016,
                        colors.paper,
                    ))
                    .disabled(self.session.filing == FilingState::Filing)
                    .on_click(cx.listener(|this, _, window, cx| this.next(window, cx))),
            )
            .into_any_element()
    }
}

fn states_have_text(states: &[Entity<InputState>], cx: &App) -> bool {
    states.iter().any(|state| {
        state
            .read(cx)
            .text()
            .chars()
            .any(|character| !character.is_whitespace())
    })
}
fn department(label: impl Into<SharedString>, cx: &App) -> gpui_kit::Div {
    div().child(department_sized(label, 10., 3.2, cx))
}
fn department_sized(
    label: impl Into<SharedString>,
    size: f32,
    tracking: f32,
    cx: &App,
) -> AnyElement {
    tracked_typewriter(
        &label.into().to_uppercase(),
        size,
        tracking,
        theme::palette(cx).ink_muted,
    )
}
fn paper_button(id: &'static str, label: &'static str, cx: &App) -> Button {
    let colors = *theme::palette(cx);
    Button::new(id)
        .ghost()
        .small()
        .rounded(px(2.))
        .h(px(32.))
        .px(px(14.4))
        .border_1()
        .border_color(rgb(colors.rule))
        .bg(rgb(colors.paper_soft))
        .font_family(SANS_FONT)
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(12.))
        .label(label)
}

fn textarea_focus_outline(state: &Entity<TextareaState>, cx: &App) -> impl IntoElement {
    let focus = state.focus_handle(cx);
    let color = rgb(theme::palette(cx).vermilion);
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            if focus.is_focused(window) {
                window.paint_quad(gpui_kit::quad(
                    bounds,
                    px(2.),
                    gpui_kit::transparent_black(),
                    px(1.),
                    color,
                    gpui_kit::BorderStyle::default(),
                ));
            }
        },
    )
    .absolute()
    .size_full()
    .inset_0()
}

impl Render for DossierView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *theme::palette(cx);
        // Tailwind's unmodified `sm` breakpoint is inclusive at 640px.
        let small = window.viewport_size().width < px(640.);
        let index = self.session.draft.step;
        let step = STEPS[index];
        let content = match step.kind {
            StepKind::Input | StepKind::Textarea => self.answer_input(index, cx),
            StepKind::Probes => self.probe_inputs(cx),
            StepKind::Import => self.prior_material_input(cx),
            StepKind::Attachments => self.references(cx),
        };
        let question = div()
            .id("dossier-active-question")
            .test_support()
            .relative()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .items_baseline()
                    .gap(px(12.))
                    .child(
                        div()
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::BOLD)
                            .italic()
                            .text_size(px(40.))
                            .line_height(relative(1.0))
                            .text_color(rgb(colors.vermilion))
                            .child(format!("{}.", step.numeral)),
                    )
                    .child(
                        div()
                            .id("dossier-question")
                            .test_support()
                            .role(Role::Heading)
                            .aria_label(step.question)
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(22.4))
                            .line_height(relative(1.25))
                            .text_color(rgb(colors.ink))
                            .child(step.question),
                    ),
            )
            .child(
                div()
                    .ml(px(48.))
                    .mt(px(6.))
                    .font_family(SERIF_FONT)
                    .italic()
                    .text_size(px(13.6))
                    .line_height(relative(1.76))
                    .text_color(rgb(colors.ink_light))
                    .child(step.hint),
            )
            .child(div().mt(px(16.)).child(content))
            .when(step.field == Some(BriefField::Format), |this| {
                let query = self.answers[1].preview(cx, 80).to_lowercase();
                let suggestions: Vec<_> = WRITING_FORMAT_SUGGESTIONS
                    .iter()
                    .filter(|form| form.to_lowercase().contains(&query))
                    .take(6)
                    .enumerate()
                    .map(|(index, form)| {
                        let form = *form;
                        Button::new(("dossier-format-suggestion", index))
                            .ghost()
                            .small()
                            .font_family(SERIF_FONT)
                            .label(form)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                if let AnswerControl::Input(state) = &this.answers[1] {
                                    state.update(cx, |state, cx| state.set_value(form, window, cx));
                                }
                                this.changed(window, cx);
                            }))
                    })
                    .collect();
                this.child(
                    div()
                        .mt(px(8.))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(11.2))
                        .text_color(rgb(colors.ink_muted))
                        .child("Start typing to filter the list, or enter your own form."),
                )
                .child(div().flex().flex_wrap().gap(px(2.)).children(suggestions))
            });
        let leaf = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(rgb(colors.paper))
            .child(
                div()
                    .px(px(20.))
                    .pt(px(12.))
                    .flex_shrink_0()
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .justify_between()
                            .gap(px(12.))
                            // Match the Source shrink/clip boundary.
                            // The tracked child does not implement CSS ellipsis.
                            .child(department(step.department, cx).min_w_0().overflow_hidden())
                            .child(
                                department(format!("Folio {} of 10", index + 1), cx)
                                    .flex_shrink_0(),
                            ),
                    )
                    .child(
                        div()
                            .mt(px(6.))
                            .h(px(3.))
                            .overflow_hidden()
                            .bg(rgb(colors.sidebar))
                            .child(div().h_full().w(relative((index + 1) as f32 / 10.)).bg(
                                linear_gradient(
                                    90.,
                                    linear_color_stop(rgb(colors.vermilion), 0.),
                                    linear_color_stop(rgb(colors.mustard), 1.),
                                ),
                            )),
                    ),
            )
            .child(
                div()
                    .id("dossier-question-leaf")
                    .test_support()
                    .overflow_hidden()
                    .flex_1()
                    .min_h_0()
                    .relative()
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .id("dossier-question-scroll")
                            .test_support()
                            .overflow_y_scroll()
                            .child(
                                div()
                                    .id("dossier-question-sheet")
                                    .test_support()
                                    // Resolve equal free space in native layout on
                                    // the first draw, retaining the actual question.
                                    // Natural tall content grows and scrolls.
                                    .min_h_full()
                                    .flex()
                                    .flex_col()
                                    .px(px(20.))
                                    .py(px(16.))
                                    .child(self.ghost(index.checked_sub(1), true, cx))
                                    .child(div().flex_1().min_h_0())
                                    .child(question.flex_shrink_0())
                                    .child(div().flex_1().min_h_0())
                                    .child(self.ghost(Some(index + 1), false, cx)),
                            ),
                    ),
            )
            .child(self.footer(cx));
        let mut frame = div()
            .id("dossier-frame")
            .test_support()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper))
            .child(self.top_bar(small, cx));
        for (index, error) in [self.error.as_ref(), self.session.recovery_error.as_ref()]
            .into_iter()
            .flatten()
            .enumerate()
        {
            frame = frame.child(
                div()
                    .id(("dossier-error", index))
                    .test_support()
                    .role(Role::Alert)
                    .px(px(16.))
                    .py(px(8.))
                    .font_family(SERIF_FONT)
                    .text_size(px(13.))
                    .bg(rgb(colors.paper_soft))
                    .text_color(rgb(colors.vermilion))
                    .child(error.clone()),
            );
        }
        if self.start_over_confirm {
            frame = frame.child(
                div()
                    .border_b_1()
                    .border_color(rgb(colors.vermilion))
                    .p(px(12.))
                    .bg(rgb(colors.paper_soft))
                    .font_family(SERIF_FONT)
                    .text_size(px(14.))
                    .child("Start the Dossier over? Your manuscript will travel with you.")
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .mt(px(8.))
                            .child(
                                paper_button("dossier-start-over-cancel", "Keep the dossier", cx)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.start_over_confirm = false;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                paper_button("dossier-start-over-confirm", "Start over", cx)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        let _ = this.flush_recovery(cx);
                                        this.start_over_confirm = false;
                                        cx.emit(DossierEvent::StartOverRequested {
                                            draft: this.session.draft.clone(),
                                        });
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }
        if self.session.filing == FilingState::Filed {
            frame = frame.child(
                div()
                    .id("dossier-filed-status")
                    .test_support()
                    .role(Role::Status)
                    .p(px(12.))
                    .font_family(TYPEWRITER_FONT)
                    .text_color(rgb(colors.vermilion))
                    .child("Dossier saved to this folio"),
            );
        }
        let wide = window.viewport_size().width >= px(1024.);
        frame = frame.child(
            div()
                .id("dossier-leaf-body")
                .test_support()
                .flex()
                .when(!wide, |this| this.flex_col())
                .flex_1()
                .min_w_0()
                .min_h_0()
                .overflow_hidden()
                .child(
                    div()
                        .id("dossier-left-leaf")
                        .test_support()
                        .when(wide, |this| this.w(relative(1. / 2.02)).border_r_1())
                        .when(!wide, |this| this.h(px(220.)).border_b_1())
                        .min_w_0()
                        .min_h_0()
                        .overflow_y_scroll()
                        .border_color(rgb(colors.rule))
                        .px(px(20.))
                        .py(px(16.))
                        .bg(linear_gradient(
                            165.,
                            linear_color_stop(rgb(colors.paper_soft), 0.),
                            linear_color_stop(rgb(colors.sidebar), 1.),
                        ))
                        .child(self.preview(small, cx)),
                )
                .child(leaf),
        );
        div()
            .id("dossier-form")
            .test_support()
            .key_context("Dossier")
            .track_focus(&self.focus_handle)
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(rgb(colors.paper))
            .on_action(cx.listener(|this, _: &DossierBack, window, cx| {
                this.go_to(this.session.draft.step.saturating_sub(1), window, cx)
            }))
            .on_action(cx.listener(|this, _: &DossierNext, window, cx| this.next(window, cx)))
            .on_action(cx.listener(|this, _: &DossierCancel, _, cx| this.cancel(cx)))
            .relative()
            .when_some(self.paper.clone(), |root, paper| {
                root.child(paper.background())
            })
            .child(
                // Source's 92rem cap includes this wrapper's own gutters.
                // Keep full-viewport paper/leases on the outer positioned root.
                div()
                    .id("dossier-folio-wrapper")
                    .test_support()
                    .w_full()
                    .max_w(px(1472.))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .px(px(if small { 12. } else { 20. }))
                    .py(px(if small { 12. } else { 16. }))
                    .child(frame),
            )
            .when_some(self.foxing_overlay(), |root, overlay| root.child(overlay))
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use crate::dossier::{DossierOptions, PriorMaterial};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size,
    };
    use std::sync::{Arc, Mutex};
    use tempfile::{TempDir, tempdir};

    fn form(
        cx: &mut TestAppContext,
        mut options: DossierOptions,
    ) -> (AnyWindowHandle, Entity<DossierView>, TempDir) {
        let directory = tempdir().unwrap();
        options = options.with_recovery_directory(directory.path());
        let session = DossierSession::open(options, timestamp()).unwrap();
        let (window, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            crate::theme::apply(cx).unwrap();
            init(cx);
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1280.), px(1040.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| cx.new(|cx| DossierView::new(session, window, cx)),
            )
            .unwrap()
        });
        (window, view, directory)
    }

    fn events(
        cx: &mut TestAppContext,
        view: &Entity<DossierView>,
    ) -> Arc<Mutex<Vec<DossierEvent>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let receiver = events.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &DossierEvent, _| {
                receiver.lock().unwrap().push(event.clone());
            })
            .detach();
        });
        events
    }

    #[gpui_kit::test]
    fn source_modified_enter_reads_unblurred_answers_and_keeps_prior_material(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        cx.update_window(handle, |_, window, cx| {
            // Focus the regressions: modified single-line Enter, Source's
            // Ctrl/Meta+Shift advance, and a combined modifier dispatch.
            for (key, index, next, text) in [
                ("shift-enter", 0, 1, "A final unblurred title!"),
                ("alt-enter", 0, 1, "A final unblurred title!"),
                ("ctrl-cmd-alt-shift-enter", 0, 1, "A final unblurred title!"),
                (
                    "ctrl-shift-enter",
                    2,
                    3,
                    "One reader\nkeeps the final character!",
                ),
                (
                    "cmd-shift-enter",
                    2,
                    3,
                    "One reader\nkeeps the final character!",
                ),
                (
                    "ctrl-alt-enter",
                    2,
                    3,
                    "One reader\nkeeps the final character!",
                ),
            ] {
                view.update(cx, |view, cx| view.go_to(index, window, cx));
                window.render_frame(cx);
                window.click(SharedString::from(format!("dossier-answer-{index}")), cx);
                window.press("secondary-a", cx);
                window.input(text, cx);
                window.press(key, cx);
                assert_eq!(
                    view.read(cx).session.draft.step,
                    next,
                    "Source answer {key}"
                );
                assert_eq!(
                    dossier::answer(&view.read(cx).session.draft.answers, ANSWER_FIELDS[index]),
                    text,
                    "Source answer {key}"
                );
            }
            view.update(cx, |view, cx| view.go_to(2, window, cx));
            window.render_frame(cx);
            window.click("dossier-answer-2", cx);
            window.press("secondary-a", cx);
            window.input("Ordinary newline", cx);
            window.press("shift-enter", cx);
            assert_eq!(view.read(cx).session.draft.step, 2);
            assert_eq!(view.read(cx).answers[2].text(cx), "Ordinary newline\n");

            view.update(cx, |view, cx| view.go_to(8, window, cx));
            window.render_frame(cx);
            window.click("dossier-prior-material", cx);
            window.press("secondary-a", cx);
            window.input("Prior material keeps the final character!", cx);
            for key in [
                "ctrl-enter",
                "ctrl-shift-enter",
                "cmd-enter",
                "cmd-shift-enter",
            ] {
                window.press(key, cx);
                assert_eq!(view.read(cx).session.draft.step, 8, "Prior material {key}");
                assert_eq!(
                    view.read(cx).prior_material.read(cx).text().to_string(),
                    "Prior material keeps the final character!",
                    "Prior material {key}"
                );
            }
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn keyboard_and_roman_navigation_flush_writing_and_focus_each_section(cx: &mut TestAppContext) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("dossier-left-leaf").visible());
            assert!(window.find("dossier-preview").visible());
            window.click("dossier-answer-0", cx);
            window.press("secondary-a", cx);
            window.input("The native writing room", cx);
            window.press("enter", cx);
        })
        .unwrap();
        // The Source-shaped answer binding advances and flushes the actual
        // retained field before the next user event.
        cx.update_window(handle, |_, window, cx| {
            assert_eq!(view.read(cx).session.draft.step, 1);
            assert_eq!(
                view.read(cx).session.draft.answers.working_title,
                "The native writing room"
            );
            // Enter moved focus to the next input, so the next edit needs no click.
            window.press("secondary-a", cx);
            window.input("A personal essay", cx);
            window.press("alt-right", cx);
            assert_eq!(view.read(cx).session.draft.step, 2);
            assert_eq!(
                view.read(cx).session.draft.answers.format,
                "A personal essay"
            );
            window.press("secondary-a", cx);
            window.input("Readers who need one\nclear account", cx);
            window.press("enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            assert_eq!(view.read(cx).session.draft.step, 2);
            window.press("secondary-enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            assert_eq!(view.read(cx).session.draft.step, 3);
            assert!(
                view.read(cx)
                    .session
                    .draft
                    .answers
                    .audience
                    .contains("clear account")
            );
            for (index, step) in STEPS.iter().enumerate() {
                window.click(("dossier-section", index), cx);
                assert_eq!(view.read(cx).session.draft.step, index);
                assert_eq!(window.find("dossier-question").label(), Some(step.question));
            }
            assert_eq!(window.find("dossier-next").label(), Some("Send to press"));
            window.click(("dossier-preview-field", 0_usize), cx);
            assert_eq!(view.read(cx).session.draft.step, 0);
        })
        .unwrap();
        let restored = cx.update(|cx| {
            DossierSession::open(view.read(cx).session.options.clone(), timestamp()).unwrap()
        });
        assert!(restored.restored);
        assert_eq!(
            restored.draft.answers.working_title,
            "The native writing room"
        );
        assert_eq!(restored.draft.answers.format, "A personal essay");
    }

    #[gpui_kit::test]
    fn immediate_departure_recovers_typed_material_and_unadded_reference(cx: &mut TestAppContext) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(("dossier-section", 8_usize), cx);
            window.input("Pasted prose with café and 東京.", cx);
            window.click(("dossier-section", 9_usize), cx);
            window.input("A reference being prepared", cx);
            window.click("dossier-reference-text", cx);
            window.input("Original supporting evidence.", cx);
            window.click("dossier-reference-why", cx);
            window.input("Keep this claim grounded.", cx);
            window.click(("dossier-section", 8_usize), cx);
            assert_eq!(
                window.find("dossier-material-status").label(),
                Some("Pasted · 6 words")
            );
            window.click(("dossier-section", 9_usize), cx);
            // Depart before the quiet-period writer runs. The controls, rather
            // than their possibly queued Change events, are the source here.
            window.click("dossier-exit", cx);
        })
        .unwrap();
        assert!(matches!(
            received.lock().unwrap().as_slice(),
            [DossierEvent::Cancelled]
        ));
        let restored = cx.update(|cx| {
            DossierSession::open(view.read(cx).session.options.clone(), timestamp()).unwrap()
        });
        assert!(restored.restored);
        assert_eq!(restored.draft.step, 9);
        assert_eq!(
            restored.draft.prior_material.text,
            "Pasted prose with café and 東京."
        );
        assert_eq!(restored.draft.reference.title, "A reference being prepared");
        assert_eq!(
            restored.draft.reference.text,
            "Original supporting evidence."
        );
        assert_eq!(restored.draft.reference.why, "Keep this claim grounded.");
        assert!(restored.draft.attachments.is_empty());
    }

    #[gpui_kit::test]
    fn particular_controls_and_reference_filing_emit_a_real_brief(cx: &mut TestAppContext) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(("dossier-section", 7_usize), cx);
            window.click("dossier-probe-blank-local-particular-reader-change-0", cx);
            window.input("uncertain", cx);
            window.click("dossier-probe-blank-local-particular-reader-change-1", cx);
            window.input("ready", cx);
            window.click("dossier-probe-confirm-local-particular-reader-change", cx);
            window.click(
                (
                    SharedString::from("dossier-probe-choice-local-particular-goal"),
                    1_usize,
                ),
                cx,
            );
            window.click("dossier-probe-confirm-local-particular-protection", cx);
            window.click(("dossier-section", 9_usize), cx);
            window.input("First-hand source", cx);
            window.click("dossier-reference-text", cx);
            window.input("The evidence supplied by the writer.", cx);
            window.click("dossier-reference-add", cx);
            assert!(view.read(cx).session.draft.attachments.is_empty());
            assert!(view.read(cx).error.is_some());
            window.click("dossier-reference-why", cx);
            window.input("Protect the central claim.", cx);
            window.click("dossier-reference-add", cx);
            assert_eq!(view.read(cx).session.draft.attachments.len(), 1);
            assert_eq!(view.read(cx).reference_title.read(cx).text().len(), 0);
            window.click("dossier-next", cx);
        })
        .unwrap();
        let captured = received.lock().unwrap();
        let [DossierEvent::FilingRequested { token, submission }] = captured.as_slice() else {
            panic!("Expected one filing event, got {captured:?}");
        };
        assert_eq!(*token, 1);
        assert_eq!(submission.mode, DossierMode::Create);
        assert!(submission.prior_material.is_none());
        let brief = &submission.brief;
        assert_eq!(brief.probes.as_ref().unwrap().len(), 3);
        assert_eq!(
            brief.probes.as_ref().unwrap()[0].answer,
            Some(ProbeAnswer::Texts(vec!["uncertain".into(), "ready".into()]))
        );
        assert_eq!(
            brief.probes.as_ref().unwrap()[1].answer,
            Some(ProbeAnswer::Text("Change a belief".into()))
        );
        assert_eq!(
            brief.probes.as_ref().unwrap()[2].answer,
            Some(ProbeAnswer::Number(3.0))
        );
        assert_eq!(brief.attachments[0].title, "First-hand source");
        assert_eq!(brief.attachments[0].why, "Protect the central claim.");
        assert_eq!(
            brief.attachments[0].text.as_deref(),
            Some("The evidence supplied by the writer.")
        );
    }

    #[gpui_kit::test]
    fn failed_filing_can_retry_and_only_acknowledgement_clears_exact_source_recovery(
        cx: &mut TestAppContext,
    ) {
        let source = "#let untouched(x) = x\r\n\r\n= Authored source\r\n";
        let (handle, view, _directory) = form(
            cx,
            DossierOptions {
                initial_material: PriorMaterial {
                    text: source.into(),
                    typst_source: Some(source.into()),
                    ..PriorMaterial::default()
                },
                ..DossierOptions::default()
            },
        );
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(("dossier-section", 9_usize), cx);
            window.click("dossier-next", cx);
            assert_eq!(view.read(cx).session.filing, FilingState::Filing);
            let first_token = view.read(cx).filing_token().unwrap();
            view.update(cx, |this, cx| {
                assert!(this.report_filing_error(first_token, "Disk unavailable", window, cx));
            });
            assert_eq!(view.read(cx).session.filing, FilingState::Idle);
            assert!(
                view.read(cx)
                    .session
                    .options
                    .recovery
                    .as_ref()
                    .unwrap()
                    .path()
                    .exists()
            );
            window.click("dossier-next", cx);
            let retry_token = view.read(cx).filing_token().unwrap();
            assert_ne!(retry_token, first_token);
            view.update(cx, |this, cx| {
                assert!(!this.acknowledge_filed(first_token, cx).unwrap());
                assert!(!this.report_filing_error(first_token, "Old disk error", window, cx));
            });
            assert!(
                view.read(cx)
                    .session
                    .options
                    .recovery
                    .as_ref()
                    .unwrap()
                    .path()
                    .exists()
            );
            assert_eq!(view.read(cx).session.filing, FilingState::Filing);
            view.update(cx, |this, cx| {
                assert!(this.acknowledge_filed(retry_token, cx).unwrap());
                assert!(!this.acknowledge_filed(retry_token, cx).unwrap());
            });
            window.render_frame(cx);
            assert_eq!(view.read(cx).session.filing, FilingState::Filed);
            assert!(window.find("dossier-filed-status").visible());
        })
        .unwrap();
        let captured = received.lock().unwrap();
        assert_eq!(captured.len(), 2);
        for event in captured.iter() {
            let DossierEvent::FilingRequested {
                submission:
                    DossierSubmission {
                        prior_material: Some(material),
                        ..
                    },
                ..
            } = event
            else {
                panic!("Expected filing to carry its source: {event:?}");
            };
            assert_eq!(material.canonical_seed_source(), Some(source));
            assert!(!material.edited);
        }
        cx.update(|cx| {
            assert!(
                !view
                    .read(cx)
                    .session
                    .options
                    .recovery
                    .as_ref()
                    .unwrap()
                    .path()
                    .exists()
            )
        });
        cx.executor().advance_clock(Duration::from_millis(351));
        while cx.executor().tick() {}
        cx.update(|cx| {
            assert!(
                !view
                    .read(cx)
                    .session
                    .options
                    .recovery
                    .as_ref()
                    .unwrap()
                    .path()
                    .exists()
            )
        });
    }

    #[gpui_kit::test]
    fn quiet_period_saves_control_edits_without_a_navigation_click(cx: &mut TestAppContext) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("dossier-answer-0", cx);
            window.press("secondary-a", cx);
            window.input("Saved while writing", cx);
        })
        .unwrap();
        while cx.executor().tick() {}
        cx.executor().advance_clock(Duration::from_millis(351));
        while cx.executor().tick() {}
        cx.update(|cx| {
            let session = &view.read(cx).session;
            let saved = session
                .options
                .recovery
                .as_ref()
                .unwrap()
                .load(timestamp())
                .unwrap()
                .unwrap();
            assert_eq!(saved.answers.working_title, "Saved while writing");
            assert_eq!(saved.step, 0);
        });
    }

    #[gpui_kit::test]
    fn delayed_import_preserves_edits_even_before_the_native_change_event_is_delivered(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        for reference in [false, true] {
            cx.update_window(handle, |_, window, cx| {
                view.update(cx, |this, cx| {
                    let ticket = this.begin_import(reference, cx).unwrap();
                    let control = if reference {
                        &this.reference_text
                    } else {
                        &this.prior_material
                    };
                    control.update(cx, |state, cx| {
                        state.set_value("Writer's latest 東京\r\n", window, cx)
                    });
                    assert!(!this.finish_import(
                        ticket,
                        Ok(PriorMaterial {
                            text: "Stale imported file".into(),
                            ..PriorMaterial::default()
                        }),
                        window,
                        cx,
                    ));
                    assert_eq!(
                        if reference {
                            this.reference_text.read(cx).text().to_string()
                        } else {
                            this.prior_material.read(cx).text().to_string()
                        },
                        "Writer's latest 東京\r\n"
                    );
                    this.flush_recovery(cx).unwrap();
                    assert_eq!(
                        this.session
                            .options
                            .recovery
                            .as_ref()
                            .unwrap()
                            .load(timestamp())
                            .unwrap(),
                        Some(this.session.draft.clone())
                    );
                });
            })
            .unwrap();
        }
    }

    #[gpui_kit::test]
    fn newer_import_ignores_an_old_success_and_error_then_accepts_its_own_file(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |this, cx| {
                let old = this.begin_import(false, cx).unwrap();
                let current = this.begin_import(false, cx).unwrap();
                let before = this.session.draft.clone();
                assert!(!this.finish_import(
                    old,
                    Ok(PriorMaterial {
                        text: "Old file".into(),
                        ..PriorMaterial::default()
                    }),
                    window,
                    cx
                ));
                assert!(!this.finish_import(
                    old,
                    Err(anyhow::anyhow!("Old picker failed")),
                    window,
                    cx
                ));
                assert_eq!(this.session.draft, before);
                assert!(this.error.is_none());
                assert_eq!(this.import_request, Some(current));
                assert!(this.finish_import(
                    current,
                    Ok(PriorMaterial {
                        text: "Accepted current file 東京".into(),
                        ..PriorMaterial::default()
                    }),
                    window,
                    cx
                ));
                assert_eq!(
                    this.prior_material.read(cx).text().to_string(),
                    "Accepted current file 東京"
                );
                assert_eq!(
                    this.session.draft.prior_material.text,
                    "Accepted current file 東京"
                );
                assert!(!this.finish_import(
                    current,
                    Err(anyhow::anyhow!("Duplicate failure")),
                    window,
                    cx
                ));
                assert!(this.error.is_none());
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn filing_and_retirement_invalidate_delayed_imports_without_recreating_recovery(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _directory) = form(cx, DossierOptions::default());
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |this, cx| {
                let ticket = this.begin_import(true, cx).unwrap();
                this.go_to(9, window, cx);
                this.next(window, cx);
                let token = this.filing_token().unwrap();
                let filed = this.session.draft.clone();
                assert!(!this.finish_import(
                    ticket,
                    Ok(PriorMaterial {
                        text: "File returned during filing".into(),
                        ..PriorMaterial::default()
                    }),
                    window,
                    cx
                ));
                assert_eq!(this.session.draft, filed);
                assert!(this.acknowledge_filed(token, cx).unwrap());
                let path = this.session.options.recovery.as_ref().unwrap().path();
                assert!(!path.exists());
                this.retire().unwrap();
                assert!(!this.finish_import(
                    ticket,
                    Err(anyhow::anyhow!("Late import error")),
                    window,
                    cx
                ));
                this.flush_recovery(cx).unwrap();
                assert!(!path.exists());
                assert!(this.error.is_none());
                assert!(this.begin_import(false, cx).is_none());
            });
        })
        .unwrap();
    }

    mod layout_correction {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/dossier-layout-correction/mounted_tests.rs"
        ));
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/dossier-layout-correction/optional_tests.rs"
        ));
    }
}

#[cfg(all(
    test,
    feature = "ui-tests",
    any(target_os = "linux", target_os = "freebsd")
))]
#[path = "../fixtures/dossier-multiply/product-mount/parent-layout-adoption/parent-test-adoption/product_mount_tests.rs"]
mod product_multiply_mount_tests;
