//! Offline Appearance preferences. This file is separate from manuscript data
//! and account/provider settings; a saved record is an actual durable write.

use crate::{
    theme::{self, ThemePreference},
    workspace::ExtraFields,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const FORMAT: &str = "twyne-gpui-appearance";
const VERSION: u64 = 1;
pub const MAX_APPEARANCE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AppearanceRecord {
    pub generation: u64,
    pub updated_at: u64,
    pub preference: ThemePreference,
    /// Compatible future native-envelope fields survive saves.
    pub extra: ExtraFields,
    // Compatible future preference fields are retained but never applied.
    preference_extra: Map<String, Value>,
    custom_extra: Map<String, Value>,
}
impl AppearanceRecord {
    pub fn to_value(&self) -> Value {
        let mut preference = self.preference_extra.clone();
        preference.insert("preset".into(), json!(self.preference.preset.id()));
        let mut custom = self.custom_extra.clone();
        custom.extend(
            self.preference
                .custom
                .iter()
                .map(|(id, value)| (id.clone(), json!(value))),
        );
        if custom.is_empty() {
            preference.remove("custom");
        } else {
            preference.insert("custom".into(), Value::Object(custom));
        }
        let mut value: Map<String, Value> = self.extra.clone().into_iter().collect();
        value.extend([
            ("format".into(), json!(FORMAT)),
            ("version".into(), json!(VERSION)),
            ("generation".into(), json!(self.generation)),
            ("updatedAt".into(), json!(self.updated_at)),
            ("preference".into(), Value::Object(preference)),
        ]);
        Value::Object(value)
    }
    pub fn from_value(value: &Value) -> Result<Self> {
        let Some(raw) = value.as_object() else {
            return Ok(Self::default());
        };
        let native = raw.contains_key("format");
        if native {
            ensure!(
                raw.get("format").and_then(Value::as_str) == Some(FORMAT),
                "This file is not a native Twyne appearance preference."
            );
            ensure!(
                raw.get("version").and_then(Value::as_u64) == Some(VERSION),
                "These appearance preferences need another version of Twyne."
            );
        }
        let generation = if native {
            raw.get("generation")
                .and_then(Value::as_u64)
                .context("Appearance preferences have no valid save generation.")?
        } else {
            0
        };
        let updated_at = if native {
            raw.get("updatedAt").and_then(Value::as_u64).unwrap_or(0)
        } else {
            0
        };
        let preference_value = if native {
            raw.get("preference").unwrap_or(&Value::Null)
        } else {
            value
        };
        let preference = theme::normalize_preference(preference_value);
        let preference_extra = preference_value
            .as_object()
            .into_iter()
            .flat_map(|raw| raw.iter())
            .filter(|(id, _)| !matches!(id.as_str(), "preset" | "custom"))
            .map(|(id, value)| (id.clone(), value.clone()))
            .collect();
        let custom_extra = preference_value
            .get("custom")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|custom| custom.iter())
            .filter(|(id, _)| {
                !theme::THEME_TOKENS
                    .iter()
                    .any(|token| token.id == id.as_str())
            })
            .map(|(id, value)| (id.clone(), value.clone()))
            .collect();
        let extra = if native {
            raw.iter()
                .filter(|(id, _)| {
                    !matches!(
                        id.as_str(),
                        "format" | "version" | "generation" | "updatedAt" | "preference"
                    )
                })
                .map(|(id, value)| (id.clone(), value.clone()))
                .collect()
        } else {
            ExtraFields::new()
        };
        Ok(Self {
            generation,
            updated_at,
            preference,
            extra,
            preference_extra,
            custom_extra,
        })
    }
}

