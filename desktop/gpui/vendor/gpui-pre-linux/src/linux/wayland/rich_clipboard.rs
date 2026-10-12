//! Opt-in rich selection transport on the application's existing Wayland
//! connection. Protocol requests run on its calloop thread; only bounded pipe
//! I/O runs in the background. This does not use data-control or open a second
//! connection. Primary selection and GPUI's ordinary clipboard are unchanged.

use std::{
    cell::RefCell,
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    os::fd::{AsRawFd, BorrowedFd, OwnedFd},
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context as _, Result, bail};
use calloop::channel::{Channel, SyncSender, sync_channel};
use filedescriptor::{FileDescriptor, Pipe};
use wayland_client::{
    Connection, Dispatch, Proxy, QueueHandle,
    backend::ObjectId,
    protocol::{
        wl_data_device::WlDataDevice, wl_data_device_manager::WlDataDeviceManager,
        wl_data_offer::WlDataOffer, wl_data_source::WlDataSource,
    },
};

pub const NATIVE_MIME: &str = "application/x-twyne-rich-fragment+json";
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_HTML_BYTES: usize = 32 * 1024 * 1024;
const MAX_TRANSFERS: usize = 8;
const MAX_OFFERS: usize = 8;
const MAX_MIMES: usize = 64;
const MAX_MIME_BYTES: usize = 256;
const CHUNK_BYTES: usize = 64 * 1024;
const DEADLINE: Duration = Duration::from_secs(4);
const POLL: Duration = Duration::from_millis(25);
const TEXT_MIMES: [&str; 4] = [
    "text/plain;charset=utf-8",
    "text/plain;charset=UTF-8",
    "UTF8_STRING",
    "text/plain",
];
const HTML_MIMES: [&str; 3] = [
    "text/html",
    "text/html;charset=utf-8",
    "text/html;charset=UTF-8",
];

static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);
thread_local! {
    static CURRENT: RefCell<Weak<HandleCore>> = RefCell::new(Weak::new());
}

/// Only populated by the actual application's Wayland client on its own UI
/// thread. Headless/X11 callers get None, regardless of inherited environment.
pub fn current_rich_clipboard() -> Option<RichClipboardHandle> {
    CURRENT.with(|slot| {
        let core = slot.borrow().upgrade()?;
        core.shared
            .alive
            .load(Ordering::Acquire)
            .then_some(RichClipboardHandle(core))
    })
}

#[derive(Clone, Debug)]
pub struct Formats {
    pub text: Arc<str>,
    pub html: Option<Arc<str>>,
    pub native_metadata: Option<Arc<str>>,
}

impl Formats {
    pub fn validate(&self) -> Result<()> {
        let total = self
            .text
            .len()
            .saturating_add(self.html.as_ref().map_or(0, |value| value.len()))
            .saturating_add(self.native_metadata.as_ref().map_or(0, |value| value.len()));
        if self
            .html
            .as_ref()
            .is_some_and(|value| value.len() > MAX_HTML_BYTES)
            || total > MAX_BYTES
        {
            bail!("The clipboard exceeds the 64 MiB transfer or 32 MiB HTML budget");
        }
        Ok(())
    }

    fn bytes_for(&self, mime: &str) -> Option<Arc<str>> {
        if TEXT_MIMES.contains(&mime) {
            Some(self.text.clone())
        } else if HTML_MIMES.contains(&mime) {
            self.html.clone()
        } else if mime == NATIVE_MIME {
            self.native_metadata.clone()
        } else {
            None
        }
    }

    fn mimes(&self) -> Vec<&'static str> {
        let mut mimes = TEXT_MIMES.to_vec();
        if self.html.is_some() {
            mimes.extend(HTML_MIMES);
        }
        if self.native_metadata.is_some() {
            mimes.push(NATIVE_MIME);
        }
        mimes
    }
}

/// An observed selection offer from this exact client, never a claimed global
/// clipboard-owner query. Newly delivered selection/offer destruction events
/// invalidate its generation; the UI must also recheck focus and document state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelectionToken {
    instance: u64,
    generation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicationToken {
    pub generation: u64,
    pub input_serial: u32,
    focus_epoch: u64,
}

#[derive(Debug)]
pub struct ReceivedFormats {
    pub selection: SelectionToken,
    pub text: Option<String>,
    pub html: Option<String>,
    pub native_metadata: Option<String>,
    pub rtf_offered: bool,
}

