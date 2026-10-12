//! Account-specific, synced atomic journal storage. Separate handles/processes
//! share an OS lock. CAS compares exact primary/backup bytes and parsed value;
//! a recovered backup is never silently reported as an empty/new account.
//! Contains manuscript state/IDs only, never provider/session/JWT credentials.

use super::{
    auth::AccountIdentity,
    journal::{AccountJournal, JOURNAL_VERSION},
};
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

pub const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadSource {
    Missing,
    Primary,
    Backup,
}

#[derive(Clone, Debug)]
pub struct LoadedJournal {
    pub value: AccountJournal,
    pub warnings: Vec<String>,
    pub source: LoadSource,
    primary_bytes: Option<Vec<u8>>,
    backup_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct AccountSyncStore {
    directory: PathBuf,
}

impl AccountSyncStore {
    /// Only the caller's provided native app root is used. No browser storage,
    /// environment credentials, account APIs, or other product paths are read.
    pub fn open(app_root: &Path) -> Result<Self> {
        let directory = app_root.join("account-sync");
        fs::create_dir_all(&directory)
            .context("Could not create the local account journal directory.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self { directory })
    }

    pub fn paths(&self, account: &AccountIdentity) -> Result<(PathBuf, PathBuf)> {
        let partition = account.partition_id()?;
        Ok((
            self.directory.join(format!("{partition}.json")),
            self.directory.join(format!("{partition}.json.bak")),
        ))
    }

    fn lock(&self, account: &AccountIdentity) -> Result<File> {
        let path = self
            .directory
            .join(format!("{}.lock", account.partition_id()?));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path)?;
        FileExt::lock_exclusive(&file)?;
        Ok(file)
    }

    pub fn load(&self, account: &AccountIdentity) -> Result<LoadedJournal> {
        let _lock = self.lock(account)?;
        self.load_locked(account)
    }

    fn load_locked(&self, account: &AccountIdentity) -> Result<LoadedJournal> {
        let (primary, backup) = self.paths(account)?;
        let primary_bytes = read_bounded(&primary)?;
        let backup_bytes = read_bounded(&backup)?;
        if let Some(bytes) = &backup_bytes {
            check_version(bytes)?;
        }
        if let Some(bytes) = &primary_bytes {
            // Reject future version before fallback: opening an older backup
            // would erase a newer format on the next save.
            check_version(bytes)?;
            if let Ok(value) = parse_record(bytes, account) {
                return Ok(LoadedJournal {
                    value,
                    warnings: vec![],
                    source: LoadSource::Primary,
                    primary_bytes,
                    backup_bytes,
                });
            }
        }
        if let Some(bytes) = &backup_bytes {
            check_version(bytes)?;
            let value = parse_record(bytes, account).context("The account journal and its recovery copy could not be read; their bytes were left untouched.")?;
            return Ok(LoadedJournal { value, warnings: vec!["The local account journal was recovered from its previous durable copy. No cloud acknowledgement was inferred.".into()], source: LoadSource::Backup, primary_bytes, backup_bytes });
        }
        ensure!(
            primary_bytes.is_none(),
            "The account journal could not be read and has no valid recovery copy; its bytes were left untouched."
        );
        Ok(LoadedJournal {
            value: AccountJournal::new(account.clone())?,
            warnings: vec![],
            source: LoadSource::Missing,
            primary_bytes,
            backup_bytes,
        })
    }

    pub fn expected_value(
        base: &LoadedJournal,
        mut candidate: AccountJournal,
    ) -> Result<AccountJournal> {
        ensure!(
            candidate.account == base.value.account
                && candidate.generation == base.value.generation,
            "The candidate belongs to another account or local generation."
        );
        ensure!(
            candidate.edit_generation >= base.value.edit_generation
                && base
                    .value
                    .remote_revision
                    .is_none_or(|head| candidate.remote_revision.is_some_and(|next| next >= head)),
            "A journal save cannot move its local edit generation or observed cloud head backwards."
        );
        for (key, value) in &base.value.extra {
            candidate
                .extra
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("The account journal generation is exhausted."))?;
        candidate.validate()?;
        ensure!(
            serde_json::to_vec(&candidate)?.len() as u64 <= MAX_JOURNAL_BYTES,
            "The account journal exceeds the native durable storage limit; existing bytes were left untouched."
        );
        Ok(candidate)
    }

    /// A returned record acknowledges this journal's real fsync/rename, not a
    /// live manuscript save, connected authentication, or a server mutation.
    pub fn save_request(
        &self,
        base: &LoadedJournal,
        candidate: AccountJournal,
    ) -> Result<LoadedJournal> {
        let _lock = self.lock(&base.value.account)?;
        let current = self.load_locked(&base.value.account)?;
        ensure!(
            current.value == base.value
                && current.primary_bytes == base.primary_bytes
                && current.backup_bytes == base.backup_bytes,
            "The local account journal changed before this save. Reload and retry."
        );
        let candidate = Self::expected_value(base, candidate)?;
        let bytes = serde_json::to_vec_pretty(&candidate)?;
        ensure!(
            bytes.len() as u64 <= MAX_JOURNAL_BYTES,
            "The serialized account journal exceeds its storage limit."
        );
        let (primary, backup) = self.paths(&base.value.account)?;
        // Corrupt primary bytes must never replace a valid recovery copy.
        let prior_valid = match current.source {
            LoadSource::Primary => current.primary_bytes.as_deref(),
            LoadSource::Backup => current.backup_bytes.as_deref(),
            LoadSource::Missing => None,
        };
        if let Some(previous) = prior_valid {
            write_atomic(&backup, previous)?;
        }
        write_atomic(&primary, &bytes)?;
        self.load_locked(&base.value.account)
    }

    /// Resolve an uncertain local write only by exact complete expected value,
    /// then sync its existing primary and directory again under the same lock.
    /// Generation-only or recovered-backup matches are not acknowledgements.
    pub fn acknowledge_expected(&self, expected: &AccountJournal) -> Result<LoadedJournal> {
        let _lock = self.lock(&expected.account)?;
        let loaded = self.load_locked(&expected.account)?;
        ensure!(
            loaded.source == LoadSource::Primary && loaded.value == *expected,
            "The exact requested journal save is not present."
        );
        let (primary, _) = self.paths(&expected.account)?;
        File::open(primary)?.sync_all()?;
        sync_directory(&self.directory)?;
        Ok(loaded)
    }
}

fn read_bounded(path: &Path) -> Result<Option<Vec<u8>>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        metadata.is_file() && metadata.len() <= MAX_JOURNAL_BYTES,
        "The account journal is not a supported bounded regular file."
    );
    let mut bytes = vec![];
    File::open(path)?
        .take(MAX_JOURNAL_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_JOURNAL_BYTES,
        "The account journal changed beyond its size limit while reading."
    );
    Ok(Some(bytes))
}

fn check_version(bytes: &[u8]) -> Result<()> {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes)
        && let Some(version) = value.get("version").and_then(serde_json::Value::as_u64)
    {
        ensure!(
            version == u64::from(JOURNAL_VERSION),
            "This account journal version is unsupported; its bytes were left untouched."
        );
    }
    Ok(())
}

fn parse_record(bytes: &[u8], account: &AccountIdentity) -> Result<AccountJournal> {
    let value: AccountJournal = serde_json::from_slice(bytes)?;
    ensure!(
        value.account == *account,
        "The journal belongs to another account."
    );
    value.validate()?;
    Ok(value)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Missing account journal directory."))?;
    let mut file = NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
