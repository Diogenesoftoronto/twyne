import { component$, type PropFunction } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { WorkspacePreview } from "./workspace-preview";
import { useFeatureFlags } from "../../utils/posthog-context";

interface LandingPageProps {
  onStartBrief$: PropFunction<() => void>;
  onSkipToEditor$?: PropFunction<() => void>;
  onSignIn$?: PropFunction<() => void>;
}

/** Where the Electrobun desktop builds are published (GitHub Releases). */
const DESKTOP_DOWNLOAD_URL =
  "https://github.com/Diogenesoftoronto/twyne/releases/latest";

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

const steps = [
  {
    numeral: "I",
    title: "Answer the brief",
    body: "Ten minutes of questions about audience, purpose, and what good looks like. The interview becomes a project brief that every tool in the room reads, so no draft starts from a blank page.",
  },
  {
    numeral: "II",
    title: "Write the draft",
    body: "A serious long-form editor with saved drafts and focus tools. Your work stays on your machine, organized into folios you can return to between sessions.",
  },
  {
    numeral: "III",
    title: "Take the notes",
    body: "The Skeptic, the Gentle Reader, the Line Editor, the Critic: each persona marks up the draft in the margin while a rubric grades thesis, structure, style, and evidence against the brief.",
  },
  {
    numeral: "IV",
    title: "Check the record",
    body: "Twyne detects URLs, DOIs, ISBNs, and footnotes as you cite them, and keeps every source in one place where it can be inspected and verified.",
  },
];

export const LandingPage = component$<LandingPageProps>(
  ({ onStartBrief$, onSkipToEditor$, onSignIn$ }) => {
    const featureFlags = useFeatureFlags();

    return (
      <div class="landing-page">
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
              {featureFlags.value.flags.pricing && (
                <Link class="landing-nav-link" href="/pricing">
                  Pricing
                </Link>
              )}
            </nav>
            <div class="flex items-center gap-3">
              <img src="/assets/griffin-mark.svg" alt="" class="h-8 w-8" />
              <span class="landing-masthead ink-bleed">TWYNE</span>
            </div>
            <div class="flex items-center justify-end gap-4">
              {onSignIn$ && (
                <button
                  onClick$={onSignIn$}
                  class="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] focus-ring"
                  style="font-family: var(--font-typewriter);"
                >
                  Sign in
                </button>
              )}
              <button onClick$={onStartBrief$} class="broadsheet-cta">
                Start writing
              </button>
            </div>
          </header>

          {/* ── Hero ── */}
          <section class="mx-auto max-w-3xl pt-14 pb-10 text-center md:pt-20 md:pb-12">
            <h1 class="landing-title landing-rise ink-bleed text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.02]">
              Draft with a room full of editors.
            </h1>
            <p class="landing-deck landing-rise-2 mx-auto mt-6 max-w-2xl text-base sm:text-lg">
              Twyne is a writing app for essays and long-form drafts. A short
              interview turns your intent into a project brief, then five
              editorial personas, a grading rubric, and a citation desk read
              every draft against it.
            </p>
            <div class="landing-rise-3 mt-9 flex flex-wrap items-center justify-center gap-3">
              <button onClick$={onStartBrief$} class="broadsheet-cta">
                Start your brief →
              </button>
              {onSkipToEditor$ && (
                <button
                  onClick$={onSkipToEditor$}
                  class="broadsheet-cta secondary"
                >
                  Skip to the editor
                </button>
              )}
            </div>
          </section>

          {/* ── The room, working ── */}
          <section id="editorial-room" class="landing-rise-3 scroll-mt-8">
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

          {/* ── How it works ── */}
          <section id="how-it-works" class="mx-auto max-w-4xl scroll-mt-8">
            <h2 class="landing-title ink-bleed text-3xl leading-tight sm:text-4xl">
              How a piece moves through the room
            </h2>
            <ol class="mt-10 space-y-10 md:mt-14 md:space-y-12">
              {steps.map((step) => (
                <li
                  key={step.numeral}
                  class="grid gap-3 md:grid-cols-[200px_1fr] md:gap-10"
                >
                  <div class="flex items-baseline gap-3 md:block">
                    <span class="landing-step-num">{step.numeral}</span>
                    <h3
                      class="text-xl text-[var(--color-ink)] md:mt-2"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {step.title}
                    </h3>
                  </div>
                  <p
                    class="max-w-prose text-[1.0625rem] leading-relaxed text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Closing CTA ── */}
          <section class="mt-20 md:mt-28">
            <div class="paper-sheet paper-foxed relative overflow-hidden px-8 py-14 text-center md:px-14 md:py-20">
              <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <img
                  src="/approval-stamp.svg"
                  alt=""
                  class="h-40 w-40 opacity-[0.06]"
                />
              </div>
              <div class="relative z-10">
                <img
                  src="/assets/griffin-mark.svg"
                  alt=""
                  class="mx-auto h-7 w-7"
                />
                <h2 class="landing-title ink-bleed mt-5 text-3xl leading-tight sm:text-4xl">
                  The room is open.
                </h2>
                <p class="landing-deck mx-auto mt-4 max-w-md text-base">
                  Begin with the interview: ten minutes of questions, and every
                  tool in the room knows what you are writing and who it is for.
                </p>
                <div class="mt-9 flex flex-wrap justify-center gap-3">
                  <button onClick$={onStartBrief$} class="broadsheet-cta">
                    Start your brief →
                  </button>
                  {onSkipToEditor$ && (
                    <button
                      onClick$={onSkipToEditor$}
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
            <img
              src="/assets/griffin-mark.svg"
              alt=""
              class="mx-auto h-8 w-8"
            />
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
              <a href="/terms/" class="hover:text-[var(--color-ink)]">
                Terms
              </a>
              <a href="/privacy/" class="hover:text-[var(--color-ink)]">
                Privacy
              </a>
              {featureFlags.value.flags.pricing && (
                <a href="/pricing/" class="hover:text-[var(--color-ink)]">
                  Pricing
                </a>
              )}
            </nav>
          </footer>
        </div>
      </div>
    );
  },
);
