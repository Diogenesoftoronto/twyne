//! Twyne's native compositor ribbon. The four task tabs and their controls
//! follow the production editor overrides, including its 40px ribbon.
//! Document commands execute against the rich editor; workspace capabilities
//! remain explicit events whose buttons are enabled by the application.

use crate::{
    assets::{self, TwyneIcon},
    editor::{
        Alignment, BlockObject, Command, ElementShell, ImageAttributes, InlineObject, ListKind,
        Mark, MarkKind, NodeKind, NoteKind, ParagraphFormat, Selection, TextCase,
        view::RichEditorView,
    },
    theme::{self, DISPLAY_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT},
    view_state::CompositorTab,
    workspace::{
        DocWidth, LayoutSettings, OpeningInitialCollection, OpeningInitialMode,
        OpeningInitialSettings, OpeningInitialSize, Orientation, PageBorderStyle, PaginationMode,
        PaperSize,
    },
};
use gpui_kit::component::{
    Disableable, IndexPath, Selectable, Sizable,
    button::{Button, ButtonVariants},
    checkbox::Checkbox,
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    searchable_list::SearchableVec,
    select::{Select, SelectEvent, SelectItem, SelectState},
    slider::{Slider, SliderEvent, SliderState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight,
    IntoElement, KeyBinding, MouseButton, Render, Role, ScrollHandle, SharedString, Subscription,
    TestSupportExt, Window, anchored, deferred, div, point, px, relative, rgb,
};

const FONT_CHOICES: [(&str, &str); 6] = [
    ("Lora (default)", ""),
    ("Lora (serif)", "\"Lora\", Georgia, serif"),
    (
        "Libre Baskerville (display)",
        "\"Libre Baskerville\", Georgia, serif",
    ),
    ("DM Sans", "\"DM Sans\", system-ui, sans-serif"),
    ("Special Elite", "\"Special Elite\", Courier, monospace"),
    (
        "Monospace",
        "ui-monospace, \"SFMono-Regular\", Consolas, monospace",
    ),
];
const FONT_SIZES: [(&str, &str); 12] = [
    ("13.5", ""),
    ("9", "9pt"),
    ("10", "10pt"),
    ("11", "11pt"),
    ("12", "12pt"),
    ("14", "14pt"),
    ("16", "16pt"),
    ("18", "18pt"),
    ("24", "24pt"),
    ("30", "30pt"),
    ("36", "36pt"),
    ("48", "48pt"),
];
const LINE_SPACINGS: [(&str, &str); 4] = [
    ("Single", "1"),
    ("1.15", "1.15"),
    ("1.5", "1.5"),
    ("Double", "2"),
];
const PARAGRAPH_SPACINGS: [(&str, &str); 6] = [
    ("Default", ""),
    ("None", "0"),
    ("6 pt", "6"),
    ("12 pt", "12"),
    ("18 pt", "18"),
    ("24 pt", "24"),
];
const HIGHLIGHTS: [(&str, &str); 6] = [
    ("Butter", "#fbeaa8"),
    ("Rose", "#f8d3d4"),
    ("Sky", "#cfe0f2"),
    ("Mint", "#d5e6c4"),
    ("Lilac", "#dcdff4"),
    ("Peach", "#fadfd5"),
];
const TEXT_COLORS: [(&str, &str); 7] = [
    ("Ink", "#1f1b16"),
    ("Vermilion", "#c1272d"),
    ("Cobalt", "#2c4a7c"),
    ("Olive", "#556134"),
    ("Periwinkle", "#454f9e"),
    ("Amber", "#7a5a07"),
    ("Sienna", "#964f40"),
];

#[derive(Clone, Copy, Debug, Default)]
pub struct CompositorCapabilities {
    pub save_pdf: bool,
    pub image_file: bool,
    pub margin_notes: bool,
    pub read_aloud: bool,
    pub version_history: bool,
    pub find: bool,
    pub grammar: bool,
    pub outline: bool,
    pub live_voice: bool,
    pub persona_comments: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChromeTextKind {
    Header,
    Footer,
}

#[derive(Clone, Debug)]
pub enum CompositorEvent {
    LayoutChanged(LayoutSettings),
    ChromeTextChanged { kind: ChromeTextKind, value: String },
    SavePdfRequested { include_persona_comments: bool },
    ImageFileRequested { selection: Selection },
    MarginNoteRequested { selection: Selection },
    ReadAloudRequested,
    VersionHistoryRequested,
    FindRequested,
    GrammarRequested,
    OutlineRequested,
    LiveVoiceRequested,
    Error(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Popup {
    Highlight,
    TextColor,
    Type,
    Layout,
    Table,
    Image,
    Note(NoteKind),
    Diagram,
    Shortcuts,
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

struct Controls {
    font: ChoiceState,
    size: ChoiceState,
    style: ChoiceState,
    before: ChoiceState,
    after: ChoiceState,
    header: Entity<InputState>,
    footer: Entity<InputState>,
    color: Entity<InputState>,
    image: Entity<InputState>,
    note: Entity<TextareaState>,
    diagram: Entity<TextareaState>,
}

#[derive(Default)]
struct Active {
    marks: Vec<Mark>,
    paragraph: Option<ElementShell>,
    kinds: Vec<NodeKind>,
    selection: Selection,
    read_only: bool,
}
impl Active {
    fn marked(&self, kind: MarkKind) -> bool {
        self.marks.iter().any(|mark| mark.kind() == kind)
    }
    fn mark_value(&self, kind: MarkKind) -> Option<&str> {
        self.marks.iter().find_map(|mark| match mark {
            Mark::Highlight(value)
            | Mark::FontFamily(value)
            | Mark::FontSize(value)
            | Mark::Color(value)
                if mark.kind() == kind =>
            {
                Some(value.as_str())
            }
            _ => None,
        })
    }
    fn heading(&self) -> Option<u8> {
        self.kinds.iter().find_map(|kind| match kind {
            NodeKind::Heading(level) => Some(*level),
            _ => None,
        })
    }
    fn kind(&self, kind: &NodeKind) -> bool {
        self.kinds.contains(kind)
    }
    fn style(&self, property: &str) -> Option<String> {
        self.paragraph
            .as_ref()
            .and_then(|shell| shell.style(property))
    }
    fn attribute(&self, name: &str) -> Option<&str> {
        self.paragraph.as_ref().and_then(|shell| shell.attr(name))
    }
    fn keep_with_next(&self) -> bool {
        self.heading().is_some() || self.attribute("data-keep-with-next") == Some("true")
    }
}

gpui_kit::actions!(
    twyne_compositor,
    [
        ClosePopup,
        CommitPopup,
        GridUp,
        GridDown,
        GridLeft,
        GridRight,
        GridHome,
        GridEnd
    ]
);

pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("escape", ClosePopup, Some("TwyneCompositor")),
        KeyBinding::new("enter", CommitPopup, Some("TwyneCompositorGrid")),
        KeyBinding::new("up", GridUp, Some("TwyneCompositorGrid")),
        KeyBinding::new("down", GridDown, Some("TwyneCompositorGrid")),
        KeyBinding::new("left", GridLeft, Some("TwyneCompositorGrid")),
        KeyBinding::new("right", GridRight, Some("TwyneCompositorGrid")),
        KeyBinding::new("home", GridHome, Some("TwyneCompositorGrid")),
        KeyBinding::new("end", GridEnd, Some("TwyneCompositorGrid")),
    ]);
}

pub struct CompositorView {
    editor: Option<Entity<RichEditorView>>,
    editor_subscription: Option<Subscription>,
    pub layout: LayoutSettings,
    tab: CompositorTab,
    capabilities: CompositorCapabilities,
    active: Active,
    controls: Option<Controls>,
    subscriptions: Vec<Subscription>,
    focus: FocusHandle,
    popup: Option<Popup>,
    popup_scroll: ScrollHandle,
    focused_chrome: Option<ChromeTextKind>,
    header: String,
    footer: String,
    last_highlight: String,
    recent_colors: Vec<String>,
    sliders: [Entity<SliderState>; 5],
    table_rows: usize,
    table_columns: usize,
    include_persona_comments: bool,
    preparing_pdf: bool,
    read_only: bool,
    error: Option<String>,
}
impl EventEmitter<CompositorEvent> for CompositorView {}
impl Focusable for CompositorView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl CompositorView {
    /// Input/select controls are hydrated on the first frame, when a native
    /// Window exists. Construction itself needs only an editor and layout.
    pub fn new(
        editor: Option<Entity<RichEditorView>>,
        layout: LayoutSettings,
        cx: &mut Context<Self>,
    ) -> Self {
        let margins = layout.resolve_margins();
        let values = [
            margins.left,
            margins.right,
            margins.top,
            margins.bottom,
            layout.resolve_column_gap(),
        ];
        let sliders = std::array::from_fn(|index| {
            cx.new(|_| {
                SliderState::new()
                    .min(if index == 4 { 0.75 } else { 0.0 })
                    .max(if index == 4 { 3.0 } else { 8.0 })
                    .step(0.25)
                    .default_value(values[index] as f32)
            })
        });
        let popup_scroll = ScrollHandle::new();
        let mut view = Self {
            editor: None,
            editor_subscription: None,
            layout,
            tab: CompositorTab::Home,
            capabilities: CompositorCapabilities::default(),
            active: Active::default(),
            controls: None,
            subscriptions: Vec::new(),
            focus: cx.focus_handle(),
            popup: None,
            focused_chrome: None,
            popup_scroll,
            header: String::new(),
            footer: String::new(),
            last_highlight: "#fbeaa8".into(),
            recent_colors: Vec::new(),
            sliders,
            table_rows: 1,
            table_columns: 1,
            include_persona_comments: false,
            preparing_pdf: false,
            read_only: false,
            error: None,
        };
        for (index, slider) in view.sliders.iter().enumerate() {
            view.subscriptions.push(cx.subscribe(
                slider,
                move |this, _, event: &SliderEvent, cx| {
                    if let SliderEvent::Change(value) = event {
                        this.measurement(index, f64::from(value.start()), cx);
                    }
                },
            ));
        }
        view.set_editor(editor, cx);
        view
    }
    pub fn set_editor(&mut self, editor: Option<Entity<RichEditorView>>, cx: &mut Context<Self>) {
        self.editor_subscription = editor.as_ref().map(|editor| {
            cx.observe(editor, |this, _, cx| {
                this.refresh(cx);
                cx.notify();
            })
        });
        self.editor = editor;
        self.refresh(cx);
        cx.notify();
    }
    pub fn set_tab(&mut self, tab: CompositorTab, cx: &mut Context<Self>) {
        self.flush_chrome_text(cx);
        self.tab = tab;
        self.popup = None;
        cx.notify();
    }
    pub fn tab(&self) -> CompositorTab {
        self.tab
    }
    pub fn set_capabilities(
        &mut self,
        capabilities: CompositorCapabilities,
        cx: &mut Context<Self>,
    ) {
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        self.read_only = read_only;
        cx.notify();
    }
    pub fn set_preparing_pdf(&mut self, preparing: bool, cx: &mut Context<Self>) {
        self.preparing_pdf = preparing;
        cx.notify();
    }
    pub fn set_layout(
        &mut self,
        layout: LayoutSettings,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.layout = layout;
        let margins = self.layout.resolve_margins();
        for (slider, value) in self.sliders.iter().zip([
            margins.left,
            margins.right,
            margins.top,
            margins.bottom,
            self.layout.resolve_column_gap(),
        ]) {
            if slider.read(cx).value().start() != value as f32 {
                slider.update(cx, |state, cx| state.set_value(value as f32, window, cx));
            }
        }
        cx.notify();
    }
    pub fn set_chrome_text(
        &mut self,
        header: impl Into<String>,
        footer: impl Into<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.header = header.into();
        self.footer = footer.into();
        if let Some(controls) = &self.controls {
            controls.header.update(cx, |state, cx| {
                state.set_value(self.header.clone(), window, cx)
            });
            controls.footer.update(cx, |state, cx| {
                state.set_value(self.footer.clone(), window, cx)
            });
        }
        cx.notify();
    }
    pub fn flush_chrome_text(&mut self, cx: &mut Context<Self>) {
        if self.read_only || self.active.read_only {
            return;
        }
        if let Some(controls) = &self.controls {
            for (kind, value) in [
                (
                    ChromeTextKind::Header,
                    controls.header.read(cx).text().to_string(),
                ),
                (
                    ChromeTextKind::Footer,
                    controls.footer.read(cx).text().to_string(),
                ),
            ] {
                let previous = if kind == ChromeTextKind::Header {
                    &mut self.header
                } else {
                    &mut self.footer
                };
                if *previous != value {
                    *previous = value.clone();
                    cx.emit(CompositorEvent::ChromeTextChanged { kind, value });
                }
            }
        }
    }
    /// Reads the current native controls synchronously, including an edit
    /// whose Change event has not yet reached the workspace subscriber.
    pub fn chrome_text(&self, cx: &App) -> (String, String) {
        self.controls
            .as_ref()
            .map(|controls| {
                (
                    controls.header.read(cx).text().to_string(),
                    controls.footer.read(cx).text().to_string(),
                )
            })
            .unwrap_or_else(|| (self.header.clone(), self.footer.clone()))
    }
    pub fn insert_image(
        &mut self,
        image: ImageAttributes,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.execute(
            Command::InsertBlock(BlockObject::Image(image)),
            true,
            window,
            cx,
        );
    }
    fn editable(&self) -> bool {
        self.editor.is_some() && !self.active.read_only && !self.read_only
    }
    fn refresh(&mut self, cx: &App) {
        let Some(editor) = &self.editor else {
            self.active = Active::default();
            return;
        };
        let view = editor.read(cx);
        let selection = view.selection();
        let document = view.document();
        let block = document.block_at_offset(selection.head);
        let mut kinds = Vec::new();
        let mut paragraph = None;
        if let Some(block) = block {
            paragraph = block.node.as_element().map(|element| element.shell.clone());
            for length in 1..=block.path.len() {
                if let Some(element) = document
                    .node(&block.path[..length])
                    .and_then(|node| node.as_element())
                {
                    kinds.push(element.kind.clone());
                }
            }
        }
        self.active = Active {
            marks: view.active_marks(),
            paragraph,
            kinds,
            selection,
            read_only: view.is_read_only(),
        };
    }
    fn execute(
        &mut self,
        command: Command,
        close: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.editable() {
            return;
        }
        let Some(editor) = self.editor.clone() else {
            return;
        };
        match editor.update(cx, |editor, cx| editor.execute(command, window, cx)) {
            Ok(_) => {
                self.error = None;
                if close {
                    self.popup = None;
                }
            }
            Err(error) => {
                self.error = Some(error.to_string());
                cx.emit(CompositorEvent::Error(error.to_string()));
            }
        }
        self.refresh(cx);
        if self.popup.is_none() {
            window.focus(&editor.read(cx).focus_handle(cx), cx);
        } else {
            window.focus(&self.focus, cx);
        }
        cx.notify();
    }
    fn change_layout(&mut self, update: impl FnOnce(&mut LayoutSettings), cx: &mut Context<Self>) {
        if self.read_only || self.active.read_only {
            return;
        }
        let mut next = self.layout.clone();
        update(&mut next);
        if next != self.layout {
            self.layout = next.clone();
            cx.emit(CompositorEvent::LayoutChanged(next));
            cx.notify();
        }
    }
    fn measurement(&mut self, index: usize, value: f64, cx: &mut Context<Self>) {
        self.change_layout(
            |layout| match index {
                0 => layout.margin_left = Some(value),
                1 => layout.margin_right = Some(value),
                2 => layout.margin_top = Some(value),
                3 => layout.margin_bottom = Some(value),
                _ => layout.column_gap = Some(value),
            },
            cx,
        );
    }
    fn opening(
        &mut self,
        update: impl FnOnce(&mut OpeningInitialSettings),
        cx: &mut Context<Self>,
    ) {
        self.change_layout(
            |layout| {
                let mut initial = layout.opening_initial.clone().unwrap_or_default();
                update(&mut initial);
                layout.opening_initial = Some(initial);
            },
            cx,
        );
    }
    fn toggle_popup(&mut self, popup: Popup, window: &mut Window, cx: &mut Context<Self>) {
        self.flush_chrome_text(cx);
        self.popup = if self.popup == Some(popup) {
            None
        } else {
            Some(popup)
        };
        self.popup_scroll.set_offset(point(px(0.), px(0.)));
        self.error = None;
        if let Some(controls) = &self.controls {
            if matches!(popup, Popup::Note(_)) {
                controls
                    .note
                    .update(cx, |state, cx| state.set_value("", window, cx));
            }
            if popup == Popup::Diagram {
                controls
                    .diagram
                    .update(cx, |state, cx| state.set_value("", window, cx));
            }
            if popup == Popup::Image {
                controls
                    .image
                    .update(cx, |state, cx| state.set_value("", window, cx));
            }
            if matches!(popup, Popup::Highlight | Popup::TextColor) {
                let color = self
                    .active
                    .mark_value(if popup == Popup::Highlight {
                        MarkKind::Highlight
                    } else {
                        MarkKind::Color
                    })
                    .unwrap_or(if popup == Popup::Highlight {
                        &self.last_highlight
                    } else {
                        "#c1272d"
                    })
                    .to_owned();
                controls
                    .color
                    .update(cx, |state, cx| state.set_value(color, window, cx));
            }
        }
        let target = self
            .controls
            .as_ref()
            .and_then(|controls| match self.popup {
                Some(Popup::Note(_)) => Some(controls.note.read(cx).focus_handle(cx)),
                Some(Popup::Diagram) => Some(controls.diagram.read(cx).focus_handle(cx)),
                Some(Popup::Image) => Some(controls.image.read(cx).focus_handle(cx)),
                _ => None,
            })
            .unwrap_or_else(|| self.focus.clone());
        window.focus(&target, cx);
        cx.notify();
    }
    pub fn close_popup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.flush_chrome_text(cx);
        self.popup = None;
        if let Some(editor) = &self.editor {
            window.focus(&editor.read(cx).focus_handle(cx), cx);
        }
        cx.notify();
    }
    fn choose_color(&mut self, raw: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let kind = if self.popup == Some(Popup::Highlight) {
            MarkKind::Highlight
        } else {
            MarkKind::Color
        };
        let command = match raw {
            None => Command::UnsetMark(kind),
            Some(raw) => {
                let Some(hex) = normalize_hex(raw) else {
                    self.error = Some("Enter a colour such as #c1272d.".into());
                    cx.notify();
                    return;
                };
                self.recent_colors.retain(|previous| previous != &hex);
                self.recent_colors.insert(0, hex.clone());
                self.recent_colors.truncate(8);
                if kind == MarkKind::Highlight {
                    self.last_highlight = hex.clone();
                    Command::SetMark(Mark::Highlight(hex))
                } else {
                    Command::SetMark(Mark::Color(hex))
                }
            }
        };
        self.execute(command, true, window, cx);
    }
    fn commit_popup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(controls) = &self.controls else {
            return;
        };
        let command = match self.popup {
            Some(Popup::Table) => Command::InsertBlock(BlockObject::Table {
                rows: self.table_rows,
                columns: self.table_columns,
                header: true,
            }),
            Some(Popup::Image) => {
                let src = controls.image.read(cx).text().to_string();
                if src.trim().is_empty() {
                    return;
                }
                Command::InsertBlock(BlockObject::Image(ImageAttributes {
                    src: src.trim().into(),
                    ..ImageAttributes::default()
                }))
            }
            Some(Popup::Note(kind)) => {
                let text = controls.note.read(cx).text().to_string();
                if text.trim().is_empty() {
                    self.close_popup(window, cx);
                    return;
                }
                Command::InsertInline(InlineObject::Note {
                    kind,
                    text: text.trim().into(),
                })
            }
            Some(Popup::Diagram) => {
                let source = controls.diagram.read(cx).text().to_string();
                if source.trim().is_empty() {
                    self.close_popup(window, cx);
                    return;
                }
                Command::InsertBlock(BlockObject::Mermaid {
                    source: source.trim().into(),
                })
            }
            Some(Popup::Highlight | Popup::TextColor) => {
                let raw = controls.color.read(cx).text().to_string();
                self.choose_color(Some(&raw), window, cx);
                return;
            }
            _ => return,
        };
        self.execute(command, true, window, cx);
    }
    fn ensure_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.controls.is_some() {
            return;
        }
        let select = |options: &[(&str, &str)], window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| {
                SelectState::new(
                    SearchableVec::new(
                        options
                            .iter()
                            .map(|(label, value)| Choice {
                                label: (*label).to_owned().into(),
                                value: (*value).into(),
                            })
                            .collect::<Vec<_>>(),
                    ),
                    Some(IndexPath::new(0)),
                    window,
                    cx,
                )
            })
        };
        let font = select(&FONT_CHOICES, window, cx);
        let size = select(&FONT_SIZES, window, cx);
        let style = select(
            &[
                ("Text", "paragraph"),
                ("Title", "h1"),
                ("Heading", "h2"),
                ("Subheading", "h3"),
            ],
            window,
            cx,
        );
        let before = select(&PARAGRAPH_SPACINGS, window, cx);
        let after = select(&PARAGRAPH_SPACINGS, window, cx);
        for (index, state) in [&font, &size, &style, &before, &after]
            .into_iter()
            .enumerate()
        {
            self.subscriptions.push(cx.subscribe_in(
                state,
                window,
                move |this, _, event: &SelectEvent<Choices>, window, cx| {
                    let SelectEvent::Confirm(Some(value)) = event else {
                        return;
                    };
                    let command = match index {
                        0 => {
                            if value.is_empty() {
                                Command::UnsetMark(MarkKind::FontFamily)
                            } else {
                                Command::SetMark(Mark::FontFamily(value.clone()))
                            }
                        }
                        1 => {
                            if value.is_empty() {
                                Command::UnsetMark(MarkKind::FontSize)
                            } else {
                                Command::SetMark(Mark::FontSize(value.clone()))
                            }
                        }
                        2 => match value.as_str() {
                            "h1" => Command::SetHeading(1),
                            "h2" => Command::SetHeading(2),
                            "h3" => Command::SetHeading(3),
                            _ => Command::SetParagraph,
                        },
                        3 => Command::SetParagraphFormat(ParagraphFormat {
                            space_before: Some(value.parse().ok()),
                            ..ParagraphFormat::default()
                        }),
                        _ => Command::SetParagraphFormat(ParagraphFormat {
                            space_after: Some(value.parse().ok()),
                            ..ParagraphFormat::default()
                        }),
                    };
                    this.execute(command, false, window, cx);
                },
            ));
        }
        let input = |placeholder: &'static str,
                     value: &str,
                     window: &mut Window,
                     cx: &mut Context<Self>| {
            let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
            state.update(cx, |state, cx| state.set_value(value, window, cx));
            state
        };
        let header = input("Optional running header", &self.header, window, cx);
        let footer = input("Optional running footer", &self.footer, window, cx);
        let color = input("#c1272d", "#c1272d", window, cx);
        let image = input("https://…", "", window, cx);
        let note = cx.new(|cx| TextareaState::new(window, cx));
        let diagram = cx.new(|cx| TextareaState::new(window, cx).placeholder("graph TD; A[Manuscript] --> B{Reviewed?}; B -->|Yes| C[Publish]; B -->|No| D[Revise]; D --> A"));
        for state in [&header, &footer] {
            self.subscriptions
                .push(cx.subscribe(state, |this, _, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.flush_chrome_text(cx);
                        cx.notify();
                    }
                }));
        }
        for state in [&color, &image] {
            self.subscriptions.push(cx.subscribe_in(
                state,
                window,
                |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::PressEnter { .. }) {
                        this.commit_popup(window, cx);
                    } else if matches!(event, InputEvent::Change) {
                        cx.notify();
                    }
                },
            ));
        }
        for state in [&note, &diagram] {
            self.subscriptions.push(cx.subscribe_in(
                state,
                window,
                |this, _, event: &InputEvent, window, cx| {
                    if matches!(
                        event,
                        InputEvent::PressEnter {
                            secondary: true,
                            ..
                        }
                    ) {
                        this.commit_popup(window, cx);
                    }
                },
            ));
        }
        self.controls = Some(Controls {
            font,
            size,
            style,
            before,
            after,
            header,
            footer,
            color,
            image,
            note,
            diagram,
        });
    }
    fn sync_selects(&self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(controls) = &self.controls else {
            return;
        };
        let style = match self.active.heading() {
            Some(1) => "h1",
            Some(2) => "h2",
            Some(3) => "h3",
            _ => "paragraph",
        };
        for (state, value) in [
            (
                &controls.font,
                self.active
                    .mark_value(MarkKind::FontFamily)
                    .unwrap_or("")
                    .to_owned(),
            ),
            (
                &controls.size,
                self.active
                    .mark_value(MarkKind::FontSize)
                    .unwrap_or("")
                    .to_owned(),
            ),
            (&controls.style, style.into()),
            (
                &controls.before,
                self.active
                    .attribute("data-space-before")
                    .unwrap_or("")
                    .to_owned(),
            ),
            (
                &controls.after,
                self.active
                    .attribute("data-space-after")
                    .unwrap_or("")
                    .to_owned(),
            ),
        ] {
            if state.read(cx).selected_value() != Some(&value) {
                state.update(cx, |state, cx| state.set_selected_value(&value, window, cx));
            }
        }
    }
}

