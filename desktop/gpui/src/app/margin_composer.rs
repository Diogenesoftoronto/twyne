use super::*;
use gpui_kit::base::text::{TextView as BaseTextView, TextViewStyle};
use gpui_kit::component::button::{ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::Enter;
use gpui_kit::{Bounds, EntityId, Pixels, Role};
use std::{collections::BTreeMap, ops::Range, sync::Mutex};
use twyne_desktop::{
    editor::{Command, CommentAttributes, RichEditor},
    house::is_js_whitespace,
    margin_rail_view::MarginRailOpenThread,
    marginalia::{CommentRef, MarginaliaEdit, UserComment, UserCommentReply},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MarginTarget {
    folio: Uuid,
    visit: u64,
    folio_revision: u64,
    editor: EntityId,
    revision: u64,
    selection: Selection,
}
struct Composition {
    id: String,
    target: MarginTarget,
    quote: String,
    input: Entity<TextareaState>,
    anchor: Bounds<Pixels>,
    scroll_y: Pixels,
    placed: bool,
    request: Option<Uuid>,
    pending_comment: Option<UserComment>,
}
enum VisibleMargin {
    Compose(Uuid),
    Thread {
        target: CommentRef,
        input: Option<Entity<TextareaState>>,
        anchor: Bounds<Pixels>,
        quote: String,
        range: Range<usize>,
        scroll_y: Pixels,
        rail_follow: bool,
    },
}

gpui_kit::actions!(twyne_margin, [DismissMargin]);

pub(super) fn init(cx: &mut App) {
    cx.bind_keys([KeyBinding::new(
        "escape",
        DismissMargin,
        Some("TwyneMargin"),
    )]);
}
type MeasuredMarginCard = (CommentRef, Bounds<Pixels>);

#[derive(Default)]
pub(super) struct MarginState {
    compositions: BTreeMap<Uuid, Composition>,
    visible: Option<VisibleMargin>,
    pub(super) preflight: Option<Uuid>,
    subscription: Option<Subscription>,
    pub(super) page_bounds: Arc<Mutex<Option<Bounds<Pixels>>>>,
    card_bounds: Arc<Mutex<Option<MeasuredMarginCard>>>,
}

impl WritingRoom {
    pub(super) fn inline_margin_visible(&self) -> bool {
        self.margin.visible.is_some()
    }

    pub(super) fn margin_rail_open_thread(&self, cx: &App) -> Option<MarginRailOpenThread> {
        let VisibleMargin::Thread {
            target,
            anchor,
            range,
            scroll_y,
            rail_follow: true,
            ..
        } = self.margin.visible.as_ref()?
        else {
            return None;
        };
        if target.folio_id != self.marginalia_folio_id() {
            return None;
        }
        let current = self
            .rich
            .as_ref()?
            .read(cx)
            .comment_range_bounds(&target.id, range);
        let top = current.map_or(
            anchor.top() + self.writing_scroll.offset().y - *scroll_y,
            |bounds| bounds.top(),
        );
        let height = self
            .margin
            .card_bounds
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(id, _)| id == target)
            .map(|(_, bounds)| f32::from(bounds.size.height));
        Some(MarginRailOpenThread {
            target: target.clone(),
            anchor_top: f32::from(top),
            height,
        })
    }

    fn margin_target(&self, selection: Selection, cx: &App) -> Option<MarginTarget> {
        if self.standalone_route()
            || self.dossier.is_some()
            || self.source_mode
            || (self.proof_mode && !self.split_view)
            || self.active_document().archived
            || self.applying_source
            || self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending)
        {
            return None;
        }
        let editor = self.rich.as_ref()?;
        let view = editor.read(cx);
        if view.is_read_only() || view.selection() != selection || selection.is_empty() {
            return None;
        }
        Some(MarginTarget {
            folio: self.active,
            visit: self.revision_generation,
            folio_revision: self.active_document().revision,
            editor: editor.entity_id(),
            revision: view.revision(),
            selection,
        })
    }

    pub(super) fn compose_margin(
        &mut self,
        selection: Selection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(target) = self.margin_target(selection, cx) else {
            return;
        };
        if self.margin.preflight.is_some() || self.ensure_marginalia(window, cx).is_err() {
            return;
        }
        self.hide_inline_margin(window, cx);
        if let Some(held) = self.margin.compositions.get(&self.active) {
            let input = held.input.clone();
            let stale = held.target != target;
            self.margin.visible = Some(VisibleMargin::Compose(self.active));
            self.subscribe_margin_input(&input, window, cx);
            input.read(cx).focus_handle(cx).focus(window, cx);
            self.focus_composer_next_frame(input.clone(), window, cx);
            if stale {
                self.notice = Some("Your margin draft is kept at its original passage. Discard it before choosing another passage.".into());
            }
            cx.notify();
            return;
        }
        let view = self.rich.as_ref().unwrap().read(cx);
        let Ok(quote) = view.document().text_in_range(selection.range()) else {
            return;
        };
        let quote = quote.replace('\n', " ");
        if quote
            .chars()
            .all(|ch| is_js_whitespace(ch) || ch == '\u{fffc}')
        {
            return;
        }
        let Some(anchor) = view.selection_endpoint_bounds() else {
            return;
        };
        let input = cx.new(|cx| {
            TextareaState::new(window, cx).placeholder("What belongs in the margin here?")
        });
        self.subscribe_margin_input(&input, window, cx);
        self.margin.compositions.insert(
            self.active,
            Composition {
                id: format!("uc-{}", Uuid::new_v4()),
                target,
                quote,
                input: input.clone(),
                anchor,
                scroll_y: self.writing_scroll.offset().y,
                placed: false,
                request: None,
                pending_comment: None,
            },
        );
        self.margin.visible = Some(VisibleMargin::Compose(self.active));
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.focus_composer_next_frame(input, window, cx);
        cx.notify();
    }

    fn focus_composer_next_frame(
        &self,
        input: Entity<TextareaState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let room = cx.weak_entity();
        let folio = self.active;
        window.on_next_frame(move |window, cx| {
            let _ = room.update(cx, |room, cx| {
                if matches!(room.margin.visible, Some(VisibleMargin::Compose(current)) if current == folio)
                    && room.margin.compositions.get(&folio).is_some_and(|compose| compose.input == input)
                {
                    input.read(cx).focus_handle(cx).focus(window, cx);
                }
            });
        });
    }

    fn subscribe_margin_input(
        &mut self,
        input: &Entity<TextareaState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.margin.subscription = Some(cx.subscribe_in(input, window, |_, _, _, _, cx| {
            cx.notify();
        }));
    }

    pub(super) fn open_inline_margin(
        &mut self,
        id: String,
        range: Range<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.standalone_route() || self.source_mode || self.desk.zen {
            return;
        }
        if let Err(error) = self.ensure_marginalia(window, cx) {
            self.error = Some(error.to_string());
            cx.notify();
            return;
        }
        let Some(editor) = &self.rich else {
            return;
        };
        let view = editor.read(cx);
        let Some(anchor) = view.comment_range_bounds(&id, &range) else {
            return;
        };
        let quote = view
            .document()
            .text_in_range(range.clone())
            .unwrap_or_default()
            .replace('\n', " ");
        let target = CommentRef {
            folio_id: self.marginalia_folio_id(),
            id,
        };
        let marginalia = self.marginalia.view.clone().unwrap();
        self.hide_inline_margin(window, cx);
        let input = if self.marginalia.record.comment(&target).is_some() {
            match marginalia.update(cx, |view, cx| view.reply_input(&target, window, cx)) {
                Ok(input) => {
                    if !marginalia.update(cx, |view, cx| {
                        view.set_inline_thread(Some(target.clone()), cx)
                    }) {
                        return;
                    }
                    input.update(cx, |input, cx| {
                        input.set_placeholder("Reply as the writer…", window, cx);
                    });
                    Some(input)
                }
                Err(_) => None,
            }
        } else {
            None
        };
        if let Some(input) = &input {
            self.subscribe_margin_input(input, window, cx);
        }
        let rail_follow = self.margin_rail.view.as_ref().is_some_and(|rail| {
            rail.update(cx, |rail, cx| {
                rail.reveal(&target, f32::from(anchor.top()), cx)
            })
            .is_some()
        });
        self.margin_rail.dismissed.remove(&target);
        self.margin_rail.decision_key = None;
        self.margin.visible = Some(VisibleMargin::Thread {
            target,
            input,
            anchor,
            quote,
            range,
            scroll_y: self.writing_scroll.offset().y,
            rail_follow,
        });
        cx.notify();
    }

    pub(super) fn hide_inline_margin(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(VisibleMargin::Thread {
            input: Some(input), ..
        }) = &self.margin.visible
        {
            input.update(cx, |input, cx| {
                input.set_placeholder("Annotate… (@ to tag an editor)", window, cx);
            });
        }
        self.margin.visible = None;
        self.margin.subscription = None;
        *self.margin.card_bounds.lock().unwrap() = None;
        if let Some(rail) = &self.margin_rail.view {
            rail.update(cx, |rail, cx| rail.set_open_thread(None, cx));
        }
        if let Some(view) = &self.marginalia.view {
            view.update(cx, |view, cx| view.set_inline_thread(None, cx));
        }
        cx.notify();
    }

    fn discard_margin(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.margin.preflight.is_some() {
            return;
        }
        if let Some(VisibleMargin::Compose(folio)) = self.margin.visible.as_ref() {
            let folio = *folio;
            if self
                .margin
                .compositions
                .get(&folio)
                .is_some_and(|compose| compose.placed)
            {
                self.notice = Some(
                    "This note is already marked. File its held draft before discarding it.".into(),
                );
                cx.notify();
                return;
            }
            self.margin.compositions.remove(&folio);
        }
        self.hide_inline_margin(window, cx);
    }

    fn place_margin(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(VisibleMargin::Compose(folio)) = self.margin.visible.as_ref() else {
            return;
        };
        let folio = *folio;
        let Some(compose) = self.margin.compositions.get(&folio) else {
            return;
        };
        if self.margin.preflight.is_some() {
            return;
        }
        if compose.placed {
            if let Err(error) = self.flush_marginalia(window, cx) {
                self.error = Some(format!("Your marked note is kept: {error:#}"));
            }
            return;
        }
        let text = compose.input.read(cx).text().to_string();
        let text = text.trim_matches(is_js_whitespace).to_owned();
        if text.is_empty() {
            return;
        }
        let target = compose.target;
        if self.margin_target(target.selection, cx) != Some(target) {
            self.error = Some("The passage changed while your note was held. Your draft is kept; copy it or discard it before choosing another passage.".into());
            cx.notify();
            return;
        }
        let id = compose.id.clone();
        let mut snapshot = self.snapshot(cx);
        snapshot.rich = self.rich.as_ref().map(|view| view.read(cx).snapshot());
        let token = Uuid::new_v4();
        self.margin.preflight = Some(token);
        self.refresh_image_capabilities(cx);
        cx.spawn_in(window, async move |this, cx| {
            let candidate_id = id.clone();
            let checked = cx.background_executor().spawn(async move {
                let rich = snapshot.rich.take().ok_or_else(|| anyhow::anyhow!("The passage is unavailable."))?;
                let mut candidate = RichEditor::new(rich);
                candidate.set_selection(target.selection)?;
                candidate.execute(Command::AddComment(CommentAttributes::new(candidate_id)))?;
                snapshot.rich = Some(candidate.document().clone());
                snapshot.materialize()?;
                anyhow::Ok(())
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.margin.preflight != Some(token) { return; }
                this.margin.preflight = None;
                this.refresh_image_capabilities(cx);
                if let Err(error) = checked {
                    this.error = Some(format!("Your note draft is kept: {error:#}"));
                } else if this.margin_target(target.selection, cx) != Some(target)
                    || this.margin.compositions.get(&folio).is_none_or(|compose| {
                        compose.id != id || compose.input.read(cx).text().to_string().trim_matches(is_js_whitespace) != text
                    })
                { this.error = Some("The passage or note changed before it could be placed. Your draft is kept.".into()); }
                else if let Err(error) = this.finish_margin_placement(folio, id, text, window, cx) {
                    this.error = Some(format!("Your margin draft is kept: {error:#}"));
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }

    fn finish_margin_placement(
        &mut self,
        folio: Uuid,
        id: String,
        text: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        self.flush_marginalia(window, cx)?;
        let editor = self
            .rich
            .clone()
            .ok_or_else(|| anyhow::anyhow!("The passage is unavailable."))?;
        editor.update(cx, |view, cx| {
            view.execute(
                Command::AddComment(CommentAttributes::new(id.clone())),
                window,
                cx,
            )
        })?;
        self.focus_writing(window, cx);
        let now = timestamp();
        let quote = self.margin.compositions[&folio].quote.clone();
        let comment = UserComment {
            id,
            folio_id: self.marginalia_folio_id(),
            text,
            author: "You".into(),
            anchor: Some(quote),
            resolved: false,
            created_at: now,
            updated_at: now,
            replies: Vec::new(),
            audio_id: None,
            audio_duration_ms: None,
            transcript_provider: None,
            extra: Default::default(),
        };
        let compose = self.margin.compositions.get_mut(&folio).unwrap();
        compose.placed = true;
        compose.pending_comment = Some(comment);
        self.file_marked_composition(window, cx)
    }

    pub(super) fn has_unfiled_marked_composition(&self) -> bool {
        self.margin
            .compositions
            .values()
            .any(|compose| compose.placed && compose.request.is_none())
    }

    pub(super) fn file_marked_composition(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let folio = self.active;
        let Some(comment) = self
            .margin
            .compositions
            .get(&folio)
            .filter(|compose| compose.placed && compose.request.is_none())
            .and_then(|compose| compose.pending_comment.clone())
        else {
            return Ok(());
        };
        // A filed note must already have its durable manuscript mark. If the
        // canonical write fails, the sealed rope and exact candidate remain
        // held for retry without inserting another mark or history item.
        self.flush(cx)?;
        let view = self
            .marginalia
            .view
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Marginalia is unavailable."))?;
        let request = view.update(cx, |view, cx| {
            view.request_edit(MarginaliaEdit::Upsert(comment), window, cx)
        })?;
        self.margin.compositions.get_mut(&folio).unwrap().request =
            request.map(|request| request.request_id);
        Ok(())
    }

    pub(super) fn margin_filed(
        &mut self,
        request: Uuid,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let completed = self
            .margin
            .compositions
            .iter()
            .find_map(|(folio, compose)| {
                (compose.request == Some(request))
                    .then(|| (*folio, compose.id.clone(), compose.target.selection.range()))
            });
        if let Some((folio, id, range)) = completed {
            let reopen = matches!(self.margin.visible, Some(VisibleMargin::Compose(current)) if current == folio);
            self.margin.compositions.remove(&folio);
            if reopen && folio == self.active {
                self.hide_inline_margin(window, cx);
                let room = cx.weak_entity();
                window.on_next_frame(move |window, cx| {
                    let _ = room.update(cx, |room, cx| {
                        if room.active == folio && room.margin.visible.is_none() {
                            room.open_inline_margin(id, range, window, cx);
                        }
                    });
                });
            }
        }
        if let Some(VisibleMargin::Thread { target, .. }) = &self.margin.visible
            && self.marginalia.record.comment(target).is_none()
        {
            self.hide_inline_margin(window, cx);
        }
    }

    fn reply_inline_margin(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(VisibleMargin::Thread {
            target,
            input: Some(input),
            ..
        }) = &self.margin.visible
        else {
            return;
        };
        let target = target.clone();
        let text = input.read(cx).text().to_string();
        let text = text.trim_matches(is_js_whitespace).to_owned();
        if text.is_empty() {
            return;
        }
        self.edit_inline_margin(
            MarginaliaEdit::AppendReply {
                target,
                reply: UserCommentReply::writer(text, timestamp()),
            },
            window,
            cx,
        );
    }

    fn edit_inline_margin(
        &mut self,
        edit: MarginaliaEdit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let MarginaliaEdit::Erase(targets) = &edit
            && let [target] = targets.as_slice()
            && self.marginalia.record.comment(target).is_none()
        {
            match self.erase_unfiled_margin_mark(target, window, cx) {
                Ok(()) => self.hide_inline_margin(window, cx),
                Err(error) => {
                    self.error = Some(format!("Could not save the erased margin mark: {error:#}"));
                    cx.notify();
                }
            }
            return;
        }
        let Some(view) = self.marginalia.view.clone() else {
            return;
        };
        if let Err(error) = view.update(cx, |view, cx| view.request_edit(edit, window, cx)) {
            self.error = Some(format!("Your margin draft is kept: {error:#}"));
        }
        cx.notify();
    }

    pub(super) fn inline_margin_card(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<gpui_kit::AnyElement> {
        if self.standalone_route()
            || self.dossier.is_some()
            || self.source_mode
            || self.desk.zen
            || (self.proof_mode && !self.split_view)
            || self
                .rich
                .as_ref()
                .is_some_and(|view| view.read(cx).is_dragging())
        {
            return None;
        }
        let visible = self.margin.visible.as_ref()?;
        let sealed_composition = match visible {
            VisibleMargin::Compose(folio) => self
                .margin
                .compositions
                .get(folio)
                .is_some_and(|compose| compose.placed),
            VisibleMargin::Thread { .. } => false,
        };
        let (compose, input, mut anchor, old_scroll, quote, comment, target) = match visible {
            VisibleMargin::Compose(folio) => {
                if *folio != self.active {
                    return None;
                }
                let held = self.margin.compositions.get(folio)?;
                (
                    true,
                    Some(held.input.clone()),
                    held.anchor,
                    held.scroll_y,
                    held.quote.clone(),
                    None,
                    None,
                )
            }
            VisibleMargin::Thread {
                target,
                input,
                anchor,
                quote,
                range,
                scroll_y,
                ..
            } => {
                if target.folio_id != self.marginalia_folio_id() {
                    return None;
                }
                let current = self
                    .rich
                    .as_ref()
                    .and_then(|view| view.read(cx).comment_range_bounds(&target.id, range));
                (
                    false,
                    input.clone(),
                    current.unwrap_or(*anchor),
                    if current.is_some() {
                        self.writing_scroll.offset().y
                    } else {
                        *scroll_y
                    },
                    quote.clone(),
                    self.marginalia.record.comment(target).cloned(),
                    Some(target.clone()),
                )
            }
        };
        anchor.origin.y += self.writing_scroll.offset().y - old_scroll;
        let scroll = self.writing_scroll.bounds();
        let page = (*self.margin.page_bounds.lock().unwrap()).unwrap_or(scroll);
        let viewport = margin_position::MarginViewport {
            width: f32::from(window.viewport_size().width),
            height: f32::from(window.viewport_size().height),
            page_left: f32::from(page.left()),
            page_right: f32::from(page.right()),
            scroll_top: f32::from(scroll.top()),
            scroll_bottom: f32::from(scroll.bottom()),
        };
        let held = compose
            || input
                .as_ref()
                .is_some_and(|input| input.read(cx).text().len() > 0);
        let rail_slot = self.margin_rail_open_thread(cx).and_then(|thread| {
            self.margin_rail
                .view
                .as_ref()?
                .read(cx)
                .slot(&thread.target)
        });
        let position = rail_slot
            .map(|slot| margin_position::MarginPosition {
                x: slot.left,
                top: Some(slot.top),
                bottom: None,
                max_height: slot.max_h,
            })
            .or_else(|| {
                margin_position::fallback(
                    margin_position::MarginAnchor {
                        left: f32::from(anchor.left()),
                        top: f32::from(anchor.top()),
                        bottom: f32::from(anchor.bottom()),
                    },
                    viewport,
                    if compose { 360. } else { 520. },
                    held,
                )
            });
        let Some(position) = position else {
            self.hide_inline_margin(window, cx);
            return None;
        };
        let p = *palette(cx);
        let writable = self.marginalia.store.is_some()
            && self
                .marginalia
                .view
                .as_ref()
                .is_some_and(|view| view.read(cx).pending_request().is_none());
        let has_text = input.as_ref().is_some_and(|input| {
            !input
                .read(cx)
                .text()
                .to_string()
                .trim_matches(is_js_whitespace)
                .is_empty()
        });
        let mut body = div()
            .id("inline-margin-body")
            .test_support()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(16.));
        if !quote.is_empty() {
            body = body.child(
                div()
                    .id("inline-margin-quote")
                    .test_support()
                    .p(px(12.))
                    .border_1()
                    .border_color(mix(p.writer_note, p.rule, 0.34))
                    .bg(mix(p.writer_note, p.paper_soft, 0.06))
                    .font(margin_serif_font())
                    .text_size(px(13.))
                    .line_height(relative(1.5))
                    .italic()
                    .text_color(rgb(p.ink_light))
                    .child(format!("« {} »", truncate_quote(&quote))),
            );
        }
        if !compose {
            body = body.child(
                margin_markdown(
                    "inline-margin-note",
                    comment
                        .as_ref()
                        .map_or("(comment body not yet synced)", |comment| &comment.text),
                    15.2,
                    24.,
                    p.ink,
                    cx,
                )
                .mt(px(if quote.is_empty() { 0. } else { 12. })),
            );
            if let Some(comment) = &comment {
                let mut replies = div()
                    .mt(px(8.))
                    .pt(px(8.))
                    .border_t_1()
                    .border_dashed()
                    .border_color(rgb(p.rule));
                for (index, reply) in comment.replies.iter().enumerate() {
                    let persona =
                        reply.author_kind == twyne_desktop::marginalia::UserCommentAuthor::Persona;
                    replies = replies.child(
                        div()
                            .when(index > 0, |row| row.mt(px(8.)))
                            .child(tracked_typewriter(
                                &format!(
                                    "{}{} · {}",
                                    reply.author,
                                    if persona { " editor" } else { "" },
                                    time_ago(reply.created_at)
                                ),
                                9.6,
                                1.536,
                                p.ink_muted,
                            ))
                            .child(
                                margin_markdown(
                                    format!("inline-margin-reply-{}", reply.id),
                                    &reply.text,
                                    13.6,
                                    20.,
                                    p.ink_light,
                                    cx,
                                )
                                .mt(px(2.))
                                .when(persona, |row| row.italic()),
                            ),
                    );
                }
                if !comment.replies.is_empty() {
                    body = body.child(replies);
                }
            }
        }
        let mut composer = div()
            .mt(px(if quote.is_empty() && compose { 0. } else { 12. }))
            .pt(px(12.))
            .border_t_1()
            .border_dashed()
            .border_color(rgb(p.rule));
        if let Some(input) = input {
            let focused = input.read(cx).focus_handle(cx).is_focused(window);
            let presentation = margin_input_presentation(cx);
            input.update(cx, |input, _| {
                input.set_editor_presentation_override(Some(presentation));
            });
            composer = composer.child(
                div()
                    .id("inline-margin-input")
                    .test_support()
                    .rounded(px(2.))
                    .when(focused, |field| {
                        field.shadow(vec![
                            gpui_kit::BoxShadow::new(
                                px(0.),
                                px(0.),
                                rgb(p.writer_note).opacity(0.22).into(),
                            )
                            .spread_radius(px(3.)),
                            gpui_kit::BoxShadow::new(px(0.), px(0.), rgb(p.paper).into())
                                .spread_radius(px(1.)),
                        ])
                    })
                    .child(
                        Textarea::new(&input)
                            .large()
                            .accessibility_id("inline-margin-input")
                            .aria_label(if compose {
                                "Write a margin note"
                            } else {
                                "Reply as the writer"
                            })
                            .appearance(false)
                            .bordered(true)
                            .font(margin_serif_font())
                            .text_size(px(13.))
                            .line_height(relative(1.5))
                            .h(px(if compose { 119.5 } else { 88. }))
                            .p_0()
                            .bg(rgb(p.paper_soft))
                            .text_color(rgb(p.ink))
                            .border_1()
                            .border_color(rgb(if focused { p.writer_note } else { p.rule }))
                            .rounded(px(2.))
                            .readonly(sealed_composition)
                            .disabled(!compose && !writable),
                    ),
            );
        }
        let mut actions = div()
            // The browser's inline textarea retains seven pixels beneath
            // its baseline before the original eight-pixel action margin.
            .mt(px(15.))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(margin_shortcut_hint(compose, p.ink_muted));
        let mut buttons = div().flex().flex_shrink_0().gap(px(8.));
        if compose {
            buttons = buttons
                .child(
                    margin_button(
                        "inline-margin-discard",
                        "Discard",
                        false,
                        self.margin.preflight.is_some(),
                        cx,
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.discard_margin(window, cx))),
                )
                .child(
                    margin_button(
                        "inline-margin-place",
                        "Place note",
                        true,
                        !has_text || self.margin.preflight.is_some(),
                        cx,
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.place_margin(window, cx))),
                );
        } else if let Some(target) = target.clone() {
            let resolved = comment.as_ref().is_some_and(|comment| comment.resolved);
            let toggle = target.clone();
            let erase = target;
            buttons = buttons
                .child(
                    margin_button(
                        "inline-margin-resolve",
                        if resolved { "Reopen" } else { "Resolve" },
                        false,
                        !writable || comment.is_none(),
                        cx,
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.edit_inline_margin(
                            MarginaliaEdit::SetResolved {
                                target: toggle.clone(),
                                resolved: !resolved,
                            },
                            window,
                            cx,
                        )
                    })),
                )
                .child(
                    margin_button(
                        "inline-margin-erase",
                        "Erase",
                        false,
                        !writable
                            || self
                                .rich
                                .as_ref()
                                .is_none_or(|view| view.read(cx).is_read_only()),
                        cx,
                    )
                    .text_color(rgb(p.vermilion))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.edit_inline_margin(
                            MarginaliaEdit::Erase(vec![erase.clone()]),
                            window,
                            cx,
                        )
                    })),
                )
                .child(
                    margin_button(
                        "inline-margin-reply",
                        "Reply",
                        true,
                        !writable || !has_text,
                        cx,
                    )
                    .on_click(
                        cx.listener(|this, _, window, cx| this.reply_inline_margin(window, cx)),
                    ),
                );
        }
        actions = actions.child(buttons);
        body = body.child(composer.child(actions));
        let resolved = comment.as_ref().is_some_and(|comment| comment.resolved);
        let author = if compose {
            "You".to_owned()
        } else {
            comment
                .as_ref()
                .map_or("You", |comment| comment.author.as_str())
                .to_owned()
        };
        let label = if compose {
            "New margin".into()
        } else {
            format!(
                "{} · {}",
                if resolved { "resolved" } else { "open" },
                comment
                    .as_ref()
                    .map_or_else(|| "just now".into(), |comment| time_ago(comment.created_at))
            )
        };
        let mut card = div()
            .id("inline-margin-card")
            .test_support()
            .role(Role::Dialog)
            .aria_label(if compose {
                "Write a margin note".to_owned()
            } else {
                format!("Note from {author}")
            })
            .key_context("TwyneMargin")
            .capture_action(cx.listener(|this, action: &Enter, window, cx| {
                let focused = match &this.margin.visible {
                    Some(VisibleMargin::Compose(folio)) => {
                        this.margin.compositions.get(folio).is_some_and(|compose| {
                            compose.input.read(cx).focus_handle(cx).is_focused(window)
                        })
                    }
                    Some(VisibleMargin::Thread {
                        input: Some(input), ..
                    }) => input.read(cx).focus_handle(cx).is_focused(window),
                    _ => false,
                };
                if action.secondary && focused {
                    match this.margin.visible {
                        Some(VisibleMargin::Compose(_)) => this.place_margin(window, cx),
                        Some(VisibleMargin::Thread { .. }) => this.reply_inline_margin(window, cx),
                        None => {}
                    }
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .occlude()
            .on_click(|_, _, cx| cx.stop_propagation())
            .absolute()
            .left(px(position.x))
            .w(px(rail_slot.map_or(340., |slot| slot.width)))
            .max_h(px(position.max_height))
            .flex()
            .flex_col()
            .overflow_hidden()
            .border_2()
            .border_color(rgb(p.writer_note))
            .rounded(px(4.))
            .bg(rgb(p.paper))
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(0.), px(5.6), rgb(0x201910).opacity(0.18).into())
                    .blur_radius(px(8.)),
            ])
            .on_action(cx.listener(|this, _: &DismissMargin, window, cx| {
                if matches!(this.margin.visible, Some(VisibleMargin::Compose(_))) {
                    this.discard_margin(window, cx);
                } else {
                    this.hide_inline_margin(window, cx);
                }
            }))
            .child(
                div()
                    .flex_shrink_0()
                    .min_h(px(56.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .px(px(16.))
                    .py(px(12.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .bg(mix(p.writer_note, p.paper_soft, 0.07))
                    .child(
                        div()
                            .min_w_0()
                            .child(
                                div()
                                    .font_family(DISPLAY_FONT)
                                    .text_size(px(16.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("You"),
                            )
                            .child(div().mt(px(2.)).child(tracked_typewriter(
                                &label.to_uppercase(),
                                11.,
                                1.32,
                                if resolved { p.sage } else { p.writer_note },
                            ))),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .flex_shrink_0()
                            .when(!compose, |row| {
                                row.child(
                                    Button::new("inline-margin-speak")
                                        .custom(
                                            ButtonCustomVariant::new(cx)
                                                .foreground(rgb(p.ink_muted).into()),
                                        )
                                        .accessibility_label("Read aloud")
                                        .disabled(true)
                                        .size(px(20.))
                                        .p_0()
                                        .border_0()
                                        .child(assets::speak_icon()),
                                )
                            })
                            .child(
                                Button::new("inline-margin-close")
                                    .custom(
                                        ButtonCustomVariant::new(cx)
                                            .foreground(rgb(p.ink_muted).into())
                                            .hover(rgb(p.sidebar).into()),
                                    )
                                    .accessibility_label("Close margin note")
                                    .w(px(44.))
                                    .h(px(44.))
                                    .p_0()
                                    .border_0()
                                    .child(
                                        div()
                                            .text_size(px(16.))
                                            .font_weight(FontWeight::NORMAL)
                                            .child("✕"),
                                    )
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.hide_inline_margin(window, cx)
                                    })),
                            ),
                    ),
            )
            .child(body);
        if let Some(target) = target {
            let measured = self.margin.card_bounds.clone();
            let room = cx.weak_entity();
            card = card.child(
                gpui_kit::canvas(
                    move |bounds, window, _| {
                        // The absolute measuring child fills the space inside
                        // the card's two-pixel border. Reserve the outer card.
                        let bounds = bounds.dilate(px(2.));
                        let mut cached = measured.lock().unwrap();
                        if cached
                            .as_ref()
                            .is_none_or(|(id, old)| id != &target || *old != bounds)
                        {
                            *cached = Some((target.clone(), bounds));
                            drop(cached);
                            let room = room.clone();
                            window.on_next_frame(move |_, cx| {
                                let _ = room.update(cx, |_, cx| cx.notify());
                            });
                        }
                    },
                    |_, (), _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
        }
        if viewport.width <= 520. {
            card = card
                .left(px(8.))
                .w(px((viewport.width - 16.).max(0.)))
                .bottom(px(8.));
        } else if let Some(top) = position.top {
            card = card.top(px(top));
        } else if let Some(bottom) = position.bottom {
            card = card.bottom(px(bottom));
        }
        Some(card.into_any_element())
    }
}

fn mix(tint: u32, base: u32, amount: f32) -> gpui_kit::Rgba {
    let tint = rgb(tint);
    let base = rgb(base);
    gpui_kit::Rgba {
        r: tint.r * amount + base.r * (1. - amount),
        g: tint.g * amount + base.g * (1. - amount),
        b: tint.b * amount + base.b * (1. - amount),
        a: 1.,
    }
}
fn truncate_quote(value: &str) -> String {
    let mut units = value.encode_utf16();
    let prefix = units.by_ref().take(280).collect::<Vec<_>>();
    if units.next().is_none() {
        value.into()
    } else {
        format!("{}…", String::from_utf16_lossy(&prefix[..279]))
    }
}
fn time_ago(at: u64) -> String {
    let seconds = timestamp().saturating_sub(at) / 1000;
    if seconds < 60 {
        "just now".into()
    } else if seconds < 3600 {
        format!("{}m ago", seconds / 60)
    } else if seconds < 86400 {
        format!("{}h ago", seconds / 3600)
    } else {
        format!("{}d ago", seconds / 86400)
    }
}
fn margin_button(
    id: &'static str,
    label: &'static str,
    pressed: bool,
    disabled: bool,
    cx: &App,
) -> Button {
    let p = palette(cx);
    let content = if pressed {
        tracked_typewriter(&label.to_uppercase(), 11.2, 2.016, p.paper)
    } else {
        div()
            .font_family(BUTTON_FONT)
            .text_size(px(12.))
            .line_height(px(18.))
            .font_weight(FontWeight::SEMIBOLD)
            .child(label)
            .into_any_element()
    };
    Button::new(id)
        .accessibility_label(label)
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(if pressed { p.ink } else { p.paper_soft }).into())
                .foreground(rgb(if pressed { p.paper } else { p.ink }).into())
                .hover(rgb(if pressed { p.vermilion_deep } else { p.sidebar }).into())
                .active(rgb(if pressed { p.vermilion_deep } else { p.sidebar }).into()),
        )
        .h(px(36.4))
        .px(px(if pressed { 16. } else { 14.4 }))
        .bg(rgb(if pressed { p.ink } else { p.paper_soft }))
        .border_1()
        .border_color(rgb(if pressed { p.ink } else { p.rule }))
        .rounded(px(2.))
        .font_family(SANS_FONT)
        .text_size(px(12.))
        .font_weight(if pressed {
            FontWeight::NORMAL
        } else {
            FontWeight::SEMIBOLD
        })
        .disabled(disabled)
        .when(pressed && disabled, |button| button.opacity(0.4))
        .child(content)
}

fn margin_input_presentation(cx: &App) -> gpui_kit::base::input::InputEditorPresentation {
    use gpui_kit::base::input::{DiagnosticColors, InputEditorPresentation, InputEditorStyle};
    let p = *palette(cx);
    let component = gpui_kit::component::Theme::global(cx);
    InputEditorPresentation {
        line_height: Some(px(19.5)),
        wrap_right_margin: Some(px(0.)),
        paddings: Some(gpui_kit::Edges {
            top: px(10.),
            right: px(12.),
            bottom: px(10.),
            left: px(12.),
        }),
        style: Some(InputEditorStyle {
            foreground: rgb(p.ink).into(),
            muted_foreground: rgb(p.ink_light).into(),
            background: rgb(p.paper_soft).into(),
            border: rgb(p.rule).into(),
            selection: rgb(p.writer_note).opacity(0.18).into(),
            caret: rgb(p.ink).into(),
            diagnostics: DiagnosticColors {
                error: component.highlight_theme.style.status.error(cx),
                warning: component.highlight_theme.style.status.warning(cx),
                info: component.highlight_theme.style.status.info(cx),
                hint: component.highlight_theme.style.status.hint(cx),
            },
            highlight_styles: component.highlight_theme.clone(),
            editor_invisible: component.highlight_theme.style.editor_invisible,
            editor_active_line: None,
            editor_gutter_background: None,
            fold_icon_renderer: None,
        }),
        ..Default::default()
    }
}

fn margin_shortcut_hint(compose: bool, color: u32) -> impl IntoElement {
    div()
        .id("inline-margin-shortcut")
        .flex_1()
        .min_w_0()
        .flex()
        .flex_wrap()
        .gap_x(px(4.))
        .role(Role::Label)
        .aria_label(if compose {
            "⌘↩ to place"
        } else {
            "⌘↩ to reply"
        })
        .child(tracked_typewriter("⌘↩", 10., 1., color))
        .child(tracked_typewriter("to", 10., 1., color))
        .child(tracked_typewriter(
            if compose { "place" } else { "reply" },
            10.,
            1.,
            color,
        ))
}

fn margin_serif_font() -> gpui_kit::Font {
    let mut font = gpui_kit::font(SERIF_FONT);
    font.fallbacks = Some(twyne_desktop::theme::serif_font_fallbacks());
    font
}
fn margin_markdown(
    id: impl Into<gpui_kit::ElementId>,
    text: &str,
    size: f32,
    height: f32,
    color: u32,
    cx: &App,
) -> gpui_kit::Div {
    div().child(
        BaseTextView::markdown(id, text.to_owned())
            .style(
                TextViewStyle::default()
                    .with_foreground(rgb(color).into())
                    .with_link(rgb(palette(cx).blue).into())
                    .with_paragraph_gap(gpui_kit::rems(size * 0.45 / twyne_desktop::theme::REM_PX)),
            )
            .font(margin_serif_font())
            .text_size(px(size))
            .line_height(px(height)),
    )
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{AnyWindowHandle, TestAppContext};
    use tempfile::TempDir;

    fn writing_room(
        cx: &mut TestAppContext,
    ) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let path = store.root().join("Two identical passages.html");
        let html = "<p><strong>Same words</strong> / <em>Same words</em></p>";
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.desk.set_zen(false, false);
                let editor = room.rich.clone().unwrap();
                editor.update(cx, |editor, cx| editor.set_comments_quiet(false, cx));
                editor
                    .update(cx, |editor, cx| {
                        editor.set_selection(Selection::new(13, 23), cx)
                    })
                    .unwrap();
            });
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                room.compose_margin(Selection::new(13, 23), window, cx)
            });
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find("inline-margin-card").visible());
        })
        .unwrap();
        (handle, room, store, directory)
    }

    #[gpui_kit::test]
    fn section_drag_hides_the_thread_and_keeps_its_real_reply_draft(cx: &mut TestAppContext) {
        let (handle, room, store, _directory) = super::super::tests::room(cx);
        let html = "<h1>Opening</h1><p><span data-comment-id=\"a\" data-comment-author=\"You\">Same words</span></p><h2>Middle</h2><p>The next section.</p>";
        let path = store.root().join("A draggable marked folio.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let folio = document.workspace.as_deref().unwrap().folio.id.clone();
        let target = CommentRef {
            folio_id: folio.clone(),
            id: "a".into(),
        };
        let value = serde_json::json!([{
            "id":"a", "folioId":folio, "text":"Keep the concrete detail.",
            "author":"You", "anchor":"Same words", "resolved":false,
            "createdAt":10, "updatedAt":10, "replies":[]
        }]);
        let store_path = twyne_desktop::marginalia::MarginaliaStore::open(store.root())
            .unwrap()
            .path()
            .to_owned();
        std::fs::write(store_path, serde_json::to_vec(&value).unwrap()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.desk.set_zen(false, false);
                room.marginalia = marginalia_coordinator::MarginaliaState::load(&store).0;
                room.ensure_marginalia(window, cx).unwrap();
            });
            window.render_frame(cx);
            let (range, source, revision, selection) = room.update(cx, |room, cx| {
                let editor = room.rich.as_ref().unwrap().read(cx);
                (
                    editor.document().comment_ranges()[0].range.clone(),
                    editor.document().to_html(),
                    editor.revision(),
                    editor.selection(),
                )
            });
            room.update(cx, |room, cx| {
                room.open_inline_margin(target.id.clone(), range.clone(), window, cx)
            });
            window.render_frame(cx);
            window.click("inline-margin-input", cx);
            window.input("A reply held across the drag", cx);
            window.render_frame(cx);
            window.click("twyne-section-drag-0", cx);
            window.press("enter", cx);
            window.render_frame(cx);
            assert!(room.read(cx).rich.as_ref().unwrap().read(cx).is_dragging());
            assert!(window.try_find("inline-margin-card").is_none());
            window.press("escape", cx);
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                let editor = room.rich.as_ref().unwrap().read(cx);
                assert!(!editor.is_dragging());
                assert_eq!(editor.document().to_html(), source);
                assert_eq!(editor.revision(), revision);
                assert_eq!(editor.selection(), selection);
                assert!(!editor.can_undo());
                room.open_inline_margin(target.id.clone(), range, window, cx);
            });
            window.render_frame(cx);
            assert!(window.find("inline-margin-card").visible());
            room.update(cx, |room, cx| {
                let input = room
                    .marginalia
                    .view
                    .as_ref()
                    .unwrap()
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                assert_eq!(
                    input.read(cx).text().to_string(),
                    "A reply held across the drag"
                );
                assert!(
                    room.marginalia
                        .record
                        .comment(&target)
                        .unwrap()
                        .replies
                        .is_empty()
                );
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn place_and_reply_use_real_inputs_marks_history_and_local_durable_ack(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir) = writing_room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.input("A **writer** note", cx);
            window.input("!", cx);
            window.press("secondary-enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let target = cx
            .update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                let target = room.update(cx, |room, cx| {
                    assert!(room.margin.preflight.is_none());
                    assert!(room.margin.compositions.is_empty());
                    let comment = room.marginalia.record.comments.first().unwrap();
                    assert_eq!(comment.text, "A **writer** note!");
                    assert_eq!(comment.anchor.as_deref(), Some("Same words"));
                    let target = comment.reference();
                    let editor = room.rich.as_ref().unwrap().read(cx);
                    assert_eq!(editor.document().comment_ranges()[0].range, 13..23);
                    assert_eq!(editor.document().plain_text(), "Same words / Same words");
                    assert!(editor.can_undo());
                    target
                });
                assert!(window.find("inline-margin-card").visible());
                window.click("inline-margin-input", cx);
                window.input("The final reply", cx);
                window.input(" 🦊", cx);
                window.press("secondary-enter", cx);
                target
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                assert_eq!(
                    room.marginalia.record.comment(&target).unwrap().replies[0].text,
                    "The final reply 🦊"
                );
                let Some(VisibleMargin::Thread {
                    input: Some(input), ..
                }) = &room.margin.visible
                else {
                    panic!("The placed thread should stay open");
                };
                assert_eq!(input.read(cx).text().to_string(), "");
                room.flush(cx).unwrap();
                let editor = room.rich.clone().unwrap();
                editor
                    .update(cx, |view, cx| view.execute(Command::Undo, window, cx))
                    .unwrap();
                assert!(editor.read(cx).document().comment_ids().is_empty());
                assert!(!editor.read(cx).can_undo());
            });
        })
        .unwrap();
        let record = twyne_desktop::marginalia::MarginaliaStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(
            record.comment(&target).unwrap().replies[0].text,
            "The final reply 🦊"
        );
    }

    #[gpui_kit::test]
    fn changed_note_or_passage_rejects_late_preflight_without_mutating_marks(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _dir) = writing_room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.input("A held draft", cx);
            window.click("inline-margin-place", cx);
            window.click("inline-margin-input", cx);
            window.input(" changed", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.marginalia.record.comments.is_empty());
                let editor = room.rich.as_ref().unwrap().read(cx);
                assert!(editor.document().comment_ids().is_empty());
                assert!(!editor.can_undo());
                assert_eq!(
                    room.margin.compositions[&room.active]
                        .input
                        .read(cx)
                        .text()
                        .to_string(),
                    "A held draft changed"
                );
                assert!(room.error.as_deref().unwrap().contains("changed before"));
                room.place_margin(window, cx);
                let editor = room.rich.clone().unwrap();
                editor
                    .update(cx, |editor, cx| {
                        editor.execute(Command::InsertText("Revised".into()), window, cx)
                    })
                    .unwrap();
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, _, cx| {
            room.update(cx, |room, cx| {
                assert!(room.marginalia.record.comments.is_empty());
                assert!(
                    room.rich
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .document()
                        .comment_ids()
                        .is_empty()
                );
                assert_eq!(
                    room.margin.compositions[&room.active]
                        .input
                        .read(cx)
                        .text()
                        .to_string(),
                    "A held draft changed"
                );
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn close_reopens_same_composer_rope_and_escape_deliberately_discards_it(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _dir) = writing_room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.input("A retained margin", cx);
            let first = room.read(cx).margin.compositions[&room.read(cx).active]
                .input
                .entity_id();
            window.click("inline-margin-close", cx);
            assert!(window.try_find("inline-margin-card").is_none());
            room.update(cx, |room, cx| {
                room.compose_margin(Selection::new(13, 23), window, cx)
            });
            window.render_frame(cx);
            let active = room.read(cx).active;
            assert_eq!(
                room.read(cx).margin.compositions[&active].input.entity_id(),
                first
            );
            assert!(
                matches!(
                    room.read(cx).margin.visible,
                    Some(VisibleMargin::Compose(_))
                ),
                "reopen must activate the held composer; live selection={:?}, source={}, quiet={}",
                room.read(cx).rich.as_ref().unwrap().read(cx).selection(),
                room.read(cx).source_mode,
                room.read(cx).desk.zen
            );
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find("inline-margin-input").visible());
            assert!(
                room.read(cx).margin.compositions[&active]
                    .input
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window),
                "the retained composer must own focus after reopening"
            );
            window.input("!", cx);
            assert_eq!(
                room.read(cx).margin.compositions[&active]
                    .input
                    .read(cx)
                    .text()
                    .to_string(),
                "A retained margin!"
            );
            window.press("escape", cx);
            assert!(room.read(cx).margin.compositions.is_empty());
            assert!(window.try_find("inline-margin-card").is_none());
            assert!(room.read(cx).marginalia.record.comments.is_empty());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn failed_placement_metadata_keeps_one_mark_and_copyable_draft_until_exact_retry(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir) = writing_room(cx);
        let margins = twyne_desktop::marginalia::MarginaliaStore::open(store.root()).unwrap();
        std::fs::create_dir(margins.path()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.input("This exact note is kept 🦊", cx);
            window.press("secondary-enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let request = cx
            .update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                room.update(cx, |room, cx| {
                    assert!(room.marginalia.record.comments.is_empty());
                    let compose = &room.margin.compositions[&room.active];
                    assert!(compose.placed);
                    assert_eq!(
                        compose.input.read(cx).text().to_string(),
                        "This exact note is kept 🦊"
                    );
                    assert_eq!(
                        room.rich
                            .as_ref()
                            .unwrap()
                            .read(cx)
                            .document()
                            .comment_ids(),
                        vec![Arc::<str>::from(compose.id.as_str())]
                    );
                    room.marginalia
                        .view
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .pending_request()
                        .unwrap()
                        .clone()
                })
            })
            .unwrap();
        std::fs::remove_dir(margins.path()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.click("inline-margin-place", cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                assert!(room.margin.compositions.is_empty());
                assert_eq!(room.marginalia.record, request.candidate);
                assert_eq!(
                    room.rich
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .document()
                        .comment_ranges()
                        .len(),
                    1
                );
                let editor = room.rich.clone().unwrap();
                editor
                    .update(cx, |view, cx| view.execute(Command::Undo, window, cx))
                    .unwrap();
                assert!(editor.read(cx).document().comment_ids().is_empty());
                assert!(!editor.read(cx).can_undo());
            });
        })
        .unwrap();
        assert_eq!(margins.load().unwrap().record, request.candidate);
    }

    #[gpui_kit::test]
    fn failed_manuscript_filing_holds_the_exact_note_before_any_metadata_ack(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir) = writing_room(cx);
        let folio = cx.update(|cx| room.read(cx).active);
        let path = store.document_path(folio);
        let previous = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.input("File the mark before this note", cx);
            window.input(" 🦊", cx);
            window.press("secondary-enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let candidate = cx
            .update_window(handle, |_, window, cx| {
                room.update(cx, |room, cx| {
                    let compose = &room.margin.compositions[&folio];
                    assert!(compose.placed);
                    assert!(compose.request.is_none());
                    assert_eq!(
                        compose.input.read(cx).text().to_string(),
                        "File the mark before this note 🦊"
                    );
                    let candidate = compose.pending_comment.clone().unwrap();
                    assert!(room.marginalia.record.comments.is_empty());
                    assert!(
                        room.marginalia
                            .view
                            .as_ref()
                            .unwrap()
                            .read(cx)
                            .pending_request()
                            .is_none()
                    );
                    assert_eq!(
                        room.rich
                            .as_ref()
                            .unwrap()
                            .read(cx)
                            .document()
                            .comment_ids(),
                        vec![Arc::<str>::from(candidate.id.as_str())]
                    );
                    assert!(room.flush_marginalia_on_shutdown(cx).is_err());
                    assert!(!room.add_document(Manuscript::new("A blocked departure"), window, cx));
                    assert_eq!(room.active, folio);
                    candidate
                })
            })
            .unwrap();
        std::fs::remove_dir(&path).unwrap();
        std::fs::write(&path, previous).unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("inline-margin-place", cx);
            room.update(cx, |room, cx| {
                assert!(room.margin.compositions.is_empty());
                assert_eq!(room.marginalia.record.comments, vec![candidate.clone()]);
                let saved: Manuscript =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                assert!(
                    saved
                        .workspace
                        .unwrap()
                        .content
                        .html
                        .contains(&candidate.id)
                );
                let editor = room.rich.clone().unwrap();
                editor
                    .update(cx, |editor, cx| editor.execute(Command::Undo, window, cx))
                    .unwrap();
                assert!(editor.read(cx).document().comment_ids().is_empty());
                assert!(!editor.read(cx).can_undo());
            });
        })
        .unwrap();
        let saved = twyne_desktop::marginalia::MarginaliaStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(saved.comments, vec![candidate]);
    }
}
