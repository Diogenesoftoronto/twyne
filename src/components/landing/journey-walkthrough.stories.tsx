import type { Meta, StoryObj } from "storybook-framework-qwik";
import { GTProvider } from "gt-qwik";
import dictionary from "../../i18n/landing/messages/en.json";
import { JourneyWalkthrough } from "./journey-walkthrough";
import "./landing-journey.css";

/**
 * The landing walkthroughs: Fieldnote's blog, Marsh Lane's house style and
 * domain, and Ines Calder's novel. Storybook has no app-wide translation
 * provider, so the story supplies the English landing dictionary itself.
 */
const meta = {
  title: "Landing/JourneyWalkthrough",
  component: JourneyWalkthrough,
  decorators: [
    (Story) => (
      <GTProvider
        config={{ defaultLocale: "en", locales: ["en"], dictionary }}
        initialLocale="en"
      >
        <div class="landing-page w-[72rem] max-w-[calc(100vw-2rem)] p-4">
          {Story()}
        </div>
      </GTProvider>
    ),
  ],
} satisfies Meta<typeof JourneyWalkthrough>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
