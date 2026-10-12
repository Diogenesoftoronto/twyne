use super::*;
use chrono::Timelike;
use gpui_kit::EntityId;
use std::{collections::BTreeSet, time::Instant};
use twyne_desktop::{
    editor::EditDelta,
    flow::{
        self, FlowContext, FlowMode, FlowPreferences, FlowReading, FlowRecord, FlowSampler,
        FlowSaveRequest, FlowSessionEnd, FlowSnapshot, FlowStore, KeySample, SessionSummaryInput,
    },
    flow_view::FlowRibbonView,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum RoomPart {
    Masthead,
    Compositor,
    Drawer,
    Board,
}
impl RoomPart {
    const ALL: [Self; 4] = [Self::Masthead, Self::Compositor, Self::Drawer, Self::Board];
    fn index(self) -> usize {
        self as usize
    }
    fn id(self) -> &'static str {
        match self {
            Self::Masthead => "flow-masthead",
            Self::Compositor => "flow-compositor",
            Self::Drawer => "flow-drawer",
            Self::Board => "flow-board",
        }
    }
}

struct SessionStart {
    at: u64,
    words: usize,
}

struct Rhythm {
    folio: Uuid,
    editor: EntityId,
    samples: FlowSampler,
    mode: FlowMode,
    reading: Option<FlowReading>,
    last_key_at: Option<u64>,
    run_recorded: bool,
    reaching: bool,
    auto_focus: bool,
    override_until: u64,
    session: Option<SessionStart>,
}
impl Rhythm {
    fn new(folio: Uuid, editor: EntityId) -> Self {
        Self {
            folio,
            editor,
            samples: FlowSampler::default(),
            mode: FlowMode::Working,
            reading: None,
            last_key_at: None,
            run_recorded: true,
            reaching: false,
            auto_focus: false,
            override_until: 0,
            session: None,
        }
    }
}

#[derive(Clone)]
struct PendingWrite {
    request: FlowSaveRequest,
    at: u64,
    profile_revision: u64,
    preferences: Option<FlowPreferences>,
}

struct ChromeFade {
    from: f32,
    to: f32,
    started: Instant,
    duration: Duration,
}
impl ChromeFade {
    fn current(&self) -> f32 {
        let progress =
            (self.started.elapsed().as_secs_f32() / self.duration.as_secs_f32()).clamp(0., 1.);
        let eased = gpui_kit::base::animation::cubic_bezier(0.25, 0.1, 0.25, 1.)(progress);
        self.from + (self.to - self.from) * eased
    }
}

/// The saved record is always an actual disk acknowledgement. The working
/// profile may advance while a writer is in flight, without changing its base.
pub(super) struct FlowState {
    store: Option<FlowStore>,
    saved: FlowRecord,
    working: FlowRecord,
    profile_revision: u64,
    saved_profile_revision: u64,
    pending: Option<PendingWrite>,
    rhythm: Option<Rhythm>,
    faulted_editor: Option<EntityId>,
    pub(super) ribbon: Entity<FlowRibbonView>,
    ticker: Option<Task<()>>,
    room_hover: BTreeSet<RoomPart>,
    reach_since: Option<u64>,
    room_focus: [FocusHandle; 4],
    focus_switch: FocusHandle,
    fades: [ChromeFade; 4],
    cover_lookup_preference: bool,
    settings_error: Option<String>,
    pub(super) error: Option<String>,
    #[cfg(feature = "ui-tests")]
    clock: Option<u64>,
}

impl FlowState {
    pub(super) fn load(store: &Store, cx: &mut Context<WritingRoom>) -> (Self, Vec<String>) {
        let loaded = FlowStore::open(store.root()).and_then(|store| {
            let loaded = store.load()?;
            Ok((store, loaded))
        });
        let (store, record, warnings) = match loaded {
            Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
            Err(error) => (
                None,
                FlowRecord::default(),
                vec![format!("Writing rhythm could not be opened: {error:#}")],
            ),
        };
        let cover_lookup_preference = record
            .to_value()
            .ok()
            .is_none_or(|value| value["settings"]["flow-cover-lookups"].as_bool() != Some(false));
        (
            Self {
                store,
                saved: record.clone(),
                working: record,
                profile_revision: 0,
                saved_profile_revision: 0,
                pending: None,
                rhythm: None,
                faulted_editor: None,
                ribbon: cx.new(|_| FlowRibbonView::new()),
                ticker: None,
                room_hover: BTreeSet::new(),
                reach_since: None,
                room_focus: std::array::from_fn(|_| cx.focus_handle()),
                focus_switch: cx.focus_handle(),
                fades: std::array::from_fn(|_| ChromeFade {
                    from: 1.,
                    to: 1.,
                    started: Instant::now(),
                    duration: Duration::from_millis(200),
                }),
                cover_lookup_preference,
                settings_error: None,
                error: None,
                #[cfg(feature = "ui-tests")]
                clock: None,
            },
            warnings,
        )
    }

    fn now(&self) -> u64 {
        #[cfg(feature = "ui-tests")]
        if let Some(now) = self.clock {
            return now;
        }
        timestamp()
    }

    fn dirty(&self) -> bool {
        self.profile_revision != self.saved_profile_revision
    }

    fn replace_profile(&mut self, profile: flow::FlowProfile) {
        if profile != self.working.profile {
            self.working.profile = profile;
            self.profile_revision = self.profile_revision.saturating_add(1);
        }
    }

