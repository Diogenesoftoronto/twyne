import { $, component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { WorkspacePreview } from "./workspace-preview";
import type { PanelId } from "../../utils/panel-activity";

export interface TourStop {
  id: string;
  /** Short label shown on the hotspot and the reader card. */
  tag: string;
  /** One or two sentences explaining this part of the room. */
  note: string;
  accent: string;
  /** Board tab the preview switches to while this stop is shown. */
  tab: PanelId;
  /** Folio the preview switches to while this stop is shown. */
  folioId: string;
  /** Rails this stop needs open to make sense. */
  drawer: boolean;
  panel: boolean;
  /**
   * Hotspot position in percent of the preview frame. Tuned for the full
   * three-column room; hotspots only render on wide screens where both
   * rails are docked, so these coordinates stay honest.
   */
  hotspot: { x: number; y: number };
  /**
   * Which side of the hotspot the reader slip hangs off. Pick the side
   * that leaves the described element visible.
   */
  placement: "above" | "below";
}

/**
 * The stops of the room tour. To explain a new part of the interface, add
 * an entry here — the hotspot, the reader card, the dots, and the preview
 * state all follow from this one list.
 */
export const TOUR_STOPS: TourStop[] = [
  {
    id: "dossier",
    tag: "The Dossier",
    note: "The brief every tool in the room reads — audience, purpose, and what good looks like — pinned beside the manuscript so no draft starts cold.",
    accent: "var(--color-cobalt)",
    tab: "personas",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 13, y: 30 },
    placement: "below",
  },
  {
    id: "folios",
    tag: "The Folios",
    note: "Draft, notes, outlines: every piece keeps its own folios in the drawer. Open one and watch the manuscript follow — this stop opens the research notes.",
    accent: "var(--color-vermilion)",
    tab: "personas",
    folioId: "folio-2",
    drawer: true,
    panel: true,
    hotspot: { x: 13, y: 62 },
    placement: "below",
  },
  {
    id: "manuscript",
    tag: "The Manuscript",
    note: "A serious long-form editor that stays out of the way while you write. Your words hold the centre; the room holds the edges.",
    accent: "var(--color-ink)",
    tab: "personas",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 50, y: 58 },
    placement: "below",
  },
  {
    id: "cast",
    tag: "The Cast",
    note: "Five editors read along and argue with the draft against your brief. Click one in the preview to hear its note on the passage.",
    accent: "var(--color-vermilion)",
    tab: "personas",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 86, y: 34 },
    placement: "above",
  },
  {
    id: "rubric",
    tag: "The Rubric",
    note: "Thesis, structure, style, evidence — each scored out of ten, and capped whenever a draft drifts off its subject.",
    accent: "var(--color-cobalt)",
    tab: "rubric",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 79, y: 11 },
    placement: "below",
  },
  {
    id: "marginalia",
    tag: "The Marginalia",
    note: "Every note lands where it belongs: anchored to the paragraph it argues with, never lost in a chat log.",
    accent: "var(--color-mustard)",
    tab: "comments",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 84, y: 11 },
    placement: "below",
  },
  {
    id: "apparatus",
    tag: "The Apparatus",
    note: "URLs, DOIs, ISBNs, and footnotes are detected as you cite them and kept where each can be inspected and verified.",
    accent: "var(--color-periwinkle)",
    tab: "citations",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 89, y: 11 },
    placement: "below",
  },
  {
    id: "versions",
    tag: "The Versions",
    note: "Every revision kept with its word count and its reason — the draft's memory, filed like everything else.",
    accent: "var(--color-sage)",
    tab: "history",
    folioId: "folio-1",
    drawer: true,
    panel: true,
    hotspot: { x: 94, y: 11 },
    placement: "below",
  },
];

/** Which tour stop explains a board tab the visitor opened themselves. */
const STOP_FOR_TAB: Record<PanelId, string> = {
  personas: "cast",
  rubric: "rubric",
  comments: "marginalia",
  citations: "apparatus",
  history: "versions",
};

const ADVANCE_MS = 6000;

interface WorkspaceTourProps {
  /** Which stop the tour opens on. Defaults to the first stop. */
  initialStopId?: string;
}