struct Shared {
    instance: u64,
    generation: AtomicU64,
    alive: AtomicBool,
    active: AtomicUsize,
    focus_epoch: AtomicU64,
    publication: AtomicU64,
}

impl Shared {
    fn token(&self) -> SelectionToken {
        SelectionToken {
            instance: self.instance,
            generation: self.generation.load(Ordering::Acquire),
        }
    }
    fn current(&self, token: SelectionToken) -> bool {
        self.alive.load(Ordering::Acquire) && self.token() == token
    }
    fn changed(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
    fn publication_current(&self, token: PublicationToken) -> bool {
        self.alive.load(Ordering::Acquire)
            && self.focus_epoch.load(Ordering::Acquire) == token.focus_epoch
            && self.publication.load(Ordering::Acquire) == token.generation
            && token.generation != 0
    }
    fn permit(self: &Arc<Self>) -> Result<Permit> {
        if !self.alive.load(Ordering::Acquire) {
            bail!("The Wayland clipboard is closed");
        }
        self.active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_TRANSFERS).then_some(count + 1)
            })
            .map_err(|_| anyhow::anyhow!("Too many Wayland clipboard transfers are active"))?;
        Ok(Permit(self.clone()))
    }
}

pub(crate) struct Permit(Arc<Shared>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}

struct HandleCore {
    sender: SyncSender<Request>,
    shared: Arc<Shared>,
}

/// Cloneable, Send+Sync bridge; it does not retain a GPUI entity/window/client.
#[derive(Clone)]
pub struct RichClipboardHandle(Arc<HandleCore>);

impl RichClipboardHandle {
    pub fn begin_publish(&self, formats: Formats) -> Result<PendingPublication> {
        formats.validate()?;
        let permit = self.0.shared.permit()?;
        let (sender, receiver) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + DEADLINE;
        let focus_epoch = self.0.shared.focus_epoch.load(Ordering::Acquire);
        self.0
            .sender
            .try_send(Request::Publish {
                formats: Arc::new(formats),
                sender,
                cancelled: cancelled.clone(),
                deadline,
                focus_epoch,
                _permit: permit,
            })
            .map_err(|_| {
                anyhow::anyhow!("The Wayland clipboard request queue is unavailable or full")
            })?;
        Ok(PendingPublication {
            receiver,
            cancelled,
            deadline,
            shared: self.0.shared.clone(),
        })
    }

    /// Wait/pipe reads must run off the UI thread; queuing itself never blocks.
    pub fn begin_read(&self) -> Result<PendingRead> {
        let permit = self.0.shared.permit()?;
        let (sender, receiver) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + DEADLINE;
        self.0
            .sender
            .try_send(Request::Read {
                sender,
                cancelled: cancelled.clone(),
                deadline,
                permit,
            })
            .map_err(|_| {
                anyhow::anyhow!("The Wayland clipboard request queue is unavailable or full")
            })?;
        Ok(PendingRead {
            receiver,
            cancelled,
            deadline,
            shared: self.0.shared.clone(),
        })
    }

    pub fn is_current(&self, selection: SelectionToken) -> bool {
        self.0.shared.current(selection)
    }

    /// Recheck on the foreground thread before a deferred Cut changes the
    /// document. A new focus epoch/source cancellation invalidates its receipt.
    pub fn is_publication_current(&self, publication: PublicationToken) -> bool {
        self.0.shared.publication_current(publication)
    }

    /// Cancel pending reads without changing the compositor's selection or
    /// clearing a foreign clipboard. The next request snapshots a new token.
    pub fn cancel_reads(&self) {
        self.0.shared.changed();
    }
}

pub struct PendingPublication {
    receiver: mpsc::Receiver<Result<PublicationToken>>,
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
    shared: Arc<Shared>,
}

