import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/instruments/";

export const WRITING_INSTRUMENT_GUIDES = {
  "instrument-room": {
    title: "Bring the right editor into the question",
    summary:
      "Ask the room from an instrument, then continue with one editor beside the passage.",
    note: "Actual app screenshots with a fictional manuscript and explicitly simulated model responses. They demonstrate the interaction and attribution, not live Jev selection or the quality of a generated critique.",
    steps: [
      {
        title: "Ask beside the work",
        instruction:
          "Sentence bench, each Threads pair and Scene bench keep the question close to its source. Ask the room lets your judgement model choose among your current editors, including nobody when a critique would not help. You can also choose an editor yourself. The original passage and any unapplied proposal are sent as separate context.",
        image: "/assets/manual/instrument-room-invitation-v1.webp",
        alt: "The real Sentence bench beside a fictional manuscript, showing its working wording and the Ask the room invitation before an editor is selected.",
        width: 1440,
        height: 900,
      },
      {
        title: "Continue with a familiar face",
        instruction:
          "The chosen editor replies in Marginalia, with their portrait, name and role above the critique. Open Passage and invitation details to inspect the saved source, unapplied proposal and selection record. A selection score describes the model's choice; it is not a rating of your writing. The conversation leaves your manuscript words untouched.",
        image: "/assets/manual/instrument-room-reply-v1.webp",
        alt: "An anchored Marginalia conversation with the selected editor's portrait and name above a reply clearly marked as a browser transport fixture, beside unchanged manuscript text.",
        width: 1440,
        height: 900,
      },
    ],
  },
  "scene-bench": {
    title: "Read the scene that is on the page",
    summary:
      "Inspect the passage, keep new ideas separate, then prepare a brief you can take to another creative tool.",
    note: "The actual Scene bench component with a fictional passage. This example uses local English cues and a writer-added idea; no model reading or media generation is shown.",
    steps: [
      {
        title: "Inspect the source",
        instruction:
          "Select a passage and open Scene bench. Place, time, light, sound, movement and pressure are paired with exact sentences from your selection. A local cue is a word to inspect; no cue found means the local scan did not identify one. It does not prove the detail is absent.",
        image: `${assets}scene-bench-offline-v1.png`,
        alt: "Scene bench quotes a fictional kitchen passage under place, time, light, sound and movement, with each literal local cue named beside its evidence.",
        width: 1280,
        height: 989,
      },
      {
        title: "Keep an idea beside the source",
        instruction:
          "Add a detail you want to try, such as a bell beyond the doorway. The idea stays on this device with this exact passage and has Remove and Undo controls. Prepare an image, sound or motion brief to copy the original passage and your separately labelled additions. Preparing the brief sends nothing and does not generate media.",
        image: `${assets}scene-bench-brief-v1.png`,
        alt: "A proposed bell is saved as a writer-added sound idea. The prepared sound brief separates the exact manuscript passage from proposed additions and explains that no media service is connected.",
        width: 1280,
        height: 989,
      },
    ],
  },
} satisfies ManualGuides;
