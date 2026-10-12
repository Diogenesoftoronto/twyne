//! Private resident-helper IPC. Blocking calls belong on the GPUI background
//! executor, never a render/keystroke path. No cookies/JWTs enter this protocol.

use super::auth::{
    AccountIdentity, CallbackRegistration, RedemptionRequest, SessionLease, validate_origin,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use uuid::Uuid;

const MAX_REPLY_BYTES: usize = 32 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Debug)]
pub struct ConnectedProfile {
    pub registration: CallbackRegistration,
    pub site_url: String,
    pub convex_url: String,
}
impl ConnectedProfile {
    pub fn validate(&self) -> anyhow::Result<()> {
        self.registration.require_supported()?;
        validate_origin(&self.site_url)?;
        validate_origin(&self.convex_url)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Persistence {
    Keychain,
    SessionOnly,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CredentialStorage {
    Platform,
    SessionOnly,
}

/// Only the owned transport can construct this accepted-session receipt.
#[derive(Clone, Debug)]
pub struct AcceptedSession {
    lease: SessionLease,
    pub display_name: String,
    pub email: String,
    pub persistence: Persistence,
}
impl AcceptedSession {
    pub fn lease(&self) -> &SessionLease {
        &self.lease
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportError {
    InvalidRequest,
    SignedOut,
    Stale,
    Unavailable,
    UnknownOutcome,
    SyncConflict,
}
impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidRequest => "Twyne could not use this request.",
            Self::SignedOut => "Sign in to Twyne to continue.",
            Self::Stale => "The active account changed before this request completed.",
            Self::Unavailable => "Twyne could not connect. Please try again.",
            Self::UnknownOutcome => {
                "The connection was lost after sending this request. Its outcome is unknown."
            }
            Self::SyncConflict => {
                "This workspace changed on another device. Refresh it before trying again."
            }
        })
    }
}
impl std::error::Error for TransportError {}
type Result<T> = std::result::Result<T, TransportError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    account: AccountIdentity,
    lease_id: Uuid,
    display_name: String,
    email: String,
    persistence: Persistence,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Failure {
    kind: TransportError,
    message: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    v: u8,
    id: Uuid,
    ok: bool,
    #[serde(default)]
    result: Value,
    error: Option<Failure>,
}
#[derive(Serialize)]
struct Request<'a> {
    v: u8,
    id: Uuid,
    method: &'a str,
    params: Value,
}

