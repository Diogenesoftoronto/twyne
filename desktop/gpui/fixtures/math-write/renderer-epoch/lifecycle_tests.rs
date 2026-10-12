//! Authored deterministic completion tests. These call the actual proposed
//! foreground hook; constructed replies/ready tasks are not asynchronous,
//! renderer fidelity, native input, compositor or OS acceptance receipts.
use super::*;
use crate::editor::view::MathSourceHostContext;
use crate::inline_proof::{AtomFidelity, InlineSvgBackend};
use crate::native_typst::TypstEngine;
use gpui_kit::{AppContext, Image, ImageFormat, TestAppContext};
use std::sync::atomic::AtomicUsize;

const HTML: &str = "<p data-future=\"intro\">intro</p><p data-future=\"atom-block\">A<span data-type=\"inline-math\" data-latex=\" x \" data-future=\"atom\"> x </span>Z<span data-type=\"inline-math\" data-latex=\" y \"> y </span></p><p data-future=\"tail\">later 前🦊</p>";

#[test]
fn checked_epochs_and_exact_batch_identity_refuse_aba_and_duplicate_completion() {
    let mut state = AtomRendererLifecycle::default();
    let scope = state.scope(0, false).unwrap();
    let (old, cancelled) = state.start(scope).unwrap();
    assert!(state.accepts(old, 0, false));
    state.retire(true);
    assert!(cancelled.cancelled());
    assert!(!state.accepts(old, 0, false));
    assert!(state.start(scope).is_none());
    let current_scope = state.scope(0, false).unwrap();
    let (current, _) = state.start(current_scope).unwrap();
    assert!(!state.finish(old, 0, false));
    assert!(state.accepts(current, 0, false));
    assert!(!state.accepts(current, 1, false));
    assert!(!state.accepts(current, 0, true));
    assert!(state.finish(current, 0, false));
    assert!(!state.finish(current, 0, false));
    let (next, _) = state.start(current_scope).unwrap();
    assert!(!state.finish(current, 0, false));
    assert!(state.accepts(next, 0, false));
    state.retire(false);
    assert!(!state.accepts(next, 0, false));
}

#[test]
fn destruction_cancels_and_all_counter_exhaustion_fails_closed() {
    let mut state = AtomRendererLifecycle::default();
    let (_, cancellation) = state.start(state.scope(0, false).unwrap()).unwrap();
    drop(state);
    assert!(cancellation.cancelled());
    for renderer in [true, false] {
        let mut state = AtomRendererLifecycle::default();
        if renderer {
            state.renderer_epoch = u64::MAX;
        } else {
            state.owner_epoch = u64::MAX;
        }
        let (old, cancellation) = state.start(state.scope(0, false).unwrap()).unwrap();
        state.retire(renderer);
        assert!(cancellation.cancelled());
        assert!(state.scope(0, false).is_none());
        assert!(!state.finish(old, 0, false));
    }
    let mut state = AtomRendererLifecycle::default();
    state.next_batch = u64::MAX;
    assert!(state.start(state.scope(0, false).unwrap()).is_none());
    assert!(state.scope(0, false).is_none());
}

struct SyntheticBackend(Arc<AtomicUsize>);
impl InlineSvgBackend for SyntheticBackend {
    fn render(&self, _: AtomKind, _: &str) -> Result<String, AtomRenderError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"8\" viewBox=\"0 -6 12 8\"><path d=\"M0 0L12 0\"/></svg>".into())
    }
}
fn renderer() -> (InlineProofRenderer, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    (
        InlineProofRenderer::with_backend(
            TypstEngine::new().unwrap(),
            Arc::new(SyntheticBackend(calls.clone())),
        ),
        calls,
    )
}

