use super::*;
use twyne_desktop::editor::{BlockObject, Command, ImageAttributes, RichEditor};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ImageFileRequest {
    request_id: Uuid,
    folio: Uuid,
    visit: u64,
    folio_revision: u64,
    editor: gpui_kit::EntityId,
    revision: u64,
    selection: Selection,
}

impl WritingRoom {
    pub(super) fn compositor_capabilities(&self) -> CompositorCapabilities {
        CompositorCapabilities {
            save_pdf: true,
            find: true,
            image_file: self.image_request.is_none(),
            margin_notes: self.marginalia.store.is_some()
                && self.margin.preflight.is_none()
                && self.rich.is_some()
                && !self.active_document().archived
                && !self.applying_source,
            version_history: self.revision_store.is_some(),
            ..Default::default()
        }
    }

    fn image_target(&self, selection: Selection, cx: &App) -> Option<ImageFileRequest> {
        if self.library_route
            || self.settings_route
            || self.house_route
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
        if view.is_read_only() || view.selection() != selection {
            return None;
        }
        Some(ImageFileRequest {
            request_id: Uuid::new_v4(),
            folio: self.active,
            visit: self.revision_generation,
            folio_revision: self.active_document().revision,
            editor: editor.entity_id(),
            revision: view.revision(),
            selection,
        })
    }

    fn image_target_is_current(&self, target: ImageFileRequest, cx: &App) -> bool {
        self.image_target(target.selection, cx)
            .is_some_and(|current| {
                current.folio == target.folio
                    && current.visit == target.visit
                    && current.folio_revision == target.folio_revision
                    && current.editor == target.editor
                    && current.revision == target.revision
            })
    }

    pub(super) fn refresh_image_capabilities(&mut self, cx: &mut Context<Self>) {
        let capabilities = self.compositor_capabilities();
        if let Some(view) = &self.compositor {
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        }
    }

    pub(super) fn choose_image_file(
        &mut self,
        selection: Selection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.image_request.is_some() {
            return;
        }
        let Some(target) = self.image_target(selection, cx) else {
            return;
        };
        self.image_request = Some(target);
        self.refresh_image_capabilities(cx);
        let mut snapshot = self.snapshot(cx);
        // A cloned shared tree is captured at the explicit file boundary. The
        // expensive conversion runs off the input thread and publishes no edit.
        snapshot.rich = self.rich.as_ref().map(|view| view.read(cx).snapshot());
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Insert a PNG, JPEG, GIF, or WebP image".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let path = match picker.await {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                Ok(Ok(None)) => None,
                result => {
                    let _ = cx.update(|window, cx| {
                        this.update(cx, |this, cx| {
                            this.finish_image_file(
                                target,
                                Err(anyhow::anyhow!(
                                    "Could not open the image picker: {result:?}"
                                )),
                                window,
                                cx,
                            );
                        })
                    });
                    return;
                }
            };
            let result = if let Some(path) = path {
                Some(
                    cx.background_executor()
                        .spawn(async move {
                            let image = twyne_desktop::image_import::load_image_file(&path)?;
                            let rich = snapshot.rich.take().ok_or_else(|| {
                                anyhow::anyhow!("The insertion point is no longer available.")
                            })?;
                            let mut candidate = RichEditor::new(rich);
                            candidate.set_selection(target.selection)?;
                            candidate
                                .execute(Command::InsertBlock(BlockObject::Image(image.clone())))?;
                            snapshot.rich = Some(candidate.document().clone());
                            // The original Typst converter has its own source
                            // limit. A valid upload must also fit that contract
                            // before it enters live text, history or autosave.
                            snapshot.materialize()?;
                            anyhow::Ok(image)
                        })
                        .await,
                )
            } else {
                None
            };
            let _ = cx.update(|window, cx| {
                this.update(cx, |this, cx| {
                    if let Some(result) = result {
                        this.finish_image_file(target, result, window, cx);
                    } else if this.image_request == Some(target) {
                        this.image_request = None;
                        this.refresh_image_capabilities(cx);
                        cx.notify();
                    }
                })
            });
        })
        .detach();
        cx.notify();
    }

    fn finish_image_file(
        &mut self,
        target: ImageFileRequest,
        result: anyhow::Result<ImageAttributes>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.image_request != Some(target) {
            return;
        }
        self.image_request = None;
        self.refresh_image_capabilities(cx);
        if !self.image_target_is_current(target, cx) {
            self.notice = Some("The insertion point changed while the image was opening. Choose the image again at the new position.".into());
            cx.notify();
            return;
        }
        match result {
            Ok(image) => {
                if let Some(view) = &self.compositor {
                    view.update(cx, |view, cx| view.insert_image(image, window, cx));
                }
            }
            Err(error) => {
                self.notice = Some(format!("Could not insert this image: {error:#}"));
            }
        }
        cx.notify();
    }
}
