use super::*;
use gpui_kit::AnyElement;
use gpui_kit::component::ThemeMode;

pub(super) fn load_appearance(
    store: &Store,
) -> (Option<AppearanceStore>, AppearanceRecord, Vec<String>) {
    let loaded = AppearanceStore::open(store.root()).and_then(|store| {
        let loaded = store.load()?;
        Ok((store, loaded))
    });
    match loaded {
        Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
        Err(error) => (
            None,
            AppearanceRecord::default(),
            vec![format!(
                "Appearance preferences could not be opened: {error:#}"
            )],
        ),
    }
}

impl WritingRoom {
    pub(super) fn appearance_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = apply_preference(&self.appearance_preview, cx) {
            self.notice = Some(format!("Appearance could not be applied: {error:#}"));
        }
        self.source.update(cx, |state, cx| state.refresh(cx));
        if let Some(settings) = &self.settings_view {
            let dark = ThemeMode::from(cx.window_appearance()).is_dark();
            settings.update(cx, |view, cx| view.set_prefers_dark(dark, window, cx));
        }
        cx.notify();
    }

    pub(super) fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if self.settings_view.is_none() {
            let record = self.appearance_record.clone();
            let capabilities = AppearanceCapabilities {
                persist: self.appearance_store.is_some(),
            };
            let view = cx.new(|cx| {
                let mut view = SettingsView::new(record, capabilities, window, cx);
                view.set_embedded(true, cx);
                view
            });
            self.settings_subscription =
                Some(
                    cx.subscribe_in(&view, window, |this, _, event, window, cx| {
                        let SettingsEvent::AppearanceRequested(request) = event;
                        this.request_appearance(request.clone(), window, cx);
                    }),
                );
            self.settings_view = Some(view);
        }
        self.settings_route = true;
        self.retire_math_source_visit(cx);
        self.library_route = false;
        self.house_route = false;
        self.cast.route = None;
        self.rubric.route = false;
        self.apparatus.route = false;
        self.find_visible = false;
        self.source_go_to_line = false;
        self.new_folio_form = false;
        window.focus(
            &self
                .settings_view
                .as_ref()
                .unwrap()
                .read(cx)
                .focus_handle(cx),
            cx,
        );
        cx.notify();
    }

    fn request_appearance(
        &mut self,
        request: AppearanceRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(settings) = self.settings_view.clone() else {
            return;
        };
        if self.appearance_pending.is_some()
            || request.generation != self.appearance_record.generation
            || settings.read(cx).pending_request() != Some(&request)
        {
            return;
        }
        let Some(appearance) = self.appearance_store.clone() else {
            settings.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    "Appearance preferences could not be opened.",
                    cx,
                );
            });
            return;
        };
        if let Err(error) = apply_preference(&request.preference, cx) {
            settings.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    format!("Appearance could not be applied: {error:#}"),
                    cx,
                );
            });
            return;
        }
        self.appearance_preview = request.preference.clone();
        self.appearance_pending = Some(request.clone());
        self.source.update(cx, |state, cx| state.refresh(cx));
        // The library instance lock remains held for the entire detached write.
        let library = self.store.clone();
        let window_handle = self.window_handle;
        cx.spawn_in(window, async move |this, cx| {
            let request_id = request.request_id;
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _library_lock = library;
                    appearance.save(request.generation, request.preference, timestamp())
                })
                .await;
            let _ = cx.update_window(window_handle, |_, window, cx| {
                this.update(cx, |this, cx| {
                    if this
                        .appearance_pending
                        .as_ref()
                        .map(|pending| pending.request_id)
                        != Some(request_id)
                    {
                        return;
                    }
                    this.appearance_pending = None;
                    match result {
                        Ok(record) => {
                            let accepted = settings.update(cx, |view, cx| {
                                view.acknowledge_saved(request_id, record.clone(), window, cx)
                            });
                            if accepted {
                                this.appearance_record = record;
                            }
                        }
                        Err(error) => {
                            settings.update(cx, |view, cx| {
                                view.report_error(
                                    request_id,
                                    format!("Could not save appearance: {error:#}"),
                                    cx,
                                );
                            });
                        }
                    }
                    cx.notify();
                })
            });
        })
        .detach();
        cx.notify();
    }

    /// Closing is a freshness boundary. Waiting for the small preference writer
    /// also keeps a just-clicked palette choice durable during immediate quit.
    pub(super) fn flush_on_shutdown(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        self.flush(cx)?;
        if let Some(request) = self.appearance_pending.clone() {
            let appearance = self
                .appearance_store
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Appearance preferences could not be opened."))?;
            let loaded = appearance.load()?.record;
            let record = if Some(loaded.generation) == request.generation.checked_add(1)
                && loaded.preference == request.preference
            {
                loaded
            } else {
                appearance.save(request.generation, request.preference, timestamp())?
            };
            self.appearance_record = record;
            self.appearance_pending = None;
        }
        self.flush_house_on_shutdown(cx)?;
        self.flush_cast_on_shutdown(cx)?;
        self.flush_rubric_on_shutdown(cx)?;
        self.flush_apparatus_on_shutdown(cx)?;
        self.flush_marginalia_on_shutdown(cx)?;
        self.close_flow(cx)
    }

    pub(super) fn settings_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *palette(cx);
        div().id("settings-page").test_support().flex_1().min_h_0().w_full()
            .overflow_y_scroll().track_scroll(&self.settings_scroll)
            .bg(rgb(colors.paper_soft)).font_family(SERIF_FONT)
            .child(div().w_full().max_w(px(896.)).mx_auto().px(px(24.)).py(px(32.))
                .child(div().flex().items_center().justify_between().gap(px(16.)).mb(px(32.))
                    .child(div().min_w_0()
                        .child(div().mb(px(4.)).child(dept_label("Twyne", cx)))
                        .child(div().font_family(DISPLAY_FONT).font_weight(FontWeight::BOLD).text_size(px(28.)).line_height(px(42.)).child("The Editor’s Desk"))
                        .child(div().mt(px(4.)).text_size(px(14.)).line_height(px(20.)).text_color(rgb(colors.ink_light)).child("Bring your own key. Choose your models. Own the room.")))
                    .child(Button::new("settings-back").ghost().h_auto().flex_shrink_0()
                        .px(px(14.4)).py(px(7.2)).rounded(px(2.)).border_1()
                        .border_color(rgb(colors.rule)).bg(rgb(colors.paper_soft))
                        .accessibility_label("← Back to desk")
                        .child(div().font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(12.)).line_height(px(12. * 10. / 7.)).child("← Back to desk"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            if let (Some(dossier), Some(lifecycle)) =
                                (&this.dossier, &this.dossier_images)
                                && let Err(error) = dossier.update(cx, |view, cx| {
                                    view.resume_image_lifecycle(lifecycle, window, cx)
                                })
                            {
                                    this.error = Some(format!("Could not return to the Dossier: {error:#}"));
                                    cx.notify();
                                    return;
                            }
                            this.settings_route = false;
                            this.focus_writing(window, cx);
                            cx.notify();
                        }))))
                .when_some(self.settings_view.clone(), |this, view| this.child(view)))
            .into_any_element()
    }
}
