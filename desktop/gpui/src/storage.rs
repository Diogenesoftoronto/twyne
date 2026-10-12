use crate::exchange::{
    MAX_BACKUP_BYTES, backup_for_document, export_typst_source, import_backup, import_typst,
    serialize_backup,
};
use crate::manuscript::timestamp;
use crate::manuscript::{MAX_DOCUMENT_BYTES, Manuscript};
use crate::source_session::SourceDraftRecord;
use crate::view_state::EditorViewPreferences;
use crate::workspace::{
    ContentFormat, ExtraFields, Folio, FolioContentSnapshot, ProjectionState, WorkspaceDocument,
};
use anyhow::{Context, Result, bail, ensure};
use directories::ProjectDirs;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tempfile::NamedTempFile;
use uuid::Uuid;

// JSON escaping can expand a bounded manuscript to six times its text size.
const MAX_FILE_BYTES: u64 = (MAX_BACKUP_BYTES * 8) as u64;

#[derive(Default, Debug, Serialize, Deserialize)]
pub struct Preferences {
    pub active: Option<Uuid>,
    #[serde(default, rename = "editorView")]
    pub editor_view: EditorViewPreferences,
}

pub struct Library {
    pub documents: Vec<Manuscript>,
    pub active: Option<Uuid>,
    pub warnings: Vec<String>,
    pub editor_view: EditorViewPreferences,
}

pub struct Store {
    root: PathBuf,
    // The OS releases this lock even after a crash. A second app cannot race
    // the first app's revision numbers or write the same library.
    _instance_lock: File,
    write_lock: Mutex<()>,
}

