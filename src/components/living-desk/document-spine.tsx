/**
 * The document spine: a thin strip at the page's left edge showing where the
 * sections break and where the active lens's occurrences fall. Decorative
 * (aria-hidden); every jump is also reachable from the cards.
 */
import {
  component$,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
} from "@qwik.dev/core";
import {
  LIVING_DESK_EVENT,
  LIVING_DESK_TOGGLE_EVENT,
  livingDeskController,
  livingDeskSnapshot,
  type LivingDeskSnapshot,
} from "../../utils/living-desk-contract";
import styles from "./living-desk.css?inline";

interface Mark {
  id: string;
  top: number;
  strong: boolean;
  lens: string;
  flagged: boolean;
}

interface SpineState {
  height: number;
  rules: number[];
  marks: Mark[];
  cap: string;
  visible: boolean;
  open: boolean;
  estimating: boolean;
}

export const DocumentSpine = component$<{ zen: boolean; readOnly?: boolean }>(
  (props) => {
    useStyles$(styles);
    const root = useSignal<HTMLDivElement>();
    const state = useStore<SpineState>({
      height: 0,
      rules: [],
      marks: [],
      cap: "",
      visible: false,
      open: false,
      estimating: false,
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ track, cleanup }) => {
        track(() => props.readOnly);
        const zen = track(() => props.zen);
        const el = root.value;
        const canvas = el?.closest<HTMLElement>(".page-canvas");
        if (!el || !canvas || zen) return;
        let frame = 0;
        let snap: LivingDeskSnapshot = livingDeskSnapshot();

        const compute = () => {
          if (document.documentElement.hasAttribute("data-flow")) {
            state.visible = false;
            return;
          }
          const ctl = livingDeskController();
          const lens = snap.lens;
          const hasFindings = snap.findings.some((f) => f.state !== "resolved");
          state.visible = !!ctl && (!props.readOnly || hasFindings);
          if (!state.visible) return;
          state.open = snap.open;
          state.height = canvas.offsetHeight;
          const est = snap.score.estimate;
          state.cap = est == null ? "" : est.toFixed(1);
          state.estimating =
            snap.score.confirmed == null || snap.score.editsSinceConfirmed > 0;
          if (!ctl) {
            state.rules = [];
            state.marks = [];
            return;
          }
          const editor = canvas.querySelector<HTMLElement>(".ProseMirror");
          const editorOffset = editor
            ? editor.getBoundingClientRect().top -
              canvas.getBoundingClientRect().top
            : 0;
          const editorHeight = editor?.scrollHeight ?? canvas.offsetHeight;
          const canvasFraction = (n: number) =>
            (editorOffset + n * editorHeight) /
            Math.max(1, canvas.offsetHeight);
          state.rules = snap.sections
            .slice(1)
            .map((s) => ctl.spineFraction(s.from))
            .filter((n): n is number => typeof n === "number")
            .map(canvasFraction);
          const marks: Mark[] = [];
          if (lens) {
            for (const f of snap.findings) {
              if (
                f.lens !== lens ||
                f.state === "resolved" ||
                f.state === "deliberate"
              )
                continue;
              const focused = snap.focusedFinding === f.id;
              for (const o of f.occurrences) {
                const top = ctl.spineFraction(o.from);
                if (top == null) continue;
                marks.push({
                  id: o.id,
                  top: canvasFraction(top),
                  strong: focused,
                  lens,
                  flagged: o.flagged,
                });
              }
            }
          }
          state.marks = marks;
        };
        const schedule = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(compute);
        };
        const onSnapshot = (event: Event) => {
          snap = (event as CustomEvent<LivingDeskSnapshot>).detail;
          schedule();
        };

        schedule();
        window.addEventListener(LIVING_DESK_EVENT, onSnapshot);
        window.addEventListener("resize", schedule);
        const observer = new ResizeObserver(schedule);
        observer.observe(canvas);
        const quietObserver = new MutationObserver(schedule);
        quietObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-flow"],
        });
        cleanup(() => {
          cancelAnimationFrame(frame);
          window.removeEventListener(LIVING_DESK_EVENT, onSnapshot);
          window.removeEventListener("resize", schedule);
          observer.disconnect();
          quietObserver.disconnect();
        });
      },
      { strategy: "document-ready" },
    );

    return (
      <div
        ref={root}
        class="ld-spine"
        hidden={props.zen || !state.visible}
        data-ld-spine
        style={{ height: `${state.height}px` }}
      >
        <button
          type="button"
          class="ld-spine__cap"
          aria-pressed={state.open}
          aria-label="Open the piece"
          title="The piece"
          preventdefault:mousedown
          onClick$={() =>
            window.dispatchEvent(
              new CustomEvent(LIVING_DESK_TOGGLE_EVENT, {
                detail: { open: true },
              }),
            )
          }
        >
          {state.cap ? `${state.estimating ? "≈" : ""}${state.cap}` : "·"}
        </button>
        <div class="ld-spine__track" aria-hidden="true">
          {state.rules.map((top, i) => (
            <span
              key={`r${i}`}
              class="ld-spine__rule"
              style={{ top: `${top * 100}%` }}
            />
          ))}
          {state.marks.map((m) => (
            <button
              key={m.id}
              type="button"
              tabIndex={-1}
              class={[
                "ld-spine__tick",
                `ld-spine__tick--${m.lens}`,
                { "is-faint": !m.strong },
              ]}
              style={{ top: `${m.top * 100}%` }}
              aria-label="Jump to occurrence"
              preventdefault:mousedown
              onClick$={() => livingDeskController()?.jumpTo(m.id)}
            />
          ))}
        </div>
      </div>
    );
  },
);
