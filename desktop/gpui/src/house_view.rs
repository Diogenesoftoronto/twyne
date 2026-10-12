//! Native Cabinet, Register and Library, using the original House vocabulary
//! and paper/typewriter styles. A request is not a filed change: only Root's
//! durable acknowledgement updates the cabinet and membership read model.

use crate::{
    dossier,
    house::{
        self, CharterDraft, CharterItem, CharterKind, CharterScope, CharterSeverity, ContextLayer,
        HouseEdit, HouseRecord, HouseRequest, HouseSession, INHERITABLE_FIELDS, LedgerEntry,
        LedgerSource, LibraryFolio, LibraryQuery, LibraryScope, LibrarySort, PartialAnswers,
    },
    manuscript::timestamp,
    theme::{self, DISPLAY_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT},
    workspace::{BriefField, FolioType},
};
use anyhow::Result;
use chrono::{DateTime, Local};
use gpui_kit::component::{
    Disableable, IndexPath, Sizable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    checkbox::Checkbox,
    input::{IndentInline, Input, InputEvent, InputState, OutdentInline, Textarea, TextareaState},
    select::{SearchableVec, Select, SelectEvent, SelectItem, SelectState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AccessibleAction, AnyElement, App, Bounds, BoxShadow, Context, Entity, EventEmitter,
    FocusHandle, Focusable, FontWeight, Render, Role, ScrollHandle, SharedString, Subscription,
    TestSupportExt, Window, canvas, div, fill, linear_color_stop, linear_gradient, point, px, rgb,
    size,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HouseCapabilities {
    pub persist: bool,
    pub refine_dossier: bool,
    pub folio_archive: bool,
    pub export_house: bool,
    pub engine_room: bool,
    /// Optional browsing controls; original Library chrome is the default.
    pub library_filters: bool,
}
impl HouseCapabilities {
    pub fn local() -> Self {
        Self {
            persist: true,
            refine_dossier: true,
            ..Self::default()
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub enum HouseEvent {
    SaveRequested(HouseRequest),
    OpenFolio(Uuid),
    BackToDesk,
    LibraryRequested,
    HouseRequested,
    RefineDossier(Uuid),
    FolioArchiveRequested { native_id: Uuid, archived: bool },
    ExportRequested,
    EngineRequested,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum HouseSelection {
    #[default]
    House,
    Collection(String),
    Folio(String),
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HouseTab {
    #[default]
    Cabinet,
    Register,
    Engine,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RegisterFilter {
    #[default]
    Everything,
    Amendments,
    Dossiers,
    Charters,
    Collections,
}
impl RegisterFilter {
    fn label(self) -> &'static str {
        match self {
            Self::Everything => "Everything",
            Self::Amendments => "Amendments",
            Self::Dossiers => "Dossiers",
            Self::Charters => "Charters",
            Self::Collections => "Collections",
        }
    }
    fn matches(self, entry: &LedgerEntry) -> bool {
        match self {
            Self::Everything => true,
            Self::Amendments => entry.source == LedgerSource::Amendment,
            Self::Dossiers => {
                entry.layer != ContextLayer::Charter
                    && entry.field.as_ref().is_some_and(|value| !value.is_empty())
                    && entry.source != LedgerSource::Amendment
            }
            Self::Charters => entry.layer == ContextLayer::Charter,
            Self::Collections => entry.layer == ContextLayer::Collection,
        }
    }
}
enum AfterSave {
    Select(HouseSelection),
    Navigate(HouseEvent),
    Tab(HouseTab),
}
#[derive(Clone)]
struct CollectionChoice {
    label: SharedString,
    value: String,
}
impl SelectItem for CollectionChoice {
    type Value = String;
    fn title(&self) -> SharedString {
        self.label.clone()
    }
    fn value(&self) -> &String {
        &self.value
    }
}
fn collection_choices(record: &HouseRecord) -> SearchableVec<CollectionChoice> {
    SearchableVec::new(
        std::iter::once(CollectionChoice {
            label: "Loose — no collection".into(),
            value: String::new(),
        })
        .chain(
            record
                .state
                .collections
                .iter()
                .map(|collection| CollectionChoice {
                    label: collection.name.clone().into(),
                    value: collection.id.clone(),
                }),
        )
        .collect::<Vec<_>>(),
    )
}

pub struct HouseView {
    session: HouseSession,
    folios: Vec<LibraryFolio>,
    capabilities: HouseCapabilities,
    selection: HouseSelection,
    tab: HouseTab,
    filter: RegisterFilter,
    active_folio: Option<Uuid>,
    name: Entity<InputState>,
    collection_name: Entity<InputState>,
    description: Entity<TextareaState>,
    fields: [Entity<TextareaState>; 6],
    filed_under: Entity<SelectState<SearchableVec<CollectionChoice>>>,
    articles: BTreeMap<String, Entity<InputState>>,
    new_article: Entity<InputState>,
    new_severity: CharterSeverity,
    confirm_dissolve: bool,
    after_save: Option<AfterSave>,
    clear_article_after_save: bool,
    pending_message: String,
    message: Option<String>,
    local_error: Option<String>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    _subscriptions: Vec<Subscription>,
    article_subscriptions: Vec<Subscription>,
    input_bounds: Arc<Mutex<BTreeMap<String, Bounds<gpui_kit::Pixels>>>>,
    revealed_focus: Option<String>,
}
impl EventEmitter<HouseEvent> for HouseView {}
impl Focusable for HouseView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl HouseView {
    pub fn new(
        record: Arc<HouseRecord>,
        folios: Vec<LibraryFolio>,
        capabilities: HouseCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subscriptions = Vec::new();
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("Name your house"));
        let collection_name = cx.new(|cx| InputState::new(window, cx));
        let description = cx.new(|cx| {
            TextareaState::new(window, cx).placeholder("What binds this series together")
        });
        let fields = std::array::from_fn(|_| {
            cx.new(|cx| {
                TextareaState::new(window, cx).placeholder("Leave blank to let each piece decide")
            })
        });
        let new_article = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("e.g. Cite a primary source for every statistic")
        });
        let filed_under = cx.new(|cx| {
            SelectState::new(
                collection_choices(&record),
                Some(IndexPath::new(0)),
                window,
                cx,
            )
        });
        subscriptions.push(cx.subscribe_in(
            &filed_under,
            window,
            |this, _, event: &SelectEvent<SearchableVec<CollectionChoice>>, _, cx| {
                if let SelectEvent::Confirm(Some(value)) = event
                    && let HouseSelection::Folio(id) = &this.selection
                {
                    this.commit_extra(
                        HouseEdit::Membership {
                            folio_id: id.clone(),
                            collection_id: (!value.is_empty()).then(|| value.clone()),
                        },
                        if value.is_empty() {
                            "Now a loose folio."
                        } else {
                            "Filed under the collection."
                        },
                        cx,
                    );
                }
            },
        ));
        for state in [&name, &collection_name] {
            subscriptions.push(cx.subscribe_in(
                state,
                window,
                |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                        let _ = this.flush_pending_edits(window, cx);
                    }
                    cx.notify();
                },
            ));
        }
        for state in std::iter::once(&description).chain(fields.iter()) {
            subscriptions.push(cx.subscribe_in(
                state,
                window,
                |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur) {
                        let _ = this.flush_pending_edits(window, cx);
                    }
                    cx.notify();
                },
            ));
        }
        subscriptions.push(cx.subscribe(&new_article, |_, _, _: &InputEvent, cx| cx.notify()));
        let mut result = Self {
            session: HouseSession::new(record),
            folios,
            capabilities,
            selection: HouseSelection::House,
            tab: HouseTab::Cabinet,
            filter: RegisterFilter::Everything,
            active_folio: None,
            name,
            collection_name,
            description,
            fields,
            filed_under,
            articles: BTreeMap::new(),
            new_article,
            new_severity: CharterSeverity::Prefer,
            confirm_dissolve: false,
            after_save: None,
            clear_article_after_save: false,
            pending_message: String::new(),
            message: None,
            local_error: None,
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            _subscriptions: subscriptions,
            article_subscriptions: Vec::new(),
            input_bounds: Arc::new(Mutex::new(BTreeMap::new())),
            revealed_focus: None,
        };
        result.sync_controls(window, cx);
        result
    }
    pub fn saved_record(&self) -> &Arc<HouseRecord> {
        self.session.saved()
    }
    pub fn pending_request(&self) -> Option<&HouseRequest> {
        self.session.pending()
    }
    pub fn pending_request_id(&self) -> Option<Uuid> {
        self.session.pending().map(|request| request.request_id)
    }
    pub fn selection(&self) -> &HouseSelection {
        &self.selection
    }
    pub fn set_folios(&mut self, folios: Vec<LibraryFolio>, cx: &mut Context<Self>) {
        self.folios = folios;
        cx.notify();
    }
    pub fn set_active_folio(&mut self, folio: Option<Uuid>, cx: &mut Context<Self>) {
        self.active_folio = folio;
        cx.notify();
    }
    pub fn set_capabilities(&mut self, capabilities: HouseCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn set_selection(
        &mut self,
        selection: HouseSelection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.selection == selection {
            return;
        }
        match self.flush_pending_edits(window, cx) {
            Ok(Some(_)) => self.after_save = Some(AfterSave::Select(selection)),
            Ok(None) => self.select_now(selection, window, cx),
            Err(_) => {}
        }
    }
    fn select_now(
        &mut self,
        selection: HouseSelection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selection = selection;
        self.confirm_dissolve = false;
        self.message = None;
        self.local_error = None;
        self.new_severity = CharterSeverity::Prefer;
        self.new_article
            .update(cx, |state, cx| state.set_value("", window, cx));
        self.sync_controls(window, cx);
        cx.notify();
    }
    pub fn set_tab(&mut self, tab: HouseTab, window: &mut Window, cx: &mut Context<Self>) {
        if tab == HouseTab::Engine {
            if self.capabilities.engine_room {
                self.navigate(HouseEvent::EngineRequested, window, cx);
            }
            return;
        }
        match self.flush_pending_edits(window, cx) {
            Ok(Some(_)) => self.after_save = Some(AfterSave::Tab(tab)),
            Ok(None) => {
                self.tab = tab;
                cx.notify();
            }
            Err(_) => {}
        }
    }
    /// Update from another durable writer only when no held form edit can be
    /// discarded. Root can flush this view first to coordinate multiple routes.
    pub fn replace_record(
        &mut self,
        record: Arc<HouseRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.has_unsaved_changes(cx) || self.session.pending().is_some() {
            return false;
        }
        if !self.session.replace_record(record) {
            return false;
        }
        self.sync_controls(window, cx);
        cx.notify();
        true
    }
    pub fn acknowledge_saved(
        &mut self,
        id: Uuid,
        record: Arc<HouseRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.session.acknowledge_saved(id, record) {
            return false;
        }
        self.message = Some(self.pending_message.clone());
        self.local_error = None;
        if self.clear_article_after_save {
            self.new_article
                .update(cx, |state, cx| state.set_value("", window, cx));
            self.clear_article_after_save = false;
        }
        self.sync_controls(window, cx);
        match self.after_save.take() {
            Some(AfterSave::Select(selection)) => self.select_now(selection, window, cx),
            Some(AfterSave::Navigate(event)) => cx.emit(event),
            Some(AfterSave::Tab(tab)) => self.tab = tab,
            None => {}
        }
        cx.notify();
        true
    }
    pub fn ack_saved(
        &mut self,
        id: Uuid,
        record: Arc<HouseRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        self.acknowledge_saved(id, record, window, cx)
    }
    pub fn report_error(
        &mut self,
        id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.session.report_error(id, message) {
            return false;
        }
        self.message = None;
        cx.notify();
        true
    }
    fn writable(&self) -> bool {
        self.capabilities.persist && self.session.pending().is_none()
    }
    fn name_input(&self, font_size: f32, cx: &Context<Self>) -> Input {
        let mut input = Input::new(&self.name)
            .id("house-name")
            .accessibility_id("house-name")
            .appearance(false)
            .bordered(false)
            .focus_bordered(false)
            .mt(px(6.4))
            .p_0()
            .line_height(gpui_kit::relative(1.05))
            .font_weight(FontWeight::BOLD)
            .aria_label("The name of your house")
            .font_family(DISPLAY_FONT)
            .text_size(px(font_size))
            .when(self.name.read(cx).text().len() == 0, |input| {
                input.opacity(0.6)
            })
            .disabled(!self.writable());
        // Input::h changes only a multi-line frame. The letterhead is a
        // single-line input, so set the actual Styled frame height instead.
        input.style().size.height = Some(px(font_size * 1.05).into());
        input
    }
    fn anchor(&self, key: &str, child: AnyElement) -> AnyElement {
        let key = key.to_owned();
        let measured = self.input_bounds.clone();
        div()
            .relative()
            .min_w_0()
            .child(child)
            .child(
                canvas(
                    move |bounds, _, _| {
                        measured.lock().unwrap().insert(key.clone(), bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .left(px(0.))
                .top(px(0.))
                .size_full(),
            )
            .into_any_element()
    }
    fn reveal_focused_input(&mut self, window: &Window, cx: &mut Context<Self>) {
        let mut focused = None;
        for (key, input) in [
            ("house-name", &self.name),
            ("house-collection-name", &self.collection_name),
            ("house-new-article", &self.new_article),
        ] {
            if input.read(cx).focus_handle(cx).is_focused(window) {
                focused = Some(key.to_owned());
                break;
            }
        }
        if self
            .description
            .read(cx)
            .focus_handle(cx)
            .is_focused(window)
        {
            focused = Some("house-collection-description".into());
        }
        for (index, input) in self.fields.iter().enumerate() {
            if input.read(cx).focus_handle(cx).is_focused(window) {
                focused = Some(house::field_key(INHERITABLE_FIELDS[index]).into());
                break;
            }
        }
        for (id, input) in &self.articles {
            if input.read(cx).focus_handle(cx).is_focused(window) {
                focused = Some(format!("article:{id}"));
                break;
            }
        }
        if focused == self.revealed_focus {
            return;
        }
        let Some(key) = focused else {
            self.revealed_focus = None;
            return;
        };
        let Some(bounds) = self.input_bounds.lock().unwrap().get(&key).copied() else {
            return;
        };
        let viewport = self.scroll_handle.bounds();
        let mut offset = self.scroll_handle.offset();
        if bounds.bottom() > viewport.bottom() - px(16.) {
            offset.y -= bounds.bottom() - (viewport.bottom() - px(16.));
        } else if bounds.top() < viewport.top() + px(16.) {
            offset.y += viewport.top() + px(16.) - bounds.top();
        }
        self.scroll_handle.set_offset(offset);
        self.revealed_focus = Some(key);
        cx.notify();
    }
    fn navigate_form_tab(&mut self, reverse: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .description
            .read(cx)
            .focus_handle(cx)
            .is_focused(window)
            || self
                .fields
                .iter()
                .any(|field| field.read(cx).focus_handle(cx).is_focused(window))
        {
            // Prose form fields use the web form's Tab navigation. Consume
            // the native indentation action before the textarea changes text.
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
    fn selected_owner(&self) -> (CharterScope, String) {
        match &self.selection {
            HouseSelection::House => (CharterScope::House, "house".into()),
            HouseSelection::Collection(id) => (CharterScope::Collection, id.clone()),
            HouseSelection::Folio(id) => (CharterScope::Folio, id.clone()),
        }
    }
    fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let record = self.session.saved().clone();
        let state = &record.state;
        let selected = match &self.selection {
            HouseSelection::Folio(id) => state
                .collection_for_folio(id)
                .map(|collection| collection.id.clone())
                .unwrap_or_default(),
            _ => String::new(),
        };
        self.filed_under.update(cx, |select, cx| {
            select.set_items(collection_choices(&record), window, cx);
            select.set_selected_value(&selected, window, cx);
        });
        self.name.update(cx, |input, cx| {
            input.set_value(&state.house.name, window, cx)
        });
        let collection = match &self.selection {
            HouseSelection::Collection(id) => state.collection(id),
            _ => None,
        };
        self.collection_name.update(cx, |input, cx| {
            input.set_value(
                collection.map_or("", |collection| collection.name.as_str()),
                window,
                cx,
            )
        });
        self.description.update(cx, |input, cx| {
            input.set_value(
                collection.map_or("", |collection| collection.description.as_str()),
                window,
                cx,
            )
        });
        let partial = collection.map_or(&state.house.dossier, |collection| &collection.dossier);
        for (index, field) in INHERITABLE_FIELDS.iter().enumerate() {
            self.fields[index].update(cx, |input, cx| {
                input.set_value(partial.get(*field).unwrap_or(""), window, cx)
            });
        }
        let (scope, owner) = self.selected_owner();
        let placeholder = match scope {
            CharterScope::House => "e.g. Cite a primary source for every statistic",
            CharterScope::Collection => "e.g. Every issue opens on a scene, not a thesis",
            _ => "Stay under 1,200 words",
        };
        self.new_article.update(cx, |input, cx| {
            input.set_placeholder(placeholder, window, cx)
        });
        self.articles.retain(|id, _| {
            state
                .charter
                .iter()
                .any(|article| &article.id == id && article.owner_ref == owner)
        });
        self.article_subscriptions.clear();
        for article in state
            .charter
            .iter()
            .filter(|article| article.owner_ref == owner)
        {
            let control = self
                .articles
                .entry(article.id.clone())
                .or_insert_with(|| cx.new(|cx| InputState::new(window, cx)))
                .clone();
            control.update(cx, |input, cx| input.set_value(&article.text, window, cx));
            self.article_subscriptions.push(cx.subscribe_in(
                &control,
                window,
                |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                        let _ = this.flush_pending_edits(window, cx);
                    }
                    cx.notify();
                },
            ));
        }
    }
    fn held_edits(&self, cx: &App) -> Vec<HouseEdit> {
        let state = &self.session.saved().state;
        let mut edits = Vec::new();
        let name = self.name.read(cx).text().to_string();
        if name.trim_matches(house::is_js_whitespace) != state.house.name {
            edits.push(HouseEdit::Name(name));
        }
        match &self.selection {
            HouseSelection::House => {
                for (index, field) in INHERITABLE_FIELDS.iter().enumerate() {
                    let value = self.fields[index].read(cx).text().to_string();
                    if value.trim_matches(house::is_js_whitespace)
                        != state.house.dossier.get(*field).unwrap_or("")
                    {
                        edits.push(HouseEdit::HouseField {
                            field: *field,
                            value,
                        });
                    }
                }
            }
            HouseSelection::Collection(id) => {
                if let Some(collection) = state.collection(id) {
                    let name = self.collection_name.read(cx).text().to_string();
                    let description = self.description.read(cx).text().to_string();
                    let changed_name = !name.trim_matches(house::is_js_whitespace).is_empty()
                        && name.trim_matches(house::is_js_whitespace) != collection.name;
                    let changed_description =
                        description.trim_matches(house::is_js_whitespace) != collection.description;
                    if changed_name || changed_description {
                        edits.push(HouseEdit::UpdateCollection {
                            id: id.clone(),
                            name: changed_name.then_some(name),
                            description: changed_description.then_some(description),
                            field: None,
                        });
                    }
                    for (index, field) in INHERITABLE_FIELDS.iter().enumerate() {
                        let value = self.fields[index].read(cx).text().to_string();
                        if value.trim_matches(house::is_js_whitespace)
                            != collection.dossier.get(*field).unwrap_or("")
                        {
                            edits.push(HouseEdit::UpdateCollection {
                                id: id.clone(),
                                name: None,
                                description: None,
                                field: Some((*field, value)),
                            });
                        }
                    }
                }
            }
            HouseSelection::Folio(_) => {}
        }
        for (id, control) in &self.articles {
            if let Some(article) = state.charter.iter().find(|article| &article.id == id) {
                let value = control.read(cx).text().to_string();
                if !value.trim_matches(house::is_js_whitespace).is_empty()
                    && value.trim_matches(house::is_js_whitespace) != article.text
                {
                    edits.push(HouseEdit::Charter(CharterDraft {
                        id: Some(id.clone()),
                        scope: article.scope.clone(),
                        owner_ref: article.owner_ref.clone(),
                        text: value,
                        severity: article.severity.clone(),
                        kind: article.kind.clone(),
                        order: Some(article.order),
                    }));
                }
            }
        }
        edits
    }
    /// Reads actual controls synchronously, including queued final keystrokes.
    /// New article prose remains an unfiled draft until its explicit Add action.
    pub fn has_unsaved_changes(&self, cx: &App) -> bool {
        !self.held_edits(cx).is_empty()
    }
    pub fn flush_pending_edits(
        &mut self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<HouseRequest>> {
        self.prepare_pending_edits(cx)
    }
    /// Quit hooks have no Window. Input text is nevertheless available here,
    /// so closing and ordinary blur use exactly the same freshness boundary.
    pub fn prepare_pending_edits(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Result<Option<HouseRequest>> {
        if let Some(request) = self.session.pending() {
            return Ok(Some(request.clone()));
        }
        let edits = self.held_edits(cx);
        if edits.is_empty() {
            return Ok(None);
        }
        if !self.capabilities.persist {
            return Ok(None);
        }
        self.request(HouseEdit::Batch(edits), "Changes filed.", cx)
    }
    fn request(
        &mut self,
        edit: HouseEdit,
        message: &str,
        cx: &mut Context<Self>,
    ) -> Result<Option<HouseRequest>> {
        if !self.writable() {
            return Ok(self.session.pending().cloned());
        }
        match self.session.request(edit, timestamp()) {
            Ok(Some(request)) => {
                self.pending_message = message.into();
                self.message = None;
                self.local_error = None;
                cx.emit(HouseEvent::SaveRequested(request.clone()));
                cx.notify();
                Ok(Some(request))
            }
            Ok(None) => Ok(None),
            Err(error) => {
                self.local_error = Some(error.to_string());
                cx.notify();
                Err(error)
            }
        }
    }
    fn commit_extra(&mut self, edit: HouseEdit, message: &str, cx: &mut Context<Self>) -> bool {
        if !self.writable() {
            return false;
        }
        let mut edits = self.held_edits(cx);
        edits.push(edit);
        self.request(HouseEdit::Batch(edits), message, cx)
            .ok()
            .flatten()
            .is_some()
    }
    fn navigate(&mut self, event: HouseEvent, window: &mut Window, cx: &mut Context<Self>) {
        match self.flush_pending_edits(window, cx) {
            Ok(Some(_)) => self.after_save = Some(AfterSave::Navigate(event)),
            Ok(None) => cx.emit(event),
            Err(_) => {}
        }
    }
    fn founding(&mut self, cx: &mut Context<Self>) {
        let id = Uuid::new_v4().to_string();
        if self.commit_extra(
            HouseEdit::CreateCollection {
                id: id.clone(),
                name: "New collection".into(),
                folio_ids: Vec::new(),
            },
            "Collection founded.",
            cx,
        ) {
            self.after_save = Some(AfterSave::Select(HouseSelection::Collection(id)));
        }
    }
    fn add_article(&mut self, cx: &mut Context<Self>) {
        let text = self.new_article.read(cx).text().to_string();
        if text.trim_matches(house::is_js_whitespace).is_empty() {
            return;
        }
        let (scope, owner_ref) = self.selected_owner();
        if self.commit_extra(
            HouseEdit::Charter(CharterDraft {
                id: None,
                scope,
                owner_ref,
                text,
                severity: self.new_severity.clone(),
                kind: CharterKind::General,
                order: None,
            }),
            "Article added to the charter.",
            cx,
        ) {
            self.clear_article_after_save = true;
        }
    }
    fn toggle_article(&mut self, article: CharterItem, cx: &mut Context<Self>) {
        let text = self.articles.get(&article.id).map_or_else(
            || article.text.clone(),
            |control| control.read(cx).text().to_string(),
        );
        self.commit_extra(
            HouseEdit::Charter(CharterDraft {
                id: Some(article.id),
                scope: article.scope,
                owner_ref: article.owner_ref,
                text,
                severity: if article.severity == CharterSeverity::Must {
                    CharterSeverity::Prefer
                } else {
                    CharterSeverity::Must
                },
                kind: article.kind,
                order: Some(article.order),
            }),
            "Article reset.",
            cx,
        );
    }
    fn status(&self) -> String {
        self.session
            .error()
            .or(self.local_error.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if self.session.busy() {
                    "Filing on this device…".into()
                } else {
                    self.message
                        .clone()
                        .unwrap_or_else(|| "Changes are filed as you leave a field.".into())
                }
            })
    }
    fn footer(&self, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let error = self.session.error().is_some() || self.local_error.is_some();
        let mut actions = div().flex().gap(px(8.));
        if self.session.error().is_some() {
            actions = actions
                .child(
                    paper_button("house-retry", "Retry filing", cx).on_click(cx.listener(
                        |this, _, _, cx| {
                            if let Some(request) = this.session.retry() {
                                cx.emit(HouseEvent::SaveRequested(request));
                                cx.notify();
                            }
                        },
                    )),
                )
                .child(
                    paper_button("house-discard", "Discard change", cx).on_click(cx.listener(
                        |this, _, window, cx| {
                            if this.session.discard_failed() {
                                this.after_save = None;
                                this.clear_article_after_save = false;
                                this.sync_controls(window, cx);
                                cx.notify();
                            }
                        },
                    )),
                );
        } else {
            actions = actions.child(
                paper_button("house-save", "File changes", cx)
                    .disabled(!self.writable() || !self.has_unsaved_changes(cx))
                    .on_click(cx.listener(|this, _, window, cx| {
                        let _ = this.flush_pending_edits(window, cx);
                    })),
            )
        }
        let _ = window;
        div()
            .id("house-save-status")
            .test_support()
            .mt(px(32.))
            .pt(px(16.))
            .border_t_1()
            .border_color(rgb(p.rule))
            .flex()
            .flex_wrap()
            .justify_between()
            .items_center()
            .gap(px(8.))
            .child(
                div()
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(9.92))
                    .text_color(rgb(if error { p.vermilion } else { p.ink_muted }))
                    .child(self.status()),
            )
            .child(actions)
            .into_any_element()
    }
    fn fields_section(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let collection = match &self.selection {
            HouseSelection::Collection(id) => self.session.saved().state.collection(id),
            _ => None,
        };
        let mut rows = div().flex().flex_col();
        for (index, field) in INHERITABLE_FIELDS.iter().enumerate() {
            let inherited = collection
                .and_then(|_| self.session.saved().state.house.dossier.get(*field))
                .filter(|value| !value.trim_matches(house::is_js_whitespace).is_empty());
            rows = rows.child(
                div()
                    .relative()
                    .flex()
                    .gap(px(12.))
                    .py(px(8.8))
                    .border_b_1()
                    .border_color(rgb(0).opacity(0.))
                    .child(div().w(px(136.)).flex_shrink_0().pt(px(4.8)).child(tracked(
                        &field_label_upper(*field),
                        9.6,
                        1.536,
                        1.2,
                        p.ink_muted,
                    )))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                self.anchor(
                                    house::field_key(*field),
                                    Textarea::new(&self.fields[index])
                                        .accessibility_id(format!(
                                            "house-field-{}",
                                            house::field_key(*field)
                                        ))
                                        .aria_label(house::field_label(*field))
                                        .text_size(px(15.2))
                                        .line_height(gpui_kit::relative(1.5))
                                        .font_family(TYPEWRITER_FONT)
                                        .h(px(48.))
                                        .disabled(!self.writable())
                                        .into_any_element(),
                                ),
                            )
                            .when_some(inherited, |row, value| {
                                row.child(
                                    div()
                                        .text_size(px(11.52))
                                        .text_color(rgb(p.ink_muted))
                                        .child(format!("Inherits: {value}")),
                                )
                            }),
                    )
                    .child(dotted_rule(p.rule)),
            );
        }
        div()
            .mt(px(28.))
            .child(section_head(
                "Dossier",
                if collection.is_some() {
                    "Narrows the House for these folios"
                } else {
                    "Inherited by every folio"
                },
                cx,
            ))
            .child(rows)
            .into_any_element()
    }
    fn charter_section(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let state = &self.session.saved().state;
        let (_, owner) = self.selected_owner();
        let inherited = match &self.selection {
            HouseSelection::House => Vec::new(),
            HouseSelection::Collection(_) => state
                .charter
                .iter()
                .filter(|item| item.owner_ref == "house")
                .cloned()
                .collect(),
            HouseSelection::Folio(id) => house::assemble_context_stack(
                state,
                id,
                self.folios
                    .iter()
                    .find(|folio| &folio.folio_id == id)
                    .and_then(|folio| folio.brief.as_ref()),
                &PartialAnswers::default(),
            )
            .charter
            .into_iter()
            .filter(|item| item.inherited)
            .map(|item| item.item)
            .collect(),
        };
        let own = state
            .charter
            .iter()
            .filter(|item| item.owner_ref == owner)
            .cloned()
            .collect::<Vec<_>>();
        let mut rows = div().flex().flex_col();
        for (index, article) in inherited.iter().chain(own.iter()).enumerate() {
            let is_inherited = article.owner_ref != owner;
            let must = article.severity == CharterSeverity::Must;
            let text = if let Some(control) = self.articles.get(&article.id) {
                self.anchor(
                    &format!("article:{}", article.id),
                    Input::new(control)
                        .id(SharedString::from(format!("house-article-{}", article.id)))
                        .aria_label("Charter article")
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(14.72))
                        .line_height(gpui_kit::relative(1.5))
                        .small()
                        .disabled(!self.writable())
                        .into_any_element(),
                )
            } else {
                div()
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(14.72))
                    .text_color(rgb(p.ink_light))
                    .child(article.text.clone())
                    .into_any_element()
            };
            let toggle = article.clone();
            let id = article.id.clone();
            rows = rows.child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .py(px(8.8))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .when(is_inherited, |row| row.opacity(0.8))
                    .child(
                        div()
                            .w(px(38.4))
                            .pt(px(4.8))
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(9.28))
                            .text_color(rgb(p.ink_muted))
                            .child(format!("Art. {}", index + 1)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(text)
                            .when(is_inherited, |row| {
                                row.child(stamp(scope_layer(&article.scope), cx))
                            }),
                    )
                    .child(
                        paper_button(
                            SharedString::from(format!("house-severity-{}", article.id)),
                            article.severity.as_str(),
                            cx,
                        )
                        .small()
                        .text_color(rgb(if must { p.vermilion } else { p.ink_muted }))
                        .disabled(is_inherited || !self.writable())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.toggle_article(toggle.clone(), cx)
                        })),
                    )
                    .when(!is_inherited, |row| {
                        row.child(
                            paper_button(
                                SharedString::from(format!("house-withdraw-{}", article.id)),
                                "Withdraw",
                                cx,
                            )
                            .small()
                            .disabled(!self.writable())
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    this.commit_extra(
                                        HouseEdit::WithdrawCharter(id.clone()),
                                        "Standard withdrawn.",
                                        cx,
                                    );
                                },
                            )),
                        )
                    }),
            );
        }
        let mut section = div().mt(px(28.)).child(section_head(
            "Charter",
            "Standards that follow each piece",
            cx,
        ));
        if inherited.is_empty() && own.is_empty() {
            section = section.child(
                div()
                    .italic()
                    .text_size(px(12.48))
                    .text_color(rgb(p.ink_muted))
                    .child("No articles yet."),
            );
        }
        section
            .child(rows)
            .child(
                div()
                    .mt(px(12.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div().flex_1().min_w_0().child(
                            self.anchor(
                                "house-new-article",
                                Input::new(&self.new_article)
                                    .id("house-new-article")
                                    .aria_label("New charter article")
                                    .font_family(TYPEWRITER_FONT)
                                    .line_height(gpui_kit::relative(1.5))
                                    .small()
                                    .disabled(!self.writable())
                                    .into_any_element(),
                            ),
                        ),
                    )
                    .child(
                        paper_button("house-new-severity", self.new_severity.as_str(), cx)
                            .toggled(self.new_severity == CharterSeverity::Must)
                            .disabled(!self.writable())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.new_severity = if this.new_severity == CharterSeverity::Must {
                                    CharterSeverity::Prefer
                                } else {
                                    CharterSeverity::Must
                                };
                                cx.notify();
                            })),
                    )
                    .child(
                        press_button("house-add-article", "Add article", cx)
                            .disabled(
                                !self.writable()
                                    || self
                                        .new_article
                                        .read(cx)
                                        .text()
                                        .to_string()
                                        .trim_matches(house::is_js_whitespace)
                                        .is_empty(),
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.add_article(cx))),
                    ),
            )
            .into_any_element()
    }
    fn collection_members(&self, id: &str, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let state = &self.session.saved().state;
        let viewport_width = f32::from(window.viewport_size().width);
        let inner_width = (viewport_width.min(1216.)
            - if viewport_width <= 640. { 32. } else { 48. }
            - if viewport_width <= 900. { 0. } else { 448. }
            - 74.)
            .max(192.);
        let columns = ((inner_width + 8.) / 200.).floor().max(1.);
        let member_width = (inner_width - 8. * (columns - 1.)) / columns;
        let mut members = div().flex().flex_wrap().gap(px(8.));
        for folio in &self.folios {
            let chosen = state.collection_for_folio(&folio.folio_id);
            let in_collection = chosen.is_some_and(|collection| collection.id == id);
            let other = chosen.filter(|collection| collection.id != id);
            let folio_id = folio.folio_id.clone();
            let target = id.to_owned();
            members = members.child(
                Checkbox::new(SharedString::from(format!(
                    "house-member-{}",
                    folio.folio_id
                )))
                .accessibility_label(folio_title(folio))
                .w(px(member_width))
                .px(px(10.4))
                .py(px(8.))
                .border_1()
                .border_color(rgb(p.rule))
                .bg(rgb(p.paper))
                .rounded_none()
                .items_center()
                .font_family(DISPLAY_FONT)
                .text_size(px(13.6))
                .line_height(gpui_kit::relative(1.5))
                .checked(in_collection)
                .disabled(!self.writable())
                .child(
                    div()
                        .font_family(DISPLAY_FONT)
                        .text_size(px(13.6))
                        .line_height(gpui_kit::relative(1.5))
                        .child(folio_title(folio))
                        .when_some(other, |label, collection| {
                            label.child(
                                div()
                                    .font_family(TYPEWRITER_FONT)
                                    .text_size(px(9.28))
                                    .line_height(gpui_kit::relative(1.5))
                                    .text_color(rgb(p.ink_muted))
                                    .child(format!("now in {}", collection.name)),
                            )
                        }),
                )
                .on_change(cx.listener(move |this, checked: &bool, _, cx| {
                    this.commit_extra(
                        HouseEdit::Membership {
                            folio_id: folio_id.clone(),
                            collection_id: checked.then(|| target.clone()),
                        },
                        "Collection membership changed.",
                        cx,
                    );
                })),
            )
        }
        let unresolved = state.collection(id).map_or(0, |collection| {
            collection
                .folio_ids
                .iter()
                .filter(|id| !self.folios.iter().any(|folio| &folio.folio_id == *id))
                .count()
        });
        div()
            .mt(px(28.))
            .child(section_head(
                "Folios in this collection",
                "A folio sits in one drawer at a time.",
                cx,
            ))
            .child(members)
            .when(unresolved > 0, |section| {
                section.child(
                    div()
                        .mt(px(8.))
                        .italic()
                        .text_size(px(12.48))
                        .text_color(rgb(p.ink_muted))
                        .child(format!(
                            "{unresolved} filed {} not imported on this desk.",
                            if unresolved == 1 {
                                "folio is"
                            } else {
                                "folios are"
                            }
                        )),
                )
            })
            .into_any_element()
    }
    fn folio_sheet(&self, id: &str, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let Some(folio) = self.folios.iter().find(|folio| folio.folio_id == id) else {
            return div()
                .child("This folio has not been imported on this device.")
                .into_any_element();
        };
        let stand_ins = partial_stand_ins();
        let stack = house::assemble_context_stack(
            &self.session.saved().state,
            id,
            folio.brief.as_ref(),
            &stand_ins,
        );
        let mut rows = div().flex().flex_col();
        for field in house::DOSSIER_FIELDS {
            let entry = &stack.fields[house::field_key(field)];
            let mut value = div()
                .flex_1()
                .min_w_0()
                .font_family(if entry.value.is_empty() {
                    SERIF_FONT
                } else {
                    TYPEWRITER_FONT
                })
                .text_size(px(if entry.value.is_empty() { 12.48 } else { 15.2 }))
                .line_height(gpui_kit::relative(1.5))
                .when(entry.value.is_empty(), |value| {
                    value.italic().text_color(rgb(p.ink_muted))
                })
                .child(if entry.value.is_empty() {
                    "Nothing set at any level.".into()
                } else {
                    entry.value.clone()
                });
            if let Some(layer) = &entry.layer {
                value = value.child(stamp(layer.clone(), cx));
            }
            for shadowed in &entry.shadowed {
                value = value.child(
                    div()
                        .font_family(SERIF_FONT)
                        .text_size(px(11.52))
                        .text_color(rgb(p.ink_muted))
                        .child(format!(
                            "Overrides {}: {}",
                            shadowed.layer.label(),
                            shadowed.value
                        )),
                );
            }
            rows = rows.child(
                div()
                    .relative()
                    .flex()
                    .gap(px(12.))
                    .py(px(8.8))
                    .border_b_1()
                    .border_color(rgb(0).opacity(0.))
                    .child(div().w(px(136.)).flex_shrink_0().pt(px(4.8)).child(tracked(
                        &field_label_upper(field),
                        9.6,
                        1.536,
                        1.2,
                        p.ink_muted,
                    )))
                    .child(value)
                    .child(dotted_rule(p.rule)),
            );
        }
        let native_id = folio.native_id;
        let models = house::context_for_models(&stack);
        sheet(cx)
            .child(kicker(
                &format!(
                    "Folio{}",
                    stack
                        .collection
                        .as_ref()
                        .map_or_else(String::new, |collection| format!(" · {}", collection.name))
                ),
                cx,
            ))
            .child(title(&folio_title(folio), cx))
            .child(lede(
                "What this piece is for, and where each part of that came from.",
                cx,
            ))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .pb(px(5.6))
                    .mb(px(12.))
                    .border_b_1()
                    .border_color(rgb(p.ink))
                    .child(tracked(
                        "DOSSIER, AS THE MODELS SEE IT",
                        10.88,
                        2.6112,
                        1.2,
                        p.ink,
                    ))
                    .child(
                        link_button("house-refine-dossier", "Refine the dossier →", cx)
                            .disabled(
                                !self.capabilities.refine_dossier
                                    || self.session.pending().is_some(),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.navigate(HouseEvent::RefineDossier(native_id), window, cx)
                            })),
                    ),
            )
            .child(rows)
            .child(
                div()
                    .mt(px(28.))
                    .child(section_head("Filed under", "", cx))
                    .child(
                        Select::new(&self.filed_under)
                            .id("house-filed-under")
                            .accessibility_label("Collection")
                            .w(px(178.))
                            .h(px(34.))
                            .font_family(SANS_FONT)
                            .text_size(px(12.))
                            .disabled(!self.writable()),
                    ),
            )
            .child(self.charter_section(cx))
            .child(
                div()
                    .mt(px(28.))
                    .child(section_head(
                        "What the models read",
                        "Inherited dossier and charter; tools add task-specific context",
                        cx,
                    ))
                    .child(
                        div()
                            .id("house-model-context")
                            .test_support()
                            .p(px(16.))
                            .border_1()
                            .border_color(rgb(p.rule))
                            .bg(rgb(p.paper_soft))
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(12.8))
                            .text_color(rgb(p.blue))
                            .child(if models.text.is_empty() {
                                "Nothing yet — the context contains only the draft.".into()
                            } else {
                                models.text
                            }),
                    )
                    .child(div().mt(px(9.6)).flex().flex_wrap().gap(px(6.4)).children(
                        models.layers.into_iter().map(|cost| {
                            chip(
                                &format!("{} · ≈{} tokens", cost.layer.label(), cost.tokens),
                                cx,
                            )
                        }),
                    )),
            )
            .child(self.footer(window, cx))
            .into_any_element()
    }
    fn selected_sheet(&self, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        match &self.selection{
            HouseSelection::House=>sheet(cx).child(kicker("The House",cx)).child(title("House defaults",cx))
                .child(lede("Set these once. Every piece inherits them unless its collection, or its own dossier, says otherwise.",cx))
                .child(self.fields_section(cx)).child(self.charter_section(cx)).child(self.footer(window,cx)).into_any_element(),
            HouseSelection::Collection(id)=>{
                if self.session.saved().state.collection(id).is_none(){return sheet(cx).child("That collection is no longer in the cabinet.").into_any_element();}
                let dissolve_id=id.clone();
                sheet(cx).child(kicker("Collection",cx)).child(self.anchor("house-collection-name",Input::new(&self.collection_name).id("house-collection-name").accessibility_id("house-collection-name").appearance(false).bordered(false).h(px(42.)).aria_label("Collection name").font_family(DISPLAY_FONT).text_size(px(25.6)).line_height(gpui_kit::relative(1.15)).disabled(!self.writable()).into_any_element()))
                    .child(self.anchor("house-collection-description",Textarea::new(&self.description).accessibility_id("house-collection-description").aria_label("What binds this series together").font_family(SERIF_FONT).line_height(gpui_kit::relative(1.5)).h(px(64.)).disabled(!self.writable()).into_any_element()))
                    .child(self.fields_section(cx)).child(self.charter_section(cx)).child(self.collection_members(id,window,cx)).child(self.footer(window,cx))
                    .child(div().mt(px(12.)).flex().gap(px(8.)).when(!self.confirm_dissolve,|row|row.child(paper_button("house-dissolve-request","Dissolve collection…",cx).text_color(rgb(p.vermilion)).disabled(!self.writable()).on_click(cx.listener(|this,_,_,cx|{this.confirm_dissolve=true;cx.notify();}))))
                        .when(self.confirm_dissolve,|row|row.child(paper_button("house-dissolve-keep","Keep it",cx).on_click(cx.listener(|this,_,_,cx|{this.confirm_dissolve=false;cx.notify();})))
                            .child(press_button("house-dissolve-confirm","Dissolve",cx).disabled(!self.writable()).on_click(cx.listener(move|this,_,_,cx|{
                                if this.commit_extra(HouseEdit::DissolveCollection(dissolve_id.clone()),"Collection dissolved; its folios are now loose.",cx){this.after_save=Some(AfterSave::Select(HouseSelection::House));}
                            }))))).into_any_element()
            }
            HouseSelection::Folio(id)=>self.folio_sheet(id,window,cx),
        }
    }
    fn tree(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let state = &self.session.saved().state;
        let defaults =
            house::DOSSIER_FIELDS
                .iter()
                .filter(|field| {
                    state.house.dossier.get(**field).is_some_and(|value| {
                        !value.trim_matches(house::is_js_whitespace).is_empty()
                    })
                })
                .count()
                + state
                    .house
                    .dossier
                    .extra
                    .values()
                    .filter(|value| {
                        value.as_str().is_some_and(|value| {
                            !value.trim_matches(house::is_js_whitespace).is_empty()
                        })
                    })
                    .count();
        let house_meta = vec![
            format!("{defaults} defaults"),
            format!(
                "§{} house charter",
                state
                    .charter
                    .iter()
                    .filter(|item| item.owner_ref == "house")
                    .count()
            ),
        ];
        let mut tree = div()
            .flex()
            .flex_col()
            .gap(px(9.6))
            .child(
                div()
                    .mb(px(2.4))
                    .child(tracked("THE CABINET", 9.92, 2.3808, 1., p.ink_muted)),
            )
            .child(
                div()
                    .relative()
                    .child(
                        node_button(
                            "house-select-house",
                            "The House",
                            if state.house.name.is_empty() {
                                "Your house"
                            } else {
                                &state.house.name
                            },
                            &house_meta,
                            0,
                            self.selection == HouseSelection::House,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.set_selection(HouseSelection::House, window, cx)
                        })),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .right_0()
                            .h(px(4.))
                            .bg(rgb(p.vermilion)),
                    ),
            );
        for collection in &state.collections {
            let id = collection.id.clone();
            let selected = self.selection == HouseSelection::Collection(id.clone());
            let article_count = state
                .charter
                .iter()
                .filter(|item| item.owner_ref == id)
                .count();
            let mut meta = vec![format!(
                "{} {}",
                collection.folio_ids.len(),
                if collection.folio_ids.len() == 1 {
                    "folio"
                } else {
                    "folios"
                }
            )];
            if article_count > 0 {
                meta.push(format!("§{article_count}"));
            }
            let mut drawer = div().ml(px(17.6)).flex().flex_col().gap(px(4.8)).child(
                node_button(
                    SharedString::from(format!("house-select-collection-{id}")),
                    "Collection",
                    &collection.name,
                    &meta,
                    1,
                    selected,
                    cx,
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.set_selection(HouseSelection::Collection(id.clone()), window, cx)
                })),
            );
            for id in &collection.folio_ids {
                if let Some(folio) = self.folios.iter().find(|folio| &folio.folio_id == id) {
                    drawer = drawer.child(self.folder(folio, cx));
                }
            }
            if collection.folio_ids.is_empty() {
                drawer = drawer.child(
                    div()
                        .ml(px(19.2))
                        .italic()
                        .font_family(SERIF_FONT)
                        .text_size(px(12.48))
                        .line_height(gpui_kit::relative(1.5))
                        .text_color(rgb(p.ink_muted))
                        .child("Empty drawer — file folios from its sheet."),
                );
            }
            tree = tree.child(drawer);
        }
        let mut loose = div().ml(px(17.6)).flex().flex_col().gap(px(4.8)).child(
            div()
                .relative()
                .pl(px(41.6))
                .pr(px(13.6))
                .py(px(11.2))
                .border_1()
                .border_dashed()
                .border_color(rgb(p.rule))
                .child(
                    div()
                        .absolute()
                        .left(px(12.))
                        .top(px(20.8))
                        .w(px(17.6))
                        .h(px(11.2))
                        .border_1()
                        .border_color(rgb(p.ink_muted)),
                )
                .child(tracked("LOOSE FOLIOS", 8.96, 2.3296, 1.2, p.ink_muted))
                .child(
                    div()
                        .mt(px(2.4))
                        .font_family(DISPLAY_FONT)
                        .font_weight(FontWeight::BOLD)
                        .text_size(px(16.))
                        .line_height(gpui_kit::relative(1.2))
                        .child("Not in a collection"),
                ),
        );
        let mut loose_count = 0;
        for folio in self
            .folios
            .iter()
            .filter(|folio| state.collection_for_folio(&folio.folio_id).is_none())
        {
            loose_count += 1;
            loose = loose.child(self.folder(folio, cx));
        }
        if loose_count == 0 {
            loose = loose.child(
                div()
                    .ml(px(19.2))
                    .italic()
                    .text_size(px(12.48))
                    .line_height(gpui_kit::relative(1.5))
                    .text_color(rgb(p.ink_muted))
                    .child("Every folio is filed."),
            );
        }
        tree.child(loose)
            .child(paper_button("house-found-collection","+ Found a collection",cx).w_full().disabled(!self.writable()).on_click(cx.listener(|this,_,_,cx|this.founding(cx))))
            .child(div().mt(px(10.4)).px(px(14.4)).py(px(13.6)).border_1().border_dashed().border_color(rgb(p.rule)).text_size(px(12.8)).line_height(gpui_kit::relative(1.5)).text_color(rgb(p.ink_light))
                .children([
                    ("The House","You. Defaults every piece inherits, and the house charter."),
                    ("Collection","A series — a column, a book's chapters, a newsletter. Narrows the House for its folios."),
                    ("Folio","One piece. Its dossier has the last word on what it is for."),
                    ("Charter","Standards that follow you. Every article from above still applies below."),
                    ("Edition · Revision","An edition changes what the words are for; a revision changes the words."),
                    ("Amendment","A dossier change the draft itself proposed, and you filed."),
                ].into_iter().map(|(term,meaning)|div().mb(px(9.6)).child(tracked(&term.to_uppercase(),9.6,1.92,1.2,p.ink)).child(div().mt(px(1.6)).child(meaning)))))
            .into_any_element()
    }
    fn folder(&self, folio: &LibraryFolio, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let id = folio.folio_id.clone();
        let selected = self.selection == HouseSelection::Folio(id.clone());
        let count = self
            .session
            .saved()
            .state
            .charter
            .iter()
            .filter(|item| item.owner_ref == id)
            .count();
        let mut marks = if folio.brief.is_some() {
            "D".to_owned()
        } else {
            "—".to_owned()
        };
        if count > 0 {
            marks.push_str(&format!(" · §{count}"));
        }
        if self.active_folio == Some(folio.native_id) {
            marks.push_str(" · ●");
        }
        let background = gpui_kit::Hsla::from(srgb_mix(p.paper, 0.82, p.mustard, 0.14));
        let border = gpui_kit::Hsla::from(srgb_mix(p.mustard, 0.45, p.rule, 0.55));
        div()
            .relative()
            .ml(px(19.2))
            .mt(px(5.6))
            .child(
                Button::new(SharedString::from(format!("house-select-folio-{id}")))
                    .custom(
                        ButtonCustomVariant::new(cx)
                            .color(background)
                            .foreground(rgb(p.ink).into())
                            .hover(background)
                            .active(background),
                    )
                    .accessibility_label(folio_title(folio))
                    .bg(background)
                    .text_color(rgb(p.ink))
                    .w_full()
                    .h_auto()
                    .px(px(9.6))
                    .pt(px(7.2))
                    .pb(px(6.4))
                    .border_1()
                    .border_color(if selected { rgb(p.ink).into() } else { border })
                    .rounded(px(3.))
                    .toggled(selected)
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .justify_between()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_align(gpui_kit::TextAlign::Left)
                                    .font_family(DISPLAY_FONT)
                                    .text_size(px(13.76))
                                    .line_height(gpui_kit::relative(1.25))
                                    .child(folio_title(folio)),
                            )
                            .child(
                                div()
                                    .font_family(TYPEWRITER_FONT)
                                    .text_size(px(9.28))
                                    .line_height(gpui_kit::relative(1.2))
                                    .text_color(rgb(p.ink_muted))
                                    .child(marks),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.set_selection(HouseSelection::Folio(id.clone()), window, cx)
                    })),
            )
            .child(
                div()
                    .absolute()
                    .top(px(-5.4))
                    .left(px(0.))
                    .w(px(41.6))
                    .h(px(6.4))
                    .bg(background)
                    .border_t_1()
                    .border_l_1()
                    .border_r_1()
                    .border_color(if selected { rgb(p.ink).into() } else { border })
                    .rounded_t(px(2.)),
            )
            .into_any_element()
    }
    fn register(&self, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let mut filters = div()
            .id("house-register-filters")
            .role(Role::Group)
            .aria_label("Filter the register")
            .flex()
            .flex_wrap()
            .gap(px(6.4));
        for (index, filter) in [
            RegisterFilter::Everything,
            RegisterFilter::Amendments,
            RegisterFilter::Dossiers,
            RegisterFilter::Charters,
            RegisterFilter::Collections,
        ]
        .into_iter()
        .enumerate()
        {
            filters = filters.child(
                paper_button(
                    SharedString::from(format!("house-register-filter-{index}")),
                    filter.label(),
                    cx,
                )
                .toggled(self.filter == filter)
                .rounded_full()
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.filter = filter;
                    cx.notify();
                })),
            );
        }
        let mut rows = div()
            .mt(px(28.))
            .border_1()
            .border_color(rgb(p.rule))
            .bg(rgb(p.page));
        let mut count = 0;
        for entry in self
            .session
            .saved()
            .state
            .ledger
            .iter()
            .filter(|entry| self.filter.matches(entry))
        {
            count += 1;
            let owner = if entry.owner_ref == "house" {
                if self.session.saved().state.house.name.is_empty() {
                    "The House".into()
                } else {
                    self.session.saved().state.house.name.clone()
                }
            } else {
                self.session
                    .saved()
                    .state
                    .collection(&entry.owner_ref)
                    .map(|collection| collection.name.clone())
                    .or_else(|| {
                        self.folios
                            .iter()
                            .find(|folio| folio.folio_id == entry.owner_ref)
                            .map(folio_title)
                    })
                    .unwrap_or_else(|| entry.owner_ref.clone())
            };
            let mut diff = div()
                .flex_1()
                .font_family(TYPEWRITER_FONT)
                .text_size(px(12.8));
            if let Some(from) = &entry.from {
                diff = diff.child(
                    div()
                        .text_color(rgb(p.ink_muted))
                        .child(format!("From: {from}")),
                );
            }
            if let Some(to) = &entry.to {
                diff = diff.child(div().child(to.clone()));
            }
            if let Some(reason) = &entry.reason {
                diff = diff.child(
                    div()
                        .font_family(SERIF_FONT)
                        .italic()
                        .text_color(rgb(p.ink_light))
                        .child(reason.clone()),
                );
            }
            rows = rows.child(
                div()
                    .id(SharedString::from(format!(
                        "house-register-entry-{}",
                        entry.id
                    )))
                    .test_support()
                    .flex()
                    .gap(px(16.))
                    .px(px(16.))
                    .py(px(11.2))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .when(entry.source == LedgerSource::Amendment, |row| {
                        row.border_l(px(3.)).border_color(rgb(p.writer_note))
                    })
                    .child(
                        div()
                            .w(px(160.))
                            .flex_shrink_0()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(10.56))
                            .text_color(rgb(p.ink_muted))
                            .child(stamp_time(entry.at)),
                    )
                    .child(
                        div()
                            .w(px(144.))
                            .flex_shrink_0()
                            .text_size(px(13.76))
                            .child(owner)
                            .child(
                                div()
                                    .text_size(px(10.56))
                                    .text_color(rgb(p.ink_muted))
                                    .child(entry.source.label().to_owned()),
                            )
                            .when_some(entry.field.as_ref(), |column, field| {
                                column.child(field.clone())
                            }),
                    )
                    .child(diff),
            );
        }
        if count == 0 {
            rows = rows.child(
                div()
                    .p(px(40.))
                    .italic()
                    .text_color(rgb(p.ink_muted))
                    .child("No changes recorded here yet."),
            );
        }
        div()
            .mt(px(24.))
            .child(filters)
            .child(rows)
            .into_any_element()
    }
}
impl Render for HouseView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.reveal_focused_input(window, cx);
        let p = theme::palette(cx);
        let width: f32 = window.viewport_size().width.into();
        let narrow = width <= 900.;
        let mut tabs = div()
            .id("house-tabs")
            .role(Role::Group)
            .aria_label("The House")
            .mt(px(24.))
            .border_b_1()
            .border_color(rgb(p.rule))
            .flex()
            .gap(px(4.));
        for (tab, label, id) in [
            (HouseTab::Cabinet, "The cabinet", "house-tab-cabinet"),
            (HouseTab::Register, "The register", "house-tab-register"),
            (HouseTab::Engine, "Engine room", "house-tab-engine"),
        ] {
            let active = self.tab == tab;
            let caption = label.to_uppercase();
            let transparent = gpui_kit::Hsla::from(rgb(0)).alpha(0.);
            let mut button = Button::new(id)
                .accessibility_label(label)
                .custom(
                    ButtonCustomVariant::new(cx)
                        .color(if active {
                            rgb(p.paper).into()
                        } else {
                            transparent
                        })
                        .foreground(rgb(p.ink).into())
                        .hover(transparent)
                        .active(transparent),
                )
                .h_auto()
                .px(px(16.))
                .pt(px(8.8))
                .pb(px(8.))
                .rounded_t(px(6.))
                .rounded_b_none()
                .border_1()
                .border_color(if active {
                    rgb(p.rule).into()
                } else {
                    transparent
                })
                .toggled(active)
                .disabled(tab == HouseTab::Engine && !self.capabilities.engine_room)
                .child(tracked(
                    &caption,
                    10.88,
                    1.7408,
                    1.,
                    if active { p.ink } else { p.ink_muted },
                ));
            if tab == HouseTab::Register && !self.session.saved().state.ledger.is_empty() {
                button = button.child(
                    div()
                        .ml(px(6.4))
                        .font_family(TYPEWRITER_FONT)
                        .font_weight(FontWeight::NORMAL)
                        .text_size(px(10.88))
                        .line_height(gpui_kit::relative(1.))
                        .text_color(rgb(p.vermilion))
                        .child(self.session.saved().state.ledger.len().to_string()),
                );
            }
            tabs =
                tabs.child(button.on_click(
                    cx.listener(move |this, _, window, cx| this.set_tab(tab, window, cx)),
                ));
        }
        let cabinet = div()
            .pt(px(28.))
            .gap(px(32.))
            .when(narrow, |row| row.flex().flex_col())
            .when(!narrow, |row| row.flex().items_start())
            .child(
                div()
                    .when(!narrow, |column| column.w(px(416.)).flex_shrink_0())
                    .child(self.tree(cx)),
            )
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .child(self.selected_sheet(window, cx)),
            )
            .into_any_element();
        div().id("house-page").test_support().track_focus(&self.focus_handle).relative().size_full().bg(rgb(p.paper_soft)).text_color(rgb(p.ink)).font_family(SERIF_FONT).font_weight(FontWeight::NORMAL)
            .overflow_y_scroll().track_scroll(&self.scroll_handle)
            .capture_action(cx.listener(|this,_:&IndentInline,window,cx|this.navigate_form_tab(false,window,cx)))
            .capture_action(cx.listener(|this,_:&OutdentInline,window,cx|this.navigate_form_tab(true,window,cx)))
            .child(div().max_w(px(1216.)).mx_auto().px(px(if width<=640.{16.}else{24.})).pt(px(if width<=640.{20.}else{32.})).pb(px(80.))
                .child(div().relative().flex().flex_wrap().items_end().justify_between().gap(px(16.)).pb(px(16.)).border_b(px(3.)).border_color(rgb(0).opacity(0.))
                    .child(div().absolute().bottom_0().left_0().right_0().h(px(1.)).bg(rgb(p.ink)))
                    .child(div().absolute().bottom(px(2.)).left_0().right_0().h(px(1.)).bg(rgb(p.ink)))
                    .child(div().flex_1().min_w_0().child(tracked("MAISON D’ÉDITION",9.92,3.3728,1.,p.vermilion))
                        .child(self.anchor("house-name",self.name_input((width*0.04).clamp(28.8,44.),cx).into_any_element()))
                        .child(div().mt(px(5.6)).italic().font_family(SERIF_FONT).text_size(px(16.)).line_height(gpui_kit::relative(1.5)).text_color(rgb(p.ink_light)).child("Everything that tells Twyne what your writing is for — and how it has changed.")))
                    .child(div().flex().gap(px(8.)).child(paper_button("house-library","Library",cx).on_click(cx.listener(|this,_,window,cx|this.navigate(HouseEvent::LibraryRequested,window,cx))))
                        .child(press_button("house-desk","← The desk",cx).on_click(cx.listener(|this,_,window,cx|this.navigate(HouseEvent::BackToDesk,window,cx))))))
                .child(tabs).child(if self.tab==HouseTab::Register{self.register(cx)}else{cabinet}))
    }
}

