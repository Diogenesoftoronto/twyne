import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type Component,
} from "@qwik.dev/core";
import { useGT, useTranslate } from "gt-qwik";
import { translate } from "gt-qwik/runtime";
import type { TwyneIconName } from "../../utils/icon-system";
import { Icon } from "../ui/icon";
import {
  FieldnoteArrival,
  FieldnoteDesk,
  FieldnoteRelease,
  FieldnoteReleaseCheck,
  MarshDomain,
  MarshPublications,
  MarshReview,
  MarshStyleBook,
  OrchardKdp,
  OrchardReaderNotes,
  OrchardReaders,
  OrchardReadiness,
  type JourneyViewProps,
} from "./journey-views";
import { allowsMotion } from "../../utils/motion";
import "./landing-journey.css";

export interface Journey {
  /** Anchor and DOM id suffix: `#walk-<id>` opens this walkthrough. */
  id: string;
  /** Key under `walk.` in the landing dictionary. */
  copy: "fieldnote" | "marsh" | "orchard";
  /**
   * Whether what the walkthrough shows can be used today. Every journey here
   * is Twyne Publishing work from the publishing lab, so all are "coming".
   */
  availability: "today" | "coming";
  /** Marks the tab, and the audience card that links to it. */
  icon: TwyneIconName;
  views: Component<JourneyViewProps>[];
}

/**
 * The three walkthroughs, one per audience. Each step's narration lives at
 * `walk.<copy>.s<n>Title|Body`; the view at the same index is the
 * product screen for that step.
 */
export const JOURNEYS: Journey[] = [
  {
    id: "fieldnote",
    copy: "fieldnote",
    availability: "coming",
    icon: "feather",
    views: [
      FieldnoteArrival,
      FieldnoteDesk,
      FieldnoteReleaseCheck,
      FieldnoteRelease,
    ],
  },
  {
    id: "marsh-lane",
    copy: "marsh",
    availability: "coming",
    icon: "buildings",
    views: [MarshStyleBook, MarshReview, MarshPublications, MarshDomain],
  },
  {
    id: "orchard",
    copy: "orchard",
    availability: "coming",
    icon: "book-open",
    views: [OrchardReadiness, OrchardReaders, OrchardReaderNotes, OrchardKdp],
  },
];

type Device = "desktop" | "mobile";

