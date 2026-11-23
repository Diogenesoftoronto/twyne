import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { useTranslate } from "gt-qwik";
import { WorkspaceTour } from "./workspace-tour";
import { LaunchFilm } from "./launch-film";
import { JourneyWalkthrough } from "./journey-walkthrough";
import { LandingI18n } from "./landing-i18n";
import "./landing-artwork.css";
import "./landing-journey.css";
import {
  BriefPlatePreview,
  DraftPlatePreview,
  NotesPlatePreview,
  SourcesPlatePreview,
} from "./plate-previews";
import { AccountMenu } from "../auth/account-menu";
import { useAuth } from "../../utils/auth-context";
import ImgGriffinMark from "~/media/assets/griffin-mark.svg?jsx";
import ImgApprovalStamp from "~/media/approval-stamp.svg?jsx";
import type { LandingCtaLocation } from "../../utils/product-analytics";

interface LandingPageProps {
  onStartBrief$: PropFunction<(location: LandingCtaLocation) => void>;
  onSkipToEditor$?: PropFunction<(location: LandingCtaLocation) => void>;
}

/** Where the desktop builds live on this site (first-party downloads). */
const DESKTOP_DOWNLOAD_URL = "/downloads/";

/**
 * The hero headline types itself out, then a copy-editor strikes a word and
 * writes the correction after it — the gesture the whole product is about.
 *
 * `lead` types first. If a `strike` is given it types too, sits for a beat,
 * takes the rule through it, and then `replacement` is typed after the
 * correction. Headline 0 carries no correction on purpose: it is what the
 * server renders and what crawlers and screen readers get, so it has to read
 * as a clean sentence. It names the problem; the other two answer it.
 */
interface Headline {
  lead: string;
  strike?: string;
  replacement?: string;
  deck: string;
}

interface HeadlineRun {
  text: string;
  struck: boolean;
}
interface HeadlineFrame {
  runs: HeadlineRun[];
  hold: number;
  leaving: boolean;
  headline: number;
}

const TYPE_MS = 46; // one keystroke
const SETTLE_MS = 700; // the beat before the editor's mark lands
const STRIKE_MS = 900; // the rule drawn through the struck words
const READ_MS = 3400; // the finished line, held to be read
const LEAVE_MS = 620; // the line pulled up out of the carriage

/**
 * Every state of the headline, precomputed. Playing it back is then just
 * "advance an index on a timer", which keeps the component free of nested
 * timeouts and makes the whole sequence deterministic. Pure, so the render
 * and the playback task can each build it from the same translated lines.
 */
const buildFrames = (headlines: Headline[]) => {
  const frames: HeadlineFrame[] = [];
  let initial = 0;

  headlines.forEach((headline, index) => {
    const push = (runs: HeadlineRun[], hold: number, leaving = false) =>
      frames.push({
        runs: runs.filter((run) => run.text.length > 0),
        hold,
        leaving,
        headline: index,
      });

    const leadChars = [...headline.lead];
    for (let i = 1; i <= leadChars.length; i++) {
      push([{ text: leadChars.slice(0, i).join(""), struck: false }], TYPE_MS);
    }

    const lead = { text: headline.lead, struck: false };
    if (headline.strike && headline.replacement) {
      const strike = [...headline.strike];
      const replacement = [...headline.replacement];
      for (let i = 1; i <= strike.length; i++) {
        push(
          [lead, { text: strike.slice(0, i).join(""), struck: false }],
          TYPE_MS,
        );
      }
      const struck = { text: headline.strike, struck: true };
      push([lead, { text: headline.strike, struck: false }], SETTLE_MS);
      push([lead, struck], STRIKE_MS);
      for (let i = 1; i <= replacement.length; i++) {
        push(
          [
            lead,
            struck,
            { text: replacement.slice(0, i).join(""), struck: false },
          ],
          TYPE_MS,
        );
      }
      push(
        [lead, struck, { text: headline.replacement, struck: false }],
        READ_MS,
      );
    } else {
      push([lead], READ_MS);
    }

    // The completed first headline is what the server renders, and where the
    // loop starts — so the first paint never flickers or retypes itself.
    if (index === 0) initial = frames.length - 1;

    push(frames[frames.length - 1].runs, LEAVE_MS, true);
  });

  return { frames, initial };
};