pub struct LibraryView {
    record: Arc<HouseRecord>,
    folios: Vec<LibraryFolio>,
    capabilities: HouseCapabilities,
    query: LibraryQuery,
    name_order: Vec<String>,
    search: Entity<InputState>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    _subscriptions: Vec<Subscription>,
    card_focus: BTreeMap<Uuid, FocusHandle>,
}
impl EventEmitter<HouseEvent> for LibraryView {}
impl Focusable for LibraryView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl LibraryView {
    pub fn new(
        record: Arc<HouseRecord>,
        folios: Vec<LibraryFolio>,
        capabilities: HouseCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search folios"));
        let subscription = cx.subscribe(&search, |this, _, _: &InputEvent, cx| {
            this.query.search = this.search.read(cx).text().to_string();
            cx.notify();
        });
        let card_focus = folios
            .iter()
            .map(|folio| (folio.native_id, cx.focus_handle().tab_stop(true)))
            .collect();
        Self {
            record,
            folios,
            capabilities,
            query: LibraryQuery::default(),
            name_order: Vec::new(),
            search,
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            _subscriptions: vec![subscription],
            card_focus,
        }
    }
    pub fn saved_record(&self) -> &Arc<HouseRecord> {
        &self.record
    }
    /// The Library only searches and navigates; House metadata writes originate
    /// in the Cabinet. These getters make Root's route freshness boundary uniform.
    pub fn pending_request(&self) -> Option<&HouseRequest> {
        None
    }
    pub fn pending_request_id(&self) -> Option<Uuid> {
        None
    }
    pub fn has_unsaved_changes(&self, _: &App) -> bool {
        false
    }
    pub fn flush_pending_edits(
        &mut self,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Result<Option<HouseRequest>> {
        Ok(None)
    }
    pub fn prepare_pending_edits(&mut self, _: &mut Context<Self>) -> Result<Option<HouseRequest>> {
        Ok(None)
    }
    pub fn ack_saved(
        &mut self,
        _: Uuid,
        _: Arc<HouseRecord>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> bool {
        false
    }
    pub fn report_error(&mut self, _: Uuid, _: impl Into<String>, _: &mut Context<Self>) -> bool {
        false
    }
    pub fn set_folios(&mut self, folios: Vec<LibraryFolio>, cx: &mut Context<Self>) {
        self.card_focus
            .retain(|id, _| folios.iter().any(|folio| &folio.native_id == id));
        for folio in &folios {
            self.card_focus
                .entry(folio.native_id)
                .or_insert_with(|| cx.focus_handle().tab_stop(true));
        }
        self.folios = folios;
        cx.notify();
    }
    pub fn set_name_order(&mut self, order: Vec<String>, cx: &mut Context<Self>) {
        self.name_order = order;
        cx.notify();
    }
    pub fn set_capabilities(&mut self, capabilities: HouseCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn replace_record(&mut self, record: Arc<HouseRecord>, cx: &mut Context<Self>) -> bool {
        if record.generation < self.record.generation
            || (record.generation == self.record.generation && record != self.record)
        {
            return false;
        }
        self.record = record;
        cx.notify();
        true
    }
    pub fn query(&self) -> &LibraryQuery {
        &self.query
    }
    pub fn set_query(&mut self, query: LibraryQuery, window: &mut Window, cx: &mut Context<Self>) {
        self.search
            .update(cx, |state, cx| state.set_value(&query.search, window, cx));
        self.query = query;
        cx.notify();
    }
    pub fn visible_folio_ids(&self, cx: &App) -> Vec<Uuid> {
        let mut query = self.query.clone();
        query.search = self.search.read(cx).text().to_string();
        query
            .apply(&self.folios, &self.record.state, &self.name_order)
            .into_iter()
            .map(|folio| folio.native_id)
            .collect()
    }
    fn card(&self, folio: &LibraryFolio, width: f32, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(cx);
        let id = folio.native_id;
        let focus = self.card_focus[&id].clone();
        let clicked_focus = focus.clone();
        let owner = cx.entity().downgrade();
        let archived = folio.archived;
        let label = match folio.folio.folio_type {
            FolioType::Draft => "Draft",
            FolioType::Notes => "Notes",
            FolioType::Outline => "Outline",
        };
        let preview = folio
            .preview
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if folio.source_only {
                    "Typst source · no writing preview yet".into()
                } else {
                    "Empty draft.".into()
                }
            });
        let mut card = div()
            .id(SharedString::from(format!("library-card-{id}")))
            .role(Role::Button)
            .aria_label(format!("Open {}", folio_title(folio)))
            .test_support()
            .track_focus(&focus)
            .w(px(width))
            .flex_shrink_0()
            .min_h(px(176.))
            .p(px(16.))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(4.))
            .bg(rgb(p.paper))
            .flex()
            .flex_col()
            .cursor_pointer()
            .focus(|card| card.border_color(rgb(p.vermilion)))
            .hover(|card| {
                card.shadow(vec![BoxShadow {
                    inset: false,
                    color: rgb(0).opacity(0.08).into(),
                    offset: gpui_kit::point(px(0.), px(4.)),
                    blur_radius: px(14.),
                    spread_radius: px(0.),
                }])
            })
            .on_mouse_down(
                gpui_kit::MouseButton::Left,
                cx.listener(move |_, _, window, cx| clicked_focus.focus(window, cx)),
            )
            .on_a11y_action(AccessibleAction::Click, move |_, _, cx| {
                let _ = owner.update(cx, |_, cx| cx.emit(HouseEvent::OpenFolio(id)));
            })
            .on_click(cx.listener(move |_, _, _, cx| cx.emit(HouseEvent::OpenFolio(id))))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .mb(px(8.))
                    .child(tracked(&label.to_uppercase(), 9.6, 3.072, 1.5, p.vermilion))
                    .child(
                        div()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(10.4))
                            .line_height(gpui_kit::relative(1.5))
                            .text_color(rgb(p.ink_muted))
                            .child(relative_time(folio.folio.updated_at, timestamp())),
                    ),
            )
            .child(
                div()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(16.))
                    .line_height(gpui_kit::relative(1.5))
                    .mb(px(4.))
                    .child(folio_title(folio)),
            )
            .child(
                div()
                    .flex_1()
                    .w_full()
                    .min_w_0()
                    .overflow_hidden()
                    .font_family(SERIF_FONT)
                    .font_weight(FontWeight::NORMAL)
                    .text_size(px(13.12))
                    .line_height(gpui_kit::relative(1.5))
                    .text_color(rgb(p.ink_light))
                    .child(preview.chars().take(220).collect::<String>()),
            );
        if let Some(words) = folio.words {
            card = card.child(
                div()
                    .mt(px(8.))
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(10.4))
                    .line_height(gpui_kit::relative(1.5))
                    .text_color(rgb(p.ink_muted))
                    .child(format!(
                        "{words} {}",
                        if words == 1 { "word" } else { "words" }
                    )),
            );
        }
        if self.capabilities.folio_archive {
            card = card.child(
                paper_button(
                    SharedString::from(format!("library-archive-{id}")),
                    if archived { "Unarchive" } else { "Archive" },
                    cx,
                )
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.stop_propagation();
                    cx.emit(HouseEvent::FolioArchiveRequested {
                        native_id: id,
                        archived: !archived,
                    });
                })),
            );
        }
        card.into_any_element()
    }
}
impl Render for LibraryView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(cx);
        let inner_width = (f32::from(window.viewport_size().width) - 48.).clamp(240., 976.);
        let columns = ((inner_width + 16.) / 256.).floor().max(1.);
        let card_width = (inner_width - 16. * (columns - 1.)) / columns;
        self.query.search = self.search.read(cx).text().to_string();
        let visible = self
            .query
            .apply(&self.folios, &self.record.state, &self.name_order);
        let count = self
            .folios
            .iter()
            .filter(|folio| !folio.archived || self.query.include_archived)
            .count();
        let mut scopes = div().flex().flex_wrap().gap(px(6.));
        for (scope, label, id) in std::iter::once((
            LibraryScope::All,
            "Every folio".to_owned(),
            "all".to_owned(),
        ))
        .chain(std::iter::once((
            LibraryScope::Loose,
            "Loose folios".into(),
            "loose".into(),
        )))
        .chain(self.record.state.collections.iter().map(|collection| {
            (
                LibraryScope::Collection(collection.id.clone()),
                collection.name.clone(),
                collection.id.clone(),
            )
        })) {
            scopes = scopes.child(
                paper_button(
                    SharedString::from(format!("library-scope-{id}")),
                    &label,
                    cx,
                )
                .small()
                .toggled(self.query.scope == scope)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.query.scope = scope.clone();
                    cx.notify();
                })),
            );
        }
        let cards = if visible.is_empty() {
            div()
                .id("library-empty")
                .test_support()
                .py(px(48.))
                .text_center()
                .italic()
                .text_color(rgb(p.ink_muted))
                .child(if count == 0 {
                    "No folios yet."
                } else {
                    "No folios match this view."
                })
                .when(count == 0, |empty| {
                    empty.child(
                        paper_button("library-start-writing", "Start writing →", cx)
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(HouseEvent::BackToDesk))),
                    )
                })
                .into_any_element()
        } else {
            div()
                .id("library-cards")
                .test_support()
                .flex()
                .flex_wrap()
                .items_stretch()
                .gap(px(16.))
                .children(
                    visible
                        .into_iter()
                        .map(|folio| self.card(folio, card_width, cx)),
                )
                .into_any_element()
        };
        div()
            .id("library-page")
            .test_support()
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .bg(rgb(p.paper_soft))
            .text_color(rgb(p.ink))
            .font_family(SERIF_FONT)
            .font_weight(FontWeight::NORMAL)
            .child(
                div()
                    .max_w(px(1024.))
                    .mx_auto()
                    .px(px(24.))
                    .py(px(32.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_between()
                            .items_center()
                            .gap(px(16.))
                            .mb(px(32.))
                            .child(
                                div()
                                    .child(div().mb(px(4.)).child(tracked(
                                        "TWYNE",
                                        10.,
                                        3.2,
                                        1.5,
                                        p.ink_muted,
                                    )))
                                    .child(
                                        div()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::BOLD)
                                            .text_size(px(28.))
                                            .line_height(gpui_kit::relative(1.5))
                                            .child("The Library"),
                                    )
                                    .child(
                                        div()
                                            .mt(px(4.))
                                            .font_family(SERIF_FONT)
                                            .text_size(px(14.))
                                            .line_height(gpui_kit::relative(1.5))
                                            .text_color(rgb(p.ink_light))
                                            .child(format!(
                                                "Every piece on your desk. {count} {}.",
                                                if count == 1 { "folio" } else { "folios" }
                                            )),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .gap(px(12.))
                                    .child(paper_button("library-house", "The House", cx).on_click(
                                        cx.listener(|_, _, _, cx| {
                                            cx.emit(HouseEvent::HouseRequested)
                                        }),
                                    ))
                                    .child(
                                        paper_button_text(
                                            "library-sort",
                                            if self.query.sort == LibrarySort::Recent {
                                                "Sort: Recent"
                                            } else {
                                                "Sort: Name"
                                            },
                                            DISPLAY_FONT,
                                            12.,
                                            10. / 7.,
                                            cx,
                                        )
                                        .on_click(
                                            cx.listener(|this, _, _, cx| {
                                                this.query.sort =
                                                    if this.query.sort == LibrarySort::Recent {
                                                        LibrarySort::Name
                                                    } else {
                                                        LibrarySort::Recent
                                                    };
                                                cx.notify();
                                            }),
                                        ),
                                    )
                                    .child(
                                        paper_button_text(
                                            "library-desk",
                                            "← Back to desk",
                                            DISPLAY_FONT,
                                            12.,
                                            10. / 7.,
                                            cx,
                                        )
                                        .on_click(
                                            cx.listener(|_, _, _, cx| {
                                                cx.emit(HouseEvent::BackToDesk)
                                            }),
                                        ),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .mb(px(24.))
                            .flex()
                            .flex_wrap()
                            .text_size(px(14.))
                            .line_height(gpui_kit::relative(1.5))
                            .text_color(rgb(p.ink_light))
                            .child(
                                link_button_text(
                                    "library-house-context",
                                    "House → Collection → Folio",
                                    SERIF_FONT,
                                    14.,
                                    1.5,
                                    cx,
                                )
                                .text_color(rgb(p.ink_light))
                                .on_click(
                                    cx.listener(|_, _, _, cx| cx.emit(HouseEvent::HouseRequested)),
                                ),
                            )
                            .child(" — shared context and standards, down to each piece."),
                    )
                    .when(self.capabilities.library_filters, |page| {
                        page.child(
                            div()
                                .mb(px(12.))
                                .child(
                                    Input::new(&self.search)
                                        .id("library-search")
                                        .aria_label("Search folios")
                                        .small(),
                                )
                                .child(div().mt(px(8.)).child(scopes)),
                        )
                    })
                    .when(self.capabilities.folio_archive, |page| {
                        page.child(
                            paper_button("library-show-archived", "Include archived folios", cx)
                                .toggled(self.query.include_archived)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.query.include_archived = !this.query.include_archived;
                                    cx.notify();
                                })),
                        )
                    })
                    .child(cards),
            )
    }
}