    fn acknowledge(&mut self, pending: &PendingWrite, saved: FlowRecord) {
        let profile = self.working.profile.clone();
        let sessions = self.working.sessions.clone();
        let advanced = self.profile_revision != pending.profile_revision;
        self.saved = saved.clone();
        self.working = saved;
        if advanced {
            self.working.profile = profile;
            self.working.sessions = sessions;
        }
        self.saved_profile_revision = pending.profile_revision;
        self.pending = None;
        self.error = None;
        if pending.preferences.is_some() {
            self.settings_error = None;
        }
    }
}

fn save_flow(store: &FlowStore, pending: &PendingWrite) -> anyhow::Result<FlowRecord> {
    match store.save_request(&pending.request, pending.at) {
        Ok(record) => Ok(record),
        Err(error) => match store.acknowledge_request(&pending.request, pending.at)? {
            Some(record) => Ok(record),
            None => Err(error),
        },
    }
}

/// Matches the original countWords character set, including punctuation-only
/// words and the deliberate absence of other Unicode whitespace separators.
fn session_words(text: &str) -> usize {
    let mut words = 0;
    let mut in_word = false;
    for character in text.chars() {
        if matches!(
            character,
            ' ' | '\t' | '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{a0}'
        ) {
            in_word = false;
        } else if !in_word {
            words += 1;
            in_word = true;
        }
    }
    words
}

impl WritingRoom {
    pub(super) fn margin_flow_context(&self, cx: &App) -> (bool, FlowMode, f64, u64) {
        let enabled = self.flow.store.is_some() && self.flow.saved.preferences.flow_enabled();
        (
            enabled,
            self.flow.ribbon.read(cx).snapshot().mode,
            flow::kind_weight(&self.flow.working.profile, "comment"),
            self.flow.now(),
        )
    }

    pub(super) fn record_margin_flow_outcome(&mut self, outcome: flow::ItemOutcome) {
        let profile = flow::record_item(
            &self.flow.working.profile,
            "comment",
            outcome,
            self.flow.now() as f64,
        );
        self.flow.replace_profile(profile);
    }

    pub(super) fn start_flow_ticker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flow.ticker.is_some() {
            return;
        }
        self.flow.ticker = Some(cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(flow::FLOW_TICK_MS))
                    .await;
                if this
                    .update_in(cx, |this, window, cx| this.flow_tick(window, cx))
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    fn flow_editor(&self, cx: &App) -> Option<(Uuid, EntityId)> {
        if self.flow.store.is_none()
            || !self.flow.saved.preferences.flow_enabled()
            || self.standalone_route()
            || self.dossier.is_some()
            || self.source_mode
            || (self.proof_mode && !self.split_view)
            || self.reading
            || self.active_document().archived
        {
            return None;
        }
        self.rich.as_ref().and_then(|editor| {
            (!editor.read(cx).is_read_only()
                && self.flow.faulted_editor != Some(editor.entity_id()))
            .then_some((self.active, editor.entity_id()))
        })
    }

    pub(super) fn sync_flow_presence(&mut self, cx: &mut Context<Self>) {
        let eligible = self.flow_editor(cx);
        let current = self
            .flow
            .rhythm
            .as_ref()
            .map(|rhythm| (rhythm.folio, rhythm.editor));
        if current == eligible {
            return;
        }
        self.finish_flow_session(FlowSessionEnd::Closed, cx);
        self.flow.rhythm = eligible.map(|(folio, editor)| Rhythm::new(folio, editor));
        self.flow.room_hover.clear();
        self.flow.reach_since = None;
        self.publish_flow(cx);
    }

    /// Called before replacing a rich editor, so the closing slip counts that
    /// editor's live document rather than the newly selected folio.
    pub(super) fn detach_flow(&mut self, cx: &mut Context<Self>) {
        self.finish_flow_session(FlowSessionEnd::Closed, cx);
        self.flow.rhythm = None;
        self.flow.faulted_editor = None;
        self.flow.room_hover.clear();
        self.flow.reach_since = None;
        self.publish_flow(cx);
    }

    pub(super) fn accept_flow_input(
        &mut self,
        sender: &Entity<RichEditorView>,
        delta: EditDelta,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        self.sync_flow_presence(cx);
        if self.flow_editor(cx) != Some((self.active, sender.entity_id()))
            || !sender.read(cx).focus_handle(cx).is_focused(window)
            || delta.inserted_utf16 == 0 && delta.deleted_utf16 == 0
        {
            return;
        }
        let now = self.flow.now();
        let threshold = flow::thresholds_for(&self.flow.working.profile).gap_ms;
        let rhythm = self.flow.rhythm.as_mut().unwrap();
        if let Err(error) = rhythm.samples.push(KeySample {
            at: now as f64,
            inserted: delta.inserted_utf16 as f64,
            deleted: delta.deleted_utf16 as f64,
        }) {
            // Invalid/out-of-order or saturated evidence cannot produce a
            // trustworthy reading. Keep the manuscript and stop this detector.
            self.detach_flow(cx);
            self.flow.faulted_editor = Some(sender.entity_id());
            self.flow.error = Some(format!(
                "Writing rhythm stopped ({error:?}). Your writing is still saved normally."
            ));
            return;
        }
        let previous_key = rhythm.last_key_at;
        rhythm.last_key_at = Some(now);
        rhythm.run_recorded = false;
        rhythm.reaching = false;
        if let Some(previous) = previous_key
            && now.saturating_sub(previous) as f64 > threshold
        {
            self.flow.replace_profile(flow::record_pause(
                &self.flow.working.profile,
                now.saturating_sub(previous) as f64,
                now as f64,
            ));
        }
        // No text extraction, serialization, file I/O or classification here.
    }