export const JourneyWalkthrough = component$(() => {
  const t = useTranslate();
  const gt = useGT();
  const journeyIndex = useSignal(0);
  // Each walkthrough remembers its own step, so switching tabs and back
  // returns to where the visitor left it.
  const steps = useSignal<number[]>(JOURNEYS.map(() => 0));
  const device = useSignal<Device>("desktop");
  const announcement = useSignal("");
  const stage = useSignal<HTMLElement>();
  // A demonstration pointer walks the current journey: it glides to the
  // control each screen is about, presses it, and moves on to the next step.
  const playing = useSignal(false);

  const announce = $((journey: number, step: number) => {
    const j = JOURNEYS[journey];
    // Handlers capture the serializable GT state, never the render-only `t`.
    announcement.value = translate(gt, "walk.announce", {
      journey: translate(gt, `walk.${j.copy}.tab`),
      current: step + 1,
      total: j.views.length,
      title: translate(gt, `walk.${j.copy}.s${step + 1}Title`),
    });
  });

  const goToStep = $((journey: number, step: number) => {
    const next = [...steps.value];
    next[journey] = Math.max(
      0,
      Math.min(JOURNEYS[journey].views.length - 1, step),
    );
    steps.value = next;
    void announce(journey, next[journey]);
  });

  const selectJourney = $((index: number, focus = false) => {
    const next = (index + JOURNEYS.length) % JOURNEYS.length;
    journeyIndex.value = next;
    void announce(next, steps.value[next]);
    if (focus) {
      document.getElementById(`walk-tab-${JOURNEYS[next].id}`)?.focus();
    }
  });

  // `#walk-<id>` links (from the audience cards, or shared) open that
  // walkthrough. The anchor itself is the tab panel, so the browser has
  // already scrolled to it.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const fromHash = () => {
      const match = JOURNEYS.findIndex(
        (journey) => location.hash === `#walk-${journey.id}`,
      );
      if (match >= 0) journeyIndex.value = match;
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    cleanup(() => window.removeEventListener("hashchange", fromHash));
  });

  // The demonstration starts by itself the first time the walkthrough is
  // properly on screen, where ambient motion is welcome, and stops for good
  // once it scrolls away. The Show me button plays it again.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = stage.value;
    if (!el || !("IntersectionObserver" in window)) return;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!started && allowsMotion("ambient")) playing.value = true;
            started = true;
          } else if (!entry.isIntersecting) playing.value = false;
        }
      },
      { threshold: [0, 0.6] },
    );
    observer.observe(el);
    cleanup(() => observer.disconnect());
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const on = track(() => playing.value);
    const root = stage.value;
    const pointer = root?.querySelector<HTMLElement>(".jw-pointer");
    if (!root || !pointer) return;
    if (!on) {
      pointer.hidden = true;
      return;
    }
    if (!allowsMotion("feedback")) {
      playing.value = false;
      return;
    }
    let alive = true;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    // Where the pointer is, within the stage. It enters from the middle.
    const at = { x: root.clientWidth / 2, y: root.clientHeight / 2 };
    const put = () => {
      pointer.style.transform = `translate(${at.x}px, ${at.y}px)`;
    };
    const glide = async (target: Element) => {
      const frame = root.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const to = {
        x: box.left + box.width / 2 - frame.left,
        y: box.top + box.height / 2 - frame.top,
      };
      const far = Math.hypot(to.x - at.x, to.y - at.y);
      const motion = pointer.animate(
        [
          { transform: `translate(${at.x}px, ${at.y}px)` },
          { transform: `translate(${to.x}px, ${to.y}px)` },
        ],
        {
          duration: Math.max(380, Math.min(1100, far * 2.2)),
          easing: "cubic-bezier(0.45, 0, 0.2, 1)",
        },
      );
      await motion.finished.catch(() => undefined);
      at.x = to.x;
      at.y = to.y;
      put();
    };
    const press = async (target: HTMLElement) => {
      pointer.dataset.pressing = "";
      await wait(240);
      delete pointer.dataset.pressing;
      if (alive) target.click();
    };
    const usable = (control: HTMLElement) =>
      control.getClientRects().length > 0 &&
      !(control as HTMLButtonElement).disabled;
    // Bring a control into its own screen's view without moving the page.
    const reveal = async (view: HTMLElement, target: HTMLElement) => {
      const frame = view.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      if (box.top >= frame.top + 8 && box.bottom <= frame.bottom - 8) return;
      view.scrollTo({
        top:
          view.scrollTop +
          (box.top - frame.top) -
          (frame.height - box.height) / 2,
        behavior: "smooth",
      });
      await wait(450);
    };
    const run = async () => {
      put();
      pointer.hidden = false;
      await wait(600);
      while (alive) {
        const panel = root.querySelector<HTMLElement>(".jw-panel.is-active");
        if (!panel) break;
        const views = Array.from(
          panel.querySelectorAll<HTMLElement>(".jw-view"),
        );
        const step = () =>
          views.findIndex((view) => view.classList.contains("is-active"));
        const index = step();
        const view = views[index];
        if (!view) break;
        // What the screen is about first, then whatever moves it on.
        const marked = Array.from(
          view.querySelectorAll<HTMLElement>("[data-demo]"),
        ).filter(usable);
        const targets = [
          ...marked.filter((c) => c.dataset.demo !== "next").slice(0, 1),
          ...marked.filter((c) => c.dataset.demo === "next").slice(0, 1),
        ];
        for (const target of targets) {
          await reveal(view, target);
          if (!alive) return;
          await glide(target);
          if (!alive) return;
          await press(target);
          await wait(1200);
          if (!alive) return;
          if (step() !== index) break;
        }
        if (step() !== index) continue;
        // The last screen of a journey is where the demonstration ends.
        if (index >= views.length - 1) break;
        const next = panel.querySelector<HTMLElement>(".jw-button--primary");
        if (!next) break;
        await glide(next);
        if (!alive) return;
        await press(next);
        await wait(900);
      }
      if (alive) playing.value = false;
    };
    void run();
    // The visitor takes over the moment they touch anything themselves.
    const takeOver = (event: Event) => {
      if (!event.isTrusted) return;
      if ((event.target as Element | null)?.closest?.(".jw-demo")) return;
      playing.value = false;
    };
    const walkthrough = root.closest<HTMLElement>(".jw") ?? root;
    walkthrough.addEventListener("pointerdown", takeOver, true);
    walkthrough.addEventListener("keydown", takeOver, true);
    cleanup(() => {
      alive = false;
      for (const motion of pointer.getAnimations()) motion.cancel();
      pointer.hidden = true;
      delete pointer.dataset.pressing;
      walkthrough.removeEventListener("pointerdown", takeOver, true);
      walkthrough.removeEventListener("keydown", takeOver, true);
    });
  });

  return (
    <div class="jw" data-device={device.value}>
      <div class="jw-controls">
        <div class="jw-tabs" role="tablist" aria-label={t("walk.tabsLabel")}>
          {JOURNEYS.map((journey, index) => {
            const selected = index === journeyIndex.value;
            return (
              <button
                key={journey.id}
                type="button"
                role="tab"
                id={`walk-tab-${journey.id}`}
                class="jw-tab"
                aria-selected={selected}
                aria-controls={`walk-${journey.id}`}
                tabIndex={selected ? 0 : -1}
                onClick$={() => selectJourney(index)}
                onKeyDown$={(event) => {
                  if (event.key === "ArrowRight")
                    selectJourney(index + 1, true);
                  else if (event.key === "ArrowLeft")
                    selectJourney(index - 1, true);
                  else if (event.key === "Home") selectJourney(0, true);
                  else if (event.key === "End")
                    selectJourney(JOURNEYS.length - 1, true);
                }}
              >
                <span class="jw-tab__icon">
                  <Icon
                    name={journey.icon}
                    size={20}
                    weight={selected ? "Filled" : "Outline"}
                  />
                </span>
                <span class="jw-tab__name">
                  {t(`walk.${journey.copy}.tab`)}
                </span>
                <span class="jw-tab__sub">
                  {t(`walk.${journey.copy}.tabSub`)}
                </span>
              </button>
            );
          })}
        </div>
        <div class="jw-tools">
          <button
            type="button"
            class="jw-demo"
            aria-pressed={playing.value}
            onClick$={() => {
              // Asked for at the end of a journey, it plays from the start.
              const journey = journeyIndex.value;
              if (
                !playing.value &&
                steps.value[journey] >= JOURNEYS[journey].views.length - 1
              )
                void goToStep(journey, 0);
              playing.value = !playing.value;
            }}
          >
            <Icon name={playing.value ? "pause" : "play"} />
            {playing.value ? t("walk.demoPause") : t("walk.demoPlay")}
          </button>
          <div class="jw-device" role="group" aria-label={t("walk.viewLabel")}>
            {(["desktop", "mobile"] as const).map((option) => (
              <button
                key={option}
                type="button"
                class="jw-device__option"
                aria-pressed={device.value === option}
                onClick$={() => (device.value = option)}
              >
                <Icon name={option === "desktop" ? "monitor" : "mobile"} />
                {t(`walk.${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p class="jw-note">
        <Icon name="info-circle" />
        <span>{t("walk.note")}</span>
      </p>

      <div class="jw-stage" ref={stage}>
        {/* The demonstration pointer. It is only a picture of a cursor: the
            controls it presses are the same ones the visitor can press. */}
        <span class="jw-pointer" aria-hidden="true" hidden>
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path d="M5 3l14 7.6-6.1 1.5 3.5 6.5-2.6 1.4-3.5-6.6L6 18.2z" />
          </svg>
        </span>
        {JOURNEYS.map((journey, ji) => {
          const active = ji === journeyIndex.value;
          const current = steps.value[ji];
          const total = journey.views.length;
          const last = current === total - 1;
          const nextJourney = JOURNEYS[ji + 1];
          return (
            <section
              key={journey.id}
              id={`walk-${journey.id}`}
              role="tabpanel"
              aria-labelledby={`walk-tab-${journey.id}`}
              class={["jw-panel", active ? "is-active" : ""]}
              inert={!active}
            >
              <div class="jw-narration">
                <div class="jw-stack">
                  {journey.views.map((_, si) => (
                    <div
                      key={si}
                      class={["jw-step", si === current ? "is-active" : ""]}
                      inert={si !== current}
                    >
                      <h3 class="jw-step__title">
                        <span class="jw-step__numeral" aria-hidden="true">
                          {["I", "II", "III", "IV", "V", "VI"][si]}
                        </span>{" "}
                        {t(`walk.${journey.copy}.s${si + 1}Title`)}
                      </h3>
                      <p class="jw-step__body">
                        {t(`walk.${journey.copy}.s${si + 1}Body`)}
                      </p>
                    </div>
                  ))}
                </div>
                <div class="jw-nav">
                  <ol class="jw-dots" aria-label={t("walk.stepsLabel")}>
                    {journey.views.map((_, si) => (
                      <li key={si}>
                        <button
                          type="button"
                          class="jw-dot"
                          aria-current={si === current ? "step" : undefined}
                          aria-label={t("walk.stepButton", {
                            number: si + 1,
                            title: t(`walk.${journey.copy}.s${si + 1}Title`),
                          })}
                          onClick$={() => goToStep(ji, si)}
                        />
                      </li>
                    ))}
                  </ol>
                  <div class="jw-buttons">
                    <button
                      type="button"
                      class="jw-button jw-button--icon"
                      aria-label={t("walk.back")}
                      disabled={current === 0}
                      onClick$={() => goToStep(ji, current - 1)}
                    >
                      <Icon name="arrow-left" size={18} />
                    </button>
                    {!last ? (
                      <button
                        type="button"
                        class="jw-button jw-button--primary"
                        onClick$={() => goToStep(ji, current + 1)}
                      >
                        {t("walk.next")}
                        <Icon name="arrow-right" size={18} />
                      </button>
                    ) : nextJourney ? (
                      <button
                        type="button"
                        class="jw-button jw-button--primary"
                        onClick$={() => selectJourney(ji + 1, true)}
                      >
                        {t("walk.nextJourney", {
                          name: t(`walk.${nextJourney.copy}.tab`),
                        })}
                        <Icon name="arrow-right" size={18} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="jw-button jw-button--primary"
                        onClick$={() => goToStep(ji, 0)}
                      >
                        <Icon name="refresh" size={18} />
                        {t("walk.restart")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div class="jw-product">
                <div class="jw-frame">
                  <div class="jw-screen">
                    {journey.views.map((View, si) => {
                      const shown = si === current;
                      return (
                        <div
                          key={si}
                          class={["jw-view", shown ? "is-active" : ""]}
                          inert={!shown}
                          role="region"
                          tabIndex={shown && active ? 0 : -1}
                          aria-label={t("walk.screenLabel", {
                            title: t(`walk.${journey.copy}.s${si + 1}Title`),
                          })}
                        >
                          <View
                            onAdvance$={
                              si < total - 1
                                ? $(() => goToStep(ji, si + 1))
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <p class="sr-only" aria-live="polite">
        {announcement.value}
      </p>
    </div>
  );
});
