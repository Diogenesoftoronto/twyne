import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { WorkspacePreview } from "./workspace-preview";
import { AccountMenu } from "../auth/account-menu";
import { useAuth } from "../../utils/auth-context";
import ImgGriffinMark from "~/media/assets/griffin-mark.svg?jsx";
import ImgApprovalStamp from "~/media/approval-stamp.svg?jsx";
import type { LandingCtaLocation } from "../../utils/product-analytics";

interface LandingPageProps {
  onStartBrief$: PropFunction<(location: LandingCtaLocation) => void>;
  onSkipToEditor$?: PropFunction<(location: LandingCtaLocation) => void>;
}

/** Where the Electrobun desktop builds are published (GitHub Releases). */
const DESKTOP_DOWNLOAD_URL =
  "https://github.com/Diogenesoftoronto/twyne/releases/latest";

/**
 * The hero headline types itself out, then a copy-editor strikes a word and
 * writes the correction after it — the gesture the whole product is about.
 *
 * `lead` types first. If a `strike` is given it types too, sits for a beat,
 * takes the rule through it, and then `replacement` is typed after the
 * correction. Headline 0 carries no correction on purpose: it is what the
 * server renders and what crawlers and screen readers get, so it has to read
 * as a clean sentence.
 */
const HEADLINES = [
  {
    lead: "Draft with a room full of editors.",
    deck: "Twyne is a writing app for essays and long-form drafts. Five editorial personas, a grading rubric, and a citation desk read every draft against your brief.",
  },
  {
    lead: "Start from ",
    strike: "a blank page",
    replacement: " a brief.",
    deck: "A ten-minute interview becomes the project brief that every tool in the room reads, so no draft ever starts cold.",
  },
  {
    lead: "Graded on ",
    strike: "fluency",
    replacement: " the target.",
    deck: "A Target Fit judge scores relevance on its own, and caps every craft metric whenever a draft drifts off its subject.",
  },
];

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
const READ_MS = 2600; // the finished line, held to be read
const LEAVE_MS = 620; // the line pulled up out of the carriage

/**
 * Every state of the headline, precomputed. Playing it back is then just
 * "advance an index on a timer", which keeps the component free of nested
 * timeouts and makes the whole sequence deterministic.
 */
