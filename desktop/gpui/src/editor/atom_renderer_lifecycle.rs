//! Scoped atom-render presentation ownership, not a new renderer/fidelity.
//!
//! Explicit renderer assignment is authoritative. Epoch retirement cancels
//! publication immediately; synchronous compilation already running may still
//! finish its old immutable renderer cache. No completion may restore a held
//! explicit renderer or clean up another batch's task/busy markers.

use super::*;
use crate::inline_proof::AtomRenderResult;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct AtomScopeTicket {
    renderer: u64,
    owner: u64,
    generation: u64,
    read_only: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct AtomBatchTicket {
    scope: AtomScopeTicket,
    sequence: u64,
}

#[derive(Clone, Default)]
struct AtomCancellation(Arc<AtomicBool>);
impl AtomCancellation {
    fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    fn cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Default)]
pub(super) struct AtomRendererLifecycle {
    renderer_epoch: u64,
    owner_epoch: u64,
    next_batch: u64,
    active: Option<(AtomBatchTicket, AtomCancellation)>,
    exhausted: bool,
}

impl AtomRendererLifecycle {
    fn scope(&self, generation: u64, read_only: bool) -> Option<AtomScopeTicket> {
        (!self.exhausted).then_some(AtomScopeTicket {
            renderer: self.renderer_epoch,
            owner: self.owner_epoch,
            generation,
            read_only,
        })
    }
    fn matches_scope(&self, scope: AtomScopeTicket, generation: u64, read_only: bool) -> bool {
        self.scope(generation, read_only) == Some(scope)
    }
    fn retire(&mut self, renderer: bool) {
        if let Some((_, cancellation)) = self.active.take() {
            cancellation.cancel();
        }
        let counter = if renderer {
            &mut self.renderer_epoch
        } else {
            &mut self.owner_epoch
        };
        if let Some(next) = counter.checked_add(1) {
            *counter = next;
        } else {
            // Never wrap into an old identity or silently reset the epoch.
            self.exhausted = true;
        }
    }
    fn start(&mut self, scope: AtomScopeTicket) -> Option<(AtomBatchTicket, AtomCancellation)> {
        if self.exhausted
            || self.active.is_some()
            || scope.renderer != self.renderer_epoch
            || scope.owner != self.owner_epoch
        {
            return None;
        }
        let Some(sequence) = self.next_batch.checked_add(1) else {
            self.exhausted = true;
            return None;
        };
        self.next_batch = sequence;
        let ticket = AtomBatchTicket { scope, sequence };
        let cancellation = AtomCancellation::default();
        self.active = Some((ticket, cancellation.clone()));
        Some((ticket, cancellation))
    }
    fn accepts(&self, ticket: AtomBatchTicket, generation: u64, read_only: bool) -> bool {
        self.matches_scope(ticket.scope, generation, read_only)
            && self.active.as_ref().is_some_and(|(active, cancellation)| {
                *active == ticket && !cancellation.cancelled()
            })
    }
    fn finish(&mut self, ticket: AtomBatchTicket, generation: u64, read_only: bool) -> bool {
        if !self.accepts(ticket, generation, read_only) {
            return false;
        }
        if let Some((_, cancellation)) = self.active.take() {
            cancellation.cancel();
        }
        true
    }
}

impl Drop for AtomRendererLifecycle {
    fn drop(&mut self) {
        if let Some((_, cancellation)) = self.active.take() {
            cancellation.cancel();
        }
    }
}

/// The queued frame holds shared nodes, not serialized HTML or a new document.
pub(super) struct PendingAtom {
    scope: AtomScopeTicket,
    block: Arc<RichBlock>,
    request: AtomRenderRequest,
    key: AtomRenderKey,
}

struct AtomNodeReceipt {
    block_path: NodePath,
    block_node: Node,
    path: NodePath,
    node: Node,
    position: usize,
}

struct AtomJob {
    request: AtomRenderRequest,
    key: AtomRenderKey,
    target: AtomNodeReceipt,
}

struct AtomCompletion {
    job: AtomJob,
    result: AtomRenderResult,
}

fn node_payload_matches(node: &Node, request: &AtomRenderRequest) -> bool {
    let Some(element) = node.as_element() else {
        return false;
    };
    let kind = match element.kind {
        NodeKind::Math(display) => AtomKind::LatexMath {
            block: display == super::super::MathDisplay::Block,
        },
        NodeKind::Mermaid => AtomKind::Mermaid,
        // Raw Typst remains source-visible, as on the existing shape path.
        _ => return false,
    };
    kind == request.kind
        && element
            .shell
            .attr("data-typst-source")
            .or_else(|| element.shell.attr("data-latex"))
            .or_else(|| element.shell.attr("data-mermaid-source"))
            .unwrap_or("◊")
            == request.source.as_ref()
}

