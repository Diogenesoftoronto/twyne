//! Pure checks derived from notorganic-connect.ts, auth.ts, and the current
//! Not Organic public-client/product validators. Neither a successful check nor
//! a constructed receipt authenticates an account. The parent transport must
//! establish TLS/session/JWT authenticity and accepted Convex auth separately.

use anyhow::{Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use uuid::Uuid;

pub const CALLBACK_PATH: &str = "/auth/notorganic/";
pub const ATTEMPT_LIFETIME_MS: u64 = 600_000;
pub const AUTHORIZE_URL: &str = "https://id.notorganic.info/authorize";
/// Root must continue capability-gating live account controls. Pure registration
/// or receipt consistency checks cannot make this transport available.
pub const CONNECTED_AUTH_AVAILABLE: bool = false;

/// Operator configuration, not an inferred capability from a URL's syntax.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallbackRegistration {
    pub origin: String,
    pub twyne_backend_trusted: bool,
    /// Must come from the operator-approved gateway catalog, never the cosmetic
    /// `product` query parameter. Unconfigured loopback currently maps to Keating.
    pub gateway_product: Option<String>,
}

impl CallbackRegistration {
    pub fn require_supported(&self) -> Result<()> {
        validate_origin(&self.origin)?;
        ensure!(
            self.twyne_backend_trusted && self.gateway_product.as_deref() == Some("twyne"),
            "Native sign-in requires this exact callback origin to be approved by both Twyne and Not Organic."
        );
        Ok(())
    }
}

/// Conservatively accepts canonical ASCII origins only. This is not a general
/// URL parser; the eventual router must supply separately parsed URL components.
/// Rejecting an unsupported representation never broadens backend trust.
pub fn validate_origin(origin: &str) -> Result<()> {
    ensure!(
        origin.len() <= 256 && origin.is_ascii(),
        "Unsupported callback origin."
    );
    let (scheme, authority) = origin
        .split_once("://")
        .ok_or_else(|| anyhow::anyhow!("Unsupported callback origin."))?;
    ensure!(
        !authority.is_empty() && !authority.contains(['/', '?', '#', '@', '\\']),
        "Unsupported callback origin."
    );
    let (host, port) = if let Some(tail) = authority.strip_prefix("[::1]") {
        ensure!(
            tail.is_empty() || tail.starts_with(':'),
            "Unsupported callback origin."
        );
        ("[::1]", tail.strip_prefix(':'))
    } else {
        let mut parts = authority.split(':');
        let host = parts.next().unwrap_or_default();
        let port = parts.next();
        ensure!(parts.next().is_none(), "Unsupported callback origin.");
        ensure!(
            host.split('.').all(|label| !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')),
            "Unsupported callback origin."
        );
        (host, port)
    };
    if let Some(port) = port {
        let number = port.parse::<u16>().ok().filter(|port| *port > 0);
        ensure!(
            number.is_some() && !port.starts_with('0') && port.bytes().all(|b| b.is_ascii_digit()),
            "Unsupported callback port."
        );
        ensure!(
            !(scheme == "https" && number == Some(443) || scheme == "http" && number == Some(80)),
            "Use the canonical callback origin."
        );
    }
    ensure!(
        scheme == "https"
            || scheme == "http" && matches!(host, "localhost" | "127.0.0.1" | "[::1]"),
        "Only registered HTTPS or loopback callbacks are supported."
    );
    Ok(())
}

pub fn safe_return_to(value: &str) -> String {
    if value.starts_with('/')
        && !value.starts_with("//")
        && !value.contains('\\')
        && !value.chars().any(|c| c < ' ' || c == '\u{7f}')
    {
        value.to_owned()
    } else {
        "/".to_owned()
    }
}

fn query_escape(value: &str) -> String {
    value.bytes().fold(String::new(), |mut out, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            use fmt::Write;
            let _ = write!(out, "%{byte:02X}");
        }
        out
    })
}

pub struct SignInAttempt {
    origin: String,
    verifier: String,
    state: String,
    expires_at_ms: u64,
    return_to: String,
    consumed: bool,
}

impl fmt::Debug for SignInAttempt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SignInAttempt")
            .field("origin", &self.origin)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("consumed", &self.consumed)
            .finish_non_exhaustive()
    }
}

/// Parsed components, preserving duplicate query values. Never obtain these by
/// assuming the requested callback URL equals the actual received URL.
#[derive(Clone, Default)]
pub struct CallbackInput {
    pub origin: String,
    pub pathname: String,
    pub fragment: String,
    pub error_present: bool,
    pub codes: Vec<String>,
    pub states: Vec<String>,
}

impl fmt::Debug for CallbackInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CallbackInput")
            .field("origin", &self.origin)
            .field("pathname", &self.pathname)
            .field("code_count", &self.codes.len())
            .field("state_count", &self.states.len())
            .field("error_present", &self.error_present)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Serialize)]
pub struct RedemptionRequest {
    pub code: String,
    pub verifier: String,
    pub origin: String,
}

impl fmt::Debug for RedemptionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RedemptionRequest")
            .field("origin", &self.origin)
            .finish_non_exhaustive()
    }
}