fn normalize_hex(value: &str) -> Option<String> {
    let body = value.trim().strip_prefix('#').unwrap_or(value.trim());
    if !matches!(body.len(), 3 | 6) || !body.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let body = if body.len() == 3 {
        body.chars()
            .flat_map(|character| [character, character])
            .collect::<String>()
    } else {
        body.into()
    };
    Some(format!("#{}", body.to_ascii_lowercase()))
}

impl CompositorView {
    fn tool(
        &self,
        id: &'static str,
        content: (Option<&'static str>, Option<TwyneIcon>),
        name: &'static str,
        selected: bool,
        disabled: bool,
        cx: &App,
    ) -> Button {
        let (label, icon) = content;
        let colors = *theme::palette(cx);
        Button::new(id)
            .ghost()
            .small()
            .h(px(30.))
            .px(px(8.))
            .rounded(px(2.))
            .font_family(TYPEWRITER_FONT)
            .text_size(px(14.))
            .text_color(rgb(colors.ink_light))
            .accessibility_label(name)
            .tooltip(name)
            .disabled(disabled)
            .opacity(if disabled { 0.3 } else { 1.0 })
            .selected(selected)
            .toggled(selected)
            .when_some(label, |this, label| this.label(label))
            .when_some(icon, |this, icon| this.child(assets::icon(icon)))
            .when(selected, |this| {
                this.text_color(rgb(colors.vermilion))
                    .bg(rgb(colors.sidebar))
                    .border_b_2()
                    .border_color(rgb(colors.vermilion))
            })
    }
    fn command_tool(
        &self,
        id: &'static str,
        content: (Option<&'static str>, Option<TwyneIcon>),
        name: &'static str,
        selected: bool,
        command: Command,
        cx: &mut Context<Self>,
    ) -> Button {
        let (label, icon) = content;
        self.tool(id, (label, icon), name, selected, !self.editable(), cx)
            .on_click(cx.listener(move |this, _, window, cx| {
                this.execute(command.clone(), false, window, cx)
            }))
    }
    fn popup_tool(
        &self,
        id: &'static str,
        content: (Option<&'static str>, Option<TwyneIcon>),
        name: &'static str,
        popup: Popup,
        editor_required: bool,
        cx: &mut Context<Self>,
    ) -> Button {
        let (label, icon) = content;
        self.tool(
            id,
            (label, icon),
            name,
            self.popup == Some(popup),
            editor_required && !self.editable(),
            cx,
        )
        .on_click(cx.listener(move |this, _, window, cx| this.toggle_popup(popup, window, cx)))
    }
    fn group(
        &self,
        name: &'static str,
        cx: &App,
    ) -> gpui_kit::base::ObservedElement<gpui_kit::Stateful<gpui_kit::Div>> {
        div()
            .id(SharedString::from(format!("compositor-group-{name}")))
            .test_support()
            .role(Role::Group)
            .aria_label(name)
            .flex()
            .items_center()
            .flex_shrink_0()
            .h(px(36.))
            .px(px(6.))
            .gap(px(1.))
            .border_r_1()
            .border_color(rgb(theme::palette(cx).rule))
    }
    fn selection_control(
        &self,
        id: &'static str,
        name: &'static str,
        state: &ChoiceState,
        width: f32,
        cx: &App,
    ) -> AnyElement {
        let colors = *theme::palette(cx);
        Select::new(state)
            .id(id)
            .accessibility_label(name)
            .small()
            .w(px(width))
            .h(px(30.))
            .font_family(SANS_FONT)
            .text_size(px(11.2))
            .bg(rgb(colors.paper))
            .text_color(rgb(colors.ink))
            .rounded(px(2.))
            .border_color(rgb(colors.rule))
            .disabled(!self.editable())
            .into_any_element()
    }
    fn home(&self, cx: &mut Context<Self>) -> AnyElement {
        let controls = self.controls.as_ref().expect("native controls hydrated");
        let mut character = self.group("Character", cx);
        for (id, label, name, mark) in [
            ("compositor-bold", "B", "Bold", Mark::Bold),
            ("compositor-italic", "I", "Italic", Mark::Italic),
            ("compositor-underline", "U", "Underline", Mark::Underline),
            ("compositor-strike", "S", "Strikethrough", Mark::Strike),
            (
                "compositor-superscript",
                "x²",
                "Superscript",
                Mark::Superscript,
            ),
            ("compositor-subscript", "x₂", "Subscript", Mark::Subscript),
        ] {
            let selected = self.active.marked(mark.kind());
            let button = self
                .command_tool(
                    id,
                    (Some(label), None),
                    name,
                    selected,
                    Command::ToggleMark(mark),
                    cx,
                )
                .font_family(DISPLAY_FONT)
                .when(name == "Bold", |this| this.font_weight(FontWeight::BOLD))
                .when(name == "Italic", |this| this.italic())
                .when(name == "Underline", |this| this.underline())
                .when(name == "Strikethrough", |this| this.line_through());
            character = character.child(button);
        }
        character = character
            .child(
                self.tool(
                    "compositor-highlight",
                    (Some("Hi"), None),
                    "Highlight",
                    self.active.marked(MarkKind::Highlight),
                    !self.editable(),
                    cx,
                )
                .on_click(cx.listener(|this, _, window, cx| {
                    let command = if this.active.marked(MarkKind::Highlight) {
                        Command::UnsetMark(MarkKind::Highlight)
                    } else {
                        Command::SetMark(Mark::Highlight(this.last_highlight.clone()))
                    };
                    this.execute(command, false, window, cx);
                })),
            )
            .child(
                self.popup_tool(
                    "compositor-highlight-picker",
                    (Some("▾"), None),
                    "Choose highlight colour",
                    Popup::Highlight,
                    true,
                    cx,
                )
                .px(px(4.)),
            )
            .child(
                self.popup_tool(
                    "compositor-color-picker",
                    (Some("A"), None),
                    "Text colour",
                    Popup::TextColor,
                    true,
                    cx,
                )
                .font_family(DISPLAY_FONT)
                .border_b_2()
                .border_color(rgb(hex_rgb(
                    self.active.mark_value(MarkKind::Color).unwrap_or("#1f1b16"),
                ))),
            )
            .child(self.command_tool(
                "compositor-clear-formatting",
                (Some("⌫ fmt"), None),
                "Clear formatting",
                false,
                Command::ClearFormatting,
                cx,
            ));
        let type_group = self
            .group("Type", cx)
            .child(self.selection_control(
                "compositor-font",
                "Font family",
                &controls.font,
                140.,
                cx,
            ))
            .child(self.selection_control(
                "compositor-size",
                "Font size in points",
                &controls.size,
                60.,
                cx,
            ))
            .child(self.popup_tool(
                "compositor-type-more",
                (Some("More ▾"), None),
                "Advanced type and paragraph options",
                Popup::Type,
                true,
                cx,
            ));
        let mut styles = self.group("Styles", cx).child(self.selection_control(
            "compositor-style",
            "Text style",
            &controls.style,
            106.,
            cx,
        ));
        for (id, label, level, name) in [
            ("compositor-h1", "H₁", 1, "Heading 1"),
            ("compositor-h2", "H₂", 2, "Heading 2"),
            ("compositor-h3", "H₃", 3, "Heading 3"),
        ] {
            styles = styles.child(
                self.command_tool(
                    id,
                    (Some(label), None),
                    name,
                    self.active.heading() == Some(level),
                    Command::SetHeading(level),
                    cx,
                )
                .font_family(DISPLAY_FONT)
                .font_weight(FontWeight::SEMIBOLD),
            );
        }
        let lists = self
            .group("Lists", cx)
            .child(self.command_tool(
                "compositor-bullet",
                (Some("list"), Some(TwyneIcon::UnorderedList)),
                "Bullet list",
                self.active.kind(&NodeKind::List(ListKind::Bullet)),
                Command::ToggleList(ListKind::Bullet),
                cx,
            ))
            .child(self.command_tool(
                "compositor-ordered",
                (Some("list"), Some(TwyneIcon::OrderedList)),
                "Numbered list",
                self.active.kind(&NodeKind::List(ListKind::Ordered)),
                Command::ToggleList(ListKind::Ordered),
                cx,
            ))
            .child(self.command_tool(
                "compositor-checklist",
                (Some("Checklist"), Some(TwyneIcon::Checklist)),
                "Checklist",
                self.active.kind(&NodeKind::List(ListKind::Task)),
                Command::ToggleList(ListKind::Task),
                cx,
            ))
            .child(self.command_tool(
                "compositor-quote",
                (None, Some(TwyneIcon::Quote)),
                "Pull quote",
                self.active.kind(&NodeKind::BlockQuote),
                Command::ToggleBlockQuote,
                cx,
            ))
            .child(self.command_tool(
                "compositor-code",
                (None, Some(TwyneIcon::Code)),
                "Code block",
                self.active.kind(&NodeKind::CodeBlock),
                Command::ToggleCodeBlock,
                cx,
            ));
        let mut alignment = self.group("Alignment", cx);
        for (id, name, icon, value) in [
            (
                "compositor-left",
                "Align left",
                TwyneIcon::TextAlignLeft,
                Alignment::Left,
            ),
            (
                "compositor-center",
                "Align center",
                TwyneIcon::TextAlignCenter,
                Alignment::Center,
            ),
            (
                "compositor-right",
                "Align right",
                TwyneIcon::TextAlignRight,
                Alignment::Right,
            ),
            (
                "compositor-justify",
                "Justify",
                TwyneIcon::TextAlignJustify,
                Alignment::Justify,
            ),
        ] {
            alignment = alignment.child(self.command_tool(
                id,
                (None, Some(icon)),
                name,
                self.active.style("text-align").as_deref().unwrap_or("left") == value.css(),
                Command::SetAlignment(value),
                cx,
            ));
        }
        div()
            .flex()
            .items_center()
            .children([
                character.into_any_element(),
                type_group.into_any_element(),
                styles.into_any_element(),
                lists.into_any_element(),
                alignment.into_any_element(),
            ])
            .into_any_element()
    }
    fn insert(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .items_center()
            .child(
                self.group("Objects", cx)
                    .child(self.popup_tool(
                        "compositor-image",
                        (Some("Image"), Some(TwyneIcon::Image)),
                        "Insert image",
                        Popup::Image,
                        true,
                        cx,
                    ))
                    .child(self.popup_tool(
                        "compositor-table",
                        (Some("Table"), Some(TwyneIcon::Grid)),
                        "Insert table",
                        Popup::Table,
                        true,
                        cx,
                    ))
                    .child(self.popup_tool(
                        "compositor-diagram",
                        (Some("Diagram"), Some(TwyneIcon::Diagram)),
                        "Insert Mermaid diagram",
                        Popup::Diagram,
                        true,
                        cx,
                    )),
            )
            .child(
                self.group("Breaks", cx)
                    .child(self.command_tool(
                        "compositor-section-break",
                        (None, Some(TwyneIcon::SectionDivider)),
                        "Section break",
                        false,
                        Command::InsertBlock(BlockObject::HorizontalRule),
                        cx,
                    ))
                    .child(self.command_tool(
                        "compositor-page-break",
                        (Some("Page"), Some(TwyneIcon::Page)),
                        "Insert page break",
                        false,
                        Command::InsertBlock(BlockObject::PageBreak),
                        cx,
                    )),
            )
            .child(
                self.group("Notes", cx)
                    .child(self.popup_tool(
                        "compositor-endnote",
                        (Some("¹ endnote"), None),
                        "Insert endnote",
                        Popup::Note(NoteKind::Endnote),
                        true,
                        cx,
                    ))
                    .child(self.popup_tool(
                        "compositor-footnote",
                        (Some("† footnote"), None),
                        "Insert footnote",
                        Popup::Note(NoteKind::Footnote),
                        true,
                        cx,
                    )),
            )
            .into_any_element()
    }
    fn review(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .items_center()
            .child(
                self.group("Comments", cx).child(
                    self.tool(
                        "compositor-add-margin",
                        (Some("Add margin"), Some(TwyneIcon::CommentAdd)),
                        "Add margin note",
                        false,
                        !self.capabilities.margin_notes
                            || self.active.selection.is_empty()
                            || !self.editable(),
                        cx,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        cx.emit(CompositorEvent::MarginNoteRequested {
                            selection: this.active.selection,
                        })
                    })),
                ),
            )
            .child(
                self.group("Listening", cx).child(
                    self.tool(
                        "compositor-read-aloud",
                        (Some("♪ read"), None),
                        "Read the selection aloud — or the whole draft when nothing is selected",
                        false,
                        !self.capabilities.read_aloud,
                        cx,
                    )
                    .on_click(
                        cx.listener(|_, _, _, cx| cx.emit(CompositorEvent::ReadAloudRequested)),
                    ),
                ),
            )
            .child(
                self.group("Versions", cx).child(
                    self.tool(
                        "compositor-history",
                        (Some("Version history"), Some(TwyneIcon::History)),
                        "Open version history",
                        false,
                        !self.capabilities.version_history,
                        cx,
                    )
                    .on_click(
                        cx.listener(|_, _, _, cx| {
                            cx.emit(CompositorEvent::VersionHistoryRequested)
                        }),
                    ),
                ),
            )
            .child(
                self.group("Proofing", cx)
                    .child(
                        self.tool(
                            "compositor-find",
                            (Some("Find"), Some(TwyneIcon::Search)),
                            "Find and replace",
                            false,
                            !self.capabilities.find,
                            cx,
                        )
                        .on_click(
                            cx.listener(|_, _, _, cx| cx.emit(CompositorEvent::FindRequested)),
                        ),
                    )
                    .child(
                        self.tool(
                            "compositor-grammar",
                            (Some("Grammar"), Some(TwyneIcon::FileCheck)),
                            "Grammar suggestions",
                            false,
                            !self.capabilities.grammar,
                            cx,
                        )
                        .on_click(
                            cx.listener(|_, _, _, cx| cx.emit(CompositorEvent::GrammarRequested)),
                        ),
                    ),
            )
            .into_any_element()
    }
    fn view_tools(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .items_center()
            .child(
                self.group("Navigation", cx).child(
                    self.tool(
                        "compositor-outline",
                        (Some("Outline"), Some(TwyneIcon::List)),
                        "Document outline",
                        false,
                        !self.capabilities.outline,
                        cx,
                    )
                    .on_click(
                        cx.listener(|_, _, _, cx| cx.emit(CompositorEvent::OutlineRequested)),
                    ),
                ),
            )
            .child(self.group("Help", cx).child(self.popup_tool(
                "compositor-shortcuts",
                (Some("Shortcuts"), Some(TwyneIcon::Keyboard)),
                "Keyboard shortcuts",
                Popup::Shortcuts,
                false,
                cx,
            )))
            .child(self.group("Page", cx).child(self.popup_tool(
                "compositor-layout",
                (Some("Layout"), Some(TwyneIcon::Layout)),
                "Page layout",
                Popup::Layout,
                false,
                cx,
            )))
            .into_any_element()
    }
    fn grid_move(&mut self, rows: isize, columns: isize, cx: &mut Context<Self>) {
        if self.popup != Some(Popup::Table) {
            return;
        }
        self.table_rows = (self.table_rows as isize + rows).clamp(1, 8) as usize;
        self.table_columns = (self.table_columns as isize + columns).clamp(1, 10) as usize;
        cx.notify();
    }
}

fn hex_rgb(value: &str) -> u32 {
    normalize_hex(value)
        .and_then(|value| u32::from_str_radix(&value[1..], 16).ok())
        .unwrap_or(0x1f1b16)
}

fn field_label(label: &'static str, cx: &App) -> gpui_kit::Div {
    div()
        .font_family(TYPEWRITER_FONT)
        .text_size(px(10.4))
        .line_height(relative(1.4))
        .text_color(rgb(theme::palette(cx).ink_muted))
        .mb(px(6.))
        .child(label)
}
fn help(text: impl Into<SharedString>, cx: &App) -> gpui_kit::Div {
    div()
        .font_family(SERIF_FONT)
        .text_size(px(11.52))
        .line_height(relative(1.5))
        .text_color(rgb(theme::palette(cx).ink_muted))
        .child(text.into())
}

impl CompositorView {
    fn option(&self, id: &'static str, label: &'static str, selected: bool, cx: &App) -> Button {
        let colors = *theme::palette(cx);
        Button::new(id)
            .small()
            .label(label)
            .accessibility_label(label)
            .font_family(SANS_FONT)
            .text_size(px(11.2))
            .h(px(30.))
            .px(px(8.))
            .rounded(px(2.))
            .bg(rgb(if selected {
                colors.sidebar
            } else {
                colors.paper
            }))
            .text_color(rgb(if selected {
                colors.vermilion
            } else {
                colors.ink_light
            }))
            .border_color(rgb(if selected {
                colors.vermilion
            } else {
                colors.rule
            }))
            .selected(selected)
            .disabled(self.read_only || self.active.read_only)
            .opacity(if self.read_only || self.active.read_only {
                0.3
            } else {
                1.0
            })
    }
    fn panel(
        &self,
        id: &'static str,
        title: &'static str,
        width: f32,
        cx: &App,
    ) -> gpui_kit::base::ObservedElement<gpui_kit::Stateful<gpui_kit::Div>> {
        let colors = *theme::palette(cx);
        div()
            .id(id)
            .test_support()
            .role(Role::Dialog)
            .aria_label(title)
            .w(px(width))
            .p(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .font_family(SERIF_FONT)
            .text_size(px(12.))
            .text_color(rgb(colors.ink))
            .bg(rgb(colors.paper))
            .border_1()
            .border_color(rgb(colors.rule))
            .rounded(px(2.))
            .shadow_lg()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
    }
    fn color_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let controls = self.controls.as_ref().expect("controls hydrated");
        let highlighting = self.popup == Some(Popup::Highlight);
        let mut palette = div().flex().flex_wrap().gap(px(6.));
        for (index, (name, hex)) in (if highlighting {
            HIGHLIGHTS.as_slice()
        } else {
            TEXT_COLORS.as_slice()
        })
        .iter()
        .enumerate()
        {
            let hex = *hex;
            palette = palette.child(
                Button::new(("compositor-color-swatch", index))
                    .label(" ")
                    .accessibility_label(*name)
                    .tooltip(*name)
                    .w(px(22.))
                    .h(px(22.))
                    .p(px(0.))
                    .rounded(px(2.))
                    .bg(rgb(hex_rgb(hex)))
                    .disabled(!self.editable())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.choose_color(Some(hex), window, cx)
                    })),
            );
        }
        let recent = div().flex().flex_wrap().gap(px(6.)).children(
            self.recent_colors.iter().enumerate().map(|(index, hex)| {
                let hex = hex.clone();
                Button::new(("compositor-color-recent", index))
                    .label(" ")
                    .accessibility_label(hex.clone())
                    .tooltip(hex.clone())
                    .w(px(18.))
                    .h(px(18.))
                    .p(px(0.))
                    .rounded(px(2.))
                    .bg(rgb(hex_rgb(&hex)))
                    .disabled(!self.editable())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.choose_color(Some(&hex), window, cx)
                    }))
            }),
        );
        self.panel(
            "compositor-color-panel",
            if highlighting {
                "Highlight"
            } else {
                "Text colour"
            },
            208.,
            cx,
        )
        .child(field_label(
            if highlighting {
                "Highlight"
            } else {
                "Text colour"
            },
            cx,
        ))
        .child(palette)
        .when(!self.recent_colors.is_empty(), |this| {
            this.child(div().child(field_label("Recent", cx)).child(recent))
        })
        .child(
            div().child(field_label("Custom colour", cx)).child(
                div()
                    .flex()
                    .gap(px(6.))
                    .child(
                        Input::new(&controls.color)
                            .id("compositor-custom-color")
                            .aria_label("Custom colour")
                            .small()
                            .w(px(116.))
                            .font_family(TYPEWRITER_FONT)
                            .disabled(!self.editable()),
                    )
                    .child(
                        self.option("compositor-color-apply", "Apply", false, cx)
                            .disabled(!self.editable())
                            .on_click(
                                cx.listener(|this, _, window, cx| this.commit_popup(window, cx)),
                            ),
                    ),
            ),
        )
        .child(
            self.tool(
                "compositor-color-clear",
                (
                    Some(if highlighting {
                        "No highlight"
                    } else {
                        "Default ink"
                    }),
                    None,
                ),
                if highlighting {
                    "No highlight"
                } else {
                    "Default ink"
                },
                false,
                !self.editable(),
                cx,
            )
            .on_click(cx.listener(|this, _, window, cx| this.choose_color(None, window, cx))),
        )
        .when_some(self.error.as_ref(), |this, error| {
            this.child(help(error.clone(), cx).text_color(rgb(theme::palette(cx).vermilion)))
        })
        .into_any_element()
    }
    fn type_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let controls = self.controls.as_ref().expect("controls hydrated");
        let line_height = self.active.style("line-height").unwrap_or_default();
        let mut spacing = div().flex().flex_wrap().gap(px(4.));
        for (index, (label, value)) in LINE_SPACINGS.iter().enumerate() {
            let value = *value;
            spacing = spacing.child(
                Button::new(("compositor-line-spacing", index))
                    .small()
                    .label(*label)
                    .accessibility_label(*label)
                    .font_family(SANS_FONT)
                    .text_size(px(11.2))
                    .h(px(30.))
                    .selected(line_height == value)
                    .disabled(!self.editable())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.execute(
                            Command::SetParagraphFormat(ParagraphFormat {
                                line_height: Some(Some(value.into())),
                                ..ParagraphFormat::default()
                            }),
                            false,
                            window,
                            cx,
                        )
                    })),
            );
        }
        let mut cases = div().flex().gap(px(4.));
        for (id, label, title, value) in [
            ("compositor-case-upper", "AA", "UPPERCASE", TextCase::Upper),
            ("compositor-case-lower", "aa", "lowercase", TextCase::Lower),
            ("compositor-case-title", "Aa", "Title Case", TextCase::Title),
            (
                "compositor-case-sentence",
                "A.",
                "Sentence case",
                TextCase::Sentence,
            ),
        ] {
            cases = cases.child(
                self.tool(
                    id,
                    (Some(label), None),
                    title,
                    false,
                    !self.editable() || self.active.selection.is_empty(),
                    cx,
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.execute(Command::Recase(value), false, window, cx)
                })),
            );
        }
        self.panel(
            "compositor-type-panel",
            "Advanced type and paragraph options",
            240.,
            cx,
        )
        .child(div().child(field_label("Line spacing", cx)).child(spacing))
        .child(
            div()
                .flex()
                .gap(px(8.))
                .child(div().child(field_label("Before paragraph", cx)).child(
                    self.selection_control(
                        "compositor-before",
                        "Space before paragraph",
                        &controls.before,
                        101.,
                        cx,
                    ),
                ))
                .child(div().child(field_label("After paragraph", cx)).child(
                    self.selection_control(
                        "compositor-after",
                        "Space after paragraph",
                        &controls.after,
                        101.,
                        cx,
                    ),
                )),
        )
        .child(
            div()
                .child(
                    Checkbox::new("compositor-keep-next")
                        .label("Keep with next")
                        .checked(self.active.keep_with_next())
                        .disabled(!self.editable() || self.active.heading().is_some())
                        .on_click(cx.listener(|this, value, window, cx| {
                            this.execute(
                                Command::SetParagraphFormat(ParagraphFormat {
                                    keep_with_next: Some(*value),
                                    ..ParagraphFormat::default()
                                }),
                                false,
                                window,
                                cx,
                            )
                        })),
                )
                .child(help(
                    if self.active.heading().is_some() {
                        "Always on for headings."
                    } else {
                        "Prevent a page break after this paragraph."
                    },
                    cx,
                )),
        )
        .child(
            div()
                .child(field_label("Change case", cx))
                .child(cases)
                .when(self.active.selection.is_empty(), |this| {
                    this.child(help("Select text to change its case.", cx))
                }),
        )
        .into_any_element()
    }
    fn layout_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let controls = self.controls.as_ref().expect("controls hydrated");
        let layout = &self.layout;
        let page = layout.resolve_page_setup();
        let opening = layout.opening_initial.clone().unwrap_or_default();
        let disabled = self.read_only || self.active.read_only;
        let mut paper = div().flex().gap(px(4.));
        for (id, label, value) in [
            ("compositor-paper-letter", "Letter", PaperSize::Letter),
            ("compositor-paper-a4", "A4", PaperSize::A4),
            ("compositor-paper-legal", "Legal", PaperSize::Legal),
        ] {
            paper = paper.child(self.option(id, label, page.paper == value, cx).on_click(
                cx.listener(move |this, _, _, cx| {
                    this.change_layout(|layout| layout.paper = Some(value), cx)
                }),
            ));
        }
        let mut orientation = div().flex().gap(px(4.));
        for (id, label, value) in [
            ("compositor-portrait", "Portrait", Orientation::Portrait),
            ("compositor-landscape", "Landscape", Orientation::Landscape),
        ] {
            orientation = orientation.child(
                self.option(id, label, page.orientation == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.change_layout(|layout| layout.orientation = Some(value), cx)
                    })),
            );
        }
        let mut pagination = div().flex().gap(px(4.));
        for (id, label, value) in [
            (
                "compositor-paginated",
                "Match paper",
                PaginationMode::Paginated,
            ),
            (
                "compositor-continuous",
                "Custom column",
                PaginationMode::Continuous,
            ),
        ] {
            pagination = pagination.child(
                self.option(id, label, page.pagination == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.change_layout(|layout| layout.pagination = Some(value), cx)
                    })),
            );
        }
        let mut width = div().flex().gap(px(4.));
        for (id, label, value) in [
            ("compositor-width-narrow", "Narrow", DocWidth::Narrow),
            ("compositor-width-normal", "Normal", DocWidth::Normal),
            ("compositor-width-wide", "Wide", DocWidth::Wide),
        ] {
            width = width.child(self.option(id, label, layout.width == value, cx).on_click(
                cx.listener(move |this, _, _, cx| {
                    this.change_layout(|layout| layout.width = value, cx)
                }),
            ));
        }
        let mut columns = div().flex().gap(px(4.));
        for (id, label, value) in [
            ("compositor-columns-one", "One", 1),
            ("compositor-columns-two", "Two", 2),
            ("compositor-columns-three", "Three", 3),
        ] {
            columns = columns.child(
                self.option(id, label, layout.resolve_columns() == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.change_layout(|layout| layout.columns = Some(value), cx)
                    })),
            );
        }
        let mut initial_mode = div().flex().gap(px(4.));
        for (id, label, value) in [
            ("compositor-initial-off", "Off", OpeningInitialMode::Off),
            (
                "compositor-initial-plain",
                "Plain",
                OpeningInitialMode::Plain,
            ),
            (
                "compositor-initial-illustrated",
                "Illustrated",
                OpeningInitialMode::Illuminated,
            ),
        ] {
            initial_mode = initial_mode.child(
                self.option(id, label, opening.mode == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.opening(|initial| initial.mode = value, cx)
                    })),
            );
        }
        let mut collections = div().flex().gap(px(4.));
        for (id, label, value) in [
            (
                "compositor-initial-original",
                "Original botanical",
                OpeningInitialCollection::Botanical,
            ),
            (
                "compositor-initial-alternate",
                "Alternate",
                OpeningInitialCollection::Alternate,
            ),
        ] {
            collections = collections.child(
                self.option(id, label, opening.collection == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.opening(|initial| initial.collection = value, cx)
                    })),
            );
        }
        let mut initial_size = div().flex().gap(px(4.));
        for (id, label, value) in [
            (
                "compositor-initial-small",
                "Small",
                OpeningInitialSize::Small,
            ),
            (
                "compositor-initial-medium",
                "Medium",
                OpeningInitialSize::Medium,
            ),
            (
                "compositor-initial-large",
                "Large",
                OpeningInitialSize::Large,
            ),
        ] {
            initial_size = initial_size.child(
                self.option(id, label, opening.size == value, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.opening(|initial| initial.size = value, cx)
                    })),
            );
        }
        let mut border = div().flex().flex_wrap().gap(px(4.));
        for (id, label, value) in [
            ("compositor-border-none", "None", PageBorderStyle::None),
            ("compositor-border-plain", "Plain", PageBorderStyle::Plain),
            (
                "compositor-border-botanical",
                "Botanical",
                PageBorderStyle::Botanical,
            ),
            (
                "compositor-border-engraved",
                "Engraved",
                PageBorderStyle::Engraved,
            ),
            (
                "compositor-border-illuminated",
                "Illuminated",
                PageBorderStyle::Illuminated,
            ),
        ] {
            border = border.child(
                self.option(
                    id,
                    label,
                    layout.page_border.unwrap_or(PageBorderStyle::Plain) == value,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.change_layout(|layout| layout.page_border = Some(value), cx)
                })),
            );
        }
        let margins = layout.resolve_margins();
        let mut margin_controls = div().flex().flex_wrap().gap(px(12.));
        for (index, (label, value)) in [
            ("Left", margins.left),
            ("Right", margins.right),
            ("Top", margins.top),
            ("Bottom", margins.bottom),
        ]
        .into_iter()
        .enumerate()
        {
            margin_controls = margin_controls.child(
                div()
                    .w(px(160.))
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .child(field_label(label, cx))
                            .child(help(format!("{value:.2} rem"), cx)),
                    )
                    .child(
                        div().id(("compositor-margin", index)).test_support().child(
                            Slider::new(&self.sliders[index])
                                .horizontal()
                                .disabled(disabled),
                        ),
                    ),
            );
        }
        self.panel("compositor-layout-panel", "Page layout", 368., cx).p(px(16.))
            .child(div().font_family(SANS_FONT).text_size(px(15.2)).font_weight(FontWeight::BOLD).child("Page layout")
                .child(help("Paper, columns, ornaments, and running heads.", cx)))
            .child(div().child(field_label("Paper", cx)).child(paper))
            .child(div().child(field_label("Orientation", cx)).child(orientation))
            .child(div().child(field_label("Writing width", cx)).child(pagination)
                .when(page.pagination == PaginationMode::Continuous, |this| this.child(div().mt(px(6.)).child(width))))
            .child(div().child(field_label("Columns", cx)).child(columns)
                .when(layout.resolve_columns() > 1, |this| this.child(div().mt(px(8.)).child(div().flex().justify_between().child(field_label("Column gap", cx)).child(help(format!("{:.2} rem", layout.resolve_column_gap()), cx)))
                    .child(div().id("compositor-column-gap").test_support().child(Slider::new(&self.sliders[4]).horizontal().disabled(disabled))))
                    .child(help("Narrow screens show one writing column. Proof and PDF keep your layout.", cx))))
            .child(div().child(field_label("Opening initial", cx)).child(initial_mode)
                .when(opening.mode == OpeningInitialMode::Illuminated, |this| this.child(div().mt(px(8.)).child(field_label("Botanical collection", cx)).child(collections)
                    .when(opening.collection == OpeningInitialCollection::Alternate, |this| this.child(help("A complete alternate A–Z collection, with a different botanical illustration for every letter.", cx)))))
                .when(opening.mode != OpeningInitialMode::Off, |this| this.child(div().mt(px(8.)).child(initial_size))))
            .child(div().child(field_label("Page border", cx)).child(border))
            .child(div().child(field_label("Margins", cx)).child(margin_controls)
                .child(Checkbox::new("compositor-margin-guides").label("Margin guides").checked(layout.show_margin_guides.unwrap_or(false)).disabled(disabled)
                    .on_click(cx.listener(|this, value, _, cx| this.change_layout(|layout| layout.show_margin_guides = Some(*value), cx))))
                .child(help("Show the printable text boundary", cx)))
            .child(div().flex().flex_col().gap(px(8.)).child(field_label("Running heads", cx))
                .child(Checkbox::new("compositor-running-header").label("Show running header").checked(layout.running_header).disabled(disabled)
                    .on_click(cx.listener(|this, value, _, cx| this.change_layout(|layout| layout.running_header = *value, cx))))
                .child(Checkbox::new("compositor-page-numbers").label("Page numbers").checked(layout.page_numbers).disabled(disabled)
                    .on_click(cx.listener(|this, value, _, cx| this.change_layout(|layout| layout.page_numbers = *value, cx))))
                .child(div().id("compositor-header-anchor").child(Input::new(&controls.header).id("compositor-header").aria_label("Optional running header").small().disabled(disabled)))
                .child(div().id("compositor-footer-anchor").child(Input::new(&controls.footer).id("compositor-footer").aria_label("Optional running footer").small().disabled(disabled))))
            .child(div().child(Checkbox::new("compositor-persona-comments").label("Include persona comments").checked(self.include_persona_comments).disabled(!self.capabilities.persona_comments)
                .on_click(cx.listener(|this, value, _, cx| { this.include_persona_comments = *value; cx.notify(); })))
                .child(help("Adds the room's notes as endnotes.", cx)))
            .child(self.option("compositor-save-pdf", if self.preparing_pdf { "Preparing…" } else { "Save as PDF…" }, false, cx).disabled(!self.capabilities.save_pdf || self.preparing_pdf)
                .on_click(cx.listener(|this, _, _, cx| { this.flush_chrome_text(cx); cx.emit(CompositorEvent::SavePdfRequested { include_persona_comments: this.include_persona_comments }); })))
            .into_any_element()
    }
    fn table_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let mut grid = div().flex().flex_col().gap(px(4.));
        for row in 1..=8 {
            let mut cells = div().flex().gap(px(4.));
            for column in 1..=10 {
                let selected = row <= self.table_rows && column <= self.table_columns;
                cells = cells.child(
                    Button::new(("compositor-table-cell", (row - 1) * 10 + column - 1))
                        .label(" ")
                        .accessibility_label(format!("{row} by {column} table"))
                        .h(px(18.4))
                        .w(px(18.4))
                        .p(px(0.))
                        .rounded(px(1.))
                        .bg(rgb(if selected { colors.blush } else { colors.paper }))
                        .border_color(rgb(if selected {
                            colors.vermilion
                        } else {
                            colors.rule
                        }))
                        .disabled(!self.editable())
                        .on_hover(cx.listener(move |this, hovering, _, cx| {
                            if *hovering {
                                this.table_rows = row;
                                this.table_columns = column;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.table_rows = row;
                            this.table_columns = column;
                            this.commit_popup(window, cx);
                        })),
                );
            }
            grid = grid.child(cells);
        }
        self.panel("compositor-table-panel", "Insert table", 252., cx)
            .key_context("TwyneCompositorGrid")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &GridUp, _, cx| this.grid_move(-1, 0, cx)))
            .on_action(cx.listener(|this, _: &GridDown, _, cx| this.grid_move(1, 0, cx)))
            .on_action(cx.listener(|this, _: &GridLeft, _, cx| this.grid_move(0, -1, cx)))
            .on_action(cx.listener(|this, _: &GridRight, _, cx| this.grid_move(0, 1, cx)))
            .on_action(cx.listener(|this, _: &GridHome, _, cx| {
                this.table_rows = 1;
                this.table_columns = 1;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &GridEnd, _, cx| {
                this.table_rows = 8;
                this.table_columns = 10;
                cx.notify();
            }))
            .child(
                div()
                    .id("compositor-table-dimensions")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(format!(
                        "{} × {} table",
                        self.table_rows, self.table_columns
                    ))
                    .child(format!(
                        "{} × {} table",
                        self.table_rows, self.table_columns
                    )),
            )
            .child(grid)
            .child(help("Arrow keys resize. Enter inserts.", cx))
            .into_any_element()
    }
    fn image_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let controls = self.controls.as_ref().expect("controls hydrated");
        self.panel("compositor-image-panel", "Insert image", 430., cx)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(field_label("Image URL:", cx))
                    .child(
                        self.option("compositor-image-file", "Choose file…", false, cx)
                            .disabled(!self.capabilities.image_file || !self.editable())
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(editor) = &this.editor {
                                    cx.emit(CompositorEvent::ImageFileRequested {
                                        selection: editor.read(cx).selection(),
                                    });
                                }
                            })),
                    )
                    .child(help("or", cx)),
            )
            .child(
                Input::new(&controls.image)
                    .id("compositor-image-url")
                    .aria_label("Image URL")
                    .small()
                    .disabled(!self.editable()),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        self.option("compositor-image-cancel", "Cancel", false, cx)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.close_popup(window, cx)),
                            ),
                    )
                    .child(
                        self.option("compositor-image-insert", "Insert", false, cx)
                            .disabled(
                                !self.editable()
                                    || controls.image.read(cx).text().to_string().trim().is_empty(),
                            )
                            .on_click(
                                cx.listener(|this, _, window, cx| this.commit_popup(window, cx)),
                            ),
                    ),
            )
            .into_any_element()
    }
    fn shortcuts_panel(&self, cx: &App) -> AnyElement {
        let mut rows = div().flex().flex_col().gap(px(8.));
        for (key, label) in [
            ("⌘/Ctrl B", "Bold"),
            ("⌘/Ctrl I", "Italic"),
            ("⌘/Ctrl U", "Underline"),
            ("⌘/Ctrl Z", "Undo"),
            ("⌘/Ctrl Shift Z", "Redo"),
            ("Tab / Shift Tab", "Indent / outdent"),
            ("Shift Enter", "Line break"),
            ("Esc", "Close panel"),
        ] {
            rows = rows.child(
                div()
                    .flex()
                    .justify_between()
                    .gap(px(16.))
                    .child(label)
                    .child(
                        div()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(11.))
                            .child(key),
                    ),
            );
        }
        self.panel("compositor-shortcuts-panel", "Keyboard shortcuts", 330., cx)
            .child(field_label("Keyboard shortcuts", cx))
            .child(rows)
            .into_any_element()
    }
    fn text_modal(
        &self,
        diagram: bool,
        kind: NoteKind,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let controls = self.controls.as_ref().expect("controls hydrated");
        let colors = *theme::palette(cx);
        let (title, description, label, submit) = if diagram {
            (
                "Mermaid diagram",
                "Write a Mermaid diagram spec to keep at the cursor.",
                "Diagram source",
                "Insert diagram",
            )
        } else if kind == NoteKind::Footnote {
            (
                "Footnote",
                "Footnote text appears at the foot of the page on the same sheet as the marker — for asides the reader needs on the same page as the line that prompted them.",
                "Footnote text",
                "Insert footnote",
            )
        } else {
            (
                "Endnote",
                "Endnote text collects under Notes at the end of the manuscript — for sourcing, citations, and longer remarks.",
                "Endnote text",
                "Insert endnote",
            )
        };
        let size = window.viewport_size();
        let state = if diagram {
            &controls.diagram
        } else {
            &controls.note
        };
        let modal = self
            .panel(
                "compositor-text-modal",
                title,
                if diagram { 896. } else { 512. },
                cx,
            )
            .max_w(px(f32::from(size.width) - 32.))
            .p(px(20.))
            .gap(px(8.))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(field_label("Insert", cx))
            .child(
                div()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(16.))
                    .child(title),
            )
            .child(
                div()
                    .text_size(px(14.))
                    .line_height(relative(1.625))
                    .child(description),
            )
            .child(
                div().mt(px(8.)).child(field_label(label, cx)).child(
                    div().id("compositor-insert-text").test_support().child(
                        Textarea::new(state)
                            .aria_label(label)
                            .font_family(if diagram { TYPEWRITER_FONT } else { SERIF_FONT })
                            .text_size(px(14.))
                            .h(px(if diagram { 224. } else { 128. }))
                            .disabled(!self.editable()),
                    ),
                ),
            )
            .when(diagram, |this| {
                this.child(
                    div()
                        .id("compositor-diagram-status")
                        .test_support()
                        .role(Role::Status)
                        .aria_label("Source retained. Diagram preview is unavailable offline.")
                        .child(help(
                            "Source retained. Diagram preview is unavailable offline.",
                            cx,
                        )),
                )
            })
            .child(help("Cmd/Ctrl + Enter to insert · Esc to cancel", cx))
            .when_some(self.error.as_ref(), |this, error| {
                this.child(help(error.clone(), cx).text_color(rgb(colors.vermilion)))
            })
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .mt(px(12.))
                    .child(
                        self.option("compositor-insert-cancel", "Cancel", false, cx)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.close_popup(window, cx)),
                            ),
                    )
                    .child(
                        self.option("compositor-insert-submit", submit, false, cx)
                            .disabled(!self.editable())
                            .on_click(
                                cx.listener(|this, _, window, cx| this.commit_popup(window, cx)),
                            ),
                    ),
            );
        deferred(
            anchored().position(point(px(0.), px(0.))).child(
                div()
                    .id("compositor-modal-shade")
                    .test_support()
                    .w(size.width)
                    .h(size.height)
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(16.))
                    .bg(rgb(colors.shade).opacity(0.58))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, window, cx| this.close_popup(window, cx)),
                    )
                    .child(modal),
            ),
        )
        .priority(2)
        .into_any_element()
    }
    fn floating_panel(&self, popup: Popup, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        if matches!(popup, Popup::Note(_) | Popup::Diagram) {
            return self.text_modal(
                popup == Popup::Diagram,
                if let Popup::Note(kind) = popup {
                    kind
                } else {
                    NoteKind::Endnote
                },
                window,
                cx,
            );
        }
        let body = match popup {
            Popup::Highlight | Popup::TextColor => self.color_panel(cx),
            Popup::Type => self.type_panel(cx),
            Popup::Layout => self.layout_panel(cx),
            Popup::Table => self.table_panel(cx),
            Popup::Image => self.image_panel(cx),
            Popup::Shortcuts => self.shortcuts_panel(cx),
            Popup::Note(_) | Popup::Diagram => unreachable!(),
        };
        let viewport = window.viewport_size();
        let left = (f32::from(viewport.width) / 2. - 256.).max(8.);
        deferred(
            anchored()
                .position(point(px(left), px(128.)))
                .snap_to_window_with_margin(px(8.))
                .child(
                    div()
                        .id("compositor-popover")
                        .test_support()
                        .max_w(px(f32::from(viewport.width) - 16.))
                        .max_h(px((f32::from(viewport.height) - 160.).max(120.)))
                        .overflow_y_scroll()
                        .track_scroll(&self.popup_scroll)
                        .child(body)
                        .on_mouse_down_out(
                            cx.listener(|this, _, window, cx| this.close_popup(window, cx)),
                        ),
                ),
        )
        .priority(1)
        .into_any_element()
    }
}

