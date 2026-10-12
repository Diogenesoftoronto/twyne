use super::*;
use gpui_kit::AnyElement;
use twyne_desktop::{semantic_bridge::SemanticBridge, workspace::Folio};

#[derive(Clone, Copy)]
enum HouseSurface {
    Cabinet,
    Library,
}

pub(super) fn load_house(store: &Store) -> (Option<HouseStore>, Arc<HouseRecord>, Vec<String>) {
    match HouseStore::open(store.root()).and_then(|store| {
        let loaded = store.load()?;
        Ok((store, loaded))
    }) {
        Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
        Err(error) => (
            None,
            Arc::new(HouseRecord::default()),
            vec![format!("The House could not be opened: {error:#}")],
        ),
    }
}

// Native imported copies have their own folio identity. A web backup's catalog
// does not identify its active content: never guess an alias from that catalog.
fn folio_metadata(documents: &[Manuscript]) -> Vec<LibraryFolio> {
    documents
        .iter()
        .map(|document| {
            let mut folio = document.workspace.as_deref().map_or_else(
                || {
                    Folio::draft(
                        document.id.to_string(),
                        document.title.clone(),
                        document.created_at,
                    )
                },
                |workspace| workspace.folio.clone(),
            );
            folio.name.clone_from(&document.title);
            folio.updated_at = document.updated_at;
            LibraryFolio {
                native_id: document.id,
                folio_id: folio.id.clone(),
                folio,
                brief: document
                    .workspace
                    .as_deref()
                    .and_then(|workspace| workspace.brief.clone()),
                archived: document.archived,
                words: None,
                preview: None,
                source_only: document.workspace.as_deref().is_some_and(|workspace| {
                    !matches!(
                        workspace.projection,
                        ProjectionState::Verified | ProjectionState::LegacyHtml
                    )
                }),
            }
        })
        .collect()
}

struct PreparedLibrary {
    folios: Vec<LibraryFolio>,
    name_order: Vec<String>,
    warnings: Vec<String>,
}

fn prepare_library(documents: &[Manuscript]) -> PreparedLibrary {
    let mut folios = folio_metadata(documents);
    let mut warnings = Vec::new();
    let bridge = SemanticBridge::discover();
    for (folio, document) in folios.iter_mut().zip(documents) {
        if folio.source_only {
            continue;
        }
        let text = (|| {
            let bridge = bridge
                .as_ref()
                .map_err(|error| anyhow::anyhow!("{error:#}"))?;
            let html = match document.workspace.as_deref() {
                Some(workspace) => std::borrow::Cow::Borrowed(workspace.content.html.as_str()),
                None => std::borrow::Cow::Owned(bridge.from_markdown(&document.body)?.html),
            };
            bridge.library_card_text(&html)
        })();
        match text {
            Ok(text) => {
                folio.words = Some(text.words);
                folio.preview = Some(text.preview);
            }
            Err(error) => {
                folio.preview = Some("Writing preview unavailable".into());
                warnings.push(format!(
                    "The Library could not read {}: {error:#}",
                    document.display_title()
                ));
            }
        }
    }
    let names = folios
        .iter()
        .map(|folio| (folio.folio_id.clone(), folio.folio.name.clone()))
        .collect::<Vec<_>>();
    let name_order = match bridge.and_then(|bridge| bridge.order_folio_names(&names)) {
        Ok(order) => order.folio_ids,
        Err(error) => {
            warnings.push(format!(
                "The Library could not load locale name ordering: {error:#}"
            ));
            Vec::new()
        }
    };
    PreparedLibrary {
        folios,
        name_order,
        warnings,
    }
}

#[cfg(all(test, feature = "ui-tests"))]
pub(super) fn prepare_library_for_test(documents: &[Manuscript]) -> Vec<LibraryFolio> {
    prepare_library(documents).folios
}

/// The synchronous boundary can join an already-started background save. Only
/// a byte-equivalent complete candidate counts as the same completed request.
fn save_house(store: &HouseStore, request: &HouseRequest) -> anyhow::Result<Arc<HouseRecord>> {
    match store.save_request(request) {
        Ok(record) => Ok(record),
        Err(error) => match store.load() {
            Ok(loaded) if loaded.record == request.candidate => Ok(loaded.record),
            _ => Err(error),
        },
    }
}

impl WritingRoom {
    fn house_capabilities(&self) -> HouseCapabilities {
        HouseCapabilities {
            persist: self.house_store.is_some(),
            refine_dossier: true,
            ..HouseCapabilities::default()
        }
    }

