//! Native, editor-local block drags. The platform drag contains a revision
//! token and shared source node, not HTML or a plain-text representation.

use std::collections::BTreeMap;

use gpui_kit::{DragMoveEvent, EntityId, KeyDownEvent, Role, WeakEntity};

use super::*;
use crate::editor::{BlockMovePlan, DropPlacement, MathDisplay};

#[derive(Clone)]
pub(super) struct DragInfo {
    owner: EntityId,
    revision: u64,
    selection: Selection,
    source: NodePath,
    node: Node,
    section: bool,
    label: SharedString,
}

struct Preview {
    label: SharedString,
    offset: Point<Pixels>,
    visible: bool,
}
impl Render for Preview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .pl(self.offset.x)
            .pt(self.offset.y)
            .when(self.visible, |this| {
                this.child(
                    div()
                        .max_w(px(300.))
                        .px(px(8.))
                        .py(px(4.))
                        .bg(rgb(theme::palette(cx).paper))
                        .border_1()
                        .border_color(rgb(theme::palette(cx).rule))
                        .font_family(SERIF_FONT)
                        .text_size(px(18.))
                        .child(self.label.clone()),
                )
            })
    }
}

pub(super) struct MeasuredNode {
    bounds: Bounds<Pixels>,
}

#[derive(Default)]
pub(super) struct DragState {
    pub measured: RefCell<BTreeMap<NodePath, MeasuredNode>>,
    focus: RefCell<HashMap<usize, (Node, FocusHandle)>>,
    seen_focus: RefCell<HashSet<usize>>,
    session: Option<Session>,
    stop_pending: bool,
    viewport: Option<Bounds<Pixels>>,
    root_bounds: Option<Bounds<Pixels>>,
}

struct Session {
    info: DragInfo,
    keyboard: bool,
    sections: Vec<Range<usize>>,
    parent: NodePath,
    boundaries: Arc<[usize]>,
    preview: Option<DropPreview>,
}

impl Session {
    fn plan(&self, source: Range<usize>, insert_at: usize) -> Option<BlockMovePlan> {
        if source.start <= insert_at && insert_at <= source.end {
            return None;
        }
        let scalar_range = *self.boundaries.get(source.start)?..*self.boundaries.get(source.end)?;
        let old_destination = *self.boundaries.get(insert_at)?;
        let destination = if insert_at > source.end {
            old_destination - scalar_range.len()
        } else {
            old_destination
        };
        Some(BlockMovePlan {
            parent: self.parent.clone(),
            source,
            insert_at,
            scalar_range,
            destination,
        })
    }
}

#[derive(Clone)]
struct DropPreview {
    command: Command,
    plan: BlockMovePlan,
    indicator: NodePath,
    placement: DropPlacement,
}

impl DragState {
    fn focus(&self, node: &Node, cx: &App) -> FocusHandle {
        let key = node.data() as *const super::super::NodeData as usize;
        self.seen_focus.borrow_mut().insert(key);
        self.focus
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| (node.clone(), cx.focus_handle()))
            .1
            .clone()
    }
    pub(super) fn is_active(&self) -> bool {
        self.session.is_some()
    }
    pub(super) fn finish_render(&self) {
        let seen = self.seen_focus.borrow();
        self.focus.borrow_mut().retain(|key, _| seen.contains(key));
    }
}

impl RichEditorView {
    /// Optional actual outer scroller bounds. Drop previews and scroll requests
    /// are clipped to that visible writing surface, not the full document.
    pub fn set_drag_viewport(&mut self, bounds: Option<Bounds<Pixels>>) {
        self.drag.viewport = bounds;
    }
    pub fn is_dragging(&self) -> bool {
        self.drag.is_active()
    }
    /// Current measured complete block geometry, including source-backed
    /// object wrappers. This is independent of caret/selection and history.
    pub fn block_bounds(&self, path: &[usize]) -> Option<Bounds<Pixels>> {
        self.drag
            .measured
            .borrow()
            .get(path)
            .map(|node| node.bounds)
    }