fn node_button(
    id: impl Into<gpui_kit::ElementId>,
    kind: &str,
    name: &str,
    meta: &[String],
    style: u8,
    selected: bool,
    cx: &App,
) -> Button {
    let p = theme::palette(cx);
    let background = if style == 1 { p.sidebar } else { p.paper };
    let mut body = div()
        .relative()
        .w_full()
        .flex()
        .flex_col()
        .items_start()
        .child(tracked(
            &kind.to_uppercase(),
            8.96,
            2.3296,
            1.2,
            p.ink_muted,
        ))
        .child(
            div()
                .mt(px(2.4))
                .font_family(DISPLAY_FONT)
                .font_weight(FontWeight::BOLD)
                .text_size(px(16.))
                .line_height(gpui_kit::relative(1.2))
                .child(name.to_owned()),
        )
        .child(
            div()
                .mt(px(6.4))
                .flex()
                .gap(px(5.6))
                .children(meta.iter().map(|value| chip(value, cx))),
        );
    if style == 1 {
        body = body.child(
            div()
                .absolute()
                .left(px(-29.6))
                .top(px(17.))
                .w(px(17.6))
                .h(px(11.2))
                .border(px(1.5))
                .border_color(rgb(p.mustard))
                .bg(rgb(p.mustard).opacity(0.12))
                .rounded(px(1.)),
        );
    }
    Button::new(id)
        .accessibility_label(name.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(background).into())
                .foreground(rgb(p.ink).into())
                .hover(rgb(background).into())
                .active(rgb(background).into()),
        )
        .bg(rgb(background))
        .when(style == 0, |button| {
            button.bg(linear_gradient(
                180.,
                linear_color_stop(rgb(p.paper), 0.),
                linear_color_stop(srgb_mix(p.paper, 0.92, p.vermilion, 0.03), 1.),
            ))
        })
        .w_full()
        .h_auto()
        .py(px(11.2))
        .pl(px(if style == 1 { 41.6 } else { 13.6 }))
        .pr(px(13.6))
        .rounded_none()
        .border_1()
        .when(style == 1, |button| button.border_b(px(3.)))
        .border_color(rgb(if selected { p.ink } else { p.rule }))
        .toggled(selected)
        .child(body)
}
// CSS color-mix(in srgb, ...) normalizes the given proportions, retaining a
// reduced alpha when their sum is below 100 percent.
fn srgb_mix(left: u32, left_weight: f32, right: u32, right_weight: f32) -> gpui_kit::Rgba {
    let left = rgb(left);
    let right = rgb(right);
    let sum = left_weight + right_weight;
    gpui_kit::Rgba {
        r: (left.r * left_weight + right.r * right_weight) / sum,
        g: (left.g * left_weight + right.g * right_weight) / sum,
        b: (left.b * left_weight + right.b * right_weight) / sum,
        a: sum.min(1.),
    }
}
fn dotted_rule(color: u32) -> AnyElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let mut x = bounds.left();
            while x < bounds.right() {
                window.paint_quad(fill(
                    Bounds::new(point(x, bounds.top()), size(px(1.), px(1.))),
                    rgb(color),
                ));
                x += px(2.);
            }
        },
    )
    .absolute()
    .bottom_0()
    .left_0()
    .w_full()
    .h(px(1.))
    .into_any_element()
}
fn tracked(label: &str, size: f32, tracking: f32, line: f32, color: u32) -> AnyElement {
    div()
        .flex()
        .gap(px(tracking))
        .font_family(TYPEWRITER_FONT)
        .font_weight(FontWeight::NORMAL)
        .text_size(px(size))
        .line_height(gpui_kit::relative(line))
        .text_color(rgb(color))
        .children(
            label
                .chars()
                .map(|character| div().child(character.to_string())),
        )
        .into_any_element()
}
fn paper_button(id: impl Into<gpui_kit::ElementId>, label: &str, cx: &App) -> Button {
    paper_button_text(id, label, SANS_FONT, 12., 1.5, cx)
}
fn paper_button_text(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    font: &str,
    font_size: f32,
    line: f32,
    cx: &App,
) -> Button {
    let p = theme::palette(cx);
    Button::new(id)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(rgb(p.paper_soft).into())
                .foreground(rgb(p.ink).into())
                .hover(rgb(p.sidebar).into())
                .active(rgb(p.sidebar).into()),
        )
        .bg(rgb(p.paper_soft))
        .font_family(font.to_owned())
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(font_size))
        .line_height(gpui_kit::relative(line))
        .h_auto()
        .py(px(7.2))
        .px(px(14.4))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(p.rule))
        .text_color(rgb(p.ink))
        .child(
            div()
                .font_family(font.to_owned())
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(font_size))
                .line_height(gpui_kit::relative(line))
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
        .bg(rgb(p.ink))
        .text_color(rgb(p.paper))
        .font_family(TYPEWRITER_FONT)
        .text_size(px(11.2))
        .line_height(gpui_kit::relative(1.5))
        .font_weight(FontWeight::NORMAL)
        .px(px(16.))
        .py(px(8.8))
        .h_auto()
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(p.ink))
        .child(tracked(&label.to_uppercase(), 11.2, 2.016, 1.5, p.paper))
}
fn sheet(cx: &App) -> gpui_kit::Div {
    let p = theme::palette(cx);
    div()
        .px(px(36.))
        .pt(px(32.))
        .pb(px(36.))
        .bg(rgb(p.page))
        .border_1()
        .border_color(rgb(p.rule))
        .shadow(vec![BoxShadow {
            inset: false,
            color: rgb(0).opacity(0.55).into(),
            offset: gpui_kit::point(px(0.), px(22.)),
            blur_radius: px(40.),
            spread_radius: px(-32.),
        }])
}
fn kicker(value: &str, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    tracked(&value.to_uppercase(), 9.92, 2.976, 1., p.vermilion)
}
fn link_button(id: impl Into<gpui_kit::ElementId>, label: &str, cx: &App) -> Button {
    link_button_text(id, label, TYPEWRITER_FONT, 11.2, 1.4, cx)
}
fn link_button_text(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    font: &str,
    font_size: f32,
    line: f32,
    cx: &App,
) -> Button {
    let p = theme::palette(cx);
    let transparent = gpui_kit::Hsla::from(rgb(0)).alpha(0.);
    Button::new(id)
        .role(Role::Link)
        .accessibility_label(label.to_owned())
        .custom(
            ButtonCustomVariant::new(cx)
                .color(transparent)
                .foreground(rgb(p.blue).into())
                .hover(transparent)
                .active(transparent),
        )
        .h_auto()
        .p_0()
        .rounded_none()
        .font_family(font.to_owned())
        .font_weight(FontWeight::NORMAL)
        .text_size(px(font_size))
        .line_height(gpui_kit::relative(line))
        .underline()
        .child(
            div()
                .font_family(font.to_owned())
                .font_weight(FontWeight::NORMAL)
                .text_size(px(font_size))
                .line_height(gpui_kit::relative(line))
                .child(label.to_owned()),
        )
}
fn title(value: &str, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .mt(px(5.6))
        .mb(px(4.))
        .font_family(DISPLAY_FONT)
        .font_weight(FontWeight::BOLD)
        .text_size(px(25.6))
        .line_height(gpui_kit::relative(1.15))
        .text_color(rgb(p.ink))
        .child(value.to_owned())
        .into_any_element()
}
fn lede(value: &str, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .mb(px(24.))
        .italic()
        .text_size(px(16.))
        .line_height(gpui_kit::relative(1.5))
        .text_color(rgb(p.ink_light))
        .child(value.to_owned())
        .into_any_element()
}
fn section_head(value: &str, note: &str, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .flex()
        .flex_wrap()
        .justify_between()
        .gap(px(8.))
        .pb(px(5.6))
        .mb(px(12.))
        .border_b_1()
        .border_color(rgb(p.ink))
        .child(tracked(&value.to_uppercase(), 10.88, 2.6112, 1.2, p.ink))
        .when(!note.is_empty(), |header| {
            header.child(
                div()
                    .italic()
                    .text_size(px(12.48))
                    .text_color(rgb(p.ink_muted))
                    .child(note.to_owned()),
            )
        })
        .into_any_element()
}
fn chip(value: &str, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    div()
        .px(px(6.4))
        .py(px(0.8))
        .border_1()
        .border_color(rgb(p.rule))
        .rounded(px(2.))
        .bg(rgb(p.paper_soft))
        .font_family(TYPEWRITER_FONT)
        .text_size(px(9.6))
        .text_color(rgb(p.ink_light))
        .child(value.to_owned())
        .into_any_element()
}
fn stamp(layer: ContextLayer, cx: &App) -> AnyElement {
    let p = theme::palette(cx);
    let color = match layer {
        ContextLayer::House => p.vermilion,
        ContextLayer::Collection => p.mustard,
        ContextLayer::Folio => p.blue,
        ContextLayer::Amendment => p.writer_note,
        _ => p.sage,
    };
    div()
        .px(px(4.8))
        .border_1()
        .border_color(rgb(color))
        .text_color(rgb(color))
        .rounded(px(2.))
        .font_family(TYPEWRITER_FONT)
        .text_size(px(8.64))
        .child(layer.label().to_uppercase())
        .into_any_element()
}
fn scope_layer(scope: &CharterScope) -> ContextLayer {
    match scope {
        CharterScope::House => ContextLayer::House,
        CharterScope::Collection => ContextLayer::Collection,
        _ => ContextLayer::Folio,
    }
}
fn field_label_upper(field: BriefField) -> String {
    house::field_label(field).to_uppercase()
}
fn folio_title(folio: &LibraryFolio) -> String {
    if folio.folio.name.is_empty() {
        "Untitled".into()
    } else {
        folio.folio.name.clone()
    }
}
fn partial_stand_ins() -> PartialAnswers {
    let answers = dossier::default_answers();
    let mut result = PartialAnswers::default();
    for field in house::DOSSIER_FIELDS {
        result.set(field, dossier::answer(&answers, field).into());
    }
    result
}
fn stamp_time(at: u64) -> String {
    DateTime::from_timestamp_millis(at.min(i64::MAX as u64) as i64).map_or_else(
        || "Unknown date".into(),
        |date| {
            date.with_timezone(&Local)
                .format("%b %-d, %Y · %-I:%M %p")
                .to_string()
        },
    )
}
fn relative_time(at: u64, now: u64) -> String {
    let seconds = now.saturating_sub(at) / 1000;
    if seconds < 60 {
        "just now".into()
    } else if seconds < 3600 {
        format!("{}m ago", seconds / 60)
    } else if seconds < 86400 {
        format!("{}h ago", seconds / 3600)
    } else if seconds < 30 * 86400 {
        format!("{}d ago", seconds / 86400)
    } else {
        DateTime::from_timestamp_millis(at.min(i64::MAX as u64) as i64).map_or_else(
            || "Unknown date".into(),
            |date| date.with_timezone(&Local).format("%b %-d, %Y").to_string(),
        )
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::{house::HouseStore, workspace::Folio};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Point, ScrollDelta, TestAppContext, WindowBounds, WindowOptions,
        size,
    };
    use std::sync::Mutex;
    use tempfile::TempDir;

    fn folios() -> Vec<LibraryFolio> {
        [
            ("web/folio:café", "A café on the corner", true),
            ("folio:second", "Notes from this street", false),
        ]
        .into_iter()
        .map(|(id, name, source)| LibraryFolio {
            native_id: Uuid::new_v4(),
            folio_id: id.into(),
            folio: Folio::draft(id, name, 20),
            brief: None,
            archived: false,
            words: (!source).then_some(5),
            preview: (!source).then_some("These are the original notes".into()),
            source_only: source,
        })
        .collect()
    }
    fn panel(
        cx: &mut TestAppContext,
        record: HouseRecord,
        capabilities: HouseCapabilities,
    ) -> (AnyWindowHandle, Entity<HouseView>, HouseStore, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = HouseStore::open(dir.path()).unwrap();
        std::fs::write(store.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        let (handle, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1280.), px(860.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        HouseView::new(Arc::new(record), folios(), capabilities, window, cx)
                    })
                },
            )
            .unwrap()
        });
        (handle, view, store, dir)
    }
    fn received(cx: &mut TestAppContext, view: &Entity<HouseView>) -> Arc<Mutex<Vec<HouseEvent>>> {
        let result = Arc::new(Mutex::new(Vec::new()));
        let handler = result.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &HouseEvent, _| {
                handler.lock().unwrap().push(event.clone())
            })
            .detach()
        });
        result
    }
    fn ack(
        view: &Entity<HouseView>,
        store: &HouseStore,
        request: &HouseRequest,
        window: &mut Window,
        cx: &mut App,
    ) {
        let record = store.save_request(request).unwrap();
        view.update(cx, |view, cx| {
            assert!(view.ack_saved(request.request_id, record, window, cx))
        });
        window.render_frame(cx);
    }
    fn reveal(window: &mut Window, id: &'static str, cx: &mut App) {
        for _ in 0..12 {
            window.render_frame(cx);
            if window.try_find(id).is_some_and(|element| element.visible()) {
                return;
            }
            let delta = window.try_find(id).map_or(-240., |element| {
                if element.bounds().origin.y < px(0.) {
                    240.
                } else {
                    -240.
                }
            });
            window.scroll(
                "house-page",
                ScrollDelta::Pixels(gpui_kit::point(px(0.), px(delta))),
                cx,
            );
        }
        assert!(
            window.find(id).visible(),
            "{id} must be reachable in an 860px window"
        );
    }
    #[gpui_kit::test]
    fn real_collection_create_rename_and_immediate_last_character_prepare(cx: &mut TestAppContext) {
        let (handle, view, store, _dir) =
            panel(cx, HouseRecord::default(), HouseCapabilities::local());
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            window.click("house-found-collection", cx);
            let create = view.read(cx).pending_request().unwrap().clone();
            assert!(view.read(cx).saved_record().state.collections.is_empty());
            assert_eq!(create.candidate.state.collections[0].name, "New collection");
            ack(&view, &store, &create, window, cx);
            assert!(matches!(
                view.read(cx).selection(),
                HouseSelection::Collection(_)
            ));
            reveal(window, "house-collection-name", cx);
            window.click("house-collection-name", cx);
            window.press("ctrl-a", cx);
            window.input("Letters from this street — Café", cx);
            let prepared = view.update(cx, |view, cx| {
                view.prepare_pending_edits(cx).unwrap().unwrap()
            });
            assert_eq!(
                prepared.candidate.state.collections[0].name,
                "Letters from this street — Café"
            );
            assert_eq!(
                view.read(cx).saved_record().state.collections[0].name,
                "New collection"
            );
            assert_eq!(
                view.update(cx, |view, cx| view
                    .prepare_pending_edits(cx)
                    .unwrap()
                    .unwrap()),
                prepared
            );
            ack(&view, &store, &prepared, window, cx);
            assert_eq!(
                store.load().unwrap().record.state.collections[0].name,
                "Letters from this street — Café"
            );
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, HouseEvent::SaveRequested(_)))
                .count(),
            2
        );
    }
    #[gpui_kit::test]
    fn real_failed_form_save_keeps_draft_and_blocks_navigation_until_retry_ack(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _dir) =
            panel(cx, HouseRecord::default(), HouseCapabilities::local());
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("house-name", cx);
            window.input("The Lantern", cx);
            window.click("house-library", cx);
            let pending = view.read(cx).pending_request().unwrap().clone();
            assert!(
                !events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| matches!(event, HouseEvent::LibraryRequested))
            );
            std::fs::remove_file(store.path()).unwrap();
            std::fs::create_dir(store.path()).unwrap();
            let error = store.save_request(&pending).unwrap_err();
            view.update(cx, |view, cx| {
                assert!(view.report_error(pending.request_id, error.to_string(), cx))
            });
            window.render_frame(cx);
            assert_eq!(view.read(cx).saved_record().state.house.name, "");
            assert_eq!(
                view.read(cx).name.read(cx).text().to_string(),
                "The Lantern"
            );
            reveal(window, "house-retry", cx);
            std::fs::remove_dir(store.path()).unwrap();
            window.click("house-retry", cx);
            assert_eq!(view.read(cx).pending_request().unwrap(), &pending);
            ack(&view, &store, &pending, window, cx);
            assert_eq!(store.load().unwrap().record.state.house.name, "The Lantern");
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, HouseEvent::LibraryRequested))
                .count(),
            1
        );
    }
    #[gpui_kit::test]
    fn real_membership_charter_and_dissolve_preserve_unimported_references(
        cx: &mut TestAppContext,
    ) {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/house/web-reference.json")).unwrap();
        let record = HouseRecord::from_value(&value["base"]).unwrap();
        let (handle, view, store, _dir) = panel(cx, record, HouseCapabilities::local());
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("house-select-collection-web/collection:letters", cx);
            reveal(window, "house-member-folio:second", cx);
            assert_eq!(
                window.find("house-member-folio:second").role(),
                Some(Role::CheckBox)
            );
            window.click("house-member-folio:second", cx);
            let membership = view.read(cx).pending_request().unwrap().clone();
            assert_eq!(
                view.read(cx)
                    .saved_record()
                    .state
                    .collection_for_folio("folio:second")
                    .unwrap()
                    .id,
                "collection:essays"
            );
            ack(&view, &store, &membership, window, cx);
            assert!(
                store.load().unwrap().record.state.collections[0]
                    .folio_ids
                    .contains(&"not-imported:folio".into())
            );
            reveal(window, "house-new-article", cx);
            window.click("house-new-article", cx);
            window.input("Every letter begins on a scene", cx);
            window.click("house-add-article", cx);
            let charter = view.read(cx).pending_request().unwrap().clone();
            assert!(
                view.read(cx)
                    .new_article
                    .read(cx)
                    .text()
                    .to_string()
                    .contains("scene")
            );
            ack(&view, &store, &charter, window, cx);
            assert_eq!(view.read(cx).new_article.read(cx).text().to_string(), "");
            assert!(
                store
                    .load()
                    .unwrap()
                    .record
                    .state
                    .charter
                    .iter()
                    .any(|article| article.text == "Every letter begins on a scene"
                        && article.owner_ref == "web/collection:letters")
            );
            reveal(window, "house-dissolve-request", cx);
            window.click("house-dissolve-request", cx);
            window.click("house-dissolve-confirm", cx);
            let dissolve = view.read(cx).pending_request().unwrap().clone();
            assert_eq!(view.read(cx).saved_record().state.collections.len(), 2);
            ack(&view, &store, &dissolve, window, cx);
            assert_eq!(view.read(cx).selection(), &HouseSelection::House);
            assert_eq!(store.load().unwrap().record.state.collections.len(), 1);
            assert!(
                store
                    .load()
                    .unwrap()
                    .record
                    .state
                    .collection_for_folio("folio:second")
                    .is_none()
            );
            assert!(
                store
                    .load()
                    .unwrap()
                    .record
                    .state
                    .charter
                    .iter()
                    .all(|article| article.owner_ref != "web/collection:letters")
            );
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, HouseEvent::SaveRequested(_)))
                .count(),
            3
        );
    }
    #[gpui_kit::test]
    fn keyboard_focus_reveals_lower_form_before_real_article_filing_at_desktop_height(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _dir) =
            panel(cx, HouseRecord::default(), HouseCapabilities::local());
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            assert!(!window.find("house-new-article").visible());
            window.click("house-name", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let mut visited = Vec::new();
            for _ in 0..80 {
                window.press("tab", cx);
                let mut key = String::new();
                for (index, field) in view.read(cx).fields.iter().enumerate() {
                    if field.read(cx).focus_handle(cx).is_focused(window) {
                        key = house::field_key(INHERITABLE_FIELDS[index]).into();
                    }
                }
                visited.push(format!("{:?}:{key}", window.focused(cx)));
                if view
                    .read(cx)
                    .new_article
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
                {
                    break;
                }
            }
            assert!(
                view.read(cx)
                    .new_article
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window),
                "Tab focus trace: {visited:?}"
            );
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(window.find("house-new-article").visible());
            assert!(
                view.read(cx).fields.iter().all(|field| field
                    .read(cx)
                    .text()
                    .to_string()
                    .is_empty())
            );
            window.input("Preserve the original context", cx);
            assert!(view.read(cx).pending_request().is_none());
            window.click("house-add-article", cx);
            let request = view.read(cx).pending_request().unwrap().clone();
            assert!(view.read(cx).saved_record().state.charter.is_empty());
            ack(&view, &store, &request, window, cx);
            let saved = store.load().unwrap().record;
            assert_eq!(saved.state.charter[0].text, "Preserve the original context");
            assert_eq!(saved.state.charter[0].owner_ref, "house");
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, HouseEvent::SaveRequested(_)))
                .count(),
            1
        );
    }
    #[gpui_kit::test]
    fn read_only_capabilities_do_not_emit_offline_or_provider_success(cx: &mut TestAppContext) {
        let (handle, view, _store, _dir) =
            panel(cx, HouseRecord::default(), HouseCapabilities::default());
        let events = received(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("house-found-collection", cx);
            window.click("house-tab-engine", cx);
            assert!(events.lock().unwrap().is_empty());
            assert!(view.read(cx).saved_record().state.collections.is_empty());
            assert_eq!(view.read(cx).tab, HouseTab::Cabinet);
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn actual_library_search_scope_sort_and_keyboard_open_use_original_ids(
        cx: &mut TestAppContext,
    ) {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/house/web-reference.json")).unwrap();
        let record = Arc::new(HouseRecord::from_value(&value["base"]).unwrap());
        let entries = folios();
        let source_id = entries[0].native_id;
        let notes_id = entries[1].native_id;
        let (handle, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1280.), px(860.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        LibraryView::new(
                            record,
                            entries,
                            HouseCapabilities {
                                library_filters: true,
                                ..HouseCapabilities::local()
                            },
                            window,
                            cx,
                        )
                    })
                },
            )
            .unwrap()
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let handler = events.clone();
        cx.update(|cx| {
            cx.subscribe(&view, move |_, event: &HouseEvent, _| {
                handler.lock().unwrap().push(event.clone())
            })
            .detach()
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("library-scope-web/collection:letters", cx);
            assert_eq!(view.read(cx).visible_folio_ids(cx), vec![source_id]);
            window.click("library-scope-all", cx);
            window.click("library-search", cx);
            window.input("original", cx);
            assert_eq!(view.read(cx).visible_folio_ids(cx), vec![notes_id]);
            window.press("ctrl-a", cx);
            window.press("backspace", cx);
            view.update(cx, |view, cx| {
                view.set_name_order(vec!["folio:second".into(), "web/folio:café".into()], cx)
            });
            window.click("library-sort", cx);
            assert_eq!(
                view.read(cx).visible_folio_ids(cx),
                vec![notes_id, source_id]
            );
            let card = SharedString::from(format!("library-card-{source_id}"));
            window.click(card.clone(), cx);
            assert_eq!(window.find(card).role(), Some(Role::Button));
            assert!(
                window
                    .try_find(SharedString::from(format!("library-archive-{source_id}")))
                    .is_none()
            );
            assert_eq!(view.read(cx).folios[0].words, None);
            assert_eq!(view.read(cx).folios[0].preview, None);
        })
        .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| **event == HouseEvent::OpenFolio(source_id))
                .count(),
            1
        );
        cx.update_window(handle, |_, window, cx| window.press("enter", cx))
            .unwrap();
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| **event == HouseEvent::OpenFolio(source_id))
                .count(),
            2
        );
    }
}
