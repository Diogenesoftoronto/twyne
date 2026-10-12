//! The original writing tools attached to one live folio/editor visit.
//! Provider generation and automatic struggle classification remain separate
//! adapters; the offline branch uses Source's own deterministic tools.
use super::*;
use gpui_kit::base::Button;
use serde_json::{Value, json};
use twyne_desktop::gen_ui::{
    card::{CardAction, CardEvent, ToolCardView},
    model::ToolSnapshot,
    passage::{Passage, PassageAnchor},
    position::{self, Rect, Viewport},
    saved::normalize_saved_tool,
    seed::{SavedToolConfig, SeedOptions, ToolKind},
    store::{ToolStore, ToolWriteAck},
    view::{ToolAction, ToolScope},
};
use twyne_desktop::theme;

pub(super) struct ToolState {
    visit: Uuid,
    pub(super) card: Option<Entity<ToolCardView>>,
    subscription: Option<Subscription>,
    anchor: Option<PassageAnchor>,
    document: Option<RichDocument>,
    revision: u64,
    kind: Option<ToolKind>,
    highlight: Option<usize>,
    rhythm_task: Option<Task<()>>,
    store: Option<ToolStore>,
    saved: Vec<Value>,
    saved_generation: u64,
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use tempfile::TempDir;
    use twyne_desktop::editor::Command;