    /// Host mode/route/folio transitions call this before removing the view.
    /// Repeating it is neutral and does not stop an unrelated platform drag.
    pub fn cancel_block_drag(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.clear_comment_hover(cx);
        let owned = self.drag.is_active() || self.drag.stop_pending;
        self.cancel_drag(cx);
        self.drag.stop_pending = false;
        if owned {
            cx.stop_active_drag(window);
        }
    }

    fn valid_drag(&self, info: &DragInfo, owner: EntityId) -> bool {
        info.owner == owner
            && !self.is_read_only()
            && self.marked_range.is_none()
            && self.revision() == info.revision
            && self.selection() == info.selection
            && self
                .document()
                .node(&info.source)
                .is_some_and(|node| node.shares_storage_with(&info.node))
    }

    fn begin_drag(&mut self, info: DragInfo, keyboard: bool, cx: &mut Context<Self>) -> bool {
        if self.drag.is_active() || !self.valid_drag(&info, cx.entity_id()) {
            return false;
        }
        let parent = info.source[..info.source.len() - 1].to_vec();
        if !info.section
            && self
                .document()
                .plan_block_move(
                    &parent,
                    *info.source.last().unwrap()..*info.source.last().unwrap() + 1,
                    *info.source.last().unwrap(),
                )
                .is_err()
        {
            return false;
        }
        let children = if parent.is_empty() {
            self.document().nodes()
        } else {
            &self
                .document()
                .node(&parent)
                .and_then(Node::as_element)
                .expect("validated block parent")
                .children
        };
        let mut boundaries = Vec::with_capacity(children.len() + 1);
        let mut cursor = self.document().offset_of_node(&parent).unwrap_or(0);
        boundaries.push(cursor);
        for child in children {
            cursor += child.projection_len();
            boundaries.push(cursor);
        }
        let sections = if info.section {
            self.document().section_ranges()
        } else {
            Vec::new()
        };
        self.selecting = false;
        self.clear_comment_hover(cx);
        self.drag.session = Some(Session {
            info: info.clone(),
            keyboard,
            sections,
            parent,
            boundaries: boundaries.into(),
            preview: None,
        });
        cx.emit(RichEditorEvent::DragStarted {
            source: info.source,
        });
        cx.notify();
        true
    }

    pub(super) fn cancel_drag(&mut self, cx: &mut Context<Self>) {
        if self.drag.session.take().is_some() {
            self.drag.stop_pending = true;
            cx.emit(RichEditorEvent::DragFinished { moved: false });
            cx.notify();
        }
    }