const { frames: HEADLINE_FRAMES, initial: INITIAL_FRAME } = (() => {
  const frames: HeadlineFrame[] = [];
  let initial = 0;

  HEADLINES.forEach((headline, index) => {
    const push = (runs: HeadlineRun[], hold: number, leaving = false) =>
      frames.push({
        runs: runs.filter((run) => run.text.length > 0),
        hold,
        leaving,
        headline: index,
      });

    for (let i = 1; i <= headline.lead.length; i++) {
      push([{ text: headline.lead.slice(0, i), struck: false }], TYPE_MS);
    }

    const lead = { text: headline.lead, struck: false };
    if (headline.strike && headline.replacement) {
      const { strike, replacement } = headline;
      for (let i = 1; i <= strike.length; i++) {
        push([lead, { text: strike.slice(0, i), struck: false }], TYPE_MS);
      }
      push([lead, { text: strike, struck: false }], SETTLE_MS);
      push([lead, { text: strike, struck: true }], STRIKE_MS);
      for (let i = 1; i <= replacement.length; i++) {
        push(
          [
            lead,
            { text: strike, struck: true },
            { text: replacement.slice(0, i), struck: false },
          ],
          TYPE_MS,
        );
      }
      push(
        [
          lead,
          { text: strike, struck: true },
          { text: replacement, struck: false },
        ],
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
})();

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

const annotations = [
  {
    id: "dossier",
    tag: "The Dossier",
    note: "Your brief and saved drafts stay pinned beside the manuscript.",
    accent: "var(--color-cobalt)",
    position: "left-3 top-[7rem] -rotate-1",
  },
  {
    id: "manuscript",
    tag: "The Manuscript",
    note: "A long-form editor that stays out of the way while you write.",
    accent: "var(--color-ink)",
    position: "left-1/2 -translate-x-1/2 bottom-8 rotate-[0.6deg]",
  },
  {
    id: "cast",
    tag: "The Cast",
    note: "Five editors read along and critique the draft against your brief.",
    accent: "var(--color-vermilion)",
    position: "right-3 top-[7rem] rotate-1",
  },
];

/**
 * The four movements of a piece, each shown as a photographic plate
 * facing its text. `side` is where the photograph sits on desktop;
 * plates alternate so the page reads like a magazine spread.
 */
const steps = [
  {
    numeral: "I",
    title: "Answer the brief",
    body: "Ten minutes of questions about audience, purpose, and what good looks like. The interview becomes a project brief that every tool in the room reads, so no draft starts from a blank page.",
    slug: "product-brief-v2",
    orientation: "portrait" as const,
    side: "left" as const,
    tilt: "-2.6deg",
    driftX: "-8px",
    driftY: "-12px",
    alt: "A writer completing Twyne's structured project brief on a tablet, with fields for audience, purpose, tone, evidence, and success.",
  },
  {
    numeral: "II",
    title: "Write the draft",
    body: "A serious long-form editor with saved drafts and focus tools. Your work stays on your machine, organized into folios you can return to between sessions.",
    slug: "product-draft-v2",
    orientation: "landscape" as const,
    side: "right" as const,
    tilt: "1.9deg",
    driftX: "7px",
    driftY: "16px",
    alt: "Twyne's long-form manuscript editor open on a laptop with a document outline and saved drafts beside the page.",
  },
  {
    numeral: "III",
    title: "Take the notes",
    body: "The Skeptic, the Gentle Reader, the Line Editor, the Critic: each persona marks up the draft in the margin while a rubric grades thesis, structure, style, and evidence against the brief.",
    slug: "product-notes-v2",
    orientation: "portrait" as const,
    side: "left" as const,
    tilt: "-1.5deg",
    driftX: "11px",
    driftY: "-6px",
    alt: "A manuscript in Twyne with five color-coded editorial notes anchored in the margin and a scoring rubric alongside it.",
  },
  {
    numeral: "IV",
    title: "Check the record",
    body: "Twyne detects URLs, DOIs, ISBNs, and footnotes as you cite them, and keeps every source in one place where it can be inspected and verified.",
    slug: "product-sources-v2",
    orientation: "landscape" as const,
    side: "right" as const,
    tilt: "2.8deg",
    driftX: "-6px",
    driftY: "10px",
    alt: "Twyne's source desk linking a manuscript to verified web, journal, book, and footnote records.",
  },
];

export const LandingPage = component$<LandingPageProps>(
  ({ onStartBrief$, onSkipToEditor$ }) => {
    const auth = useAuth();
    const signedIn = !!auth.value.user;
    const root = useSignal<HTMLElement>();
    // Starts on the completed first headline, so SSR, hydration and the first
    // paint all agree and nothing retypes itself on load.
    const heroFrame = useSignal(INITIAL_FRAME);
    const currentFrame = HEADLINE_FRAMES[heroFrame.value];

    // Play the headline. Each frame carries its own hold, so this is a single
    // self-rescheduling timer rather than a pile of nested timeouts.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        timer = setTimeout(() => {
          heroFrame.value = (heroFrame.value + 1) % HEADLINE_FRAMES.length;
          tick();
        }, HEADLINE_FRAMES[heroFrame.value].hold);
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

    return (
      <div class="landing-page" ref={root}>
        <div class="landing-shell pb-20">
          {/* ── Masthead ── */}
          <header class="grid items-center gap-x-4 gap-y-3 border-b border-[rgba(31,27,22,0.16)] py-5 max-sm:justify-items-center sm:grid-cols-[1fr_auto_1fr]">
            <nav class="hidden items-center gap-6 sm:flex">
              <a class="landing-nav-link" href="#editorial-room">
                The room
              </a>
              <a class="landing-nav-link" href="#how-it-works">
                How it works
              </a>
              <a
                class="landing-nav-link"
                href={DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
              >
                Desktop app
              </a>
              <Link class="landing-nav-link" href="/pricing/">
                Pricing
              </Link>
            </nav>
            <div class="flex items-center gap-3">
              <ImgGriffinMark class="h-8 w-8" aria-hidden="true" />
              <span class="landing-masthead ink-bleed">TWYNE</span>
            </div>
            <div class="flex items-center justify-end gap-4">
              {signedIn ? (
                <AccountMenu />
              ) : (
                <Link
                  href="/signin/"
                  class="landing-signin-link text-[0.7rem] uppercase tracking-[0.18em]"
                  style="font-family: var(--font-typewriter);"
                >
                  Sign in
                </Link>
              )}
              <button
                onClick$={() => onStartBrief$("header")}
                class="broadsheet-cta"
              >
                {signedIn ? "Open the desk" : "Start writing"}
              </button>
            </div>
          </header>

          {/* ── Hero — the type is set on the desk itself ── */}
          <section class="landing-hero">
            <img
              class="landing-hero__photo"
              src="/assets/landing/product-hero-v2-lg.webp"
              srcset="/assets/landing/product-hero-v2-sm.webp 768w, /assets/landing/product-hero-v2-lg.webp 1536w"
              sizes="100vw"
              width={1536}
              height={1024}
              alt=""
              aria-hidden="true"
              fetchPriority="high"
              decoding="async"
            />
            <div class="landing-hero__inner mx-auto max-w-3xl text-center">
            <h1
              class="landing-title ink-bleed landing-rotator-line"
              aria-label={HEADLINES[0].lead}
            >
              <span
                class={[
                  "landing-rotator",
                  currentFrame.leaving ? "is-leaving" : "",
                ]}
                aria-hidden="true"
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
            </h1>
            <p
              key={currentFrame.headline}
              class="landing-deck landing-rotator-deck mx-auto mt-6 max-w-2xl text-base sm:text-lg"
            >
              {HEADLINES[currentFrame.headline].deck}
            </p>
            <div class="landing-rise-3 mt-9 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick$={() => onStartBrief$("hero")}
                class="broadsheet-cta"
              >
                Start your brief →
              </button>
              {onSkipToEditor$ && (
                <button
                  onClick$={() => onSkipToEditor$("hero")}
                  class="broadsheet-cta secondary"
                >
                  Skip to the editor
                </button>
              )}
            </div>
            </div>
          </section>

          {/* ── The room, working ── */}
          <section
            id="editorial-room"
            class="landing-rise-3 mt-16 scroll-mt-8 md:mt-24"
          >
            <div class="relative w-full" style={{ height: "min(80vh, 800px)" }}>
              <WorkspacePreview />
              {annotations.map((a) => (
                <div
                  key={a.id}
                  class={`landing-annotation hidden lg:block ${a.position}`}
                  aria-hidden="true"
                >
                  <p class="tag" style={{ color: a.accent }}>
                    {a.tag}
                  </p>
                  <p class="note">{a.note}</p>
                </div>
              ))}
            </div>
            <ul class="mx-auto mt-6 max-w-xl space-y-3 px-2 lg:hidden">
              {annotations.map((a) => (
                <li key={a.id} class="flex items-baseline gap-3">
                  <span
                    class="text-sm leading-none"
                    style={{ color: a.accent }}
                    aria-hidden="true"
                  >
                    ✦
                  </span>
                  <p
                    class="text-[0.95rem] leading-relaxed text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    <strong
                      class="font-semibold text-[var(--color-ink)]"
                      style="font-family: var(--font-display);"
                    >
                      {a.tag}.
                    </strong>{" "}
                    {a.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <div
            class="ornament-divider my-16 md:my-24"
            style="font-family: var(--font-display);"
          >
            ❦
          </div>

          {/* ── How it works — four plates ── */}
          <section id="how-it-works" class="mx-auto max-w-6xl scroll-mt-8">
            <h2
              class="landing-title ink-bleed landing-typed-reveal text-center text-3xl leading-tight sm:text-4xl"
              data-reveal
              aria-label="How a piece moves through the room"
            >
              {typedSpans("How a piece moves through the room")}
            </h2>
            <ol class="mt-14 space-y-20 md:mt-20 md:space-y-28">
              {steps.map((step) => {
                const portrait = step.orientation === "portrait";
                // Widths are the plate's real pixel dimensions on disk —
                // the generator tops out at 1536 on the long edge, so
                // nothing here is an upscale.
                // Portrait plates render in the narrow 0.66fr column (~404px),
                // so 880 is still comfortably past 2x — and the dense
                // annotated plate compresses badly at any larger size.
                const lgW = portrait ? 880 : 1536;
                const lgH = portrait ? 1100 : 1024;
                // The essay is capped at max-w-6xl (72rem), so past that
                // width the column stops growing. Portrait plates sit in the
                // narrower 0.66fr column — saying so lets the browser drop to
                // the -sm file on 1x displays instead of over-fetching.
                const sizes = portrait
                  ? "(min-width: 1200px) 26rem, (min-width: 768px) 40vw, 92vw"
                  : "(min-width: 1200px) 34rem, (min-width: 768px) 46vw, 92vw";
                return (
                  <li
                    key={step.numeral}
                    class={[
                      "landing-plate",
                      portrait ? "landing-plate--portrait" : "",
                      step.side === "right" ? "landing-plate--right" : "",
                    ]}
                  >
                    <figure
                      class="landing-plate__figure"
                      data-reveal
                      style={`--tilt: ${step.tilt}; --drift-x: ${step.driftX}; --drift-y: ${step.driftY}`}
                    >
                      <div
                        class={[
                          "landing-plate__frame",
                          portrait ? "landing-plate__frame--portrait" : "",
                        ]}
                      >
                        <img
                          src={`/assets/landing/${step.slug}-lg.webp`}
                          srcset={`/assets/landing/${step.slug}-sm.webp ${lgW / 2}w, /assets/landing/${step.slug}-lg.webp ${lgW}w`}
                          sizes={sizes}
                          width={lgW}
                          height={lgH}
                          alt={step.alt}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </figure>
                    <div data-reveal style="--reveal-delay: 120ms;">
                      <p class="landing-plate__label">Plate {step.numeral}</p>
                      <div class="mt-3 flex items-baseline gap-3">
                        <span class="landing-step-num">{step.numeral}</span>
                        <h3
                          class="text-xl text-[var(--color-ink)] sm:text-2xl"
                          style="font-family: var(--font-display); font-weight: 600;"
                        >
                          {step.title}
                        </h3>
                      </div>
                      <p
                        class="mt-4 max-w-prose text-[1.0625rem] leading-relaxed text-[var(--color-ink-light)]"
                        style="font-family: var(--font-serif);"
                      >
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Mid-page CTA — the reader has just seen the whole process. */}
          </section>

          {/* ── Closing CTA ── */}
          <section class="mt-20 md:mt-28">
            <div class="paper-sheet paper-foxed relative overflow-hidden px-8 py-14 text-center md:px-14 md:py-20">
              {/* Photographic bleed, washed back so the copy stays legible. */}
              <img
                src="/assets/landing/product-finished-v2-lg.webp"
                srcset="/assets/landing/product-finished-v2-sm.webp 512w, /assets/landing/product-finished-v2-lg.webp 1024w"
                sizes="(min-width: 768px) 64rem, 100vw"
                width={1024}
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
                  aria-label="The room is open."
                >
                  {typedSpans("The room is open.")}
                </h2>
                <p class="landing-deck mx-auto mt-4 max-w-md text-base">
                  Begin with the interview: ten minutes of questions, and every
                  tool in the room knows what you are writing and who it is for.
                </p>
                <div class="mt-9 flex flex-wrap justify-center gap-3">
                  <button
                    onClick$={() => onStartBrief$("footer")}
                    class="broadsheet-cta"
                  >
                    Start your brief →
                  </button>
                  {onSkipToEditor$ && (
                    <button
                      onClick$={() => onSkipToEditor$("footer")}
                      class="broadsheet-cta secondary"
                    >
                      Skip to the editor
                    </button>
                  )}
                </div>
                <p
                  class="mt-6 text-[0.9rem] text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  Prefer your own desk?{" "}
                  <a
                    class="landing-download-link underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)]"
                    href={DESKTOP_DOWNLOAD_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download Twyne for desktop
                  </a>{" "}
                  — Mac, Windows &amp; Linux.
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
              Good writing is a conversation. Est. MMXXV.
            </p>
            <nav
              class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--color-ink-light)]"
              style="font-family: var(--font-typewriter);"
              aria-label="Footer"
            >
              <a href="/blog/" class="hover:text-[var(--color-ink)]">
                Field Notes
              </a>
              <a href="/docs/" class="hover:text-[var(--color-ink)]">
                The Manual
              </a>
              <a href="/faq/" class="hover:text-[var(--color-ink)]">
                FAQ
              </a>
              <a href="/downloads/" class="hover:text-[var(--color-ink)]">
                Downloads
              </a>
              <a href="/terms/" class="hover:text-[var(--color-ink)]">
                Terms
              </a>
              <a href="/privacy/" class="hover:text-[var(--color-ink)]">
                Privacy
              </a>
              <a href="/pricing/" class="hover:text-[var(--color-ink)]">
                Pricing
              </a>
            </nav>
          </footer>
        </div>
      </div>
    );
  },
);
