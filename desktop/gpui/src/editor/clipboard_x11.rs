//! Explicit X11 rich-format transport. GPUI's public clipboard item cannot
//! carry HTML MIME data; its existing clipboard remains the fallback.
//!
//! Connect only after the actual GPUI backend reports `X11`. Reads belong on
//! the background executor and never on the ordinary typing path.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context as _, Result, anyhow, bail};
use x11rb::{
    COPY_DEPTH_FROM_PARENT, CURRENT_TIME, NONE,
    connection::Connection,
    protocol::{
        Event,
        xproto::{
            Atom, AtomEnum, ChangeWindowAttributesAux, ConnectionExt, CreateWindowAux, EventMask,
            PropMode, Property, SELECTION_NOTIFY_EVENT, SelectionNotifyEvent,
            SelectionRequestEvent, Window, WindowClass,
        },
    },
    rust_connection::RustConnection,
    wrapper::ConnectionExt as _,
};

use super::{EditorError, HTML_LIMITS, RichFragment};

pub const NATIVE_MIME: &str = "application/x-twyne-rich-fragment+json";
const MAX_BYTES: usize = 64 * 1024 * 1024;
const CHUNK_BYTES: usize = 64 * 1024;
const MAX_TRANSFERS: usize = 8;
const DEADLINE: Duration = Duration::from_secs(4);
const POLL: Duration = Duration::from_millis(1);
const IDLE_POLL: Duration = Duration::from_millis(10);

x11rb::atom_manager! {
    Atoms: AtomCookies {
        CLIPBOARD, TARGETS, TIMESTAMP, INCR,
        UTF8_STRING,
        PLAIN: b"text/plain;charset=utf-8",
        PLAIN_ALT: b"text/plain;charset=UTF-8",
        PLAIN_ANY: b"text/plain",
        HTML: b"text/html",
        HTML_UTF8: b"text/html;charset=utf-8",
        NATIVE: NATIVE_MIME.as_bytes(),
        RTF: b"text/rtf",
        RTF_ALT: b"application/rtf",
        PROPERTY: b"TWYNE_CLIPBOARD_READ",
        CLOCK: b"TWYNE_CLIPBOARD_CLOCK",
    }
}

/// Validated formats for one copy, with one aggregate allocation budget.
#[derive(Clone, Debug)]
pub struct ClipboardOffer {
    pub text: Arc<str>,
    pub html: Option<Arc<str>>,
    pub native_metadata: Option<Arc<str>>,
}

impl ClipboardOffer {
    pub fn rich(fragment: &RichFragment) -> Result<Self> {
        let offer = Self {
            text: fragment.plain_text().into(),
            html: Some(fragment.to_external_html()?.into()),
            native_metadata: Some(fragment.to_clipboard_metadata()?.into()),
        };
        offer.validate()?;
        Ok(offer)
    }