fn image() -> AtomRenderImage {
    let svg: Arc<str> = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"8\" viewBox=\"0 0 12 8\"><path d=\"M0 0L12 0\"/></svg>".into();
    AtomRenderImage {
        image: Arc::new(Image::from_bytes(ImageFormat::Svg, svg.as_bytes().to_vec())),
        svg,
        width_px: 12.,
        height_px: 8.,
        baseline_px: 6.,
        baseline_is_exact: false,
        // Synthetic typed fixture only; no actual MathJax or Write proof.
        fidelity: AtomFidelity::WebMathJaxProof,
    }
}
fn reply(job: AtomJob, success: bool) -> AtomCompletion {
    let result = AtomRenderResult {
        source: job.request.source.clone(),
        generation: job.request.generation,
        key: Some(job.key.clone()),
        result: if success {
            Ok(image())
        } else {
            Err(AtomRenderError::new(
                AtomErrorKind::Compiler,
                "controlled old failure",
            ))
        },
    };
    AtomCompletion { job, result }
}
fn pending(view: &RichEditorView, source: &str) -> PendingAtom {
    let request = AtomRenderRequest {
        kind: AtomKind::LatexMath { block: false },
        source: Arc::from(source),
        font_size_px: 18.,
        color: 0x181818,
        width_px: 400.,
        generation: view.atom_generation,
    };
    PendingAtom {
        key: request.key().unwrap(),
        request,
        scope: view.atom_request_ticket().unwrap(),
        block: Arc::new(view.document().block(&[1]).unwrap()),
    }
}
fn begin(view: &mut RichEditorView, source: &str) -> (AtomBatchTicket, AtomJob) {
    let job = pending(view, source).prepare(view.document()).unwrap();
    let scope = view.atom_request_ticket().unwrap();
    let (ticket, _) = view.atom_lifecycle.start(scope).unwrap();
    view.atom_inflight.insert(job.key.clone());
    view.atom_task = Some(Task::ready(())); // exact foreground busy marker only
    (ticket, job)
}
fn entity(cx: &mut TestAppContext) -> Entity<RichEditorView> {
    cx.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        cx.new(|cx| RichEditorView::new(RichDocument::from_html(HTML).unwrap(), cx))
    })
}

#[gpui_kit::test]
fn old_success_and_error_cannot_restore_renderer_or_clear_new_busy_state(cx: &mut TestAppContext) {
    let view = entity(cx);
    for success in [true, false] {
        cx.update(|cx| {
            view.update(cx, |view, cx| {
                let (old, old_calls) = renderer();
                let (new, new_calls) = renderer();
                view.set_atom_renderer(old.clone(), cx);
                let (old_ticket, old_job) = begin(view, " x ");
                // Old cache has one exact key; the new instance has none. This is
                // synthetic local backend identity evidence, not formula proof.
                old.render(old_job.request.clone());
                assert_eq!(old_calls.load(Ordering::SeqCst), 1);
                view.set_atom_renderer(new.clone(), cx);
                let (new_ticket, new_job) = begin(view, " x ");
                let new_key = new_job.key.clone();
                let queued = pending(view, " y ");
                let queued_key = queued.key.clone();
                view.atom_pending.insert(queued_key.clone(), queued);
                view.atom_ready.insert(
                    queued_key.clone(),
                    Err(AtomRenderError::new(
                        AtomErrorKind::Compiler,
                        "new scoped error",
                    )),
                );
                let revision = view.atom_revision;
                let html = view.document().to_html();
                let selection = view.selection();
                let can_undo = view.can_undo();
                assert!(!view.finish_atom_batch(
                    old_ticket,
                    Some(old),
                    vec![reply(old_job, success)],
                    cx
                ));
                assert_eq!(view.atom_revision, revision);
                assert!(view.atom_task.is_some());
                assert!(view.atom_inflight.contains(&new_key));
                assert!(view.atom_pending.contains_key(&queued_key));
                assert_eq!(
                    view.atom_ready[&queued_key].as_ref().unwrap_err().message,
                    "new scoped error"
                );
                assert!(view.atom_lifecycle.accepts(
                    new_ticket,
                    view.atom_generation,
                    view.is_read_only()
                ));
                assert!(
                    view.atom_renderer
                        .as_ref()
                        .unwrap()
                        .cached(&new_job.request)
                        .is_none()
                );
                assert_eq!(new_calls.load(Ordering::SeqCst), 0);
                assert_eq!(view.document().to_html(), html);
                assert_eq!(view.selection(), selection);
                assert_eq!(view.can_undo(), can_undo);
                // Retire this controlled batch before the next vector.
                view.retire_atom_owner(cx);
            })
        });
    }
}

#[gpui_kit::test]
fn current_reply_installs_only_matching_payload_and_never_overrides_explicit_renderer(
    cx: &mut TestAppContext,
) {
    let view = entity(cx);
    for success in [true, false] {
        cx.update(|cx| {
            view.update(cx, |view, cx| {
                let (explicit, explicit_calls) = renderer();
                let (other, _) = renderer();
                view.set_atom_renderer(explicit, cx);
                let (ticket, job) = begin(view, " x ");
                let key = job.key.clone();
                let request = job.request.clone();
                other.render(request.clone());
                let html = view.document().to_html();
                assert!(view.finish_atom_batch(ticket, Some(other), vec![reply(job, success)], cx));
                assert!(!view.atom_inflight.contains(&key));
                assert!(view.atom_task.is_none());
                assert_eq!(view.atom_ready[&key].is_ok(), success);
                assert!(
                    view.atom_renderer
                        .as_ref()
                        .unwrap()
                        .cached(&request)
                        .is_none()
                );
                assert_eq!(explicit_calls.load(Ordering::SeqCst), 0);
                assert_eq!(view.document().to_html(), html);
                assert!(!view.atom_lifecycle.accepts(
                    ticket,
                    view.atom_generation,
                    view.is_read_only()
                ));
            })
        });
    }
}

