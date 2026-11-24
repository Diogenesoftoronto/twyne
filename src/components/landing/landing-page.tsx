import {
  $,
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
import { ChatComposer } from "../ui/chat-composer";
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
  /**
   * Opens the brief. `opening` is the visitor's answer to the interview's
   * first question, asked in the hero; the interview continues from it.
   */
  onStartBrief$: PropFunction<
    (location: LandingCtaLocation, opening?: string) => void
  >;
  onSkipToEditor$?: PropFunction<(location: LandingCtaLocation) => void>;
}

/** Where the desktop builds live on this site (first-party downloads). */
const DESKTOP_DOWNLOAD_URL = "/downloads/";

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
  { copy: "a1", walk: "fieldnote", today: true },
  { copy: "a2", walk: "marsh-lane", today: false },
  { copy: "a3", walk: "orchard", today: false },
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
    const opening = useSignal("");
    const sendOpening = $(() => {
      const text = opening.value.trim();
      if (text) void onStartBrief$("hero", text);
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

    return (
      <div class="landing-page" ref={root}>
        <div class="landing-shell pb-20">
          {/* ── Masthead ── */}
          {/* Phones: wordmark above the actions, centred. Wider: wordmark on
              the leading edge, actions on the trailing edge. From 72.5rem (1160px) the
              links fit beside a centred wordmark in every language (French
              is the longest), so they appear there. */}
          <header class="grid items-center gap-x-6 gap-y-3 border-b border-[rgba(31,27,22,0.16)] py-5 max-sm:justify-items-center sm:grid-cols-[auto_1fr] min-[72.5rem]:grid-cols-[1fr_auto_1fr]">
            <nav class="hidden items-center gap-6 whitespace-nowrap min-[72.5rem]:flex">
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
            <div class="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 whitespace-nowrap max-sm:justify-center sm:flex-nowrap">
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
              <h1 class="landing-title ink-bleed landing-hero__title">
                {t("hero.h0")}
              </h1>
              <p class="landing-deck mx-auto mt-6 max-w-2xl text-base sm:text-lg">
                {t("hero.d0")}
              </p>
              {/* The interview's first question, asked here. The answer
                  goes with the visitor into the brief, which replies to it. */}
              <div class="landing-rise-3 landing-opener">
                <p class="landing-opener__question">
                  <ImgGriffinMark
                    class="landing-opener__mark"
                    aria-hidden="true"
                  />
                  <span>{t("hero.askQuestion")}</span>
                </p>
                <ChatComposer
                  value={opening.value}
                  onValueChange$={$((value: string) => {
                    opening.value = value;
                  })}
                  onSend$={sendOpening}
                  allowVoice={false}
                  label={t("hero.askQuestion")}
                  placeholder={t("hero.askPlaceholder")}
                  sendLabel={t("hero.askSend")}
                />
                <p class="landing-opener__note">{t("hero.askNote")}</p>
              </div>
              <a href="#walkthroughs" class="landing-hero__alt">
                {t("hero.ctaWalk")} <span aria-hidden="true">→</span>
              </a>
            </div>
          </section>

          {/* ── The film, straight after the question ── */}
          <section class="landing-film mx-auto mt-14 max-w-4xl md:mt-20">
            <LaunchFilm minimal />
            <p class="landing-turn__film-note">{t("turn.filmNote")}</p>
          </section>

          {/* ── The problem, in the visitor's terms ── */}
          <section
            id="problem"
            class="landing-problem mx-auto mt-16 max-w-6xl scroll-mt-8 md:mt-24"
            aria-labelledby="problem-title"
          >
            <div class="landing-section-head" data-reveal>
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
            </div>
          </section>

          {/* ── Who it is for ── */}
          <section
            id="audiences"
            class="landing-audiences mx-auto mt-20 max-w-6xl scroll-mt-8 md:mt-28"
            aria-labelledby="audiences-title"
          >
            <div class="landing-section-head" data-reveal>
              <h2 id="audiences-title" class="sr-only">
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
                  <h3 class="landing-audience__title">
                    {t(`audiences.${audience.copy}Kicker`)}
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
                    {t(`audiences.${audience.copy}Link`)}{" "}
                    <span aria-hidden="true">→</span>
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
                <h2 id="walkthroughs-title" class="landing-title landing-h2">
                  {t("walk.title")}
                </h2>
                <p class="landing-deck landing-lede">{t("walk.lede")}</p>
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
