//! Pure publishing projections and request/receipt DTOs, with no connected publisher.
//! `sanitize_html` matches the Source Convex string-strip branch only; it is not
//! the browser DOM sanitizer or a general untrusted-HTML safety boundary.

use super::{error::CollaborationError, identity::trim_js};
use regex::Regex;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

/// Publication category for Convex public reader routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PublishKind {
    Post,
    Blog,
}

impl PublishKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Post => "post",
            Self::Blog => "blog",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "post" => Some(Self::Post),
            "blog" => Some(Self::Blog),
            _ => None,
        }
    }
}

/// Mirrors the seven ordered Source SSR/Convex regex replacements. Unicode text
/// is preserved; malformed/unclosed tags retain the original string-strip behavior.
pub fn sanitize_html(html: &str) -> String {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        // Source regexes do not use /u: case folding and word classes are ASCII.
        // Source \s is ECMAScript whitespace, not Rust's Unicode White_Space.
        let space = r"\u{0009}-\u{000d}\u{0020}\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
        let mut expressions = ["script", "style", "iframe", "object"].map(|tag| {
            format!(r"(?i-u:<{tag})[\s\S]*?(?i-u:</{tag}>)")
        }).to_vec();
        expressions.push(r"(?i-u:<embed)(?-u:\b)[^>]*/?>".into());
        expressions.push(format!(
            r#"[{space}](?i-u:on)[A-Za-z0-9_]+[{space}]*=[{space}]*("[^"]*"|'[^']*'|[^{space}>]+)"#
        ));
        expressions.push(r"(?i-u:javascript:)".into());
        expressions.into_iter().map(|pattern| {
            Regex::new(&pattern).expect("fixed Source regex must compile")
        }).collect()
    });
    patterns.iter().fold(html.to_owned(), |out, pattern| {
        pattern.replace_all(&out, "").into_owned()
    })
}

/// Source lowercase -> NFKD -> remove U+0300..036F -> ASCII slug -> trim -> slice48.
/// A hyphen exposed by the final slice is intentionally retained, as in Source.
pub fn slugify(input: &str) -> String {
    let mut slug = String::new();
    for c in input.to_lowercase().nfkd() {
        if ('\u{0300}'..='\u{036f}').contains(&c) {
            continue;
        }
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').chars().take(48).collect()
}

/// Raw publication request. Preserve submitted title/author/summary/content;
/// the actual server owns title UTF16 slicing, sanitization, owner and blog gating.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexPublishPlan {
    pub folio_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief_summary: Option<String>,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<PublishKind>,
}

pub fn prepare_convex_publish(
    folio_id: &str,
    title: &str,
    author_name: Option<&str>,
    brief_summary: Option<&str>,
    raw_content_html: &str,
    requested_kind: Option<PublishKind>,
) -> ConvexPublishPlan {
    ConvexPublishPlan {
        folio_id: folio_id.into(),
        title: title.into(),
        author_name: author_name.map(str::to_owned),
        brief_summary: brief_summary.map(str::to_owned),
        content: raw_content_html.into(),
        kind: requested_kind,
    }
}

/// Parsed response fields, not proof of dispatch or acceptance. The offline
/// transport never constructs a receipt. Raw unknown response fields are retained.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexPublishReceipt {
    pub slug: String,
    pub owner_handle: Option<String>,
    pub updated: bool,
    pub kind: PublishKind,
    pub requested_blog: bool,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, serde_json::Value>,
}

impl ConvexPublishReceipt {
    /// Reader-route projection only; it does not verify a received server row.
    pub fn reader_url(&self, origin: &str) -> String {
        let base = origin.trim_end_matches('/');
        match &self.owner_handle {
            Some(handle) => format!("{base}/{handle}/{}", self.slug),
            None => format!("{base}/p/{}", self.slug),
        }
    }
}

// ── 2. ATProto / Standard.site Publishing ──────────────────────────────────

pub const STANDARD_SITE_ORIGIN: &str = "https://twyne.love";
pub const STANDARD_SITE_PUBLICATION_COLLECTION: &str = "site.standard.publication";
pub const STANDARD_SITE_DOCUMENT_COLLECTION: &str = "site.standard.document";

/// Validates whether a string matches the ATProto DID syntax:
/// `^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?::[A-Za-z0-9._:%-]+)*$`
pub fn is_atproto_did(value: &str) -> bool {
    if !value.starts_with("did:") {
        return false;
    }
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() < 3 {
        return false;
    }
    let method = parts[1];
    if method.is_empty()
        || !method
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return false;
    }
    for &part in &parts[2..] {
        if part.is_empty()
            || !part.chars().all(|c| {
                c.is_ascii_alphanumeric()
                    || c == '.'
                    || c == '_'
                    || c == ':'
                    || c == '%'
                    || c == '-'
            })
        {
            return false;
        }
    }
    true
}