#[gpui_kit::test]
fn same_renderer_reassignment_and_wrapping_request_generation_still_retire_old_ticket(
    cx: &mut TestAppContext,
) {
    let view = entity(cx);
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            let (renderer, _) = renderer();
            view.set_atom_renderer(renderer.clone(), cx);
            view.atom_generation = u64::MAX;
            let (old, job) = begin(view, " x ");
            renderer.render(job.request.clone());
            view.set_atom_renderer(renderer.clone(), cx);
            assert_eq!(view.atom_generation, 0);
            assert!(!view.finish_atom_batch(old, None, vec![reply(job, true)], cx));
            let (current, job) = begin(view, " x ");
            assert!(renderer.cached(&job.request).is_some());
            assert!(view.finish_atom_batch(current, None, vec![reply(job, true)], cx));
        })
    });
}

#[gpui_kit::test]
fn only_current_lazy_discovery_can_initialize_the_renderer(cx: &mut TestAppContext) {
    let view = entity(cx);
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            let (old, _) = renderer();
            let (ticket, job) = begin(view, " x ");
            assert!(view.atom_renderer.is_none());
            assert!(view.finish_atom_batch(ticket, Some(old), vec![reply(job, true)], cx));
            assert!(view.atom_renderer.is_some());
            view.atom_renderer = None; // fixture only: exercise another initial discovery
            let (late, job) = begin(view, " x ");
            let (explicit, _) = renderer();
            view.set_atom_renderer(explicit, cx);
            assert!(!view.finish_atom_batch(late, None, vec![reply(job, false)], cx));
            assert!(view.atom_renderer.is_some());
        })
    });
}

#[gpui_kit::test]
fn document_read_only_and_folio_visit_boundaries_neutralize_both_late_result_kinds(
    cx: &mut TestAppContext,
) {
    let view = entity(cx);
    for boundary in ["document", "read-only", "folio", "visit", "owner-clear"] {
        for success in [true, false] {
            cx.update(|cx| {
                view.update(cx, |view, cx| {
                    view.set_document(RichDocument::from_html(HTML).unwrap(), false, cx);
                    view.set_read_only(false, cx);
                    view.set_math_source_context(
                        Some(MathSourceHostContext::new("owned-A", 1)),
                        cx,
                    );
                    let (renderer, _) = renderer();
                    view.set_atom_renderer(renderer, cx);
                    let (old, job) = begin(view, " x ");
                    match boundary {
                        "document" => view.set_document(view.snapshot(), false, cx),
                        "read-only" => {
                            view.set_read_only(true, cx);
                            view.set_read_only(false, cx);
                        }
                        "folio" => view.set_math_source_context(
                            Some(MathSourceHostContext::new("owned-B", 1)),
                            cx,
                        ),
                        "visit" => view.set_math_source_context(
                            Some(MathSourceHostContext::new("owned-A", 2)),
                            cx,
                        ),
                        "owner-clear" => view.set_math_source_context(None, cx),
                        _ => unreachable!(),
                    }
                    let revision = view.atom_revision;
                    let html = view.document().to_html();
                    assert!(
                        !view.finish_atom_batch(old, None, vec![reply(job, success)], cx),
                        "{boundary}"
                    );
                    assert_eq!(view.atom_revision, revision);
                    assert!(view.atom_ready.is_empty());
                    assert_eq!(view.document().to_html(), html);
                    assert!(!view.is_read_only());
                })
            });
        }
    }
}

#[gpui_kit::test]
fn unchanged_read_only_and_identical_folio_context_keep_current_ticket(cx: &mut TestAppContext) {
    let view = entity(cx);
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.set_math_source_context(Some(MathSourceHostContext::new("owned-A", 1)), cx);
            let (ticket, job) = begin(view, " x ");
            view.set_read_only(false, cx);
            view.set_math_source_context(Some(MathSourceHostContext::new("owned-A", 1)), cx);
            assert!(view.finish_atom_batch(ticket, None, vec![reply(job, true)], cx));
        })
    });
}