    fn flow_document_words(&self, cx: &App) -> usize {
        self.rich.as_ref().map_or(0, |editor| {
            session_words(&editor.read(cx).document().text_between_blocks())
        })
    }

    fn finish_flow_session(&mut self, ended: FlowSessionEnd, cx: &mut Context<Self>) {
        let Some(rhythm) = self.flow.rhythm.as_mut() else {
            return;
        };
        let Some(session) = rhythm.session.take() else {
            return;
        };
        let folio = rhythm.folio.to_string();
        let now = self.flow.now();
        if let Some(session) = flow::summarize_session(&SessionSummaryInput {
            folio_id: folio,
            started_at: session.at as f64,
            ended_at: now as f64,
            start_words: session.words as f64,
            end_words: self.flow_document_words(cx) as f64,
            waited: BTreeSet::new(),
            amendments: BTreeSet::new(),
            ended,
        }) {
            // No invented held cards/amendments: those producers are not yet
            // connected to the native conductor.
            self.flow.working.sessions =
                flow::append_session(&self.flow.working.sessions, session, 30);
            self.flow.profile_revision = self.flow.profile_revision.saturating_add(1);
        }
    }

    fn interacting_with_flow_room(&self, window: &Window, cx: &App) -> bool {
        self.flow
            .room_focus
            .iter()
            .any(|focus| focus.contains_focused(window, cx))
    }