    fn tool_room(
        cx: &mut TestAppContext,
        kind: ToolKind,
    ) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<h2>A heading.</h2><p>First😀 <em>sentence.</em> Second one.</p><p>Another paragraph.</p>";
        let path = store.root().join("Writing tools.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.desk.set_zen(false, false);
            });
            window.render_frame(cx);
            room.update(cx, |room, cx| room.open_native_tool(kind, None, window, cx));
            for _ in 0..3 {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            }
            window.render_frame(cx);
            assert!(window.find("in-flow-card").visible());
            if kind == ToolKind::ReaderQuestions {
                let card = window.find("in-flow-card").bounds();
                for id in ["in-flow-ask", "in-flow-jot-0", "in-flow-question-0"] {
                    let element = window.find(id);
                    assert!(element.visible(), "Reader control {id} must be visible");
                    assert!(element.bounds().left() >= card.left());
                    assert!(element.bounds().right() <= card.right());
                }
            }
            assert_eq!(
                f32::from(window.find("in-flow-card").bounds().size.width),
                296.
            );
        })
        .unwrap();
        (handle, room, store, directory)
    }
    #[gpui_kit::test]
    fn real_working_copy_button_replaces_only_its_sentence_and_undo_restores_the_caret(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory) = tool_room(cx, ToolKind::SentenceLab);
        let (before, selection) = cx.update(|cx| {
            let editor = room.read(cx).rich.as_ref().unwrap().read(cx);
            (editor.snapshot(), editor.selection())
        });
        cx.update_window(handle, |_, window, cx| {
            window.click("in-flow-working-field", cx);
            window.press("ctrl-a", cx);
            window.input("Reworked😀 sentence.", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("in-flow-use-this", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.gen_ui.card.is_none());
                let rich = room.rich.clone().unwrap();
                let document = rich.read(cx).snapshot();
                assert!(
                    document
                        .to_html()
                        .contains("Reworked😀 sentence. Second one.")
                );
                assert!(document.to_html().contains("Another paragraph."));
                rich.update(cx, |rich, cx| rich.execute(Command::Undo, window, cx))
                    .unwrap();
                assert_eq!(rich.read(cx).document(), &before);
                assert_eq!(rich.read(cx).selection(), selection);
            });
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn changed_sentence_is_retained_and_reports_sources_notice(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory) = tool_room(cx, ToolKind::SentenceLab);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let range = room
                    .gen_ui
                    .anchor
                    .as_ref()
                    .unwrap()
                    .sentence
                    .clone()
                    .unwrap();
                let rich = room.rich.clone().unwrap();
                rich.update(cx, |rich, cx| {
                    rich.set_selection(Selection::new(range.start, range.end), cx)
                        .unwrap();
                    rich.execute(
                        Command::ReplaceSelection("Changed sentence.".into()),
                        window,
                        cx,
                    )
                    .unwrap();
                });
            });
            window.render_frame(cx);
            window.click("in-flow-working-field", cx);
            window.press("ctrl-a", cx);
            window.input("A proposed revision.", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let revision = cx.update(|cx| room.read(cx).rich.as_ref().unwrap().read(cx).revision());
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("in-flow-use-this", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            let room = room.read(cx);
            assert_eq!(room.rich.as_ref().unwrap().read(cx).revision(), revision);
            assert_eq!(
                room.gen_ui
                    .card
                    .as_ref()
                    .unwrap()
                    .read(cx)
                    .snapshot()
                    .notice
                    .as_deref(),
                Some("That sentence has changed since the tool opened.")
            );
        });
    }
    #[gpui_kit::test]
    fn rhythm_bar_uses_current_native_sentence_positions(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory) = tool_room(cx, ToolKind::RhythmStrip);
        let expected = cx.update(|cx| {
            room.read(cx)
                .current_tool_passage(cx)
                .unwrap()
                .sentence(1)
                .unwrap()
                .1
        });
        cx.update_window(handle, |_, window, cx| {
            window.click("in-flow-bar-1", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            assert_eq!(
                room.read(cx)
                    .rich
                    .as_ref()
                    .unwrap()
                    .read(cx)
                    .selection()
                    .range(),
                expected
            )
        });
    }
    #[gpui_kit::test]
    fn rhythm_number_fields_match_the_original_browser_controls(cx: &mut TestAppContext) {
        use sha2::{Digest, Sha256};
        let oracle: Value = serde_json::from_str(include_str!(
            "../../fixtures/gen-ui/source-controls-oracle.json"
        ))
        .unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for (path, expected) in oracle["inputHashes"].as_object().unwrap() {
            let bytes = std::fs::read(root.join(path)).unwrap();
            assert_eq!(
                format!("{:x}", Sha256::digest(bytes)),
                expected.as_str().unwrap(),
                "Source controls fixture drift: {path}"
            );
        }
        let (handle, _room, _store, _directory) = tool_room(cx, ToolKind::RhythmStrip);
        for frame in oracle["frames"].as_array().unwrap() {
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                match frame["action"].as_str().unwrap() {
                    "initial" => {}
                    "minimum ArrowUp" | "empty minimum ArrowUp" => {
                        window.click("in-flow-min-input", cx);
                        window.press("up", cx);
                    }
                    "minimum ArrowDown" => window.press("down", cx),
                    "minimum typed 79" => {
                        window.click("in-flow-min-input", cx);
                        window.press("ctrl-a", cx);
                        window.input("79", cx);
                    }
                    "maximum typed 200" => {
                        window.click("in-flow-max-input", cx);
                        window.press("ctrl-a", cx);
                        window.input("200", cx);
                    }
                    "minimum cleared and blurred" => {
                        window.click("in-flow-min-input", cx);
                        window.press("ctrl-a", cx);
                        window.press("backspace", cx);
                        window.click("in-flow-max-input", cx);
                    }
                    action => panic!("Unknown Source control action: {action}"),
                }
            })
            .unwrap();
            cx.run_until_parked();
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                assert_eq!(
                    window.find("in-flow-min-input").value(),
                    frame["min"].as_str(),
                    "{}",
                    frame["action"]
                );
                assert_eq!(
                    window.find("in-flow-max-input").value(),
                    frame["max"].as_str(),
                    "{}",
                    frame["action"]
                );
            })
            .unwrap();
        }
    }
    #[gpui_kit::test]
    fn real_jot_and_keep_buttons_require_saved_data_and_survive_reopen(cx: &mut TestAppContext) {
        let (handle, room, store, _directory) = tool_room(cx, ToolKind::ReaderQuestions);
        let folio = cx.update(|cx| room.read(cx).marginalia_folio_id());
        cx.update_window(handle, |_, window, cx| {
            window.click("in-flow-jot-0", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let saved = ToolStore::open(store.root())
            .unwrap()
            .load_notebook(&folio)
            .unwrap();
        assert_eq!(saved["scraps"].as_array().unwrap().len(), 1);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("in-flow-jot-0", cx);
            window.click("in-flow-name-tool", cx);
            window.render_frame(cx);
            window.click("in-flow-name-field", cx);
            window.input("My reader", cx);
            window.click("in-flow-keep", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let reopened = ToolStore::open(store.root()).unwrap();
        assert_eq!(
            reopened.load_notebook(&folio).unwrap()["scraps"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let templates = reopened.load_saved().unwrap().saved_tools;
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0]["name"], "My reader");
        assert_eq!(templates[0]["config"], json!({}));
        cx.update(|cx| {
            assert!(
                room.read(cx)
                    .gen_ui
                    .card
                    .as_ref()
                    .unwrap()
                    .read(cx)
                    .snapshot()
                    .saved_id
                    .is_some()
            )
        });
    }
    #[gpui_kit::test]
    fn retired_scope_cannot_apply_to_a_new_editor_visit(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory) = tool_room(cx, ToolKind::SentenceLab);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let card = room.gen_ui.card.as_ref().unwrap().read(cx);
                let event = CardEvent {
                    scope: card.scope().clone(),
                    tool: card.snapshot().id,
                    action: CardAction::Body(ToolAction::ApplyVariant("Foreign revision.".into())),
                };
                room.retire_gen_ui_visit(cx);
                room.open_native_tool(ToolKind::ReaderQuestions, None, window, cx);
                let before = room.rich.as_ref().unwrap().read(cx).snapshot();
                let fresh = room.gen_ui.card.as_ref().unwrap().read(cx).snapshot().id;
                room.native_tool_event(event, window, cx);
                assert_eq!(room.rich.as_ref().unwrap().read(cx).document(), &before);
                assert_eq!(
                    room.gen_ui.card.as_ref().unwrap().read(cx).snapshot().id,
                    fresh
                );
            });
        })
        .unwrap();
    }
}
impl ToolState {
    pub(super) fn load(library: &Store) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let (store, saved, generation) = match ToolStore::open(library.root()).and_then(|store| {
            let loaded = store.load_saved()?;
            Ok((store, loaded))
        }) {
            Ok((store, loaded)) => (Some(store), loaded.saved_tools, loaded.generation),
            Err(error) => {
                warnings.push(format!("Writing tools could not be opened: {error:#}"));
                (None, Vec::new(), 0)
            }
        };
        (
            Self {
                visit: Uuid::new_v4(),
                card: None,
                subscription: None,
                anchor: None,
                document: None,
                revision: 0,
                kind: None,
                highlight: None,
                rhythm_task: None,
                store,
                saved,
                saved_generation: generation,
            },
            warnings,
        )
    }
}
fn rect(bounds: gpui_kit::Bounds<gpui_kit::Pixels>) -> Rect {
    Rect {
        left: bounds.left().into(),
        top: bounds.top().into(),
        right: bounds.right().into(),
        bottom: bounds.bottom().into(),
    }
}

