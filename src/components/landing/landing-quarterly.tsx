/* eslint-disable qwik/jsx-img */
import { component$, type PropFunction } from "@builder.io/qwik";

interface Props {
  onStartBrief$: PropFunction<() => void>;
}

const principles = [
  {
    n: "I",
    title: "Context, never blank pages",
    body: "An anti-tabula-rasa interview opens every project. The brief is visible from the first sentence to the last revision.",
  },
  {
    n: "II",
    title: "Voices, not algorithms",
    body: "Editorial personas read your reader. The Cast disagrees well, and the disagreement is the gift.",
  },
  {
    n: "III",
    title: "Sources kept in view",
    body: "Citations are inspectable, not buried. URLs, DOIs, ISBNs and footnotes live in their own desk.",
  },
  {
    n: "IV",
    title: "Rigor at the margin",
    body: "A standing rubric watches thesis, structure, style, and evidence — and lets you know where the seam is loose.",
  },
];

export const LandingQuarterly = component$(({ onStartBrief$ }: Props) => {
  return (
    <div class="quarterly">
      <article class="quarterly-cover paper-sheet paper-foxed">
        <p class="quarterly-edition">An Editorial Quarterly · Volume I</p>
        <h1 class="quarterly-title ink-bleed">Twyne</h1>
        <p class="quarterly-subtitle">A writer-first editing room.</p>

        <div class="quarterly-rule">
          <span class="line" />
          <span class="ornament">❦</span>
          <span class="line" />
        </div>

        <p class="quarterly-deck">
          Start with context. Revise with voices. Finish with confidence. Twyne
          keeps the brief, the manuscript, the cast, and the citations together
          — the way a good editorial room always has.
        </p>

        <div class="quarterly-buttons">
          <button onClick$={onStartBrief$} class="quarterly-button">
            Open a Dossier
          </button>
          <a href="#principles" class="quarterly-button ghost">
            Read the Manifesto
          </a>
        </div>

        <div class="mt-10 flex items-center justify-center gap-8 opacity-80">
          <img src="/assets/griffin-mark.svg" alt="" class="h-12 w-12" />
          <img src="/approval-stamp.svg" alt="" class="h-16 w-16 stamp-tilt" />
          <img src="/assets/starburst-mark.svg" alt="" class="h-12 w-12" />
        </div>

        <p
          class="mt-8 text-[0.65rem] tracking-[0.32em] uppercase text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          Established · MMXXV · For Writers, By Editors
        </p>
      </article>

      {/* Principles */}
      <section id="principles" class="quarterly-section">
        <p class="kicker">Editorial Manifesto</p>
        <h2 class="ink-bleed">Four standing convictions.</h2>
        <div class="quarterly-rule">
          <span class="line" />
          <span class="ornament">✦</span>
          <span class="line" />
        </div>
        <div class="quarterly-grid">
          {principles.map((p) => (
            <div key={p.n} class="quarterly-entry">
              <span class="numeral">{p.n}.</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The Room */}
      <section class="quarterly-section">
        <p class="kicker">The Room, In Detail</p>
        <h2 class="ink-bleed">Six departments. One conversation.</h2>
        <div class="quarterly-rule">
          <span class="line" />
          <span class="ornament">❦</span>
          <span class="line" />
        </div>
        <div class="quarterly-grid">
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-periwinkle);">
              i.
            </span>
            <h3>Opening Brief</h3>
            <p>Commission the piece before the first sentence.</p>
          </div>
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-sage);">
              ii.
            </span>
            <h3>The Cast</h3>
            <p>Editorial personas grounded in your brief.</p>
          </div>
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-mustard);">
              iii.
            </span>
            <h3>Marginalia</h3>
            <p>Threaded notes with line references.</p>
          </div>
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-cobalt);">
              iv.
            </span>
            <h3>Apparatus</h3>
            <p>Rubric scoring kept always in view.</p>
          </div>
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-vermilion);">
              v.
            </span>
            <h3>Citation Desk</h3>
            <p>URLs, DOIs, ISBNs &amp; footnotes, watched.</p>
          </div>
          <div class="quarterly-entry">
            <span class="numeral" style="color: var(--color-ink-muted);">
              vi.
            </span>
            <h3>Folios &amp; Dossiers</h3>
            <p>Local, organized, like a real file cabinet.</p>
          </div>
        </div>
      </section>

      {/* Colophon */}
      <section class="quarterly-section" style="max-width: 540px;">
        <p class="kicker">Colophon</p>
        <p class="quarterly-deck" style="font-style: italic;">
          "It feels less like software and more like an editorial room that
          remembers what the piece is trying to become."
        </p>
        <p
          class="mt-3 text-xs text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter); letter-spacing: 0.18em; text-transform: uppercase;"
        >
          — Early Reader, Essayist
        </p>
        <div class="quarterly-rule" style="margin-top: 2rem;">
          <span class="line" />
          <span class="ornament">✦</span>
          <span class="line" />
        </div>
        <div class="quarterly-buttons">
          <button onClick$={onStartBrief$} class="quarterly-button">
            Start Writing with Twyne
          </button>
        </div>
        <p
          class="mt-8 text-[0.65rem] tracking-[0.3em] uppercase text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          Set in Fraunces &amp; Lora · Pressed on Paper
        </p>
      </section>
    </div>
  );
});
