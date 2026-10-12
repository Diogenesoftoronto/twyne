//! Offline LiteRT launch planning and owned-child RAII boundary.
//! A bare TCP listener does not verify model readiness/ownership. Actual bounded
//! import/spawn/readiness execution is unavailable here; no models/files are read.
use std::{
    env, io,
    path::{Path, PathBuf},
    process::Child,
    sync::Mutex,
    time::Duration,
};

pub const LOCAL_MODEL_ID: &str = "minicpm5-2b";
pub const LOCAL_PROVIDER_ID: &str = "desktop-litert-local";
pub const DEFAULT_LOOPBACK_HOST: &str = "127.0.0.1";
pub const DEFAULT_STARTUP_TIMEOUT_MS: u64 = 20_000;
pub const DEFAULT_STARTUP_POLL_MS: u64 = 150;
pub const DEFAULT_BIN_PATH: &str = "./bin/litert-lm";
pub const DEFAULT_MODEL_PATH: &str = "./models/MiniCPM5-2B_int4.litertlm";
pub const MAX_REGISTRY_OUTPUT_BYTES: usize = 256 * 1024;

pub enum LiteRtError {
    Disabled,
    CapabilityUnavailable,
    InvalidConfiguration,
    MissingAssets {
        bin_exists: bool,
        model_exists: bool,
        bin_path: PathBuf,
        model_path: PathBuf,
    },
    Io(io::Error),
    RegistryCheckFailed(String),
    ImportFailed(String),
    StartupFailed(String),
}
impl std::fmt::Debug for LiteRtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)
    }
}
impl std::fmt::Display for LiteRtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Disabled => "Local LiteRT is disabled",
            Self::CapabilityUnavailable => {
                "Native LiteRT execution/readiness adapter is unavailable"
            }
            Self::InvalidConfiguration => "Invalid local LiteRT configuration",
            Self::MissingAssets { .. } => "Local LiteRT assets are missing",
            Self::Io(_) => "Local LiteRT I/O failed",
            Self::RegistryCheckFailed(_) => "Local LiteRT registry check failed",
            Self::ImportFailed(_) => "Local LiteRT import failed",
            Self::StartupFailed(_) => "Local LiteRT startup failed",
        })
    }
}
impl std::error::Error for LiteRtError {}
impl From<io::Error> for LiteRtError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum LiteRtState {
    Disabled,
    MissingAssets {
        bin_exists: bool,
        model_exists: bool,
        bin_path: PathBuf,
        model_path: PathBuf,
    },
    CheckingRegistry,
    ImportingModel {
        model_id: String,
    },
    Starting {
        port: u16,
        pid: u32,
        started_at_ms: u64,
    },
    /// Legacy observation shape only, not reachable by this unavailable manager.
    Ready {
        port: u16,
        pid: u32,
        base_url: String,
    },
    Failed {
        stage: String,
        reason: String,
        timestamp_ms: u64,
    },
    Stopped,
    Unavailable,
}
impl LiteRtState {
    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Ready { .. })
    }
    pub fn port(&self) -> Option<u16> {
        match self {
            Self::Starting { port, .. } | Self::Ready { port, .. } => Some(*port),
            _ => None,
        }
    }
    pub fn base_url(&self) -> Option<&str> {
        match self {
            Self::Ready { base_url, .. } => Some(base_url),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LiteRtConfig {
    pub enabled: bool,
    pub bin_path: PathBuf,
    pub model_path: PathBuf,
    pub model_id: String,
    pub host: String,
    pub startup_timeout: Duration,
    pub startup_poll_interval: Duration,
}
impl Default for LiteRtConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bin_path: DEFAULT_BIN_PATH.into(),
            model_path: DEFAULT_MODEL_PATH.into(),
            model_id: LOCAL_MODEL_ID.into(),
            host: DEFAULT_LOOPBACK_HOST.into(),
            startup_timeout: Duration::from_millis(DEFAULT_STARTUP_TIMEOUT_MS),
            startup_poll_interval: Duration::from_millis(DEFAULT_STARTUP_POLL_MS),
        }
    }
}
impl LiteRtConfig {
    /// Explicit configuration-only environment read. Default does not inspect
    /// environment, files or models. Only these Source CLI settings are read.
    /// Invalid/nonpositive timeout strings use a native safe default; Source's
    /// JS parseInt edge semantics are not claimed for malformed configuration.
    pub fn from_env() -> Self {
        let mut config = Self {
            enabled: env::var("TWYNE_DESKTOP_LOCAL_AI").is_ok_and(|v| v == "true" || v == "1"),
            ..Self::default()
        };
        if let Ok(path) = env::var("LITERT_LM_BIN") {
            config.bin_path = path.into();
        }
        if let Ok(path) = env::var("LOCAL_MODEL_PATH") {
            config.model_path = path.into();
        }
        if let Some(timeout) = env::var("LITERT_LM_STARTUP_TIMEOUT_MS")
            .or_else(|_| env::var("LITERT_SERVER_STARTUP_TIMEOUT_MS"))
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| (1..=300_000).contains(v))
        {
            config.startup_timeout = Duration::from_millis(timeout);
        }
        config
    }
    pub fn launch_plan(&self, port: u16) -> Result<LiteRtLaunchPlan, LiteRtError> {
        if !self.enabled {
            return Err(LiteRtError::Disabled);
        }
        if self.host != DEFAULT_LOOPBACK_HOST
            || self.model_id != LOCAL_MODEL_ID
            || port == 0
            || self.bin_path.as_os_str().is_empty()
            || self.model_path.as_os_str().is_empty()
            || self.startup_timeout.is_zero()
            || self.startup_timeout > Duration::from_secs(300)
            || self.startup_poll_interval.is_zero()
            || self.startup_poll_interval > self.startup_timeout
        {
            return Err(LiteRtError::InvalidConfiguration);
        }
        Ok(LiteRtLaunchPlan {
            executable: self.bin_path.clone(),
            registry_args: vec!["list".into()],
            import_args: vec![
                "import".into(),
                self.model_path.as_os_str().to_owned(),
                LOCAL_MODEL_ID.into(),
            ],
            serve_args: vec![
                "serve".into(),
                "--host".into(),
                DEFAULT_LOOPBACK_HOST.into(),
                "--port".into(),
                port.to_string().into(),
            ],
            port,
            timeout: self.startup_timeout,
            max_registry_bytes: MAX_REGISTRY_OUTPUT_BYTES,
        })
    }
}
#[derive(Clone, Debug)]
pub struct LiteRtLaunchPlan {
    pub executable: PathBuf,
    pub registry_args: Vec<std::ffi::OsString>,
    pub import_args: Vec<std::ffi::OsString>,
    pub serve_args: Vec<std::ffi::OsString>,
    pub port: u16,
    pub timeout: Duration,
    pub max_registry_bytes: usize,
}

