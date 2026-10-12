//! Writer-owned templates and per-folio material. The library Store retains
//! the OS lock; clones serialize these metadata writes and verify readback.
use super::{
    notebook::{empty_notebook, normalize_notebook},
    saved::{decode_saved_tools, normalize_saved_tool},
    seed::ToolKind,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;
const MAX_SAVED: usize = 24;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u8,
    generation: u64,
    saved_tools: Vec<Value>,
    notebooks: BTreeMap<String, Value>,
}
impl Default for Record {
    fn default() -> Self {
        Self {
            version: 1,
            generation: 0,
            saved_tools: Vec::new(),
            notebooks: BTreeMap::new(),
        }
    }
}
#[derive(Clone)]
pub struct ToolStore {
    path: PathBuf,
    writer: Arc<Mutex<()>>,
}
#[derive(Clone)]
pub struct ToolWriteAck {
    pub generation: u64,
    pub saved_tools: Vec<Value>,
    pub saved_id: Option<String>,
}
impl ToolStore {
    pub fn open(library_root: &Path) -> Result<Self> {
        ensure!(library_root.is_dir(), "The writing library is unavailable.");
        let store = Self {
            path: library_root.join("writing-tools.json"),
            writer: Arc::new(Mutex::new(())),
        };
        store.read()?;
        Ok(store)
    }
    pub fn load_saved(&self) -> Result<ToolWriteAck> {
        let _writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The writing tools save was interrupted."))?;
        let record = self.read()?;
        Ok(ToolWriteAck {
            generation: record.generation,
            saved_tools: decode_saved_tools(&json!(record.saved_tools))?,
            saved_id: None,
        })
    }
    pub fn load_notebook(&self, folio: &str) -> Result<Value> {
        if folio.is_empty() {
            return Ok(empty_notebook());
        }
        let _writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The writing tools save was interrupted."))?;
        let record = self.read()?;
        Ok(normalize_notebook(
            record.notebooks.get(folio).unwrap_or(&Value::Null),
        ))
    }
    pub fn keep(&self, kind: ToolKind, name: &str, config: Value) -> Result<ToolWriteAck> {
        let _writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The writing tools save was interrupted."))?;
        let mut record = self.read()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let saved = normalize_saved_tool(&json!({"id":format!("tool-{}",Uuid::new_v4()),"kind":kind.id(),"name":name,"config":config,"savedAt":u64::try_from(now)?}))?.context("The writing tool could not be kept.")?;
        let id = saved["id"]
            .as_str()
            .context("The saved tool has no identity.")?
            .to_owned();
        let mut saved_tools = decode_saved_tools(&json!(record.saved_tools))?;
        saved_tools.insert(0, saved);
        saved_tools.truncate(MAX_SAVED);
        record.saved_tools = saved_tools;
        self.write(&mut record)?;
        Ok(Self::ack(record, Some(id)))
    }
    pub fn remove(&self, id: &str) -> Result<ToolWriteAck> {
        let _writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The writing tools save was interrupted."))?;
        let mut record = self.read()?;
        record.saved_tools = decode_saved_tools(&json!(record.saved_tools))?
            .into_iter()
            .filter(|tool| tool["id"].as_str() != Some(id))
            .collect();
        self.write(&mut record)?;
        Ok(Self::ack(record, None))
    }
    pub fn jot(&self, folio: &str, text: &str) -> Result<ToolWriteAck> {
        ensure!(!folio.is_empty(), "No folio selected");
        let _writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The writing tools save was interrupted."))?;
        let mut record = self.read()?;
        let mut notebook = normalize_notebook(record.notebooks.get(folio).unwrap_or(&Value::Null));
        notebook["scraps"]
            .as_array_mut()
            .context("The notebook has no scraps list.")?
            .push(json!({"id":format!("scrap-{}",Uuid::new_v4()),"text":text}));
        record.notebooks.insert(folio.to_owned(), notebook.clone());
        self.write(&mut record)?;
        // Source checks the normalized notebook, not just a successful I/O call.
        ensure!(
            normalize_notebook(self.read()?.notebooks.get(folio).unwrap_or(&Value::Null))
                == notebook,
            "Local save failed"
        );
        Ok(Self::ack(record, None))
    }
    fn ack(record: Record, saved_id: Option<String>) -> ToolWriteAck {
        ToolWriteAck {
            generation: record.generation,
            saved_tools: record.saved_tools,
            saved_id,
        }
    }
    fn read(&self) -> Result<Record> {
        if !self.path.exists() {
            return Ok(Record::default());
        }
        let mut bytes = Vec::new();
        File::open(&self.path)?
            .take(MAX_METADATA_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() <= MAX_METADATA_BYTES,
            "Writing tools metadata is too large to open."
        );
        let record: Record = serde_json::from_slice(&bytes)
            .context("Writing tools could not be read. The saved file is preserved.")?;
        ensure!(
            record.version == 1,
            "This writing tools file needs a newer Twyne version."
        );
        Ok(record)
    }
    fn write(&self, record: &mut Record) -> Result<()> {
        record.generation = record
            .generation
            .checked_add(1)
            .context("The writing tools save generation is exhausted.")?;
        let bytes = serde_json::to_vec_pretty(record)?;
        ensure!(
            bytes.len() <= MAX_METADATA_BYTES,
            "Writing tools metadata is too large to save. The previous file is preserved."
        );
        let parent = self
            .path
            .parent()
            .context("The writing library has no folder.")?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary.persist(&self.path).map_err(|error| error.error)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        ensure!(self.read()? == *record, "Writing tools did not persist");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kept_templates_travel_without_writer_text_and_survive_reopen() {
        let library = tempfile::tempdir().unwrap();
        let store = ToolStore::open(library.path()).unwrap();
        let ack = store
            .keep(
                ToolKind::RhythmStrip,
                "  My rhythm  ",
                json!({"targetMin":8,"targetMax":28,"sentence":"private draft"}),
            )
            .unwrap();
        assert_eq!(ack.saved_tools[0]["name"], "My rhythm");
        assert!(ack.saved_tools[0]["config"].get("sentence").is_none());
        let reopened = ToolStore::open(library.path()).unwrap();
        assert_eq!(reopened.load_saved().unwrap().saved_tools, ack.saved_tools);
        reopened.remove(ack.saved_id.as_deref().unwrap()).unwrap();
        assert!(reopened.load_saved().unwrap().saved_tools.is_empty());
    }
    #[test]
    fn concurrent_jots_are_serialized_and_acknowledged_only_after_readback() {
        let library = tempfile::tempdir().unwrap();
        let store = ToolStore::open(library.path()).unwrap();
        std::thread::scope(|scope| {
            for index in 0..12 {
                let store = store.clone();
                scope.spawn(move || {
                    store
                        .jot("folio-one", &format!("Question {index}?"))
                        .unwrap();
                });
            }
        });
        let notebook = store.load_notebook("folio-one").unwrap();
        assert_eq!(notebook["scraps"].as_array().unwrap().len(), 12);
        assert_eq!(store.load_notebook("folio-two").unwrap(), empty_notebook());
        let reopened = ToolStore::open(library.path()).unwrap();
        assert_eq!(reopened.load_notebook("folio-one").unwrap(), notebook);
    }
    #[test]
    fn damaged_storage_refuses_a_write_without_discarding_the_existing_file() {
        let library = tempfile::tempdir().unwrap();
        let store = ToolStore::open(library.path()).unwrap();
        std::fs::write(&store.path, b"held damaged material").unwrap();
        assert!(store.jot("folio", "Question?").is_err());
        assert_eq!(
            std::fs::read(&store.path).unwrap(),
            b"held damaged material"
        );
        assert!(ToolStore::open(library.path()).is_err());
    }
}
