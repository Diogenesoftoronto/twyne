import { component$, useStyles$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import {
  DiffusionHole,
  InsertHoleCaret,
  LockedAnchor,
  type DiffusionHoleProps,
} from "./diffusion-hole";

const STORY_STYLES = `
  .dh-story-page {
    min-height: 100dvh;
    padding: 2.5rem 1.5rem;
    background: var(--color-paper);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }
  .dh-story-container {
    max-width: 52rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .dh-story-title {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
  }
  .dh-story-sub {
    font-size: 0.85rem;
    color: var(--color-ink-light);
    margin: 0;
  }
  .dh-story-sheet {
    background: var(--color-editor-bg);
    border: 1px solid var(--color-paper-3);
    border-radius: 3px;
    padding: 1.5rem 1.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .dh-story-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--color-editor-line);
  }
  .dh-story-label {
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
  }
  .dh-story-tag {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-ink-muted);
  }
  .dh-story-prose {
    font-family: var(--font-serif);
    font-size: 1.12rem;
    line-height: 2.05;
    margin: 0;
    color: var(--color-ink);
  }
`;

const Gallery = component$(() => {
  useStyles$(STORY_STYLES);
  return (
    <main class="dh-story-page">
      <div class="dh-story-container">
        <header>
          <h1 class="dh-story-title">Gaps the model fills in place</h1>
          <p class="dh-story-sub">
            Three treatments for an inline gap. Hover or tab into a gap for its controls: write words to keep, change how many words it holds, then fill it. Your own words hold still while the rest resolves around them.
          </p>
        </header>

        <section class="dh-story-sheet">
          <div class="dh-story-meta">
            <h2 class="dh-story-label">1. Typesetter's Blank</h2>
            <span class="dh-story-tag">variant="blank" · quiet ruled baseline</span>
          </div>
          <p class="dh-story-prose">
            At dusk the <LockedAnchor text="customs clerk" />{" "}
            <DiffusionHole
              variant="blank"
              state="seeded"
              slotsBefore={2}
              slotsAfter={2}
              seedText="iron latch"
              settledText="fastened the iron latch shut tight"
            />{" "}
            while the last steamer cleared the breakwater.
          </p>
        </section>

        <section class="dh-story-sheet">
          <div class="dh-story-meta">
            <h2 class="dh-story-label">2. Halftone Cutout</h2>
            <span class="dh-story-tag">variant="cutout" · recessed proofreader hatch</span>
          </div>
          <p class="dh-story-prose">
            At dusk the <LockedAnchor text="customs clerk" />{" "}
            <DiffusionHole
              variant="cutout"
              state="seeded"
              slotsBefore={2}
              slotsAfter={2}
              seedText="iron latch"
              settledText="fastened the iron latch shut tight"
            />{" "}
            while the last steamer cleared the breakwater.
          </p>
        </section>

        <section class="dh-story-sheet">
          <div class="dh-story-meta">
            <h2 class="dh-story-label">3. Proofreader's Bracket</h2>
            <span class="dh-story-tag">variant="bracket" · minimal galley corner marks</span>
          </div>
          <p class="dh-story-prose">
            At dusk the <LockedAnchor text="customs clerk" />{" "}
            <DiffusionHole
              variant="bracket"
              state="seeded"
              slotsBefore={2}
              slotsAfter={2}
              seedText="iron latch"
              settledText="fastened the iron latch shut tight"
            />{" "}
            while the last steamer cleared the breakwater.
          </p>
        </section>

        <section class="dh-story-sheet">
          <div class="dh-story-meta">
            <h2 class="dh-story-label">4. Lifecycle states and insertion caret</h2>
            <span class="dh-story-tag">open caret · resolving · settled</span>
          </div>
          <p class="dh-story-prose">
            He folded the ledger.
            <InsertHoleCaret />
            By dawn the pier was{" "}
            <DiffusionHole variant="cutout" state="denoising" seedText="cold" settledText="empty and cold under the lamps" />{" "}
            and{" "}
            <DiffusionHole variant="blank" state="settled" settledText="the rope hung stiff with frost." />
          </p>
        </section>
      </div>
    </main>
  );
});

const SingleHolePreview = component$<DiffusionHoleProps>((props) => {
  useStyles$(STORY_STYLES);
  return (
    <main class="dh-story-page">
      <div class="dh-story-container">
        <section class="dh-story-sheet">
          <p class="dh-story-prose">
            At dusk the <LockedAnchor text="customs clerk" />{" "}
            <DiffusionHole {...props} />{" "}
            while the last steamer cleared the breakwater.
          </p>
        </section>
      </div>
    </main>
  );
});

const meta = {
  title: "Writing instruments/Diffusion hole",
  component: SingleHolePreview,
  parameters: { layout: "fullscreen" },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["blank", "cutout", "bracket"],
    },
    state: {
      control: "select",
      options: ["masked", "seeded", "editing", "denoising", "settled"],
    },
    slotsBefore: { control: { type: "number", min: 0, max: 6 } },
    slotsAfter: { control: { type: "number", min: 0, max: 6 } },
  },
  args: {
    variant: "cutout",
    state: "seeded",
    slotsBefore: 2,
    slotsAfter: 2,
    seedText: "iron latch",
    settledText: "fastened the iron latch shut tight",
    showControls: true,
  },
} satisfies Meta<DiffusionHoleProps>;

export default meta;
type Story = StoryObj<DiffusionHoleProps>;

export const AllTreatments: Story = {
  render: () => <Gallery />,
};

export const TypesettersBlank: Story = {
  args: { variant: "blank", state: "masked", seedText: "", slotsBefore: 4, slotsAfter: 0 },
};

export const HalftoneCutoutSeeded: Story = {
  args: { variant: "cutout", state: "seeded", seedText: "iron latch", slotsBefore: 2, slotsAfter: 2 },
};

export const ProofreadersBracket: Story = {
  args: { variant: "bracket", state: "seeded", seedText: "without", slotsBefore: 2, slotsAfter: 3 },
};

export const InlineEditing: Story = {
  args: { variant: "cutout", state: "editing", seedText: "iron latch" },
};

export const DenoisingPass: Story = {
  args: { variant: "cutout", state: "denoising", seedText: "iron latch" },
};