    pub(super) fn prepare_drag_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.drag.session.as_ref().is_some_and(|session| {
            !self.valid_drag(&session.info, cx.entity_id())
                || !session.keyboard && !cx.has_active_drag()
        }) {
            self.cancel_drag(cx);
        }
        if std::mem::take(&mut self.drag.stop_pending) {
            cx.stop_active_drag(window);
        }
        self.drag.measured.borrow_mut().clear();
        self.drag.seen_focus.borrow_mut().clear();
    }

    pub(super) fn drag_move(
        &mut self,
        event: &DragMoveEvent<DragInfo>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(info) = event.dragged_item().downcast_ref::<DragInfo>() else {
            return;
        };
        if !self.valid_drag(info, cx.entity_id()) {
            self.cancel_drag(cx);
            return;
        }
        self.drag.root_bounds = Some(event.bounds);
        self.preview_at(event.event.position, cx);
        if let Some(viewport) = self.drag.viewport
            && viewport.contains(&event.event.position)
            && (event.event.position.y < viewport.top() + px(32.)
                || event.event.position.y > viewport.bottom() - px(32.))
        {
            cx.emit(RichEditorEvent::DragAutoScrollRequested {
                position: event.event.position,
            });
        }
        let cursor = if self
            .drag
            .session
            .as_ref()
            .is_some_and(|session| session.preview.is_some())
        {
            CursorStyle::ClosedHand
        } else {
            CursorStyle::OperationNotAllowed
        };
        cx.set_active_drag_cursor_style(cursor, window);
    }

    fn preview_at(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(session) = self.drag.session.as_ref() else {
            return;
        };
        if !self.valid_drag(&session.info, cx.entity_id()) {
            self.cancel_drag(cx);
            return;
        }
        let region = self.drag.viewport.or(self.drag.root_bounds);
        let preview = if region.is_some_and(|region| !region.contains(&position)) {
            None
        } else {
            let measured = self.drag.measured.borrow();
            if session.info.section {
                let target = session
                    .sections
                    .iter()
                    .filter_map(|section| {
                        measured
                            .get(&vec![section.start])
                            .map(|node| (section, node))
                    })
                    .rfind(|(_, node)| node.bounds.top() <= position.y)
                    .or_else(|| {
                        session.sections.first().and_then(|section| {
                            measured
                                .get(&vec![section.start])
                                .map(|node| (section, node))
                        })
                    });
                target.and_then(|(section, node)| {
                    let placement = if position.y < node.bounds.center().y {
                        DropPlacement::Before
                    } else {
                        DropPlacement::After
                    };
                    self.section_preview(session, section.start, placement, &measured)
                })
            } else {
                let parent = &session.info.source[..session.info.source.len() - 1];
                let target = measured
                    .iter()
                    .filter(|(path, node)| {
                        path.len() == parent.len() + 1
                            && path.starts_with(parent)
                            && node.bounds.size.height > px(0.)
                            && node.bounds.left() <= position.x
                            && position.x <= node.bounds.right()
                    })
                    .min_by(|(_, left), (_, right)| {
                        let distance = |bounds: Bounds<Pixels>| {
                            if position.y < bounds.top() {
                                bounds.top() - position.y
                            } else if position.y > bounds.bottom() {
                                position.y - bounds.bottom()
                            } else {
                                px(0.)
                            }
                        };
                        distance(left.bounds)
                            .partial_cmp(&distance(right.bounds))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });
                target.and_then(|(path, node)| {
                    let placement = if position.y < node.bounds.center().y {
                        DropPlacement::Before
                    } else {
                        DropPlacement::After
                    };
                    self.atom_preview(session, path, placement)
                })
            }
        };
        let changed = self
            .drag
            .session
            .as_ref()
            .and_then(|s| s.preview.as_ref())
            .map(|p| (&p.command, &p.indicator, p.placement))
            != preview
                .as_ref()
                .map(|p| (&p.command, &p.indicator, p.placement));
        if let Some(session) = &mut self.drag.session {
            session.preview = preview;
        }
        if changed {
            cx.notify();
        }
    }

    fn section_preview(
        &self,
        session: &Session,
        target: usize,
        placement: DropPlacement,
        measured: &BTreeMap<NodePath, MeasuredNode>,
    ) -> Option<DropPreview> {
        let source = &session.info.source;
        let section = |index| {
            session
                .sections
                .binary_search_by_key(&index, |range| range.start)
                .ok()
                .map(|at| session.sections[at].clone())
        };
        let source_range = section(source[0])?;
        if source_range.contains(&target) {
            return None;
        }
        let target_range = section(target)?;
        let insert_at = if placement == DropPlacement::Before {
            target
        } else {
            target_range.end
        };
        let plan = session.plan(source_range, insert_at)?;
        let indicator = match placement {
            DropPlacement::Before => vec![target],
            DropPlacement::After => measured
                .range(..vec![plan.insert_at])
                .rev()
                .find(|(path, _)| path.len() == 1)?
                .0
                .clone(),
        };
        Some(DropPreview {
            command: Command::MoveSection {
                source: source.to_vec(),
                target: vec![target],
                placement,
            },
            plan,
            indicator,
            placement,
        })
    }

    fn atom_preview(
        &self,
        session: &Session,
        target: &[usize],
        placement: DropPlacement,
    ) -> Option<DropPreview> {
        let source = &session.info.source;
        let (&index, parent) = source.split_last()?;
        if target.len() != source.len() || !target.starts_with(parent) {
            return None;
        }
        let insert_at = *target.last()? + usize::from(placement == DropPlacement::After);
        let plan = session.plan(index..index + 1, insert_at)?;
        Some(DropPreview {
            command: Command::MoveBlocks {
                parent: parent.to_vec(),
                source: index..index + 1,
                insert_at,
            },
            plan,
            indicator: target.to_vec(),
            placement,
        })
    }

    pub(super) fn drop_blocks(
        &mut self,
        info: &DragInfo,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.drag.session.as_ref().is_some_and(|s| !s.keyboard) {
            self.preview_at(window.mouse_position(), cx);
        }
        if !self.valid_drag(info, cx.entity_id()) {
            self.cancel_drag(cx);
            return;
        }
        let Some(session) = self.drag.session.take() else {
            return;
        };
        if session.info.owner != info.owner
            || session.info.source != info.source
            || session.info.revision != info.revision
        {
            self.drag.session = Some(session);
            self.cancel_drag(cx);
            return;
        }
        self.drag.stop_pending = false;
        cx.stop_active_drag(window);
        let moved = if let Some(preview) = session.preview {
            match self.execute(preview.command, window, cx) {
                Ok(outcome) if outcome.document_changed => {
                    if !session.info.section {
                        let _ = self.set_selection(
                            Selection::new(
                                preview.plan.destination,
                                preview.plan.destination + session.info.node.projection_len(),
                            ),
                            cx,
                        );
                    }
                    window.focus(&self.focus, cx);
                    true
                }
                _ => false,
            }
        } else {
            false
        };
        cx.emit(RichEditorEvent::DragFinished { moved });
        cx.notify();
    }

    pub(super) fn drag_mouse_up(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.drag.session.as_ref().is_some_and(|s| !s.keyboard) {
            // Native on_drop is dispatched in the same bubble phase. Clean up
            // an outside/invalid drop only after those listeners have run.
            cx.defer_in(window, |this, _, cx| this.cancel_drag(cx));
        }
    }

    fn handle_key(
        &mut self,
        info: &DragInfo,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() {
            return;
        }
        let key = event.keystroke.key.as_str();
        if !matches!(key, "enter" | "space" | "escape" | "up" | "down") {
            return;
        }
        window.prevent_default();
        cx.stop_propagation();
        if key == "escape" {
            self.cancel_block_drag(window, cx);
            return;
        }
        if key == "enter" || key == "space" {
            if let Some(session) = &self.drag.session {
                let active = session.info.clone();
                self.drop_blocks(&active, window, cx);
            } else {
                self.begin_drag(info.clone(), true, cx);
            }
            return;
        }
        let Some(session) = &self.drag.session else {
            return;
        };
        if !session.keyboard || !self.valid_drag(&session.info, cx.entity_id()) {
            self.cancel_drag(cx);
            return;
        }
        let after = key == "down";
        let measured = self.drag.measured.borrow();
        let choices: Vec<_> = if session.info.section {
            session
                .sections
                .iter()
                .flat_map(|section| {
                    [DropPlacement::Before, DropPlacement::After].map(|placement| {
                        self.section_preview(session, section.start, placement, &measured)
                    })
                })
                .flatten()
                .collect()
        } else {
            let parent = &session.info.source[..session.info.source.len() - 1];
            measured
                .keys()
                .filter(|path| path.len() == session.info.source.len() && path.starts_with(parent))
                .flat_map(|path| {
                    [DropPlacement::Before, DropPlacement::After]
                        .map(|placement| self.atom_preview(session, path, placement))
                })
                .flatten()
                .collect()
        };
        let current = session.preview.as_ref().map_or_else(
            || {
                self.document()
                    .offset_of_node(&session.info.source)
                    .unwrap_or(0)
            },
            |p| p.plan.destination,
        );
        let next = if after {
            choices
                .into_iter()
                .filter(|p| p.plan.destination > current)
                .min_by_key(|p| p.plan.destination)
        } else {
            choices
                .into_iter()
                .filter(|p| p.plan.destination < current)
                .max_by_key(|p| p.plan.destination)
        };
        drop(measured);
        if let Some(session) = &mut self.drag.session {
            session.preview = next.or_else(|| session.preview.clone());
        }
        cx.notify();
    }
}

