//! Strict captured HTTP/SSE decoder and unavailable live transport boundary.
//! No sockets, credentials, provider calls or fabricated live receipts are used.
//! The decoder is a bounded OpenAI-chat subset, not the full Source SDK transport.

use super::{
    request::{CompletionRequest, MAX_REQUEST_BODY_BYTES, MAX_RESPONSE_BYTES},
    stream_accumulator::{
        GenerationStreamAccumulator, GenerationStreamInput, GenerationStreamSnapshot,
    },
};
use serde_json::{Value, json};
use std::{
    fmt,
    time::{Duration, Instant},
};

pub const MAX_HTTP_HEADER_BYTES: usize = 32 * 1024;
pub const MAX_SSE_LINE_BYTES: usize = 64 * 1024;
pub const MAX_SSE_EVENT_BYTES: usize = 128 * 1024;
pub const MAX_CAPTURED_WIRE_BYTES: usize = 2 * MAX_RESPONSE_BYTES + MAX_HTTP_HEADER_BYTES;
const MAX_EVENTS: usize = 4096;

/// Error messages are fixed diagnostic classes, never provider bodies or prompts.
#[derive(Clone, PartialEq, Eq)]
pub enum AiError {
    ConnectionRefused(String),
    Timeout(String),
    HttpError { status: u16, message: String },
    Cancelled,
    MalformedResponse(String),
    PayloadTooLarge(usize),
    CapabilityUnavailable,
    InvalidRequest,
    QueueFull,
    DuplicateRequest,
    StaleRequest,
}
impl fmt::Debug for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Public legacy String fields may contain caller/provider text. Keep
        // even Debug redacted, rather than trusting each future constructor.
        fmt::Display::fmt(self, f)
    }
}
impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HttpError { status, .. } => write!(f, "Provider HTTP status {status}"),
            Self::PayloadTooLarge(bytes) => write!(f, "AI byte limit exceeded ({bytes})"),
            Self::Cancelled => write!(f, "AI request cancelled"),
            Self::CapabilityUnavailable => write!(f, "Native AI transport is not connected"),
            Self::InvalidRequest => write!(f, "Invalid AI request"),
            Self::QueueFull => write!(f, "AI request queue is full"),
            Self::DuplicateRequest => write!(f, "AI request ID is already active or terminal"),
            Self::StaleRequest => write!(f, "AI request scope or revision changed"),
            Self::ConnectionRefused(_) => write!(f, "AI connection refused"),
            Self::Timeout(_) => write!(f, "AI request timed out"),
            Self::MalformedResponse(_) => write!(f, "Malformed AI response"),
        }
    }
}
impl std::error::Error for AiError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompletionEvidence {
    SyntheticFixture,
}

/// Captured synthetic result only; never represents an authenticated provider receipt.
#[derive(Clone, PartialEq)]
pub struct CompletionResult {
    pub text: String,
    pub reasoning: String,
    pub snapshot: GenerationStreamSnapshot,
    pub raw_json: Option<Value>,
    pub evidence: CompletionEvidence,
}
impl fmt::Debug for CompletionResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CompletionResult")
            .field("text_bytes", &self.text.len())
            .field("reasoning_bytes", &self.reasoning.len())
            .field("evidence", &self.evidence)
            .finish_non_exhaustive()
    }
}

