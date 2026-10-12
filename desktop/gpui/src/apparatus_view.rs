//! Original retained bibliography presentation; every external effect is a
//! guarded host request. Metadata becomes visible only after durable ACK.

pub use crate::semantic_bridge::ApparatusDetectedCitation;
use crate::{
    apparatus::{
        ApparatusDisplay, ApparatusEdit, ApparatusEffect, ApparatusRecord, ApparatusRequest,
        ApparatusSession, CitationStyle, RetainedBibEntry, UrlMergeTarget,
    },
    semantic_bridge::{ApparatusBuiltEntry, ApparatusFormattedEntry},
    theme::{self, DISPLAY_FONT, SERIF_FONT, TYPEWRITER_FONT},
};
use anyhow::{Result, ensure};
use gpui_kit::component::{Disableable, checkbox::Checkbox};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Context, EventEmitter, FocusHandle, Focusable, FontStyle, FontWeight,
    HighlightStyle, Render, Role, ScrollHandle, SharedString, StyledText, TestSupportExt, TextRun,
    Window, div, point, px, relative, rgb,
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum ApparatusSurface {
    #[default]
    Board,
    Page,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ApparatusCapabilities {
    pub persist: bool,
    pub scan: bool,
    pub copy: bool,
    pub cite: bool,
    pub preview: bool,
    pub research: bool,
    pub provider: bool,
    pub account_sources: bool,
    pub auto_insert: bool,
}
impl ApparatusCapabilities {
    pub fn local() -> Self {
        Self {
            persist: true,
            scan: true,
            copy: true,
            ..Self::default()
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct ApparatusResearchTarget {
    pub key: String,
    pub kind: String,
    pub anchor: String,
    pub query: String,
    pub status: String,
    pub count: usize,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Default)]
pub struct ApparatusResearchActivity {
    pub id: String,
    pub timestamp_label: String,
    pub kind: String,
    pub anchor: String,
    pub query: String,
    pub outcome: String,
    pub count: usize,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Default)]
pub struct ApparatusResearchState {
    pub status: String,
    pub phase: String,
    pub last_query: Option<String>,
    pub error: Option<String>,
    pub provider: Option<String>,
    pub progress: Vec<ApparatusResearchTarget>,
    pub activity: Vec<ApparatusResearchActivity>,
}
#[derive(Clone, Debug, Default)]
pub struct ApparatusViewContext {
    pub folio_id: String,
    pub metadata_generation: u64,
    pub context_id: Uuid,
    pub formatted_rows: Vec<ApparatusFormattedEntry>,
    pub copy_all_text: String,
    pub research: Option<ApparatusResearchState>,
}
#[derive(Clone, Debug)]
pub struct ApparatusAddDetectedRequest {
    pub request_id: Uuid,
    pub folio_id: String,
    pub base: Arc<ApparatusRecord>,
    pub detected: ApparatusDetectedCitation,
}
#[derive(Clone, Debug)]
pub struct ApparatusScanRequest {
    pub request_id: Uuid,
    pub folio_id: String,
    pub surface: ApparatusSurface,
    pub base: Arc<ApparatusRecord>,
}
#[derive(Clone, Debug)]
pub struct ApparatusCopyRequest {
    pub request_id: Uuid,
    pub folio_id: String,
    pub base: Arc<ApparatusRecord>,
    pub context_id: Uuid,
    pub source_index: Option<usize>,
    pub text: String,
}
#[derive(Clone, Debug)]
pub struct ApparatusCiteRequest {
    pub request_id: Uuid,
    pub folio_id: String,
    pub base: Arc<ApparatusRecord>,
    pub context_id: Uuid,
    pub source_index: usize,
    pub source_id: String,
    pub raw_entry: Value,
    pub footnote: String,
}
#[derive(Clone, Debug)]
pub enum ApparatusEvent {
    SaveRequested(ApparatusRequest),
    Filed {
        request_id: Uuid,
        effects: Vec<ApparatusEffect>,
    },
    SurfaceRequested(ApparatusSurface),
    BackToDesk,
    AddDetectedRequested(ApparatusAddDetectedRequest),
    ScanRequested(ApparatusScanRequest),
    CopyRequested(ApparatusCopyRequest),
    CiteRequested(ApparatusCiteRequest),
    OpenSourceRequested {
        folio_id: String,
        source_index: usize,
        source_id: String,
        url: String,
        title: String,
    },
    LookupRequested {
        folio_id: String,
        detected_id: String,
        url: String,
    },
    RetryResearchRequested {
        folio_id: String,
        target_id: Option<String>,
    },
    AutoInsertRequested {
        folio_id: String,
        enabled: bool,
    },
    SummarizeRequested {
        folio_id: String,
        source_index: usize,
        source_id: String,
    },
    AccountSourcesRequested,
}
pub fn init(_: &mut App) {}

#[derive(Default)]
struct Detections {
    rows: Vec<ApparatusDetectedCitation>,
    expanded_id: Option<String>,
    added: BTreeSet<String>,
}
enum AfterAck {
    Added {
        request_id: Uuid,
        folio_id: String,
        surface: ApparatusSurface,
        detected_id: String,
    },
    Cited {
        request_id: Uuid,
        source_index: usize,
    },
}
pub struct ApparatusView {
    session: ApparatusSession,
    active_folio_id: Option<String>,
    surface: ApparatusSurface,
    context: Option<ApparatusViewContext>,
    display: Option<ApparatusDisplay>,
    capabilities: ApparatusCapabilities,
    detections: BTreeMap<(String, ApparatusSurface), Detections>,
    add: Option<ApparatusAddDetectedRequest>,
    add_surface: ApparatusSurface,
    add_error: Option<String>,
    scan: Option<ApparatusScanRequest>,
    copy: Option<ApparatusCopyRequest>,
    cite: Option<ApparatusCiteRequest>,
    after_ack: Option<AfterAck>,
    local_error: Option<String>,
    notice: Option<String>,
    signal_collapsed: bool,
    trace_collapsed: bool,
    trace_open: BTreeMap<String, bool>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
}
impl EventEmitter<ApparatusEvent> for ApparatusView {}
impl Focusable for ApparatusView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
impl ApparatusView {
    pub fn new(
        record: Arc<ApparatusRecord>,
        scope: Option<String>,
        capabilities: ApparatusCapabilities,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut view = Self {
            session: ApparatusSession::new(record),
            active_folio_id: scope,
            surface: ApparatusSurface::Board,
            context: None,
            display: None,
            capabilities,
            detections: BTreeMap::new(),
            add: None,
            add_surface: ApparatusSurface::Board,
            add_error: None,
            scan: None,
            copy: None,
            cite: None,
            after_ack: None,
            local_error: None,
            notice: None,
            signal_collapsed: false,
            trace_collapsed: false,
            trace_open: BTreeMap::new(),
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
        };
        view.refresh_display();
        view
    }
    pub fn saved_record(&self) -> &Arc<ApparatusRecord> {
        self.session.saved()
    }
    pub fn active_folio_id(&self) -> Option<&str> {
        self.active_folio_id.as_deref()
    }
    pub fn surface(&self) -> ApparatusSurface {
        self.surface
    }
    pub fn display(&self) -> Option<&ApparatusDisplay> {
        self.display.as_ref()
    }
    pub fn pending_request(&self) -> Option<&ApparatusRequest> {
        self.session.pending()
    }
    pub fn pending_add(&self) -> Option<&ApparatusAddDetectedRequest> {
        self.add.as_ref()
    }
    pub fn pending_citation(&self) -> Option<&ApparatusCiteRequest> {
        self.cite.as_ref()
    }
    pub fn pending_scan(&self) -> Option<&ApparatusScanRequest> {
        self.scan.as_ref()
    }
    pub fn pending_copy(&self) -> Option<&ApparatusCopyRequest> {
        self.copy.as_ref()
    }
    pub fn detected_rows(&self, surface: ApparatusSurface) -> &[ApparatusDetectedCitation] {
        self.active_folio_id
            .as_ref()
            .and_then(|scope| self.detections.get(&(scope.clone(), surface)))
            .map(|state| state.rows.as_slice())
            .unwrap_or_default()
    }
    pub fn set_scope(
        &mut self,
        scope: Option<String>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.session.pending().is_some() {
            return false;
        }
        if scope == self.active_folio_id {
            return true;
        }
        self.active_folio_id = scope;
        self.context = None;
        self.clear_transient_requests();
        self.notice = None;
        self.local_error = None;
        self.refresh_display();
        self.scroll_handle.set_offset(point(px(0.), px(0.)));
        if self.surface == ApparatusSurface::Page {
            self.request_scan(cx);
        }
        cx.notify();
        true
    }
    pub fn set_surface(
        &mut self,
        surface: ApparatusSurface,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.surface = surface;
        self.scroll_handle.set_offset(point(px(0.), px(0.)));
        if surface == ApparatusSurface::Page {
            if let Some(scope) = self.active_folio_id.clone() {
                self.detections
                    .entry((scope, surface))
                    .or_default()
                    .rows
                    .clear();
            }
            self.request_scan(cx);
        }
        cx.notify();
    }
    pub fn set_capabilities(
        &mut self,
        capabilities: ApparatusCapabilities,
        cx: &mut Context<Self>,
    ) {
        if self.capabilities == capabilities {
            return;
        }
        self.capabilities = capabilities;
        cx.notify();
    }
    pub fn set_context(&mut self, context: ApparatusViewContext, cx: &mut Context<Self>) -> bool {
        if self.active_folio_id.as_deref() != Some(context.folio_id.as_str())
            || self.session.saved().generation != context.metadata_generation
        {
            return false;
        }
        self.context = Some(context);
        cx.notify();
        true
    }
    /// The host formats on a background task. The previous context must not
    /// remain actionable while the host is waiting for its replacement.
    pub fn clear_context(&mut self, cx: &mut Context<Self>) {
        if self.context.take().is_some() {
            cx.notify();
        }
    }
    pub fn prepare_pending_edits(
        &mut self,
        _: &mut Context<Self>,
    ) -> Result<Option<ApparatusRequest>> {
        Ok(self.session.pending().cloned())
    }
    pub fn flush_pending_edits(
        &mut self,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Option<ApparatusRequest>> {
        self.prepare_pending_edits(cx)
    }
    pub fn request_edit(
        &mut self,
        edit: ApparatusEdit,
        cx: &mut Context<Self>,
    ) -> Result<Option<ApparatusRequest>> {
        ensure!(
            self.capabilities.persist,
            "Local bibliography saving is unavailable."
        );
        ensure!(
            edit_scope_matches(&edit, self.active_folio_id.as_deref()),
            "The bibliography request belongs to another folio."
        );
        ensure!(
            self.add.is_none() && self.cite.is_none(),
            "Another source request is still being prepared."
        );
        let request = self.session.request(edit)?;
        if let Some(request) = &request {
            cx.emit(ApparatusEvent::SaveRequested(request.clone()));
        }
        self.local_error = None;
        cx.notify();
        Ok(request)
    }
    pub fn ack_saved(
        &mut self,
        id: Uuid,
        record: Arc<ApparatusRecord>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(request) = self
            .session
            .pending()
            .filter(|request| request.request_id == id)
            .cloned()
        else {
            return false;
        };
        if !self.session.acknowledge_saved(id, record) {
            return false;
        }
        self.context = None;
        self.refresh_display();
        match self.after_ack.take() {
            Some(AfterAck::Added {
                request_id,
                folio_id,
                surface,
                detected_id,
            }) if request_id == id => {
                self.detections
                    .entry((folio_id, surface))
                    .or_default()
                    .added
                    .insert(detected_id);
            }
            Some(AfterAck::Cited { request_id, .. }) if request_id == id => {
                self.notice = Some("Footnote placed.".into())
            }
            other => self.after_ack = other,
        }
        cx.emit(ApparatusEvent::Filed {
            request_id: id,
            effects: request.effects,
        });
        cx.notify();
        true
    }
    pub fn report_error(
        &mut self,
        id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        let accepted = self.session.report_error(id, message.into());
        if accepted {
            cx.notify();
        }
        accepted
    }
    pub fn retry(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(request) = self.session.retry() else {
            return false;
        };
        cx.emit(ApparatusEvent::SaveRequested(request));
        cx.notify();
        true
    }
    pub fn replace_record(
        &mut self,
        record: Arc<ApparatusRecord>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.add.is_some() || self.cite.is_some() || !self.session.replace_record(record) {
            return false;
        }
        self.context = None;
        self.refresh_display();
        cx.notify();
        true
    }
    pub fn append_detected(
        &mut self,
        folio_id: &str,
        rows: &[ApparatusDetectedCitation],
        cx: &mut Context<Self>,
    ) -> bool {
        if self.active_folio_id.as_deref() != Some(folio_id) {
            return false;
        }
        append_unseen(
            &mut self
                .detections
                .entry((folio_id.to_owned(), ApparatusSurface::Board))
                .or_default()
                .rows,
            rows,
        );
        cx.notify();
        true
    }
    pub fn request_scan(&mut self, cx: &mut Context<Self>) -> Option<ApparatusScanRequest> {
        if !self.capabilities.scan {
            return None;
        }
        let scope = self
            .active_folio_id
            .clone()
            .filter(|scope| !scope.is_empty())?;
        let request = ApparatusScanRequest {
            request_id: Uuid::new_v4(),
            folio_id: scope,
            surface: self.surface,
            base: self.session.saved().clone(),
        };
        self.scan = Some(request.clone());
        self.local_error = None;
        cx.emit(ApparatusEvent::ScanRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn accept_scan(
        &mut self,
        id: Uuid,
        rows: Vec<ApparatusDetectedCitation>,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(request) = self
            .scan
            .as_ref()
            .filter(|request| request.request_id == id)
        else {
            return false;
        };
        if !self.current_base(&request.folio_id, &request.base) {
            return false;
        }
        let state = self
            .detections
            .entry((request.folio_id.clone(), request.surface))
            .or_default();
        if request.surface == ApparatusSurface::Board {
            append_unseen(&mut state.rows, &rows);
        } else {
            state.rows = rows;
        }
        self.scan = None;
        self.local_error = None;
        cx.notify();
        true
    }
    pub fn report_scan_error(
        &mut self,
        id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self
            .scan
            .as_ref()
            .is_none_or(|request| request.request_id != id)
        {
            return false;
        }
        self.scan = None;
        self.local_error = Some(message.into());
        cx.notify();
        true
    }
    pub fn accept_add_detected(
        &mut self,
        id: Uuid,
        built: ApparatusBuiltEntry,
        cx: &mut Context<Self>,
    ) -> Result<Option<ApparatusRequest>> {
        let Some(held) = self
            .add
            .as_ref()
            .filter(|request| request.request_id == id)
            .cloned()
        else {
            return Ok(None);
        };
        ensure!(
            self.current_base(&held.folio_id, &held.base),
            "The bibliography changed while this source was being prepared."
        );
        ensure!(
            self.session.pending().is_none(),
            "A bibliography save is still pending."
        );
        let merge = built.merge_target.map(|target| UrlMergeTarget {
            index: target.index,
            expected_raw_row: target.expected_raw_row,
        });
        // Keep the held request on errors; only an accepted exact candidate can settle it.
        let request = self.session.request(ApparatusEdit::AddDetected {
            folio_id: held.folio_id.clone(),
            entry: built.entry,
            merge,
        })?;
        self.add = None;
        self.add_error = None;
        if let Some(request) = &request {
            self.after_ack = Some(AfterAck::Added {
                request_id: request.request_id,
                folio_id: held.folio_id,
                surface: self.add_surface,
                detected_id: held.detected.id,
            });
            cx.emit(ApparatusEvent::SaveRequested(request.clone()));
        } else {
            self.detections
                .entry((held.folio_id, self.add_surface))
                .or_default()
                .added
                .insert(held.detected.id);
        }
        cx.notify();
        Ok(request)
    }
    pub fn report_add_error(
        &mut self,
        id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self
            .add
            .as_ref()
            .is_none_or(|request| request.request_id != id)
        {
            return false;
        }
        self.add_error = Some(message.into());
        cx.notify();
        true
    }
    pub fn retry_add(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(request) = self.add.clone() else {
            return false;
        };
        if self.add_error.is_none() || !self.current_base(&request.folio_id, &request.base) {
            return false;
        }
        self.add_error = None;
        cx.emit(ApparatusEvent::AddDetectedRequested(request));
        cx.notify();
        true
    }
    pub fn cancel_add(&mut self, id: Uuid, cx: &mut Context<Self>) -> bool {
        if self
            .add
            .as_ref()
            .is_none_or(|request| request.request_id != id)
        {
            return false;
        }
        self.add = None;
        self.add_error = None;
        cx.notify();
        true
    }
    pub fn request_copy_all(&mut self, cx: &mut Context<Self>) -> Option<ApparatusCopyRequest> {
        let context = self.current_context()?;
        self.begin_copy(None, context.copy_all_text.clone(), cx)
    }
    pub fn request_copy_one(
        &mut self,
        index: usize,
        cx: &mut Context<Self>,
    ) -> Option<ApparatusCopyRequest> {
        let row = self.entry(index)?;
        let text = self.formatted(row)?.citation.clone();
        self.begin_copy(Some(index), text, cx)
    }
    pub fn ack_copy(
        &mut self,
        id: Uuid,
        result: std::result::Result<(), String>,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(request) = self
            .copy
            .as_ref()
            .filter(|request| request.request_id == id)
        else {
            return false;
        };
        if !self.current_base(&request.folio_id, &request.base) {
            return false;
        }
        self.copy = None;
        match result {
            Ok(()) => {
                self.local_error = None;
                self.notice = Some("Copied.".into());
            }
            Err(message) => self.local_error = Some(message),
        }
        cx.notify();
        true
    }
    pub fn ack_citation(
        &mut self,
        id: Uuid,
        result: std::result::Result<f64, String>,
        cx: &mut Context<Self>,
    ) -> Result<Option<ApparatusRequest>> {
        let Some(held) = self
            .cite
            .as_ref()
            .filter(|request| request.request_id == id)
            .cloned()
        else {
            return Ok(None);
        };
        ensure!(
            self.current_base(&held.folio_id, &held.base),
            "The bibliography changed before citation placement settled."
        );
        let timestamp = match result {
            Ok(timestamp) => timestamp,
            Err(message) => {
                self.cite = None;
                self.notice = Some(message);
                cx.notify();
                return Ok(None);
            }
        };
        let number = serde_json::Number::from_f64(timestamp).ok_or_else(|| {
            anyhow::anyhow!("Citation placement did not supply a finite timestamp.")
        })?;
        let mut entry = held.raw_entry;
        entry
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("The retained source is not an object."))?
            .insert("citationInsertedAt".into(), Value::Number(number));
        let request = self.session.request(ApparatusEdit::Upsert {
            folio_id: held.folio_id,
            entry,
        })?;
        self.cite = None;
        if let Some(request) = &request {
            self.after_ack = Some(AfterAck::Cited {
                request_id: request.request_id,
                source_index: held.source_index,
            });
            cx.emit(ApparatusEvent::SaveRequested(request.clone()));
        }
        cx.notify();
        Ok(request)
    }
    pub fn request_add_detected(
        &mut self,
        detected_id: &str,
        cx: &mut Context<Self>,
    ) -> Option<ApparatusAddDetectedRequest> {
        if !self.can_mutate() || self.detections()?.added.contains(detected_id) {
            return None;
        }
        let detected = self
            .detections()?
            .rows
            .iter()
            .find(|row| row.id == detected_id)?
            .clone();
        let request = ApparatusAddDetectedRequest {
            request_id: Uuid::new_v4(),
            folio_id: self.active_folio_id.clone()?,
            base: self.session.saved().clone(),
            detected,
        };
        self.add = Some(request.clone());
        self.add_surface = self.surface;
        self.add_error = None;
        self.local_error = None;
        cx.emit(ApparatusEvent::AddDetectedRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn request_citation(
        &mut self,
        index: usize,
        cx: &mut Context<Self>,
    ) -> Option<ApparatusCiteRequest> {
        if self.surface != ApparatusSurface::Board || !self.capabilities.cite || !self.can_mutate()
        {
            return None;
        }
        let row = self.entry(index)?;
        if inserted(row) {
            return None;
        }
        let formatted = self.formatted(row)?;
        if formatted.footnote.is_empty() {
            return None;
        }
        let request = ApparatusCiteRequest {
            request_id: Uuid::new_v4(),
            folio_id: row.entry.folio_id.clone(),
            base: self.session.saved().clone(),
            context_id: self.current_context()?.context_id,
            source_index: row.index,
            source_id: row.entry.id.clone(),
            raw_entry: row.raw.clone(),
            footnote: formatted.footnote.clone(),
        };
        self.cite = Some(request.clone());
        self.notice = None;
        cx.emit(ApparatusEvent::CiteRequested(request.clone()));
        cx.notify();
        Some(request)
    }
    pub fn dismiss_detected(&mut self, detected_id: &str, cx: &mut Context<Self>) -> bool {
        let Some(scope) = self.active_folio_id.clone() else {
            return false;
        };
        let Some(state) = self.detections.get_mut(&(scope, self.surface)) else {
            return false;
        };
        let before = state.rows.len();
        state.rows.retain(|row| row.id != detected_id);
        if state.expanded_id.as_deref() == Some(detected_id) {
            state.expanded_id = None;
        }
        let changed = before != state.rows.len();
        if changed {
            cx.notify();
        }
        changed
    }
    fn can_mutate(&self) -> bool {
        self.capabilities.persist
            && self.session.pending().is_none()
            && self.add.is_none()
            && self.cite.is_none()
            && self
                .display
                .as_ref()
                .is_some_and(|display| display.bibliography.editable)
    }
    fn same_row(&self, index: usize, id: &str, scope: &str) -> bool {
        self.active_folio_id.as_deref() == Some(scope)
            && self.entry(index).is_some_and(|row| row.entry.id == id)
    }
    fn same_detection(&self, scope: &str, surface: ApparatusSurface, id: &str) -> bool {
        self.active_folio_id.as_deref() == Some(scope)
            && self.surface == surface
            && self
                .detections()
                .is_some_and(|state| state.rows.iter().any(|row| row.id == id))
    }
    fn drop_source(&mut self, scope: &str, index: usize, id: &str, cx: &mut Context<Self>) {
        if !self.same_row(index, id, scope) || !self.can_mutate() {
            return;
        }
        self.try_edit(
            ApparatusEdit::Drop {
                folio_id: scope.to_owned(),
                id: id.to_owned(),
            },
            cx,
        );
    }
    fn try_edit(&mut self, edit: ApparatusEdit, cx: &mut Context<Self>) {
        if let Err(error) = self.request_edit(edit, cx) {
            self.local_error = Some(error.to_string());
            cx.notify();
        }
    }
    fn open_source(&self, scope: &str, index: usize, id: &str, cx: &mut Context<Self>) {
        if !self.capabilities.preview || !self.same_row(index, id, scope) {
            return;
        }
        let Some(row) = self.entry(index) else {
            return;
        };
        cx.emit(ApparatusEvent::OpenSourceRequested {
            folio_id: scope.to_owned(),
            source_index: index,
            source_id: id.to_owned(),
            url: row.entry.url.clone(),
            title: row.entry.title.clone(),
        });
    }
    fn toggle_details(
        &mut self,
        scope: &str,
        surface: ApparatusSurface,
        id: &str,
        cx: &mut Context<Self>,
    ) {
        if !self.same_detection(scope, surface, id) {
            return;
        }
        if let Some(state) = self.detections.get_mut(&(scope.to_owned(), surface)) {
            state.expanded_id = if state.expanded_id.as_deref() == Some(id) {
                None
            } else {
                Some(id.to_owned())
            };
            cx.notify();
        }
    }
    fn current_base(&self, scope: &str, base: &Arc<ApparatusRecord>) -> bool {
        self.active_folio_id.as_deref() == Some(scope)
            && self.session.saved().as_ref() == base.as_ref()
    }
    fn current_context(&self) -> Option<&ApparatusViewContext> {
        self.context.as_ref().filter(|context| {
            self.active_folio_id.as_deref() == Some(context.folio_id.as_str())
                && context.metadata_generation == self.session.saved().generation
        })
    }
    fn has_research(&self) -> bool {
        self.capabilities.research
            && self
                .current_context()
                .is_some_and(|context| context.research.is_some())
    }
    fn entry(&self, index: usize) -> Option<&RetainedBibEntry> {
        self.display
            .as_ref()?
            .bibliography
            .entries
            .iter()
            .find(|entry| entry.index == index)
    }
    fn formatted(&self, row: &RetainedBibEntry) -> Option<&ApparatusFormattedEntry> {
        self.current_context()?
            .formatted_rows
            .iter()
            .find(|formatted| {
                formatted.index == row.index
                    && formatted.id == row.entry.id
                    && formatted.folio_id == row.entry.folio_id
            })
    }
    fn refresh_display(&mut self) {
        self.display = self
            .active_folio_id
            .as_deref()
            .filter(|scope| !scope.is_empty())
            .and_then(|scope| match self.session.saved().display(scope) {
                Ok(display) => Some(display),
                Err(error) => {
                    self.local_error = Some(error.to_string());
                    None
                }
            });
    }
    fn clear_transient_requests(&mut self) {
        self.add = None;
        self.add_error = None;
        self.scan = None;
        self.copy = None;
        self.cite = None;
    }
    fn detections(&self) -> Option<&Detections> {
        self.detections
            .get(&(self.active_folio_id.clone()?, self.surface))
    }
    fn begin_copy(
        &mut self,
        index: Option<usize>,
        text: String,
        cx: &mut Context<Self>,
    ) -> Option<ApparatusCopyRequest> {
        if !self.capabilities.copy || self.copy.is_some() || text.is_empty() {
            return None;
        }
        let context = self.current_context()?;
        let request = ApparatusCopyRequest {
            request_id: Uuid::new_v4(),
            folio_id: context.folio_id.clone(),
            base: self.session.saved().clone(),
            context_id: context.context_id,
            source_index: index,
            text,
        };
        self.copy = Some(request.clone());
        self.notice = None;
        cx.emit(ApparatusEvent::CopyRequested(request.clone()));
        cx.notify();
        Some(request)
    }
}
fn edit_scope_matches(edit: &ApparatusEdit, scope: Option<&str>) -> bool {
    match edit {
        ApparatusEdit::Drop { folio_id, .. }
        | ApparatusEdit::Upsert { folio_id, .. }
        | ApparatusEdit::AddDetected { folio_id, .. } => Some(folio_id.as_str()) == scope,
        ApparatusEdit::SetCitationStyle(_) => true,
        ApparatusEdit::Batch(edits) => edits.iter().all(|edit| edit_scope_matches(edit, scope)),
    }
}
fn inserted(row: &RetainedBibEntry) -> bool {
    row.entry
        .citation_inserted_at
        .as_ref()
        .is_some_and(|timestamp| *timestamp != 0.)
}
fn append_unseen(
    existing: &mut Vec<ApparatusDetectedCitation>,
    incoming: &[ApparatusDetectedCitation],
) {
    let ids: BTreeSet<_> = existing.iter().map(|row| row.id.as_str()).collect();
    let new_rows: Vec<_> = incoming
        .iter()
        .filter(|row| !ids.contains(row.id.as_str()))
        .cloned()
        .collect();
    existing.extend(new_rows);
}
impl Render for ApparatusView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = *theme::palette(cx);
        div()
            .id("apparatus-root")
            .test_support()
            .track_focus(&self.focus_handle)
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(rgb(if self.surface == ApparatusSurface::Board {
                palette.sidebar
            } else {
                palette.paper_soft
            }))
            .text_color(rgb(palette.ink))
            .font_family(SERIF_FONT)
            .font_features(theme::editorial_font_features())
            .text_size(px(14.))
            .line_height(relative(1.5))
            .child(if self.surface == ApparatusSurface::Board {
                self.board(cx)
            } else {
                self.page(window, cx)
            })
    }
}

impl ApparatusView {
    fn status(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let p = *theme::palette(cx);
        if let Some(error) = self.session.error() {
            return Some(
                div()
                    .id("apparatus-error")
                    .test_support()
                    .role(Role::Alert)
                    .aria_label(error)
                    .px(px(16.))
                    .py(px(8.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .child(prose(error, 12., 18., p.vermilion))
                    .child(
                        key("apparatus-retry", "Retry", true, false, cx).on_click(cx.listener(
                            |this, _, _, cx| {
                                this.retry(cx);
                            },
                        )),
                    )
                    .into_any_element(),
            );
        }
        if self.session.pending().is_some() {
            return Some(
                div()
                    .id("apparatus-saving")
                    .test_support()
                    .role(Role::Status)
                    .aria_label("Saving bibliography…")
                    .px(px(16.))
                    .py(px(8.))
                    .child(type_text("Saving bibliography…", 11., 16.5, p.ink_muted))
                    .into_any_element(),
            );
        }
        if let Some(error) = &self.add_error {
            return Some(
                div()
                    .id("apparatus-add-error")
                    .test_support()
                    .role(Role::Alert)
                    .aria_label(error)
                    .px(px(16.))
                    .py(px(8.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .child(prose(error, 12., 18., p.vermilion))
                    .child(
                        key("apparatus-add-retry", "Retry", true, false, cx).on_click(cx.listener(
                            |this, _, _, cx| {
                                this.retry_add(cx);
                            },
                        )),
                    )
                    .into_any_element(),
            );
        }
        if let Some(error) = &self.local_error {
            return Some(
                div()
                    .id("apparatus-local-error")
                    .test_support()
                    .role(Role::Alert)
                    .aria_label(error)
                    .px(px(16.))
                    .py(px(8.))
                    .child(prose(error, 12., 18., p.vermilion))
                    .into_any_element(),
            );
        }
        self.notice.as_ref().map(|notice| {
            div()
                .id("apparatus-notice")
                .test_support()
                .role(Role::Status)
                .aria_label(notice)
                .px(px(16.))
                .py(px(6.))
                .child(type_text(notice, 11., 16., p.ink_light))
                .into_any_element()
        })
    }
    fn issues(&self, cx: &App) -> Option<AnyElement> {
        let display = self.display.as_ref()?;
        let issues = display
            .bibliography
            .issues
            .iter()
            .chain(&display.settings.issues);
        let mut body = div()
            .id("apparatus-issues")
            .test_support()
            .role(Role::Alert)
            .px(px(16.))
            .py(px(8.))
            .flex()
            .flex_col()
            .gap(px(4.));
        let mut any = false;
        for issue in issues {
            any = true;
            body = body.child(prose(
                &format!("{}: {}", issue.path, issue.message),
                12.,
                18.,
                theme::palette(cx).ink_light,
            ));
        }
        any.then(|| body.into_any_element())
    }
    fn board(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let entries = self
            .display
            .as_ref()
            .map(|display| display.bibliography.entries.as_slice())
            .unwrap_or_default();
        let background = entries
            .iter()
            .filter(|row| row.entry.is_background())
            .count();
        let writer = entries.len() - background;
        let mut board = div()
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("apparatus-sources-header")
                    .test_support()
                    .flex_shrink_0()
                    .px(px(16.))
                    .py(px(8.))
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .bg(rgb(p.paper_soft))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(tracked("Sources", 11., 2.42, p.ink_muted))
                    .child(tracked(
                        &format!("{background} agent · {writer} saved"),
                        11.,
                        1.32,
                        p.ink_muted,
                    ))
                    .child(
                        div().ml_auto().child(
                            text_key(
                                "apparatus-full-view",
                                "Full view ↗",
                                11.,
                                1.32,
                                p.vermilion,
                                cx,
                            )
                            .on_click(cx.listener(|_, _, _, cx| {
                                cx.emit(ApparatusEvent::SurfaceRequested(ApparatusSurface::Page))
                            })),
                        ),
                    ),
            )
            .child(self.signal(false, cx));
        if let Some(trace) = self.trace(cx) {
            board = board.child(trace);
        }
        if let Some(status) = self.status(cx) {
            board = board.child(status);
        }
        if let Some(issues) = self.issues(cx) {
            board = board.child(issues);
        }
        let mut list = div()
            .id("apparatus-scroll")
            .test_support()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .pb(px(8.));
        if !entries.is_empty() {
            let mut heading = div()
                .px(px(16.))
                .pt(px(16.))
                .pb(px(8.))
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(tracked(
                            &format!("Sources · {}", entries.len()),
                            11.,
                            2.42,
                            p.ink_muted,
                        ))
                        .child(
                            text_key("apparatus-open-page", "Open ↗", 11., 1.65, p.ink_muted, cx)
                                .px(px(8.))
                                .py(px(4.))
                                .border_1()
                                .border_color(rgb(p.rule))
                                .rounded(px(2.))
                                .on_click(cx.listener(|_, _, _, cx| {
                                    cx.emit(ApparatusEvent::SurfaceRequested(
                                        ApparatusSurface::Page,
                                    ))
                                })),
                        ),
                );
            let enabled = self.capabilities.auto_insert && self.capabilities.cite;
            let checked = self
                .session
                .saved()
                .effective_settings()
                .as_ref()
                .and_then(|value| value.get("autoInsertFootnotes"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            heading = heading.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(type_text("Auto-footnote", 11., 16.5, p.ink_muted))
                    .child(
                        Checkbox::new("apparatus-auto-footnote")
                            .checked(checked)
                            .disabled(!enabled)
                            .aria_label("Automatically insert researched sources as footnotes")
                            .on_change(cx.listener(|this, checked: &bool, _, cx| {
                                if this.capabilities.auto_insert
                                    && this.capabilities.cite
                                    && let Some(folio_id) = this.active_folio_id.clone()
                                {
                                    cx.emit(ApparatusEvent::AutoInsertRequested {
                                        folio_id,
                                        enabled: *checked,
                                    });
                                }
                            })),
                    ),
            );
            list = list.child(heading);
            for row in entries {
                list = list.child(self.board_source(row, cx));
            }
        }
        let detected = self
            .detections()
            .map(|state| state.rows.as_slice())
            .unwrap_or_default();
        if !detected.is_empty() {
            list = list.child(
                div()
                    .px(px(16.))
                    .pt(px(20.))
                    .pb(px(8.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(tracked(
                        "Detected in the manuscript",
                        11.,
                        2.42,
                        p.ink_muted,
                    ))
                    .child(
                        text_key("apparatus-rescan", "↻ re-scan", 11., 1.65, p.ink_muted, cx)
                            .disabled(!self.capabilities.scan || self.scan.is_some())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.request_scan(cx);
                            })),
                    ),
            );
            for (index, row) in detected.iter().enumerate() {
                list = list.child(self.board_detected(index, row, cx));
            }
        }
        if entries.is_empty() && detected.is_empty() {
            list = list
                .child(div().px(px(16.)).py(px(24.)).italic().child(prose(
                    if self.has_research() {
                        "Watching for claims that need sources."
                    } else {
                        "No sources on file. Scan your manuscript for citations."
                    },
                    14.,
                    21.,
                    p.ink_muted,
                )))
                .child(
                    div().px(px(16.)).child(
                        text_key("apparatus-rescan", "↻ re-scan", 11., 1.65, p.ink_muted, cx)
                            .disabled(
                                !self.capabilities.scan
                                    || self.scan.is_some()
                                    || self.active_folio_id.is_none(),
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.request_scan(cx);
                            })),
                    ),
                );
        }
        board.child(list).into_any_element()
    }
    fn signal(&self, page: bool, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let research = self
            .current_context()
            .and_then(|context| context.research.as_ref());
        let background = self
            .display
            .as_ref()
            .map(|d| {
                d.bibliography
                    .entries
                    .iter()
                    .filter(|r| r.entry.is_background())
                    .count()
            })
            .unwrap_or(0);
        let state = research.map(|r| r.status.as_str()).unwrap_or("unavailable");
        let active = research
            .map(|r| {
                r.progress
                    .iter()
                    .filter(|target| matches!(target.status.as_str(), "queued" | "searching"))
                    .count()
            })
            .unwrap_or(0);
        let summary = match (self.capabilities.research, research) {
            (true, Some(research)) if state == "error" => research
                .error
                .clone()
                .unwrap_or_else(|| "Research needs attention".into()),
            (true, Some(research)) if state == "running" && research.phase == "extracting" => {
                if page {
                    "Apparatus is reading your draft…"
                } else {
                    "Reading draft"
                }
                .into()
            }
            (true, Some(_)) if state == "running" => {
                if page {
                    "Apparatus is hunting for sources…".into()
                } else {
                    format!("{active} search{}", if active == 1 { "" } else { "es" })
                }
            }
            (true, Some(_)) if state == "saving" => if page {
                "Saving a discovered source…"
            } else {
                "Saving source"
            }
            .into(),
            (true, Some(_)) if background == 0 => if page {
                "Agents are watching your draft. Sources will appear as they are found."
            } else {
                "Watching draft"
            }
            .into(),
            _ if background > 0 => format!(
                "{background} source{} on file",
                if background == 1 { "" } else { "s" }
            ),
            _ => "Research is unavailable offline.".into(),
        };
        let dot_color = if !self.capabilities.research || research.is_none() {
            p.ink_muted
        } else {
            match state {
                "running" => p.mustard,
                "saving" => p.cobalt,
                "error" => p.vermilion,
                _ => p.success,
            }
        };
        let mut card = div().id("apparatus-signal").test_support().flex_shrink_0();
        card = if page {
            card.border_1()
                .border_color(rgb(p.rule))
                .rounded(px(4.))
                .bg(rgb(p.paper))
        } else {
            card.border_b_1()
                .border_color(rgb(p.rule).opacity(0.78))
                .bg(rgb(p.sidebar).opacity(0.72))
        };
        let mut head = div()
            .id("apparatus-signal-head")
            .test_support()
            .min_h(px(44.))
            .px(px(if page { 16. } else { 12. }))
            .py(px(if page { 16. } else { 7.2 }))
            .flex()
            .items_center()
            .gap(px(if page { 12. } else { 10.4 }));
        let dot = div()
            .w(px(if page { 8. } else { 7.68 }))
            .h(px(if page { 8. } else { 7.68 }))
            .rounded_full()
            .flex_shrink_0()
            .bg(rgb(dot_color));
        let mut label = div().min_w_0();
        if page {
            label = label
                .flex_1()
                .child(display_text(&summary, 14., 20., p.ink));
        } else {
            label = label
                .child(tracked("Signal", 11., 2.42, p.ink_muted))
                .child(div().mt(px(0.8)).truncate().child(prose(
                    &summary,
                    11.84,
                    15.392,
                    p.ink_light,
                )));
        }
        if page {
            if let Some(query) = research
                .and_then(|r| r.last_query.as_ref())
                .filter(|query| !query.is_empty())
            {
                label = label.child(div().mt(px(2.)).child(tracked(
                    &format!("last query: {query}"),
                    11.2,
                    0.,
                    p.ink_muted,
                )));
            } else {
                label = label.child(div().mt(px(2.)).child(type_text(
                    if self.has_research() {
                        "The Apparatus reads your draft and hunts sources for the claims inside it."
                    } else {
                        "Saved sources remain available. Background research needs a provider."
                    },
                    11.2,
                    16.8,
                    p.ink_muted,
                )));
            }
        }
        head = if page {
            head.child(dot).child(label)
        } else {
            head.justify_between().child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(10.))
                    .child(dot)
                    .child(label),
            )
        };
        if page {
            head = head.child(
                div()
                    .text_right()
                    .flex_shrink_0()
                    .child(display_text(&background.to_string(), 24., 24., p.vermilion))
                    .child(
                        div()
                            .mt(px(4.))
                            .child(tracked("found", 8.8, 1.32, p.ink_muted)),
                    ),
            );
        } else {
            let mut actions = div().flex().items_center().gap(px(6.));
            if research
                .and_then(|research| research.error.as_ref())
                .is_some()
            {
                actions = actions.child(
                    text_key(
                        "apparatus-research-retry",
                        "↻ retry pass",
                        9.28,
                        0.928,
                        p.vermilion,
                        cx,
                    )
                    .px(px(6.4))
                    .py(px(4.))
                    .border_1()
                    .border_color(rgb(p.vermilion).opacity(0.58))
                    .disabled(!self.capabilities.research)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.capabilities.research
                            && let Some(folio_id) = this.active_folio_id.clone()
                        {
                            cx.emit(ApparatusEvent::RetryResearchRequested {
                                folio_id,
                                target_id: None,
                            });
                        }
                    })),
                );
            }
            head = head.child(
                actions.child(
                    gpui_kit::base::Button::new("apparatus-signal-toggle")
                        .accessibility_label(if self.signal_collapsed {
                            "Expand Signal Desk"
                        } else {
                            "Collapse Signal Desk"
                        })
                        .w(px(36.))
                        .h(px(36.))
                        .p_0()
                        .child(type_text(
                            if self.signal_collapsed { "▸" } else { "▾" },
                            12.8,
                            12.8,
                            p.ink_light,
                        ))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.signal_collapsed = !this.signal_collapsed;
                            cx.notify();
                        })),
                ),
            );
        }
        card = card.child(head);
        if !page
            && !self.signal_collapsed
            && let Some(query) = research
                .and_then(|research| research.last_query.as_ref())
                .filter(|query| !query.is_empty())
        {
            card = card.child(
                div()
                    .id("apparatus-signal-query")
                    .test_support()
                    .pl(px(28.))
                    .pr(px(12.))
                    .pb(px(7.2))
                    .truncate()
                    .child(crate::chrome::tracked_text(
                        query,
                        gpui_kit::font(TYPEWRITER_FONT),
                        9.92,
                        0.3968,
                        p.ink_muted,
                        14.88,
                    )),
            );
        }
        if page && let Some(error) = research.and_then(|r| r.error.as_ref()) {
            card = card.child(
                div()
                    .px(px(12.))
                    .pb(px(8.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(prose(error, 11.2, 16.8, p.vermilion)),
                    )
                    .child(
                        text_key(
                            "apparatus-research-retry",
                            "↻ retry",
                            9.6,
                            1.44,
                            p.vermilion,
                            cx,
                        )
                        .disabled(!self.capabilities.research)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.capabilities.research
                                && let Some(folio_id) = this.active_folio_id.clone()
                            {
                                cx.emit(ApparatusEvent::RetryResearchRequested {
                                    folio_id,
                                    target_id: None,
                                });
                            }
                        })),
                    ),
            );
        }
        if page && let Some(research) = research {
            if let Some(provider) = &research.provider {
                card = card.child(div().px(px(16.)).pb(px(8.)).child(type_text(
                    &format!("provider: {provider}"),
                    10.4,
                    15.6,
                    p.ink_muted,
                )));
            }
            for activity in research.activity.iter().take(6) {
                let outcome = match activity.outcome.as_str() {
                    "found" => format!("✦ {}", activity.count),
                    "error" => "⚠".into(),
                    _ => "✗".into(),
                };
                card = card.child(
                    div()
                        .px(px(16.))
                        .py(px(5.6))
                        .border_t_1()
                        .border_dashed()
                        .border_color(rgb(p.rule))
                        .flex()
                        .items_start()
                        .gap(px(8.))
                        .child(type_text(
                            &outcome,
                            10.4,
                            15.6,
                            if activity.outcome == "found" {
                                p.success
                            } else {
                                p.ink_muted
                            },
                        ))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(prose(
                                    &clip_utf16(&activity.anchor, 100),
                                    12.,
                                    16.8,
                                    p.ink_light,
                                ))
                                .child(mono(&activity.query, 10.4, 15.6, p.ink_muted)),
                        )
                        .child(type_text(&activity.timestamp_label, 9.6, 14.4, p.ink_muted)),
                );
            }
        }
        card.into_any_element()
    }
    fn trace(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let research = self.current_context()?.research.as_ref()?;
        if research.progress.is_empty() {
            return None;
        }
        let p = *theme::palette(cx);
        let mut card = div()
            .id("apparatus-trace")
            .test_support()
            .flex_shrink_0()
            .border_b_1()
            .border_color(rgb(p.rule).opacity(0.78))
            .bg(rgb(p.sidebar).opacity(0.72))
            .child(
                div()
                    .min_h(px(44.))
                    .px(px(12.))
                    .py(px(7.2))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(tracked(
                        &format!("Deep trace · {}", research.progress.len()),
                        11.,
                        2.42,
                        p.ink_muted,
                    ))
                    .child(
                        gpui_kit::base::Button::new("apparatus-trace-toggle")
                            .accessibility_label(if self.trace_collapsed {
                                "Expand Deep trace"
                            } else {
                                "Collapse Deep trace"
                            })
                            .w(px(36.))
                            .h(px(36.))
                            .p_0()
                            .child(type_text(
                                if self.trace_collapsed { "▸" } else { "▾" },
                                12.8,
                                12.8,
                                p.ink_light,
                            ))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.trace_collapsed = !this.trace_collapsed;
                                cx.notify();
                            })),
                    ),
            );
        if !self.trace_collapsed {
            for (index, item) in research.progress.iter().enumerate() {
                let open = self
                    .trace_open
                    .get(&item.key)
                    .copied()
                    .unwrap_or(matches!(item.status.as_str(), "searching" | "error"));
                let target_key = item.key.clone();
                let state = match item.status.as_str() {
                    "searching" => "searching".into(),
                    "found" => format!("{} found", item.count),
                    "missed" => "no match".into(),
                    "error" => "failed".into(),
                    _ => "queued".into(),
                };
                let color = match item.status.as_str() {
                    "searching" => p.mustard,
                    "found" => p.success,
                    "error" => p.vermilion,
                    _ => p.ink_muted,
                };
                let mut row = div()
                    .border_t_1()
                    .border_dashed()
                    .border_color(rgb(p.rule))
                    .child(
                        gpui_kit::base::Button::new(SharedString::from(format!(
                            "apparatus-trace-{index}"
                        )))
                        .accessibility_label(format!("{}: {}", kind_label(&item.kind), item.anchor))
                        .h_auto()
                        .w_full()
                        .px(px(12.))
                        .py(px(7.2))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(7.2))
                                .child(
                                    div()
                                        .size(px(7.68))
                                        .flex_shrink_0()
                                        .rounded_full()
                                        .bg(rgb(color)),
                                )
                                .child(div().flex_1().min_w_0().child(prose(
                                    &format!(
                                        "{} “{}”",
                                        kind_label(&item.kind),
                                        clip_utf16(&item.anchor, 90)
                                    ),
                                    11.52,
                                    16.128,
                                    p.ink_light,
                                )))
                                .child(tracked(&state, 9.28, 0.5568, color)),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.trace_open.insert(target_key.clone(), !open);
                            cx.notify();
                        })),
                    );
                if open {
                    let mut detail = div()
                        .ml(px(26.4))
                        .mr(px(12.))
                        .mb(px(9.6))
                        .px(px(9.6))
                        .py(px(8.))
                        .border_l_2()
                        .border_color(rgb(p.periwinkle))
                        .child(tracked("Exact query", 9.28, 0.5568, p.ink_muted))
                        .child(mono(&item.query, 9.92, 14.384, p.ink_light));
                    if let Some(error) = &item.error {
                        detail = detail.child(mono(error, 9.92, 14.384, p.vermilion));
                    }
                    if item.status == "error" {
                        let target = item.key.clone();
                        detail = detail.child(
                            text_key(
                                SharedString::from(format!("apparatus-target-retry-{index}")),
                                "↻ retry this search",
                                9.6,
                                1.44,
                                p.vermilion,
                                cx,
                            )
                            .disabled(!self.capabilities.research)
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    if this.capabilities.research
                                        && let Some(folio_id) = this.active_folio_id.clone()
                                    {
                                        cx.emit(ApparatusEvent::RetryResearchRequested {
                                            folio_id,
                                            target_id: Some(target.clone()),
                                        });
                                    }
                                },
                            )),
                        );
                    }
                    row = row.child(detail);
                }
                card = card.child(row);
            }
        }
        Some(card.into_any_element())
    }
    fn board_source(&self, row: &RetainedBibEntry, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let is_cited = inserted(row)
            || self.detections().is_some_and(|state| {
                state.rows.iter().any(|detected| {
                    detected.lookup_url.as_ref().is_some_and(|url| {
                        url.trim_end_matches('/') == row.entry.url.trim_end_matches('/')
                    })
                })
            });
        let accent = if is_cited {
            p.success
        } else if row.entry.is_background() {
            p.mustard
        } else {
            p.ink_muted
        };
        let index = row.index;
        let mut title = div()
            .flex()
            .items_start()
            .gap(px(8.8))
            .child(div().w(px(0.)).flex_shrink_0())
            .child(div().flex_1().min_w_0().child(display_text(
                &row.entry.title,
                15.,
                19.5,
                p.ink,
            )));
        if is_cited || row.entry.is_background() {
            title = title.child(stamp(if is_cited { "cited" } else { "agent" }, accent));
        } else {
            title = title.child(div().w(px(0.)).flex_shrink_0());
        }
        let mut card = desk_card(format!("apparatus-source-{index}"), cx)
            .child(
                div()
                    .child(title)
                    .child(div().ml(px(8.8)).mt(px(1.6)).child(
                        crate::chrome::wrapping_tracked_text(
                            &row.entry.url,
                            theme::apparatus_mono_font(),
                            11.,
                            1.1,
                            p.ink_muted,
                            15.95,
                        ),
                    )),
            )
            .child(prose(
                self.formatted(row)
                    .map(|formatted| formatted.citation.as_str())
                    .unwrap_or("Formatting the saved source…"),
                14.,
                22.4,
                p.ink_light,
            ));
        if row.entry.is_background()
            && (row.entry.target.as_ref().is_some()
                || row.entry.background_query.as_ref().is_some())
        {
            let mut quote = div()
                .pl(px(9.6))
                .py(px(1.6))
                .border_l_2()
                .border_color(rgb(accent).opacity(0.7))
                .italic();
            if let Some(target) = row.entry.target.as_ref() {
                quote = quote.child(prose(
                    &format!(
                        "for: “{}” · {}",
                        clip_utf16(&target.anchor, 110),
                        kind_label(&target.kind).to_uppercase()
                    ),
                    13.,
                    19.5,
                    p.ink_muted,
                ));
            }
            if let Some(query) = row.entry.background_query.as_ref() {
                quote = quote.child(prose(
                    &format!("why: {}", clip_utf16(query, 100)),
                    13.,
                    19.5,
                    p.ink_muted,
                ));
            }
            card = card.child(quote);
        }
        let cite_pending = self.cite.as_ref().is_some_and(|request| request.source_index == index)
            || self.after_ack.as_ref().is_some_and(|after| matches!(after, AfterAck::Cited { source_index, .. } if *source_index == index));
        let id = row.entry.id.clone();
        let scope = row.entry.folio_id.clone();
        let cite = key(
            SharedString::from(format!("apparatus-cite-{index}")),
            if cite_pending {
                "placing…"
            } else if inserted(row) {
                "✓ footnoted"
            } else {
                "✎ cite in draft"
            },
            true,
            !self.capabilities.cite
                || !self.can_mutate()
                || inserted(row)
                || self.formatted(row).is_none(),
            cx,
        )
        .on_click(cx.listener(move |this, _, _, cx| {
            if this.same_row(index, &id, &scope) {
                this.request_citation(index, cx);
            }
        }));
        let id = row.entry.id.clone();
        let scope = row.entry.folio_id.clone();
        let open = key(
            SharedString::from(format!("apparatus-open-{index}")),
            "⌖ open",
            false,
            !self.capabilities.preview,
            cx,
        )
        .on_click(cx.listener(move |this, _, _, cx| this.open_source(&scope, index, &id, cx)));
        let id = row.entry.id.clone();
        let scope = row.entry.folio_id.clone();
        let remove = key(
            SharedString::from(format!("apparatus-drop-{index}")),
            "✕",
            false,
            !self.can_mutate(),
            cx,
        )
        .accessibility_label("Remove from the bibliography")
        .on_click(cx.listener(move |this, _, _, cx| this.drop_source(&scope, index, &id, cx)));
        card = card.child(card_foot(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(2.4))
                .ml(px(-7.2))
                .min_w_0()
                .child(cite)
                .child(open)
                .into_any_element(),
            div()
                .ml_auto()
                .mr(px(-7.2))
                .flex_shrink_0()
                .opacity(0.)
                .group_hover("apparatus-card", |style| style.opacity(1.))
                .child(remove)
                .into_any_element(),
            cx,
        ));
        card.into_any_element()
    }
    fn board_detected(
        &self,
        index: usize,
        row: &ApparatusDetectedCitation,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *theme::palette(cx);
        let accent = type_accent(&row.kind, &p);
        let mixed = mix_color(accent, p.ink, 0.45);
        let added = self
            .detections()
            .is_some_and(|state| state.added.contains(&row.id));
        let formatting = self
            .add
            .as_ref()
            .is_some_and(|request| request.detected.id == row.id);
        let expanded = self
            .detections()
            .is_some_and(|state| state.expanded_id.as_deref() == Some(row.id.as_str()));
        let mut title = div()
            .flex()
            .items_start()
            .gap(px(8.8))
            .child(type_text(
                &format!("№{:02}", index + 1),
                11.,
                16.5,
                p.ink_muted,
            ))
            .child(div().flex_1().min_w_0().child(display_text(
                type_label(&row.kind),
                15.,
                19.5,
                p.ink,
            )));
        if added {
            title = title.child(stamp("✓ in bib", p.success));
        }
        let mut card = desk_card(format!("apparatus-detected-{index}"), cx)
            .border_l(px(3.))
            .border_color(rgb(p.rule))
            .child(title)
            .child(mono(&row.text, 11., 15.95, p.ink));
        if expanded && let Some(metadata) = row.metadata.as_ref().and_then(Value::as_object) {
            let mut detail = div()
                .pl(px(9.6))
                .py(px(1.6))
                .border_l_2()
                .border_color(rgb(mixed).opacity(0.7))
                .flex()
                .flex_col()
                .gap(px(4.));
            for (name, value) in metadata {
                detail = detail.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_baseline()
                        .gap(px(4.))
                        .child(tracked(name, 11., 2.42, p.ink_muted))
                        .child(prose(&display_value(value), 13., 19.5, p.ink_muted)),
                );
            }
            card = card.child(detail);
        }
        let scope = self.active_folio_id.clone().unwrap_or_default();
        let surface = self.surface;
        let id = row.id.clone();
        let add = key(
            SharedString::from(format!("apparatus-add-{index}")),
            if formatting {
                "formatting…"
            } else if added {
                "✓ added"
            } else if self.capabilities.provider {
                "✦ add to bib"
            } else {
                "+ add to bib"
            },
            true,
            !self.can_mutate() || added,
            cx,
        )
        .on_click(cx.listener(move |this, _, _, cx| {
            if this.same_detection(&scope, surface, &id) {
                this.request_add_detected(&id, cx);
            }
        }));
        let mut left = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(2.4))
            .ml(px(-7.2))
            .min_w_0()
            .child(add);
        if let Some(url) = &row.lookup_url {
            let url = url.clone();
            let scope = self.active_folio_id.clone().unwrap_or_default();
            let id = row.id.clone();
            left = left.child(
                key(
                    SharedString::from(format!("apparatus-lookup-{index}")),
                    "look up ↗",
                    false,
                    !self.capabilities.preview,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.capabilities.preview && this.same_detection(&scope, surface, &id) {
                        cx.emit(ApparatusEvent::LookupRequested {
                            folio_id: scope.clone(),
                            detected_id: id.clone(),
                            url: url.clone(),
                        });
                    }
                })),
            );
        }
        let scope = self.active_folio_id.clone().unwrap_or_default();
        let id = row.id.clone();
        let details = key(
            SharedString::from(format!("apparatus-details-{index}")),
            if expanded { "▾" } else { "▸" },
            false,
            false,
            cx,
        )
        .accessibility_label(format!("Details for entry {}", index + 1))
        .on_click(cx.listener(move |this, _, _, cx| this.toggle_details(&scope, surface, &id, cx)));
        let scope = self.active_folio_id.clone().unwrap_or_default();
        let id = row.id.clone();
        let remove = key(
            SharedString::from(format!("apparatus-dismiss-{index}")),
            "✕",
            false,
            false,
            cx,
        )
        .accessibility_label(format!("Remove entry {}", index + 1))
        .on_click(cx.listener(move |this, _, _, cx| {
            if this.same_detection(&scope, surface, &id) {
                this.dismiss_detected(&id, cx);
            }
        }));
        div()
            .relative()
            .mx(px(12.))
            .mb(px(8.))
            .child(
                card.mx(px(0.)).mb(px(0.)).child(card_foot(
                    left.into_any_element(),
                    div()
                        .ml_auto()
                        .mr(px(-7.2))
                        .flex()
                        .flex_shrink_0()
                        .gap(px(1.6))
                        .opacity(0.)
                        .group_hover("apparatus-card", |style| style.opacity(1.))
                        .child(details)
                        .child(remove)
                        .into_any_element(),
                    cx,
                )),
            )
            .child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(px(3.))
                    .bg(rgb(accent)),
            )
            .into_any_element()
    }
    fn page(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let p = *theme::palette(cx);
        let mut page = div().max_w(px(1024.)).w_full().mx_auto().px(px(24.)).py(px(32.))
            .child(div().flex().items_center().justify_between().mb(px(24.))
                .child(div().flex_1().min_w_0().child(tracked("Twyne", 10., 3.2, p.ink_muted))
                    .child(div().mt(px(4.)).font_family(DISPLAY_FONT).font_weight(FontWeight::BOLD).text_size(px(28.)).line_height(relative(1.5)).child("The Apparatus"))
                    .child(div().mt(px(4.)).child(prose(if self.has_research() { "Background agents are reading your draft. Sources they discover land here automatically." }
                        else { "Your saved sources and citations detected in the manuscript." }, 14., 20., p.ink_light))))
                .child(paper_button("apparatus-page-back", "← Back to desk", cx).flex_shrink_1()
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(ApparatusEvent::BackToDesk)))))
            .child(div().mb(px(24.)).child(self.signal(true, cx)));
        if let Some(status) = self.status(cx) {
            page = page.child(status);
        }
        if let Some(issues) = self.issues(cx) {
            page = page.child(issues);
        }
        let entries = self
            .display
            .as_ref()
            .map(|display| display.bibliography.entries.as_slice())
            .unwrap_or_default();
        let mut background = div()
            .id("apparatus-page-agents")
            .test_support()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(8.))
            .child(display_text("Found by the agents", 16., 24., p.ink));
        let mut agent_card = div()
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(4.))
            .bg(rgb(p.paper));
        let agent_rows: Vec<_> = entries
            .iter()
            .filter(|row| row.entry.is_background())
            .collect();
        if agent_rows.is_empty() {
            agent_card = agent_card.child(empty_page(
                "✦",
                p.mustard,
                if self.has_research() {
                    "The agents are reading. Sources will appear as they're discovered."
                } else {
                    "No researched sources on file. Background research needs a provider."
                },
                cx,
            ));
        }
        for (index, row) in agent_rows.iter().enumerate() {
            agent_card = agent_card.child(self.page_source(row, index + 1 == agent_rows.len(), cx));
        }
        background = background.child(agent_card);
        let style = self
            .display
            .as_ref()
            .map(|display| display.settings.citation_style)
            .unwrap_or_default();
        let mut style_buttons = div()
            .id("apparatus-style")
            .test_support()
            .role(Role::Group)
            .aria_label("Citation style")
            .flex()
            .rounded(px(2.))
            .border_1()
            .border_color(rgb(p.rule))
            .overflow_hidden();
        for (value, label) in [
            (CitationStyle::Mla, "MLA"),
            (CitationStyle::Apa, "APA"),
            (CitationStyle::Chicago, "Chicago"),
        ] {
            let enabled = self.capabilities.persist
                && self.session.pending().is_none()
                && self.add.is_none()
                && self.cite.is_none()
                && self
                    .display
                    .as_ref()
                    .is_none_or(|display| display.settings.editable);
            let chosen = value == style;
            style_buttons = style_buttons.child(
                gpui_kit::base::Button::new(SharedString::from(format!(
                    "apparatus-style-{}",
                    value.as_str()
                )))
                .accessibility_label(label)
                .disabled(!enabled)
                .h_auto()
                .px(px(9.6))
                .py(px(3.2))
                .rounded_none()
                .bg(rgb(if chosen { p.vermilion } else { p.paper_soft }))
                .child(crate::chrome::tracked_text(
                    label,
                    gpui_kit::font(TYPEWRITER_FONT),
                    11.2,
                    1.12,
                    if chosen { p.paper } else { p.ink_light },
                    16.8,
                ))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.try_edit(ApparatusEdit::SetCitationStyle(value), cx)
                })),
            );
        }
        let mut writer = div()
            .id("apparatus-page-bibliography")
            .test_support()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(display_text("Your bibliography", 16., 24., p.ink))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(style_buttons)
                            .child(
                                text_key(
                                    "apparatus-copy-all",
                                    "Copy all",
                                    9.6,
                                    1.44,
                                    p.ink_muted,
                                    cx,
                                )
                                .disabled(
                                    !self.capabilities.copy
                                        || self.current_context().is_none()
                                        || self.copy.is_some()
                                        || entries.is_empty(),
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.request_copy_all(cx);
                                    },
                                )),
                            ),
                    ),
            );
        let mut writer_card = div()
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(4.))
            .bg(rgb(p.paper));
        let writer_rows: Vec<_> = entries
            .iter()
            .filter(|row| !row.entry.is_background())
            .collect();
        if writer_rows.is_empty() {
            writer_card = writer_card.child(empty_page(
                "✎",
                p.cobalt,
                if self.has_research() {
                    "Nothing you've saved yet. The agents will keep working in the background."
                } else {
                    "Nothing you've saved yet. Add a detected citation to keep it here."
                },
                cx,
            ));
        }
        for (index, row) in writer_rows.iter().enumerate() {
            writer_card =
                writer_card.child(self.page_source(row, index + 1 == writer_rows.len(), cx));
        }
        writer = writer
            .child(writer_card)
            .child(div().mt(px(8.)).child(display_text(
                "Detected in the manuscript",
                16.,
                24.,
                p.ink,
            )));
        let mut detected_card = div()
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(4.))
            .bg(rgb(p.paper));
        let detected = self
            .detections()
            .map(|state| state.rows.as_slice())
            .unwrap_or_default();
        if detected.is_empty() {
            let message = if self.scan.is_some() {
                "Scanning the saved manuscript…"
            } else if self.active_folio_id.is_some() {
                "No DOI / URL / ISBN / author-year citations detected yet — keep writing."
            } else {
                "No active folio to scan."
            };
            detected_card = detected_card.child(
                div()
                    .id("apparatus-page-detection-state")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(message)
                    .px(px(16.))
                    .py(px(32.))
                    .text_center()
                    .italic()
                    .child(prose(message, 12., 18., p.ink_muted)),
            );
        }
        for (index, row) in detected.iter().enumerate() {
            detected_card = detected_card.child(self.page_detected(
                index,
                row,
                index + 1 == detected.len(),
                cx,
            ));
        }
        writer = writer.child(detected_card);
        let wide = f32::from(window.viewport_size().width) >= 1024.;
        let mut grid = div().flex().items_start().gap(px(24.));
        if wide {
            grid = grid
                .child(
                    background.w(px((f32::from(window.viewport_size().width).min(1024.)
                        - 72.)
                        / 2.4)),
                )
                .child(writer.flex_1());
        } else {
            grid = grid
                .flex_col()
                .child(background.w_full())
                .child(writer.w_full());
        }
        // AccountKnowledge compact, anonymous branch. Its paragraph measure is
        // 65ch in the original typewriter face, rather than a bibliography card.
        let account_measure = window
            .text_system()
            .shape_line(
                "0".into(),
                px(12.8),
                &[TextRun {
                    len: 1,
                    font: gpui_kit::font(TYPEWRITER_FONT),
                    color: rgb(p.ink).into(),
                    ..Default::default()
                }],
                None,
            )
            .width
            * 65.;
        let mut account_link = gpui_kit::base::Button::new("apparatus-account-sources")
            .accessibility_label("Open account settings")
            .disabled(!self.capabilities.account_sources)
            .h_auto()
            .p_0()
            .opacity(if self.capabilities.account_sources {
                1.
            } else {
                0.6
            })
            .child(
                div()
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(12.8))
                    .line_height(relative(1.6))
                    .text_color(rgb(p.ink))
                    .underline()
                    .child("Open account settings"),
            )
            .on_click(cx.listener(|this, _, _, cx| {
                if this.capabilities.account_sources {
                    cx.emit(ApparatusEvent::AccountSourcesRequested);
                }
            }));
        if f32::from(window.viewport_size().width) <= 600. {
            account_link = account_link.min_h(px(44.)).px(px(3.2)).py(px(7.2));
        }
        page = page.child(grid).child(
            div()
                .id("apparatus-account-section")
                .test_support()
                .role(Role::Region)
                .aria_label("Account knowledge sources")
                .mt(px(24.))
                .child(
                    div()
                        .font_family(DISPLAY_FONT)
                        .text_size(px(16.))
                        .line_height(relative(1.6))
                        .text_color(rgb(p.ink))
                        .child("Account sources"),
                )
                .child(
                    div()
                        .max_w(account_measure)
                        .mt(px(6.4))
                        .mb(px(12.8))
                        .child(type_text(
                            "Choose what this draft can consult from your Not Organic account.",
                            12.8,
                            20.48,
                            p.ink,
                        )),
                )
                .child(
                    div()
                        .max_w(account_measure)
                        .mt(px(6.4))
                        .mb(px(12.8))
                        .flex()
                        .flex_wrap()
                        .items_baseline()
                        .gap_x(px(4.))
                        .child(type_text(
                            "Sign in with Not Organic to bring your account sources here.",
                            12.8,
                            20.48,
                            p.ink,
                        ))
                        .child(account_link),
                ),
        );
        div()
            .id("apparatus-page-scroll")
            .test_support()
            .size_full()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .child(page)
            .into_any_element()
    }
    fn page_source(
        &self,
        row: &RetainedBibEntry,
        last: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *theme::palette(cx);
        let index = row.index;
        let mut item = div()
            .id(SharedString::from(format!("apparatus-page-source-{index}")))
            .test_support()
            .group("apparatus-page-row")
            .px(px(16.))
            .py(px(13.6))
            .min_w_0();
        if !last {
            item = item.border_b_1().border_dashed().border_color(rgb(p.rule));
        }
        let cited = self.detections().is_some_and(|state| {
            state.rows.iter().any(|detected| {
                detected.lookup_url.as_ref().is_some_and(|url| {
                    url.trim_end_matches('/') == row.entry.url.trim_end_matches('/')
                })
            })
        });
        let mut title = div()
            .flex()
            .items_center()
            .flex_wrap()
            .gap(px(8.))
            .child(display_text(&row.entry.title, 14., 20., p.ink));
        if row.entry.is_background() {
            title = title.child(route_pill("agent", p.mustard));
        }
        if cited {
            title = title.child(route_pill("cited in draft", p.success));
        }
        item = item
            .child(if row.entry.is_background() {
                title.mb(px(4.))
            } else {
                title
            })
            .child(div().mt(px(2.)).child(crate::chrome::break_all_text(
                &row.entry.url,
                theme::apparatus_mono_font(),
                10.4,
                p.ink_muted,
                15.6,
            )))
            .child(
                div().mt(px(6.)).child(prose(
                    self.formatted(row)
                        .map(|f| f.citation.as_str())
                        .unwrap_or("Formatting the saved source…"),
                    12.,
                    20.,
                    p.ink_light,
                )),
            );
        if row.entry.is_background() {
            if let Some(target) = row.entry.target.as_ref() {
                let prefix = format!("for: “{}”", clip_utf16(&target.anchor, 100));
                let text = format!("{prefix} · {}", kind_label(&target.kind).to_uppercase());
                item = item.child(
                    div()
                        .mt(px(4.))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(9.6))
                        .line_height(relative(1.5))
                        .text_color(rgb(p.ink_muted))
                        .child(StyledText::new(text).with_highlights([(
                            0..prefix.len(),
                            HighlightStyle {
                                font_style: Some(FontStyle::Italic),
                                ..Default::default()
                            },
                        )])),
                );
            }
            if let Some(query) = row.entry.background_query.as_ref() {
                item = item.child(div().mt(px(4.)).italic().child(type_text(
                    &format!("why: {}", clip_utf16(query, 140)),
                    9.6,
                    14.4,
                    p.ink_muted,
                )));
            }
        }
        let mut actions = div()
            .mt(px(8.))
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .opacity(0.6)
            .group_hover("apparatus-page-row", |style| style.opacity(1.));
        if row.entry.is_background() {
            let id = row.entry.id.clone();
            let scope = row.entry.folio_id.clone();
            actions = actions.child(
                text_key(
                    SharedString::from(format!("apparatus-page-open-{index}")),
                    "⌖ open",
                    9.6,
                    1.44,
                    p.ink_muted,
                    cx,
                )
                .disabled(!self.capabilities.preview)
                .on_click(
                    cx.listener(move |this, _, _, cx| this.open_source(&scope, index, &id, cx)),
                ),
            );
        } else if self.capabilities.provider {
            let id = row.entry.id.clone();
            let scope = row.entry.folio_id.clone();
            actions = actions.child(
                text_key(
                    SharedString::from(format!("apparatus-summarize-{index}")),
                    "✦ summarize",
                    9.6,
                    1.44,
                    p.vermilion,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.capabilities.provider && this.same_row(index, &id, &scope) {
                        cx.emit(ApparatusEvent::SummarizeRequested {
                            folio_id: scope.clone(),
                            source_index: index,
                            source_id: id.clone(),
                        });
                    }
                })),
            );
        }
        let id = row.entry.id.clone();
        let scope = row.entry.folio_id.clone();
        actions = actions.child(
            text_key(
                SharedString::from(format!("apparatus-page-drop-{index}")),
                "✕ drop",
                9.6,
                1.44,
                p.vermilion,
                cx,
            )
            .disabled(!self.can_mutate())
            .on_click(cx.listener(move |this, _, _, cx| this.drop_source(&scope, index, &id, cx))),
        );
        item.child(actions).into_any_element()
    }
    fn page_detected(
        &self,
        index: usize,
        row: &ApparatusDetectedCitation,
        last: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *theme::palette(cx);
        let added = self
            .detections()
            .is_some_and(|state| state.added.contains(&row.id));
        let formatting = self
            .add
            .as_ref()
            .is_some_and(|request| request.detected.id == row.id);
        let mut item = div()
            .id(SharedString::from(format!(
                "apparatus-page-detected-{index}"
            )))
            .test_support()
            .px(px(16.))
            .py(px(13.6))
            .border_l(px(3.))
            .border_color(rgb(p.rule))
            .min_w_0();
        if !last {
            item = item.border_b_1().border_dashed();
        }
        item = item.child(mono(&row.text, 12., 18., p.ink));
        let mut meta = div()
            .mt(px(2.))
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .child(type_text(&row.kind, 9.6, 14.4, p.ink_muted));
        if let Some(url) = &row.lookup_url {
            let url = url.clone();
            let id = row.id.clone();
            let scope = self.active_folio_id.clone().unwrap_or_default();
            meta = meta.child(
                text_key(
                    SharedString::from(format!("apparatus-page-lookup-{index}")),
                    "look up ↗",
                    9.6,
                    0.,
                    p.ink_muted,
                    cx,
                )
                .disabled(!self.capabilities.preview)
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.capabilities.preview
                        && this.same_detection(&scope, ApparatusSurface::Page, &id)
                    {
                        cx.emit(ApparatusEvent::LookupRequested {
                            folio_id: scope.clone(),
                            detected_id: id.clone(),
                            url: url.clone(),
                        });
                    }
                })),
            );
        }
        if added {
            meta = meta.child(route_pill("✓ in bib", p.success));
        }
        let id = row.id.clone();
        let scope = self.active_folio_id.clone().unwrap_or_default();
        meta = meta.child(
            div().ml_auto().child(
                text_key(
                    SharedString::from(format!("apparatus-page-add-{index}")),
                    if formatting {
                        "formatting…"
                    } else if added {
                        "✓ added"
                    } else if self.capabilities.provider {
                        "✦ add to bib"
                    } else {
                        "+ add to bib"
                    },
                    9.6,
                    1.44,
                    p.vermilion,
                    cx,
                )
                .disabled(!self.can_mutate() || added)
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.same_detection(&scope, ApparatusSurface::Page, &id) {
                        this.request_add_detected(&id, cx);
                    }
                })),
            ),
        );
        item.child(meta).into_any_element()
    }
}
fn prose(text: &str, size: f32, height: f32, color: u32) -> AnyElement {
    div()
        .font_family(SERIF_FONT)
        .text_size(px(size))
        .line_height(relative(height / size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn display_text(text: &str, size: f32, height: f32, color: u32) -> AnyElement {
    div()
        .font_family(DISPLAY_FONT)
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(size))
        .line_height(relative(height / size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn mono(text: &str, size: f32, height: f32, color: u32) -> AnyElement {
    div()
        .font(theme::apparatus_mono_font())
        .text_size(px(size))
        .line_height(relative(height / size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn type_text(text: &str, size: f32, height: f32, color: u32) -> AnyElement {
    div()
        .font_family(TYPEWRITER_FONT)
        .text_size(px(size))
        .line_height(relative(height / size))
        .text_color(rgb(color))
        .child(text.to_owned())
        .into_any_element()
}
fn tracked(text: &str, size: f32, spacing: f32, color: u32) -> AnyElement {
    crate::chrome::tracked_typewriter(&text.to_uppercase(), size, spacing, color)
}
fn key(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    active: bool,
    disabled: bool,
    cx: &App,
) -> gpui_kit::base::Button {
    let p = *theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.to_owned())
        .disabled(disabled)
        .h_auto()
        .px(px(7.2))
        .py(px(3.2))
        .rounded(px(2.))
        .opacity(if disabled { 0.45 } else { 1. })
        .hover(|style| style.bg(rgb(p.vermilion).opacity(0.08)))
        .child(crate::chrome::tracked_text(
            &label.to_uppercase(),
            gpui_kit::font(TYPEWRITER_FONT),
            11.,
            1.54,
            if active { p.vermilion } else { p.ink_muted },
            14.3,
        ))
}
fn text_key(
    id: impl Into<gpui_kit::ElementId>,
    label: &str,
    size: f32,
    tracking: f32,
    color: u32,
    _: &App,
) -> gpui_kit::base::Button {
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.to_owned())
        .h_auto()
        .p_0()
        .child(tracked(label, size, tracking, color))
}
fn paper_button(
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
        .child(
            div()
                .font_family(DISPLAY_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .line_height(relative(10. / 7.))
                .child(label.to_owned()),
        )
}
fn desk_card(
    id: String,
    cx: &App,
) -> gpui_kit::base::ObservedElement<gpui_kit::Stateful<gpui_kit::Div>> {
    let p = *theme::palette(cx);
    div()
        .id(SharedString::from(id))
        .test_support()
        .group("apparatus-card")
        .mx(px(12.))
        .mb(px(8.))
        .px(px(14.4))
        .py(px(12.8))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(p.rule))
        .bg(rgb(p.paper))
        .flex()
        .flex_col()
        .gap(px(8.))
        .min_w_0()
        .hover(|style| style.border_color(rgb(p.vermilion)))
        .on_mouse_down(gpui_kit::MouseButton::Left, |_, _, cx| {
            cx.stop_propagation()
        })
}
fn card_foot(left: AnyElement, right: AnyElement, cx: &App) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .pt(px(8.))
        .border_t_1()
        .border_color(rgb(theme::palette(cx).rule).opacity(0.65))
        .child(left)
        .child(right)
        .into_any_element()
}
fn stamp(label: &str, color: u32) -> AnyElement {
    div()
        .mt(px(0.8))
        .px(px(5.6))
        .py(px(0.8))
        .border_1()
        .border_color(rgb(color).opacity(0.55))
        .rounded(px(2.))
        .flex_shrink_0()
        .child(tracked(label, 10., 1.4, color))
        .into_any_element()
}
fn route_pill(label: &str, color: u32) -> AnyElement {
    div()
        .px(px(7.2))
        .py(px(1.6))
        .border_1()
        .border_color(rgb(color))
        .rounded(px(2.))
        .child(tracked(label, 9.6, 0.96, color))
        .into_any_element()
}
fn empty_page(glyph: &str, color: u32, label: &str, cx: &App) -> AnyElement {
    div()
        .px(px(16.))
        .py(px(32.))
        .text_center()
        .child(display_text(glyph, 30., 36., color))
        .child(div().mt(px(8.)).italic().child(prose(
            label,
            12.,
            18.,
            theme::palette(cx).ink_muted,
        )))
        .into_any_element()
}
fn type_label(kind: &str) -> &str {
    match kind {
        "doi" => "DOI",
        "url" => "URL",
        "isbn" => "ISBN",
        "author-year" => "Author-Year",
        "footnote" => "Footnote",
        other => other,
    }
}
fn type_accent(kind: &str, p: &theme::Palette) -> u32 {
    match kind {
        "doi" => p.periwinkle,
        "url" => p.cobalt,
        "isbn" => p.sage,
        "author-year" => p.mustard,
        _ => p.ink_muted,
    }
}
fn kind_label(kind: &str) -> &str {
    match kind {
        "quote" => "Quote",
        "work" => "Film / book / work",
        "person" => "Person",
        "statistic" => "Statistic",
        "claim" => "Claim",
        "event" => "Event",
        _ => "Source",
    }
}
fn mix_color(a: u32, b: u32, amount: f32) -> u32 {
    [16, 8, 0].into_iter().fold(0, |out, shift| {
        out | ((((a >> shift) & 255) as f32 * amount + ((b >> shift) & 255) as f32 * (1. - amount))
            .round() as u32)
            << shift
    })
}
fn clip_utf16(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let units: Vec<u16> = text.encode_utf16().take(limit + 1).collect();
    let mut clipped = String::from_utf16_lossy(&units[..units.len().min(limit)]);
    if units.len() > limit {
        clipped.push('…');
    }
    clipped
}
fn display_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::apparatus::{ApparatusStore, parse_apparatus_json};
    use gpui_kit::{
        AnyWindowHandle, Bounds, ClipboardItem, Entity, Point, ScrollDelta, TestAppContext,
        WindowBounds, WindowOptions, size, test::TestWindowExt,
    };
    use std::sync::Mutex;
    use tempfile::TempDir;

    const SCOPE: &str = "original/path/folio:café";
    const FOREIGN: &str = "unmounted/foreign";
    struct Room {
        window: AnyWindowHandle,
        view: Entity<ApparatusView>,
        store: ApparatusStore,
        events: Arc<Mutex<Vec<ApparatusEvent>>>,
        _directory: TempDir,
    }
    fn fixture() -> ApparatusRecord {
        parse_apparatus_json(include_bytes!("../fixtures/apparatus/retained-native.json")).unwrap()
    }
    fn source() -> Value {
        serde_json::from_str(include_str!(
            "../fixtures/apparatus-view/source-presentation.json"
        ))
        .unwrap()
    }
    fn detected() -> Vec<ApparatusDetectedCitation> {
        serde_json::from_value(source()["detected"].clone()).unwrap()
    }
    fn context(record: &ApparatusRecord, style: CitationStyle) -> ApparatusViewContext {
        let reference = source();
        ApparatusViewContext {
            folio_id: SCOPE.into(),
            metadata_generation: record.generation,
            context_id: Uuid::new_v4(),
            formatted_rows: serde_json::from_value(reference["formatted"][style.as_str()].clone())
                .unwrap(),
            copy_all_text: reference["copyAll"][style.as_str()]
                .as_str()
                .unwrap()
                .into(),
            research: None,
        }
    }
    fn room(cx: &mut TestAppContext, surface: ApparatusSurface, width: f32) -> Room {
        let directory = tempfile::tempdir().unwrap();
        let store = ApparatusStore::open(directory.path()).unwrap();
        let record = fixture();
        std::fs::write(store.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        let projection = context(&record, CitationStyle::Chicago);
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
                        let mut view = ApparatusView::new(
                            Arc::new(record),
                            Some(SCOPE.into()),
                            ApparatusCapabilities::local(),
                            window,
                            cx,
                        );
                        view.set_context(projection, cx);
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
            cx.subscribe(&view, move |_, event: &ApparatusEvent, _| {
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
    fn reveal(window: &mut Window, id: &str, surface: ApparatusSurface, cx: &mut App) {
        let id = SharedString::from(id.to_owned());
        let scroll = if surface == ApparatusSurface::Board {
            "apparatus-scroll"
        } else {
            "apparatus-page-scroll"
        };
        for _ in 0..30 {
            window.render_frame(cx);
            let viewport = window.find(scroll).bounds();
            if window.try_find(id.clone()).is_some_and(|element| {
                element.visible()
                    && element.bounds().top() >= viewport.top()
                    && element.bounds().bottom() <= viewport.bottom()
            }) {
                return;
            }
            let delta = window.try_find(id.clone()).map_or(-180., |element| {
                if element.bounds().top() < viewport.top() {
                    180.
                } else {
                    -180.
                }
            });
            window.scroll(scroll, ScrollDelta::Pixels(point(px(0.), px(delta))), cx);
        }
        panic!("{id} must be reachable at 860px");
    }
    fn ack(room: &Room, window: &mut Window, cx: &mut App) -> ApparatusRequest {
        let request = room.view.read(cx).pending_request().unwrap().clone();
        let record = room.store.save_request(&request).unwrap();
        room.view.update(cx, |view, cx| {
            assert!(view.ack_saved(request.request_id, record.clone(), window, cx))
        });
        let style = record.display(SCOPE).unwrap().settings.citation_style;
        room.view.update(cx, |view, cx| {
            assert!(view.set_context(context(&record, style), cx))
        });
        window.render_frame(cx);
        request
    }
    fn seed_detections(room: &Room, window: &mut Window, cx: &mut App) {
        room.view.update(cx, |view, cx| {
            if view.surface() == ApparatusSurface::Page {
                let request = view.pending_scan().unwrap().clone();
                assert!(view.accept_scan(request.request_id, detected(), cx));
            } else {
                assert!(view.append_detected(SCOPE, &detected(), cx));
            }
        });
        window.render_frame(cx);
    }
    #[gpui_kit::test]
    fn real_scan_disclosure_dismissal_preserves_source_accumulation_rules(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Board, 496.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            let reference = source();
            let existing = serde_json::from_value::<Vec<ApparatusDetectedCitation>>(
                reference["boardAppend"]["existing"].clone(),
            )
            .unwrap();
            let incoming = serde_json::from_value::<Vec<ApparatusDetectedCitation>>(
                reference["boardAppend"]["incoming"].clone(),
            )
            .unwrap();
            room.view.update(cx, |view, cx| {
                view.append_detected(SCOPE, &existing, cx);
                view.append_detected(SCOPE, &incoming, cx);
            });
            assert_eq!(
                room.view
                    .read(cx)
                    .detected_rows(ApparatusSurface::Board)
                    .iter()
                    .map(|row| row.id.as_str())
                    .collect::<Vec<_>>(),
                reference["boardAppend"]["expectedIds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| id.as_str().unwrap())
                    .collect::<Vec<_>>()
            );
            room.view.update(cx, |view, cx| {
                view.append_detected(SCOPE, &detected()[2..], cx);
            });
            reveal(window, "apparatus-detected-3", ApparatusSurface::Board, cx);
            window.hover("apparatus-detected-3", cx);
            window.render_frame(cx);
            window.click("apparatus-details-3", cx);
            window.render_frame(cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .detections()
                    .unwrap()
                    .expanded_id
                    .as_deref(),
                Some(detected()[2].id.as_str())
            );
            reveal(window, "apparatus-detected-1", ApparatusSurface::Board, cx);
            window.hover("apparatus-detected-1", cx);
            window.render_frame(cx);
            window.click("apparatus-dismiss-1", cx);
            window.render_frame(cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .detected_rows(ApparatusSurface::Board)
                    .len(),
                2,
                "Source removes every same-ID detection"
            );
            reveal(window, "apparatus-rescan", ApparatusSurface::Board, cx);
            window.click("apparatus-rescan", cx);
            let scan = room.view.read(cx).pending_scan().unwrap().clone();
            room.view.update(cx, |view, cx| {
                assert!(view.accept_scan(scan.request_id, detected(), cx))
            });
            assert!(
                room.view
                    .read(cx)
                    .detected_rows(ApparatusSurface::Board)
                    .iter()
                    .any(|row| row.id == detected()[1].id)
            );
            assert_eq!(
                room.view.read(cx).saved_record().as_ref(),
                &fixture(),
                "Scanning/details/dismissal never persist metadata or marks"
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn actual_add_button_holds_builder_then_durable_retry_and_exact_ack(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Board, 496.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            seed_detections(&room, window, cx);
            reveal(window, "apparatus-add-0", ApparatusSurface::Board, cx);
            window.click("apparatus-add-0", cx);
            let preparation = room.view.read(cx).pending_add().unwrap().clone();
            room.view.update(cx, |view, cx| {
                assert!(view.report_add_error(
                    preparation.request_id,
                    "Fixture builder unavailable",
                    cx
                ))
            });
            window.render_frame(cx);
            window.click("apparatus-add-retry", cx);
            assert_eq!(
                room.view.read(cx).pending_add().unwrap().request_id,
                preparation.request_id
            );
            let built = ApparatusBuiltEntry {
                entry: source()["built"][0]["entry"].clone(),
                merge_target: None,
            };
            room.view.update(cx, |view, cx| {
                view.accept_add_detected(preparation.request_id, built, cx)
                    .unwrap();
            });
            let request = room.view.read(cx).pending_request().unwrap().clone();
            assert!(
                !room
                    .view
                    .read(cx)
                    .detections()
                    .unwrap()
                    .added
                    .contains(&preparation.detected.id)
            );
            assert_eq!(room.view.read(cx).saved_record().generation, 0);
            assert!(!room.view.update(cx, |view, cx| view.set_scope(
                Some(FOREIGN.into()),
                window,
                cx
            )));
            std::fs::create_dir(room.store.path().with_extension("json.bak")).unwrap();
            let error = room.store.save_request(&request).unwrap_err();
            room.view.update(cx, |view, cx| {
                assert!(view.report_error(request.request_id, error.to_string(), cx))
            });
            assert_eq!(room.store.load().unwrap().record.generation, 0);
            window.render_frame(cx);
            window.click("apparatus-retry", cx);
            assert_eq!(
                room.view.read(cx).pending_request().unwrap().request_id,
                request.request_id
            );
            std::fs::remove_dir(room.store.path().with_extension("json.bak")).unwrap();
            let committed = room.store.save_request(&request).unwrap();
            room.view.update(cx, |view, cx| {
                assert!(!view.ack_saved(Uuid::new_v4(), committed.clone(), window, cx));
                assert!(view.ack_saved(request.request_id, committed.clone(), window, cx));
                assert!(!view.ack_saved(request.request_id, committed.clone(), window, cx));
            });
            assert!(
                room.view
                    .read(cx)
                    .detections()
                    .unwrap()
                    .added
                    .contains(&preparation.detected.id)
            );
            assert_eq!(
                committed.bibliography,
                fixture().bibliography,
                "Raw imported rows/nulls/unknown/foreign data stay exact"
            );
            assert!(room.view.read(cx).pending_add().is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn real_drop_removes_only_scoped_metadata_and_preserves_opaque_rows(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Page, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            reveal(window, "apparatus-page-drop-1", ApparatusSurface::Page, cx);
            window.click("apparatus-page-drop-1", cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .display()
                    .unwrap()
                    .bibliography
                    .entries
                    .len(),
                2
            );
            ack(&room, window, cx);
            let view = room.view.read(cx);
            assert_eq!(view.display().unwrap().bibliography.entries.len(), 1);
            assert_eq!(
                view.saved_record()
                    .display(FOREIGN)
                    .unwrap()
                    .bibliography
                    .entries
                    .len(),
                2
            );
            assert_eq!(view.saved_record().bibliography, fixture().bibliography);
            assert_eq!(view.saved_record().settings, fixture().settings);
            assert_eq!(view.saved_record().extra, fixture().extra);
        })
        .unwrap();
        cx.run_until_parked();
        assert!(room.events.lock().unwrap().iter().any(|event| matches!(event, ApparatusEvent::Filed { effects, .. }
            if effects.iter().any(|effect| matches!(effect, ApparatusEffect::BibliographyChanged { folio_id } if folio_id == SCOPE)))));
    }
    #[gpui_kit::test]
    fn original_style_toggle_changes_only_global_style_after_durable_ack(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Page, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            window.click("apparatus-style-apa", cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .display()
                    .unwrap()
                    .settings
                    .citation_style,
                CitationStyle::Chicago
            );
            let candidate = room
                .view
                .read(cx)
                .pending_request()
                .unwrap()
                .candidate
                .clone();
            assert_eq!(
                candidate.display(SCOPE).unwrap().settings.citation_style,
                CitationStyle::Apa
            );
            assert_eq!(candidate.settings, fixture().settings);
            let mut expected = fixture().effective_settings().as_ref().unwrap().clone();
            expected["defaultCitationStyle"] = Value::String("apa".into());
            assert_eq!(candidate.effective_settings().as_ref(), Some(&expected));
            ack(&room, window, cx);
            assert_eq!(
                room.view
                    .read(cx)
                    .display()
                    .unwrap()
                    .settings
                    .citation_style,
                CitationStyle::Apa
            );
            assert_eq!(
                room.view
                    .read(cx)
                    .formatted(room.view.read(cx).entry(1).unwrap())
                    .unwrap()
                    .citation,
                source()["formatted"]["apa"][1]["citation"]
                    .as_str()
                    .unwrap()
            );
            assert_eq!(
                room.view.read(cx).saved_record().bibliography,
                fixture().bibliography
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn global_index_scope_and_real_clipboard_ack_prevent_false_copy_feedback(
        cx: &mut TestAppContext,
    ) {
        let room = room(cx, ApparatusSurface::Page, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            let view = room.view.read(cx);
            assert!(
                view.entry(2).is_none(),
                "Foreign duplicate ID never becomes the active entry"
            );
            assert_eq!(view.formatted(view.entry(0).unwrap()).unwrap().index, 0);
            window.click("apparatus-copy-all", cx);
            let request = room.view.read(cx).pending_copy().unwrap().clone();
            assert_eq!(
                request.text,
                source()["copyAll"]["chicago"].as_str().unwrap()
            );
            assert!(!request.text.contains("Foreign source"));
            assert!(room.view.read(cx).notice.is_none());
            cx.write_to_clipboard(ClipboardItem::new_string(request.text.clone()));
            room.view.update(cx, |view, cx| {
                assert!(!view.ack_copy(Uuid::new_v4(), Ok(()), cx));
                assert!(view.ack_copy(request.request_id, Ok(()), cx));
                assert!(!view.ack_copy(request.request_id, Ok(()), cx));
            });
            assert_eq!(room.view.read(cx).notice.as_deref(), Some("Copied."));
            let mut wrong = context(room.view.read(cx).saved_record(), CitationStyle::Chicago);
            wrong.formatted_rows.retain(|row| row.index != 0);
            room.view.update(cx, |view, cx| {
                view.set_context(wrong, cx);
            });
            assert!(
                room.view
                    .read(cx)
                    .formatted(room.view.read(cx).entry(0).unwrap())
                    .is_none(),
                "No same-ID fallback to the foreign formatter row"
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn confirmed_citation_stages_only_real_timestamp_and_waits_for_disk(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Board, 496.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            room.view.update(cx, |view, cx| {
                view.set_capabilities(
                    ApparatusCapabilities {
                        cite: true,
                        ..ApparatusCapabilities::local()
                    },
                    cx,
                )
            });
            window.render_frame(cx);
            reveal(window, "apparatus-cite-1", ApparatusSurface::Board, cx);
            window.click("apparatus-cite-1", cx);
            let held = room.view.read(cx).pending_citation().unwrap().clone();
            assert_eq!(
                held.raw_entry,
                fixture().display(SCOPE).unwrap().bibliography.entries[1].raw
            );
            room.view.update(cx, |view, cx| {
                view.ack_citation(
                    held.request_id,
                    Err("The researched passage changed. No footnote was inserted.".into()),
                    cx,
                )
                .unwrap();
            });
            assert!(room.view.read(cx).pending_request().is_none());
            room.view.update(cx, |view, cx| {
                view.request_citation(1, cx);
            });
            let held = room.view.read(cx).pending_citation().unwrap().clone();
            room.view.update(cx, |view, cx| {
                view.ack_citation(held.request_id, Ok(1770000000123.), cx)
                    .unwrap();
            });
            assert!(room.view.read(cx).pending_citation().is_none());
            let request = room.view.read(cx).pending_request().unwrap();
            let mut expected = held.raw_entry.clone();
            expected["citationInsertedAt"] = serde_json::json!(1770000000123.);
            assert_eq!(
                request
                    .candidate
                    .display(SCOPE)
                    .unwrap()
                    .bibliography
                    .entries[1]
                    .raw,
                expected
            );
            assert!(!inserted(room.view.read(cx).entry(1).unwrap()));
            ack(&room, window, cx);
            assert!(inserted(room.view.read(cx).entry(1).unwrap()));
            assert_eq!(
                room.view.read(cx).notice.as_deref(),
                Some("Footnote placed.")
            );
            room.view.update(cx, |view, cx| {
                view.set_surface(ApparatusSurface::Page, window, cx)
            });
            window.render_frame(cx);
            assert!(window.try_find("apparatus-cite-1").is_none());
            assert!(
                room.view
                    .update(cx, |view, cx| view.request_citation(1, cx))
                    .is_none()
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn retained_surface_and_scope_refuse_late_scan_builder_copy_tokens(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Board, 496.);
        cx.update_window(room.window, |_, window, cx| {
            seed_detections(&room, window, cx);
            let scan = room
                .view
                .update(cx, |view, cx| view.request_scan(cx))
                .unwrap();
            let copy = room
                .view
                .update(cx, |view, cx| view.request_copy_all(cx))
                .unwrap();
            let add = room
                .view
                .update(cx, |view, cx| {
                    view.request_add_detected(&detected()[0].id, cx)
                })
                .unwrap();
            room.view.update(cx, |view, cx| {
                assert!(view.set_scope(Some(FOREIGN.into()), window, cx));
                assert!(!view.accept_scan(scan.request_id, detected(), cx));
                assert!(!view.ack_copy(copy.request_id, Ok(()), cx));
                assert!(
                    view.accept_add_detected(
                        add.request_id,
                        ApparatusBuiltEntry {
                            entry: source()["built"][0]["entry"].clone(),
                            merge_target: None
                        },
                        cx
                    )
                    .unwrap()
                    .is_none()
                );
                assert!(!view.set_context(context(&fixture(), CitationStyle::Chicago), cx));
                assert!(view.set_scope(Some(SCOPE.into()), window, cx));
                assert_eq!(view.detected_rows(ApparatusSurface::Board).len(), 3);
                view.set_surface(ApparatusSurface::Page, window, cx);
                let page_scan = view.pending_scan().unwrap().clone();
                assert_eq!(page_scan.surface, ApparatusSurface::Page);
                assert!(view.accept_scan(page_scan.request_id, detected()[1..].to_vec(), cx));
                assert_eq!(view.detected_rows(ApparatusSurface::Page).len(), 2);
                view.set_surface(ApparatusSurface::Board, window, cx);
                assert_eq!(view.detected_rows(ApparatusSurface::Board).len(), 3);
                assert_eq!(view.saved_record().as_ref(), &fixture());
            });
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn original_monitor_spans_board_and_collapse_preserves_the_summary(cx: &mut TestAppContext) {
        let room = room(cx, ApparatusSurface::Board, 496.);
        cx.update_window(room.window, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            let root = window.find("apparatus-root").bounds();
            let signal = window.find("apparatus-signal").bounds();
            assert_eq!(signal.left(), root.left());
            assert_eq!(signal.right(), root.right());
            // Executed original .apparatus-monitor-card__head: disclosure36
            // + vertical padding14.4 + bottom rule1, without card margins.
            assert!((f32::from(signal.size.height) - 51.4).abs() <= 1.);
            let original_record = room.view.read(cx).saved_record().clone();
            let mut supplied = context(&original_record, CitationStyle::Chicago);
            supplied.research = Some(ApparatusResearchState {
                last_query: Some("Retained CaFÉ query".into()),
                progress: vec![ApparatusResearchTarget {
                    key: "accepted-target".into(),
                    kind: "claim".into(),
                    anchor: "Retained claim".into(),
                    status: "found".into(),
                    count: 1,
                    ..Default::default()
                }],
                ..Default::default()
            });
            room.view.update(cx, |view, cx| {
                assert!(view.set_context(supplied, cx));
            });
            window.render_frame(cx);
            let query = window.find("apparatus-signal-query").bounds();
            let head = window.find("apparatus-signal-head").bounds();
            assert!(query.top() >= head.bottom());
            let trace = window.find("apparatus-trace").bounds();
            assert_eq!(trace.left(), root.left());
            assert_eq!(trace.right(), root.right());
            window.click("apparatus-signal-toggle", cx);
            window.render_frame(cx);
            assert!(window.try_find("apparatus-signal-query").is_none());
            assert!(
                (f32::from(window.find("apparatus-signal").bounds().size.height) - 51.4).abs()
                    <= 1.
            );
            assert_eq!(
                room.view.read(cx).saved_record().as_ref(),
                original_record.as_ref()
            );
            assert!(room.view.read(cx).pending_request().is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn first_frame_and_resize_keep_original_page_grid_and_disabled_effects(
        cx: &mut TestAppContext,
    ) {
        let room = room(cx, ApparatusSurface::Page, 1280.);
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            let left = window.find("apparatus-page-agents").bounds();
            let right = window.find("apparatus-page-bibliography").bounds();
            assert!((f32::from(left.size.width) - 396.6667).abs() <= 1.);
            assert!((f32::from(right.left() - left.right()) - 24.).abs() <= 1.);
            assert!(window.try_find("apparatus-cite-1").is_none());
            assert_eq!(window.find("apparatus-page-open-1").disabled(), Some(true));
            assert_eq!(
                window.find("apparatus-account-sources").disabled(),
                Some(true)
            );
        })
        .unwrap();
        cx.simulate_window_resize(room.window, size(px(620.), px(860.)));
        cx.run_until_parked();
        cx.update_window(room.window, |_, window, cx| {
            window.render_frame(cx);
            let left = window.find("apparatus-page-agents").bounds();
            let right = window.find("apparatus-page-bibliography").bounds();
            assert_eq!(left.left(), right.left());
            assert!(right.top() > left.bottom());
            assert!((f32::from(left.size.width) - 572.).abs() <= 1.);
            assert_eq!(room.view.read(cx).saved_record().as_ref(), &fixture());
        })
        .unwrap();
    }
}