/// Follow one scalar branch using cached subtree lengths. Atom payloads and
/// other document blocks are not traversed or projected.
fn path_in_block(node: &Node, position: usize, expected: &Node, path: &mut NodePath) -> bool {
    if node.shares_storage_with(expected) {
        return position == 0 && node.projection_len() == 1;
    }
    let Some(element) = node.as_element() else {
        return false;
    };
    if element.kind.is_atom() || element.kind == NodeKind::NonContent {
        return false;
    }
    let mut start = 0;
    for (index, child) in element.children.iter().enumerate() {
        let end = start + child.projection_len();
        if start <= position && position < end {
            path.push(index);
            return path_in_block(child, position - start, expected, path);
        }
        start = end;
    }
    false
}

impl PendingAtom {
    fn prepare(self, document: &RichDocument) -> Option<AtomJob> {
        if !document
            .node(&self.block.path)
            .is_some_and(|node| node.shares_storage_with(&self.block.node))
        {
            return None;
        }
        let (node, local_position) = self.block.runs.iter().find_map(|run| {
            let RunContent::Object(node) = &run.content else {
                return None;
            };
            if run.range.len() != 1 || !node_payload_matches(node, &self.request) {
                return None;
            }
            // The writing cache uses zero-local blocks; model block() also
            // supports document-relative ranges. Both retain the same node.
            Some((
                node.clone(),
                run.range.start.checked_sub(self.block.range.start)?,
            ))
        })?;
        let mut path = self.block.path.clone();
        if !path_in_block(&self.block.node, local_position, &node, &mut path) {
            return None;
        }
        let position = document.offset_of_node(&path)?;
        Some(AtomJob {
            request: self.request,
            key: self.key,
            target: AtomNodeReceipt {
                block_path: self.block.path.clone(),
                block_node: self.block.node.clone(),
                path,
                node,
                position,
            },
        })
    }
}

impl AtomJob {
    fn current(&self, document: &RichDocument) -> bool {
        document
            .node(&self.target.block_path)
            .is_some_and(|node| node.shares_storage_with(&self.target.block_node))
            && document.offset_of_node(&self.target.path) == Some(self.target.position)
            && document.node(&self.target.path).is_some_and(|node| {
                node.shares_storage_with(&self.target.node)
                    && node_payload_matches(node, &self.request)
            })
    }
}

impl RichEditorView {
    pub(super) fn atom_request_ticket(&self) -> Option<AtomScopeTicket> {
        self.atom_lifecycle
            .scope(self.atom_generation, self.is_read_only())
    }

    /// Explicit boundaries only. The immutable current renderer/cache remains;
    /// all presentation jobs/keys and layout revision belong to the new scope.
    pub(super) fn retire_atom_owner(&mut self, cx: &mut Context<Self>) {
        self.retire_atom_presentation(false);
        cx.notify();
    }

    fn retire_atom_presentation(&mut self, renderer: bool) {
        self.atom_lifecycle.retire(renderer);
        self.atom_task = None;
        self.atom_pending.clear();
        self.atom_inflight.clear();
        self.atom_ready.clear();
        // Existing request/layout generation is retained, while the checked
        // monotonic lifecycle epochs independently prevent any wrapping ABA.
        self.atom_generation = self.atom_generation.wrapping_add(1);
        self.atom_revision = self.atom_revision.wrapping_add(1);
    }

    fn accepts_atom_frame(&self, block: &RichBlock, scope: AtomScopeTicket) -> bool {
        self.atom_lifecycle
            .matches_scope(scope, self.atom_generation, self.is_read_only())
            && self
                .document()
                .node(&block.path)
                .is_some_and(|node| node.shares_storage_with(&block.node))
    }

    /// Every explicit assignment is a retirement boundary, including assigning
    /// a clone of the same renderer. Its immutable cached payloads remain useful
    /// to new scoped requests; old callbacks are never reused or retokenized.
    pub fn set_atom_renderer(&mut self, renderer: InlineProofRenderer, cx: &mut Context<Self>) {
        self.retire_atom_presentation(true);
        self.atom_renderer = Some(renderer);
        cx.notify();
    }