/**
 * Split text into per-word, per-character spans for the CSS keystroke reveal
 * used by the section headings. Words are what wrap, so a line break never
 * lands mid-word, and the spaces stay real text nodes so the heading still
 * copies as plain prose.
 */
const typedSpans = (text: string) => {
  const words = text.split(" ");
  let index = 0;
  return words.map((word, wordIndex) => {
    const chars = [...word].map((char) => ({ char, i: index++ }));
    const gap = wordIndex < words.length - 1;
    if (gap) index++; // the space keeps its slot in the keystroke rhythm
    return [
      <span class="landing-typed__word" key={`word-${wordIndex}`}>
        {chars.map(({ char, i }) => (
          <span class="landing-typed__char" key={i} style={`--i: ${i}`}>
            {char}
          </span>
        ))}
      </span>,
      gap ? " " : null,
    ];
  });
};

/**
 * The four movements of a piece in the room as it exists today, each shown
 * as a live UI preview facing its text. `side` is where the plate sits on
 * desktop; plates alternate so the page reads like a magazine spread. The
 * previews are the product's own components fed canned data.
 */
const plates = [
  {
    numeral: "I",
    copy: "p1",
    preview: BriefPlatePreview,
    orientation: "portrait" as const,
    side: "left" as const,
    tilt: "-2.6deg",
    driftX: "-8px",
    driftY: "-12px",
  },
  {
    numeral: "II",
    copy: "p2",
    preview: DraftPlatePreview,
    orientation: "landscape" as const,
    side: "right" as const,
    tilt: "1.9deg",
    driftX: "7px",
    driftY: "16px",
  },
  {
    numeral: "III",
    copy: "p3",
    preview: NotesPlatePreview,
    orientation: "portrait" as const,
    side: "left" as const,
    tilt: "-1.5deg",
    driftX: "11px",
    driftY: "-6px",
  },
  {
    numeral: "IV",
    copy: "p4",
    preview: SourcesPlatePreview,
    orientation: "landscape" as const,
    side: "right" as const,
    tilt: "2.8deg",
    driftX: "-6px",
    driftY: "10px",
  },
];

/**
 * The whole journey, in the order a piece travels it. `today` marks what a
 * writer can use now; everything else is Twyne Publishing work described in
 * the publishing lab and labelled "In development" on the page.
 */
const STAGES = [
  { numeral: "I", copy: "s1", today: true },
  { numeral: "II", copy: "s2", today: true },
  { numeral: "III", copy: "s3", today: true },
  { numeral: "IV", copy: "s4", today: false },
  { numeral: "V", copy: "s5", today: false },
  { numeral: "VI", copy: "s6", today: false },
  { numeral: "VII", copy: "s7", today: false },
];

/** One card per audience; each opens the walkthrough that follows it. */
const AUDIENCES = [
  { copy: "a1", walk: "fieldnote", today: true, mark: "♠" },
  { copy: "a2", walk: "marsh-lane", today: false, mark: "♦" },
  { copy: "a3", walk: "orchard", today: false, mark: "♥" },
];

export const LandingPage = component$<LandingPageProps>((props) => (
  <LandingI18n>
    <LandingContent {...props} />
  </LandingI18n>
));

