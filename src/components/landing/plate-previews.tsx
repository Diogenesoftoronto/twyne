import { component$ } from "@qwik.dev/core";
import { DossierPreview } from "../brief/dossier-preview";
import { GradeStamp } from "../rubric/grade-stamp";

/**
 * Static UI-mimicking illustrations for the landing plates. They look like
 * the product because they *are* the product's components fed canned data —
 * no providers, no network, no interactivity. The adjacent step copy carries
 * the meaning, so every preview is hidden from assistive tech.
 */

const briefAnswers = {
  workingTitle: "Libraries as Civic Infrastructure",
  format: "Magazine feature",
  audience: "Municipal leaders and engaged city residents",
  goal: "Show why the modern library belongs in infrastructure budgets.",
  tone: "Reported, practical, and quietly urgent",
  constraints: "Lead with lived experience; support every funding claim.",
  successSignal: "A reader can name one concrete policy change to support.",
};

export const BriefPlatePreview = component$(() => (
  <div aria-hidden="true" class="bg-[var(--color-paper)] p-4 text-left">
    <DossierPreview
      answers={briefAnswers}
      probes={[
        {
          id: "plate-probe-1",
          kind: "choice",
          prompt: "Which case should carry the argument?",
          options: ["Public health", "Workforce access", "Social connection"],
          answer: "Social connection",
          relatesTo: "goal",
        },
        {
          id: "plate-probe-2",
          kind: "scale",
          prompt: "How forceful should the recommendation be?",
          min: 1,
          max: 5,
          minLabel: "Suggestive",
          maxLabel: "Prescriptive",
          relatesTo: "tone",
        },
      ]}
      attachments={[
        {
          id: "plate-ref-1",
          kind: "link",
          title: "Urban Libraries Council data",
          url: "https://example.com/library-data",
          why: "The national usage baseline.",
          addedAt: Date.UTC(2026, 7, 31, 13, 0),
        },
      ]}
      mode="first-run"
      existingMaterialWords={1840}
    />
  </div>
));

export const DraftPlatePreview = component$(() => (
  <div
    aria-hidden="true"
    class="bg-[var(--color-paper)] p-6 text-left sm:p-8"
    style="font-family: var(--font-serif);"
  >
    <p class="dept-label">Chapter one</p>
    <p
      class="mt-2 text-2xl leading-tight text-[var(--color-ink)]"
      style="font-family: var(--font-display); font-weight: 700;"
    >
      The public room
    </p>
    <p class="mt-4 leading-[1.75] text-[var(--color-ink)]">
      The branch on Queen Street stays open until nine, and by eight the tables
      are full of people who are not, strictly speaking, reading. Teenagers
      finish problem sets. A newcomer practices an interview script under her
      breath. An older man sleeps sitting up, his coat folded into a pillow.
    </p>
    <p class="mt-4 leading-[1.75] text-[var(--color-ink)]">
      None of this appears in the budget line called{" "}
      <s class="text-[var(--color-ink-muted)]">circulation</s>{" "}
      <span class="text-[var(--color-vermilion)]">civic life</span>, which is
      why the line keeps shrinking while the room keeps filling.
    </p>
    <p class="mt-4 leading-[1.75] text-[var(--color-ink-light)]">
      What the city funds is not a warehouse of books but the only room left
      where no one has to buy anything to stay.
    </p>
  </div>
));

const plateNotes = [
  {
    author: "The Skeptic",
    color: "var(--color-vermilion)",
    mark: "✕",
    note: "“The only room left” — have you checked the community centres? The claim needs a qualifier or a source.",
  },
  {
    author: "The Gentle Reader",
    color: "var(--color-sage)",
    mark: "✦",
    note: "The sleeping man stays with me. Open the chapter here, not on the budget line.",
  },
];

