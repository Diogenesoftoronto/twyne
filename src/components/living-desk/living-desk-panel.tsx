import {
  $,
  component$,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import {
  EMPTY_LIVING_DESK,
  LIVING_DESK_EVENT,
  livingDeskController,
  livingDeskSnapshot,
  type Finding,
  type LensId,
  type LivingDeskController,
  type LivingDeskSnapshot,
  type Occurrence,
} from "../../utils/living-desk-contract";
import {
  liveReviewSnapshot,
  type LiveReviewSnapshot,
} from "../../utils/live-review";
import styles from "./living-desk.css?inline";

const LENSES: { id: LensId | null; label: string }[] = [
  { id: "stance", label: "Stance" },
  { id: "naming", label: "Names" },
  { id: "style", label: "Style" },
  { id: "presence", label: "Presence" },
  { id: null, label: "Off" },
];
const STALE_NOTE = "This changed since it was found";
const ENTITY_PALETTE = ["cobalt", "sage", "periwinkle", "mustard", "blush"];
const cssString = (value: string) =>
  Array.from(value, (c) => `\\${c.codePointAt(0)!.toString(16)} `).join("");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const one = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${one(Math.abs(n))}`;
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NOOP_CONTROLLER: LivingDeskController = {
  setOpen() {},
  setLens() {},
  focus() {},
  preview() {},
  applyFix: () => false,
  applyAll: () => 0,
  markDeliberate() {},
  jumpTo() {},
  jumpToSection() {},
  spineFraction: () => null,
  confirm() {},
};
const controllerFor = (fixture: boolean) =>
  fixture ? NOOP_CONTROLLER : livingDeskController();

function returnToDesk() {
  requestAnimationFrame(() => {
    const target =
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-living-desk-toggle], .ld-spine__cap",
        ),
      ).find((element) => element.getClientRects().length > 0) ??
      document.querySelector<HTMLElement>(".ProseMirror");
    target?.focus({ preventScroll: true });
  });
}

function fixLabel(finding: Finding, occ: Occurrence): string {
  if (finding.lens === "stance" && occ.fix === "I") return "Make it I";
  return `Use “${occ.fix ?? occ.text}”`;
}
function allLabel(finding: Finding, n: number): string {
  const fixes = new Set(
    finding.occurrences
      .filter((o) => o.flagged && o.fix !== undefined)
      .map((o) => o.fix),
  );
  if (finding.lens === "stance")
    return fixes.size === 1 && fixes.has("I")
      ? `Make all ${n} I`
      : "Use I, me and my";
  const styleActions: Record<string, string> = {
    "style:quotes": "Match quotation marks",
    "style:em-dash": "Match dash spacing",
    "style:numbers": "Match number style",
    "style:serial-comma": "Match list punctuation",
  };
  return (
    styleActions[finding.id] ??
    (fixes.size === 1
      ? `Use “${[...fixes][0]}” throughout`
      : `Update all ${n} spellings`)
  );
}
function deliberateLabel(finding: Finding): string {
  if (finding.lens === "naming") {
    const variant = finding.occurrences.find((o) => o.flagged)?.text;
    if (variant) return `${variant} is a different name`;
  }
  return "The mix is deliberate";
}
function impactLabel(finding: Finding, criterion: string): string {
  if (finding.state === "resolved") return "resolved";
  if (finding.state === "deliberate") return "deliberate";
  if (finding.impact == null) return criterion;
  return finding.impact < 0.05 ? "small" : `≈ +${finding.impact.toFixed(2)}`;
}
function provenanceLabel(occ: Occurrence): string {
  if (occ.provenance !== "jev") return occ.provenance;
  return occ.probability == null
    ? "Jev"
    : `Jev ${occ.probability.toFixed(2).replace(/^0/, "")}`;
}

interface DeskUi {
  snap: LivingDeskSnapshot;
  order: string[];
  shownEstimate: number | null;
  ready: boolean;
  animate: boolean;
  tone: Record<string, "up" | "down">;
  delta: LivingDeskSnapshot["score"]["lastChange"];
  announce: string;
  stale: string[];
  reviewMessage: string;
  reviewStatus: LiveReviewSnapshot["status"];
  confirmRequested: boolean;
}

/** Snapshot-only presentation. All document mutations go through the controller. */
export const LivingDeskPanel = component$<{
  zen?: boolean;
  readOnly?: boolean;
  fixture?: LivingDeskSnapshot;
}>((props) => {
  useStyles$(styles);
  const root = useSignal<HTMLElement>();
  const list = useSignal<HTMLOListElement>();
  const ui = useStore<DeskUi>(
    {
      snap: clone(props.fixture ?? EMPTY_LIVING_DESK),
      order: props.fixture?.findings.map((f) => f.id) ?? [],
      shownEstimate: props.fixture?.score.estimate ?? null,
      ready: !!props.fixture,
      animate: false,
      tone: {},
      delta: props.fixture?.score.lastChange ?? null,
      announce: "",
      stale: [],
      reviewMessage: "",
      reviewStatus: "waiting",
      confirmRequested: false,
    },
    { deep: false },
  );

  // The aside stays mounted when closed so subscriptions and pointer guards survive.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      const fixture = track(() => props.fixture);
      let disposed = false;
      let frame = 0;
      let lastSnapAt = performance.now();
      let lastChangeAt = 0;
      let typingUntil = 0;
      let pointerInside = false;
      let lastMove = 0;
      let pending: string[] | null = null;
      let reorderTimer = 0;
      let deltaTimer = 0;
      let quietTimer = 0;
      let previousValues = new Map<string, number>();
      const toneTimers = new Map<string, number>();
      const flips = new Set<Animation>();
      const scroller = document.querySelector<HTMLElement>(
        ".manuscript-scroller",
      );
      const alignPanel = () =>
        root.value?.style.setProperty(
          "--ld-panel-top",
          `${Math.max(80, (scroller?.getBoundingClientRect().top ?? 72) + 8)}px`,
        );
      alignPanel();
      const geometry = new ResizeObserver(alignPanel);
      if (scroller) geometry.observe(scroller);
      window.addEventListener("resize", alignPanel);

      const setEstimate = (target: number | null, tween: boolean) => {
        cancelAnimationFrame(frame);
        const from = ui.shownEstimate;
        if (
          !tween ||
          from == null ||
          target == null ||
          target === from ||
          reducedMotion()
        ) {
          ui.shownEstimate = target;
          return;
        }
        const start = performance.now();
        const step = (now: number) => {
          if (disposed) return;
          const k = Math.min(1, (now - start) / 600);
          ui.shownEstimate = from + (target - from) * (1 - Math.pow(1 - k, 3));
          if (k < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      };

      const applyOrder = (next: string[]) => {
        if (next.join("\n") === ui.order.join("\n")) return;
        const before = new Map<string, number>();
        list.value
          ?.querySelectorAll<HTMLElement>("[data-ld-card]")
          .forEach((el) =>
            before.set(el.dataset.ldCard!, el.getBoundingClientRect().top),
          );
        ui.order = next;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (disposed || reducedMotion() || performance.now() < typingUntil)
              return;
            list.value
              ?.querySelectorAll<HTMLElement>("[data-ld-card]")
              .forEach((el) => {
                const oldTop = before.get(el.dataset.ldCard!);
                const dy =
                  oldTop == null ? 0 : oldTop - el.getBoundingClientRect().top;
                if (Math.abs(dy) < 1) return;
                const animation = el.animate(
                  [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
                  { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" },
                );
                flips.add(animation);
                void animation.finished.then(
                  () => flips.delete(animation),
                  () => flips.delete(animation),
                );
              });
          }),
        );
      };
      const tryReorder = () => {
        window.clearTimeout(reorderTimer);
        if (!pending) return;
        const now = performance.now();
        // Keyboard users keep the card they are working in stationary too.
        if (list.value?.contains(document.activeElement)) return;
        if (now < typingUntil || (pointerInside && now - lastMove < 1500)) {
          reorderTimer = window.setTimeout(
            tryReorder,
            Math.max(
              50,
              typingUntil - now,
              pointerInside ? 1500 - (now - lastMove) : 0,
            ),
          );
          return;
        }
        const next = pending;
        pending = null;
        applyOrder(next);
      };

      const onSnapshot = (next: LivingDeskSnapshot) => {
        const now = performance.now();
        const changed = next.score.lastChange;
        const fresh = !!changed && changed.at > lastChangeAt;
        const scoreChanged =
          next.score.estimate !== ui.snap.score.estimate ||
          next.score.criteria.some(
            (c) => c.value !== previousValues.get(c.key),
          );
        const animate =
          scoreChanged &&
          (fresh || (now - lastSnapAt >= 2000 && now >= typingUntil));
        lastSnapAt = now;
        if (fresh) lastChangeAt = changed.at;
        ui.animate = animate && !reducedMotion();
        ui.ready = !!controllerFor(!!fixture);
        if (animate) {
          const tones = { ...ui.tone };
          for (const c of next.score.criteria) {
            const was = previousValues.get(c.key);
            if (was == null || Math.abs(c.value - was) < 0.005) continue;
            tones[c.key] = c.value > was ? "up" : "down";
            window.clearTimeout(toneTimers.get(c.key));
            toneTimers.set(
              c.key,
              window.setTimeout(() => {
                const nextTone = { ...ui.tone };
                delete nextTone[c.key];
                ui.tone = nextTone;
              }, 2400),
            );
          }
          ui.tone = tones;
        }
        previousValues = new Map(
          next.score.criteria.map((c) => [c.key, c.value]),
        );
        if (fresh) {
          ui.delta = changed;
          window.clearTimeout(deltaTimer);
          deltaTimer = window.setTimeout(() => {
            ui.delta = null;
          }, 2800);
          const criterion = next.score.criteria.find(
            (c) => c.key === changed.criterion,
          );
          const source = /^¶\d+$/.test(changed.source)
            ? `the fix in paragraph ${changed.source.slice(1)}`
            : changed.source;
          ui.announce = `${criterion?.label ?? changed.criterion} ${changed.delta >= 0 ? "up" : "down"} ${one(Math.abs(changed.delta))} after ${source}.`;
        } else if (!changed) {
          window.clearTimeout(deltaTimer);
          ui.delta = null;
          ui.tone = {};
          ui.announce = "";
        }
        if (next.folioId !== ui.snap.folioId) ui.stale = [];
        ui.snap = clone(next);
        setEstimate(next.score.estimate, animate);
        pending = next.findings.map((f) => f.id);
        tryReorder();
      };
      const onEvent = (event: Event) =>
        onSnapshot((event as CustomEvent<LivingDeskSnapshot>).detail);
      const onReview = (event?: Event) => {
        if (fixture) return;
        const next = event
          ? (event as CustomEvent<LiveReviewSnapshot>).detail
          : liveReviewSnapshot();
        if (next.folioId !== ui.snap.folioId || !next.folioId) return;
        ui.reviewStatus = next.status;
        ui.reviewMessage =
          ui.confirmRequested ||
          ["paused", "offline", "unavailable", "reading"].includes(next.status)
            ? next.message
            : "";
      };
      const onMove = () => {
        pointerInside = true;
        lastMove = performance.now();
        if (pending) tryReorder();
      };
      const onLeave = () => {
        pointerInside = false;
        tryReorder();
      };
      const onBlur = () => requestAnimationFrame(tryReorder);
      const onTyping = (event: Event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest(".ProseMirror")
        )
          return;
        const wasTyping = performance.now() < typingUntil;
        typingUntil = performance.now() + 2000;
        window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(() => {
          root.value?.removeAttribute("data-ld-typing");
          tryReorder();
        }, 2000);
        if (wasTyping) return;
        root.value?.setAttribute("data-ld-typing", "");
        cancelAnimationFrame(frame);
        flips.forEach((animation) => animation.cancel());
        ui.animate = false;
        ui.shownEstimate = ui.snap.score.estimate;
        ui.delta = null;
      };
      const onEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !ui.snap.open || props.zen || fixture)
          return;
        if (document.querySelector("dialog[open], [aria-modal='true']")) return;
        const ctl = livingDeskController();
        if (!ctl) return;
        event.preventDefault();
        event.stopPropagation();
        if (ui.snap.focusedFinding || ui.snap.lens) {
          ctl.focus(null);
          ctl.setLens(null);
        } else {
          ctl.setOpen(false);
          returnToDesk();
        }
      };

      const initial = fixture ?? livingDeskSnapshot();
      ui.snap = clone(initial);
      ui.order = initial.findings.map((f) => f.id);
      ui.shownEstimate = initial.score.estimate;
      ui.ready = !!controllerFor(!!fixture);
      ui.delta = fixture?.score.lastChange ?? null;
      lastChangeAt = initial.score.lastChange?.at ?? 0;
      previousValues = new Map(
        initial.score.criteria.map((c) => [c.key, c.value]),
      );
      if (!fixture) window.addEventListener(LIVING_DESK_EVENT, onEvent);
      onReview();
      window.addEventListener("twyne:live-review", onReview);
      const listEl = list.value;
      listEl?.addEventListener("pointerenter", onMove, { passive: true });
      listEl?.addEventListener("pointermove", onMove, { passive: true });
      listEl?.addEventListener("pointerleave", onLeave);
      listEl?.addEventListener("focusout", onBlur);
      document.addEventListener("beforeinput", onTyping, true);
      window.addEventListener("keydown", onEscape, true);
      cleanup(() => {
        disposed = true;
        geometry.disconnect();
        window.removeEventListener("resize", alignPanel);
        cancelAnimationFrame(frame);
        flips.forEach((animation) => animation.cancel());
        [reorderTimer, deltaTimer, quietTimer, ...toneTimers.values()].forEach(
          window.clearTimeout,
        );
        window.removeEventListener(LIVING_DESK_EVENT, onEvent);
        window.removeEventListener("twyne:live-review", onReview);
        listEl?.removeEventListener("pointerenter", onMove);
        listEl?.removeEventListener("pointermove", onMove);
        listEl?.removeEventListener("pointerleave", onLeave);
        listEl?.removeEventListener("focusout", onBlur);
        document.removeEventListener("beforeinput", onTyping, true);
        window.removeEventListener("keydown", onEscape, true);
      });
    },
    { strategy: "document-ready" },
  );

  const refocusCard = $((findingId: string) => {
    requestAnimationFrame(() =>
      root.value
        ?.querySelector<HTMLElement>(
          `[data-ld-card="${CSS.escape(findingId)}"] .ld-card__head`,
        )
        ?.focus({ preventScroll: true }),
    );
  });
  const onFix = $((findingId: string, occurrenceId: string) => {
    const ctl = controllerFor(!!props.fixture);
    if (!ctl || props.readOnly) return;
    if (!ctl.applyFix(findingId, occurrenceId) && !props.fixture) {
      ui.stale = [...new Set([...ui.stale, occurrenceId])];
    }
    void refocusCard(findingId);
  });
  const onConfirm = $(() => {
    const ctl = controllerFor(!!props.fixture);
    if (!ctl) return;
    ui.confirmRequested = true;
    const review = liveReviewSnapshot();
    ui.reviewMessage = props.fixture
      ? "Fixture: full reads are disabled."
      : review.folioId !== ui.snap.folioId
        ? "A full read is not available for this draft yet."
        : review.status === "unavailable" ||
            review.status === "offline" ||
            review.status === "paused"
          ? review.message
          : "Full read requested. Waiting for a pause in writing…";
    ctl.confirm();
  });
  const snap = ui.snap;
  const score = snap.score;
  const ordered = ui.order
    .map((id) => snap.findings.find((f) => f.id === id))
    .filter((f): f is Finding => !!f);
  for (const f of snap.findings) if (!ui.order.includes(f.id)) ordered.push(f);
  const estimating = score.confirmed == null || score.editsSinceConfirmed > 0;
  const shown = ui.shownEstimate;
  const shortDraft =
    snap.sections.reduce((n, s) => n + s.words, 0) < 150 &&
    score.estimate == null;
  const lastDelta = ui.delta;

  return (
    <aside
      ref={root}
      class="ld-panel"
      hidden={props.zen || !snap.open}
      aria-label="The piece"
      data-readonly={props.readOnly ? "" : undefined}
    >
      <style
        dangerouslySetInnerHTML={snap.presence
          .map(
            (row, i) =>
              `.ld-occ[data-ld-lens="presence"][data-ld-label="${cssString(row.entity)}"]{--ld-entity-color:var(--color-${ENTITY_PALETTE[i % 5]})}`,
          )
          .join("\n")}
      />
      <header class="ld-panel__head">
        <p class="dept-label">The piece</p>
        {snap.judgement === "offline" && (
          <span
            class="ld-chip"
            title="No judgement model reachable, so classifications are by rule."
          >
            rule-only
          </span>
        )}
        {snap.judgement === "reading" && <span class="ld-quiet">reading…</span>}
        <button
          type="button"
          class="ld-close"
          aria-label="Close the desk"
          title="Close (Esc)"
          disabled={!ui.ready}
          preventdefault:mousedown
          onClick$={() => {
            controllerFor(!!props.fixture)?.setOpen(false);
            if (!props.fixture) returnToDesk();
          }}
        >
          Close
        </button>
      </header>
      <div class="ld-live" role="status" aria-live="polite" aria-atomic="true">
        {ui.announce}
      </div>
      <section class="ld-score" aria-label="Score">
        <div class="ld-score__top">
          <span class="ld-score__num">
            {shown == null ? (
              "—"
            ) : (
              <>
                {estimating && <span class="ld-score__approx">≈</span>}
                {one(shown)}
              </>
            )}
          </span>
          <div class="ld-score__meta">
            {score.confirmed != null && (
              <p class="ld-score__letter">
                {score.confirmedLetter ?? one(score.confirmed)}
                <span> confirmed {one(score.confirmed)}</span>
              </p>
            )}
            <p class="ld-quiet">
              {shown == null
                ? "No estimate yet"
                : score.confirmed == null
                  ? "rule estimate · not yet confirmed"
                  : estimating
                    ? `estimate · ${score.editsSinceConfirmed} edit${score.editsSinceConfirmed === 1 ? "" : "s"} since the read`
                    : "confirmed by a whole-piece read"}
            </p>
          </div>
        </div>
        {shown != null && estimating && (
          <button
            type="button"
            class="ld-link"
            disabled={
              !ui.ready ||
              snap.judgement === "reading" ||
              ui.reviewStatus === "reading"
            }
            preventdefault:mousedown
            onClick$={onConfirm}
          >
            Confirm with a full read
          </button>
        )}
        {ui.reviewMessage && (
          <p class="ld-review-message">{ui.reviewMessage}</p>
        )}
        <details class="ld-criteria-disclosure">
          <summary>
            Score details <span>by rule / by review</span>
          </summary>
          <ul class="ld-crits">
            {score.criteria.map((c) => (
              <li key={c.key} class="ld-crit" data-ld-criterion={c.key}>
                <span class="ld-crit__label">
                  {c.label}
                  <em>{c.source === "rule" ? "by rule" : "by review"}</em>
                </span>
                <span class="ld-crit__track" aria-hidden="true">
                  <span
                    class={[
                      "ld-crit__fill",
                      {
                        "is-animated": ui.animate,
                        "is-up": ui.tone[c.key] === "up",
                        "is-down": ui.tone[c.key] === "down",
                      },
                    ]}
                    style={{
                      width: `${Math.max(0, Math.min(10, c.value)) * 10}%`,
                    }}
                  />
                </span>
                <span class="ld-crit__value">{one(c.value)}</span>
                {lastDelta?.criterion === c.key &&
                  Math.abs(lastDelta.delta) >= 0.05 && (
                    <span
                      key={lastDelta.at}
                      class={[
                        "ld-delta",
                        lastDelta.delta >= 0
                          ? "ld-delta--up"
                          : "ld-delta--down",
                        { "is-static": !!props.fixture },
                      ]}
                    >
                      {signed(lastDelta.delta)} · {lastDelta.source}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        </details>
        {score.criteria.length > 0 && (
          <div class="ld-compact-change">
            {score.criteria.find((c) => c.key === "consistency") && (
              <>
                <span>
                  Consistency <em>by rule</em>
                </span>
                <span class="ld-crit__track" aria-hidden="true">
                  <span
                    class={[
                      "ld-crit__fill",
                      {
                        "is-animated": ui.animate,
                        "is-up": ui.tone.consistency === "up",
                        "is-down": ui.tone.consistency === "down",
                      },
                    ]}
                    style={{
                      width: `${Math.max(0, Math.min(10, score.criteria.find((c) => c.key === "consistency")!.value)) * 10}%`,
                    }}
                  />
                </span>
                <span class="ld-crit__value">
                  {one(
                    score.criteria.find((c) => c.key === "consistency")!.value,
                  )}
                </span>
              </>
            )}
            {lastDelta && (
              <span
                key={lastDelta.at}
                class={[
                  "ld-delta",
                  "ld-delta--compact",
                  lastDelta.delta >= 0 ? "ld-delta--up" : "ld-delta--down",
                ]}
              >
                {signed(lastDelta.delta)} · {lastDelta.source}
              </span>
            )}
          </div>
        )}
      </section>
      <div class="ld-lenses" role="group" aria-label="Lens">
        <span class="dept-label">Lens</span>
        {LENSES.map((lens) => (
          <button
            key={lens.label}
            type="button"
            class="ld-lens"
            aria-pressed={snap.lens === lens.id}
            disabled={!ui.ready}
            preventdefault:mousedown
            onClick$={() => controllerFor(!!props.fixture)?.setLens(lens.id)}
          >
            {lens.label}
          </button>
        ))}
      </div>
      <ol ref={list} class="ld-cards">
        {ordered.map((finding) => {
          const open = snap.focusedFinding === finding.id;
          const done =
            finding.state === "resolved" || finding.state === "deliberate";
          const fixable = finding.occurrences.filter(
            (o) =>
              o.flagged &&
              o.fix !== undefined &&
              o.note !== STALE_NOTE &&
              !ui.stale.includes(o.id),
          );
          const canFix = ui.ready && !props.readOnly;
          const context = finding.occurrences.filter((o) => !o.flagged);
          const singular = context.filter(
            (o) =>
              o.label === "singular" || /^(I|me|my|mine|myself)$/i.test(o.text),
          );
          const plural = context.filter((o) => !singular.includes(o));
          const criterion =
            score.criteria.find((c) => c.key === finding.criterion)?.label ??
            finding.criterion;
          return (
            <li
              key={finding.id}
              class={[
                "ld-card",
                `ld-card--${finding.lens}`,
                { "is-open": open, "is-done": done },
              ]}
              data-ld-card={finding.id}
              data-state={finding.state}
            >
              <button
                type="button"
                class="ld-card__head"
                aria-expanded={open}
                disabled={!ui.ready}
                preventdefault:mousedown
                onClick$={() =>
                  controllerFor(!!props.fixture)?.focus(
                    open ? null : finding.id,
                  )
                }
              >
                <span class="ld-card__kicker dept-label">{finding.level}</span>
                <span class="ld-card__impact">
                  {impactLabel(finding, criterion)}
                </span>
                <span class="ld-card__title">
                  {done && <span aria-hidden="true">✓ </span>}
                  {finding.title}
                </span>
                <span class="ld-card__metric">
                  {finding.metric}
                  {snap.judgement === "reading" &&
                    finding.provenance !== "rule" && (
                      <span class="ld-quiet"> · reading…</span>
                    )}
                </span>
              </button>
              {open && (
                <div class="ld-card__body">
                  {!props.readOnly && !done && (
                    <div class="ld-actions">
                      {fixable.length > 1 &&
                        finding.actions.includes("fix-all") && (
                          <button
                            type="button"
                            class="ld-btn ld-btn--primary"
                            disabled={!canFix}
                            preventdefault:mousedown
                            onClick$={() => {
                              controllerFor(!!props.fixture)?.applyAll(
                                finding.id,
                              );
                              void refocusCard(finding.id);
                            }}
                          >
                            {allLabel(finding, fixable.length)}
                          </button>
                        )}
                      {finding.actions.includes("deliberate") && (
                        <button
                          type="button"
                          class="ld-btn"
                          disabled={!canFix}
                          preventdefault:mousedown
                          onClick$={() => {
                            controllerFor(!!props.fixture)?.markDeliberate(
                              finding.id,
                              true,
                            );
                            void refocusCard(finding.id);
                          }}
                        >
                          {deliberateLabel(finding)}
                        </button>
                      )}
                    </div>
                  )}
                  {finding.state === "deliberate" ? (
                    <p class="ld-note">
                      {finding.deliberateNote ??
                        "Kept on purpose. Twyne will flag only new drift."}
                    </p>
                  ) : finding.state === "resolved" ? (
                    <p class="ld-note">Resolved. {finding.metric}</p>
                  ) : (
                    <>
                      {finding.lens === "presence" && (
                        <PresenceGrid snap={snap} />
                      )}
                      {finding.occurrences
                        .filter((o) => o.flagged)
                        .map((occ) => (
                          <OccurrenceRow
                            key={occ.id}
                            finding={finding}
                            occ={occ}
                            previewing={snap.previewing === occ.id}
                            ready={ui.ready}
                            readOnly={!!props.readOnly}
                            canFix={
                              canFix && finding.actions.includes("fix-one")
                            }
                            fixture={!!props.fixture}
                            stale={
                              ui.stale.includes(occ.id) ||
                              occ.note === STALE_NOTE
                            }
                            onFix$={onFix}
                          />
                        ))}
                      {[
                        {
                          rows: plural,
                          label: `${plural.length} ${finding.lens === "stance" ? "plural uses" : "canonical uses"} left alone`,
                        },
                        {
                          rows: singular,
                          label: `${singular.length} singular uses`,
                        },
                      ]
                        .filter((group) => group.rows.length > 0)
                        .map((group) => (
                          <details
                            key={group.label}
                            class="ld-context-disclosure"
                          >
                            <summary>{group.label}</summary>
                            {group.rows.map((occ) => (
                              <OccurrenceRow
                                key={occ.id}
                                finding={finding}
                                occ={occ}
                                previewing={false}
                                ready={ui.ready}
                                readOnly={true}
                                canFix={false}
                                fixture={!!props.fixture}
                                stale={false}
                                onFix$={onFix}
                              />
                            ))}
                          </details>
                        ))}
                    </>
                  )}
                  {!props.readOnly && (
                    <div class="ld-actions">
                      {finding.state === "deliberate" ? (
                        <button
                          type="button"
                          class="ld-btn"
                          disabled={!canFix}
                          preventdefault:mousedown
                          onClick$={() => {
                            controllerFor(!!props.fixture)?.markDeliberate(
                              finding.id,
                              false,
                            );
                            void refocusCard(finding.id);
                          }}
                        >
                          Check these again
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {snap.findings.length === 0 && (
        <div class="ld-empty">
          <p>
            {snap.analysisStatus === "limited"
              ? "The piece is over 80,000 characters. Split it into folios so the desk can read each one."
              : shortDraft
                ? "Write about 150 words for an overall estimate."
                : "Nothing across the piece needs you right now."}
          </p>
          {snap.analysisStatus !== "limited" && (
            <p class="ld-fine">Watching stance, names and the style sheet.</p>
          )}
        </div>
      )}
      {snap.findings.length > 0 &&
        snap.findings.every(
          (f) => f.state === "resolved" || f.state === "deliberate",
        ) && (
          <p class="ld-empty">Nothing across the piece needs you right now.</p>
        )}
    </aside>
  );
});

const OccurrenceRow = component$<{
  finding: Finding;
  occ: Occurrence;
  previewing: boolean;
  ready: boolean;
  canFix: boolean;
  readOnly: boolean;
  fixture: boolean;
  stale: boolean;
  onFix$: PropFunction<(findingId: string, occurrenceId: string) => void>;
}>((props) => {
  const { occ, finding } = props;
  return (
    <div
      class={[
        "ld-occrow",
        {
          "is-previewing": props.previewing,
          "is-context": !occ.flagged,
          "is-stale": props.stale,
        },
      ]}
      onMouseEnter$={() =>
        controllerFor(props.fixture)?.preview(props.stale ? null : occ.id)
      }
      onMouseLeave$={() => controllerFor(props.fixture)?.preview(null)}
      onFocusIn$={() =>
        controllerFor(props.fixture)?.preview(props.stale ? null : occ.id)
      }
      onFocusOut$={(event, el) => {
        if (!el.contains(event.relatedTarget as Node | null))
          controllerFor(props.fixture)?.preview(null);
      }}
    >
      <button
        type="button"
        class="ld-occrow__text"
        title="Go to this passage"
        disabled={!props.ready}
        preventdefault:mousedown
        onClick$={() => controllerFor(props.fixture)?.jumpTo(occ.id)}
      >
        <span class="ld-occrow__para">¶{occ.paragraph}</span>
        {occ.before}{" "}
        {occ.fix !== undefined && !props.stale ? (
          <>
            <del>{occ.text}</del> <ins>{occ.fix}</ins>
          </>
        ) : (
          <mark>{occ.text}</mark>
        )}{" "}
        {occ.after}
      </button>
      <div class="ld-occrow__foot">
        <span class="ld-chip">{provenanceLabel(occ)}</span>
        {occ.label && (
          <span class="ld-chip">
            {occ.label}
            {occ.provenance === "model" && occ.probability != null
              ? ` ${occ.probability.toFixed(2).replace(/^0/, "")}`
              : ""}
          </span>
        )}
        {!occ.flagged && (
          <span class="ld-note ld-note--inline">left alone</span>
        )}
        {(props.stale || occ.note) && (
          <span class="ld-note ld-note--inline">
            {props.stale ? STALE_NOTE : occ.note}
          </span>
        )}
        {!props.readOnly && (occ.fix !== undefined || props.stale) && (
          <button
            type="button"
            class="ld-btn ld-btn--primary ld-occrow__fix"
            disabled={!props.canFix || props.stale}
            preventdefault:mousedown
            onClick$={() => props.onFix$(finding.id, occ.id)}
          >
            {fixLabel(finding, occ)}
          </button>
        )}
      </div>
    </div>
  );
});

const PresenceGrid = component$<{ snap: LivingDeskSnapshot }>(({ snap }) => (
  <div class="ld-grid-scroll">
    <table class="ld-grid" aria-label="Who appears in which section">
      <thead>
        <tr>
          <th scope="col">Entity</th>
          {snap.sections.map((s) => (
            <th key={s.index} scope="col" title={s.title}>
              §{s.index + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snap.presence.map((row, i) => (
          <tr key={row.entity}>
            <th scope="row">{row.entity}</th>
            {snap.sections.map((s, j) => (
              <td
                key={s.index}
                title={`${row.entity} · ${s.title}: ${row.counts[j] ?? 0} mentions`}
              >
                <span
                  class={["ld-cell", { "is-on": (row.counts[j] ?? 0) > 0 }]}
                  data-ld-entity={i % 5}
                >
                  {row.counts[j] ?? 0}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
));