struct Inner {
    child: Mutex<Child>,
    input: Mutex<ChildStdin>,
    pending: Mutex<BTreeMap<Uuid, mpsc::Sender<Result<Value>>>>,
    failed: AtomicBool,
}
impl Inner {
    fn fail(&self) {
        self.failed.store(true, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in std::mem::take(&mut *pending) {
                let _ = sender.send(Err(TransportError::Unavailable));
            }
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}
impl Drop for Inner {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
#[derive(Clone)]
pub struct ConnectedHelper {
    inner: Arc<Inner>,
    profile: ConnectedProfile,
}
impl ConnectedHelper {
    pub fn start(
        executable: &Path,
        profile: ConnectedProfile,
        storage: CredentialStorage,
    ) -> Result<Self> {
        profile
            .validate()
            .map_err(|_| TransportError::InvalidRequest)?;
        if !executable.is_absolute() || !executable.is_file() {
            return Err(TransportError::Unavailable);
        }
        let mut command = Command::new(executable);
        command.arg("--stdio-v1").env_clear();
        // Preserve platform/TLS/keychain access, excluding development provider
        // keys, auth attempts and unrelated credentials from the child process.
        for name in [
            "PATH",
            "LANG",
            "LC_ALL",
            "LC_CTYPE",
            "LD_LIBRARY_PATH",
            "SSL_CERT_FILE",
            "NIX_SSL_CERT_FILE",
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
            "HOME",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| TransportError::Unavailable)?;
        let input = child.stdin.take().ok_or(TransportError::Unavailable)?;
        let output = child.stdout.take().ok_or(TransportError::Unavailable)?;
        let inner = Arc::new(Inner {
            child: Mutex::new(child),
            input: Mutex::new(input),
            pending: Mutex::new(BTreeMap::new()),
            failed: AtomicBool::new(false),
        });
        let weak = Arc::downgrade(&inner);
        std::thread::Builder::new()
            .name("twyne-connected-replies".into())
            .spawn(move || {
                let mut reader = BufReader::new(output);
                loop {
                    let result = read_reply(&mut reader);
                    let Some(inner) = weak.upgrade() else {
                        break;
                    };
                    let reply = match result {
                        Ok(reply) => reply,
                        Err(_) => {
                            inner.fail();
                            break;
                        }
                    };
                    let sender = inner
                        .pending
                        .lock()
                        .ok()
                        .and_then(|mut pending| pending.remove(&reply.id));
                    if let Some(sender) = sender {
                        let result = if reply.ok {
                            if reply.error.is_some() {
                                Err(TransportError::Unavailable)
                            } else {
                                Ok(reply.result)
                            }
                        } else {
                            reply
                                .error
                                .map_or(Err(TransportError::Unavailable), |error| {
                                    // Treat helper error text as private; use our static
                                    // public messages instead of echoing it into UI/logs.
                                    let _ = error.message;
                                    Err(error.kind)
                                })
                        };
                        let _ = sender.send(result);
                    }
                }
            })
            .map_err(|_| TransportError::Unavailable)?;
        let helper = Self { inner, profile };
        let initialized = helper.rpc("init", json!({
            "profile": {"siteUrl":helper.profile.site_url,"convexUrl":helper.profile.convex_url,"callbackOrigin":helper.profile.registration.origin},
            "storage": match storage { CredentialStorage::Platform => "platform", CredentialStorage::SessionOnly => "sessionOnly" },
        }))?;
        if initialized != json!({"protocol":1}) {
            return Err(TransportError::Unavailable);
        }
        Ok(helper)
    }
    fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        if self.inner.failed.load(Ordering::Acquire) {
            return Err(TransportError::Unavailable);
        }
        let id = Uuid::new_v4();
        let bytes = serde_json::to_vec(&Request {
            v: 1,
            id,
            method,
            params,
        })
        .map_err(|_| TransportError::InvalidRequest)?;
        if bytes.len() > MAX_REPLY_BYTES {
            return Err(TransportError::InvalidRequest);
        }
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self
                .inner
                .pending
                .lock()
                .map_err(|_| TransportError::Unavailable)?;
            let maximum = if method == "signOut" { 5 } else { 4 };
            if pending.len() >= maximum {
                return Err(TransportError::Unavailable);
            }
            pending.insert(id, sender);
        }
        let written = self
            .inner
            .input
            .lock()
            .map_err(|_| TransportError::Unavailable)
            .and_then(|mut input| {
                input
                    .write_all(&bytes)
                    .and_then(|()| input.write_all(b"\n"))
                    .and_then(|()| input.flush())
                    .map_err(|_| TransportError::Unavailable)
            });
        if written.is_err() {
            self.inner.fail();
            return Err(TransportError::Unavailable);
        }
        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(_) => {
                self.inner.fail();
                Err(TransportError::Unavailable)
            }
        }
    }
    fn accepted(&self, value: Value) -> Result<AcceptedSession> {
        let receipt: Receipt =
            serde_json::from_value(value).map_err(|_| TransportError::Unavailable)?;
        receipt
            .account
            .validate()
            .map_err(|_| TransportError::Unavailable)?;
        if receipt
            .account
            .issuer
            .strip_suffix('/')
            .unwrap_or(&receipt.account.issuer)
            != self.profile.site_url
        {
            return Err(TransportError::Unavailable);
        }
        Ok(AcceptedSession {
            lease: SessionLease {
                account: receipt.account,
                id: receipt.lease_id,
            },
            display_name: receipt.display_name,
            email: receipt.email,
            persistence: receipt.persistence,
        })
    }
    pub fn redeem(&self, redemption: RedemptionRequest) -> Result<AcceptedSession> {
        if redemption.origin != self.profile.registration.origin {
            return Err(TransportError::InvalidRequest);
        }
        let params =
            serde_json::to_value(redemption).map_err(|_| TransportError::InvalidRequest)?;
        self.accepted(self.rpc("redeem", params)?)
    }
    pub fn restore(&self) -> Result<Option<AcceptedSession>> {
        let value = self.rpc("restore", json!({}))?;
        if value.is_null() {
            Ok(None)
        } else {
            self.accepted(value).map(Some)
        }
    }
    pub fn sign_out(&self) -> Result<()> {
        self.rpc("signOut", json!({})).map(|_| ())
    }
    pub fn request(
        &self,
        lease: &SessionLease,
        operation: &str,
        arguments: Value,
    ) -> Result<Value> {
        if !arguments.is_object() {
            return Err(TransportError::InvalidRequest);
        }
        let write = matches!(operation, "sync.push" | "knowledge.call");
        self.rpc(
            "request",
            json!({"leaseId":lease.id,"operation":operation,"arguments":arguments}),
        )
        .map_err(|error| {
            if write && error == TransportError::Unavailable {
                TransportError::UnknownOutcome
            } else {
                error
            }
        })
    }
    pub fn stop(&self) {
        self.inner.fail();
    }
}

fn read_reply(reader: &mut impl BufRead) -> Result<Reply> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_REPLY_BYTES + 2) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| TransportError::Unavailable)?;
    if bytes.len() > MAX_REPLY_BYTES + 1 || bytes.last() != Some(&b'\n') {
        return Err(TransportError::Unavailable);
    }
    let reply: Reply = serde_json::from_slice(&bytes).map_err(|_| TransportError::Unavailable)?;
    if reply.v != 1 {
        return Err(TransportError::Unavailable);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_protocol_data_is_reported_without_echoing_credentials() {
        for bytes in [
            br#"{"cookie":"private-cookie"}"#.as_slice(),
            b"{invalid private-verifier}\n".as_slice(),
            b"{}\n".as_slice(),
        ] {
            let error = read_reply(&mut std::io::Cursor::new(bytes)).err().unwrap();
            assert_eq!(error, TransportError::Unavailable);
            assert!(!error.to_string().contains("private"));
        }
    }
}