    pub(super) fn standalone_route(&self) -> bool {
        self.house_route
            || self.library_route
            || self.settings_route
            || self.cast.route.is_some()
            || self.rubric.route
            || self.apparatus.route
    }

    pub(super) fn open_house(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        let folios = folio_metadata(&self.documents);
        if let Some(view) = &self.house_view {
            view.update(cx, |view, cx| {
                view.replace_record(self.house_record.clone(), window, cx);
                view.set_folios(folios, cx);
                view.set_active_folio(Some(self.active), cx);
            });
        } else {
            let record = self.house_record.clone();
            let capabilities = self.house_capabilities();
            let view = cx.new(|cx| HouseView::new(record, folios, capabilities, window, cx));
            view.update(cx, |view, cx| view.set_active_folio(Some(self.active), cx));
            self.house_subscription =
                Some(
                    cx.subscribe_in(&view, window, |this, _, event, window, cx| {
                        this.house_event(event, HouseSurface::Cabinet, window, cx);
                    }),
                );
            self.house_view = Some(view);
        }
        self.house_route = true;
        self.retire_math_source_visit(cx);
        self.library_route = false;
        self.settings_route = false;
        self.cast.route = None;
        self.rubric.route = false;
        self.apparatus.route = false;
        self.dossier = None;
        self.dossier_subscription = None;
        self.find_visible = false;
        self.new_folio_form = false;
        self.source_go_to_line = false;
        let folio_id = self.active_document().id.to_string();
        if let Some(view) = &self.house_view {
            view.update(cx, |view, cx| {
                view.set_selection(
                    twyne_desktop::house_view::HouseSelection::Folio(folio_id),
                    window,
                    cx,
                )
            });
        }
        window.focus(
            &self.house_view.as_ref().unwrap().read(cx).focus_handle(cx),
            cx,
        );
        cx.notify();
    }

    pub(super) fn open_library(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if self.library_view.is_none() {
            let record = self.house_record.clone();
            let capabilities = self.house_capabilities();
            let view = cx.new(|cx| LibraryView::new(record, Vec::new(), capabilities, window, cx));
            self.library_subscription =
                Some(
                    cx.subscribe_in(&view, window, |this, _, event, window, cx| {
                        this.house_event(event, HouseSurface::Library, window, cx);
                    }),
                );
            self.library_view = Some(view);
        }
        self.library_route = true;
        self.retire_math_source_visit(cx);
        self.house_route = false;
        self.settings_route = false;
        self.cast.route = None;
        self.rubric.route = false;
        self.apparatus.route = false;
        self.dossier = None;
        self.dossier_subscription = None;
        self.find_visible = false;
        self.new_folio_form = false;
        self.source_go_to_line = false;
        self.refresh_library(window, cx);
        window.focus(
            &self
                .library_view
                .as_ref()
                .unwrap()
                .read(cx)
                .focus_handle(cx),
            cx,
        );
        cx.notify();
    }