impl Store {
    pub fn default_root() -> Result<PathBuf> {
        if let Some(path) = std::env::var_os("TWYNE_GPUI_DATA_DIR") {
            ensure!(!path.is_empty(), "TWYNE_GPUI_DATA_DIR cannot be empty.");
            return Ok(PathBuf::from(path));
        }
        Ok(ProjectDirs::from("love", "twyne", "twyne-gpui")
            .context("Could not locate your application data folder.")?
            .data_local_dir()
            .to_path_buf())
    }

    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("manuscripts"))
            .with_context(|| format!("Could not create {}", root.display()))?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".instance.lock"))?;
        lock.try_lock_exclusive()
            .context("This Twyne library is already open in another window.")?;
        Ok(Self {
            root,
            _instance_lock: lock,
            write_lock: Mutex::new(()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn document_path(&self, id: Uuid) -> PathBuf {
        self.root.join("manuscripts").join(format!("{id}.json"))
    }

    pub fn load_source_draft(&self, id: Uuid) -> Result<SourceDraftRecord> {
        let path = self.root.join("source-drafts").join(format!("{id}.json"));
        if !path.is_file() {
            return Ok(SourceDraftRecord::default());
        }
        ensure!(
            fs::metadata(&path)?.len() <= MAX_FILE_BYTES,
            "Source recovery is too large."
        );
        let record: SourceDraftRecord = serde_json::from_slice(&fs::read(path)?)?;
        ensure!(
            record
                .draft
                .as_ref()
                .is_none_or(|draft| draft.folio_id == id),
            "Source recovery belongs to another folio."
        );
        Ok(record)
    }

    pub fn save_source_draft(&self, id: Uuid, record: &SourceDraftRecord) -> Result<()> {
        ensure!(
            record
                .draft
                .as_ref()
                .is_none_or(|draft| draft.folio_id == id),
            "Source recovery belongs to another folio."
        );
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The library writer stopped unexpectedly."))?;
        let previous = self.load_source_draft(id)?;
        if previous.generation > record.generation {
            return Ok(());
        }
        let directory = self.root.join("source-drafts");
        fs::create_dir_all(&directory)?;
        atomic_write(
            &directory.join(format!("{id}.json")),
            &serde_json::to_vec(record)?,
        )
    }

    pub fn load(&self) -> Result<Library> {
        let mut documents = Vec::new();
        let mut warnings = Vec::new();
        for entry in fs::read_dir(self.root.join("manuscripts"))? {
            let path = entry?.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            else {
                continue;
            };
            match read_document(&path, Some(id)) {
                Ok(document) => documents.push(document),
                Err(error) => match read_document(&path.with_extension("json.bak"), Some(id)) {
                    Ok(document) => {
                        warnings.push(format!("Recovered \"{}\" from its previous save. The damaged file is kept until you save this draft.", document.display_title()));
                        documents.push(document);
                    }
                    Err(_) => warnings.push(format!("Could not open {}: {error}. The file has been left in your library folder.", path.display())),
                },
            }
        }
        documents.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let preferences = match self.read_preferences() {
            Ok(preferences) => preferences,
            Err(error) => {
                warnings.push(format!("Could not restore the last open draft: {error}"));
                Preferences::default()
            }
        };
        let active = preferences
            .active
            .filter(|id| documents.iter().any(|doc| doc.id == *id && !doc.archived))
            .or_else(|| documents.iter().find(|doc| !doc.archived).map(|doc| doc.id));
        Ok(Library {
            documents,
            active,
            warnings,
            editor_view: preferences.editor_view,
        })
    }

    pub fn save(&self, document: &Manuscript) -> Result<()> {
        document.validate()?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The library writer stopped unexpectedly."))?;
        self.save_locked(document)
    }

    pub fn save_if_revision(&self, document: &Manuscript, expected_revision: u64) -> Result<()> {
        document.validate()?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The library writer stopped unexpectedly."))?;
        let path = self.document_path(document.id);
        let previous = read_document(&path, Some(document.id))
            .or_else(|_| read_document(&path.with_extension("json.bak"), Some(document.id)))?;
        ensure!(
            previous.revision == expected_revision,
            "The manuscript changed before this operation could be saved."
        );
        self.save_locked(document)
    }

    fn save_locked(&self, document: &Manuscript) -> Result<()> {
        let path = self.document_path(document.id);
        if path.exists() {
            if let Ok(previous) = read_document(&path, Some(document.id)) {
                // Background writes may finish in any order. An old snapshot
                // must never replace a newer revision (including an archive).
                if previous.revision > document.revision {
                    return Ok(());
                }
                atomic_write(
                    &path.with_extension("json.bak"),
                    &serde_json::to_vec_pretty(&previous)?,
                )?;
            } else {
                // Preserve a damaged primary while repairing it from recovery.
                let damaged = path.with_extension(format!("json.damaged-{}", Uuid::new_v4()));
                fs::copy(&path, damaged)?;
            }
        }
        atomic_write(&path, &serde_json::to_vec_pretty(document)?)
    }

    pub fn save_preferences(&self, active: Option<Uuid>) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The library writer stopped unexpectedly."))?;
        let mut preferences = self.read_preferences()?;
        preferences.active = active;
        atomic_write(
            &self.root.join("preferences.json"),
            &serde_json::to_vec(&preferences)?,
        )
    }

    pub fn save_editor_view(&self, editor_view: EditorViewPreferences) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The library writer stopped unexpectedly."))?;
        let mut preferences = self.read_preferences()?;
        preferences.editor_view = editor_view;
        atomic_write(
            &self.root.join("preferences.json"),
            &serde_json::to_vec(&preferences)?,
        )
    }

    fn read_preferences(&self) -> Result<Preferences> {
        let path = self.root.join("preferences.json");
        if !path.exists() {
            return Ok(Preferences::default());
        }
        Ok(serde_json::from_str(&read_bounded(&path, 16_384)?)?)
    }
}

fn read_bounded(path: &Path, limit: u64) -> Result<String> {
    let mut bytes = Vec::new();
    File::open(path)
        .with_context(|| format!("Could not read {}", path.display()))?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= limit,
        "The file exceeds the editing limit."
    );
    String::from_utf8(bytes)
        .context("This file is not UTF-8 text. Export it as UTF-8 before importing.")
}

fn read_document(path: &Path, expected_id: Option<Uuid>) -> Result<Manuscript> {
    let document: Manuscript = serde_json::from_str(&read_bounded(path, MAX_FILE_BYTES)?)?;
    document.validate()?;
    if let Some(id) = expected_id {
        ensure!(
            document.id == id,
            "The document ID does not match its filename."
        );
    }
    Ok(document)
}

/// Persist with a same-directory temporary file and atomic replacement, so a
/// partial write never becomes a manuscript. tempfile handles Windows too.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| e.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn export_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_write(path, bytes).with_context(|| format!("Could not export {}", path.display()))
}

