/**
 * The ink ribbon: the flow reading, told the way a typewriter would.
 *
 * A two-colour ribbon in the status line. Writing, the black half is up.
 * As a run builds the ribbon shifts toward the red, and in flow the red is
 * struck. Stuck, the ribbon goes slack; away, it fades. It reads the same
 * snapshot as the margin and never draws the eye: no motion beyond the
 * slow shift between states, and none at all under reduced motion.
 */
import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import {
  FLOW_EVENT,
  flowSnapshot,
  type FlowSnapshot,
} from "../editor/extensions/flow-conductor";
import type { FlowMode } from "../../utils/flow-state";

const LABELS: Record<FlowMode, string> = {
  away: "away",
  working: "writing",
  settling: "settling in",
  flow: "in flow",
  stuck: "paused",
};

const TITLES: Record<FlowMode, string> = {
  away: "No keys for a while.",
  working: "Twyne is reading your pace. The margin brings things in freely.",
  settling: "A steady run is building. New margin notes wait until you pause.",
  flow: "You're in flow. The margin holds everything until you pause; Escape brings it back.",
  stuck: "A long pause. The margin offers one way back in.",
};

export const FlowRibbon = component$(() => {
  const state = useStore<{ enabled: boolean; mode: FlowMode; minutes: number }>(
    { enabled: false, mode: "working", minutes: 0 },
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const read = (snap: FlowSnapshot) => {
      state.enabled = snap.enabled;
      state.mode = snap.mode;
      state.minutes =
        snap.mode === "flow" && snap.reading
          ? Math.floor(snap.reading.runMs / 60_000)
          : 0;
    };
    const onSnapshot = (event: Event) =>
      read((event as CustomEvent<FlowSnapshot>).detail);
    read(flowSnapshot());
    window.addEventListener(FLOW_EVENT, onSnapshot);
    cleanup(() => window.removeEventListener(FLOW_EVENT, onSnapshot));
  });

  if (!state.enabled) return <span hidden />;
  const label =
    state.mode === "flow" && state.minutes > 0
      ? `${LABELS.flow} · ${state.minutes} min`
      : LABELS[state.mode];
  return (
    <span
      class="flow-ribbon"
      data-mode={state.mode}
      role="status"
      aria-live="off"
      aria-label={`${label}. ${TITLES[state.mode]}`}
      title={TITLES[state.mode]}
    >
      <svg
        class="flow-ribbon__spool"
        viewBox="0 0 40 10"
        width="40"
        height="10"
        aria-hidden="true"
      >
        <circle class="flow-ribbon__reel" cx="4" cy="5" r="3.2" />
        <circle class="flow-ribbon__reel" cx="36" cy="5" r="3.2" />
        <g class="flow-ribbon__band">
          <rect
            class="flow-ribbon__black"
            x="4"
            y="2.2"
            width="32"
            height="2.8"
          />
          <rect class="flow-ribbon__red" x="4" y="5" width="32" height="2.8" />
        </g>
        <path
          class="flow-ribbon__slack"
          d="M4 5 C 12 9, 20 1, 28 7 S 34 5, 36 5"
        />
      </svg>
      <span class="flow-ribbon__label">{label}</span>
    </span>
  );
});