impl WritingRoom {
    pub(super) fn native_tools_ready(&self, cx: &App) -> bool {
        !self.active_document().archived
            && self
                .rich
                .as_ref()
                .is_some_and(|rich| !rich.read(cx).is_read_only())
            && self
                .source_session
                .as_ref()
                .is_none_or(|session| !session.pending)
    }
    fn tool_visible(&self, cx: &App) -> bool {
        self.native_tools_ready(cx)
            && !self.standalone_route()
            && self.dossier.is_none()
            && !self.reading
            && !self.source_mode
            && !self.proof_mode
            && !self.desk.zen
    }
    pub(super) fn retire_gen_ui_visit(&mut self, cx: &mut Context<Self>) {
        self.dismiss_native_tool(cx);
        self.gen_ui.visit = Uuid::new_v4();
    }
    fn dismiss_native_tool(&mut self, cx: &mut Context<Self>) {
        self.gen_ui.subscription = None;
        if let Some(card) = self.gen_ui.card.take() {
            card.update(cx, |card, cx| card.retire(cx));
        }
        self.gen_ui.anchor = None;
        self.gen_ui.document = None;
        self.gen_ui.kind = None;
        self.gen_ui.highlight = None;
        self.gen_ui.rhythm_task = None;
        if let Some(rich) = &self.rich {
            rich.update(cx, |rich, cx| rich.set_tool_decoration(None, None, cx));
        }
        cx.notify();
    }
    pub(super) fn open_native_tool(
        &mut self,
        kind: ToolKind,
        hint: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.native_tools_ready(cx) {
            return;
        }
        let Some(rich) = self.rich.as_ref() else {
            return;
        };
        let editor = rich.read(cx);
        let Some(passage) = Passage::choose(editor.document(), editor.selection().head, hint)
        else {
            return;
        };
        self.mount_native_tool(
            kind,
            passage,
            None,
            "Opened from the rubric.".into(),
            window,
            cx,
        );
    }
    fn mount_native_tool(
        &mut self,
        kind: ToolKind,
        passage: Passage,
        saved: Option<Value>,
        reason: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let options = SeedOptions {
            config: saved
                .as_ref()
                .map(|saved| SavedToolConfig::from_value(&saved["config"]))
                .unwrap_or_default(),
            ..SeedOptions::default()
        };
        let Ok(mut snapshot) = ToolSnapshot::seeded(Uuid::new_v4(), kind, &passage.text, &options)
        else {
            return;
        };
        snapshot = snapshot.fill_offline();
        snapshot.reason = reason;
        snapshot.saved_id = saved
            .as_ref()
            .and_then(|saved| saved["id"].as_str())
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let sentence = match kind {
            ToolKind::SentenceLab => snapshot.props()["sentence"].as_str(),
            ToolKind::ClaimCheck => snapshot.props()["claim"].as_str(),
            _ => None,
        }
        .and_then(|text| passage.find_sentence(text));
        self.dismiss_native_tool(cx);
        let scope = ToolScope {
            folio: self.marginalia_folio_id().into(),
            visit: self.gen_ui.visit,
        };
        let card = cx.new(|cx| ToolCardView::new(scope, snapshot, window, cx));
        self.gen_ui.subscription = Some(cx.subscribe_in(
            &card,
            window,
            |this, sender, event: &CardEvent, window, cx| {
                if this.gen_ui.card.as_ref() == Some(sender) {
                    this.native_tool_event(event.clone(), window, cx);
                }
            },
        ));
        self.gen_ui.card = Some(card);
        self.gen_ui.anchor = Some(PassageAnchor::new(&passage, sentence));
        self.gen_ui.kind = Some(kind);
        if let Some(rich) = &self.rich {
            self.gen_ui.document = Some(rich.read(cx).snapshot());
            self.gen_ui.revision = rich.read(cx).revision();
            rich.update(cx, |rich, cx| {
                let _ = rich.set_selection(Selection::caret(passage.range.start), cx);
            });
        }
        self.rubric.route = false;
        self.reading = false;
        self.source_mode = false;
        self.proof_mode = false;
        self.sync_tool_decoration(cx);
        self.reveal_caret_next_frame(window, cx);
        cx.notify();
    }
    fn tool_scope_current(&self, scope: &ToolScope, tool: Uuid, cx: &App) -> bool {
        scope.visit == self.gen_ui.visit
            && scope.folio.as_ref() == self.marginalia_folio_id()
            && self.gen_ui.card.as_ref().is_some_and(|card| {
                card.read(cx).scope() == scope && card.read(cx).snapshot().id == tool
            })
    }
    pub(super) fn accept_tool_transaction(
        &mut self,
        before: &RichDocument,
        after: &RichDocument,
        revision: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.gen_ui.card.is_none() || revision <= self.gen_ui.revision {
            return;
        }
        let previous = self.gen_ui.document.as_ref().unwrap_or(before);
        if self
            .gen_ui
            .anchor
            .as_mut()
            .is_none_or(|anchor| !anchor.remap(previous, after))
        {
            self.dismiss_native_tool(cx);
            return;
        }
        self.gen_ui.document = Some(after.clone());
        self.gen_ui.revision = revision;
        self.sync_tool_decoration(cx);
        if self.gen_ui.kind == Some(ToolKind::RhythmStrip) {
            let visit = self.gen_ui.visit;
            let id = self.gen_ui.card.as_ref().unwrap().entity_id();
            self.gen_ui.rhythm_task = Some(cx.spawn_in(window, async move |this, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(120))
                    .await;
                let _ = this.update_in(cx, |this, window, cx| {
                    if this.gen_ui.visit == visit
                        && this.gen_ui.card.as_ref().map(Entity::entity_id) == Some(id)
                    {
                        this.reseed_rhythm(None, window, cx);
                    }
                });
            }));
        }
        cx.notify();
    }
    fn current_tool_passage(&self, cx: &App) -> Option<Passage> {
        let rich = self.rich.as_ref()?.read(cx);
        let anchor = self.gen_ui.anchor.as_ref()?;
        let passage = Passage::at(rich.document(), anchor.paragraph.start).ok()?;
        (passage.range.start == anchor.paragraph.start).then_some(passage)
    }
    fn sync_tool_decoration(&mut self, cx: &mut Context<Self>) {
        let enabled = self.tool_visible(cx);
        let span = enabled
            .then(|| {
                self.gen_ui.anchor.as_ref().map(|anchor| {
                    anchor
                        .sentence
                        .clone()
                        .unwrap_or_else(|| anchor.paragraph.clone())
                })
            })
            .flatten();
        let highlighted = enabled
            .then(|| {
                self.gen_ui.highlight.and_then(|index| {
                    self.current_tool_passage(cx)?
                        .sentence(index)
                        .map(|(_, range)| range)
                })
            })
            .flatten();
        if let Some(rich) = &self.rich {
            rich.update(cx, |rich, cx| {
                rich.set_tool_decoration(span, highlighted, cx)
            });
        }
    }
    fn native_tool_event(&mut self, event: CardEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !self.tool_scope_current(&event.scope, event.tool, cx) || !self.tool_visible(cx) {
            return;
        }
        // An input can have queued its transaction notification before a card
        // action. Bring its anchor to the actual live snapshot before applying.
        if let Some(rich) = &self.rich
            && rich.read(cx).revision() > self.gen_ui.revision
        {
            let after = rich.read(cx).snapshot();
            let revision = rich.read(cx).revision();
            let before = self
                .gen_ui
                .document
                .clone()
                .unwrap_or_else(|| after.clone());
            self.accept_tool_transaction(&before, &after, revision, window, cx);
            if !self.tool_scope_current(&event.scope, event.tool, cx) {
                return;
            }
        }
        match event.action {
            CardAction::Dismiss => self.dismiss_native_tool(cx),
            CardAction::FocusAnchor => {
                let Some(anchor) = self.gen_ui.anchor.as_ref() else {
                    return;
                };
                let position = anchor
                    .sentence
                    .as_ref()
                    .map_or(anchor.paragraph.start, |range| range.start);
                self.select_tool_range(position..position, window, cx);
            }
            CardAction::Keep {
                request,
                name,
                config,
            } => {
                self.keep_native_tool((event.scope, event.tool), request, name, config, window, cx)
            }
            CardAction::Body(action) => match action {
                ToolAction::ApplyVariant(text) => self.apply_tool_variant(&text, window, cx),
                ToolAction::HighlightSentence(index) => {
                    self.gen_ui.highlight = index;
                    self.sync_tool_decoration(cx);
                }
                ToolAction::SelectSentence(index) => {
                    if let Some((_, range)) = self
                        .current_tool_passage(cx)
                        .and_then(|passage| passage.sentence(index))
                    {
                        self.select_tool_range(range, window, cx);
                    }
                }
                ToolAction::SetRhythmBand { min, max } => {
                    self.reseed_rhythm(Some((min, max)), window, cx)
                }
                ToolAction::Reask(angle) => self.reask_native_tool(angle, window, cx),
                ToolAction::Jot { request, question } => {
                    self.jot_native_tool(event.scope, event.tool, request, question, window, cx)
                }
                ToolAction::Research { request, .. } => {
                    self.open_apparatus(
                        twyne_desktop::apparatus_view::ApparatusSurface::Board,
                        window,
                        cx,
                    );
                    if let Some(card) = &self.gen_ui.card {
                        card.update(cx, |card, cx| {
                            card.finish_research(
                                request,
                                Err("The Apparatus could not start.".into()),
                                cx,
                            )
                        });
                    }
                }
            },
        }
    }
    fn select_tool_range(
        &mut self,
        range: std::ops::Range<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(rich) = &self.rich {
            rich.update(cx, |rich, cx| {
                let _ = rich.set_selection(Selection::new(range.start, range.end), cx);
            });
            self.focus_writing(window, cx);
            self.reveal_caret_next_frame(window, cx);
        }
    }
    fn apply_tool_variant(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.gen_ui.kind != Some(ToolKind::SentenceLab) {
            return;
        }
        let (Some(passage), Some(card)) = (self.current_tool_passage(cx), self.gen_ui.card.clone())
        else {
            return;
        };
        let sentence = card.read(cx).snapshot().props()["sentence"]
            .as_str()
            .unwrap()
            .to_owned();
        let range = self
            .gen_ui
            .anchor
            .as_ref()
            .and_then(|anchor| anchor.sentence.clone())
            .filter(|range| passage.text_in_range(range).as_deref() == Some(sentence.as_str()))
            .or_else(|| passage.find_sentence(&sentence));
        let Some(range) = range else {
            let mut snapshot = card.read(cx).snapshot().clone();
            snapshot.notice = Some("That sentence has changed since the tool opened.".into());
            card.update(cx, |card, cx| card.update(snapshot, window, cx));
            return;
        };
        let Some(rich) = self.rich.clone() else {
            return;
        };
        self.focus_writing(window, cx);
        let revision = rich.read(cx).revision();
        match rich.update(cx, |rich, cx| {
            rich.replace_tool_sentence(range, text.to_owned(), revision, window, cx)
        }) {
            Ok(_) => self.dismiss_native_tool(cx),
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
            }
        }
    }
    fn reseed_rhythm(
        &mut self,
        band: Option<(f64, f64)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.gen_ui.kind != Some(ToolKind::RhythmStrip) {
            return;
        }
        let (Some(passage), Some(card)) = (self.current_tool_passage(cx), self.gen_ui.card.clone())
        else {
            return;
        };
        let previous = card.read(cx).snapshot().clone();
        let (min, max) = band.unwrap_or((
            previous.props()["targetMin"].as_f64().unwrap(),
            previous.props()["targetMax"].as_f64().unwrap(),
        ));
        if !min.is_finite() || !max.is_finite() {
            return;
        }
        let min = min.round().clamp(1., 80.);
        let max = max.round().min(120.).max(min + 1.);
        let options = SeedOptions {
            config: SavedToolConfig {
                target_min: Some(min),
                target_max: Some(max),
                ..SavedToolConfig::default()
            },
            ..SeedOptions::default()
        };
        if let Ok(mut snapshot) =
            ToolSnapshot::seeded(previous.id, ToolKind::RhythmStrip, &passage.text, &options)
        {
            snapshot.reason = previous.reason;
            snapshot.saved_id = previous.saved_id;
            snapshot.notice = previous.notice;
            snapshot.tentative = previous.tentative;
            card.update(cx, |card, cx| card.update(snapshot, window, cx));
        }
    }
    fn reask_native_tool(&mut self, angle: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.gen_ui.kind != Some(ToolKind::ReaderQuestions) {
            return;
        }
        let (Some(passage), Some(card)) =
            (self.current_tool_passage(cx), self.gen_ui.card.as_ref())
        else {
            return;
        };
        let old = card.read(cx).snapshot();
        let reason = old.reason.clone();
        let id = old.saved_id.clone().unwrap_or_default();
        // Normalize the configurable reader with the same UTF-16 boundary
        // refusal as saved templates; the live angle input remains retained.
        match normalize_saved_tool(
            &json!({"id":"reask","kind":"reader-questions","config":{"angle":angle}}),
        ) {
            Ok(Some(mut saved)) => {
                saved["id"] = json!(id);
                self.mount_native_tool(
                    ToolKind::ReaderQuestions,
                    passage,
                    Some(saved),
                    reason,
                    window,
                    cx,
                );
            }
            _ => {
                self.error = Some("The reader name ends inside a Unicode character.".into());
                cx.notify();
            }
        }
    }
    fn accept_tool_save(&mut self, ack: &ToolWriteAck) {
        if ack.generation >= self.gen_ui.saved_generation {
            self.gen_ui.saved = ack.saved_tools.clone();
            self.gen_ui.saved_generation = ack.generation;
        }
    }
    fn open_saved_native_tool(
        &mut self,
        saved: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.native_tools_ready(cx) {
            return;
        }
        let Some(kind) = saved["kind"].as_str().and_then(ToolKind::from_id) else {
            return;
        };
        let Some(rich) = self.rich.as_ref() else {
            return;
        };
        let editor = rich.read(cx);
        let Ok(passage) = Passage::at(editor.document(), editor.selection().head) else {
            return;
        };
        let reason = format!("From Your tools: {}.", saved["name"].as_str().unwrap());
        self.mount_native_tool(kind, passage, Some(saved), reason, window, cx);
    }
    fn remove_saved_native_tool(
        &mut self,
        id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(store) = self.gen_ui.store.clone() else {
            return;
        };
        let keep_library = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _keep_library = keep_library;
                    store.remove(&id)
                })
                .await;
            let _ = this.update_in(cx, |this, _, cx| {
                match result {
                    Ok(ack) => this.accept_tool_save(&ack),
                    Err(error) => {
                        this.error = Some(format!("Could not remove the saved tool: {error:#}"))
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn native_tool_shelf(&self, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let colors = *palette(cx);
        let mut list = div().flex().flex_col().gap(px(4.));
        for saved in &self.gen_ui.saved {
            let id = saved["id"].as_str().unwrap().to_owned();
            let name = saved["name"].as_str().unwrap().to_owned();
            let kind = ToolKind::from_id(saved["kind"].as_str().unwrap()).unwrap();
            let template = saved.clone();
            let remove_id = id.clone();
            list = list.child(
                div()
                    .id(SharedString::from(format!("in-flow-saved-row-{id}")))
                    .group("in-flow-saved-row")
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        Button::new(SharedString::from(format!("in-flow-saved-open-{id}")))
                            .accessibility_label(format!("Use {name} on the paragraph you're in"))
                            .flex_1()
                            .min_w_0()
                            .flex_col()
                            .px(px(7.2))
                            .py(px(4.8))
                            .border_1()
                            .border_color(rgb(colors.rule))
                            .rounded(px(2.))
                            .bg(rgb(colors.paper))
                            .font_family(theme::SERIF_FONT)
                            .text_size(px(13.))
                            .line_height(gpui_kit::relative(1.3))
                            .text_color(rgb(colors.ink))
                            .hover(|style| style.border_color(rgb(colors.cobalt)))
                            .child(div().w_full().truncate().child(name.clone()))
                            .child(twyne_desktop::chrome::tracked_typewriter(
                                &kind.title().to_uppercase(),
                                10.,
                                1.,
                                colors.ink_muted,
                            ))
                            .on_click(cx.listener(move |room, _, window, cx| {
                                room.open_saved_native_tool(template.clone(), window, cx)
                            })),
                    )
                    .child(
                        Button::new(SharedString::from(format!("in-flow-saved-remove-{id}")))
                            .accessibility_label(format!("Remove {name}"))
                            .text_size(px(11.2))
                            .text_color(rgb(colors.ink_muted))
                            .opacity(0.)
                            .group_hover("in-flow-saved-row", |style| style.opacity(1.))
                            .focus_visible(|style| style.opacity(1.))
                            .child("✕")
                            .on_click(cx.listener(move |room, _, window, cx| {
                                room.remove_saved_native_tool(remove_id.clone(), window, cx)
                            })),
                    ),
            );
        }
        div()
            .id("in-flow-shelf")
            .test_support()
            .flex()
            .flex_col()
            .gap(px(6.4))
            .font_family(theme::SERIF_FONT)
            .child(twyne_desktop::chrome::tracked_typewriter(
                "YOUR TOOLS",
                11.,
                1.32,
                colors.ink_muted,
            ))
            .child(list)
            .into_any_element()
    }
    fn keep_native_tool(
        &mut self,
        (scope, tool): (ToolScope, Uuid),
        request: Uuid,
        name: String,
        config: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(store), Some(kind)) = (self.gen_ui.store.clone(), self.gen_ui.kind) else {
            if let Some(card) = &self.gen_ui.card {
                card.update(cx, |card, cx| {
                    card.finish_keep(request, Err("Local save failed".into()), window, cx)
                });
            }
            return;
        };
        let keep_library = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _keep_library = keep_library;
                    store.keep(kind, &name, config)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if let Ok(ack) = &result {
                    this.accept_tool_save(ack);
                }
                if this.tool_scope_current(&scope, tool, cx)
                    && let Some(card) = &this.gen_ui.card
                {
                    let result = result
                        .map(|ack| ack.saved_id.unwrap())
                        .map_err(|error| error.to_string());
                    card.update(cx, |card, cx| card.finish_keep(request, result, window, cx));
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn jot_native_tool(
        &mut self,
        scope: ToolScope,
        tool: Uuid,
        request: Uuid,
        question: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(store) = self.gen_ui.store.clone() else {
            if let Some(card) = &self.gen_ui.card {
                card.update(cx, |card, cx| {
                    card.finish_jot(request, Err("Local save failed".into()), cx)
                });
            }
            return;
        };
        let keep_library = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let folio = scope.folio.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _keep_library = keep_library;
                    store.jot(&folio, &question)
                })
                .await;
            let _ = this.update_in(cx, |this, _, cx| {
                if let Ok(ack) = &result {
                    this.accept_tool_save(ack);
                }
                if this.tool_scope_current(&scope, tool, cx)
                    && let Some(card) = &this.gen_ui.card
                {
                    card.update(cx, |card, cx| {
                        card.finish_jot(
                            request,
                            result.map(|_| ()).map_err(|error| error.to_string()),
                            cx,
                        )
                    });
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub(super) fn gen_ui_overlay(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<gpui_kit::AnyElement> {
        self.sync_tool_decoration(cx);
        if !self.tool_visible(cx) {
            return None;
        }
        let canvas = rect((*self.margin.page_bounds.lock().unwrap())?);
        let scroller = rect(self.writing_scroll.bounds());
        let viewport = Viewport {
            width: window.viewport_size().width.into(),
            height: window.viewport_size().height.into(),
        };
        let mut overlay = div().absolute().inset_0();
        if !self.gen_ui.saved.is_empty()
            && canvas.left - scroller.left >= position::SHELF_WIDTH + position::RAIL_GAP
        {
            overlay = overlay.child(
                div()
                    .absolute()
                    .left(px(scroller.left))
                    .top(px(scroller.top))
                    .w(px(scroller.right - scroller.left))
                    .h(px(scroller.bottom - scroller.top))
                    .overflow_hidden()
                    .child(
                        div()
                            .absolute()
                            .left(px(canvas.left
                                - scroller.left
                                - position::SHELF_WIDTH
                                - position::RAIL_GAP))
                            .top(px((canvas.top - scroller.top).max(16.)))
                            .w(px(position::SHELF_WIDTH))
                            .child(self.native_tool_shelf(cx)),
                    ),
            );
        }
        if let (Some(card), Some(anchor), Some(rich)) =
            (&self.gen_ui.card, &self.gen_ui.anchor, &self.rich)
            && let Ok(passage) = Passage::at(rich.read(cx).document(), anchor.paragraph.start)
            && let Some(bounds) = rich.read(cx).tool_anchor_bounds(
                &passage.path,
                anchor
                    .sentence
                    .as_ref()
                    .map_or(anchor.paragraph.start, |range| range.start),
            )
        {
            let position = position::position(canvas, scroller, rect(bounds), viewport);
            let placed = div()
                .id("in-flow-tool-position")
                .test_support()
                .absolute()
                .left(px(
                    position.x - if position.rail { scroller.left } else { 0. }
                ))
                .top(px(
                    position.top - if position.rail { scroller.top } else { 0. }
                ))
                .w(px(position::CARD_WIDTH))
                .when(!position.rail, |card| {
                    card.max_h(px((viewport.height - 24.).max(0.)))
                        .overflow_y_scroll()
                })
                .child(card.clone());
            if position.rail {
                let connector_color = palette(cx).cobalt;
                overlay = overlay.child(
                    div()
                        .absolute()
                        .left(px(scroller.left))
                        .top(px(scroller.top))
                        .w(px(scroller.right - scroller.left))
                        .h(px(scroller.bottom - scroller.top))
                        .overflow_hidden()
                        .child(placed)
                        .child(
                            gpui_kit::canvas(
                                |_, _, _| (),
                                move |bounds, _, window, _| {
                                    let mut x = canvas.right;
                                    while x < canvas.right + position::RAIL_GAP {
                                        window.paint_quad(gpui_kit::fill(
                                            gpui_kit::Bounds::new(
                                                bounds.origin
                                                    + gpui_kit::point(
                                                        px(x - scroller.left),
                                                        px(position.connector_top - scroller.top),
                                                    ),
                                                gpui_kit::size(
                                                    px(3_f32.min(
                                                        canvas.right + position::RAIL_GAP - x,
                                                    )),
                                                    px(1.),
                                                ),
                                            ),
                                            rgb(connector_color).opacity(0.55),
                                        ));
                                        x += 6.;
                                    }
                                },
                            )
                            .absolute()
                            .inset_0(),
                        ),
                );
            } else {
                overlay = overlay.child(placed);
            }
        }
        Some(overlay.into_any_element())
    }
}