impl PendingPublication {
    /// This acknowledges a flushed set_selection request with an actual input
    /// serial. Core Wayland supplies no acknowledgement of selection acceptance.
    pub fn wait(self) -> Result<PublicationToken> {
        let token = self
            .receiver
            .recv_timeout(self.deadline.saturating_duration_since(Instant::now()))
            .context("The Wayland clipboard did not process this copy before its deadline")??;
        if !self.shared.publication_current(token) {
            bail!("Wayland clipboard copy lost its focus or source before completion");
        }
        Ok(token)
    }
}
impl Drop for PendingPublication {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

pub struct PendingRead {
    receiver: mpsc::Receiver<Result<Option<ReadPipes>>>,
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
    shared: Arc<Shared>,
}

impl PendingRead {
    pub fn wait(self) -> Result<Option<ReceivedFormats>> {
        let Some(pipes) = self
            .receiver
            .recv_timeout(self.deadline.saturating_duration_since(Instant::now()))
            .context("The Wayland clipboard did not process this paste before its deadline")??
        else {
            return Ok(None);
        };
        let mut result = ReceivedFormats {
            selection: pipes.selection,
            text: None,
            html: None,
            native_metadata: None,
            rtf_offered: pipes.rtf_offered,
        };
        let mut budget = MAX_BYTES;
        for (kind, fd) in pipes.pipes {
            check_live(
                &self.shared,
                &self.cancelled,
                self.deadline,
                Some(pipes.selection),
            )?;
            let bytes = read_pipe(
                fd,
                &self.shared,
                &self.cancelled,
                self.deadline,
                pipes.selection,
                budget.min(kind.limit()),
            )?;
            budget -= bytes.len();
            let value = String::from_utf8(bytes).context("Wayland clipboard data is not UTF-8")?;
            match kind {
                MimeKind::Text => result.text = Some(value),
                MimeKind::Html => result.html = Some(value),
                MimeKind::Native => result.native_metadata = Some(value),
            }
        }
        check_live(
            &self.shared,
            &self.cancelled,
            self.deadline,
            Some(pipes.selection),
        )?;
        Ok(Some(result))
    }
}
impl Drop for PendingRead {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

#[derive(Clone, Copy)]
enum MimeKind {
    Text,
    Html,
    Native,
}
impl MimeKind {
    fn limit(self) -> usize {
        match self {
            Self::Html => MAX_HTML_BYTES,
            _ => MAX_BYTES,
        }
    }
}

pub(crate) struct ReadPipes {
    selection: SelectionToken,
    pipes: Vec<(MimeKind, FileDescriptor)>,
    rtf_offered: bool,
    _permit: Permit,
}

pub(crate) enum Request {
    Publish {
        formats: Arc<Formats>,
        sender: mpsc::Sender<Result<PublicationToken>>,
        cancelled: Arc<AtomicBool>,
        deadline: Instant,
        focus_epoch: u64,
        _permit: Permit,
    },
    Read {
        sender: mpsc::Sender<Result<Option<ReadPipes>>>,
        cancelled: Arc<AtomicBool>,
        deadline: Instant,
        permit: Permit,
    },
}

#[derive(Clone)]
struct Offer {
    proxy: WlDataOffer,
    mimes: Vec<String>,
}
struct OwnedSource {
    proxy: WlDataSource,
    generation: u64,
    formats: Arc<Formats>,
    cancelled: Arc<AtomicBool>,
}

/// Main-thread protocol state. Existing client dispatch must forward offer,
/// selection, send/cancelled and shutdown events; see the integration patch.
pub(crate) struct RichClipboard {
    connection: Connection,
    handle: RichClipboardHandle,
    offers: HashMap<ObjectId, Offer>,
    selection: Option<Offer>,
    sources: HashMap<ObjectId, OwnedSource>,
    publication: u64,
    press_serial: Option<u32>,
}

/// Snapshot taken by the existing client on its own protocol thread, never
/// manufactured from an environment variable or a different connection.
pub(crate) struct SelectionContext<'a, D> {
    pub manager: Option<&'a WlDataDeviceManager>,
    pub device: Option<&'a WlDataDevice>,
    pub queue: &'a QueueHandle<D>,
    pub serial: Option<u32>,
    pub focused: bool,
    pub self_mime: &'a str,
}

impl RichClipboard {
    pub(crate) fn new(connection: Connection) -> (Self, Channel<Request>) {
        let (sender, channel) = sync_channel(MAX_TRANSFERS);
        let shared = Arc::new(Shared {
            instance: NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed),
            generation: AtomicU64::new(0),
            alive: AtomicBool::new(true),
            active: AtomicUsize::new(0),
            focus_epoch: AtomicU64::new(0),
            publication: AtomicU64::new(0),
        });
        let handle = RichClipboardHandle(Arc::new(HandleCore { sender, shared }));
        CURRENT.with(|slot| *slot.borrow_mut() = Arc::downgrade(&handle.0));
        (
            Self {
                connection,
                handle,
                offers: HashMap::new(),
                selection: None,
                sources: HashMap::new(),
                publication: 0,
                press_serial: None,
            },
            channel,
        )
    }

