mod app;
#[cfg(feature = "ui-tests")]
mod capture_geometry;
mod proof;

use anyhow::{Context, Result};
use app::WritingRoom;
use gpui_kit::{AppContext, Bounds, TitlebarOptions, WindowBounds, WindowOptions, px, size};
use std::{path::PathBuf, sync::Arc};
use twyne_desktop::{
    assets, chrome,
    manuscript::Manuscript,
    storage::{Store, import_file},
    theme,
};

fn run() -> Result<()> {
    let mut data_dir = None;
    let mut paths = Vec::new();
    #[cfg(feature = "ui-tests")]
    let mut capture_state = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_size: Option<(u32, u32)> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_geometry: Option<PathBuf> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_geometry_watch = false;
    #[cfg(feature = "ui-tests")]
    let mut capture_comments: Option<PathBuf> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_comments_folio: Option<String> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_cast: Option<PathBuf> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_cast_folio: Option<String> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_rubric: Option<PathBuf> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_rubric_folio: Option<String> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_apparatus: Option<PathBuf> = None;
    #[cfg(feature = "ui-tests")]
    let mut capture_apparatus_folio: Option<String> = None;
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--version" {
            println!("Twyne GPUI {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        } else if argument == "--help" || argument == "-h" {
            println!(
                "Twyne GPUI desktop.\n\nUsage: twyne-desktop [--data-dir PATH] [FILE.twyne.json | FILE.typ | FILE.html | FILE.md | FILE.txt | FILE.twyne ...]\n\nFiles are imported as copies into your library.\nTWYNE_GPUI_DATA_DIR also overrides the library location."
            );
            return Ok(());
        } else if argument == "--data-dir" {
            data_dir = Some(PathBuf::from(
                arguments.next().context("--data-dir needs a path")?,
            ));
        } else if cfg!(feature = "ui-tests") && argument == "--capture-apparatus" {
            let value = PathBuf::from(
                arguments
                    .next()
                    .context("--capture-apparatus needs a fixture path")?,
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_apparatus = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-apparatus-folio" {
            let value = arguments
                .next()
                .context("--capture-apparatus-folio needs the reference fixture scope")?
                .to_string_lossy()
                .into_owned();
            #[cfg(feature = "ui-tests")]
            {
                capture_apparatus_folio = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-rubric" {
            let value = PathBuf::from(
                arguments
                    .next()
                    .context("--capture-rubric needs a fixture path")?,
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_rubric = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-rubric-folio" {
            let value = arguments
                .next()
                .context("--capture-rubric-folio needs the reference fixture scope")?
                .to_string_lossy()
                .into_owned();
            #[cfg(feature = "ui-tests")]
            {
                capture_rubric_folio = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-cast" {
            let value = PathBuf::from(
                arguments
                    .next()
                    .context("--capture-cast needs a fixture path")?,
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_cast = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-cast-folio" {
            let value = arguments
                .next()
                .context("--capture-cast-folio needs the reference fixture scope")?
                .to_string_lossy()
                .into_owned();
            #[cfg(feature = "ui-tests")]
            {
                capture_cast_folio = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-comments" {
            let value = PathBuf::from(
                arguments
                    .next()
                    .context("--capture-comments needs a fixture path")?,
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_comments = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-comments-folio" {
            let value = arguments
                .next()
                .context("--capture-comments-folio needs the reference folio ID")?
                .to_string_lossy()
                .into_owned();
            #[cfg(feature = "ui-tests")]
            {
                capture_comments_folio = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-size" {
            let value = arguments
                .next()
                .context("--capture-size needs WIDTHxHEIGHT")?;
            let (width, height) = twyne_desktop::launch_arguments::parse_capture_size(&value)?;
            #[cfg(feature = "ui-tests")]
            {
                capture_size = Some((width, height));
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-geometry-watch" {
            #[cfg(feature = "ui-tests")]
            {
                capture_geometry_watch = true;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-geometry" {
            let value = PathBuf::from(
                arguments
                    .next()
                    .context("--capture-geometry needs a JSON output path")?,
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_geometry = Some(value);
            }
            #[cfg(not(feature = "ui-tests"))]
            {
                let _ = value;
            }
        } else if cfg!(feature = "ui-tests") && argument == "--capture-state" {
            let value = arguments
                .next()
                .context("--capture-state needs a supported native fixture state")?;
            let value = value.to_string_lossy().into_owned();
            anyhow::ensure!(
                matches!(
                    value.as_str(),
                    "quiet"
                        | "writing"
                        | "slash"
                        | "slash-filtered"
                        | "slash-form"
                        | "slash-endnote"
                        | "slash-footnote"
                        | "slash-mermaid"
                        | "slash-math-inline"
                        | "slash-math-block"
                        | "desk"
                        | "drawer"
                        | "board"
                        | "source"
                        | "proof"
                        | "split"
                        | "dossier"
                        | "settings"
                        | "account"
                        | "account-error"
                        | "versions"
                        | "house"
                        | "library"
                        | "flow"
                        | "tools"
                        | "marginalia"
                        | "margin-thread"
                        | "margin-composer"
                        | "cast"
                        | "editors"
                        | "analysis"
                        | "rubric"
                        | "galley"
                        | "apparatus"
                        | "apparatus-page"
                        | "sentence-lab"
                        | "rhythm-strip"
                        | "claim-check"
                        | "reader-questions"
                ),
                "Unknown capture state"
            );
            #[cfg(feature = "ui-tests")]
            {
                capture_state = Some(value);
            }
        } else if argument.to_string_lossy().starts_with('-') {
            anyhow::bail!(
                "Unknown option {}. Use --help for usage.",
                argument.to_string_lossy()
            );
        } else {
            paths.push(PathBuf::from(argument));
        }
    }
    #[cfg(feature = "ui-tests")]
    anyhow::ensure!(
        capture_size.is_none() || capture_state.is_some(),
        "Capture size requires a capture state."
    );
    #[cfg(feature = "ui-tests")]
    anyhow::ensure!(
        capture_geometry.is_none() || capture_state.is_some(),
        "Geometry capture requires a capture state."
    );
    #[cfg(feature = "ui-tests")]
    anyhow::ensure!(
        !capture_geometry_watch || capture_geometry.is_some(),
        "Geometry watch requires a geometry output path."
    );
    #[cfg(feature = "ui-tests")]
    anyhow::ensure!(
        capture_cast.is_some() == capture_cast_folio.is_some(),
        "Cast fixtures require both --capture-cast and --capture-cast-folio."
    );
    #[cfg(feature = "ui-tests")]
    anyhow::ensure!(
        capture_rubric.is_some() == capture_rubric_folio.is_some(),
        "Rubric fixtures require both --capture-rubric and --capture-rubric-folio."
    );
    #[cfg(feature = "ui-tests")]
    {
        anyhow::ensure!(
            capture_apparatus.is_some() == capture_apparatus_folio.is_some(),
            "Apparatus fixtures require both --capture-apparatus and --capture-apparatus-folio."
        );
        anyhow::ensure!(
            capture_apparatus.is_none() || data_dir.is_some(),
            "Apparatus capture requires an explicit isolated --data-dir."
        );
    }
    let root = match data_dir {
        Some(path) => path,
        None => Store::default_root()?,
    };
    let store = Arc::new(Store::open(root)?);
    let mut library = store.load()?;
    for path in paths {
        match import_file(&path) {
            Ok(document) => {
                store.save(&document)?;
                library.active = Some(document.id);
                library.documents.insert(0, document);
            }
            Err(error) => library
                .warnings
                .push(format!("Could not import {}: {error:#}", path.display())),
        }
    }
    let first_run = library.active.is_none();
    if first_run {
        let document = Manuscript::new("Untitled folio");
        store.save(&document)?;
        library.active = Some(document.id);
        library.documents.insert(0, document);
    }
    #[cfg(feature = "ui-tests")]
    if let Some(path) = capture_comments {
        anyhow::ensure!(
            capture_state.is_some(),
            "Comment fixtures require a capture state."
        );
        let reference_folio =
            capture_comments_folio.context("Comment fixtures require --capture-comments-folio.")?;
        let active = library
            .documents
            .iter()
            .find(|document| Some(document.id) == library.active)
            .context("The captured folio is missing.")?;
        let native_folio = active.workspace.as_deref().map_or_else(
            || active.id.to_string(),
            |workspace| workspace.folio.id.clone(),
        );
        let value = serde_json::from_slice(&std::fs::read(path)?)?;
        let mut fixture = twyne_desktop::marginalia::MarginaliaRecord::from_value(&value)?;
        // An explicit fixture import follows the native folio copy's new ID.
        // Other folios in that source-backed fixture retain their exact scope.
        for comment in &mut fixture.comments {
            if comment.folio_id == reference_folio {
                comment.folio_id = native_folio.clone();
            }
        }
        if let Some(drafts) = fixture.reply_drafts.remove(&reference_folio) {
            fixture.reply_drafts.insert(native_folio, drafts);
        }
        let margins = twyne_desktop::marginalia::MarginaliaStore::open(store.root())?;
        let mut session = twyne_desktop::marginalia::MarginaliaSession::new(margins.load()?.record);
        let mut edits = fixture
            .comments
            .into_iter()
            .map(twyne_desktop::marginalia::MarginaliaEdit::Upsert)
            .collect::<Vec<_>>();
        edits.push(twyne_desktop::marginalia::MarginaliaEdit::ReplyDrafts(
            fixture.reply_drafts,
        ));
        if let Some(request) = session.request(
            twyne_desktop::marginalia::MarginaliaEdit::Batch(edits),
            twyne_desktop::manuscript::timestamp(),
        )? {
            margins.save_request(&request)?;
        }
    }
    #[cfg(feature = "ui-tests")]
    if let Some(path) = capture_cast {
        anyhow::ensure!(
            capture_state.is_some(),
            "Cast fixtures require a capture state."
        );
        let reference_scope =
            capture_cast_folio.context("Cast fixtures require --capture-cast-folio.")?;
        let active = library
            .documents
            .iter()
            .find(|document| Some(document.id) == library.active)
            .context("The captured folio is missing.")?;
        let native_scope = active.workspace.as_deref().map_or_else(
            || active.id.to_string(),
            |workspace| workspace.folio.id.clone(),
        );
        let mut fixture = twyne_desktop::cast::parse_cast_json(&std::fs::read(path)?)?;
        let artifacts = fixture
            .folios
            .remove(&reference_scope)
            .context("The requested Cast fixture scope is missing.")?;
        // This explicit UI-test fixture binding changes only the outer scope.
        // Raw note/reply/analysis row IDs and foreign metadata stay untouched.
        fixture.folios.insert(native_scope.clone(), artifacts);
        if let Some(drafts) = fixture.reply_drafts.remove(&reference_scope) {
            fixture.reply_drafts.insert(native_scope, drafts);
        }
        let casts = twyne_desktop::cast::CastStore::open(store.root())?;
        let base = casts.load()?.record;
        fixture.generation = base
            .generation
            .checked_add(1)
            .context("Cast fixture generation overflow.")?;
        casts.save_request(&twyne_desktop::cast::CastRequest {
            request_id: uuid::Uuid::new_v4(),
            expected_generation: base.generation,
            base,
            candidate: Arc::new(fixture),
            effects: Vec::new(),
        })?;
    }
    #[cfg(feature = "ui-tests")]
    if let Some(path) = capture_rubric {
        anyhow::ensure!(
            capture_state.is_some(),
            "Rubric fixtures require a capture state."
        );
        let reference_scope =
            capture_rubric_folio.context("Rubric fixtures require --capture-rubric-folio.")?;
        let active = library
            .documents
            .iter()
            .find(|document| Some(document.id) == library.active)
            .context("The captured folio is missing.")?;
        let native_scope = active.workspace.as_deref().map_or_else(
            || active.id.to_string(),
            |workspace| workspace.folio.id.clone(),
        );
        let mut fixture = twyne_desktop::rubric::parse_rubric_json(&std::fs::read(path)?)?;
        let artifacts = fixture
            .folios
            .remove(&reference_scope)
            .context("The requested Rubric fixture scope is missing.")?;
        // Bind only the explicit test envelope path. Original row folioId,
        // raw nullable/unknown fields, legacy and foreign scopes stay exact.
        fixture.folios.insert(native_scope, artifacts);
        let rubrics = twyne_desktop::rubric::RubricStore::open(store.root())?;
        let base = rubrics.load()?.record;
        fixture.generation = base
            .generation
            .checked_add(1)
            .context("Rubric fixture generation overflow.")?;
        rubrics.save_request(&twyne_desktop::rubric::RubricRequest {
            request_id: uuid::Uuid::new_v4(),
            expected_generation: base.generation,
            base,
            candidate: Arc::new(fixture),
            effects: Vec::new(),
        })?;
    }
    #[cfg(feature = "ui-tests")]
    if let Some(path) = capture_apparatus {
        anyhow::ensure!(
            capture_state.is_some(),
            "Apparatus fixtures require a capture state."
        );
        let reference_scope = capture_apparatus_folio
            .context("Apparatus fixtures require --capture-apparatus-folio.")?;
        let active = library
            .documents
            .iter()
            .find(|document| Some(document.id) == library.active)
            .context("The captured folio is missing.")?;
        let native_scope = active.workspace.as_deref().map_or_else(
            || active.id.to_string(),
            |workspace| workspace.folio.id.clone(),
        );
        let mut fixture = twyne_desktop::apparatus::parse_apparatus_json(&std::fs::read(path)?)?;
        // Only this explicit test-fixture copy follows the newly imported
        // native folio ID. Unscoped, foreign and alias rows stay exact; the
        // production host never guesses a scope or rewrites retained rows.
        for field in [&mut fixture.bibliography, &mut fixture.local_bibliography] {
            if let twyne_desktop::exchange::OptionalField::Value(serde_json::Value::Array(rows)) =
                field
            {
                for row in rows {
                    if row.get("folioId").and_then(serde_json::Value::as_str)
                        == Some(&reference_scope)
                    {
                        row.as_object_mut().unwrap().insert(
                            "folioId".into(),
                            serde_json::Value::String(native_scope.clone()),
                        );
                    }
                }
            }
        }
        let apparatus = twyne_desktop::apparatus::ApparatusStore::open(store.root())?;
        let base = apparatus.load()?.record;
        fixture.generation = base
            .generation
            .checked_add(1)
            .context("Apparatus fixture generation overflow.")?;
        apparatus.save_request(&twyne_desktop::apparatus::ApparatusRequest {
            request_id: uuid::Uuid::new_v4(),
            expected_generation: base.generation,
            base,
            candidate: Arc::new(fixture),
            effects: Vec::new(),
        })?;
    }
    gpui_kit::application()
        .with_assets(assets::TwyneAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            if let Err(error) = theme::apply(cx) {
                eprintln!("Could not load Twyne's fonts: {error:#}");
            }
            app::bind_keys(cx);
            twyne_desktop::dossier_view::init(cx);
            twyne_desktop::compositor::init(cx);
            twyne_desktop::marginalia_view::init(cx);
            twyne_desktop::cast_view::init(cx);
            #[cfg(feature = "ui-tests")]
            let (width, height) = capture_size.unwrap_or((1280, 860));
            #[cfg(not(feature = "ui-tests"))]
            let (width, height) = (1280_u32, 860_u32);
            let window_size = size(px(width as f32), px(height as f32));
            let bounds = Bounds::new(gpui_kit::point(px(80.), px(60.)), window_size);
            #[cfg(feature = "ui-tests")]
            let bounds = if capture_state.is_some() {
                Bounds::centered(None, window_size, cx)
            } else {
                bounds
            };
            let options = WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some("Twyne".into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                app_id: Some("love.twyne.gpui".into()),
                ..Default::default()
            };
            gpui_kit::open_window(options, cx, |window, cx| {
                let room = cx.new(|cx| {
                    let mut room = WritingRoom::new(store, library, window, cx);
                    let show_dossier = first_run;
                    #[cfg(feature = "ui-tests")]
                    let show_dossier = show_dossier && capture_state.is_none();
                    if show_dossier {
                        room.open_first_dossier(window, cx);
                    }
                    #[cfg(feature = "ui-tests")]
                    if let Some(state) = &capture_state {
                        room.set_capture_state(state, window, cx);
                    }
                    room
                });
                #[cfg(feature = "ui-tests")]
                if let Some(path) = capture_geometry {
                    capture_geometry::schedule(
                        window,
                        path,
                        6,
                        capture_geometry_watch,
                        room.downgrade(),
                    );
                }
                room
            })
            .expect("Could not open Twyne's native window");
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
        });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Twyne could not start: {error:#}");
        std::process::exit(1);
    }
}