fn info(node: &Node, path: &[usize], renderer: &RichRender<'_>, section: bool) -> DragInfo {
    let label = if section {
        let mut text = String::new();
        node.write_editing_text(&mut text);
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            "Untitled section".to_owned()
        } else {
            text
        }
    } else {
        match node.as_element().map(|e| &e.kind) {
            Some(NodeKind::Image) => "Image".to_owned(),
            Some(NodeKind::Mermaid) => "Diagram".to_owned(),
            _ => "Equation".to_owned(),
        }
    };
    DragInfo {
        owner: renderer.entity.entity_id(),
        revision: renderer.state.revision(),
        selection: renderer.state.selection(),
        source: path.to_vec(),
        node: node.clone(),
        section,
        label: label.into(),
    }
}

fn start(
    info: &DragInfo,
    offset: Point<Pixels>,
    view: &WeakEntity<RichEditorView>,
    window: &mut Window,
    cx: &mut App,
) -> Entity<Preview> {
    let visible = view
        .update(cx, |this, cx| this.begin_drag(info.clone(), false, cx))
        .unwrap_or(false);
    // GPUI positions the ghost at mouse-offset. Keep the lightweight preview
    // under the actual pointer; the source block remains where it was.
    let _ = window;
    cx.new(|_| Preview {
        label: info.label.clone(),
        offset,
        visible,
    })
}