pub struct LoopbackClient {
    port: u16,
    valid: bool,
}
impl LoopbackClient {
    /// Only literal 127.0.0.1 is supported; this never opens a connection.
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            valid: host.into() == "127.0.0.1" && port != 0,
            port,
        }
    }
    pub fn from_base_url(value: &str) -> Option<Self> {
        // URL parsers canonicalize shorthand, hex and decimal IPv4. Check the
        // authored authority too; this policy admits only the literal address.
        let authority = value.strip_prefix("http://")?.split('/').next()?;
        let raw_port = authority.strip_prefix("127.0.0.1:")?;
        if raw_port.is_empty() || !raw_port.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let explicit_port = raw_port.parse::<u16>().ok()?;
        let url = url::Url::parse(value).ok()?;
        // Strict native subset: no DNS, alternate loopback IPs, TLS downgrade,
        // URL credentials, query secrets, fragment or silently ignored paths.
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/v1"
        {
            return None;
        }
        let port = url.port_or_known_default()?;
        if port != explicit_port {
            return None;
        }
        (port != 0).then_some(Self { port, valid: true })
    }
    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn build_payload(req: &CompletionRequest) -> Result<String, AiError> {
        validate_request(req)?;
        let mut payload = json!({"model": req.model, "messages": req.messages,
            "temperature": req.temperature, "stream": req.stream});
        if let Some(tokens) = req.max_tokens {
            payload["max_tokens"] = json!(tokens);
        }
        let payload = serde_json::to_string(&payload).map_err(|_| AiError::InvalidRequest)?;
        if payload.len() > MAX_REQUEST_BODY_BYTES {
            return Err(AiError::PayloadTooLarge(payload.len()));
        }
        Ok(payload)
    }
    pub fn send_completion(&self, req: &CompletionRequest) -> Result<CompletionResult, AiError> {
        Self::build_payload(req)?;
        if !self.valid {
            return Err(AiError::InvalidRequest);
        }
        Err(AiError::CapabilityUnavailable)
    }
    pub fn stream_completion<F>(
        &self,
        req: &CompletionRequest,
        _on_snapshot: F,
    ) -> Result<CompletionResult, AiError>
    where
        F: FnMut(&GenerationStreamSnapshot) -> bool,
    {
        Self::build_payload(req)?;
        if !self.valid {
            return Err(AiError::InvalidRequest);
        }
        Err(AiError::CapabilityUnavailable)
    }

    /// Explicit synthetic boundary. Byte fragments may split UTF8, headers/chunks,
    /// CRLF and SSE fields. Collection is bounded before extension/allocation.
    pub fn decode_captured_response<F>(
        &self,
        req: &CompletionRequest,
        chunks: &[&[u8]],
        mut on_snapshot: F,
    ) -> Result<CompletionResult, AiError>
    where
        F: FnMut(&GenerationStreamSnapshot) -> bool,
    {
        Self::build_payload(req)?;
        if !self.valid {
            return Err(AiError::InvalidRequest);
        }
        let started = Instant::now();
        let mut wire = Vec::new();
        for chunk in chunks {
            check(req, started)?;
            let size = wire
                .len()
                .checked_add(chunk.len())
                .ok_or(AiError::PayloadTooLarge(usize::MAX))?;
            if size > MAX_CAPTURED_WIRE_BYTES {
                return Err(AiError::PayloadTooLarge(size));
            }
            wire.extend_from_slice(chunk);
        }
        let response = decode_http(&wire)?;
        check(req, started)?;
        if response.status != 200 {
            return Err(AiError::HttpError {
                status: response.status,
                message: "Provider rejected the request".into(),
            });
        }
        let body = std::str::from_utf8(&response.body).map_err(|_| malformed("invalid UTF8"))?;
        if req.stream {
            if response.content_type != "text/event-stream" {
                return Err(malformed("wrong stream media type"));
            }
            decode_sse(req, started, body, &mut on_snapshot)
        } else {
            if response.content_type != "application/json" {
                return Err(malformed("wrong JSON media type"));
            }
            let value: Value = serde_json::from_str(body).map_err(|_| malformed("invalid JSON"))?;
            let choice = value
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|v| v.first())
                .ok_or(malformed("missing choice"))?;
            if !choice
                .get("finish_reason")
                .and_then(Value::as_str)
                .is_some_and(|reason| !reason.is_empty())
            {
                return Err(malformed("missing terminal reason"));
            }
            let message = choice
                .get("message")
                .and_then(Value::as_object)
                .ok_or(malformed("missing message"))?;
            let text = match message.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null)
                    if message
                        .get("reasoning_content")
                        .is_some_and(Value::is_string) =>
                {
                    String::new()
                }
                _ => return Err(malformed("invalid content")),
            };
            let reasoning = match message.get("reasoning_content") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                _ => return Err(malformed("invalid reasoning")),
            };
            check(req, started)?;
            let mut accumulator = GenerationStreamAccumulator::new();
            accumulator.push(GenerationStreamInput::ReasoningDelta(reasoning));
            accumulator.push(GenerationStreamInput::TextDelta(text));
            let snapshot = accumulator.push(GenerationStreamInput::Finish);
            Ok(CompletionResult {
                text: snapshot.text.clone(),
                reasoning: snapshot.reasoning.clone(),
                snapshot,
                raw_json: Some(value),
                evidence: CompletionEvidence::SyntheticFixture,
            })
        }
    }
}