/// Future executor must retain a port reservation through spawn, drain bounded
/// output while waiting, bound list/import/start, verify owned child+model HTTP
/// readiness, and kill/reap on every failure/cancel. This foundation does not
/// perform that work or mistake a competing local listener for its child.
pub fn allocate_free_port(_host: &str) -> io::Result<u16> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "No owned port/spawn adapter",
    ))
}
pub fn is_port_accepting_connections(_host: &str, _port: u16, _timeout: Duration) -> bool {
    false
}
pub fn model_is_registered(_bin: &Path, _model_id: &str) -> Result<bool, LiteRtError> {
    Err(LiteRtError::CapabilityUnavailable)
}
pub fn import_model(_bin: &Path, _model_path: &Path, _model_id: &str) -> Result<(), LiteRtError> {
    Err(LiteRtError::CapabilityUnavailable)
}
pub fn wait_for_server_ready(
    _child: &mut Child,
    _host: &str,
    _port: u16,
    _timeout: Duration,
    _poll: Duration,
) -> Result<(), String> {
    Err("No owned model-readiness adapter".into())
}

/// Ownership of a supplied actual Child only. This does NOT verify readiness,
/// model identity, descendants/process group cleanup or provider capabilities.
pub struct LiteRtServerHandle {
    pub port: u16,
    pub pid: u32,
    pub base_url: String,
    child: Mutex<Option<Child>>,
}
impl LiteRtServerHandle {
    pub fn from_owned_child(
        port: u16,
        base_url: String,
        mut child: Child,
    ) -> Result<Self, LiteRtError> {
        if super::loopback_transport::LoopbackClient::from_base_url(&base_url)
            .is_none_or(|c| c.port() != port)
            || child.try_wait().map_or(true, |status| status.is_some())
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(LiteRtError::InvalidConfiguration);
        }
        let pid = child.id();
        Ok(Self {
            port,
            pid,
            base_url,
            child: Mutex::new(Some(child)),
        })
    }
    pub fn is_alive(&self) -> bool {
        self.child.lock().ok().is_some_and(|mut guard| {
            guard
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
        })
    }
    pub fn stop(&self) {
        let mut guard = self
            .child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for LiteRtServerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub struct LiteRtProcessManager {
    config: LiteRtConfig,
    state: LiteRtState,
}
impl LiteRtProcessManager {
    pub fn new(config: LiteRtConfig) -> Self {
        let state = if config.enabled {
            LiteRtState::Stopped
        } else {
            LiteRtState::Disabled
        };
        Self { config, state }
    }
    pub fn state(&self) -> &LiteRtState {
        &self.state
    }
    pub fn config(&self) -> &LiteRtConfig {
        &self.config
    }
    pub fn is_ready(&self) -> bool {
        false
    }
    pub fn base_url(&self) -> Option<&str> {
        None
    }
    pub fn port(&self) -> Option<u16> {
        None
    }
    pub fn poll_health(&mut self) -> &LiteRtState {
        &self.state
    }
    /// Default unavailable: no asset probes, registry imports, spawn or sockets.
    pub fn start(&mut self) -> Result<Option<String>, LiteRtError> {
        if !self.config.enabled {
            self.state = LiteRtState::Disabled;
            return Ok(None);
        }
        self.state = LiteRtState::Unavailable;
        Err(LiteRtError::CapabilityUnavailable)
    }
    pub fn stop(&mut self) {
        self.state = if self.config.enabled {
            LiteRtState::Stopped
        } else {
            LiteRtState::Disabled
        };
    }
}
impl Drop for LiteRtProcessManager {
    fn drop(&mut self) {
        self.stop();
    }
}