#[gpui_kit::test]
fn source_style_key_and_generation_mismatches_are_not_published(cx: &mut TestAppContext) {
    let view = entity(cx);
    for mismatch in [
        "raw-space",
        "generation",
        "width",
        "color",
        "kind",
        "missing-key",
    ] {
        cx.update(|cx| {
            view.update(cx, |view, cx| {
                view.retire_atom_owner(cx);
                let (ticket, job) = begin(view, " x ");
                let key = job.key.clone();
                let mut completion = reply(job, true);
                match mismatch {
                    "raw-space" => completion.result.source = "x".into(),
                    "generation" => {
                        completion.result.generation = completion.result.generation.wrapping_add(1)
                    }
                    "missing-key" => completion.result.key = None,
                    _ => {
                        let mut other = completion.job.request.clone();
                        match mismatch {
                            "width" => other.width_px = 401.,
                            "color" => other.color = 0xff0000,
                            "kind" => other.kind = AtomKind::Mermaid,
                            _ => unreachable!(),
                        }
                        completion.result.key = Some(other.key().unwrap());
                    }
                }
                assert!(view.finish_atom_batch(ticket, None, vec![completion], cx));
                assert!(!view.atom_ready.contains_key(&key), "{mismatch}");
                assert!(!view.atom_inflight.contains(&key));
                assert!(view.atom_task.is_none());
            })
        });
    }
}

#[gpui_kit::test]
fn changed_node_storage_and_offset_refuse_while_unrelated_later_edit_can_finish(
    cx: &mut TestAppContext,
) {
    let view = entity(cx);
    for change in [
        "source",
        "same-bytes-new-storage",
        "earlier-offset",
        "later-prose",
    ] {
        cx.update(|cx| {
            view.update(cx, |view, cx| {
                view.set_document(RichDocument::from_html(HTML).unwrap(), false, cx);
                let (ticket, job) = begin(view, " x ");
                let key = job.key.clone();
                match change {
                    "source" => {
                        view.editor
                            .execute(Command::UpdateMathSource {
                                path: job.target.path.clone(),
                                expected: job.target.node.clone(),
                                source: " x+1 ".into(),
                            })
                            .unwrap();
                    }
                    "same-bytes-new-storage" => {
                        // Construction deliberately bypasses the owner hook
                        // to isolate node-storage identity. Core replacement
                        // short-circuits structurally identical documents.
                        view.editor = RichEditor::new(
                            RichDocument::from_html(&view.document().to_html()).unwrap(),
                        );
                    }
                    "earlier-offset" | "later-prose" => {
                        let mut nodes = view.document().nodes().to_vec();
                        let replacement =
                            RichDocument::from_html("<p>different length remains authored</p>")
                                .unwrap();
                        nodes[if change == "earlier-offset" { 0 } else { 2 }] =
                            replacement.nodes()[0].clone();
                        view.editor
                            .replace_document(RichDocument::new(nodes), false);
                    }
                    _ => unreachable!(),
                }
                let html = view.document().to_html();
                assert!(view.finish_atom_batch(ticket, None, vec![reply(job, true)], cx));
                assert_eq!(
                    view.atom_ready.contains_key(&key),
                    change == "later-prose",
                    "{change}"
                );
                assert_eq!(view.document().to_html(), html);
            })
        });
    }
}

#[gpui_kit::test]
fn deferred_frame_receipt_cannot_requeue_old_work_into_a_new_renderer_scope(
    cx: &mut TestAppContext,
) {
    let view = entity(cx);
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            let (renderer, _) = renderer();
            view.set_atom_renderer(renderer.clone(), cx);
            let scope = view.atom_request_ticket().unwrap();
            let block = view.document().block(&[1]).unwrap();
            assert!(view.accepts_atom_frame(&block, scope));
            view.set_atom_renderer(renderer, cx);
            assert!(!view.accepts_atom_frame(&block, scope));
            let new_scope = view.atom_request_ticket().unwrap();
            assert!(view.accepts_atom_frame(&block, new_scope));
            // A new held model with identical bytes must invalidate a saved
            // frame even when deliberately bypassing the owner hook here.
            view.editor = RichEditor::new(RichDocument::from_html(HTML).unwrap());
            assert!(!view.accepts_atom_frame(&block, new_scope));
        })
    });
}

#[gpui_kit::test]
fn a_fresh_read_only_scope_can_still_receive_ordinary_rendered_atoms(cx: &mut TestAppContext) {
    let view = entity(cx);
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.set_read_only(true, cx);
            let before = view.document().to_html();
            let (ticket, job) = begin(view, " x ");
            let key = job.key.clone();
            assert!(view.finish_atom_batch(ticket, None, vec![reply(job, true)], cx));
            assert!(view.is_read_only());
            assert!(view.atom_ready[&key].is_ok());
            assert_eq!(view.document().to_html(), before);
            assert!(!view.can_undo());
        })
    });
}