/// Validates whether a string is a 13-character base32 TID (Timestamp Identifier):
/// `^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$`
pub fn is_tid(value: &str) -> bool {
    if value.len() != 13 {
        return false;
    }
    let mut chars = value.chars();
    let first = chars.next().unwrap();
    let valid_first = "234567abcdefghij";
    if !valid_first.contains(first) {
        return false;
    }
    let valid_rest = "234567abcdefghijklmnopqrstuvwxyz";
    chars.all(|c| valid_rest.contains(c))
}

/// Parsed components of an `at://` URI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtUriParts {
    pub did: String,
    pub collection: String,
    pub rkey: String,
}

/// Parses an `at://` URI: `at://<did>/<collection>/<rkey>`.
pub fn parse_at_uri(uri: &str) -> Option<AtUriParts> {
    if !uri.starts_with("at://") {
        return None;
    }
    let rest = &uri["at://".len()..];
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let did = parts[0];
    let collection = parts[1];
    let rkey = parts[2];

    if !is_atproto_did(did) || collection.is_empty() || !is_tid(rkey) {
        return None;
    }

    Some(AtUriParts {
        did: did.to_string(),
        collection: collection.to_string(),
        rkey: rkey.to_string(),
    })
}

/// URL encodes a DID string (primarily `:` -> `%3A`).
pub fn url_encode_did(did: &str) -> String {
    let mut res = String::new();
    for b in did.bytes() {
        match b {
            b'a'..=b'z'
            | b'A'..=b'Z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'!'
            | b'\''
            | b'('
            | b')'
            | b'*' => {
                res.push(b as char);
            }
            _ => {
                res.push_str(&format!("%{:02X}", b));
            }
        }
    }
    res
}

/// Derives the Standard.site publication URL.
pub fn standard_site_publication_url(
    did: &str,
    publication_rkey: &str,
    origin: Option<&str>,
) -> Result<String, CollaborationError> {
    if !is_atproto_did(did) {
        return Err(CollaborationError::InvalidDid(did.to_string()));
    }
    if !is_tid(publication_rkey) {
        return Err(CollaborationError::InvalidTid(publication_rkey.to_string()));
    }
    let base = origin.unwrap_or(STANDARD_SITE_ORIGIN);
    let base = base.strip_suffix('/').unwrap_or(base);
    Ok(format!(
        "{base}/at/{}/{publication_rkey}",
        url_encode_did(did)
    ))
}

/// Derives the Standard.site document URL.
pub fn standard_site_document_url(
    did: &str,
    publication_rkey: &str,
    document_rkey: &str,
    origin: Option<&str>,
) -> Result<String, CollaborationError> {
    if !is_tid(document_rkey) {
        return Err(CollaborationError::InvalidTid(document_rkey.to_string()));
    }
    let pub_url = standard_site_publication_url(did, publication_rkey, origin)?;
    Ok(format!("{pub_url}/{document_rkey}"))
}

/// Parsed PDS response projection; construction does not establish publication.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtprotoPublishReceipt {
    pub uri: String,
    pub publication_uri: String,
    pub viewer_url: String,
    pub explorer_url: String,
}

// ── 3. Micropub Publishing ─────────────────────────────────────────────────

/// Source WHATWG URL policy: HTTPS or HTTP with the *parsed* localhost/127.0.0.1
/// hostname. Matching a string prefix is insufficient (localhost.evil is remote).
pub fn validate_micropub_endpoint(endpoint: &str) -> Result<String, CollaborationError> {
    let parsed = url::Url::parse(trim_js(endpoint))
        .map_err(|_| CollaborationError::InsecureMicropubEndpoint(endpoint.into()))?;
    let local = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1"));
    if parsed.scheme() != "https" && !(local && parsed.scheme() == "http") {
        return Err(CollaborationError::InsecureMicropubEndpoint(
            endpoint.into(),
        ));
    }
    Ok(parsed.to_string())
}

/// Source URLSearchParams body encoding, including '+' for space and '%7E' for '~'.
/// This is a pure projection, not a dispatch or a token-lifecycle guarantee.
pub fn format_micropub_body(title: &str, html: &str) -> String {
    let title = trim_js(title);
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("h", "entry")
        .append_pair("name", if title.is_empty() { "Untitled" } else { title })
        .append_pair("content[html]", html)
        .append_pair("post-status", "published")
        .finish()
}