pub(super) fn heading_handle(
    node: &Node,
    path: &[usize],
    top: f32,
    renderer: &RichRender<'_>,
) -> AnyElement {
    let info = info(node, path, renderer, true);
    let focus = renderer.state.drag.focus(node, renderer.cx);
    let drag_view = renderer.entity.downgrade();
    let key_view = renderer.entity.clone();
    let key_info = info.clone();
    let pointer_focus = focus.clone();
    let key_focus = focus.clone();
    div()
        .id(SharedString::from(format!(
            "twyne-section-drag-{}",
            path[0]
        )))
        .test_support()
        .role(Role::Button)
        .aria_label(SharedString::from(format!("Move section: {}", info.label)))
        .aria_description(
            "Enter or Space to pick up; arrows to place; Enter to drop; Escape to cancel",
        )
        .key_context("TwyneBlockHandle")
        .track_focus(&focus)
        .absolute()
        .left(px(-24.))
        .top(px(3.2 - top))
        .w(px(8.))
        .h(px(32.4))
        .font_family(SERIF_FONT)
        .text_size(px(18.))
        .line_height(px(32.4))
        .whitespace_nowrap()
        .text_color(rgb(theme::palette(renderer.cx).ink).opacity(0.55))
        .cursor(CursorStyle::OpenHand)
        .child("⋮⋮")
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            window.focus(&pointer_focus, cx);
            window.prevent_default();
        })
        .on_key_down(move |event, window, cx| {
            // A descendant textarea owns its own keys. Drag commands apply
            // only while this actual handle owns focus, not its descendants.
            if key_focus.is_focused(window) {
                key_view.update(cx, |this, cx| this.handle_key(&key_info, event, window, cx));
            }
        })
        .when(
            !renderer.state.is_read_only() && renderer.state.marked_range.is_none(),
            |this| {
                this.on_drag(info, move |info, offset, window, cx| {
                    start(info, offset, &drag_view, window, cx)
                })
            },
        )
        .into_any_element()
}