    pub(crate) fn announce(&mut self, proxy: WlDataOffer) {
        if self.offers.len() >= MAX_OFFERS {
            let current = self.selection.as_ref().map(|offer| offer.proxy.id());
            if let Some(old) = self
                .offers
                .keys()
                .find(|id| Some(*id) != current.as_ref())
                .cloned()
            {
                self.offers.remove(&old);
            }
        }
        self.offers.insert(
            proxy.id(),
            Offer {
                proxy,
                mimes: Vec::new(),
            },
        );
    }
    pub(crate) fn mime(&mut self, proxy: &WlDataOffer, mime: &str) {
        if mime.len() > MAX_MIME_BYTES {
            return;
        }
        if let Some(offer) = self.offers.get_mut(&proxy.id())
            && offer.mimes.len() < MAX_MIMES
            && !offer.mimes.iter().any(|item| item == mime)
        {
            offer.mimes.push(mime.to_owned());
        }
    }
    pub(crate) fn selected(&mut self, proxy: Option<&WlDataOffer>) {
        self.handle.0.shared.changed();
        self.selection = proxy.and_then(|proxy| self.offers.get(&proxy.id()).cloned());
    }
    /// Called BEFORE the existing owner destroys a proxy; no new request may
    /// target that offer after this callback. This module never destroys it.
    pub(crate) fn offer_destroyed(&mut self, id: &ObjectId) {
        self.offers.remove(id);
        if self
            .selection
            .as_ref()
            .is_some_and(|offer| offer.proxy.id() == *id)
        {
            self.selection = None;
            self.handle.0.shared.changed();
        }
    }
    pub(crate) fn focus_lost(&mut self) {
        // Core selection offers cease to be valid when keyboard focus is
        // lost. A fresh selection event precedes the next keyboard enter.
        self.selection = None;
        self.press_serial = None;
        self.handle
            .0
            .shared
            .focus_epoch
            .fetch_add(1, Ordering::AcqRel);
        self.handle.0.shared.changed();
    }

    /// The existing client forwards only real press events while this seat's
    /// keyboard focus belongs to an application window. Enter/release/hover
    /// serials never qualify. A new focus epoch requires a fresh press.
    pub(crate) fn input_pressed(&mut self, serial: u32) {
        self.press_serial = Some(serial);
    }
    pub(crate) fn input_serial(&self) -> Option<u32> {
        self.press_serial
    }
    pub(crate) fn focus_entered(&mut self) {
        self.press_serial = None;
        self.handle
            .0
            .shared
            .focus_epoch
            .fetch_add(1, Ordering::AcqRel);
        // The core protocol delivers the fresh selection BEFORE keyboard
        // enter. Preserve that offer while invalidating the old press epoch.
    }