pub fn import_file(path: &Path) -> Result<Manuscript> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "twyne" => Ok(read_document(path, None)?.import_copy()),
        "json" => {
            let bytes = read_bounded(path, MAX_BACKUP_BYTES as u64)?.into_bytes();
            let title = crate::exchange::parse_backup(&bytes)?
                .display_title()
                .to_owned();
            let now = timestamp();
            let destination = Folio::draft(Uuid::new_v4().to_string(), title, now);
            Manuscript::from_workspace(import_backup(
                &bytes,
                path.file_name().unwrap_or_default().to_string_lossy(),
                destination,
                now,
            )?)
        }
        "typ" => {
            let bytes = read_bounded(path, MAX_BACKUP_BYTES as u64)?.into_bytes();
            Manuscript::from_workspace(import_typst(
                &bytes,
                path.file_name().unwrap_or_default().to_string_lossy(),
                Uuid::new_v4().to_string(),
                timestamp(),
            )?)
        }
        "html" | "htm" => {
            let html = read_bounded(path, MAX_DOCUMENT_BYTES as u64)?;
            let now = timestamp();
            let folio = Folio::draft(
                Uuid::new_v4().to_string(),
                path.file_stem().unwrap_or_default().to_string_lossy(),
                now,
            );
            Manuscript::from_workspace(WorkspaceDocument {
                content: FolioContentSnapshot {
                    folio_id: folio.id.clone(),
                    html,
                    format: Some(ContentFormat::Html),
                    typst_source: None,
                    updated_at: now,
                    extra: ExtraFields::new(),
                },
                folio,
                brief: None,
                projection: ProjectionState::LegacyHtml,
                backup_template: None,
                provenance: None,
                extra: ExtraFields::new(),
            })
        }
        "md" | "markdown" | "txt" => {
            let mut document = Manuscript::new(
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Imported manuscript"),
            );
            // Text exchange preserves exact whitespace and Markdown. It never
            // overwrites the source file: importing makes a library copy.
            document.body = read_bounded(path, MAX_DOCUMENT_BYTES as u64)?;
            document.validate()?;
            Ok(document)
        }
        _ => bail!(
            "Choose a Twyne backup (.twyne.json), Typst (.typ), HTML, Markdown, text, or prototype (.twyne) file."
        ),
    }
}

