//! Bounded worker-thread callback receiver. Listener acknowledgement does not
//! authenticate an account; auth.rs consumes the matching single-use attempt.

use anyhow::{Result, anyhow, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use std::{
    io::{self, Read, Write},
    net::{Ipv6Addr, SocketAddr, SocketAddrV6, TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use url::Url;

use super::auth::{CALLBACK_PATH, CallbackInput, CallbackRegistration};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const STREAM_DEADLINE: Duration = Duration::from_millis(250);
const HISTORY_CLEANUP: &str = "history.replaceState(null,\"\",location.pathname);";
const SUCCESS_BODY: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Completing Sign In · Twyne</title></head><body><p>Return to Twyne. We are finishing your sign-in.</p><script>history.replaceState(null,\"\",location.pathname);</script></body></html>";
const ERROR_BODY: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Twyne</title></head><body><p>This sign-in request cannot be completed.</p><script>history.replaceState(null,\"\",location.pathname);</script></body></html>";

pub struct CallbackListener {
    listener: TcpListener,
    origin: String,
    authority: String,
}

impl CallbackListener {
    pub fn bind(registration: &CallbackRegistration) -> Result<Self> {
        registration.require_supported()?;
        let (address, authority) = socket_for_origin(&registration.origin)?;
        let listener = TcpListener::bind(address)
            .map_err(|_| anyhow!("Could not bind the registered loopback callback."))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| anyhow!("Could not configure the loopback callback listener."))?;
        Ok(Self {
            listener,
            origin: registration.origin.clone(),
            authority,
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn poll(&self, expected_state: &str) -> Result<Option<CallbackInput>> {
        let (mut stream, _) = loop {
            match self.listener.accept() {
                Ok(accepted) => break accepted,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
                Err(_) => return Err(anyhow!("The loopback callback listener failed.")),
            }
        };
        if stream.set_nonblocking(true).is_err() {
            return Ok(None);
        }
        let deadline = Instant::now() + STREAM_DEADLINE;
        let request = match read_request(&mut stream, deadline) {
            Ok(request) => request,
            Err(_) => return Ok(None),
        };
        let input = match parse_request(&request, &self.authority, &self.origin) {
            Ok(input) => input,
            Err(()) => {
                write_response(&mut stream, "400 Bad Request", ERROR_BODY, deadline);
                return Ok(None);
            }
        };
        if !state_matches(&input, expected_state) {
            write_response(&mut stream, "404 Not Found", ERROR_BODY, deadline);
            return Ok(None);
        }
        write_response(&mut stream, "200 OK", SUCCESS_BODY, deadline);
        Ok(Some(input))
    }
}

fn socket_for_origin(origin: &str) -> Result<(SocketAddr, String)> {
    let authority = origin
        .strip_prefix("http://")
        .ok_or_else(|| anyhow!("Only canonical HTTP loopback callbacks are supported."))?;
    let (host, port_text) = if let Some(tail) = authority.strip_prefix("[::1]") {
        let port_text = tail
            .strip_prefix(':')
            .ok_or_else(|| anyhow!("A fixed callback port is required."))?;
        ("[::1]", port_text)
    } else {
        let (host, port_text) = authority
            .split_once(':')
            .ok_or_else(|| anyhow!("A fixed callback port is required."))?;
        (host, port_text)
    };
    ensure!(
        matches!(host, "127.0.0.1" | "localhost" | "[::1]"),
        "Only loopback callback hosts are supported."
    );
    ensure!(
        !port_text.is_empty()
            && !port_text.starts_with('0')
            && port_text.bytes().all(|byte| byte.is_ascii_digit()),
        "A canonical fixed callback port is required."
    );
    let port = port_text
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| anyhow!("A nonzero fixed callback port is required."))?;
    ensure!(
        format!("http://{authority}") == origin,
        "Only canonical HTTP loopback callbacks are supported."
    );
    let address = match host {
        "127.0.0.1" | "localhost" => SocketAddr::from((Ipv4Loopback::ADDRESS, port)),
        "[::1]" => SocketAddr::V6(SocketAddrV6::new(Ipv6Addr::LOCALHOST, port, 0, 0)),
        _ => return Err(anyhow!("Only loopback callback hosts are supported.")),
    };
    Ok((address, authority.to_owned()))
}

struct Ipv4Loopback;

impl Ipv4Loopback {
    const ADDRESS: std::net::Ipv4Addr = std::net::Ipv4Addr::new(127, 0, 0, 1);
}

fn read_request(stream: &mut TcpStream, deadline: Instant) -> io::Result<Vec<u8>> {
    let mut request = Vec::with_capacity(2048);
    let mut buffer = [0_u8; 2048];
    loop {
        if has_header_terminator(&request) || request.len() >= MAX_HEADER_BYTES {
            return Ok(request);
        }
        if Instant::now() >= deadline {
            return Ok(request);
        }
        let remaining = MAX_HEADER_BYTES + 1 - request.len();
        let read_size = buffer.len().min(remaining);
        match stream.read(&mut buffer[..read_size]) {
            Ok(0) => return Ok(request),
            Ok(count) => request.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Ok(request);
                }
                thread::sleep(Duration::from_millis(2).min(remaining));
            }
            Err(error) => return Err(error),
        }
    }
}

fn has_header_terminator(bytes: &[u8]) -> bool {
    bytes.windows(4).any(|window| window == b"\r\n\r\n")
}

fn parse_request(
    request: &[u8],
    authority: &str,
    origin: &str,
) -> std::result::Result<CallbackInput, ()> {
    if request.len() > MAX_HEADER_BYTES {
        return Err(());
    }
    let header_end = request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(())?;
    if header_end + 4 != request.len() {
        return Err(());
    }
    for (index, byte) in request.iter().copied().enumerate() {
        if byte >= 0x80
            || byte == 0x7f
            || (byte < 0x20 && byte != b'\r' && byte != b'\n')
            || (byte == b'\r' && request.get(index + 1) != Some(&b'\n'))
            || (byte == b'\n' && (index == 0 || request[index - 1] != b'\r'))
        {
            return Err(());
        }
    }
    let header_text = std::str::from_utf8(&request[..header_end]).map_err(|_| ())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or(())?;
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next().ok_or(())?;
    let target = request_parts.next().ok_or(())?;
    let version = request_parts.next().ok_or(())?;
    if request_parts.next().is_some() || method != "GET" {
        return Err(());
    }
    if !matches!(version, "HTTP/1.0" | "HTTP/1.1")
        || !target.starts_with('/')
        || target.starts_with("//")
        || target.contains(['#', '\\'])
        || target
            .as_bytes()
            .iter()
            .any(|byte| !(0x21..=0x7e).contains(byte))
    {
        return Err(());
    }
    let raw_path = target.split_once('?').map_or(target, |(path, _)| path);
    if raw_path != CALLBACK_PATH {
        return Err(());
    }
    let mut host_seen = false;
    for line in lines {
        if line.is_empty() {
            return Err(());
        }
        let (name, value) = line.split_once(':').ok_or(())?;
        // Real browser HTTP headers have optional whitespace after the colon.
        let value = value.trim_matches(' ');
        if name.is_empty() || !name.bytes().all(is_token) {
            return Err(());
        }
        if name.eq_ignore_ascii_case("host") {
            if host_seen || value != authority {
                return Err(());
            }
            host_seen = true;
        } else if name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("content-length")
        {
            return Err(());
        }
    }
    if !host_seen {
        return Err(());
    }
    let url = Url::parse(&format!("{origin}{target}")).map_err(|_| ())?;
    if url.origin().ascii_serialization() != origin
        || url.path() != CALLBACK_PATH
        || url.fragment().is_some()
    {
        return Err(());
    }
    let mut input = CallbackInput {
        origin: origin.to_owned(),
        pathname: url.path().to_owned(),
        fragment: url.fragment().unwrap_or_default().to_owned(),
        ..CallbackInput::default()
    };
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => input.codes.push(value.into_owned()),
            "state" => input.states.push(value.into_owned()),
            "error" => input.error_present = true,
            _ => {}
        }
    }
    Ok(input)
}

fn is_token(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

fn state_matches(input: &CallbackInput, expected_state: &str) -> bool {
    !expected_state.is_empty() && input.states.len() == 1 && input.states[0] == expected_state
}

fn write_response(stream: &mut TcpStream, status: &str, body: &str, deadline: Instant) {
    // Source removes callback credentials from history before redemption. Allow
    // only that exact static script; no credentials enter HTML or CSP values.
    let script_hash = STANDARD.encode(Sha256::digest(HISTORY_CLEANUP.as_bytes()));
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nPragma: no-cache\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'sha256-{script_hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let bytes = response.as_bytes();
    let mut written = 0;
    while written < bytes.len() && Instant::now() < deadline {
        match stream.write(&bytes[written..]) {
            Ok(0) => return,
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return;
                }
                thread::sleep(Duration::from_millis(2).min(remaining));
            }
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTHORITY: &str = "127.0.0.1:43127";
    const ORIGIN: &str = "http://127.0.0.1:43127";

    fn fixture(target: &str, headers: &str) -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\n{headers}\r\n\r\n").into_bytes()
    }

    fn parse(target: &str, headers: &str) -> std::result::Result<CallbackInput, ()> {
        parse_request(&fixture(target, headers), AUTHORITY, ORIGIN)
    }

    #[test]
    fn preserves_duplicate_state_and_code_values() {
        let input = parse(
            "/auth/notorganic/?state=s&state=s&code=one&code=two",
            "Host: 127.0.0.1:43127",
        )
        .unwrap();
        assert_eq!(input.states, ["s", "s"]);
        assert_eq!(input.codes, ["one", "two"]);
        assert!(!state_matches(&input, "s"));
    }

    #[test]
    fn accepts_browser_header_spacing_and_error_callbacks() {
        let input = parse(
            "/auth/notorganic/?state=expected&error=access_denied",
            "Host: 127.0.0.1:43127\r\nUser-Agent: Browser",
        )
        .unwrap();
        assert!(input.error_present && state_matches(&input, "expected"));
        assert!(input.codes.is_empty());
        assert!(!state_matches(&input, ""));
    }

    #[test]
    fn a_socket_callback_preserves_the_live_attempt_after_unsolicited_requests() {
        // Port 0 is fixture-only: production bind() requires a registered fixed
        // nonzero port. Keep this socket reserved throughout the test.
        let socket = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let authority = socket.local_addr().unwrap().to_string();
        socket.set_nonblocking(true).unwrap();
        let listener = CallbackListener {
            listener: socket,
            origin: format!("http://{authority}"),
            authority: authority.clone(),
        };
        for state in ["unsolicited", "expected"] {
            let mut client = TcpStream::connect(&authority).unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let request = format!(
                "GET /auth/notorganic/?state={state}&code=fixture-code HTTP/1.1\r\nHost: {authority}\r\n\r\n"
            );
            client.write_all(request.as_bytes()).unwrap();
            let input = listener.poll("expected").unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            assert!(response.contains("Cache-Control: no-store"));
            assert!(!response.contains("fixture-code") && !response.contains(state));
            if state == "unsolicited" {
                assert!(input.is_none());
                assert!(response.starts_with("HTTP/1.1 404"));
            } else {
                assert_eq!(input.unwrap().codes, ["fixture-code"]);
                assert!(response.starts_with("HTTP/1.1 200"));
            }
        }
    }

    #[test]
    fn rejects_spoofed_or_duplicate_host() {
        assert!(parse("/auth/notorganic/?state=s", "Host: attacker.test:43127").is_err());
        assert!(
            parse(
                "/auth/notorganic/?state=s",
                "Host: 127.0.0.1:43127\r\nHost: 127.0.0.1:43127"
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_absolute_targets_and_fragments() {
        assert!(
            parse(
                "http://127.0.0.1:43127/auth/notorganic/?state=s",
                "Host: 127.0.0.1:43127"
            )
            .is_err()
        );
        assert!(
            parse(
                "/auth/notorganic/?state=s#fragment",
                "Host: 127.0.0.1:43127"
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_body_and_path_normalization() {
        let mut body = b"GET /auth/notorganic/?state=s HTTP/1.1\r\nHost: 127.0.0.1:43127\r\nContent-Length: 1\r\n\r\nx".to_vec();
        assert!(parse_request(&body, AUTHORITY, ORIGIN).is_err());
        body = b"GET /auth/notorganic/?state=s HTTP/1.1\r\nHost: 127.0.0.1:43127\r\n\r\nx".to_vec();
        assert!(parse_request(&body, AUTHORITY, ORIGIN).is_err());
        assert!(parse("/auth/%6eotorganic/?state=s", "Host: 127.0.0.1:43127").is_err());
        assert!(
            parse(
                "/auth/notorganic/../notorganic/?state=s",
                "Host: 127.0.0.1:43127"
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_oversized_headers_and_ignores_unsolicited_state() {
        let mut oversized = fixture("/auth/notorganic/?state=s", "Host: 127.0.0.1:43127");
        oversized.resize(MAX_HEADER_BYTES + 1, b' ');
        assert!(parse_request(&oversized, AUTHORITY, ORIGIN).is_err());
        let input = parse(
            "/auth/notorganic/?state=other&code=one",
            "Host: 127.0.0.1:43127",
        )
        .unwrap();
        assert!(!state_matches(&input, "expected"));
    }
}