    /// Called only on the actual GPUI Wayland event loop. Returns formats only
    /// after publication so the caller can update GPUI's internal self-MIME
    /// cache without replacing an unrelated clipboard on rejected requests.
    pub(crate) fn dispatch<D, U>(
        &mut self,
        request: Request,
        context: SelectionContext<'_, D>,
        source_data: impl Fn(u64) -> U,
    ) -> Option<Arc<Formats>>
    where
        D: Dispatch<WlDataSource, U> + 'static,
        U: Send + Sync + 'static,
    {
        let SelectionContext {
            manager,
            device,
            queue,
            serial,
            focused,
            self_mime,
        } = context;
        match request {
            Request::Publish {
                formats,
                sender,
                cancelled,
                deadline,
                focus_epoch,
                _permit,
            } => {
                let result = (|| {
                    check_live(&self.handle.0.shared, &cancelled, deadline, None)?;
                    if self.handle.0.shared.focus_epoch.load(Ordering::Acquire) != focus_epoch {
                        bail!("Wayland clipboard copy lost its input focus epoch");
                    }
                    let serial = selection_serial(
                        focused,
                        serial.filter(|serial| self.press_serial == Some(*serial)),
                    )?;
                    let manager =
                        manager.context("This Wayland seat has no data-device manager")?;
                    let device = device.context("This Wayland seat has no data device")?;
                    if self.sources.len() >= MAX_TRANSFERS {
                        bail!("Too many Wayland clipboard sources are active");
                    }
                    self.publication = self.publication.wrapping_add(1).max(1);
                    let generation = self.publication;
                    let proxy = manager.create_data_source(queue, source_data(generation));
                    for mime in formats.mimes() {
                        proxy.offer(mime.to_owned());
                    }
                    proxy.offer(self_mime.to_owned());
                    device.set_selection(Some(&proxy), serial);
                    if let Err(error) = self.connection.flush() {
                        proxy.destroy();
                        return Err(error.into());
                    }
                    self.handle.0.shared.changed();
                    // Do not read a previous foreign offer while waiting for
                    // the compositor to deliver the new selection offer.
                    self.selection = None;
                    self.sources.insert(
                        proxy.id(),
                        OwnedSource {
                            proxy,
                            generation,
                            formats: formats.clone(),
                            cancelled: Arc::new(AtomicBool::new(false)),
                        },
                    );
                    self.handle
                        .0
                        .shared
                        .publication
                        .store(generation, Ordering::Release);
                    Ok(PublicationToken {
                        generation,
                        input_serial: serial,
                        focus_epoch,
                    })
                })();
                let published = result.is_ok();
                let _ = sender.send(result);
                published.then_some(formats)
            }
            Request::Read {
                sender,
                cancelled,
                deadline,
                permit,
            } => {
                let result = (|| {
                    check_live(&self.handle.0.shared, &cancelled, deadline, None)?;
                    if !focused {
                        bail!("Wayland clipboard paste needs a focused application surface");
                    }
                    let Some(offer) = self.selection.as_ref() else {
                        return Ok(None);
                    };
                    if !offer.proxy.is_alive() {
                        bail!("The Wayland clipboard offer was destroyed");
                    }
                    let selection = self.handle.0.shared.token();
                    let wanted = [
                        (
                            MimeKind::Text,
                            TEXT_MIMES
                                .iter()
                                .find(|mime| offer.mimes.iter().any(|item| item == **mime))
                                .copied(),
                        ),
                        (
                            MimeKind::Native,
                            offer
                                .mimes
                                .iter()
                                .any(|item| item == NATIVE_MIME)
                                .then_some(NATIVE_MIME),
                        ),
                        (
                            MimeKind::Html,
                            HTML_MIMES
                                .iter()
                                .find(|mime| offer.mimes.iter().any(|item| item == **mime))
                                .copied(),
                        ),
                    ];
                    let mut pipes = Vec::new();
                    for (kind, mime) in wanted {
                        let Some(mime) = mime else {
                            continue;
                        };
                        let pipe = Pipe::new()?;
                        offer.proxy.receive(mime.to_owned(), unsafe {
                            BorrowedFd::borrow_raw(pipe.write.as_raw_fd())
                        });
                        drop(pipe.write);
                        pipes.push((kind, pipe.read));
                    }
                    self.connection.flush()?;
                    Ok(Some(ReadPipes {
                        selection,
                        pipes,
                        _permit: permit,
                        rtf_offered: offer
                            .mimes
                            .iter()
                            .any(|mime| matches!(mime.as_str(), "text/rtf" | "application/rtf")),
                    }))
                })();
                let _ = sender.send(result);
                None
            }
        }
    }

