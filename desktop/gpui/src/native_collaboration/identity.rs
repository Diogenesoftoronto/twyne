//! Peer and caller identity models, privacy-preserving display rules, and deterministic color assignment.
//!
//! Sourced from `convex/collaboration.ts` and `src/utils/account-display.ts`.

use crate::native_collaboration::error::CollaborationError;
use std::fmt;

/// ECMAScript WhiteSpace and LineTerminator, as used by Source `trim` and `\s`.
/// Rust's Unicode whitespace set differs (notably U+0085 and U+FEFF).
pub(crate) fn is_js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(crate) fn trim_js(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// The 8 canonical presence colors defined in `convex/collaboration.ts`.
pub const PRESENCE_COLORS: [&str; 8] = [
    "#c1272d", "#e8a92c", "#3b7dd8", "#2d8659", "#8b4cc7", "#d8652c", "#5c8cb8", "#a02c6d",
];

/// Computes the deterministic presence color for a user ID using the exact
/// 32-bit hash algorithm from `convex/collaboration.ts`:
///
/// ```javascript
/// let hash = 0;
/// for (let i = 0; i < userId.length; i++) {
///   hash = (hash * 31 + userId.charCodeAt(i)) | 0;
/// }
/// return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
/// ```
pub fn pick_presence_color(user_id: &str) -> &'static str {
    let mut hash: i32 = 0;
    for c in user_id.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(c as i32);
    }
    let idx = (hash.unsigned_abs() as usize) % PRESENCE_COLORS.len();
    PRESENCE_COLORS[idx]
}

/// Sanitizes a raw name string according to Twyne's privacy guidelines.
///
/// Rejects emails (to prevent leaking private addresses as public labels)
/// and raw `did:` strings.
pub fn account_name(value: Option<&str>) -> Option<&str> {
    let trimmed = trim_js(value?);
    if trimmed.is_empty() {
        return None;
    }
    // Exact existence test for Source /\S+@\S+/, including embedded emails.
    let mut chars = trimmed.chars().peekable();
    let mut previous = None;
    let mut has_email = false;
    while let Some(c) = chars.next() {
        if c == '@'
            && previous.is_some_and(|p| !is_js_whitespace(p))
            && chars.peek().is_some_and(|n| !is_js_whitespace(*n))
        {
            has_email = true;
            break;
        }
        previous = Some(c);
    }
    if has_email {
        return None;
    }
    // Rejects raw DID identifiers
    if trimmed.starts_with("did:") {
        return None;
    }
    Some(trimmed)
}

/// Derives the human-facing display name following the priority fallback:
/// profile display name -> user name -> profile handle -> user handle -> "Writer".
pub fn account_display_name(
    user_name: Option<&str>,
    user_handle: Option<&str>,
    profile_display_name: Option<&str>,
    profile_handle: Option<&str>,
) -> String {
    if let Some(name) = account_name(profile_display_name) {
        return name.to_string();
    }
    if let Some(name) = account_name(user_name) {
        return name.to_string();
    }
    if let Some(handle) = account_name(profile_handle) {
        return handle.to_string();
    }
    if let Some(handle) = account_name(user_handle) {
        return handle.to_string();
    }
    "Writer".to_string()
}

/// Derives initials for presence avatars. Defaults to "W" if no valid name is available.
pub fn account_initials(name: &str) -> String {
    let Some(safe_name) = account_name(Some(name)) else {
        return "W".to_string();
    };

    let words: Vec<&str> = safe_name
        .split(is_js_whitespace)
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        return "W".to_string();
    }

    let first = words[0].chars().next().unwrap_or('W');
    if words.len() > 1 {
        let last = words[words.len() - 1].chars().next().unwrap_or(first);
        format!("{}{}", first.to_uppercase(), last.to_uppercase())
    } else {
        first.to_uppercase().to_string()
    }
}

/// Caller-supplied account labels and claimed entitlement, never authentication evidence.
/// A future transport must obtain identity/accepted membership from its server;
/// constructing this value grants no authority and verifies neither ID nor Pro status.
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterMetadata {
    pub user_id: String,
    pub display_name: String,
    pub private_contact_email: Option<String>,
    pub is_pro: bool,
}

impl fmt::Debug for WriterMetadata {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WriterMetadata")
            .field("user_id", &self.user_id)
            .field("display_name", &self.display_name)
            .field(
                "private_contact_email",
                &self.private_contact_email.as_ref().map(|_| "[redacted]"),
            )
            .field("is_pro", &self.is_pro)
            .finish()
    }
}

impl WriterMetadata {
    pub fn new(
        user_id: impl Into<String>,
        display_name: impl Into<String>,
        email: Option<String>,
        is_pro: bool,
    ) -> Result<Self, CollaborationError> {
        let uid = user_id.into();
        let trimmed_uid = trim_js(&uid);
        if trimmed_uid.is_empty() {
            return Err(CollaborationError::CapabilityUnavailable {
                capability: "writer_metadata",
                reason: "A non-empty account label ID is required; this is not authentication."
                    .into(),
            });
        }

        let name = display_name.into();
        let clean_name = account_display_name(Some(&name), None, None, None);

        Ok(Self {
            user_id: trimmed_uid.to_string(),
            display_name: clean_name,
            private_contact_email: email,
            is_pro,
        })
    }

    /// Color automatically assigned to this writer based on their stable ID.
    pub fn presence_color(&self) -> &'static str {
        pick_presence_color(&self.user_id)
    }
}
