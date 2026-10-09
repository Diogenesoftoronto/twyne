import { component$, useStyles$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { LivingDeskSnapshot } from "../../utils/living-desk-contract";
import { LivingDeskPanel } from "./living-desk-panel";
import {
  DESK_FIXTURE,
  EMPTY_FIXTURE,
  FLOOD_MEMOIR,
  FOCUSED_FIXTURE,
  LIMITED_FIXTURE,
  RESOLVED_FIXTURE,
  SHORT_FIXTURE,
  STALE_FIXTURE,
} from "./living-desk.fixtures";

interface PreviewProps {
  fixture: LivingDeskSnapshot;
  readOnly?: boolean;
}
const DeskPreview = component$<PreviewProps>((props) => {
  useStyles$(`
    .ld-story { min-height: 100dvh; padding: 5rem 3rem 4rem 24rem; background: var(--color-paper-2); color: var(--color-ink); }
    .ld-story__page { max-width: 46rem; margin: auto; padding: 3rem; background: var(--color-paper); font: 1rem/1.8 var(--font-serif); }
    .ld-story__page h1 { font: 600 2rem/1.2 var(--font-display); margin-bottom: 2rem; }
    .ld-story__page h2 { font: 600 1.125rem var(--font-display); margin: 1.5rem 0 .75rem; }
    .ld-story__page p { margin: 0 0 1rem; }
    .ld-story__swatches { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 2rem; border-top: 1px solid var(--color-paper-3); padding-top: 1rem; }
    @media(max-width:73.99rem) { .ld-story { padding: 2rem 1rem 60dvh; } .ld-story__page { padding: 1.5rem; } }
  `);
  return (
    <main class="ld-story">
      <LivingDeskPanel fixture={props.fixture} readOnly={props.readOnly} />
      <article class="ld-story__page">
        <h1>The river and the ledger</h1>
        {FLOOD_MEMOIR.map((section, i) => (
          <section key={section.title}>
            <h2>
              {["I", "II", "III"][i]}. {section.title}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <div class="ld-story__swatches" aria-label="Lens marks">
          <span
            class="ld-occ ld-occ--flagged"
            data-ld-lens="stance"
            data-ld-label="editorial"
          >
            editorial we
          </span>
          <span
            class="ld-occ ld-occ--context"
            data-ld-lens="stance"
            data-ld-label="singular"
          >
            I
          </span>
          <span class="ld-occ ld-occ--flagged" data-ld-lens="naming">
            Hollis
          </span>
          <span class="ld-occ ld-occ--context" data-ld-lens="naming">
            Hollins
          </span>
          <span class="ld-occ ld-occ--flagged" data-ld-lens="style">
            serial comma
          </span>
          <span
            class="ld-occ ld-occ--context"
            data-ld-lens="presence"
            data-ld-label="Mara Okafor"
          >
            Mara Okafor
          </span>
        </div>
      </article>
    </main>
  );
});
const meta = {
  title: "Living desk/The piece",
  component: DeskPreview,
  parameters: { layout: "fullscreen" },
  args: { fixture: DESK_FIXTURE },
} satisfies Meta<PreviewProps>;
export default meta;
type Story = StoryObj<PreviewProps>;
export const Default: Story = {};
export const Focused: Story = { args: { fixture: FOCUSED_FIXTURE } };
export const AllResolved: Story = { args: { fixture: RESOLVED_FIXTURE } };
export const Empty: Story = { args: { fixture: EMPTY_FIXTURE } };
export const ShortDraft: Story = { args: { fixture: SHORT_FIXTURE } };
export const RuleOnly: Story = {
  args: { fixture: { ...DESK_FIXTURE, judgement: "offline" } },
};
export const Nightpress: Story = {
  args: { fixture: FOCUSED_FIXTURE },
  globals: { theme: "nightpress" },
};
export const Presence: Story = {
  args: {
    fixture: {
      ...DESK_FIXTURE,
      lens: "presence",
      focusedFinding: "presence:mara",
    },
  },
};
export const Stale: Story = { args: { fixture: STALE_FIXTURE } };
export const ReadOnly: Story = {
  args: { fixture: FOCUSED_FIXTURE, readOnly: true },
};
export const Reading: Story = {
  args: { fixture: { ...FOCUSED_FIXTURE, judgement: "reading" } },
};
export const Deliberate: Story = {
  args: {
    fixture: {
      ...FOCUSED_FIXTURE,
      findings: DESK_FIXTURE.findings.map((f) =>
        f.id === "stance"
          ? {
              ...f,
              state: "deliberate",
              deliberateNote:
                "Kept on purpose. Twyne will flag only new drift.",
            }
          : f,
      ),
    },
  },
};
export const Unconfirmed: Story = {
  args: {
    fixture: {
      ...DESK_FIXTURE,
      score: {
        ...DESK_FIXTURE.score,
        confirmed: null,
        confirmedAt: null,
        confirmedLetter: null,
        editsSinceConfirmed: 0,
      },
    },
  },
};
export const LongPiece: Story = { args: { fixture: LIMITED_FIXTURE } };