const LandingContent = component$<LandingPageProps>(
  ({ onStartBrief$, onSkipToEditor$ }) => {
    const t = useTranslate();
    const auth = useAuth();
    const signedIn = !!auth.value.user;
    const root = useSignal<HTMLElement>();

    const headlines: Headline[] = [
      { lead: t("hero.h0"), deck: t("hero.d0") },
      {
        lead: t("hero.h1Lead"),
        strike: t("hero.h1Strike"),
        replacement: t("hero.h1Replace"),
        deck: t("hero.d1"),
      },
      {
        lead: t("hero.h2Lead"),
        strike: t("hero.h2Strike"),
        replacement: t("hero.h2Replace"),
        deck: t("hero.d2"),
      },
    ];
    const { frames, initial } = buildFrames(headlines);
    // Starts on the completed first headline, so SSR, hydration and the first
    // paint all agree and nothing retypes itself on load.
    const heroFrame = useSignal(initial);
    const currentFrame = frames[heroFrame.value] ?? frames[initial];

    // Play the headline. Each frame carries its own hold, so this is a single
    // self-rescheduling timer rather than a pile of nested timeouts.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const holds = buildFrames(headlines).frames.map((frame) => frame.hold);

      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        timer = setTimeout(() => {
          heroFrame.value = (heroFrame.value + 1) % holds.length;
          tick();
        }, holds[heroFrame.value]);
      };
      tick();

      cleanup(() => clearTimeout(timer));
    });

    // Scroll reveal for the photo essay.
    //
    // The hidden start state is scoped to [data-reveal-ready], and only this
    // task ever sets it. If JS never runs — or the browser has no
    // IntersectionObserver, or the reader asked for reduced motion — nothing
    // is hidden and the server-rendered page reads in full. Every reveal
    // target sits below the fold, so setting the attribute can't flash
    // already-visible content.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      const el = root.value;
      if (!el) return;

      const targets = Array.from(
        el.querySelectorAll<HTMLElement>("[data-reveal]"),
      );
      if (!targets.length) return;

      if (
        !("IntersectionObserver" in window) ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      el.setAttribute("data-reveal-ready", "");

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
      );
      for (const target of targets) observer.observe(target);

      cleanup(() => observer.disconnect());
    });

    const fullHeadline = (headline: Headline) =>
      `${headline.lead}${headline.strike ?? ""}${headline.replacement ?? ""}`;

    return (
      <div class="landing-page" ref={root}>
        <div class="landing-shell pb-20">
          {/* ── Masthead ── */}
          <header class="grid items-center gap-x-4 gap-y-3 border-b border-[rgba(31,27,22,0.16)] py-5 max-sm:justify-items-center sm:grid-cols-[1fr_auto_1fr]">
            <nav class="hidden items-center gap-6 sm:flex">
              <a class="landing-nav-link" href="#walkthroughs">
                {t("nav.walkthroughs")}
              </a>
              <Link class="landing-nav-link" href={DESKTOP_DOWNLOAD_URL}>
                {t("nav.desktop")}
              </Link>
              <Link class="landing-nav-link" href="/pricing/">
                {t("nav.pricing")}
              </Link>
            </nav>
            <div class="flex items-center gap-3">
              <ImgGriffinMark class="h-8 w-8" aria-hidden="true" />
              <span class="landing-masthead ink-bleed">TWYNE</span>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-4 max-sm:justify-center">
              {signedIn ? (
                <AccountMenu />
              ) : (
                <Link
                  href="/signin/"
                  class="landing-signin-link text-[0.7rem] uppercase tracking-[0.18em]"
                  style="font-family: var(--font-typewriter);"
                >
                  {t("nav.signIn")}
                </Link>
              )}
              <button
                onClick$={() => onStartBrief$("header")}
                class="broadsheet-cta"
              >
                {signedIn ? t("nav.openDesk") : t("nav.startWriting")}
              </button>
            </div>
          </header>

          {/* ── Hero: the problem, set on the desk itself ── */}
          <section class="landing-hero landing-hero--garden paper-foxed">
            <img
              class="landing-hero__photo"
              src="/assets/landing/options-2026-09/option-03-1536.avif"
              srcset="/assets/landing/options-2026-09/option-03-768.avif 768w, /assets/landing/options-2026-09/option-03-1536.avif 1536w"
              sizes="100vw"
              width={1536}
              height={1024}
              alt=""
              aria-hidden="true"
              fetchPriority="high"
              decoding="async"
            />
            <div class="landing-hero__inner mx-auto max-w-3xl text-center">
              <p class="landing-hero__kicker">{t("hero.kicker")}</p>
              <h1
                class="landing-title ink-bleed landing-rotator-line landing-rotator-line--stacked"
                aria-label={headlines[0].lead}
              >
                <span class="landing-rotator-stack" aria-hidden="true">
                  {/* Every finished headline, invisible, so the line keeps the
                      height of the longest one in this language. */}
                  {headlines.map((headline, index) => (
                    <span key={index} class="landing-rotator-sizer">
                      {fullHeadline(headline)}
                      <span class="landing-rotator__caret" />
                    </span>
                  ))}
                  <span
                    class={[
                      "landing-rotator",
                      currentFrame.leaving ? "is-leaving" : "",
                    ]}
                  >
                    {currentFrame.runs.map((run, runIndex) => (
                      <span
                        key={runIndex}
                        class={run.struck ? "landing-rotator__struck" : ""}
                      >
                        {run.text}
                      </span>
                    ))}
                    <span class="landing-rotator__caret" />
                  </span>
                </span>
              </h1>
              <div class="landing-deck-stack mx-auto mt-6 max-w-2xl">
                {headlines.map((headline, index) => (
                  <p
                    key={index}
                    class={[
                      "landing-deck text-base sm:text-lg",
                      index === currentFrame.headline
                        ? "landing-rotator-deck is-current"
                        : "",
                    ]}
                  >
                    {headline.deck}
                  </p>
                ))}
              </div>
              <div class="landing-rise-3 mt-9 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick$={() => onStartBrief$("hero")}
                  class="broadsheet-cta"
                >
                  {t("hero.ctaStart")}
                </button>
                <a href="#walkthroughs" class="broadsheet-cta secondary">
                  {t("hero.ctaWalk")}
                </a>
              </div>
            </div>
          </section>

          {/* ── The problem, in the visitor's terms ── */}
          <section
            id="problem"
            class="landing-problem mx-auto mt-16 max-w-6xl scroll-mt-8 md:mt-24"
            aria-labelledby="problem-title"
          >
            <div class="landing-section-head" data-reveal>
              <p class="dept-label">{t("problem.kicker")}</p>
              <h2 id="problem-title" class="landing-title landing-h2">
                {t("problem.title")}
              </h2>
              <p class="landing-deck landing-lede">{t("problem.lede")}</p>
            </div>
            <ul class="landing-slips" data-reveal>
              {[1, 2, 3, 4].map((n) => (
                <li key={n} class="landing-slip" style={`--n: ${n}`}>
                  <p class="landing-slip__label">
                    {t(`problem.slip${n}Label`)}
                  </p>
                  <p class="landing-slip__body">{t(`problem.slip${n}Body`)}</p>
                </li>
              ))}
            </ul>
            <figure class="landing-case paper-sheet" data-reveal>
              <p class="dept-label">{t("problem.caseKicker")}</p>
              <blockquote class="landing-case__body">
                {t("problem.caseBody")}
              </blockquote>
              <figcaption class="landing-case__note">
                {t("problem.caseNote")}
              </figcaption>
            </figure>
          </section>

          <div
            class="ornament-divider my-16 md:my-24"
            style="font-family: var(--font-display);"
            aria-hidden="true"
          >
            ❦
          </div>

          {/* ── The turn: one desk for the whole journey ── */}
          <section
            id="journey"
            class="landing-turn mx-auto max-w-6xl scroll-mt-8"
            aria-labelledby="journey-title"
          >
            <div class="landing-section-head" data-reveal>
              <p class="dept-label">{t("turn.kicker")}</p>
              <h2
                id="journey-title"
                class="landing-title ink-bleed landing-typed-reveal landing-h2"
                aria-label={t("turn.title")}
              >
                {typedSpans(t("turn.title"))}
              </h2>
              <p class="landing-deck landing-lede">{t("turn.lede")}</p>
            </div>
            <div class="landing-turn__grid">
              <ol class="landing-ledger" aria-label={t("turn.ledgerLabel")}>
                {STAGES.map((stage) => (
                  <li
                    key={stage.numeral}
                    class={[
                      "landing-ledger__row",
                      stage.today ? "is-today" : "is-coming",
                    ]}
                  >
                    <span class="landing-step-num" aria-hidden="true">
                      {stage.numeral}
                    </span>
                    <span class="landing-ledger__text">
                      <span class="landing-ledger__title">
                        {t(`turn.${stage.copy}Title`)}
                      </span>
                      <span class="landing-ledger__body">
                        {t(`turn.${stage.copy}Body`)}
                      </span>
                    </span>
                    <span
                      class={[
                        "landing-status",
                        stage.today ? "is-today" : "is-coming",
                      ]}
                    >
                      {stage.today ? t("turn.today") : t("turn.coming")}
                    </span>
                  </li>
                ))}
              </ol>
              <div class="landing-turn__film">
                <LaunchFilm />
                <p class="landing-turn__film-note">{t("turn.filmNote")}</p>
              </div>
            </div>
          </section>

          {/* ── Who it is for ── */}
          <section
            id="audiences"
            class="landing-audiences mx-auto mt-20 max-w-6xl scroll-mt-8 md:mt-28"
            aria-labelledby="audiences-title"
          >
            <div class="landing-section-head" data-reveal>
              <p class="dept-label">{t("audiences.kicker")}</p>
              <h2 id="audiences-title" class="landing-title landing-h2">
                {t("audiences.title")}
              </h2>
            </div>
            <ul class="landing-audience-grid">
              {AUDIENCES.map((audience, index) => (
                <li
                  key={audience.copy}
                  class="landing-audience paper-sheet"
                  data-reveal
                  style={`--reveal-delay: ${index * 90}ms`}
                >
                  <p class="landing-audience__kicker">
                    <span aria-hidden="true">{audience.mark}</span>{" "}
                    {t(`audiences.${audience.copy}Kicker`)}
                  </p>
                  <h3 class="landing-audience__title">
                    {t(`audiences.${audience.copy}Title`)}
                  </h3>
                  <p class="landing-audience__body">
                    {t(`audiences.${audience.copy}Body`)}
                  </p>
                  <p
                    class={[
                      "landing-status",
                      audience.today ? "is-today" : "is-coming",
                    ]}
                  >
                    {t(`audiences.${audience.copy}Status`)}
                  </p>
                  <a
                    class="landing-audience__link"
                    href={`#walk-${audience.walk}`}
                  >
                    {t(`audiences.${audience.copy}Link`)} →
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Walkthroughs ── */}
          <section
            id="walkthroughs"
            class="landing-walkthroughs mt-20 scroll-mt-8 md:mt-28"
            aria-labelledby="walkthroughs-title"
          >
            <div class="mx-auto max-w-6xl">
              <div class="landing-section-head">
                <p class="dept-label">{t("walk.kicker")}</p>
                <h2 id="walkthroughs-title" class="landing-title landing-h2">
                  {t("walk.title")}
                </h2>
                <p class="landing-deck landing-lede">{t("walk.lede")}</p>
                <p class="landing-coming">
                  <span class="landing-coming__stamp">
                    {t("walk.comingLabel")}
                  </span>
                  <span>{t("walk.comingNote")}</span>
                </p>
              </div>
            </div>
            <div class="mx-auto mt-10 max-w-6xl">
              <JourneyWalkthrough />
            </div>
          </section>

          <div
            class="ornament-divider my-16 md:my-24"
            style="font-family: var(--font-display);"
            aria-hidden="true"
          >
            ❦
          </div>

          {/* ── Open today: the room, working ── */}
          <section
            id="editorial-room"
            class="scroll-mt-8"
            aria-labelledby="room-title"
          >
            <div class="mx-auto max-w-6xl">
              <div class="landing-section-head">
                <p class="dept-label">
                  <span class="landing-status is-today">
                    {t("room.kicker")}
                  </span>
                </p>
                <h2 id="room-title" class="landing-title landing-h2">
                  {t("room.title")}
                </h2>
                <p class="landing-deck landing-lede">{t("room.lede")}</p>
              </div>
            </div>
            <div id="workspace-preview" class="mt-10 scroll-mt-8">
              <WorkspaceTour />
            </div>
          </section>

          {/* ── How it works today: four plates ── */}
          <section
            id="how-it-works"
            class="mx-auto mt-20 max-w-6xl scroll-mt-8 md:mt-28"
          >
            <h2
              class="landing-title ink-bleed landing-typed-reveal text-center text-3xl leading-tight sm:text-4xl"
              data-reveal
              aria-label={t("room.platesTitle")}
            >
              {typedSpans(t("room.platesTitle"))}
            </h2>
            <ol class="mt-14 space-y-20 md:mt-20 md:space-y-28">
              {plates.map((plate) => {
                const portrait = plate.orientation === "portrait";
                const Preview = plate.preview;
                return (
                  <li
                    key={plate.numeral}
                    class={[
                      "landing-plate",
                      portrait ? "landing-plate--portrait" : "",
                      plate.side === "right" ? "landing-plate--right" : "",
                    ]}
                  >
                    <figure
                      class="landing-plate__figure"
                      data-reveal
                      style={`--tilt: ${plate.tilt}; --drift-x: ${plate.driftX}; --drift-y: ${plate.driftY}`}
                    >
                      <div class="landing-plate__frame">
                        <Preview />
                      </div>
                    </figure>
                    <div data-reveal style="--reveal-delay: 120ms;">
                      <div class="flex items-baseline gap-3">
                        <span class="landing-step-num">{plate.numeral}</span>
                        <h3
                          class="text-xl text-[var(--color-ink)] sm:text-2xl"
                          style="font-family: var(--font-display); font-weight: 600;"
                        >
                          {t(`room.${plate.copy}Title`)}
                        </h3>
                      </div>
                      <p
                        class="mt-4 max-w-prose text-[1.0625rem] leading-relaxed text-[var(--color-ink-light)]"
                        style="font-family: var(--font-serif);"
                      >
                        {t(`room.${plate.copy}Body`)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* ── Closing CTA ── */}
          <section class="mt-20 md:mt-28">
            <div class="landing-closing-artwork paper-sheet paper-foxed relative overflow-hidden px-6 py-14 text-center sm:px-8 md:px-14 md:py-20">
              {/* Letterpress impression washed into the original aged-paper surface. */}
              <img
                src="/assets/landing/options-2026-09/option-05-1536.avif"
                srcset="/assets/landing/options-2026-09/option-05-768.avif 768w, /assets/landing/options-2026-09/option-05-1536.avif 1536w"
                sizes="(min-width: 768px) 64rem, 100vw"
                width={1536}
                height={1024}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                class="landing-closing-photo"
              />
              <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <ImgApprovalStamp
                  class="h-40 w-40 opacity-[0.06]"
                  aria-hidden="true"
                />
              </div>
              <div class="relative z-10" data-reveal>
                <ImgGriffinMark class="mx-auto h-7 w-7" aria-hidden="true" />
                <h2
                  class="landing-title ink-bleed landing-typed-reveal mt-5 text-3xl leading-tight sm:text-4xl"
                  aria-label={t("close.title")}
                >
                  {typedSpans(t("close.title"))}
                </h2>
                <p class="landing-close__subtitle">{t("close.subtitle")}</p>
                <p class="landing-deck mx-auto mt-4 max-w-md text-base">
                  {t("close.body")}
                </p>
                <div class="mt-9 flex flex-wrap justify-center gap-3">
                  <button
                    onClick$={() => onStartBrief$("footer")}
                    class="broadsheet-cta"
                  >
                    {t("close.ctaStart")}
                  </button>
                  {onSkipToEditor$ && (
                    <button
                      onClick$={() => onSkipToEditor$("footer")}
                      class="broadsheet-cta secondary"
                    >
                      {t("close.ctaSkip")}
                    </button>
                  )}
                </div>
                <p
                  class="mt-6 text-[0.9rem] text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  {t("close.desktopPrefix")}{" "}
                  <Link
                    class="landing-download-link underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)]"
                    href={DESKTOP_DOWNLOAD_URL}
                  >
                    {t("close.desktopLink")}
                  </Link>{" "}
                  {t("close.desktopSuffix")}
                </p>
              </div>
            </div>
          </section>

          {/* ── Colophon ── */}
          <footer class="mt-20 text-center md:mt-28">
            <ImgGriffinMark class="mx-auto h-8 w-8" aria-hidden="true" />
            <p class="landing-masthead-grand ink-bleed mt-4">TWYNE</p>
            <p
              class="mt-4 text-[0.95rem] text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              {t("footer.motto")}
            </p>
            <nav
              class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--color-ink-light)]"
              style="font-family: var(--font-typewriter);"
              aria-label={t("footer.label")}
            >
              <a href="/blog/" class="hover:text-[var(--color-ink)]">
                {t("footer.blog")}
              </a>
              <a href="/docs/" class="hover:text-[var(--color-ink)]">
                {t("footer.docs")}
              </a>
              <a href="/faq/" class="hover:text-[var(--color-ink)]">
                {t("footer.faq")}
              </a>
              <a href="/downloads/" class="hover:text-[var(--color-ink)]">
                {t("footer.downloads")}
              </a>
              <a href="/terms/" class="hover:text-[var(--color-ink)]">
                {t("footer.terms")}
              </a>
              <a href="/privacy/" class="hover:text-[var(--color-ink)]">
                {t("footer.privacy")}
              </a>
              <a href="/pricing/" class="hover:text-[var(--color-ink)]">
                {t("footer.pricing")}
              </a>
            </nav>
          </footer>
        </div>
      </div>
    );
  },
);