impl Render for CompositorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_controls(window, cx);
        self.sync_selects(window, cx);
        let focused_chrome = self.controls.as_ref().and_then(|controls| {
            if self.popup != Some(Popup::Layout) {
                None
            } else if controls.header.read(cx).focus_handle(cx).is_focused(window) {
                Some(ChromeTextKind::Header)
            } else if controls.footer.read(cx).focus_handle(cx).is_focused(window) {
                Some(ChromeTextKind::Footer)
            } else {
                None
            }
        });
        if focused_chrome != self.focused_chrome && focused_chrome.is_some() {
            // Offscreen inputs retain their real focus handle, but their
            // clipped dispatch node cannot deliver a focus subscription.
            // Both chrome fields live at the foot of this bounded pane.
            self.popup_scroll.scroll_to_bottom();
        }
        self.focused_chrome = focused_chrome;
        let ribbon = match self.tab {
            CompositorTab::Home => self.home(cx),
            CompositorTab::Insert => self.insert(cx),
            CompositorTab::Review => self.review(cx),
            CompositorTab::View => self.view_tools(cx),
        };
        div()
            .id("compositor-ribbon")
            .test_support()
            .role(Role::Toolbar)
            .aria_label("Document compositor")
            .key_context("TwyneCompositor")
            .track_focus(&self.focus)
            .w_full()
            .h(px(41.))
            .min_h(px(41.))
            .py(px(2.))
            .flex_shrink_0()
            .relative()
            .border_t_1()
            .border_color(rgb(theme::palette(cx).rule))
            .bg(rgb(theme::palette(cx).paper_soft))
            .on_action(cx.listener(|this, _: &ClosePopup, window, cx| this.close_popup(window, cx)))
            .on_action(
                cx.listener(|this, _: &CommitPopup, window, cx| this.commit_popup(window, cx)),
            )
            .child(
                div()
                    .id("compositor-scroll")
                    .test_support()
                    .w_full()
                    .h(px(36.))
                    .flex()
                    .items_center()
                    .overflow_x_scroll()
                    .child(ribbon),
            )
            .when_some(self.popup, |this, popup| {
                this.child(self.floating_panel(popup, window, cx))
            })
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use crate::editor::{
        RichDocument,
        view::{InitialMode, OpeningInitial},
    };
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, AppContext, Bounds, Point, TestAppContext, WindowBounds, WindowOptions,
        size,
    };
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    struct Room {
        compositor: Entity<CompositorView>,
        editor: Option<Entity<RichEditorView>>,
    }
    impl Render for Room {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .flex()
                .flex_col()
                .bg(rgb(theme::palette(cx).paper))
                .child(div().h(px(88.)).flex_shrink_0())
                .child(self.compositor.clone())
                .when_some(self.editor.clone(), |this, editor| {
                    this.child(div().flex_1().p(px(24.)).child(editor))
                })
        }
    }
    fn room(
        cx: &mut TestAppContext,
        html: Option<&str>,
        layout: LayoutSettings,
        height: f32,
    ) -> (
        AnyWindowHandle,
        Entity<CompositorView>,
        Option<Entity<RichEditorView>>,
    ) {
        let document = html.map(|html| RichDocument::from_html(html).unwrap());
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            init(cx);
            let (handle, entity) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1280.), px(height)),
                    })),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        let editor = document.map(|document| {
                            cx.new(|cx| {
                                let mut editor = RichEditorView::new(document, cx);
                                editor.set_opening_initial(
                                    OpeningInitial {
                                        mode: InitialMode::Off,
                                        ..OpeningInitial::default()
                                    },
                                    cx,
                                );
                                editor
                            })
                        });
                        let compositor =
                            cx.new(|cx| CompositorView::new(editor.clone(), layout, cx));
                        Room { editor, compositor }
                    })
                },
            )
            .unwrap();
            (
                handle,
                entity.read(cx).compositor.clone(),
                entity.read(cx).editor.clone(),
            )
        })
    }
    fn events(
        cx: &mut TestAppContext,
        view: &Entity<CompositorView>,
    ) -> Arc<Mutex<Vec<CompositorEvent>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let receiver = events.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &CompositorEvent, _| {
                receiver.lock().unwrap().push(event.clone())
            })
            .detach();
        });
        events
    }
    fn select(cx: &mut TestAppContext, editor: &Entity<RichEditorView>, range: Selection) {
        cx.update(|cx| editor.update(cx, |editor, cx| editor.set_selection(range, cx).unwrap()));
    }
    fn web() -> Value {
        serde_json::from_str(include_str!("../fixtures/compositor/web-contract.json")).unwrap()
    }

    #[test]
    fn control_catalogue_matches_executed_web_contracts() {
        let web = web();
        assert_eq!(json!(FONT_CHOICES), web["fonts"]);
        assert_eq!(json!(FONT_SIZES), web["sizes"]);
        assert_eq!(json!(LINE_SPACINGS), web["lineSpacings"]);
        assert_eq!(json!(PARAGRAPH_SPACINGS), web["paragraphSpacings"]);
        assert_eq!(json!(HIGHLIGHTS), web["highlights"]);
        assert_eq!(json!(TEXT_COLORS), web["textColors"]);
        assert_eq!(
            LayoutSettings::default(),
            serde_json::from_value::<LayoutSettings>(web["defaultLayout"].clone()).unwrap()
        );
        for color in web["colors"].as_array().unwrap() {
            assert_eq!(
                json!(normalize_hex(color["raw"].as_str().unwrap())),
                color["normalized"]
            );
        }
    }

    #[gpui_kit::test]
    fn ribbon_tabs_match_production_height_and_source_only_capabilities(cx: &mut TestAppContext) {
        let (handle, view, _) = room(cx, None, LayoutSettings::default(), 860.);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                window.find("compositor-ribbon").bounds().size.height,
                px(41.)
            );
            window.click("compositor-bold", cx);
            assert_eq!(view.read(cx).popup, None);
            for (tab, index) in [
                (CompositorTab::Home, 0),
                (CompositorTab::Insert, 1),
                (CompositorTab::Review, 2),
                (CompositorTab::View, 3),
            ] {
                view.update(cx, |view, cx| view.set_tab(tab, cx));
                window.render_frame(cx);
                for group in web()["tabs"][index]["groups"].as_array().unwrap() {
                    let name = group.as_str().unwrap();
                    assert_eq!(
                        window
                            .find(SharedString::from(format!("compositor-group-{name}")))
                            .label(),
                        Some(name)
                    );
                }
            }
            window.click("compositor-outline", cx);
            window.click("compositor-layout", cx);
            assert!(window.find("compositor-layout-panel").visible());
            assert!(window.find("compositor-popover").bounds().size.height <= px(700.));
            // Inspecting an old layout does not turn its missing pagination into a migration.
            assert_eq!(view.read(cx).layout.pagination, None);
            window.scroll(
                "compositor-popover",
                gpui_kit::ScrollDelta::Pixels(point(px(0.), px(-1200.))),
                cx,
            );
            window.click("compositor-save-pdf", cx);
        })
        .unwrap();
        assert!(received.lock().unwrap().is_empty());
    }

    #[gpui_kit::test]
    fn character_and_case_controls_preserve_source_atoms_and_history(cx: &mut TestAppContext) {
        let original = "<p><span data-comment-id=\"c1\">THE  OLD </span><strong>FOX AND</strong> the <span data-type=\"raw-typst-inline\" data-typst-source=\"#keep[my CASE]\"></span>SEA</p>";
        let (handle, view, editor) = room(cx, Some(original), LayoutSettings::default(), 860.);
        let editor = editor.unwrap();
        select(cx, &editor, Selection::new(0, 8));
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("compositor-bold", cx);
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("<strong>THE  OLD</strong>")
            );
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("#keep[my CASE]")
            );
            assert_eq!(window.find("compositor-bold").checked(), Some(true));
            window.press("ctrl-z", cx);
            assert_eq!(editor.read(cx).document().to_html(), original);
            window.press("ctrl-shift-z", cx);
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("<strong>THE  OLD</strong>")
            );
            window.press("ctrl-z", cx);
        })
        .unwrap();
        let length = cx.update(|cx| editor.read(cx).document().text_len());
        select(cx, &editor, Selection::new(0, length));
        cx.update_window(handle, |_, window, cx| {
            window.click("compositor-type-more", cx);
            assert_eq!(view.read(cx).active.selection, Selection::new(0, length));
            assert_eq!(view.read(cx).popup, Some(Popup::Type));
            window.click("compositor-case-title", cx);
            assert_eq!(view.read(cx).error, None);
            assert_eq!(editor.read(cx).document().to_html(), "<p><span data-comment-id=\"c1\">The  Old </span><strong>Fox and</strong> the <span data-type=\"raw-typst-inline\" data-typst-source=\"#keep[my CASE]\"></span>Sea</p>");
            window.press("escape", cx); assert_eq!(view.read(cx).popup, None);
        }).unwrap();
    }

    #[gpui_kit::test]
    fn font_and_paragraph_menus_apply_portable_values_to_existing_runs(cx: &mut TestAppContext) {
        let (handle, view, editor) = room(
            cx,
            Some("<p><em>Draft words</em></p>"),
            LayoutSettings::default(),
            860.,
        );
        let editor = editor.unwrap();
        select(cx, &editor, Selection::new(0, 11));
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("compositor-font", cx);
            for _ in 0..4 {
                window.press("down", cx);
            }
            window.press("enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("Special Elite")
            );
            assert!(editor.read(cx).document().to_html().contains("<em>"));
            window.click("compositor-type-more", cx);
            window.click(("compositor-line-spacing", 3_usize), cx);
            window.click("compositor-keep-next", cx);
            window.click("compositor-before", cx);
            for _ in 0..3 {
                window.press("down", cx);
            }
            window.press("enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let html = editor.read(cx).document().to_html();
            assert!(html.contains("line-height: 2"));
            assert!(html.contains("data-space-before=\"12\""));
            assert!(html.contains("data-keep-with-next=\"true\""));
            view.update(cx, |view, cx| view.set_tab(CompositorTab::Home, cx));
            window.click("compositor-h1", cx);
            window.click("compositor-type-more", cx);
            let previous = editor.read(cx).document().to_html();
            window.click("compositor-keep-next", cx);
            assert_eq!(editor.read(cx).document().to_html(), previous);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn layout_and_running_heads_preserve_unknown_fields_and_last_character(
        cx: &mut TestAppContext,
    ) {
        let mut layout = LayoutSettings::default();
        layout
            .extra
            .insert("futureGutter".into(), json!({"inside": 0.75}));
        layout
            .opening_initial
            .as_mut()
            .unwrap()
            .extra
            .insert("futureFlourish".into(), json!("retain"));
        let (handle, view, _) = room(cx, None, layout, 1500.);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.set_capabilities(
                    CompositorCapabilities {
                        save_pdf: true,
                        ..Default::default()
                    },
                    cx,
                );
                view.set_chrome_text("Old", "Footer", window, cx);
                view.set_tab(CompositorTab::View, cx);
            });
            window.render_frame(cx);
            window.click("compositor-layout", cx);
            window.click("compositor-paper-a4", cx);
            window.click("compositor-landscape", cx);
            window.click("compositor-columns-two", cx);
            window.click("compositor-initial-alternate", cx);
            window.click("compositor-margin-guides", cx);
            window.click("compositor-running-header", cx);
            window.click("compositor-header", cx);
            window.press("secondary-a", cx);
            window.input("The last character 🦊", cx);
            window.click("compositor-footer", cx);
            window.press("secondary-a", cx);
            window.input("An exact footer", cx);
            assert_eq!(
                view.read(cx).chrome_text(cx),
                ("The last character 🦊".into(), "An exact footer".into())
            );
            window.click("compositor-save-pdf", cx);
            view.update(cx, |view, cx| view.set_tab(CompositorTab::Home, cx));
        })
        .unwrap();
        cx.update(|cx| {
            let layout = &view.read(cx).layout;
            assert_eq!(layout.paper, Some(PaperSize::A4));
            assert_eq!(layout.orientation, Some(Orientation::Landscape));
            assert_eq!(layout.columns, Some(2));
            assert_eq!(layout.pagination, None);
            assert!(layout.running_header);
            assert_eq!(layout.extra["futureGutter"], json!({"inside": 0.75}));
            assert_eq!(
                layout.opening_initial.as_ref().unwrap().extra["futureFlourish"],
                json!("retain")
            );
        });
        let captured = received.lock().unwrap();
        assert!(captured.iter().any(|event| matches!(event, CompositorEvent::ChromeTextChanged { kind: ChromeTextKind::Header, value } if value == "The last character 🦊")));
        assert!(captured.iter().any(|event| matches!(event, CompositorEvent::ChromeTextChanged { kind: ChromeTextKind::Footer, value } if value == "An exact footer")));
        assert!(captured.iter().any(|event| matches!(
            event,
            CompositorEvent::SavePdfRequested {
                include_persona_comments: false
            }
        )));
    }

    #[gpui_kit::test]
    fn lower_layout_fields_scroll_into_view_on_keyboard_focus_at_desktop_height(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _) = room(cx, None, LayoutSettings::default(), 860.);
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            view.update(cx, |view, cx| view.set_tab(CompositorTab::View, cx));
            window.render_frame(cx);
            window.click("compositor-layout", cx);
            assert!(!window.find("compositor-header").visible());
        })
        .unwrap();
        // Commit the initial frame before sending the real keyboard event.
        cx.update_window(handle, |_, window, cx| {
            let header = view.read(cx).controls.as_ref().unwrap().header.clone();
            for _ in 0..80 {
                window.press("tab", cx);
                if header.read(cx).focus_handle(cx).is_focused(window) {
                    break;
                }
            }
            assert!(header.read(cx).focus_handle(cx).is_focused(window));
        })
        .unwrap();
        // Draw the focus-triggered reveal as the native frame loop does.
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find("compositor-header").visible());
            window.input("Café — a running head", cx);
            // Saving can read the very last edit before a Change subscription commits.
            assert_eq!(view.read(cx).chrome_text(cx).0, "Café — a running head");
            window.press("tab", cx);
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find("compositor-footer").visible());
            window.input("Running footer", cx);
            window.press("escape", cx);
            assert_eq!(view.read(cx).popup, None);
            assert_eq!(
                view.read(cx).chrome_text(cx),
                ("Café — a running head".into(), "Running footer".into())
            );
        })
        .unwrap();
        assert!(received.lock().unwrap().iter().any(|event| matches!(event, CompositorEvent::ChromeTextChanged { kind: ChromeTextKind::Footer, value } if value == "Running footer")));
    }

    #[gpui_kit::test]
    fn colour_picker_validates_literals_and_preserves_imported_marks(cx: &mut TestAppContext) {
        let original = "<p><span data-comment-id=\"c1\"><em>Words</em></span><span data-type=\"raw-typst-inline\" data-typst-source=\"#keep[untouched]\"></span></p>";
        let (handle, view, editor) = room(cx, Some(original), LayoutSettings::default(), 860.);
        let editor = editor.unwrap();
        select(cx, &editor, Selection::new(0, 5));
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("compositor-color-picker", cx);
            window.click("compositor-custom-color", cx);
            window.press("secondary-a", cx);
            window.input("var(--color-ink)", cx);
            window.click("compositor-color-apply", cx);
            assert_eq!(editor.read(cx).document().to_html(), original);
            assert_eq!(view.read(cx).popup, Some(Popup::TextColor));
            assert!(view.read(cx).error.is_some());
            window.click("compositor-custom-color", cx);
            window.press("secondary-a", cx);
            window.input("#AbC", cx);
            window.click("compositor-color-apply", cx);
            let html = editor.read(cx).document().to_html();
            assert!(html.contains("color: #aabbcc"));
            assert!(html.contains("data-comment-id=\"c1\""));
            assert!(html.contains("<em>"));
            assert!(html.contains("#keep[untouched]"));
            assert_eq!(view.read(cx).popup, None);
            window.click("compositor-color-picker", cx);
            window.click("compositor-color-clear", cx);
            assert_eq!(editor.read(cx).document().to_html(), original);
            window.click("compositor-highlight-picker", cx);
            window.click(("compositor-color-swatch", 2_usize), cx);
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("background-color: #cfe0f2")
            );
            window.click("compositor-highlight", cx);
            assert_eq!(editor.read(cx).document().to_html(), original);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn table_grid_keyboard_and_note_dialog_insert_real_document_objects(cx: &mut TestAppContext) {
        let (handle, view, editor) =
            room(cx, Some("<p>Draft</p>"), LayoutSettings::default(), 860.);
        let editor = editor.unwrap();
        select(cx, &editor, Selection::caret(5));
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.set_tab(CompositorTab::Insert, cx));
            window.render_frame(cx);
            window.click("compositor-table", cx);
            window.press("right", cx);
            window.press("right", cx);
            window.press("down", cx);
            assert_eq!(
                window.find("compositor-table-dimensions").label(),
                Some("2 × 3 table")
            );
            window.press("enter", cx);
            let html = editor.read(cx).document().to_html();
            assert_eq!(html.as_str().matches("<tr>").count(), 2);
            assert_eq!(html.as_str().matches("<th>").count(), 3);
            assert_eq!(html.as_str().matches("<td>").count(), 3);
            assert_eq!(view.read(cx).popup, None);
            window.press("ctrl-z", cx);
            assert_eq!(editor.read(cx).document().to_html(), "<p>Draft</p>");
            window.click("compositor-endnote", cx);
            window.input("A & \"B\" — exact note.", cx);
            window.press("secondary-enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let html = editor.read(cx).document().to_html();
            assert!(html.contains("data-endnote-text=\"A &amp; &quot;B&quot; — exact note.\""));
            assert_eq!(view.read(cx).popup, None);
            window.click("compositor-footnote", cx);
            window.input("Footnote content.", cx);
            window.click("compositor-insert-submit", cx);
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("data-endnote-text=\"Footnote content.\"")
            );
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("data-type=\"footnote\"")
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn image_and_diagram_source_are_inserted_without_a_fabricated_preview(cx: &mut TestAppContext) {
        let (handle, view, editor) =
            room(cx, Some("<p>Draft</p>"), LayoutSettings::default(), 860.);
        let editor = editor.unwrap();
        select(cx, &editor, Selection::caret(5));
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.set_tab(CompositorTab::Insert, cx));
            window.render_frame(cx);
            window.click("compositor-image", cx);
            window.click("compositor-image-file", cx);
            assert_eq!(view.read(cx).popup, Some(Popup::Image));
            window.input("https://example.com/plate.png", cx);
            window.press("enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("src=\"https://example.com/plate.png\"")
            );
            window.click("compositor-diagram", cx);
            assert_eq!(
                window.find("compositor-diagram-status").label(),
                Some("Source retained. Diagram preview is unavailable offline.")
            );
            window.input("graph TD;\n  A[Draft] --> B{Revise?};", cx);
            window.click("compositor-insert-submit", cx);
            assert!(
                editor
                    .read(cx)
                    .document()
                    .to_html()
                    .contains("graph TD;\n  A[Draft] --&gt; B{Revise?};")
            );
            assert_eq!(view.read(cx).popup, None);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn unavailable_adapters_are_disabled_and_readonly_cannot_mutate_document(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, editor) = room(
            cx,
            Some("<p>Protected</p>"),
            LayoutSettings::default(),
            860.,
        );
        let editor = editor.unwrap();
        let received = events(cx, &view);
        select(cx, &editor, Selection::new(0, 9));
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.set_tab(CompositorTab::Review, cx));
            window.render_frame(cx);
            for id in [
                "compositor-add-margin",
                "compositor-read-aloud",
                "compositor-history",
                "compositor-find",
                "compositor-grammar",
            ] {
                window.click(id, cx);
            }
            view.update(cx, |view, cx| {
                view.set_capabilities(
                    CompositorCapabilities {
                        margin_notes: true,
                        find: true,
                        ..Default::default()
                    },
                    cx,
                )
            });
            window.click("compositor-add-margin", cx);
            window.click("compositor-find", cx);
            view.update(cx, |view, cx| {
                view.set_read_only(true, cx);
                view.set_tab(CompositorTab::Home, cx);
            });
            window.click("compositor-bold", cx);
            assert_eq!(editor.read(cx).document().to_html(), "<p>Protected</p>");
            view.update(cx, |view, cx| view.set_tab(CompositorTab::View, cx));
            window.click("compositor-layout", cx);
            window.click("compositor-paper-a4", cx);
            assert_eq!(view.read(cx).layout.paper, Some(PaperSize::Letter));
        })
        .unwrap();
        let captured = received.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert!(
            matches!(captured[0], CompositorEvent::MarginNoteRequested { selection } if selection == Selection::new(0, 9))
        );
        assert!(matches!(captured[1], CompositorEvent::FindRequested));
    }
}
