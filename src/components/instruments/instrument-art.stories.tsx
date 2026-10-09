import { component$, useStyles$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import {
  INSTRUMENT_ART,
  InstrumentArt,
  InstrumentRule,
  InstrumentTexture,
  type InstrumentArtKind,
} from "./instrument-art";

const captions: Record<InstrumentArtKind, { title: string; purpose: string }> =
  {
    "sentence-bench": {
      title: "Sentence bench",
      purpose: "Set complete phrasings next to the sentence you wrote.",
    },
    threads: {
      title: "Threads",
      purpose: "Follow a connection between passages, then work on the bridge.",
    },
    research: {
      title: "Research",
      purpose: "Bring a source and its supporting passage back to the desk.",
    },
    scene: {
      title: "Scene",
      purpose: "Explore the framing, sound, or atmosphere of a passage.",
    },
  };

const ArtCollection = component$<{
  size?: "compact" | "standard" | "large";
  textured?: boolean;
}>((props) => {
  useStyles$(`
    .instrument-art-study { width: min(54rem, 100%); color: var(--color-ink); font-family: var(--font-sans); }
    .instrument-art-study__intro { max-width: 42rem; margin: 0 0 1.5rem; color: var(--color-ink-light); font-size: .875rem; line-height: 1.6; }
    .instrument-art-study__collection { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 2rem; }
    .instrument-art-study figure { display: flex; align-items: center; gap: 1rem; min-width: 0; margin: 0; padding: 1.25rem 0; border-top: 1px solid var(--color-paper-3); }
    .instrument-art-study__specimen { position: relative; display: flex; flex-shrink: 0; justify-content: center; align-items: center; isolation: isolate; }
    .instrument-art-study figcaption { min-width: 0; font-size: .8125rem; line-height: 1.5; }
    .instrument-art-study h2 { margin: 0 0 .375rem; font-family: var(--font-sans); font-size: 1rem; line-height: 1.3; font-weight: 600; }
    .instrument-art-study p { margin: 0; color: var(--color-ink-light); }
    .instrument-art-study__rule { padding-top: 1rem; }
    @media (max-width: 40rem) { .instrument-art-study__collection { grid-template-columns: minmax(0, 1fr); } }
  `);
  return (
    <section
      class="instrument-art-study"
      aria-label="Instrument illustration family"
    >
      <p class="instrument-art-study__intro">
        Four tools from the same workroom. The art rests beside the tool title;
        meaning, availability, and progress stay in text.
      </p>
      <div class="instrument-art-study__collection">
        {(Object.keys(INSTRUMENT_ART) as InstrumentArtKind[]).map((kind) => (
          <figure key={kind}>
            <div class="instrument-art-study__specimen">
              {props.textured && <InstrumentTexture />}
              <InstrumentArt kind={kind} size={props.size} />
            </div>
            <figcaption>
              <h2>{captions[kind].title}</h2>
              <p>{captions[kind].purpose}</p>
            </figcaption>
          </figure>
        ))}
      </div>
      <div class="instrument-art-study__rule">
        <InstrumentRule />
      </div>
    </section>
  );
});

const meta = {
  title: "Instruments/Illustration family",
  component: ArtCollection,
  parameters: { layout: "padded" },
  args: { size: "standard", textured: false },
} satisfies Meta<typeof ArtCollection>;
export default meta;
type Story = StoryObj<typeof ArtCollection>;

export const Collection: Story = {};
export const Compact: Story = { args: { size: "compact" } };
export const Large: Story = { args: { size: "large" } };
export const Nightpress: Story = { globals: { theme: "nightpress" } };
export const Foolscap: Story = { globals: { theme: "foolscap" } };
export const PaperTooth: Story = { args: { textured: true } };
