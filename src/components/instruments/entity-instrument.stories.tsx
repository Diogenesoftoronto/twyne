import { component$, useContextProvider, useSignal } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { AuthContext, type AuthState } from "../../utils/auth-context";
import { ConvexProvider } from "../../utils/convex-context";
import { buildEntityInstrumentIndex } from "../../utils/entity-instrument";
import { EntityInstrument } from "./entity-instrument";

const index = buildEntityInstrumentIndex({
  plainText: "",
  sections: [
    { index: 0, title: "Arrival", from: 1, to: 200, words: 25 },
    { index: 1, title: "Departure", from: 200, to: 400, words: 25 },
  ],
  blocks: [
    {
      kind: "paragraph",
      text: "I met Mara and Tom. Mara said, “I keep the blue coat.”",
      pos: 1,
      paragraph: 1,
      section: 0,
    },
    {
      kind: "paragraph",
      text: "Later, Mara visited Tom. Mara wore a red coat. Tom said, “The road is clear.”",
      pos: 200,
      paragraph: 2,
      section: 1,
    },
  ],
});
const Specimen = component$(() => {
  useContextProvider(
    AuthContext,
    useSignal<AuthState>({ user: null, loading: false }),
  );
  return (
    <ConvexProvider>
      <EntityInstrument
        index={index}
        contextKey="story-v1"
        context="Two travellers in a short story."
      />
    </ConvexProvider>
  );
});
export default {
  title: "Instruments/Entity instrument",
  component: Specimen,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Specimen>;
type Story = StoryObj<typeof Specimen>;
export const LocalPresence: Story = {};
export const Nightpress: Story = { globals: { theme: "nightpress" } };
