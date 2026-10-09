import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/instruments/";

export const WRITING_INSTRUMENT_GUIDES = {
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