pub(crate) fn validate_request(req: &CompletionRequest) -> Result<(), AiError> {
    if req.cancel_token.is_cancelled() {
        return Err(AiError::Cancelled);
    }
    if req.request_id.0.is_empty()
        || req.provider_id.is_empty()
        || req.model.is_empty()
        || req.messages.is_empty()
        || req.messages.len() > 1024
        || !req.temperature.is_finite()
        || req.timeout.is_zero()
        || req.timeout > Duration::from_secs(300)
        || req.max_tokens == Some(0)
        || req.revision.as_ref().is_some_and(|r| r.folio_id.is_empty())
        || req
            .messages
            .iter()
            .any(|m| !matches!(m.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err(AiError::InvalidRequest);
    }
    let estimate = req.estimated_bytes();
    if estimate > MAX_REQUEST_BODY_BYTES {
        return Err(AiError::PayloadTooLarge(estimate));
    }
    Ok(())
}
fn check(req: &CompletionRequest, started: Instant) -> Result<(), AiError> {
    if req.cancel_token.is_cancelled() {
        return Err(AiError::Cancelled);
    }
    if started.elapsed() >= req.timeout {
        return Err(AiError::Timeout("deadline".into()));
    }
    Ok(())
}
fn malformed(class: &'static str) -> AiError {
    AiError::MalformedResponse(class.into())
}

struct HttpResponse {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}
fn decode_http(wire: &[u8]) -> Result<HttpResponse, AiError> {
    let header_end = wire
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or(malformed("incomplete headers"))?;
    if header_end + 4 > MAX_HTTP_HEADER_BYTES {
        return Err(AiError::PayloadTooLarge(header_end + 4));
    }
    let headers =
        std::str::from_utf8(&wire[..header_end]).map_err(|_| malformed("header encoding"))?;
    let mut lines = headers.split("\r\n");
    let parts: Vec<_> = lines
        .next()
        .ok_or(malformed("status missing"))?
        .split_ascii_whitespace()
        .collect();
    if parts.len() < 2 || !matches!(parts[0], "HTTP/1.0" | "HTTP/1.1") {
        return Err(malformed("status line"));
    }
    let status = parts[1]
        .parse::<u16>()
        .ok()
        .filter(|v| (100..=599).contains(v))
        .ok_or(malformed("status code"))?;
    let mut content_length = None;
    let mut chunked = false;
    let mut content_type = None;
    let mut count = 0;
    for line in lines {
        count += 1;
        if count > 128 || line.starts_with([' ', '\t']) {
            return Err(malformed("header bounds"));
        }
        let (name, value) = line.split_once(':').ok_or(malformed("header syntax"))?;
        if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || name.is_empty()
            || value.bytes().any(|b| b == 0 || b == b'\r' || b == b'\n')
        {
            return Err(malformed("header name"));
        }
        let value = value.trim_matches([' ', '\t']);
        match name.to_ascii_lowercase().as_str() {
            "content-length" => {
                if content_length.is_some()
                    || !value.bytes().all(|b| b.is_ascii_digit())
                    || value.is_empty()
                {
                    return Err(malformed("ambiguous content length"));
                }
                let len = value
                    .parse::<usize>()
                    .map_err(|_| malformed("content length overflow"))?;
                if len > MAX_RESPONSE_BYTES {
                    return Err(AiError::PayloadTooLarge(len));
                }
                content_length = Some(len);
            }
            "transfer-encoding" => {
                if chunked || !value.eq_ignore_ascii_case("chunked") {
                    return Err(malformed("unsupported transfer encoding"));
                }
                chunked = true;
            }
            "content-encoding" if !value.eq_ignore_ascii_case("identity") => {
                return Err(malformed("encoded body unsupported"));
            }
            "content-type" => {
                if content_type.is_some() {
                    return Err(malformed("ambiguous media type"));
                }
                content_type = Some(
                    value
                        .split(';')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_ascii_lowercase(),
                );
            }
            _ => {}
        }
    }
    if chunked && content_length.is_some() {
        return Err(malformed("conflicting framing"));
    }
    let raw = &wire[header_end + 4..];
    let body = if chunked {
        decode_chunks(raw)?
    } else {
        if raw.len() > MAX_RESPONSE_BYTES {
            return Err(AiError::PayloadTooLarge(raw.len()));
        }
        if content_length.is_some_and(|len| len != raw.len()) {
            return Err(malformed("truncated or extra body"));
        }
        raw.to_vec()
    };
    Ok(HttpResponse {
        status,
        body,
        content_type: content_type.unwrap_or_default(),
    })
}
fn decode_chunks(raw: &[u8]) -> Result<Vec<u8>, AiError> {
    let mut cursor = 0;
    let mut body = Vec::new();
    loop {
        let end = raw[cursor..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or(malformed("truncated chunk size"))?
            + cursor;
        if end - cursor > 256 {
            return Err(malformed("chunk size bounds"));
        }
        let size = std::str::from_utf8(&raw[cursor..end])
            .map_err(|_| malformed("chunk size encoding"))?
            .split(';')
            .next()
            .unwrap_or("");
        if size.is_empty() || !size.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(malformed("invalid chunk size"));
        }
        let size = usize::from_str_radix(size, 16).map_err(|_| malformed("chunk size overflow"))?;
        cursor = end + 2;
        if size == 0 {
            // Bounded trailers; reject unexpected data after the terminating frame.
            let trailer_start = cursor;
            loop {
                let end = raw[cursor..]
                    .windows(2)
                    .position(|w| w == b"\r\n")
                    .ok_or(malformed("truncated trailer"))?
                    + cursor;
                if end + 2 - trailer_start > MAX_HTTP_HEADER_BYTES {
                    return Err(malformed("trailer bounds"));
                }
                if end == cursor {
                    return if end + 2 == raw.len() {
                        Ok(body)
                    } else {
                        Err(malformed("extra framed data"))
                    };
                }
                if !raw[cursor..end].contains(&b':') {
                    return Err(malformed("invalid trailer"));
                }
                cursor = end + 2;
            }
        }
        let next_len = body
            .len()
            .checked_add(size)
            .ok_or(AiError::PayloadTooLarge(usize::MAX))?;
        if next_len > MAX_RESPONSE_BYTES {
            return Err(AiError::PayloadTooLarge(next_len));
        }
        let end = cursor
            .checked_add(size)
            .ok_or(malformed("chunk range overflow"))?;
        if end.checked_add(2).is_none_or(|n| n > raw.len())
            || raw.get(end..end + 2) != Some(b"\r\n")
        {
            return Err(malformed("truncated chunk"));
        }
        body.extend_from_slice(&raw[cursor..end]);
        cursor = end + 2;
    }
}

fn decode_sse<F>(
    req: &CompletionRequest,
    started: Instant,
    body: &str,
    callback: &mut F,
) -> Result<CompletionResult, AiError>
where
    F: FnMut(&GenerationStreamSnapshot) -> bool,
{
    let body = body.strip_prefix('\u{feff}').unwrap_or(body);
    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    let mut accumulator = GenerationStreamAccumulator::new();
    let mut data = String::new();
    let mut has_data = false;
    let mut terminal = false;
    let mut done = false;
    let mut events = 0;
    // A single final newline terminates its data line, not a blank event line.
    // SSE explicitly discards an event still pending at EOF.
    for line in normalized.split_terminator('\n') {
        check(req, started)?;
        if line.len() > MAX_SSE_LINE_BYTES {
            return Err(AiError::PayloadTooLarge(line.len()));
        }
        if line.is_empty() {
            if !has_data {
                continue;
            }
            events += 1;
            if events > MAX_EVENTS {
                return Err(malformed("event count"));
            }
            if done {
                return Err(malformed("data after DONE"));
            }
            if data == "[DONE]" {
                done = true;
                terminal = true;
            } else {
                let value: Value =
                    serde_json::from_str(&data).map_err(|_| malformed("invalid SSE JSON"))?;
                if value.get("error").is_some() {
                    return Err(malformed("provider stream error"));
                }
                let choices = value
                    .get("choices")
                    .and_then(Value::as_array)
                    .ok_or(malformed("missing SSE choices"))?;
                if choices.len() > 1 {
                    return Err(malformed("multiple choices unsupported"));
                }
                if let Some(choice) = choices.first() {
                    if choice.get("index").is_some_and(|v| v.as_u64() != Some(0)) {
                        return Err(malformed("unsupported choice index"));
                    }
                    let delta = choice
                        .get("delta")
                        .and_then(Value::as_object)
                        .ok_or(malformed("missing delta"))?;
                    for (field, reasoning) in [("reasoning_content", true), ("content", false)] {
                        match delta.get(field) {
                            Some(Value::String(text)) if !text.is_empty() => {
                                if terminal {
                                    return Err(malformed("delta after terminal"));
                                }
                                accumulator.push(if reasoning {
                                    GenerationStreamInput::ReasoningDelta(text.clone())
                                } else {
                                    GenerationStreamInput::TextDelta(text.clone())
                                });
                            }
                            None | Some(Value::Null) | Some(Value::String(_)) => {}
                            _ => return Err(malformed("invalid delta type")),
                        }
                    }
                    match choice.get("finish_reason") {
                        None | Some(Value::Null) => {}
                        Some(Value::String(reason)) if !reason.is_empty() => terminal = true,
                        _ => return Err(malformed("invalid finish reason")),
                    }
                    if !callback(&accumulator.snapshot()) {
                        req.cancel_token.cancel();
                        return Err(AiError::Cancelled);
                    }
                } else if value.get("usage").is_none() {
                    return Err(malformed("empty choice event"));
                }
            }
            data.clear();
            has_data = false;
        } else if !line.starts_with(':') {
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            if field == "data" {
                let value = value.strip_prefix(' ').unwrap_or(value);
                let size = data
                    .len()
                    .saturating_add(value.len())
                    .saturating_add(usize::from(has_data));
                if size > MAX_SSE_EVENT_BYTES {
                    return Err(AiError::PayloadTooLarge(size));
                }
                if has_data {
                    data.push('\n');
                }
                data.push_str(value);
                has_data = true;
            }
        }
    }
    // Un-dispatched trailing data is truncation, even after a prior finish reason.
    if has_data || !terminal {
        return Err(malformed("EOF before terminal SSE event"));
    }
    check(req, started)?;
    let snapshot = accumulator.push(GenerationStreamInput::Finish);
    if !callback(&snapshot) {
        req.cancel_token.cancel();
        return Err(AiError::Cancelled);
    }
    check(req, started)?;
    Ok(CompletionResult {
        text: snapshot.text.clone(),
        reasoning: snapshot.reasoning.clone(),
        snapshot,
        raw_json: None,
        evidence: CompletionEvidence::SyntheticFixture,
    })
}
