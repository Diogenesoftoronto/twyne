//! Small writing-room host for the independent insert_menu package.
//! This owns editor identity/lifecycle; the package owns menu/forms/adapters.
use super::*;
use gpui_kit::{AnyElement, Bounds, Div, Pixels, Stateful, anchored, deferred, point};
use twyne_desktop::insert_menu::{
    self, SlashQuery,
    form::{FormEvent, InsertFormView},
    parameters::{FormKind, Parameters},
    table_picker::{TablePickerEvent, TablePickerView},
    view::{InsertMenuView, MenuEvent},
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Target {
    document: Uuid,
    editor: gpui_kit::EntityId,
    rich: bool,
    revision: u64,
    query: SlashQuery,
}

#[derive(Clone, Debug)]
struct FormTarget {
    scope: Target,
    revision: u64,
    position: usize,
    // Captured once when opening a plain-text parameter flow. Revision events
    // are queued; the exact post-removal value guards its cold commit instead.
    plain_body: Option<String>,
}

#[derive(Default)]
pub(super) struct InsertState {
    menu: Option<Entity<InsertMenuView>>,
    menu_subscription: Option<Subscription>,
    menu_binding: u64,
    target: Option<Target>,
    dismissed: Option<Target>,
    form: Option<Entity<InsertFormView>>,
    form_subscription: Option<Subscription>,
    form_target: Option<(FormTarget, String)>,
    table: Option<Entity<TablePickerView>>,
    table_subscription: Option<Subscription>,
    form_scroll: ScrollHandle,
    plain_revision: u64,
    body_selection: std::ops::Range<usize>,
}

impl WritingRoom {
    #[cfg(feature = "ui-tests")]
    pub(super) fn capture_insert_menu(
        &mut self,
        command: Option<&'static str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.desk.preferences.compositor_open = false;
        self.desk.drawer_open = false;
        let room = cx.weak_entity();
        window.on_next_frame(move |window, cx| {
            let _ = room.update(cx, |room, cx| {
                if let Some(editor) = &room.rich {
                    let end = editor.read(cx).document().text_len().saturating_sub(1);
                    editor.update(cx, |editor, cx| {
                        editor.set_selection(Selection::caret(end), cx).unwrap()
                    });
                    window.focus(&editor.read(cx).focus_handle(cx), cx);
                } else {
                    room.body.update(cx, |body, cx| {
                        let end = body.value().trim_end_matches(['\r', '\n']).len();
                        body.set_selected_range(end..end, cx);
                        body.focus(window, cx);
                    });
                }
                room.refresh_insert_menu(window, cx);
                if let Some(command) = command {
                    room.choose_insert_command(command, window, cx);
                }
            });
        });
    }
    fn insert_available(&self) -> bool {
        !self.active_document().archived
            && !self.reading
            && !self.source_mode
            && !(self.proof_mode && !self.split_view)
            && !self.applying_source
            && !self.standalone_route()
            && self.dossier.is_none()
            && self.source_session.as_ref().is_none_or(|s| !s.pending)
    }
    fn current_insert_target(
        &self,
        require_focus: bool,
        window: &Window,
        cx: &App,
    ) -> Option<Target> {
        if !self.insert_available() {
            return None;
        }
        let (rich, identity, revision, query) = if let Some(editor) = &self.rich {
            let identity = editor.entity_id();
            let editor = editor.read(cx);
            if editor.is_read_only()
                || editor.is_composing()
                || (require_focus && !editor.focus_handle(cx).is_focused(window))
            {
                return None;
            }
            (
                true,
                identity,
                editor.revision(),
                insert_menu::detect_rich(editor.document(), editor.selection())?,
            )
        } else {
            let body = self.body.read(cx);
            let selection = body.selected_range();
            if selection.start != selection.end
                || body.is_composing()
                || (require_focus && !body.focus_handle(cx).is_focused(window))
            {
                return None;
            }
            let row = body.text().offset_to_point(selection.start).row;
            let start = body.text().line_start_offset(row);
            let mut query =
                insert_menu::detect(&body.text().slice(start..selection.start).to_string())?;
            query.range.start += start;
            query.range.end += start;
            (
                false,
                self.body.entity_id(),
                self.insert.plain_revision,
                query,
            )
        };
        Some(Target {
            document: self.active,
            editor: identity,
            rich,
            revision,
            query,
        })
    }
    pub(super) fn insert_body_event(
        &mut self,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if matches!(event, InputEvent::Change) {
            self.insert.plain_revision = self.insert.plain_revision.saturating_add(1);
        }
        self.refresh_insert_menu(window, cx);
    }
    pub(super) fn insert_body_selection_changed(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let selection = self.body.read(cx).selected_range();
        if selection != self.insert.body_selection {
            self.insert.body_selection = selection;
            self.refresh_insert_menu(window, cx);
            self.reveal_caret_next_frame(window, cx);
        }
    }
    pub(super) fn reset_insert_menu(&mut self, cx: &mut Context<Self>) {
        if let Some(form) = &self.insert.form {
            form.update(cx, |form, cx| form.retire(cx));
        }
        self.insert.menu_binding = self.insert.menu_binding.saturating_add(1);
        self.insert.target = None;
        self.insert.dismissed = None;
        self.insert.form = None;
        self.insert.form_subscription = None;
        self.insert.form_target = None;
        self.insert.table = None;
        self.insert.table_subscription = None;
    }
    pub(super) fn refresh_insert_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.insert.form.is_some() || self.insert.table.is_some() {
            return;
        }
        let target = self.current_insert_target(true, window, cx);
        if self.insert.dismissed.as_ref() != target.as_ref() {
            self.insert.dismissed = None;
        }
        let target = target.filter(|t| self.insert.dismissed.as_ref() != Some(t));
        if let Some(target) = &target {
            if let Some(menu) = &self.insert.menu {
                menu.update(cx, |menu, cx| menu.set_query(&target.query.query, cx));
            } else {
                let menu = cx.new(|cx| InsertMenuView::new(&target.query.query, cx));
                self.insert.menu_subscription =
                    Some(
                        cx.subscribe_in(&menu, window, |this, sender, event, window, cx| {
                            if this.insert.menu.as_ref() != Some(sender) {
                                return;
                            }
                            match event {
                                MenuEvent::Choose { id, binding }
                                    if *binding == this.insert.menu_binding =>
                                {
                                    this.choose_insert_command(id, window, cx)
                                }
                                MenuEvent::Dismiss { binding }
                                    if *binding == this.insert.menu_binding =>
                                {
                                    this.dismiss_insert(false, window, cx)
                                }
                                _ => {}
                            }
                        }),
                    );
                self.insert.menu = Some(menu);
            }
        }
        if self.insert.target != target {
            self.insert.menu_binding = self.insert.menu_binding.saturating_add(1);
            if let Some(menu) = &self.insert.menu {
                menu.update(cx, |menu, cx| {
                    menu.set_binding(self.insert.menu_binding, cx)
                });
            }
            self.insert.target = target;
            cx.notify();
        }
    }
    pub(super) fn sync_insert_presence(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.insert_available() {
            if self.insert.target.is_some()
                || self.insert.form.is_some()
                || self.insert.table.is_some()
            {
                self.reset_insert_menu(cx);
            }
            return;
        }
        if self.insert.form.is_none()
            && self.insert.table.is_none()
            && self.insert.target.is_some()
            && self.current_insert_target(true, window, cx) != self.insert.target
        {
            self.refresh_insert_menu(window, cx);
        }
    }
    fn insert_anchor(&self, window: &Window, cx: &App) -> Option<Bounds<Pixels>> {
        let bounds = if let Some(editor) = &self.rich {
            editor.read(cx).caret_bounds()
        } else {
            self.body.read(cx).cursor_layout().map(|l| l.0)
        }?;
        let viewport = self.writing_scroll.bounds();
        (bounds.bottom() > viewport.top()
            && bounds.top() < viewport.bottom()
            && bounds.top() < window.viewport_size().height)
            .then_some(bounds)
    }
    fn dismiss_insert(&mut self, focus_editor: bool, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(form) = &self.insert.form {
            form.update(cx, |form, cx| form.retire(cx));
        }
        self.insert.dismissed = self
            .insert
            .target
            .clone()
            .or_else(|| self.insert.form_target.as_ref().map(|t| t.0.scope.clone()));
        self.insert.target = None;
        self.insert.form = None;
        self.insert.form_subscription = None;
        self.insert.form_target = None;
        self.insert.table = None;
        self.insert.table_subscription = None;
        if focus_editor {
            self.focus_writing(window, cx);
        }
        cx.notify();
    }
    fn move_insert_selection(
        &mut self,
        direction: isize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        self.refresh_insert_menu(window, cx);
        if self.insert.target.is_none() {
            return false;
        }
        let Some(menu) = &self.insert.menu else {
            return false;
        };
        if !menu.read(cx).has_candidates() {
            return false;
        }
        menu.update(cx, |menu, cx| menu.move_selection(direction, cx));
        true
    }
    fn accept_insert_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        self.refresh_insert_menu(window, cx);
        if self.insert.target.is_none() {
            return false;
        }
        let Some(id) = self
            .insert
            .menu
            .as_ref()
            .and_then(|m| m.read(cx).selected())
        else {
            return false;
        };
        self.choose_insert_command(id, window, cx);
        true
    }
    fn choose_insert_command(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.insert.target.clone() else {
            return;
        };
        // Resolve the actual caret/query at activation, never a previous render.
        if self.current_insert_target(true, window, cx).as_ref() != Some(&target)
            || !insert_menu::candidates(&target.query.query)
                .iter()
                .any(|r| r.command.id == id)
        {
            self.refresh_insert_menu(window, cx);
            return;
        }
        if id == "insert.table" || FormKind::for_command(id).is_some() {
            let binding = match self.remove_parameter_query(target, window, cx) {
                Ok(binding) => binding,
                Err(error) => {
                    self.notice = Some(error);
                    self.dismiss_insert(true, window, cx);
                    return;
                }
            };
            self.insert.form_target = Some((binding, id.to_owned()));
            self.insert.target = None;
            if id == "insert.table" {
                let table = cx.new(|cx| TablePickerView::new(window, cx));
                self.insert.table_subscription =
                    Some(
                        cx.subscribe_in(&table, window, |this, sender, event, window, cx| {
                            if this.insert.table.as_ref() != Some(sender) {
                                return;
                            }
                            match event {
                                TablePickerEvent::Cancel => this.dismiss_insert(true, window, cx),
                                TablePickerEvent::Insert(dimensions) => {
                                    if let Some((target, id)) = this.insert.form_target.clone() {
                                        this.commit_parameter(
                                            target,
                                            &id,
                                            &Parameters::Table {
                                                rows: dimensions.rows,
                                                columns: dimensions.columns,
                                                header: true,
                                            },
                                            window,
                                            cx,
                                        );
                                    }
                                }
                            }
                        }),
                    );
                window.focus(&table.read(cx).focus_handle(cx), cx);
                self.insert.table = Some(table);
                self.changed(window, cx);
                cx.notify();
                return;
            }
            let kind = FormKind::for_command(id).unwrap();
            let form = cx.new(|cx| InsertFormView::new(kind, window, cx));
            self.insert.form_subscription =
                Some(
                    cx.subscribe_in(&form, window, |this, sender, event, window, cx| {
                        if this.insert.form.as_ref() != Some(sender) {
                            return;
                        }
                        match event {
                            FormEvent::Cancel => this.dismiss_insert(true, window, cx),
                            FormEvent::Insert(values) => {
                                if let Some((target, id)) = this.insert.form_target.clone() {
                                    this.commit_parameter(target, &id, values, window, cx);
                                }
                            }
                        }
                    }),
                );
            self.insert.form = Some(form);
            self.changed(window, cx);
            cx.notify();
        } else {
            self.commit_insert(target, id, &Parameters::None, window, cx);
        }
    }
    fn remove_parameter_query(
        &mut self,
        target: Target,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<FormTarget, String> {
        let position = target.query.range.start;
        let (revision, plain_body) = if target.rich {
            let editor = self.rich.as_ref().unwrap();
            editor
                .update(cx, |editor, cx| {
                    editor.remove_slash_query(&target.query, target.revision, window, cx)
                })
                .map_err(|error| error.to_string())?;
            (editor.read(cx).revision(), None)
        } else {
            self.body.update(cx, |body, cx| {
                body.replace_range_with_selection(
                    target.query.range.clone(),
                    "",
                    position..position,
                    window,
                    cx,
                )
            });
            (
                self.insert.plain_revision,
                Some(self.body.read(cx).value().to_string()),
            )
        };
        Ok(FormTarget {
            scope: target,
            revision,
            position,
            plain_body,
        })
    }
    fn parameter_target_current(&self, target: &FormTarget, cx: &App) -> bool {
        if !self.insert_available() || target.scope.document != self.active {
            return false;
        }
        if target.scope.rich {
            self.rich.as_ref().is_some_and(|editor| {
                let state = editor.read(cx);
                editor.entity_id() == target.scope.editor
                    && !state.is_read_only()
                    && !state.is_composing()
                    && state.revision() == target.revision
                    && state.selection() == Selection::caret(target.position)
            })
        } else {
            let body = self.body.read(cx);
            self.rich.is_none()
                && self.body.entity_id() == target.scope.editor
                && !body.is_composing()
                && body.selected_range() == (target.position..target.position)
                && target.plain_body.as_deref() == Some(body.value().as_str())
        }
    }
    fn commit_parameter(
        &mut self,
        target: FormTarget,
        id: &str,
        values: &Parameters,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.parameter_target_current(&target, cx) {
            self.notice = Some("The insertion position has changed. Type / again.".into());
            self.dismiss_insert(true, window, cx);
            return;
        }
        let result = if target.scope.rich {
            self.rich
                .as_ref()
                .unwrap()
                .update(cx, |editor, cx| {
                    editor.insert_at_cursor(
                        target.revision,
                        Selection::caret(target.position),
                        id,
                        values,
                        window,
                        cx,
                    )
                })
                .map(|_| ())
                .map_err(|error| error.to_string())
        } else {
            insert_menu::markdown::plan_at(&self.body.read(cx).value(), target.position, id, values)
                .map(|edit| {
                    self.body.update(cx, |body, cx| {
                        body.replace_range_with_selection(
                            edit.range,
                            edit.text,
                            edit.selection,
                            window,
                            cx,
                        )
                    });
                })
                .map_err(str::to_owned)
        };
        self.finish_insert(result, window, cx);
    }
    fn commit_insert(
        &mut self,
        target: Target,
        id: &str,
        values: &Parameters,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.current_insert_target(false, window, cx).as_ref() != Some(&target) {
            self.notice = Some("The insertion position has changed. Type / again.".into());
            self.dismiss_insert(true, window, cx);
            return;
        }
        let result = if target.rich {
            self.rich
                .as_ref()
                .unwrap()
                .update(cx, |editor, cx| {
                    editor.insert_from_slash(&target.query, target.revision, id, values, window, cx)
                })
                .map(|_| ())
                .map_err(|e| e.to_string())
        } else {
            insert_menu::markdown::plan(&self.body.read(cx).value(), &target.query, id, values)
                .map(|edit| {
                    self.body.update(cx, |body, cx| {
                        body.replace_range_with_selection(
                            edit.range,
                            edit.text,
                            edit.selection,
                            window,
                            cx,
                        )
                    });
                })
                .map_err(str::to_owned)
        };
        self.finish_insert(result, window, cx);
    }
    fn finish_insert(
        &mut self,
        result: Result<(), String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match result {
            Ok(()) => {
                self.reset_insert_menu(cx);
                self.focus_writing(window, cx);
                self.changed(window, cx);
                self.reveal_caret_next_frame(window, cx);
            }
            Err(error) => {
                self.notice = Some(error);
                self.dismiss_insert(true, window, cx);
            }
        }
        cx.notify();
    }
    pub(super) fn insert_key_handlers(
        &self,
        element: Stateful<Div>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        element
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::MoveUp, w, cx| {
                    if this.move_insert_selection(-1, w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::MoveDown, w, cx| {
                    if this.move_insert_selection(1, w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &twyne_desktop::editor::view::Up, w, cx| {
                    if this.move_insert_selection(-1, w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &twyne_desktop::editor::view::Down, w, cx| {
                    if this.move_insert_selection(1, w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::Enter, w, cx| {
                    if this.accept_insert_selection(w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &twyne_desktop::editor::view::Enter, w, cx| {
                    if this.accept_insert_selection(w, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, w, cx| {
                    if this.insert.target.is_some()
                        || this.insert.form.is_some()
                        || this.insert.table.is_some()
                    {
                        this.dismiss_insert(true, w, cx);
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(cx.listener(|this, _: &CloseCompositor, w, cx| {
                if this.insert.target.is_some()
                    || this.insert.form.is_some()
                    || this.insert.table.is_some()
                {
                    this.dismiss_insert(true, w, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
    }
    pub(super) fn insert_overlay(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let viewport = window.viewport_size();
        if let Some(table) = &self.insert.table {
            let left = (f32::from(viewport.width) / 2. - 123.).max(8.);
            return Some(
                deferred(
                    anchored()
                        .position(point(px(left), px(64.)))
                        .snap_to_window_with_margin(px(8.))
                        .child(table.clone()),
                )
                .priority(4)
                .into_any_element(),
            );
        }
        if let Some(form) = &self.insert.form {
            if form.read(cx).is_text_modal() {
                return Some(
                    deferred(
                        anchored().position(point(px(0.), px(0.))).child(
                            div()
                                .id("slash-insert-scrim")
                                .test_support()
                                .w(viewport.width)
                                .h(viewport.height)
                                .p(px(16.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .bg(rgb(0x14100a).opacity(0.58))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.dismiss_insert(true, window, cx)
                                }))
                                .child(form.clone()),
                        ),
                    )
                    .priority(10)
                    .into_any_element(),
                );
            }
            let left = (f32::from(viewport.width) / 2. - 160.).max(8.);
            return Some(
                deferred(
                    anchored()
                        .position(point(px(left), px(80.)))
                        .snap_to_window_with_margin(px(8.))
                        .child(
                            div()
                                .id("slash-insert-overlay")
                                .max_w(px((f32::from(viewport.width) - 16.).max(0.)))
                                .max_h(px((f32::from(viewport.height) - 16.).max(0.)))
                                .overflow_y_scroll()
                                .track_scroll(&self.insert.form_scroll)
                                .child(form.clone())
                                .on_mouse_down_out(cx.listener(|this, _, window, cx| {
                                    this.dismiss_insert(false, window, cx)
                                })),
                        ),
                )
                .priority(4)
                .into_any_element(),
            );
        }
        self.insert.target.as_ref()?;
        let menu = self.insert.menu.as_ref()?;
        let anchor = self.insert_anchor(window, cx)?;
        let width = f32::from(viewport.width);
        let height = f32::from(viewport.height);
        let left = f32::from(anchor.left()).min(width - 288. - 8.).max(8.);
        let below = (height - f32::from(anchor.bottom()) - 14.).max(0.);
        let above = (f32::from(anchor.top()) - 14.).max(0.);
        let use_above = below < 200. && above > below;
        let available = if use_above { above } else { below };
        let results_height = (available - 40.).clamp(0., 320.);
        menu.update(cx, |menu, cx| menu.set_max_height(results_height, cx));
        let top = if use_above {
            f32::from(anchor.top()) - 6. - results_height - 36.
        } else {
            f32::from(anchor.bottom()) + 6.
        };
        Some(
            deferred(
                anchored()
                    .position(point(px(left), px(top.max(8.))))
                    .snap_to_window_with_margin(px(8.))
                    .child(div().max_w(px((width - 16.).max(0.))).child(menu.clone())),
            )
            .priority(3)
            .into_any_element(),
        )
    }
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "slash_tests.rs"]
mod tests;