export const NotesPlatePreview = component$(() => (
  <div aria-hidden="true" class="bg-[var(--color-paper)] p-4 text-left">
    <p
      class="text-[0.95rem] leading-[1.7] text-[var(--color-ink)]"
      style="font-family: var(--font-serif);"
    >
      An older man sleeps sitting up,{" "}
      <mark
        class="rounded-sm px-0.5"
        style="background: color-mix(in srgb, var(--color-vermilion) 18%, transparent); border-bottom: 2px solid var(--color-vermilion);"
      >
        his coat folded into a pillow
      </mark>
      . None of this appears in the budget line called{" "}
      <mark
        class="rounded-sm px-0.5"
        style="background: color-mix(in srgb, var(--color-sage) 22%, transparent); border-bottom: 2px solid var(--color-sage);"
      >
        circulation
      </mark>
      .
    </p>
    <div class="mt-3 space-y-2">
      {plateNotes.map((entry) => (
        <article
          key={entry.author}
          class="border-l-2 bg-[var(--color-paper-soft)] px-3 py-2"
          style={`border-color: ${entry.color};`}
        >
          <p
            class="text-[0.62rem] tracking-[0.14em] uppercase"
            style={`font-family: var(--font-typewriter); color: ${entry.color};`}
          >
            {entry.mark} {entry.author}
          </p>
          <p
            class="mt-1 text-[0.8rem] leading-[1.5] text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif);"
          >
            {entry.note}
          </p>
        </article>
      ))}
    </div>
    <div class="mt-3 flex items-center gap-3 border-t border-dotted border-[var(--color-ink-muted)] pt-3">
      <GradeStamp
        grade="B+"
        score={84}
        color="var(--color-vermilion)"
        size="compact"
      />
      <p
        class="text-[0.72rem] leading-[1.5] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-serif);"
      >
        Thesis holds; evidence thins in the final third. 84 of 100.
      </p>
    </div>
  </div>
));

const plateSources = [
  {
    kind: "Web",
    accent: "var(--color-cobalt)",
    title: "Urban Libraries Council — 2024 usage data",
    detail: "council.libraries.example · captured Aug 12",
    status: "Verified",
    ok: true,
  },
  {
    kind: "DOI",
    accent: "var(--color-sage)",
    title: "10.1353/lib.2023.0041 — The library as third place",
    detail: "Journal of Civic Infrastructure · matches citation",
    status: "Verified",
    ok: true,
  },
  {
    kind: "Footnote",
    accent: "var(--color-mustard)",
    title: "Smith 2019, p. 142 — original formulation",
    detail: "Quoted wording differs from the manuscript",
    status: "Needs review",
    ok: false,
  },
];

export const SourcesPlatePreview = component$(() => (
  <div aria-hidden="true" class="bg-[var(--color-paper)] p-4 text-left sm:p-5">
    <p class="dept-label">The Apparatus · 3 records</p>
    <ul class="mt-3 space-y-2">
      {plateSources.map((source) => (
        <li
          key={source.title}
          class="flex items-start gap-3 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2.5"
        >
          <span
            class="mt-0.5 shrink-0 px-1.5 py-0.5 text-[0.6rem] tracking-[0.12em] uppercase text-[var(--color-paper)]"
            style={`font-family: var(--font-typewriter); background: ${source.accent};`}
          >
            {source.kind}
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-[0.82rem] font-semibold text-[var(--color-ink)]"
              style="font-family: var(--font-display);"
            >
              {source.title}
            </span>
            <span
              class="block truncate text-[0.72rem] text-[var(--color-ink-muted)]"
              style="font-family: var(--font-serif);"
            >
              {source.detail}
            </span>
          </span>
          <span
            class="shrink-0 text-[0.7rem] font-semibold"
            style={`font-family: var(--font-typewriter); color: ${source.ok ? "var(--color-sage)" : "var(--color-vermilion)"};`}
          >
            {source.ok ? "✓" : "✕"} {source.status}
          </span>
        </li>
      ))}
    </ul>
  </div>
));