export const WorkspaceTour = component$<WorkspaceTourProps>(
  ({ initialStopId }) => {
    const stopIndex = useSignal(
      Math.max(
        0,
        TOUR_STOPS.findIndex((stop) => stop.id === initialStopId),
      ),
    );
    const paused = useSignal(false);

    const stop = TOUR_STOPS[stopIndex.value] ?? TOUR_STOPS[0];
    const previewTab = useSignal<PanelId>(stop.tab);
    const previewFolio = useSignal(stop.folioId);
    const drawerNow = useSignal(stop.drawer);
    const panelNow = useSignal(stop.panel);

    // The slip floats next to the hotspot it describes, on the side each
    // stop declares, clamped horizontally so it never leaves the frame.
    const slipLeft = Math.min(80, Math.max(20, stop.hotspot.x));
    const slipAbove = stop.placement === "above";

    const goTo = $((index: number) => {
      const next = (index + TOUR_STOPS.length) % TOUR_STOPS.length;
      const nextStop = TOUR_STOPS[next];
      stopIndex.value = next;
      previewTab.value = nextStop.tab;
      previewFolio.value = nextStop.folioId;
      drawerNow.value = nextStop.drawer;
      panelNow.value = nextStop.panel;
    });

    // The tour advances itself until the visitor takes over. Hovering or
    // focusing the tour holds the current card; leaving resumes. Reduced
    // motion disables the loop entirely — the dots and arrows still work.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      const timer = window.setInterval(() => {
        if (!paused.value) {
          void goTo(stopIndex.value + 1);
        }
      }, ADVANCE_MS);
      cleanup(() => window.clearInterval(timer));
    });

    return (
      <div
        onMouseEnter$={() => {
          paused.value = true;
        }}
        onMouseLeave$={() => {
          paused.value = false;
        }}
        onFocusIn$={() => {
          paused.value = true;
        }}
        onFocusOut$={() => {
          paused.value = false;
        }}
      >
        <div class="relative w-full" style={{ height: "min(80vh, 800px)" }}>
          <WorkspacePreview
            tab={previewTab.value}
            folioId={previewFolio.value}
            drawer={drawerNow.value}
            panel={panelNow.value}
            onTabChange$={(next) => {
              previewTab.value = next;
              const match = TOUR_STOPS.findIndex(
                (candidate) => candidate.id === STOP_FOR_TAB[next],
              );
              if (match >= 0) stopIndex.value = match;
            }}
            onFolioChange$={(next) => {
              previewFolio.value = next;
              const match = TOUR_STOPS.findIndex(
                (candidate) => candidate.id === "folios",
              );
              if (match >= 0) stopIndex.value = match;
            }}
            onDrawerChange$={(next) => {
              drawerNow.value = next;
              if (next) {
                const match = TOUR_STOPS.findIndex(
                  (candidate) => candidate.id === "dossier",
                );
                if (match >= 0) stopIndex.value = match;
              }
            }}
            onPanelChange$={(next) => {
              panelNow.value = next;
            }}
          />
          {TOUR_STOPS.map((candidate, index) => (
            <button
              key={candidate.id}
              class={[
                "tour-hotspot hidden lg:block",
                index === stopIndex.value ? "is-active" : "",
              ]}
              style={`left: ${candidate.hotspot.x}%; top: ${candidate.hotspot.y}%; --hotspot-accent: ${candidate.accent};`}
              title={`Show: ${candidate.tag}`}
              aria-label={`Show tour stop: ${candidate.tag}`}
              aria-pressed={index === stopIndex.value}
              onClick$={() => goTo(index)}
            >
              <span aria-hidden="true">✦</span>
            </button>
          ))}
          {/* Reader slip: the stop being shown, floating next to its
              hotspot so the description is read where the eye already is. */}
          <div
            class="tour-slip-anchor"
            style={`left: ${slipLeft}%; top: ${stop.hotspot.y}%;`}
          >
            <div
              key={stop.id}
              class={[
                "tour-slip landing-rise",
                slipAbove ? "tour-slip--above" : "tour-slip--below",
              ]}
              style={`--slip-accent: ${stop.accent};`}
              aria-live="polite"
            >
              <p class="tour-slip__tag">
                Stop {stopIndex.value + 1} of {TOUR_STOPS.length} · {stop.tag}
              </p>
              <p class="tour-slip__note">{stop.note}</p>
              <div class="tour-slip__controls">
                <button
                  class="tour-step"
                  aria-label="Previous tour stop"
                  onClick$={() => goTo(stopIndex.value - 1)}
                >
                  ←
                </button>
                <div
                  class="tour-slip__dots"
                  role="tablist"
                  aria-label="Tour stops"
                >
                  {TOUR_STOPS.map((candidate, index) => (
                    <button
                      key={candidate.id}
                      role="tab"
                      aria-selected={index === stopIndex.value}
                      aria-label={`Go to stop: ${candidate.tag}`}
                      title={candidate.tag}
                      class={[
                        "tour-dot",
                        index === stopIndex.value ? "is-active" : "",
                      ]}
                      style={
                        index === stopIndex.value
                          ? `--dot-accent: ${candidate.accent};`
                          : undefined
                      }
                      onClick$={() => goTo(index)}
                    />
                  ))}
                </div>
                <button
                  class="tour-step"
                  aria-label="Next tour stop"
                  onClick$={() => goTo(stopIndex.value + 1)}
                >
                  →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