    fn flow_tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_flow_presence(cx);
        // The pinned GPUI platform reports presented visibility, including
        // minimize/occlusion. Match document.hidden without conflating it with
        // keyboard focus: a visible but inactive window may still read a pause.
        if self.flow.rhythm.is_none() || !window.is_visible() {
            return;
        }
        let now = self.flow.now();
        let thresholds = flow::thresholds_for(&self.flow.working.profile);
        let interacting = self.interacting_with_flow_room(window, cx);
        if self
            .flow
            .reach_since
            .is_some_and(|at| now.saturating_sub(at) >= flow::REACH_DWELL_MS)
        {
            self.flow.rhythm.as_mut().unwrap().reaching = true;
            self.flow.reach_since = None;
        }
        let rhythm = self.flow.rhythm.as_mut().unwrap();
        let previous = rhythm.mode;
        let reading = rhythm.samples.read(
            now as f64,
            previous,
            &thresholds,
            FlowContext {
                reaching: rhythm.reaching || interacting,
                ..FlowContext::default()
            },
        );
        let record_run = !rhythm.run_recorded && reading.pause_ms > thresholds.gap_ms;
        if record_run {
            rhythm.run_recorded = true;
        }
        rhythm.mode = reading.mode;
        rhythm.reading = Some(reading.clone());
        if record_run {
            let hour = chrono::Local::now().hour() as u8;
            if let Ok(profile) =
                flow::record_run(&self.flow.working.profile, reading.run_ms, now as f64, hour)
            {
                self.flow.replace_profile(profile);
            }
        }
        if previous != reading.mode {
            if reading.mode == FlowMode::Flow {
                // This offline host uses the original local decision without
                // Jev. Whole-document word extraction occurs once on entry.
                let words = self.flow_document_words(cx);
                let rhythm = self.flow.rhythm.as_mut().unwrap();
                rhythm
                    .session
                    .get_or_insert(SessionStart { at: now, words });
                rhythm.auto_focus = now >= rhythm.override_until;
                self.flow.replace_profile(flow::record_flow_entry(
                    &self.flow.working.profile,
                    reading.run_ms,
                    now as f64,
                ));
            } else if previous == FlowMode::Flow {
                self.finish_flow_session(
                    if reading.mode == FlowMode::Away {
                        FlowSessionEnd::Away
                    } else if interacting || self.flow.rhythm.as_ref().is_some_and(|r| r.reaching) {
                        FlowSessionEnd::Reached
                    } else {
                        FlowSessionEnd::Pause
                    },
                    cx,
                );
                self.flow.rhythm.as_mut().unwrap().auto_focus = false;
            }
        }
        self.publish_flow(cx);
        if now % 15_000 < flow::FLOW_TICK_MS && self.flow.dirty() {
            self.request_flow_save(None, window, cx);
        }
        cx.notify();
    }

    fn publish_flow(&self, cx: &mut Context<Self>) {
        let snapshot = self
            .flow
            .rhythm
            .as_ref()
            .map_or_else(FlowSnapshot::default, |rhythm| FlowSnapshot {
                enabled: true,
                mode: rhythm.mode,
                reading: rhythm.reading.clone(),
            });
        self.flow
            .ribbon
            .update(cx, |view, cx| view.set_snapshot(snapshot, cx));
    }

    pub(super) fn release_flow(&mut self, cx: &mut Context<Self>) -> bool {
        if !self
            .flow
            .rhythm
            .as_ref()
            .is_some_and(|rhythm| rhythm.mode == FlowMode::Flow || rhythm.auto_focus)
        {
            return false;
        }
        self.finish_flow_session(FlowSessionEnd::Reached, cx);
        let rhythm = self.flow.rhythm.as_mut().unwrap();
        rhythm.reaching = true;
        rhythm.mode = FlowMode::Working;
        rhythm.auto_focus = false;
        if let Some(reading) = &mut rhythm.reading {
            reading.mode = FlowMode::Working;
        }
        self.publish_flow(cx);
        cx.notify();
        true
    }

    pub(super) fn flow_manual_focus(&mut self, on: bool, cx: &mut Context<Self>) {
        let Some(rhythm) = self.flow.rhythm.as_ref() else {
            return;
        };
        let overridden = rhythm.auto_focus && !on;
        let now = self.flow.now();
        if !on {
            self.finish_flow_session(FlowSessionEnd::Manual, cx);
            let rhythm = self.flow.rhythm.as_mut().unwrap();
            rhythm.reaching = true;
            rhythm.mode = FlowMode::Working;
            if let Some(reading) = &mut rhythm.reading {
                reading.mode = FlowMode::Working;
            }
        }
        let rhythm = self.flow.rhythm.as_mut().unwrap();
        rhythm.auto_focus = false;
        if overridden {
            rhythm.override_until = now.saturating_add(flow::MANUAL_OVERRIDE_MS);
            self.flow.replace_profile(flow::record_override(
                &self.flow.working.profile,
                now as f64,
            ));
        }
        self.publish_flow(cx);
    }

    pub(super) fn flow_pointer_moved(&mut self, y: f32) {
        self.flow.reach_since =
            (!self.flow.room_hover.is_empty() || y < 48.).then(|| self.flow.now());
    }

    pub(super) fn sync_flow_chrome(&mut self, window: &Window, cx: &App) {
        let mode = self.flow.rhythm.as_ref().map(|rhythm| rhythm.mode);
        for part in RoomPart::ALL {
            let target = if self.flow.room_hover.contains(&part)
                || self.flow.room_focus[part.index()].contains_focused(window, cx)
            {
                1.
            } else {
                match (mode, part) {
                    (Some(FlowMode::Flow), _) => 0.12,
                    (Some(FlowMode::Settling), RoomPart::Masthead | RoomPart::Compositor) => 0.4,
                    _ => 1.,
                }
            };
            let fade = &mut self.flow.fades[part.index()];
            if fade.to != target {
                let from = fade.current();
                *fade = ChromeFade {
                    from,
                    to: target,
                    started: Instant::now(),
                    duration: Duration::from_millis(if target == 1. { 200 } else { 1_200 }),
                };
            }
        }
        if !cx.reduce_motion()
            && self
                .flow
                .fades
                .iter()
                .any(|fade| fade.from != fade.to && fade.started.elapsed() < fade.duration)
        {
            window.request_animation_frame();
        }
    }

    pub(super) fn flow_chrome(
        &self,
        part: RoomPart,
        element: impl IntoElement,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        div()
            .id(part.id())
            .test_support()
            .track_focus(&self.flow.room_focus[part.index()])
            .flex_shrink_0()
            .when(matches!(part, RoomPart::Drawer | RoomPart::Board), |this| {
                this.h_full()
            })
            .on_hover(cx.listener(move |this, hovering, _, cx| {
                if *hovering {
                    this.flow.room_hover.insert(part);
                    this.flow.reach_since = Some(this.flow.now());
                } else {
                    this.flow.room_hover.remove(&part);
                    if this.flow.room_hover.is_empty() {
                        this.flow.reach_since = None;
                    }
                }
                cx.notify();
            }))
            .child(element)
            // Keep interactive descendants at the same element path throughout
            // a fade. Adding/removing an animation parent can drop a button's
            // pressed state between its native mouse-down and mouse-up frames.
            .opacity(if cx.reduce_motion() {
                self.flow.fades[part.index()].to
            } else {
                self.flow.fades[part.index()].current()
            })
            .into_any_element()
    }

    fn request_flow_save(
        &mut self,
        preferences: Option<FlowPreferences>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.flow.pending.is_some() || !self.flow.dirty() && preferences.is_none() {
            return;
        }
        let Some(store) = self.flow.store.clone() else {
            return;
        };
        let mut candidate = self.flow.working.clone();
        if let Some(preferences) = preferences {
            candidate.preferences = preferences;
        }
        let pending = PendingWrite {
            request: self.flow.saved.request(candidate),
            at: self.flow.now(),
            profile_revision: self.flow.profile_revision,
            preferences,
        };
        self.flow.pending = Some(pending.clone());
        self.flow.error = None;
        if preferences.is_some() {
            self.flow.settings_error = None;
        }
        let library = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let submitted = pending.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _library_lock = library;
                    save_flow(&store, &submitted)
                })
                .await;
            let _ = this.update_in(cx, |this, _, cx| {
                if this
                    .flow
                    .pending
                    .as_ref()
                    .map(|pending| pending.request.request_id)
                    != Some(pending.request.request_id)
                {
                    return;
                }
                match result {
                    Ok(saved) => {
                        this.flow.acknowledge(&pending, saved);
                        this.sync_flow_presence(cx);
                    }
                    Err(error) => {
                        this.flow.pending = None;
                        if pending.preferences.is_some() {
                            this.flow.settings_error =
                                Some("Could not save this setting. Try again.".into());
                        } else {
                            this.flow.error = Some(format!(
                                "Could not save writing rhythm: {error:#}. Try saving again."
                            ));
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn flush_flow(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        loop {
            let pending = self.flow.pending.clone().or_else(|| {
                self.flow.dirty().then(|| PendingWrite {
                    request: self.flow.saved.request(self.flow.working.clone()),
                    at: self.flow.now(),
                    profile_revision: self.flow.profile_revision,
                    preferences: None,
                })
            });
            let Some(pending) = pending else {
                return Ok(());
            };
            let Some(store) = self.flow.store.as_ref() else {
                return Ok(());
            };
            match save_flow(store, &pending) {
                Ok(saved) => {
                    self.flow.acknowledge(&pending, saved);
                    self.sync_flow_presence(cx);
                }
                Err(error) => {
                    // Keep working evidence and the pending request for a real
                    // retry. A preference remains unpublished until durable.
                    self.flow.pending = Some(pending);
                    self.flow.error = Some(format!(
                        "Could not save writing rhythm: {error:#}. Try saving again."
                    ));
                    cx.notify();
                    return Err(error);
                }
            }
        }
    }

    pub(super) fn close_flow(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        self.finish_flow_session(FlowSessionEnd::Closed, cx);
        self.flush_flow(cx)
    }

    pub(super) fn retry_flow(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        if self.flow.faulted_editor.take().is_some() {
            self.flow.error = None;
            self.sync_flow_presence(cx);
        }
        self.flush_flow(cx)
    }

    #[cfg(feature = "ui-tests")]
    pub(super) fn replay_flow_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.flow.ticker = None;
        self.flow.clock = Some(60_000);
        self.focus_writing(window, cx);
        if let Some(editor) = &self.rich {
            editor.update(cx, |editor, cx| {
                let _ = editor.set_selection(
                    Selection::caret(editor.document().text_len().saturating_sub(1)),
                    cx,
                );
            });
        }
        cx.spawn_in(window, async move |this, cx| {
            for second in 0..=90 {
                let result = this.update_in(cx, |this, window, cx| {
                    this.flow.clock = Some(60_000 + second * 1_000);
                    this.sync_flow_presence(cx);
                    let editor = this.rich.clone().ok_or_else(|| {
                        anyhow::anyhow!("Flow capture needs an editable rich folio.")
                    })?;
                    editor.update(cx, |editor, cx| {
                        editor.execute(
                            twyne_desktop::editor::Command::InsertText(" x".into()),
                            window,
                            cx,
                        )
                    })?;
                    anyhow::Ok(())
                });
                if !matches!(result, Ok(Ok(()))) {
                    eprintln!("TWYNE_CAPTURE_FLOW_ERROR: {result:?}");
                    return;
                }
                // Let the actual focused Input subscription run before reading
                // its next clock value. This never assigns a mode/snapshot.
                cx.background_executor()
                    .timer(Duration::from_millis(5))
                    .await;
                if this
                    .update_in(cx, |this, window, cx| this.flow_tick(window, cx))
                    .is_err()
                {
                    return;
                }
            }
            let _ = this.update_in(cx, |this, _, cx| {
                let valid = this.flow.rhythm.as_ref().is_some_and(|rhythm| {
                    rhythm.mode == FlowMode::Flow
                        && rhythm
                            .reading
                            .as_ref()
                            .is_some_and(|reading| reading.run_ms == 90_000.)
                });
                if valid {
                    eprintln!("TWYNE_CAPTURE_FLOW_READY");
                } else {
                    eprintln!("TWYNE_CAPTURE_FLOW_ERROR: actual edit replay did not reach flow");
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn open_writing_tools(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route()
            || self.dossier.is_some()
            || self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        self.desk.open_linked_panel(BoardContext::Tools);
        window.focus(&self.flow.room_focus[RoomPart::Board.index()], cx);
        cx.notify();
    }

    fn change_automatic_focus(&mut self, on: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.flow.store.is_none()
            || self.flow.pending.is_some()
            || self.flow.saved.preferences.live_review_enabled == Some(false)
        {
            return;
        }
        let mut preferences = self.flow.saved.preferences;
        preferences.flow_reading_enabled = Some(on);
        self.request_flow_save(Some(preferences), window, cx);
        cx.notify();
    }

    pub(super) fn writing_tools_panel(&self, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let colors = *palette(cx);
        let preferences = self
            .flow
            .pending
            .as_ref()
            .filter(|pending| pending.preferences.is_some())
            .map_or(self.flow.saved.preferences, |pending| {
                pending.request.candidate.preferences
            });
        let ready = self.flow.store.is_some();
        let saving = self.flow.pending.is_some();
        let review_on = preferences.live_review_enabled != Some(false);
        let rows = [
            (
                "automatic-review",
                "Automatic review",
                review_on,
                false,
                "Automatic review is not connected in this build.",
            ),
            (
                "margin-tools",
                "Margin tools",
                preferences.tools_enabled(),
                false,
                "Margin tools are not connected in this build.",
            ),
            (
                "automatic-focus",
                "Automatic focus",
                preferences.flow_reading_enabled != Some(false),
                true,
                "Read the rhythm of your typing: go quiet and into focus while you're writing steadily, and bring help in when you stall.",
            ),
            (
                "cover-lookups",
                "Cover lookups",
                self.flow.cover_lookup_preference,
                false,
                "Cover lookups are not connected in this build.",
            ),
        ];
        div().id("writing-tools-panel").test_support().h_full().flex().flex_col()
            .bg(rgb(colors.sidebar))
            .child(div().flex().justify_end().flex_shrink_0()
                .px(px(16.)).pt(px(8.)).pb(px(12.))
                .child(gpui_kit::base::Button::new("review-guide")
                    .role(Role::Link).accessibility_label("Review guide")
                    .flex().items_center().h(px(18.)).gap(px(6.4))
                    .font_family(SANS_FONT).text_size(px(12.)).line_height(px(18.))
                    .text_color(rgb(colors.ink_light))
                    .child(assets::icon(assets::TwyneIcon::Page))
                    .child(div().underline().child("Review guide"))
                    .on_click(|_, _, cx| cx.open_url("https://twyne.love/help/review/"))))
            .child(div().id("review-controls").test_support().role(Role::Group)
                .aria_label("Review settings").flex_shrink_0().px(px(16.)).pt(px(4.)).pb(px(12.))
                .border_b_1().border_color(rgb(colors.rule))
                .children(rows.into_iter().map(|(id, label, on, supported, title)| {
                    let disabled = !ready || saving || !supported || id != "automatic-review" && !review_on;
                    let room = cx.weak_entity();
                    gpui_kit::base::Switch::new(id).checked(on).disabled(disabled)
                        .when(supported, |this| this.track_focus(&self.flow.focus_switch))
                        .accessibility_label(label).flex().items_center().gap(px(8.)).w_full()
                        .min_h(px(44.)).rounded(px(3.)).text_color(rgb(colors.ink_light))
                        .font_family(SANS_FONT).text_size(px(14.)).line_height(px(19.6))
                        .opacity(if disabled { 0.55 } else { 1. })
                        .when(!disabled, |this| this.cursor_pointer()
                            .hover(|style| style.bg(rgb(colors.paper_soft)).text_color(rgb(colors.ink))))
                        .tooltip(move |window, cx| gpui_kit::component::tooltip::Tooltip::new(
                            if !review_on && id != "automatic-review" { "Turn on automatic review first." } else { title }
                        ).build(window, cx))
                        .child(div().flex_1().min_w_0().child(label))
                        .child(div().text_size(px(12.)).line_height(px(16.8)).child(if on { "On" } else { "Off" }))
                        .child(div().w(px(36.)).h(px(20.)).p(px(2.)).flex_shrink_0().rounded_full()
                            .border_1().border_color(rgb(if on { colors.vermilion_deep } else { colors.ink_light }))
                            .bg(rgb(if on { colors.vermilion_deep } else { colors.rule }))
                            .child(div().size(px(14.)).rounded_full()
                                .ml(px(if on { 16. } else { 0. }))
                                .bg(rgb(if on { colors.paper_soft } else { colors.ink_light }))))
                        .on_change(move |on, _, window, cx| {
                            if supported {
                                let _ = room.update(cx, |room, cx| room.change_automatic_focus(on, window, cx));
                            }
                        })
                }))
                .child(Button::new("review-ai-settings").ghost().h_auto().min_h(px(32.))
                    .px(px(0.)).justify_start().rounded_none()
                    .child(div().w_full().font_family(SANS_FONT).text_size(px(12.)).line_height(px(16.8))
                        .underline().text_color(rgb(colors.ink_light)).child("AI settings"))
                    .disabled(true).tooltip("Model settings are not connected in this build."))
                .when_some(self.flow.settings_error.clone(), |this, error| {
                    this.child(div().id("review-controls-error").test_support().role(Role::Alert)
                        .font_family(SANS_FONT).text_size(px(12.)).line_height(px(18.))
                        .text_color(rgb(colors.vermilion)).child(error))
                }))
            .child(div().px(px(16.)).py(px(12.)).font_family(SANS_FONT).text_size(px(12.))
                .line_height(px(18.)).text_color(rgb(colors.ink_muted))
                .child("Automatic focus is available offline. Review, margin tools and cover lookup are still being ported."))
            .into_any_element()
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use tempfile::TempDir;

    fn writing_room(
        cx: &mut TestAppContext,
    ) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
        let result = super::super::tests::room(cx);
        let path = result.2.root().join("Flow folio.html");
        std::fs::write(&path, "<p>Opening.</p>").unwrap();
        let document = import_file(&path).unwrap();
        cx.update_window(result.0, |_, window, cx| {
            result.1.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                // A test clock changes time, never the mode or detector data.
                // The same production input subscription and tick read it.
                room.flow.clock = Some(60_000);
                room.flow.ticker = None;
                room.desk.set_zen(false, false);
                room.desk.preferences.compositor_open = true;
                room.focus_writing(window, cx);
            });
            window.activate_window();
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
        result
    }

    fn type_at(
        handle: AnyWindowHandle,
        room: &Entity<WritingRoom>,
        now: u64,
        text: &str,
        cx: &mut TestAppContext,
    ) {
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, _| room.flow.clock = Some(now));
            window.input(text, cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| room.flow_tick(window, cx));
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
    }

    fn steady_run(handle: AnyWindowHandle, room: &Entity<WritingRoom>, cx: &mut TestAppContext) {
        for second in 0..=90 {
            type_at(handle, room, 60_000 + second * 1_000, "word ", cx);
        }
    }

    #[test]
    fn boundary_words_use_the_original_js_character_set() {
        assert_eq!(session_words("\u{a0}é 😀\t...\r\n中 文\u{2003}x"), 5);
        let rich = RichDocument::from_html(
            "<p>A<img src='data:image/png;base64,YQ==' alt='not words'>B<br>C</p><p>D</p>",
        )
        .unwrap();
        assert_eq!(rich.text_between_blocks(), "ABC D");
        assert_eq!(session_words(&rich.text_between_blocks()), 2);
    }

    #[gpui_kit::test]
    fn real_focused_edits_drive_flow_without_moving_the_page_and_escape_releases_it(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = writing_room(cx);
        let before = cx.update(|cx| {
            let room = room.read(cx);
            assert!(room.flow.ribbon.read(cx).snapshot().enabled);
            (
                room.desk.zen,
                room.desk.preferences,
                room.desk.drawer_open,
                room.desk.board_open,
            )
        });
        let before_page = cx
            .update_window(handle, |_, window, _| {
                window.find("manuscript-page-canvas").bounds()
            })
            .unwrap();
        steady_run(handle, &room, cx);
        cx.update_window(handle, |_, window, cx| {
            let state = room.read(cx);
            let rhythm = state.flow.rhythm.as_ref().unwrap();
            // TestWindowExt types each of the five characters separately.
            assert_eq!(rhythm.samples.len(), 91 * 5);
            assert_eq!(rhythm.mode, FlowMode::Flow);
            assert_eq!(
                state.flow.ribbon.read(cx).snapshot().label(),
                "in flow · 1 min"
            );
            assert_eq!(rhythm.reading.as_ref().unwrap().run_ms, 90_000.);
            assert_eq!(state.flow.fades[RoomPart::Masthead.index()].to, 0.12);
            assert_eq!(state.flow.fades[RoomPart::Compositor.index()].to, 0.12);
            assert_eq!(
                (
                    state.desk.zen,
                    state.desk.preferences,
                    state.desk.drawer_open,
                    state.desk.board_open
                ),
                before
            );
            assert!(window.find("masthead").visible());
            assert!(window.find("flow-ribbon").visible());
            assert_eq!(window.find("manuscript-page-canvas").bounds(), before_page);
            window.press("escape", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert_eq!(room.flow.rhythm.as_ref().unwrap().mode, FlowMode::Working);
                assert!(room.desk.preferences.compositor_open);
                room.flush_on_shutdown(cx).unwrap();
                assert_eq!(room.flow.saved.profile.flow_entries, vec![90_000.]);
                assert!(room.flow.error.is_none());
            });
            window.render_frame(cx);
            assert!(window.find("compositor-ribbon").visible());
        })
        .unwrap();
        let loaded = FlowStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(loaded.profile.flow_entries, vec![90_000.]);
    }

    #[gpui_kit::test]
    fn equal_length_replacement_counts_and_room_focus_source_and_readonly_do_not_type(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory) = writing_room(cx);
        cx.update_window(handle, |_, window, cx| {
            let rich = room.read(cx).rich.clone().unwrap();
            rich.update(cx, |editor, cx| {
                editor
                    .set_selection(Selection { anchor: 0, head: 2 }, cx)
                    .unwrap();
            });
            window.input("😀", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            let sample = room
                .read(cx)
                .flow
                .rhythm
                .as_ref()
                .unwrap()
                .samples
                .last()
                .unwrap();
            assert_eq!((sample.inserted, sample.deleted), (2., 2.));
            room.update(cx, |room, cx| room.show_find(window, cx));
            window.render_frame(cx);
            window.input("Changing the search", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert_eq!(room.flow.rhythm.as_ref().unwrap().samples.len(), 1);
                room.set_reading(true, cx);
                room.focus_writing(window, cx);
            });
            window.render_frame(cx);
            window.input("Read-only edit", cx);
            assert!(!room.read(cx).flow.ribbon.read(cx).snapshot().enabled);
            room.update(cx, |room, cx| room.set_write(window, cx));
            window.render_frame(cx);
            room.update(cx, |room, cx| room.set_source(window, cx));
            window.render_frame(cx);
            window.input("// source edit", cx);
            assert!(!room.read(cx).flow.ribbon.read(cx).snapshot().enabled);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update(|cx| assert!(room.read(cx).flow.rhythm.is_none()));
    }

    #[gpui_kit::test]
    fn pending_flow_save_joins_on_close_and_keeps_newer_profile_evidence(cx: &mut TestAppContext) {
        let (handle, room, store, _directory) = writing_room(cx);
        cx.update_window(handle, |_, _, cx| {
            room.update(cx, |room, cx| {
                room.flow.replace_profile(flow::record_pause(
                    &room.flow.working.profile,
                    8_000.,
                    61_000.,
                ));
                let pending = PendingWrite {
                    request: room.flow.saved.request(room.flow.working.clone()),
                    at: 61_000,
                    profile_revision: room.flow.profile_revision,
                    preferences: None,
                };
                let flow_store = room.flow.store.clone().unwrap();
                flow_store
                    .save_request(&pending.request, pending.at)
                    .unwrap();
                room.flow.pending = Some(pending);
                room.flow.replace_profile(flow::record_pause(
                    &room.flow.working.profile,
                    9_000.,
                    62_000.,
                ));
                room.flush_on_shutdown(cx).unwrap();
                assert_eq!(room.flow.saved.generation, 2);
                assert_eq!(room.flow.saved.profile.pauses, vec![8_000., 9_000.]);
                assert!(!room.flow.dirty());
                assert!(room.flow.pending.is_none());
            });
        })
        .unwrap();
        let record = FlowStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(record.generation, 2);
        assert_eq!(record.profile.pauses, vec![8_000., 9_000.]);
    }

    #[gpui_kit::test]
    fn actual_flow_write_failure_keeps_profile_and_blocks_close_until_retry(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = writing_room(cx);
        std::fs::create_dir(store.root().join("flow.json")).unwrap();
        cx.update_window(handle, |_, _, cx| {
            room.update(cx, |room, cx| {
                room.flow.replace_profile(flow::record_pause(
                    &room.flow.working.profile,
                    8_000.,
                    61_000.,
                ));
                assert!(room.flush_on_shutdown(cx).is_err());
                assert_eq!(room.flow.saved.generation, 0);
                assert_eq!(room.flow.working.profile.pauses, vec![8_000.]);
                assert!(room.flow.dirty());
                assert!(room.flow.pending.is_some());
                assert!(
                    room.flow
                        .error
                        .as_ref()
                        .unwrap()
                        .contains("Could not save writing rhythm")
                );
            });
        })
        .unwrap();
        std::fs::remove_dir(store.root().join("flow.json")).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("secondary-s", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let saved = FlowStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(saved.generation, 1);
        assert_eq!(saved.profile.pauses, vec![8_000.]);
        cx.update(|cx| assert!(room.read(cx).flow.error.is_none()));
    }

    #[gpui_kit::test]
    fn automatic_focus_switch_publishes_only_after_disk_ack_and_rolls_back_failure(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = writing_room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.click("toggle-library", cx);
            window.render_frame(cx);
            window.scroll(
                "drawer-content",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-650.))),
                cx,
            );
            window.click("drawer-tools", cx);
            window.render_frame(cx);
            assert_eq!(window.find("automatic-focus").role(), Some(Role::Switch));
            assert_eq!(window.find("automatic-focus").checked(), Some(true));
            window.click("automatic-review", cx);
            window.click("cover-lookups", cx);
            assert!(room.read(cx).flow.pending.is_none());
            assert_eq!(room.read(cx).flow.saved.generation, 0);
            window.click("automatic-focus", cx);
            let state = room.read(cx);
            assert!(state.flow.pending.is_some());
            assert_eq!(state.flow.saved.preferences.flow_reading_enabled, None);
            assert!(state.flow.ribbon.read(cx).snapshot().enabled);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("automatic-focus").checked(), Some(false));
            assert!(!room.read(cx).flow.ribbon.read(cx).snapshot().enabled);
            let focus = room.read(cx).flow.focus_switch.clone();
            window.focus(&focus, cx);
            window.press("space", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let saved = FlowStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(saved.generation, 2);
        assert_eq!(saved.preferences.flow_reading_enabled, Some(true));
        let bytes = std::fs::read(store.root().join("flow.json")).unwrap();
        // A real backup-path conflict fails before replacing the primary.
        std::fs::remove_file(store.root().join("flow.json.bak")).unwrap();
        std::fs::create_dir(store.root().join("flow.json.bak")).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("automatic-focus", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("automatic-focus").checked(), Some(true));
            assert_eq!(
                window.find("review-controls-error").role(),
                Some(Role::Alert)
            );
            assert!(room.read(cx).flow.pending.is_none());
            assert_eq!(room.read(cx).flow.saved.generation, 2);
            assert!(room.read(cx).flow.ribbon.read(cx).snapshot().enabled);
        })
        .unwrap();
        assert_eq!(
            std::fs::read(store.root().join("flow.json")).unwrap(),
            bytes
        );
        std::fs::remove_dir(store.root().join("flow.json.bak")).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.click("automatic-focus", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let saved = FlowStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(saved.generation, 3);
        assert_eq!(saved.preferences.flow_reading_enabled, Some(false));
        cx.update(|cx| assert!(room.read(cx).flow.settings_error.is_none()));
    }

    #[gpui_kit::test]
    fn hidden_window_pauses_detection_and_visible_inactive_window_can_read_the_pause(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory) = writing_room(cx);
        type_at(handle, &room, 60_000, "a", cx);
        cx.simulate_window_visibility_change(handle, gpui_kit::WindowVisibility::Hidden);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.flow.clock = Some(300_000);
                room.flow_tick(window, cx);
                assert_eq!(room.flow.rhythm.as_ref().unwrap().mode, FlowMode::Working);
            });
        })
        .unwrap();
        cx.simulate_window_visibility_change(handle, gpui_kit::WindowVisibility::Visible);
        let other = cx.add_window(|_, _| gpui_kit::EmptyView);
        other
            .update(cx, |_, window, _| window.activate_window())
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            assert!(!window.is_window_active());
            room.update(cx, |room, cx| {
                room.flow_tick(window, cx);
                assert_eq!(room.flow.rhythm.as_ref().unwrap().mode, FlowMode::Away);
                assert_eq!(room.flow.ribbon.read(cx).snapshot().label(), "away");
            });
        })
        .unwrap();
    }
}
