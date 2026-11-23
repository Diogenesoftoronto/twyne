import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type Component,
} from "@qwik.dev/core";
import { useGT, useTranslate } from "gt-qwik";
import { translate } from "gt-qwik/runtime";
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
  views: Component<JourneyViewProps>[];
}

/**
 * The three walkthroughs, one per audience. Each step's narration lives at
 * `walk.<copy>.s<n>Kicker|Title|Body`; the view at the same index is the
 * product screen for that step.
 */
export const JOURNEYS: Journey[] = [
  {
    id: "fieldnote",
    copy: "fieldnote",
    availability: "coming",
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
    views: [MarshStyleBook, MarshReview, MarshPublications, MarshDomain],
  },
  {
    id: "orchard",
    copy: "orchard",
    availability: "coming",
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
        <div class="jw-device" role="group" aria-label={t("walk.viewLabel")}>
          {(["desktop", "mobile"] as const).map((option) => (
            <button
              key={option}
              type="button"
              class="jw-device__option"
              aria-pressed={device.value === option}
              onClick$={() => (device.value = option)}
            >
              {t(`walk.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div class="jw-stage">
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
                      <p class="jw-step__meta">
                        <span class="jw-step__numeral">
                          {["I", "II", "III", "IV", "V", "VI"][si]}
                        </span>
                        <span class="dept-label">
                          {t(`walk.${journey.copy}.s${si + 1}Kicker`)}
                        </span>
                      </p>
                      <h3 class="jw-step__title">
                        {t(`walk.${journey.copy}.s${si + 1}Title`)}
                      </h3>
                      <p class="jw-step__body">
                        {t(`walk.${journey.copy}.s${si + 1}Body`)}
                      </p>
                    </div>
                  ))}
                </div>
                <div class="jw-nav">
                  <p class="jw-counter">
                    {t("walk.stepCounter", { current: current + 1, total })}
                  </p>
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
                      class="broadsheet-cta secondary jw-button"
                      disabled={current === 0}
                      onClick$={() => goToStep(ji, current - 1)}
                    >
                      ← {t("walk.back")}
                    </button>
                    {!last ? (
                      <button
                        type="button"
                        class="broadsheet-cta jw-button"
                        onClick$={() => goToStep(ji, current + 1)}
                      >
                        {t("walk.next")} →
                      </button>
                    ) : nextJourney ? (
                      <button
                        type="button"
                        class="broadsheet-cta jw-button"
                        onClick$={() => selectJourney(ji + 1, true)}
                      >
                        {t("walk.nextJourney", {
                          name: t(`walk.${nextJourney.copy}.tab`),
                        })}{" "}
                        →
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="broadsheet-cta jw-button"
                        onClick$={() => goToStep(ji, 0)}
                      >
                        {t("walk.restart")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div class="jw-product">
                <div class="jw-frame">
                  <div class="jw-frame__chrome" aria-hidden="true">
                    <span class="jw-frame__dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span class="jw-frame__stamp">{t("walk.frameStamp")}</span>
                  </div>
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

      <p class="jw-note">{t("walk.note")}</p>
      <p class="sr-only" aria-live="polite">
        {announcement.value}
      </p>
    </div>
  );
});