    fn refresh_library(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.library_generation = self.library_generation.saturating_add(1);
        let generation = self.library_generation;
        self.library_loading = true;
        let documents = self.documents.clone();
        self.library_task = Some(cx.spawn_in(window, async move |this, cx| {
            let prepared = cx
                .background_executor()
                .spawn(async move { prepare_library(&documents) })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.library_generation != generation {
                    return;
                }
                this.library_loading = false;
                #[cfg(feature = "ui-tests")]
                eprintln!("TWYNE_CAPTURE_LIBRARY_READY");
                if let Some(view) = &this.library_view {
                    view.update(cx, |view, cx| {
                        view.set_folios(prepared.folios, cx);
                        view.set_name_order(prepared.name_order, cx);
                        view.replace_record(this.house_record.clone(), cx);
                    });
                }
                if !prepared.warnings.is_empty() {
                    this.notice = Some(prepared.warnings.join("\n"));
                }
                cx.notify();
            });
        }));
    }

    fn house_event(
        &mut self,
        event: &HouseEvent,
        surface: HouseSurface,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let HouseEvent::SaveRequested(request) = event {
            self.request_house_save(request.clone(), window, cx);
            return;
        }
        let visible = match surface {
            HouseSurface::Cabinet => self.house_route,
            HouseSurface::Library => self.library_route,
        };
        if !visible {
            return;
        }
        match event {
            HouseEvent::HouseRequested => self.open_house(window, cx),
            HouseEvent::LibraryRequested => self.open_library(window, cx),
            HouseEvent::BackToDesk => {
                if self.flush_house(window, cx).is_ok() && self.flush(cx).is_ok() {
                    self.house_route = false;
                    self.library_route = false;
                    self.focus_writing(window, cx);
                    cx.notify();
                }
            }
            HouseEvent::OpenFolio(id) | HouseEvent::RefineDossier(id) => {
                if !self.documents.iter().any(|document| document.id == *id)
                    || self.flush_house(window, cx).is_err()
                    || self.flush(cx).is_err()
                {
                    return;
                }
                self.house_route = false;
                self.library_route = false;
                self.select(*id, window, cx);
                if matches!(event, HouseEvent::RefineDossier(_)) {
                    self.open_dossier(window, cx);
                } else {
                    self.focus_writing(window, cx);
                }
                cx.notify();
            }
            // These controls have no enabled capability until their native
            // exporters/Engine and route-specific filing are implemented.
            HouseEvent::SaveRequested(_)
            | HouseEvent::FolioArchiveRequested { .. }
            | HouseEvent::ExportRequested
            | HouseEvent::EngineRequested => {}
        }
    }

    fn request_house_save(
        &mut self,
        request: HouseRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self.house_view.clone() else {
            return;
        };
        if self.house_pending.is_some() || view.read(cx).pending_request() != Some(&request) {
            return;
        }
        let Some(store) = self.house_store.clone() else {
            view.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    "The House is unavailable on this device.",
                    cx,
                );
            });
            return;
        };
        self.house_pending = Some(request.clone());
        let keep_library_lock = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let saved_request = request.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _keep_library_lock = keep_library_lock;
                    save_house(&store, &saved_request)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.house_pending.as_ref() != Some(&request) {
                    return;
                }
                this.house_pending = None;
                match result {
                    Ok(record) => this.ack_house(request.request_id, record, window, cx),
                    Err(error) => view.update(cx, |view, cx| {
                        view.report_error(
                            request.request_id,
                            format!("Could not file this change: {error:#}"),
                            cx,
                        );
                    }),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn ack_house(
        &mut self,
        id: Uuid,
        record: Arc<HouseRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let accepted = self.house_view.as_ref().is_some_and(|view| {
            view.update(cx, |view, cx| {
                view.ack_saved(id, record.clone(), window, cx)
            })
        });
        if accepted {
            self.house_record = record.clone();
            if let Some(view) = &self.library_view {
                view.update(cx, |view, cx| {
                    view.replace_record(record, cx);
                });
            }
        }
    }

    pub(super) fn flush_house(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.house_view.clone() else {
            return Ok(());
        };
        let request = view.update(cx, |view, cx| view.prepare_pending_edits(cx))?;
        let Some(request) = request else {
            return Ok(());
        };
        let store = self
            .house_store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The House is unavailable on this device."))?;
        match save_house(store, &request) {
            Ok(record) => {
                self.house_pending = None;
                self.ack_house(request.request_id, record, window, cx);
                Ok(())
            }
            Err(error) => {
                self.house_pending = None;
                view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("Could not file this change: {error:#}"),
                        cx,
                    );
                });
                Err(error)
            }
        }
    }

    pub(super) fn flush_house_on_shutdown(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        let Some(view) = self.house_view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        let store = self
            .house_store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The House is unavailable on this device."))?;
        match save_house(store, &request) {
            Ok(record) => {
                self.house_record = record;
                Ok(())
            }
            Err(error) => {
                view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("Could not file before closing: {error:#}"),
                        cx,
                    );
                });
                Err(error)
            }
        }
    }

    pub(super) fn house_page(&self, cx: &Context<Self>) -> AnyElement {
        div()
            .id("native-house")
            .test_support()
            .size_full()
            .min_h_0()
            .when_some(self.house_view.clone(), |page, view| page.child(view))
            .bg(rgb(palette(cx).paper_soft))
            .into_any_element()
    }

    pub(super) fn library_page(&self, cx: &Context<Self>) -> AnyElement {
        div()
            .id("native-library")
            .test_support()
            .size_full()
            .min_h_0()
            .bg(rgb(palette(cx).paper_soft))
            .when(self.library_loading, |page| {
                page.child(
                    div()
                        .p(px(32.))
                        .font_family(SERIF_FONT)
                        .text_size(px(14.))
                        .child("Opening the Library…"),
                )
            })
            .when(!self.library_loading, |page| {
                page.when_some(self.library_view.clone(), |page, view| page.child(view))
            })
            .into_any_element()
    }
}