#[derive(Clone, Debug)]
pub struct AppearanceLoad {
    pub record: AppearanceRecord,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AppearanceRequest {
    pub request_id: Uuid,
    pub generation: u64,
    pub preference: ThemePreference,
}

#[derive(Clone)]
pub struct AppearanceStore {
    state: Arc<StoreState>,
}
struct StoreState {
    path: PathBuf,
    writer: Mutex<()>,
}

impl AppearanceStore {
    /// Share this handle within the application whose Store holds the library
    /// instance lock. It never opens another library or connects to an account.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)
            .context("Could not create the application preferences folder.")?;
        Ok(Self {
            state: Arc::new(StoreState {
                path: root.join("appearance.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.state.path
    }
    pub fn load(&self) -> Result<AppearanceLoad> {
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The appearance writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<AppearanceLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            if backup.exists() {
                return Ok(AppearanceLoad {
                    record: read_record(&backup)?,
                    warnings: vec![
                        "Recovered appearance from its previous save. The recovery file is kept."
                            .into(),
                    ],
                });
            }
            return Ok(AppearanceLoad {
                record: AppearanceRecord::default(),
                warnings: Vec::new(),
            });
        }
        match read_record(self.path()) {
            Ok(record) => Ok(AppearanceLoad {
                record,
                warnings: Vec::new(),
            }),
            Err(error) => {
                // A readable future format/version belongs to another writer;
                // an older backup must not authorize replacing that record.
                let bytes = read_bounded(self.path())?;
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    return Ok(AppearanceLoad { record: read_record(&backup).with_context(|| format!("Could not recover appearance preferences: {error}"))?,
                        warnings: vec!["Recovered appearance from its previous save. The damaged file is kept until another appearance is saved.".into()] });
                }
                // Invalid JSON has the same rendering fallback as the web
                // bootstrap, while retaining the damaged bytes for recovery.
                Ok(AppearanceLoad { record: AppearanceRecord::default(), warnings: vec!["Could not read appearance preferences. Editorial is shown; the damaged file has been kept.".into()] })
            }
        }
    }
    pub fn save(
        &self,
        expected_generation: u64,
        preference: ThemePreference,
        now: u64,
    ) -> Result<AppearanceRecord> {
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The appearance writer stopped unexpectedly."))?;
        let mut record = self.load_locked()?.record;
        ensure!(
            record.generation == expected_generation,
            "Appearance changed before this choice could be saved."
        );
        record.generation = record
            .generation
            .checked_add(1)
            .context("Appearance has exhausted its save generation.")?;
        record.updated_at = now;
        record.preference = theme::normalize_preference(&serde_json::to_value(preference)?);
        let bytes = serde_json::to_vec(&record.to_value())?;
        ensure!(
            bytes.len() <= MAX_APPEARANCE_BYTES,
            "Appearance preferences exceed the 1 MiB limit. The previous preferences were kept."
        );
        if self.path().exists() {
            match read_record(self.path()) {
                Ok(previous) => atomic_write(
                    &self.path().with_extension("json.bak"),
                    &serde_json::to_vec(&previous.to_value())?,
                )?,
                Err(_) => {
                    fs::copy(
                        self.path(),
                        self.path()
                            .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                    )?;
                }
            }
        }
        atomic_write(self.path(), &bytes).context("Could not save appearance on this device.")?;
        Ok(record)
    }
}
fn read_record(path: &Path) -> Result<AppearanceRecord> {
    AppearanceRecord::from_value(&serde_json::from_slice(&read_bounded(path)?)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_APPEARANCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_APPEARANCE_BYTES,
        "Appearance preferences are too large to open safely."
    );
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .context("Appearance preferences have no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::ThemePreset;
    use std::collections::BTreeMap;
    #[test]
    fn native_appearance_matches_executed_web_helper_fixtures() {
        let reference: Value =
            serde_json::from_str(include_str!("../fixtures/settings/web-reference.json")).unwrap();
        assert_eq!(
            serde_json::to_value(ThemePreference::default()).unwrap(),
            reference["default"]
        );
        assert_eq!(
            theme::WCAG_AA_CONTRAST,
            reference["wcagAA"].as_f64().unwrap()
        );
        for case in reference["normalization"].as_array().unwrap() {
            assert_eq!(
                serde_json::to_value(theme::normalize_preference(&case["input"])).unwrap(),
                case["expected"],
                "{}",
                case["input"]
            );
        }
        for case in reference["resolved"].as_array().unwrap() {
            let preference = theme::normalize_preference(&case["preference"]);
            let dark = case["prefersDark"].as_bool().unwrap();
            assert_eq!(
                serde_json::to_value(theme::resolved_token_values(&preference, dark)).unwrap(),
                case["tokens"]
            );
            assert!(
                (theme::theme_contrast(&preference, dark) - case["contrast"].as_f64().unwrap())
                    .abs()
                    < 1e-12
            );
        }
        for (token, expected) in theme::THEME_TOKENS
            .iter()
            .zip(reference["tokens"].as_array().unwrap())
        {
            assert_eq!(
                json!({"id":token.id,"cssVar":token.css_var,"label":token.label,"description":token.description}),
                *expected
            );
        }
        for (preset, expected) in ThemePreset::APPEARANCE_ORDER
            .iter()
            .take(4)
            .zip(reference["presets"].as_array().unwrap())
        {
            assert_eq!(preset.id(), expected["id"].as_str().unwrap());
            assert_eq!(preset.label(), expected["label"].as_str().unwrap());
            assert_eq!(
                preset.description(),
                expected["description"].as_str().unwrap()
            );
        }
    }
    #[test]
    fn editorial_default_and_system_choice_survive_offline_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        assert_eq!(
            store.load().unwrap().record.preference.preset,
            ThemePreset::Editorial
        );
        let saved = store
            .save(
                0,
                ThemePreference {
                    preset: ThemePreset::System,
                    ..Default::default()
                },
                123,
            )
            .unwrap();
        assert_eq!(saved.generation, 1);
        let reopened = AppearanceStore::open(directory.path())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(reopened, saved);
        assert_eq!(
            reopened.preference.preset.resolve(true),
            ThemePreset::Nightpress
        );
        assert_eq!(
            reopened.preference.preset.resolve(false),
            ThemePreset::Editorial
        );
    }
    #[test]
    fn unknown_compatible_fields_are_retained_without_being_applied() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        fs::write(store.path(), serde_json::to_vec(&json!({"format":FORMAT,"version":VERSION,"generation":4,
            "updatedAt":10,"futureNative":{"keep":[1,2]},"preference":{"preset":"foolscap", "futurePreference":true,
                "custom":{"paper":"#ABC","futureToken":{"untouched":"value"},"ink":"url(evil)"}}})).unwrap()).unwrap();
        let record = store.load().unwrap().record;
        assert_eq!(
            record.preference.custom,
            BTreeMap::from([("paper".into(), "#aabbcc".into())])
        );
        let saved = store
            .save(
                4,
                ThemePreference {
                    preset: ThemePreset::Nightpress,
                    custom: record.preference.custom,
                },
                20,
            )
            .unwrap();
        let raw = saved.to_value();
        assert_eq!(raw["futureNative"], json!({"keep":[1,2]}));
        assert_eq!(raw["preference"]["futurePreference"], true);
        assert_eq!(
            raw["preference"]["custom"]["futureToken"],
            json!({"untouched":"value"})
        );
        assert!(raw["preference"]["custom"].get("ink").is_none());
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn stale_appearance_write_is_rejected_and_previous_choice_stays_saved() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        let saved = store
            .save(
                0,
                ThemePreference {
                    preset: ThemePreset::Foolscap,
                    ..Default::default()
                },
                1,
            )
            .unwrap();
        assert!(store.save(0, ThemePreference::default(), 2).is_err());
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn interrupted_appearance_recovers_backup_and_retains_damaged_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        let before = store
            .save(
                0,
                ThemePreference {
                    preset: ThemePreset::Foolscap,
                    ..Default::default()
                },
                1,
            )
            .unwrap();
        store
            .save(
                1,
                ThemePreference {
                    preset: ThemePreset::System,
                    ..Default::default()
                },
                2,
            )
            .unwrap();
        fs::write(store.path(), b"interrupted write").unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(recovered.record, before);
        assert_eq!(recovered.warnings.len(), 1);
        assert_eq!(fs::read(store.path()).unwrap(), b"interrupted write");
        store.save(1, ThemePreference::default(), 3).unwrap();
        assert!(fs::read_dir(directory.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".damaged-")
        }));
    }
    #[test]
    fn legacy_web_shape_normalizes_and_future_native_version_is_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        fs::write(
            store.path(),
            br##"{"preset":"editorial","custom":{"paper":"#ABC"},"future":"kept"}"##,
        )
        .unwrap();
        let record = store.load().unwrap().record;
        let saved = store.save(0, record.preference, 1).unwrap();
        assert_eq!(saved.to_value()["preference"]["future"], "kept");
        assert!(store.path().with_extension("json.bak").exists());
        let future = serde_json::to_vec(
            &json!({"format":FORMAT,"version":2,"generation":8,"preference":{"preset":"system"}}),
        )
        .unwrap();
        fs::write(store.path(), &future).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(8, ThemePreference::default(), 2).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), future);
    }
}
