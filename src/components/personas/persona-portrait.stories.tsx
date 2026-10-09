import { component$, useStyles$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { PERSONAS } from "../../utils/personas";
import { PersonaMasthead } from "./persona-portrait";

const sampleNotes = [
  {
    id: "devil",
    text: "The conclusion arrives before the evidence. Let the reader see what changed your mind before asking them to change theirs.",
  },
  {
    id: "reader",
    text: "I can picture the platform, but I lose track of who is waiting. One concrete gesture could bring the person back into the scene.",
  },
];

const PortraitSamples = component$<{ allResidents?: boolean }>((props) => {
  useStyles$(`
    .persona-portrait-samples { max-width: 52rem; color: var(--color-ink); }
    .persona-portrait-samples > h1 { margin: 0; font: 500 1.75rem/1.2 var(--font-display); }
    .persona-portrait-samples__intro { max-width: 42rem; margin: .75rem 0 1.75rem; font: 400 .875rem/1.6 var(--font-sans); color: var(--color-ink-light); }
    .persona-portrait-samples__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
    .persona-portrait-samples__note { min-width: 0; border-top: 1px solid var(--color-paper-3); padding-top: 1rem; }
    .persona-portrait-samples__body { margin: 1rem 0 0; font: 400 1rem/1.7 var(--font-serif); }
    .persona-portrait-samples__caption { margin: 1rem 0 0; color: var(--color-ink-light); font: 400 .75rem/1.5 var(--font-sans); }
    @media (max-width: 38rem) { .persona-portrait-samples__grid { grid-template-columns: minmax(0, 1fr); } }
  `);
  const residents = props.allResidents
    ? PERSONAS
    : PERSONAS.filter((persona) =>
        sampleNotes.some((note) => note.id === persona.id),
      );
  return (
    <section
      class="persona-portrait-samples"
      aria-label="Sample editorial voices"
    >
      <h1>A face above the critique</h1>
      <p class="persona-portrait-samples__intro">
        Sample critiques, written for this component preview. No model request.
        Each voice keeps its name and role; the portrait stays still while you
        read.
      </p>
      <div class="persona-portrait-samples__grid">
        {residents.map((persona) => (
          <article class="persona-portrait-samples__note" key={persona.id}>
            <PersonaMasthead
              personaId={persona.id}
              name={persona.name}
              role={persona.role}
              label="Sample critique"
            />
            <p class="persona-portrait-samples__body">
              {sampleNotes.find((note) => note.id === persona.id)?.text ??
                "A sample note from this member of the editorial room."}
            </p>
          </article>
        ))}
        <article class="persona-portrait-samples__note" data-sample="custom">
          <PersonaMasthead
            personaId="sample-archivist"
            name="Émilie Tran"
            role="The Archivist"
            label="Sample custom persona"
          />
          <p class="persona-portrait-samples__body">
            The letter offers a date, but the narrator remembers a season. Keep
            that difference visible until another source resolves it.
          </p>
          <p class="persona-portrait-samples__caption">
            A custom voice keeps its own initials. No resident portrait is
            assigned.
          </p>
        </article>
        <article
          class="persona-portrait-samples__note"
          data-sample="name-collision"
        >
          <PersonaMasthead
            personaId="sample-custom-reader"
            name="Le Lecteur"
            role="A custom voice with a familiar name"
            label="Sample identity fallback"
          />
          <p class="persona-portrait-samples__caption">
            An explicit custom ID takes precedence over a matching resident
            name.
          </p>
        </article>
      </div>
    </section>
  );
});

const meta = {
  title: "Editorial room/Persona portraits",
  component: PortraitSamples,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PortraitSamples>;
export default meta;
type Story = StoryObj<typeof PortraitSamples>;

export const SampleCritiques: Story = {};
export const Nightpress: Story = { globals: { theme: "nightpress" } };
export const Narrow: Story = {
  globals: { viewport: { value: "compactPhone", isRotated: false } },
};
export const ResidentCast: Story = { args: { allResidents: true } };