pub fn export_file(document: &Manuscript, path: &Path) -> Result<()> {
    document.validate()?;
    let bytes = match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "twyne" => serde_json::to_vec_pretty(document)?,
        "json" => serialize_backup(&backup_for_document(document.workspace.as_deref().context("This prototype draft must be converted to a rich document before exporting a web backup.")?, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))?)?,
        "typ" => export_typst_source(document.workspace.as_deref().context("This draft does not have canonical Typst source yet.")?)?,
        "html" | "htm" => {
            let workspace = document.workspace.as_deref().context("This draft does not have an HTML projection yet.")?;
            ensure!(matches!(workspace.projection, ProjectionState::LegacyHtml | ProjectionState::Verified), "The current source needs a verified HTML projection before HTML export.");
            workspace.content.html.as_bytes().to_vec()
        }
        "md" | "markdown" | "txt" if document.workspace.is_none() => document.body.as_bytes().to_vec(),
        "md" | "markdown" | "txt" => bail!("Export this source-aware document as .typ or .twyne.json until its visual projection is ready."),
        _ => bail!(
            "Use .typ for canonical source, .twyne.json for a web backup, or .md/.txt/.twyne for a prototype draft."
        ),
    };
    atomic_write(path, &bytes).with_context(|| format!("Could not export {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manuscript::{Statistics, export_filename};
    use tempfile::tempdir;

    #[test]
    fn a_late_source_autosave_cannot_resurrect_a_discarded_draft() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let id = Uuid::new_v4();
        let mut session = crate::source_session::SourceSession::open(
            id,
            "Canonical",
            SourceDraftRecord::default(),
        );
        session.advance();
        let stale = session.capture("Unfinished (".into(), 1);
        store.save_source_draft(id, &stale).unwrap();
        let cleared = session.discard("Canonical", 2);
        store.save_source_draft(id, &cleared).unwrap();
        store.save_source_draft(id, &stale).unwrap();
        assert_eq!(store.load_source_draft(id).unwrap(), cleared);
        let other = Uuid::new_v4();
        assert!(store.save_source_draft(other, &stale).is_err());
    }

    #[test]
    fn delayed_dossier_filing_cannot_replace_a_newer_manuscript() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let mut document = Manuscript::new("A folio");
        document.body = "First edition".into();
        store.save(&document).unwrap();
        let mut filing = document.clone();
        filing.title = "A filed Dossier".into();
        filing.touch();
        document.body = "The newer text survives".into();
        document.touch();
        store.save(&document).unwrap();
        assert!(store.save_if_revision(&filing, 0).is_err());
        assert_eq!(store.load().unwrap().documents[0], document);
        filing.revision = document.revision + 1;
        store.save_if_revision(&filing, document.revision).unwrap();
        assert_eq!(store.load().unwrap().documents[0], filing);
    }

    #[test]
    fn view_preferences_and_active_folio_survive_independent_updates() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let document = Manuscript::new("The notebook");
        store.save(&document).unwrap();
        store.save_preferences(Some(document.id)).unwrap();
        let view = EditorViewPreferences {
            zen_mode: false,
            compositor_open: true,
        };
        store.save_editor_view(view).unwrap();
        store.save_preferences(Some(document.id)).unwrap();
        let restored = store.load().unwrap();
        assert_eq!(restored.active, Some(document.id));
        assert_eq!(restored.editor_view, view);
    }

    #[test]
    fn web_backup_import_survives_native_storage_and_export_without_source_or_metadata_loss() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("The notebook.twyne.json");
        let bytes = include_bytes!("../fixtures/exchange/web-v2-extended.twyne.json");
        fs::write(&path, bytes).unwrap();
        let document = import_file(&path).unwrap();
        let workspace = document.workspace.as_deref().unwrap();
        let original = crate::exchange::parse_backup(bytes).unwrap();
        assert_eq!(workspace.canonical_source(), original.canonical_source());
        assert_eq!(workspace.brief.as_ref(), original.brief.as_ref());
        let store = Store::open(directory.path().join("library")).unwrap();
        store.save(&document).unwrap();
        store.save_preferences(Some(document.id)).unwrap();
        let restored = store.load().unwrap().documents.remove(0);
        assert_eq!(restored, document);
        let destination = directory.path().join("Roundtrip.twyne.json");
        export_file(&restored, &destination).unwrap();
        let roundtrip = crate::exchange::parse_backup(&fs::read(destination).unwrap()).unwrap();
        assert_eq!(roundtrip.canonical_source(), original.canonical_source());
        assert_eq!(roundtrip.folios, original.folios);
        assert_eq!(roundtrip.brief, original.brief);
        assert_eq!(roundtrip.extra, original.extra);
        assert_eq!(roundtrip.content.extra, original.content.extra);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let copy = restored.duplicate();
        assert_ne!(copy.id, restored.id);
        let copy_workspace = copy.workspace.as_deref().unwrap();
        assert_eq!(copy_workspace.folio.id, copy.id.to_string());
        assert_eq!(copy_workspace.content.folio_id, copy_workspace.folio.id);
        assert_eq!(
            copy_workspace.canonical_source(),
            workspace.canonical_source()
        );
    }

    #[test]
    fn source_only_typst_remains_exact_after_import_reload_and_export() {
        let directory = tempdir().unwrap();
        let source =
            "\u{feff}// author's spacing\r\n#set text(font: \"Lora\")\r\n\r\n= 東京 and café\r\n";
        let path = directory.path().join("Original.typ");
        fs::write(&path, source).unwrap();
        let document = import_file(&path).unwrap();
        assert_eq!(
            document.workspace.as_deref().unwrap().projection,
            ProjectionState::Unavailable
        );
        let store = Store::open(directory.path().join("library")).unwrap();
        store.save(&document).unwrap();
        let restored = store.load().unwrap().documents.remove(0);
        let output = directory.path().join("Copy.typ");
        export_file(&restored, &output).unwrap();
        assert_eq!(fs::read(output).unwrap(), source.as_bytes());
        assert_eq!(fs::read(path).unwrap(), source.as_bytes());
    }

    #[test]
    fn saves_and_restores_unicode_and_preferences() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let mut document = Manuscript::new("L'été, 東京");
        document.body = "# A beginning\n\nCafé ☕\n\n".into();
        document.notes = "Remember this.".into();
        store.save(&document).unwrap();
        store.save_preferences(Some(document.id)).unwrap();
        let library = store.load().unwrap();
        assert_eq!(library.documents, vec![document.clone()]);
        assert_eq!(library.active, Some(document.id));
    }

    #[test]
    fn late_background_save_cannot_replace_a_newer_revision() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let stale = Manuscript::new("First");
        let mut current = stale.clone();
        current.body = "The newest words".into();
        current.touch();
        store.save(&current).unwrap();
        store.save(&stale).unwrap();
        assert_eq!(store.load().unwrap().documents, vec![current]);
    }

    #[test]
    fn second_instance_is_blocked_and_lock_releases_on_drop() {
        let directory = tempdir().unwrap();
        let first = Store::open(directory.path().into()).unwrap();
        assert!(Store::open(directory.path().into()).is_err());
        drop(first);
        assert!(Store::open(directory.path().into()).is_ok());
    }

    #[test]
    fn damaged_primary_recovers_backup_and_is_preserved_on_save() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let mut document = Manuscript::new("Recovery");
        document.body = "First save".into();
        store.save(&document).unwrap();
        let first = document.clone();
        document.body = "Second save".into();
        document.touch();
        store.save(&document).unwrap();
        fs::write(store.document_path(document.id), "broken JSON").unwrap();
        let library = store.load().unwrap();
        assert_eq!(library.documents, vec![first.clone()]);
        assert_eq!(library.warnings.len(), 1);
        store.save(&first).unwrap();
        assert!(
            fs::read_dir(directory.path().join("manuscripts"))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("damaged-"))
        );
    }

    #[test]
    fn unreadable_documents_are_preserved_without_hiding_healthy_drafts() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let document = Manuscript::new("Healthy");
        store.save(&document).unwrap();
        let damaged_path = store.document_path(Uuid::new_v4());
        fs::write(&damaged_path, "bad").unwrap();
        let library = store.load().unwrap();
        assert_eq!(library.documents, vec![document]);
        assert_eq!(library.warnings.len(), 1);
        assert_eq!(fs::read_to_string(damaged_path).unwrap(), "bad");
    }

    #[test]
    fn importing_a_native_file_creates_a_copy_instead_of_overwriting() {
        let directory = tempdir().unwrap();
        let document = Manuscript::new("Original");
        let path = directory.path().join("exchange.twyne");
        export_file(&document, &path).unwrap();
        let imported = import_file(&path).unwrap();
        assert_ne!(imported.id, document.id);
        assert_eq!(imported.title, document.title);
    }

    #[test]
    fn markdown_and_native_exchange_preserve_text_and_notes() {
        let directory = tempdir().unwrap();
        let mut document = Manuscript::new("A draft");
        document.body = "## 東京\r\n\r\n  A line with spaces.\n".into();
        document.notes = "Notebook".into();
        for extension in ["md", "txt", "twyne"] {
            let path = directory.path().join(format!("draft.{extension}"));
            export_file(&document, &path).unwrap();
            let imported = import_file(&path).unwrap();
            assert_eq!(imported.body, document.body);
            if extension == "twyne" {
                assert_eq!(imported.notes, document.notes);
            }
        }
    }

    #[test]
    fn unsupported_and_invalid_utf8_imports_do_not_create_documents() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("bad.txt");
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(import_file(&path).is_err());
        assert!(import_file(&directory.path().join("other.docx")).is_err());
    }

    #[test]
    fn future_formats_and_mismatched_ids_are_rejected() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let mut document = Manuscript::new("Future");
        document.version = 999;
        assert!(store.save(&document).is_err());
        document.version = 1;
        fs::write(
            store.document_path(Uuid::new_v4()),
            serde_json::to_vec(&document).unwrap(),
        )
        .unwrap();
        let library = store.load().unwrap();
        assert!(library.documents.is_empty());
        assert_eq!(library.warnings.len(), 1);
    }

    #[test]
    fn archived_documents_remain_recoverable_and_do_not_open_by_default() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().into()).unwrap();
        let mut document = Manuscript::new("Archived");
        document.archived = true;
        store.save(&document).unwrap();
        store.save_preferences(Some(document.id)).unwrap();
        let library = store.load().unwrap();
        assert_eq!(library.documents, vec![document]);
        assert_eq!(library.active, None);
    }

    #[test]
    fn statistics_and_filenames_handle_non_ascii_text() {
        let statistics = Statistics::for_body("Été 東京\n\nA second paragraph.\n\n");
        assert_eq!(statistics.words, 5);
        assert_eq!(statistics.paragraphs, 2);
        assert_eq!(statistics.reading_minutes, 1);
        assert_eq!(Statistics::for_body("").reading_minutes, 0);
        assert_eq!(export_filename(" ../A: file? "), "_A_ file_");
        assert_eq!(export_filename("..."), "Untitled manuscript");
        assert_eq!(export_filename("CON"), "_CON");
    }

    #[test]
    fn oversized_text_is_rejected_before_it_enters_the_library() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("large.md");
        fs::write(&path, "x".repeat(MAX_DOCUMENT_BYTES + 1)).unwrap();
        assert!(import_file(&path).is_err());
    }
}