    pub(super) fn enqueue_atoms(
        &mut self,
        block: Arc<RichBlock>,
        scope: AtomScopeTicket,
        requests: Vec<AtomRenderRequest>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.accepts_atom_frame(&block, scope) {
            return;
        }
        for request in requests {
            if request.generation != self.atom_generation {
                continue;
            }
            if let Ok(key) = request.key()
                && !self.atom_ready.contains_key(&key)
                && !self.atom_inflight.contains(&key)
            {
                self.atom_pending.entry(key.clone()).or_insert(PendingAtom {
                    scope,
                    block: block.clone(),
                    request,
                    key,
                });
            }
        }
        self.start_atom_jobs(window, cx);
    }

    fn start_atom_jobs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.atom_task.is_some() || self.atom_pending.is_empty() {
            return;
        }
        let Some(scope) = self.atom_request_ticket() else {
            return;
        };
        let mut jobs = Vec::with_capacity(2);
        while jobs.len() < 2 {
            let Some(key) = self.atom_pending.keys().next().cloned() else {
                break;
            };
            let Some(pending) = self.atom_pending.remove(&key) else {
                continue;
            };
            if pending.scope != scope {
                continue;
            }
            if let Some(job) = pending.prepare(self.document()) {
                jobs.push(job);
            }
        }
        if jobs.is_empty() {
            return;
        }
        let Some((ticket, cancellation)) = self.atom_lifecycle.start(scope) else {
            return;
        };
        self.atom_inflight
            .extend(jobs.iter().map(|job| job.key.clone()));
        let explicit_renderer = self.atom_renderer.clone();
        self.atom_task = Some(cx.spawn_in(window, async move |this, cx| {
            let (discovered, completions) = cx
                .background_executor()
                .spawn(async move {
                    if cancellation.cancelled() {
                        return (None, Vec::new());
                    }
                    let needs_discovery = explicit_renderer.is_none();
                    let renderer = explicit_renderer
                        .map(Ok)
                        .unwrap_or_else(InlineProofRenderer::discover);
                    if cancellation.cancelled() {
                        return (None, Vec::new());
                    }
                    let discovered = if needs_discovery {
                        renderer.as_ref().ok().cloned()
                    } else {
                        None
                    };
                    let mut completions = Vec::with_capacity(jobs.len());
                    for job in jobs {
                        if cancellation.cancelled() {
                            break;
                        }
                        let result = match &renderer {
                            Ok(renderer) => renderer.render(job.request.clone()),
                            Err(error) => AtomRenderResult {
                                source: job.request.source.clone(),
                                generation: job.request.generation,
                                key: Some(job.key.clone()),
                                result: Err(AtomRenderError::new(
                                    AtomErrorKind::RendererUnavailable,
                                    format!("{error:#}"),
                                )),
                            },
                        };
                        completions.push(AtomCompletion { job, result });
                    }
                    (discovered, completions)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if !this.finish_atom_batch(ticket, discovered, completions, cx) {
                    return;
                }
                this.start_atom_jobs(window, cx);
            });
        }));
    }

    /// The same deterministic guard called by the real executor completion.
    /// A rejected ticket has no task, busy, renderer, ready or revision effect.
    fn finish_atom_batch(
        &mut self,
        ticket: AtomBatchTicket,
        discovered: Option<InlineProofRenderer>,
        completions: Vec<AtomCompletion>,
        cx: &mut Context<Self>,
    ) -> bool {
        let generation = self.atom_generation;
        let read_only = self.is_read_only();
        if !self.atom_lifecycle.finish(ticket, generation, read_only) {
            return false;
        }
        // Only a current scope's first lazy discovery may initialize None.
        // Explicit setter authority is never replaced by a captured renderer.
        if self.atom_renderer.is_none() {
            self.atom_renderer = discovered;
        }
        for completion in completions {
            self.atom_inflight.remove(&completion.job.key);
            if completion.result.matches(&completion.job.request)
                && completion.result.key.as_ref() == Some(&completion.job.key)
                && completion.job.current(self.document())
            {
                self.atom_ready
                    .insert(completion.job.key, completion.result.result);
            }
        }
        self.atom_task = None;
        self.atom_revision = self.atom_revision.wrapping_add(1);
        cx.notify();
        true
    }
}

#[cfg(test)]
#[path = "../../fixtures/math-write/renderer-epoch/lifecycle_tests.rs"]
mod tests;