pub(super) fn measure(
    node: &Node,
    path: NodePath,
    inner: AnyElement,
    renderer: &RichRender<'_>,
    placement: Option<paginated::BlockPlacement>,
) -> AnyElement {
    let Some(element) = node.as_element() else {
        return inner;
    };
    if !element.kind.is_block() {
        return inner;
    }
    let draggable = matches!(
        element.kind,
        NodeKind::Image | NodeKind::Math(MathDisplay::Block) | NodeKind::Mermaid
    );
    let inner = if draggable {
        let info = info(node, &path, renderer, false);
        let focus = renderer.state.drag.focus(node, renderer.cx);
        let drag_view = renderer.entity.downgrade();
        let key_view = renderer.entity.clone();
        let key_info = info.clone();
        let select_view = renderer.entity.clone();
        let selection_info = info.clone();
        let pointer_focus = focus.clone();
        let key_focus = focus.clone();
        div()
            .id(SharedString::from(format!(
                "twyne-atom-drag-{}",
                path.iter()
                    .map(usize::to_string)
                    .collect::<Vec<_>>()
                    .join(".")
            )))
            .test_support()
            .role(Role::Button)
            .aria_label(SharedString::from(format!(
                "Move {}",
                info.label.to_lowercase()
            )))
            .aria_description(
                "Enter or Space to pick up; arrows to place; Enter to drop; Escape to cancel",
            )
            .key_context("TwyneBlockHandle")
            .track_focus(&focus)
            .w_full()
            .child(inner)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                window.focus(&pointer_focus, cx);
                window.prevent_default();
            })
            .on_key_down(move |event, window, cx| {
                // A descendant textarea owns its own keys. Drag commands apply
                // only while this actual handle owns focus, not its descendants.
                if key_focus.is_focused(window) {
                    key_view.update(cx, |this, cx| this.handle_key(&key_info, event, window, cx));
                }
            })
            .on_click(move |_, window, cx| {
                select_view.update(cx, |this, cx| {
                    if this.drag.is_active() {
                        return;
                    }
                    if this.revision() == selection_info.revision
                        && let Some(offset) = this.document().offset_of_node(&selection_info.source)
                    {
                        let _ = this.set_selection(
                            Selection::new(offset, offset + selection_info.node.projection_len()),
                            cx,
                        );
                        window.focus(&this.focus, cx);
                    }
                })
            })
            .when(
                !renderer.state.is_read_only() && renderer.state.marked_range.is_none(),
                |this| {
                    this.on_drag(info, move |info, offset, window, cx| {
                        start(info, offset, &drag_view, window, cx)
                    })
                },
            )
            .into_any_element()
    } else {
        inner
    };
    MeasuredElement {
        view: renderer.entity.clone(),
        path,
        revision: renderer.state.revision(),
        inner,
        placement,
    }
    .into_any_element()
}

struct MeasuredElement {
    view: Entity<RichEditorView>,
    path: NodePath,
    revision: u64,
    inner: AnyElement,
    placement: Option<paginated::BlockPlacement>,
}
impl IntoElement for MeasuredElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl gpui_kit::Element for MeasuredElement {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.inner.request_layout(window, cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.inner.prepaint(window, cx);
        let bounds = self
            .placement
            .as_ref()
            .and_then(|placement| placement.outer())
            .unwrap_or(bounds);
        let view = self.view.read(cx);
        if view.revision() == self.revision {
            view.drag
                .measured
                .borrow_mut()
                .insert(self.path.clone(), MeasuredNode { bounds });
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.inner.paint(window, cx);
        let bounds = self
            .placement
            .as_ref()
            .and_then(|placement| placement.outer())
            .unwrap_or(bounds);
        let preview = self.view.read(cx).drag.session.as_ref().and_then(|s| {
            s.preview
                .as_ref()
                .filter(|p| p.indicator == self.path)
                .map(|p| (p.placement, s.info.section))
        });
        if let Some((placement, section)) = preview {
            let y = if placement == DropPlacement::Before {
                bounds.top()
            } else {
                bounds.bottom()
            };
            window.paint_quad(fill(
                Bounds::new(point(bounds.left(), y), size(bounds.size.width, px(2.))),
                rgb(if section {
                    0x6d5dfc
                } else {
                    theme::palette(cx).vermilion
                }),
            ));
        }
    }
}
