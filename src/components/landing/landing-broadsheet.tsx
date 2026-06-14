/* eslint-disable qwik/jsx-img */
import { component$, type PropFunction } from "@builder.io/qwik";

interface Props {
  onStartBrief$: PropFunction<() => void>;
}

const dispatches = [
  {
    numeral: "I",
    title: "The Opening Brief",
    body: "An anti-tabula-rasa interview captures purpose, audience, and what good looks like — so the page is never blank.",
  },
  {
    numeral: "II",
    title: "The Cast",
    body: "Editorial personas, grounded in the brief, read your work the way real readers will.",
  },
  {
    numeral: "III",
    title: "Marginalia",
    body: "Threaded comments and line references turn the right margin into a workshop, not a comment field.",
  },
  {
    numeral: "IV",
    title: "Apparatus",
    body: "Rubric scoring keeps thesis, structure, style, and evidence in plain view while you revise.",
  },
];

export const LandingBroadsheet = component$(({ onStartBrief$ }: Props) => {
  return (
    <div class="broadsheet paper-sheet paper-foxed">
      <div class="broadsheet-page">
        {/* Masthead */}
        <header class="broadsheet-masthead">
          <p class="dept-label">An Anti-Tabula-Rasa Quarterly · Folio MMXXVI</p>
          <h1 class="broadsheet-nameplate ink-bleed">TWYNE</h1>
          <p
            class="font-display italic text-[var(--color-ink-light)] text-base"
            style="font-family: var(--font-display);"
          >
            A writer-first editing room, established{" "}
            <span style="font-variant: small-caps; letter-spacing: 0.08em;">
              MMXXV
            </span>
          </p>
        </header>

        {/* Dateline */}
        <div class="broadsheet-dateline">
          <span>Vol. I · No. 117</span>
          <span>Sunday, the 26th of April, MMXXVI</span>
          <span>Price: One Subscription</span>
        </div>

        {/* Above the fold */}
        <section class="text-center">
          <p class="dept-label" style="color: var(--color-vermilion);">
            Front Page · Editorial
          </p>
          <h2 class="broadsheet-headline mt-3 ink-bleed">
            Start with context.
            <br />
            <em style="font-style: italic;">Revise with voices.</em>
            <br />
            Finish with confidence.
          </h2>
          <p class="broadsheet-deck">
            Twyne opens with an interview so every draft begins from intention,
            not a blank page. Brief, draft, feedback, rubric, and citations —
            kept in one room.
          </p>
          <p class="broadsheet-byline">
            ✦ Filed by the Editorial Staff · For Writers, By Editors ✦
          </p>

          <div class="mt-7 flex flex-wrap justify-center gap-3">
            <button onClick$={onStartBrief$} class="broadsheet-cta">
              Open a Dossier →
            </button>
            <a href="#departments" class="broadsheet-cta secondary">
              See the Editorial Room
            </a>
          </div>

          <div class="mt-8 flex items-center justify-center gap-6">
            <img
              src="/approval-stamp.svg"
              alt=""
              class="h-14 w-14 stamp-tilt opacity-80"
            />
            <img src="/assets/griffin-mark.svg" alt="" class="h-12 w-12" />
            <img
              src="/assets/stamp-fact-checked.svg"
              alt=""
              class="h-14 w-auto stamp-tilt-r opacity-80"
            />
          </div>
        </section>

        {/* Three-column body */}
        <div class="broadsheet-section-rule">
          <span class="rule" />
          <span class="label">From the Editor's Desk</span>
          <span class="rule" />
        </div>

        <div class="broadsheet-cols">
          <p>
            The trouble with most writing tools, our staff has long maintained,
            is that they hand a writer a perfect blank page and expect
            inspiration to follow. Twyne disagrees. The page is never the
            problem; the absence of context is.
          </p>
          <p>
            The room opens, instead, with a brief: a short, firm interview that
            names the piece's purpose, audience, and the standard against which
            it should be judged. From the first sentence onward, every paragraph
            has somewhere to point.
          </p>
          <p>
            Around the manuscript, an editorial board takes up its stations. The
            Cast offers personas tuned to your brief. Marginalia threads notes
            against specific lines. Apparatus keeps a running rubric in view.
            The Citation Desk watches every URL, DOI, and footnote.
          </p>
          <p>
            None of it is automated cheerfulness. The voices may disagree with
            you. The rubric may dock you. The Citation Desk does not flatter —
            it verifies. The room exists, in short, because good writing is a
            conversation, and most software has forgotten how to host one.
          </p>
          <p>
            We invite you to file a piece. Bring a half-formed idea, a stalled
            draft, a thesis you cannot yet defend. The editors are in.
          </p>
          <p style="text-align: right; font-style: italic; color: var(--color-ink-muted);">
            — The Editors
          </p>
        </div>

        {/* Departments */}
        <div class="broadsheet-section-rule">
          <span class="rule" />
          <span class="label">The Departments</span>
          <span class="rule" />
        </div>

        <div id="departments" class="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {dispatches.map((d) => (
            <article key={d.numeral} class="broadsheet-bulletin">
              <p class="dept-label" style="color: var(--color-vermilion);">
                Dispatch № {d.numeral}
              </p>
              <h3 class="ink-bleed">{d.title}</h3>
              <p>{d.body}</p>
            </article>
          ))}
        </div>

        {/* Closing notice */}
        <div class="mt-12 text-center">
          <div class="broadsheet-section-rule">
            <span class="rule" />
            <span class="label">Notice to Subscribers</span>
            <span class="rule" />
          </div>
          <p class="broadsheet-deck">
            "It feels less like software and more like an editorial room that
            remembers what the piece is trying to become."
          </p>
          <p class="broadsheet-byline">— Early Reader, Essayist</p>

          <div class="mt-8 flex flex-wrap justify-center gap-3">
            <button onClick$={onStartBrief$} class="broadsheet-cta">
              Start Writing with Twyne →
            </button>
          </div>

          <p
            class="mt-10 text-[0.65rem] tracking-[0.32em] uppercase text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            ✦ ✦ ✦ &nbsp; Set in Fraunces, Lora &amp; Special Elite &nbsp; ✦ ✦ ✦
          </p>
        </div>
      </div>
    </div>
  );
});