    pub fn validate(&self) -> Result<()> {
        if self
            .html
            .as_ref()
            .is_some_and(|html| html.len() > HTML_LIMITS.bytes)
            || self.text.len() > MAX_BYTES
            || self
                .native_metadata
                .as_ref()
                .is_some_and(|metadata| metadata.len() > MAX_BYTES)
            || self
                .text
                .len()
                .saturating_add(self.html.as_ref().map_or(0, |value| value.len()))
                .saturating_add(self.native_metadata.as_ref().map_or(0, |value| value.len()))
                > MAX_BYTES
        {
            bail!("The clipboard exceeds the 64 MiB transfer budget");
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelectionOwner {
    window: Window,
    timestamp: Option<u32>,
    local_generation: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ClipboardSnapshot {
    pub owner: SelectionOwner,
    pub text: String,
    pub html: Option<String>,
    pub native_metadata: Option<String>,
    pub rtf_offered: bool,
    /// Explicit-boundary diagnostics: actual MIME conversions using INCR.
    pub incremental_transfers: usize,
}

#[derive(Clone, Debug)]
pub enum ClipboardPaste {
    Rich(RichFragment),
    Plain(String),
    Empty,
}

/// The owner request is queued without waiting for another process. Waiting
/// for acknowledgement belongs on the background executor.
pub struct ClipboardPublication(mpsc::Receiver<Result<SelectionOwner>>);

impl ClipboardPublication {
    pub fn wait(self) -> Result<SelectionOwner> {
        self.0
            .recv_timeout(DEADLINE)
            .context("The clipboard owner did not acknowledge this copy")?
    }
}

impl ClipboardSnapshot {
    pub fn paste(&self) -> Result<ClipboardPaste, EditorError> {
        if let Some(metadata) = &self.native_metadata
            && let Some(fragment) = RichFragment::from_clipboard_metadata(metadata, &self.text)?
        {
            return Ok(ClipboardPaste::Rich(fragment));
        }
        if let Some(html) = &self.html
            && !html.is_empty()
        {
            return RichFragment::from_external_html(html).map(ClipboardPaste::Rich);
        }
        if !self.text.is_empty() {
            return Ok(ClipboardPaste::Plain(self.text.clone()));
        }
        if self.rtf_offered {
            return Err(EditorError::Clipboard("This clipboard offers RTF without HTML or plain text; RTF import is not yet available".into()));
        }
        Ok(ClipboardPaste::Empty)
    }
}

struct Context {
    connection: RustConnection,
    window: Window,
    atoms: Atoms,
}

impl Context {
    fn connect(display: Option<&str>) -> Result<Self> {
        let (connection, screen) = RustConnection::connect(display)?;
        let root = &connection.setup().roots[screen];
        let window = connection.generate_id()?;
        connection
            .create_window(
                COPY_DEPTH_FROM_PARENT,
                window,
                root.root,
                0,
                0,
                1,
                1,
                0,
                WindowClass::INPUT_OUTPUT,
                root.root_visual,
                &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
            )?
            .check()?;
        let atoms = Atoms::new(&connection)?.reply()?;
        connection.flush()?;
        Ok(Self {
            connection,
            window,
            atoms,
        })
    }

    fn owner(&self) -> Result<Window> {
        Ok(self
            .connection
            .get_selection_owner(self.atoms.CLIPBOARD)?
            .reply()?
            .owner)
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        if let Ok(cookie) = self.connection.destroy_window(self.window) {
            cookie.ignore_error();
        }
        let _ = self.connection.flush();
    }
}

enum OwnerCommand {
    Publish(Arc<ClipboardOffer>, mpsc::Sender<Result<SelectionOwner>>),
    Stop,
}

struct OwnedOffer {
    offer: Arc<ClipboardOffer>,
    identity: SelectionOwner,
}

struct Inner {
    reader: Mutex<Context>,
    owned: Arc<Mutex<Option<OwnedOffer>>>,
    commands: mpsc::SyncSender<OwnerCommand>,
    owner_window: Window,
}

impl Drop for Inner {
    fn drop(&mut self) {
        let _ = self.commands.try_send(OwnerCommand::Stop);
    }
}

/// Cheap clone; a dedicated owner thread serves the selected MIME formats.
#[derive(Clone)]
pub struct X11Clipboard {
    inner: Arc<Inner>,
}

impl X11Clipboard {
    /// `display` is explicit in probes. Root uses `None` only after checking
    /// `cx.compositor_name() == "X11"` on the actual native application.
    pub fn connect(display: Option<&str>) -> Result<Self> {
        let owner = Context::connect(display)?;
        let reader = Context::connect(display)?;
        let owner_window = owner.window;
        let owned = Arc::new(Mutex::new(None));
        let shared = owned.clone();
        let (commands, receive) = mpsc::sync_channel(2);
        thread::Builder::new()
            .name("twyne-rich-clipboard".into())
            .spawn(move || {
                owner_loop(owner, shared, receive);
            })?;
        Ok(Self {
            inner: Arc::new(Inner {
                reader: Mutex::new(reader),
                owned,
                commands,
                owner_window,
            }),
        })
    }

    /// Copy is explicit; publication is acknowledged before claiming success.
    pub fn publish(&self, offer: ClipboardOffer) -> Result<SelectionOwner> {
        self.begin_publish(offer)?.wait()
    }

    pub fn begin_publish(&self, offer: ClipboardOffer) -> Result<ClipboardPublication> {
        offer.validate()?;
        let (send, receive) = mpsc::channel();
        self.inner
            .commands
            .try_send(OwnerCommand::Publish(Arc::new(offer), send))
            .map_err(|_| anyhow!("The clipboard is busy; copy again"))?;
        Ok(ClipboardPublication(receive))
    }

    /// Performs bounded selection conversion; call on a background executor.
    pub fn read(&self) -> Result<Option<ClipboardSnapshot>> {
        let context = self
            .inner
            .reader
            .lock()
            .map_err(|_| anyhow!("The clipboard reader is unavailable"))?;
        let deadline = Instant::now() + DEADLINE;
        let window = context.owner()?;
        if window == NONE {
            return Ok(None);
        }
        if window == self.inner.owner_window {
            let owned = self
                .inner
                .owned
                .lock()
                .map_err(|_| anyhow!("The clipboard cache is unavailable"))?;
            if let Some(owned) = &*owned {
                return Ok(Some(ClipboardSnapshot {
                    owner: owned.identity,
                    text: owned.offer.text.to_string(),
                    html: owned.offer.html.as_ref().map(|value| value.to_string()),
                    native_metadata: owned
                        .offer
                        .native_metadata
                        .as_ref()
                        .map(|value| value.to_string()),
                    rtf_offered: false,
                    incremental_transfers: 0,
                }));
            }
        }
        let targets = request(&context, window, context.atoms.TARGETS, 1024, deadline)?;
        let targets = targets.map(|data| data.atoms).unwrap_or_default();
        let timestamp = if targets.contains(&context.atoms.TIMESTAMP) {
            request(&context, window, context.atoms.TIMESTAMP, 4, deadline)?
                .and_then(|data| data.atoms.first().copied())
        } else {
            None
        };
        let owner = SelectionOwner {
            window,
            timestamp,
            local_generation: None,
        };
        let mut budget = MAX_BYTES;
        let mut incremental_transfers = 0;
        let mut text = String::new();
        for target in [
            context.atoms.UTF8_STRING,
            context.atoms.PLAIN,
            context.atoms.PLAIN_ALT,
            context.atoms.PLAIN_ANY,
            AtomEnum::STRING.into(),
        ] {
            if !targets.is_empty() && !targets.contains(&target) {
                continue;
            }
            if let Some(data) = request(&context, window, target, budget, deadline)? {
                incremental_transfers += usize::from(data.incremental);
                budget = budget.saturating_sub(data.bytes.len());
                text = if target == u32::from(AtomEnum::STRING) {
                    let value: String = data.bytes.iter().map(|byte| char::from(*byte)).collect();
                    if value.len() > MAX_BYTES {
                        bail!("The clipboard text exceeds its transfer budget");
                    }
                    value
                } else {
                    decode_text(&data.bytes, MAX_BYTES)?
                };
                break;
            }
        }
        let native_metadata = if targets.contains(&context.atoms.NATIVE) {
            request(&context, window, context.atoms.NATIVE, budget, deadline)?
                .map(|data| {
                    incremental_transfers += usize::from(data.incremental);
                    budget = budget.saturating_sub(data.bytes.len());
                    decode_text(&data.bytes, MAX_BYTES)
                })
                .transpose()?
        } else {
            None
        };
        let mut html = None;
        for target in [context.atoms.HTML_UTF8, context.atoms.HTML] {
            if targets.contains(&target)
                && let Some(data) = request(
                    &context,
                    window,
                    target,
                    HTML_LIMITS.bytes.min(budget),
                    deadline,
                )?
            {
                incremental_transfers += usize::from(data.incremental);
                html = Some(decode_text(&data.bytes, HTML_LIMITS.bytes)?);
                break;
            }
        }
        if text
            .len()
            .saturating_add(native_metadata.as_ref().map_or(0, String::len))
            .saturating_add(html.as_ref().map_or(0, String::len))
            > MAX_BYTES
        {
            bail!("The decoded clipboard exceeds the 64 MiB transfer budget");
        }
        if context.owner()? != window {
            bail!("The clipboard changed while it was being read; paste again");
        }
        if let Some(timestamp) = timestamp
            && request(&context, window, context.atoms.TIMESTAMP, 4, deadline)?
                .and_then(|data| data.atoms.first().copied())
                != Some(timestamp)
        {
            bail!("The clipboard changed while it was being read; paste again");
        }
        Ok(Some(ClipboardSnapshot {
            owner,
            text,
            html,
            native_metadata,
            rtf_offered: targets.contains(&context.atoms.RTF)
                || targets.contains(&context.atoms.RTF_ALT),
            incremental_transfers,
        }))
    }

    /// The asynchronous paste result is never applied after a selection-owner
    /// change. TIMESTAMP catches same-window republishing when offered.
    pub fn is_current(&self, owner: SelectionOwner) -> Result<bool> {
        let context = self
            .inner
            .reader
            .lock()
            .map_err(|_| anyhow!("The clipboard reader is unavailable"))?;
        if context.owner()? != owner.window {
            return Ok(false);
        }
        if let Some(generation) = owner.local_generation {
            return Ok(self
                .inner
                .owned
                .lock()
                .map_err(|_| anyhow!("The clipboard cache is unavailable"))?
                .as_ref()
                .is_some_and(|owned| owned.identity.local_generation == Some(generation)));
        }
        if let Some(timestamp) = owner.timestamp {
            return Ok(request(
                &context,
                owner.window,
                context.atoms.TIMESTAMP,
                4,
                Instant::now() + DEADLINE,
            )?
            .and_then(|data| data.atoms.first().copied())
                == Some(timestamp));
        }
        Ok(true)
    }

    /// Final UI-thread ownership check never requests data from a clipboard
    /// peer. Full TIMESTAMP validation is performed in the background first.
    /// With no TIMESTAMP, a peer republishing from the same window cannot be
    /// distinguished; X11 offers no atomic read-and-insert lease.
    pub fn owner_window_is_current(&self, owner: SelectionOwner) -> Result<bool> {
        let context = self
            .inner
            .reader
            .try_lock()
            .map_err(|_| anyhow!("The clipboard is busy; paste again"))?;
        if context.owner()? != owner.window {
            return Ok(false);
        }
        if let Some(generation) = owner.local_generation {
            return Ok(self
                .inner
                .owned
                .lock()
                .map_err(|_| anyhow!("The clipboard cache is unavailable"))?
                .as_ref()
                .is_some_and(|owned| owned.identity.local_generation == Some(generation)));
        }
        Ok(true)
    }
}

struct Data {
    bytes: Vec<u8>,
    atoms: Vec<u32>,
    incremental: bool,
}

fn request(
    context: &Context,
    owner: Window,
    target: Atom,
    limit: usize,
    deadline: Instant,
) -> Result<Option<Data>> {
    let connection = &context.connection;
    let property = context.atoms.PROPERTY;
    while connection.poll_for_event()?.is_some() {}
    connection
        .delete_property(context.window, property)?
        .check()?;
    connection
        .convert_selection(
            context.window,
            context.atoms.CLIPBOARD,
            target,
            property,
            CURRENT_TIME,
        )?
        .check()?;
    connection.flush()?;
    loop {
        ensure_owner(context, owner, deadline)?;
        if let Some(Event::SelectionNotify(event)) = connection.poll_for_event()? {
            if event.requestor != context.window
                || event.selection != context.atoms.CLIPBOARD
                || event.target != target
            {
                continue;
            }
            if event.property == NONE {
                return Ok(None);
            }
            if event.property != property {
                bail!("The clipboard replied with an unexpected property");
            }
            break;
        }
        thread::sleep(POLL);
    }
    let first = connection
        .get_property(
            false,
            context.window,
            property,
            AtomEnum::ANY,
            0,
            (CHUNK_BYTES / 4) as u32,
        )?
        .reply()?;
    if first.type_ == context.atoms.INCR {
        let size = first
            .value32()
            .and_then(|mut values| values.next())
            // xclip publishes an empty format-32 INCR marker for large
            // properties. A missing hint needs no reservation; every actual
            // chunk still obeys the same total byte limit and deadline.
            .unwrap_or(0) as usize;
        if first.format != 32 || size > limit {
            bail!(
                "The clipboard transfer exceeds its size limit ({size} bytes advertised, {limit} allowed)"
            );
        }
        connection
            .delete_property(context.window, property)?
            .check()?;
        connection.flush()?;
        let mut bytes = Vec::with_capacity(size.min(CHUNK_BYTES));
        loop {
            ensure_owner(context, owner, deadline)?;
            if let Some(Event::PropertyNotify(event)) = connection.poll_for_event()? {
                if event.window != context.window
                    || event.atom != property
                    || event.state != Property::NEW_VALUE
                {
                    continue;
                }
                let first = connection
                    .get_property(
                        false,
                        context.window,
                        property,
                        AtomEnum::ANY,
                        0,
                        (CHUNK_BYTES / 4) as u32,
                    )?
                    .reply()?;
                let chunk = text_property(
                    context,
                    owner,
                    target,
                    first,
                    limit.saturating_sub(bytes.len()),
                    deadline,
                )?;
                if chunk.is_empty() {
                    return Ok(Some(Data {
                        bytes,
                        atoms: Vec::new(),
                        incremental: true,
                    }));
                }
                bytes.extend_from_slice(&chunk);
            } else {
                thread::sleep(POLL);
            }
        }
    }
    if target == context.atoms.TARGETS || target == context.atoms.TIMESTAMP {
        let expected = if target == context.atoms.TARGETS {
            AtomEnum::ATOM
        } else {
            AtomEnum::INTEGER
        };
        if first.format != 32
            || first.type_ != u32::from(expected)
            || first.bytes_after != 0
            || first.value.len() > limit
        {
            bail!("The clipboard supplied an invalid format list or timestamp");
        }
        let atoms = first
            .value32()
            .map(|values| values.collect())
            .unwrap_or_default();
        connection
            .delete_property(context.window, property)?
            .check()?;
        return Ok(Some(Data {
            bytes: first.value,
            atoms,
            incremental: false,
        }));
    }
    let bytes = text_property(context, owner, target, first, limit, deadline)?;
    Ok(Some(Data {
        bytes,
        atoms: Vec::new(),
        incremental: false,
    }))
}

fn text_property(
    context: &Context,
    owner: Window,
    target: Atom,
    first: x11rb::protocol::xproto::GetPropertyReply,
    limit: usize,
    deadline: Instant,
) -> Result<Vec<u8>> {
    let connection = &context.connection;
    let property = context.atoms.PROPERTY;
    if first.type_ != target || first.format != 8 {
        bail!("The clipboard supplied an unsupported text encoding");
    }
    if first.value.len().saturating_add(first.bytes_after as usize) > limit {
        bail!(
            "The clipboard transfer exceeds its size limit ({} property bytes, {limit} allowed)",
            first.value.len().saturating_add(first.bytes_after as usize)
        );
    }
    let mut bytes = first.value;
    let mut remaining = first.bytes_after;
    while remaining != 0 {
        ensure_owner(context, owner, deadline)?;
        let data = connection
            .get_property(
                false,
                context.window,
                property,
                target,
                (bytes.len() / 4) as u32,
                (CHUNK_BYTES / 4) as u32,
            )?
            .reply()?;
        if data.format != 8
            || data.type_ != target
            || data.value.is_empty()
            || bytes.len().saturating_add(data.value.len()) > limit
        {
            bail!("The clipboard supplied an invalid property chunk");
        }
        bytes.extend_from_slice(&data.value);
        remaining = data.bytes_after;
    }
    connection
        .delete_property(context.window, property)?
        .check()?;
    Ok(bytes)
}

fn ensure_owner(context: &Context, owner: Window, deadline: Instant) -> Result<()> {
    if Instant::now() >= deadline {
        bail!("The clipboard transfer timed out");
    }
    if context.owner()? != owner {
        bail!("The clipboard changed while it was being read; paste again");
    }
    Ok(())
}

fn decode_text(bytes: &[u8], limit: usize) -> Result<String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if !(bytes.len() - 2).is_multiple_of(2) {
            bail!("The clipboard contains incomplete UTF-16 text");
        }
        let little = bytes[0] == 0xff;
        let words = bytes[2..].as_chunks::<2>().0.iter().map(|pair| {
            if little {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        });
        let mut text = String::new();
        for character in char::decode_utf16(words) {
            let character = character.context("The clipboard contains invalid UTF-16 text")?;
            if text.len().saturating_add(character.len_utf8()) > limit {
                bail!("The clipboard text exceeds its size limit");
            }
            text.push(character);
        }
        return Ok(text.trim_end_matches('\0').to_string());
    }
    let bytes = bytes.strip_suffix(&[0]).unwrap_or(bytes);
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if bytes.len() > limit {
        bail!("The clipboard text exceeds its size limit");
    }
    Ok(std::str::from_utf8(bytes)
        .context("The clipboard does not contain UTF-8 or marked UTF-16 text")?
        .to_string())
}

struct Transfer {
    bytes: Arc<str>,
    position: usize,
    target: Atom,
    deadline: Instant,
}

fn owner_loop(
    context: Context,
    owned: Arc<Mutex<Option<OwnedOffer>>>,
    commands: mpsc::Receiver<OwnerCommand>,
) {
    let mut generation = 0u64;
    let mut timestamp = 0u32;
    let mut transfers = HashMap::new();
    loop {
        match commands.try_recv() {
            Ok(OwnerCommand::Publish(offer, reply)) => {
                let result = (|| -> Result<SelectionOwner> {
                    timestamp = server_time(&context)?;
                    context
                        .connection
                        .set_selection_owner(context.window, context.atoms.CLIPBOARD, timestamp)?
                        .check()?;
                    context.connection.flush()?;
                    if context.owner()? != context.window {
                        bail!("The clipboard ownership request was not accepted");
                    }
                    generation = generation.saturating_add(1);
                    let identity = SelectionOwner {
                        window: context.window,
                        timestamp: Some(timestamp),
                        local_generation: Some(generation),
                    };
                    *owned
                        .lock()
                        .map_err(|_| anyhow!("The clipboard cache is unavailable"))? =
                        Some(OwnedOffer { offer, identity });
                    Ok(identity)
                })();
                let _ = reply.send(result);
            }
            Ok(OwnerCommand::Stop) | Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        transfers.retain(|_, transfer: &mut Transfer| transfer.deadline > Instant::now());
        match context.connection.poll_for_event() {
            Ok(Some(Event::SelectionRequest(event))) => {
                if let Ok(owned) = owned.lock() {
                    let _ = serve_request(
                        &context,
                        &event,
                        owned.as_ref().map(|owned| &owned.offer),
                        timestamp,
                        &mut transfers,
                    );
                }
            }
            Ok(Some(Event::PropertyNotify(event))) if event.state == Property::DELETE => {
                let key = (event.window, event.atom);
                if let Some(transfer) = transfers.get_mut(&key) {
                    let end = (transfer.position + CHUNK_BYTES).min(transfer.bytes.len());
                    let bytes = &transfer.bytes.as_bytes()[transfer.position..end];
                    if context
                        .connection
                        .change_property8(
                            PropMode::REPLACE,
                            event.window,
                            event.atom,
                            transfer.target,
                            bytes,
                        )
                        .is_err()
                    {
                        transfers.remove(&key);
                        continue;
                    }
                    let _ = context.connection.flush();
                    if bytes.is_empty() {
                        transfers.remove(&key);
                    } else {
                        transfer.position = end;
                    }
                }
            }
            Ok(Some(Event::SelectionClear(event)))
                if event.selection == context.atoms.CLIPBOARD =>
            {
                if context.owner().ok() != Some(context.window) {
                    if let Ok(mut owned) = owned.lock() {
                        *owned = None;
                    }
                    transfers.clear();
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => thread::sleep(if transfers.is_empty() {
                IDLE_POLL
            } else {
                POLL
            }),
            Err(_) => break,
        }
    }
}

fn server_time(context: &Context) -> Result<u32> {
    context
        .connection
        .change_property8(
            PropMode::REPLACE,
            context.window,
            context.atoms.CLOCK,
            AtomEnum::STRING,
            &[0],
        )?
        .check()?;
    context.connection.flush()?;
    let deadline = Instant::now() + DEADLINE;
    loop {
        if Instant::now() >= deadline {
            bail!("The clipboard clock request timed out");
        }
        if let Some(Event::PropertyNotify(event)) = context.connection.poll_for_event()? {
            if event.window == context.window && event.atom == context.atoms.CLOCK {
                return Ok(event.time);
            }
        } else {
            thread::sleep(POLL);
        }
    }
}

fn serve_request(
    context: &Context,
    event: &SelectionRequestEvent,
    offer: Option<&Arc<ClipboardOffer>>,
    timestamp: u32,
    transfers: &mut HashMap<(Window, Atom), Transfer>,
) -> Result<()> {
    let mut notification = SelectionNotifyEvent {
        response_type: SELECTION_NOTIFY_EVENT,
        sequence: 0,
        time: event.time,
        requestor: event.requestor,
        selection: event.selection,
        target: event.target,
        property: NONE,
    };
    let property = if event.property == NONE {
        event.target
    } else {
        event.property
    };
    if event.selection == context.atoms.CLIPBOARD
        && let Some(offer) = offer
    {
        if event.target == context.atoms.TARGETS {
            let mut targets = vec![
                context.atoms.TARGETS,
                context.atoms.TIMESTAMP,
                context.atoms.UTF8_STRING,
                context.atoms.PLAIN,
                context.atoms.PLAIN_ALT,
                context.atoms.PLAIN_ANY,
            ];
            if offer.html.is_some() {
                targets.extend([context.atoms.HTML, context.atoms.HTML_UTF8]);
            }
            if offer.native_metadata.is_some() {
                targets.push(context.atoms.NATIVE);
            }
            context
                .connection
                .change_property32(
                    PropMode::REPLACE,
                    event.requestor,
                    property,
                    AtomEnum::ATOM,
                    &targets,
                )?
                .check()?;
            notification.property = property;
        } else if event.target == context.atoms.TIMESTAMP {
            context
                .connection
                .change_property32(
                    PropMode::REPLACE,
                    event.requestor,
                    property,
                    AtomEnum::INTEGER,
                    &[timestamp],
                )?
                .check()?;
            notification.property = property;
        } else {
            let bytes = if [
                context.atoms.UTF8_STRING,
                context.atoms.PLAIN,
                context.atoms.PLAIN_ALT,
                context.atoms.PLAIN_ANY,
            ]
            .contains(&event.target)
            {
                Some(offer.text.clone())
            } else if [context.atoms.HTML, context.atoms.HTML_UTF8].contains(&event.target) {
                offer.html.clone()
            } else if event.target == context.atoms.NATIVE {
                offer.native_metadata.clone()
            } else {
                None
            };
            if let Some(bytes) = bytes {
                if bytes.len() <= CHUNK_BYTES {
                    context
                        .connection
                        .change_property8(
                            PropMode::REPLACE,
                            event.requestor,
                            property,
                            event.target,
                            bytes.as_bytes(),
                        )?
                        .check()?;
                    notification.property = property;
                } else if transfers.len() < MAX_TRANSFERS
                    && transfers
                        .values()
                        .map(|transfer| transfer.bytes.len())
                        .sum::<usize>()
                        .saturating_add(bytes.len())
                        <= MAX_BYTES
                {
                    context
                        .connection
                        .change_window_attributes(
                            event.requestor,
                            &ChangeWindowAttributesAux::new()
                                .event_mask(EventMask::PROPERTY_CHANGE),
                        )?
                        .check()?;
                    context
                        .connection
                        .change_property32(
                            PropMode::REPLACE,
                            event.requestor,
                            property,
                            context.atoms.INCR,
                            &[bytes.len() as u32],
                        )?
                        .check()?;
                    transfers.insert(
                        (event.requestor, property),
                        Transfer {
                            bytes,
                            position: 0,
                            target: event.target,
                            deadline: Instant::now() + DEADLINE,
                        },
                    );
                    notification.property = property;
                }
            }
        }
    }
    context
        .connection
        .send_event(false, event.requestor, EventMask::NO_EVENT, notification)?
        .check()?;
    context.connection.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_decode_keeps_unicode_and_rejects_invalid_or_over_budget_data() {
        assert_eq!(decode_text("🦊東京".as_bytes(), 10).unwrap(), "🦊東京");
        let mut utf16 = vec![0xff, 0xfe];
        for unit in "🦊東京".encode_utf16() {
            utf16.extend(unit.to_le_bytes());
        }
        assert_eq!(decode_text(&utf16, 10).unwrap(), "🦊東京");
        assert!(decode_text(&utf16, 9).is_err());
        assert!(decode_text(&[0xff, 0xfe, 0x00, 0xd8], 10).is_err());
        assert!(decode_text(&[0xff], 10).is_err());
        assert!(
            ClipboardOffer {
                text: "x".repeat(MAX_BYTES + 1).into(),
                html: None,
                native_metadata: None
            }
            .validate()
            .is_err()
        );
    }
}
