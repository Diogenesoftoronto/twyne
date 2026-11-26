import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import {
  liveReviewSnapshot,
  type LiveReviewSnapshot,
} from "../../utils/live-review";

const BRIEF_FIELD_LABELS: Record<string, string> = {
  workingTitle: "Working title",
  format: "Format",
  audience: "Audience",
  goal: "Goal",
  tone: "Tone",
  constraints: "Non-negotiables",
  successSignal: "Success signal",
};

export const LiveReviewPanel = component$<{ folioId: string }>(
  ({ folioId }) => {
    const state = useStore<{ snapshot: LiveReviewSnapshot }>({
      snapshot: liveReviewSnapshot(),
    });
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ cleanup }) => {
        state.snapshot = liveReviewSnapshot();
        const update = (event: Event) => {
          state.snapshot = (event as CustomEvent<LiveReviewSnapshot>).detail;
        };
        window.addEventListener("twyne:live-review", update);
        cleanup(() => window.removeEventListener("twyne:live-review", update));
      },
      { strategy: "document-ready" },
    );
    const snapshot = state.snapshot;
    const result = snapshot.folioId === folioId ? snapshot.result : null;
    return (
      <div class="live-review-panel">
        <p class="panel-meta" role="status">
          {snapshot.folioId === folioId
            ? snapshot.message
            : "Review follows your saved draft."}
        </p>
        {result && (
          <>
            {snapshot.status !== "current" && snapshot.status !== "reading" && (
              <p class="panel-meta">
                Previous reading. These findings may no longer match your draft.
              </p>
            )}
            {!!result.brief?.weakest.length && (
              <section class="live-review-panel__section">
                <h3 class="dept-label">Sharpen the dossier</h3>
                {/* A review saved before the brief had a standing has none. */}
                {result.brief.standing &&
                  !result.brief.standing.loadBearing && (
                    <p class="panel-meta">
                      “On brief” is measured against a soft brief
                      {result.brief.standing.soft.length > 0 &&
                        `: ${result.brief.standing.soft.join("; ")}`}
                      .
                    </p>
                  )}
                {result.brief.weakest.slice(0, 3).map((field) => (
                  <p key={field.field}>
                    <strong>
                      {BRIEF_FIELD_LABELS[field.field] ?? field.field}
                      {field.label ? ` · ${field.label}` : ""}
                    </strong>
                    : {field.diagnosis}
                  </p>
                ))}
                <Link
                  class="panel-meta focus-ring"
                  href={`/dossier/refine/?folio=${encodeURIComponent(folioId)}`}
                >
                  Refine the dossier ↗
                </Link>
              </section>
            )}
            <section class="live-review-panel__section">
              <h3 class="dept-label">Passages to consider</h3>
              <p class="panel-meta">{result.coverage}</p>
              {result.passages
                .filter((item) => item.kind !== "nothing")
                .slice(0, 4)
                .map((item) => (
                  <details key={item.passage.id} class="live-review-passage">
                    <summary>
                      {
                        {
                          advice: "Consider a revision",
                          question: "Clarify for the reader",
                          evidence: "Check supporting evidence",
                          cut: "Check what this adds",
                          nothing: "No issue",
                        }[item.kind]
                      }
                      {(item.confidence ?? 0) < 0.5 ? " · tentative" : ""}
                    </summary>
                    <blockquote>{item.passage.text}</blockquote>
                  </details>
                ))}
              {result.passages.every((item) => item.kind === "nothing") && (
                <p>No clear issue in the passages checked.</p>
              )}
            </section>
            {!!result.notes?.some(
              (note) => note.verdict && !note.verdict.pass,
            ) && (
              <section class="live-review-panel__section">
                <h3 class="dept-label">Check the advice, too</h3>
                {result.notes
                  .filter((note) => note.verdict && !note.verdict.pass)
                  .map((note) => (
                    <p key={note.id}>
                      <strong>{note.author}</strong>:{" "}
                      {note.verdict!.reasons.join(" ")}
                    </p>
                  ))}
                <p class="panel-meta">
                  Tentative checks against your dossier and feedback
                  preferences. The original notes remain available in Cast.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    );
  },
);