impl SignInAttempt {
    /// Both arrays must be freshly generated by the parent's OS CSPRNG. This
    /// method does not generate entropy, save a credential, or launch a browser.
    pub fn prepare(
        registration: &CallbackRegistration,
        verifier_entropy: [u8; 32],
        state_entropy: [u8; 32],
        now_ms: u64,
        return_to: &str,
    ) -> Result<Self> {
        registration.require_supported()?;
        Ok(Self {
            origin: registration.origin.clone(),
            verifier: URL_SAFE_NO_PAD.encode(verifier_entropy),
            state: URL_SAFE_NO_PAD.encode(state_entropy),
            expires_at_ms: now_ms
                .checked_add(ATTEMPT_LIFETIME_MS)
                .ok_or_else(|| anyhow::anyhow!("Invalid sign-in time."))?,
            return_to: safe_return_to(return_to),
            consumed: false,
        })
    }

    /// Contains state but no verifier. Parent must not log callback/code data.
    pub fn authorization_url(&self) -> Result<String> {
        ensure!(
            !self.consumed,
            "This sign-in attempt has already been consumed."
        );
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.as_bytes()));
        let redirect = format!("{}{CALLBACK_PATH}", self.origin);
        let fields = [
            ("response_type", "code"),
            ("client_id", self.origin.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge.as_str()),
            ("state", self.state.as_str()),
            ("scope", "wallet:read"),
            ("product", "twyne"),
            ("prompt", "select_account"),
        ];
        Ok(format!(
            "{AUTHORIZE_URL}?{}",
            fields
                .into_iter()
                .map(|(key, value)| format!("{key}={}", query_escape(value)))
                .collect::<Vec<_>>()
                .join("&")
        ))
    }

    /// Single use even on failure, like removal of Source's saved attempt.
    pub fn consume_callback(
        &mut self,
        input: &CallbackInput,
        now_ms: u64,
    ) -> Result<RedemptionRequest> {
        let used = self.consumed;
        self.consumed = true;
        if used
            || now_ms >= self.expires_at_ms
            || input.origin != self.origin
            || input.pathname != CALLBACK_PATH
            || !input.fragment.is_empty()
            || input.error_present
            || input.codes.len() != 1
            || input.codes[0].is_empty()
            || input.codes[0].len() > 2048
            || input.states.as_slice() != [self.state.clone()]
        {
            bail!("This sign-in attempt expired or belongs to another tab. Please sign in again.");
        }
        Ok(RedemptionRequest {
            code: input.codes[0].clone(),
            verifier: self.verifier.clone(),
            origin: self.origin.clone(),
        })
    }

    pub fn destination(&self) -> &str {
        &self.return_to
    }

    /// Fixture/router access only; state must remain tied to this attempt.
    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountIdentity {
    pub issuer: String,
    pub subject: String,
    pub token_identifier: String,
}

impl AccountIdentity {
    /// Consistency validation only. Values must originate in a separately
    /// authenticated transport/JWT callback, not text fields or decoded claims.
    pub fn validate(&self) -> Result<()> {
        // Some configured issuers retain a trailing slash. Validate syntax while
        // preserving the exact original issuer in the canonical identifier.
        validate_origin(self.issuer.strip_suffix('/').unwrap_or(&self.issuer))?;
        ensure!(
            !self.subject.is_empty()
                && self.subject.len() <= 1024
                && !self.subject.chars().any(char::is_control),
            "Invalid account subject."
        );
        ensure!(
            self.token_identifier == format!("{}|{}", self.issuer, self.subject),
            "The account identifier does not match its issuer and subject."
        );
        Ok(())
    }

    pub fn partition_id(&self) -> Result<String> {
        self.validate()?;
        Ok(format!(
            "{:x}",
            Sha256::digest(self.token_identifier.as_bytes())
        ))
    }
}

/// This is a parsed consistency receipt, not a verified-authentication type.
#[derive(Clone, Debug)]
pub struct SignInReceipt {
    pub issued_user_id: String,
    pub refreshed_user_id: String,
    pub session_user_id: String,
    pub session_id: String,
    pub redemption_error: bool,
    pub refresh_error: bool,
}

impl SignInReceipt {
    pub fn consistent_account(&self, trusted_issuer: &str) -> Result<AccountIdentity> {
        ensure!(
            !self.redemption_error
                && !self.refresh_error
                && !self.issued_user_id.is_empty()
                && !self.session_id.is_empty()
                && self.issued_user_id == self.refreshed_user_id
                && self.issued_user_id == self.session_user_id,
            "Twyne could not confirm your session. Please sign in again."
        );
        let identity = AccountIdentity {
            issuer: trusted_issuer.to_owned(),
            subject: self.issued_user_id.clone(),
            token_identifier: format!("{trusted_issuer}|{}", self.issued_user_id),
        };
        identity.validate()?;
        Ok(identity)
    }
}

/// A unique operation-lifetime guard. Constructing it does not authenticate;
/// Root must create it only after its transport reports accepted Convex auth.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLease {
    pub account: AccountIdentity,
    pub id: Uuid,
}

impl SessionLease {
    pub fn new(account: AccountIdentity) -> Result<Self> {
        account.validate()?;
        Ok(Self {
            account,
            id: Uuid::new_v4(),
        })
    }

    pub fn require_current(&self, active: Option<&Self>, account: &AccountIdentity) -> Result<()> {
        ensure!(
            active == Some(self) && self.account == *account,
            "The active account changed before this operation completed."
        );
        Ok(())
    }
}