    pub(crate) fn send(
        &self,
        source: &WlDataSource,
        generation: u64,
        mime: &str,
        fd: OwnedFd,
    ) -> Result<()> {
        let Some(owned) = self
            .sources
            .get(&source.id())
            .filter(|owned| owned.generation == generation)
        else {
            return Ok(());
        };
        let Some(bytes) = owned.formats.bytes_for(mime) else {
            return Ok(());
        };
        let permit = self.handle.0.shared.permit()?;
        let shared = self.handle.0.shared.clone();
        let cancelled = owned.cancelled.clone();
        thread::Builder::new()
            .name("twyne-wayland-clipboard-send".into())
            .spawn(move || {
                let _permit = permit;
                if let Err(error) = write_pipe(
                    FileDescriptor::new(fd),
                    bytes.as_bytes(),
                    &shared,
                    &cancelled,
                    Instant::now() + DEADLINE,
                ) {
                    log::debug!("Wayland clipboard transfer ended: {error:#}");
                }
            })
            .context("The Wayland clipboard writer could not start")?;
        Ok(())
    }
    pub(crate) fn cancelled(&mut self, source: &WlDataSource, generation: u64) {
        if self
            .sources
            .get(&source.id())
            .is_some_and(|owned| owned.generation == generation)
            && let Some(owned) = self.sources.remove(&source.id())
        {
            owned.cancelled.store(true, Ordering::Release);
            if generation == self.publication {
                // Selection events, rather than a cancelled source, identify
                // the current offer. A replacement's selection event may
                // already have arrived; retain that unrelated foreign offer.
                self.handle.0.shared.changed();
                self.handle.0.shared.publication.store(0, Ordering::Release);
            }
            if owned.proxy.is_alive() {
                owned.proxy.destroy();
            }
        }
    }
    pub(crate) fn shutdown(&mut self) {
        self.handle.0.shared.alive.store(false, Ordering::Release);
        self.handle.0.shared.changed();
        self.selection = None;
        self.offers.clear();
        for (_, owned) in self.sources.drain() {
            owned.cancelled.store(true, Ordering::Release);
            if owned.proxy.is_alive() {
                owned.proxy.destroy();
            }
        }
        // Never set_selection(None): a foreign client may now own selection.
    }
}
impl Drop for RichClipboard {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn check_live(
    shared: &Shared,
    cancelled: &AtomicBool,
    deadline: Instant,
    selection: Option<SelectionToken>,
) -> Result<()> {
    if !shared.alive.load(Ordering::Acquire) {
        bail!("The Wayland clipboard is closed");
    }
    if cancelled.load(Ordering::Acquire) {
        bail!("The Wayland clipboard transfer was cancelled");
    }
    if selection.is_some_and(|token| !shared.current(token)) {
        bail!("The clipboard changed before paste; paste again");
    }
    if Instant::now() >= deadline {
        bail!("The Wayland clipboard transfer timed out");
    }
    Ok(())
}

fn selection_serial(focused: bool, serial: Option<u32>) -> Result<u32> {
    if !focused {
        bail!("Wayland clipboard copy needs a focused application surface");
    }
    serial.context("Wayland clipboard copy needs a real keyboard or pointer press serial")
}

fn ready(fd: &FileDescriptor, events: i16, deadline: Instant) -> Result<bool> {
    let mut poll = [filedescriptor::pollfd {
        fd: fd.as_raw_fd(),
        events,
        revents: 0,
    }];
    match filedescriptor::poll(
        &mut poll,
        Some(deadline.saturating_duration_since(Instant::now()).min(POLL)),
    ) {
        Ok(count) => Ok(count > 0),
        Err(filedescriptor::Error::Poll(error)) if error.kind() == ErrorKind::Interrupted => {
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

fn read_pipe(
    mut fd: FileDescriptor,
    shared: &Shared,
    cancelled: &AtomicBool,
    deadline: Instant,
    selection: SelectionToken,
    limit: usize,
) -> Result<Vec<u8>> {
    fd.set_non_blocking(true)?;
    let mut bytes = Vec::new();
    let mut chunk = [0; CHUNK_BYTES];
    loop {
        check_live(shared, cancelled, deadline, Some(selection))?;
        if !ready(&fd, filedescriptor::POLLIN, deadline)? {
            continue;
        }
        match fd.read(&mut chunk) {
            Ok(0) => return Ok(bytes),
            Ok(count) => {
                if count > limit.saturating_sub(bytes.len()) {
                    bail!("The Wayland clipboard exceeds its bounded transfer budget");
                }
                bytes.extend_from_slice(&chunk[..count]);
            }
            Err(error)
                if matches!(error.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock) => {}
            Err(error) => return Err(error.into()),
        }
    }
}

fn write_pipe(
    mut fd: FileDescriptor,
    bytes: &[u8],
    shared: &Shared,
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    fd.set_non_blocking(true)?;
    let mut written = 0;
    while written < bytes.len() {
        check_live(shared, cancelled, deadline, None)?;
        if !ready(&fd, filedescriptor::POLLOUT, deadline)? {
            continue;
        }
        match fd.write(&bytes[written..bytes.len().min(written + CHUNK_BYTES)]) {
            Ok(0) => bail!("The Wayland clipboard pipe closed before all bytes were written"),
            Ok(count) => written += count,
            Err(error)
                if matches!(error.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared() -> Arc<Shared> {
        Arc::new(Shared {
            instance: 17,
            generation: AtomicU64::new(3),
            alive: AtomicBool::new(true),
            active: AtomicUsize::new(0),
            focus_epoch: AtomicU64::new(0),
            publication: AtomicU64::new(0),
        })
    }

    #[test]
    fn publication_receipt_requires_the_same_focus_epoch_and_live_source() {
        let shared = shared();
        shared.publication.store(7, Ordering::Release);
        let receipt = PublicationToken {
            generation: 7,
            input_serial: 91,
            focus_epoch: 0,
        };
        assert!(shared.publication_current(receipt));
        shared.focus_epoch.fetch_add(1, Ordering::AcqRel);
        assert!(!shared.publication_current(receipt));
        let current_epoch = PublicationToken {
            focus_epoch: 1,
            ..receipt
        };
        assert!(shared.publication_current(current_epoch));
        shared.publication.store(0, Ordering::Release);
        assert!(!shared.publication_current(current_epoch));
        shared.publication.store(8, Ordering::Release);
        assert!(!shared.publication_current(current_epoch));
        shared.alive.store(false, Ordering::Release);
        assert!(!shared.publication_current(PublicationToken {
            generation: 8,
            ..current_epoch
        }));
    }

    #[test]
    fn real_input_serial_required_and_zero_is_valid() {
        assert!(selection_serial(true, None).is_err());
        assert!(selection_serial(false, Some(123)).is_err());
        assert_eq!(selection_serial(true, Some(0)).unwrap(), 0);
        assert_eq!(selection_serial(true, Some(u32::MAX)).unwrap(), u32::MAX);
    }

    #[test]
    fn formats_never_invent_html_or_native_metadata() {
        let plain = Formats {
            text: "<b>plain bytes</b>".into(),
            html: None,
            native_metadata: None,
        };
        assert!(plain.mimes().contains(&"text/plain;charset=utf-8"));
        assert!(!plain.mimes().contains(&"text/html"));
        assert!(plain.bytes_for("text/html").is_none());
        assert!(plain.bytes_for(NATIVE_MIME).is_none());
        assert_eq!(
            plain.bytes_for("UTF8_STRING").unwrap().as_ref(),
            "<b>plain bytes</b>"
        );
        let rich = Formats {
            html: Some("<p>real</p>".into()),
            native_metadata: Some("{\"actual\":true}".into()),
            ..plain
        };
        assert_eq!(
            rich.bytes_for("text/html;charset=utf-8").unwrap().as_ref(),
            "<p>real</p>"
        );
        assert!(rich.bytes_for("image/png").is_none());
        rich.validate().unwrap();
    }

    #[test]
    fn aggregate_and_html_budgets_are_explicit() {
        let offer = Formats {
            text: "".into(),
            html: Some("x".repeat(MAX_HTML_BYTES + 1).into()),
            native_metadata: None,
        };
        assert!(offer.validate().is_err());
        let offer = Formats {
            text: "x".repeat(MAX_BYTES).into(),
            html: None,
            native_metadata: Some("x".into()),
        };
        assert!(offer.validate().is_err());
    }

    #[test]
    fn transfers_are_bounded_and_released() {
        let shared = shared();
        let permits = (0..MAX_TRANSFERS)
            .map(|_| shared.permit().unwrap())
            .collect::<Vec<_>>();
        assert!(shared.permit().is_err());
        drop(permits);
        assert_eq!(shared.active.load(Ordering::Acquire), 0);
        shared.permit().unwrap();
        shared.alive.store(false, Ordering::Release);
        assert!(shared.permit().is_err());
    }

    #[test]
    fn stale_and_foreign_instance_tokens_are_rejected() {
        let shared = shared();
        let token = shared.token();
        assert!(shared.current(token));
        assert!(!shared.current(SelectionToken {
            instance: 18,
            ..token
        }));
        shared.changed();
        assert!(!shared.current(token));
        assert!(shared.current(shared.token()));
        shared.alive.store(false, Ordering::Release);
        assert!(!shared.current(shared.token()));
    }

    #[test]
    fn actual_large_pipe_roundtrip_preserves_utf8_and_bytes() {
        let shared = shared();
        let token = shared.token();
        let bytes = "🦊東京é\r\n#source[unchanged]\n"
            .repeat(80_000)
            .into_bytes();
        assert!(bytes.len() > CHUNK_BYTES);
        let pipe = Pipe::new().unwrap();
        let expected = bytes.clone();
        let writer_shared = shared.clone();
        let writer = thread::spawn(move || {
            write_pipe(
                pipe.write,
                &bytes,
                &writer_shared,
                &AtomicBool::new(false),
                Instant::now() + DEADLINE,
            )
        });
        let actual = read_pipe(
            pipe.read,
            &shared,
            &AtomicBool::new(false),
            Instant::now() + DEADLINE,
            token,
            MAX_BYTES,
        )
        .unwrap();
        writer.join().unwrap().unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn oversized_read_fails_without_publishing_partial_data() {
        let shared = shared();
        let mut pipe = Pipe::new().unwrap();
        pipe.write.write_all(b"123456789").unwrap();
        drop(pipe.write);
        let error = read_pipe(
            pipe.read,
            &shared,
            &AtomicBool::new(false),
            Instant::now() + DEADLINE,
            shared.token(),
            8,
        )
        .unwrap_err();
        assert!(error.to_string().contains("budget"));
    }

    #[test]
    fn absolute_deadline_rejects_a_slow_trickle() {
        let shared = shared();
        let pipe = Pipe::new().unwrap();
        let writer = thread::spawn(move || {
            let mut fd = pipe.write;
            for _ in 0..20 {
                if fd.write_all(b"x").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let start = Instant::now();
        let error = read_pipe(
            pipe.read,
            &shared,
            &AtomicBool::new(false),
            start + Duration::from_millis(75),
            shared.token(),
            MAX_BYTES,
        )
        .unwrap_err();
        assert!(error.to_string().contains("timed out"));
        assert!(start.elapsed() < Duration::from_millis(200));
        writer.join().unwrap();
    }

    #[test]
    fn backpressure_writer_has_an_absolute_deadline() {
        let shared = shared();
        let pipe = Pipe::new().unwrap();
        let _held_reader = pipe.read;
        let start = Instant::now();
        let error = write_pipe(
            pipe.write,
            &vec![b'x'; 2 * 1024 * 1024],
            &shared,
            &AtomicBool::new(false),
            start + Duration::from_millis(75),
        )
        .unwrap_err();
        assert!(error.to_string().contains("timed out"));
        assert!(start.elapsed() < Duration::from_millis(200));
    }

    #[test]
    fn selection_change_cancels_an_actual_pending_pipe() {
        let shared = shared();
        let token = shared.token();
        let pipe = Pipe::new().unwrap();
        let _held_writer = pipe.write;
        let changed = shared.clone();
        let changer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(15));
            changed.changed();
        });
        let start = Instant::now();
        let error = read_pipe(
            pipe.read,
            &shared,
            &AtomicBool::new(false),
            start + DEADLINE,
            token,
            MAX_BYTES,
        )
        .unwrap_err();
        assert!(error.to_string().contains("changed before paste"));
        assert!(start.elapsed() < Duration::from_millis(200));
        changer.join().unwrap();
    }

    #[test]
    fn shutdown_cancels_an_actual_pending_pipe() {
        let shared = shared();
        let token = shared.token();
        let pipe = Pipe::new().unwrap();
        let _held_writer = pipe.write;
        let stopped = shared.clone();
        let stopper = thread::spawn(move || {
            thread::sleep(Duration::from_millis(15));
            stopped.alive.store(false, Ordering::Release);
        });
        let start = Instant::now();
        let error = read_pipe(
            pipe.read,
            &shared,
            &AtomicBool::new(false),
            start + DEADLINE,
            token,
            MAX_BYTES,
        )
        .unwrap_err();
        assert!(error.to_string().contains("closed"));
        assert!(start.elapsed() < Duration::from_millis(200));
        stopper.join().unwrap();
    }

    #[test]
    fn dropping_a_request_cancels_it_without_a_selection_clear() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let (_, receiver) = mpsc::channel();
        let pending = PendingRead {
            receiver,
            cancelled: cancelled.clone(),
            deadline: Instant::now() + DEADLINE,
            shared: shared(),
        };
        drop(pending);
        assert!(cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn current_handle_requires_an_installed_application_client() {
        assert!(current_rich_clipboard().is_none());
    }
}
