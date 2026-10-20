import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/manual/living-desk/";

export const LIVING_DESK_GUIDES = {
  "the-piece": {
    title: "Catch the habits you can't see from inside a paragraph",
    summary:
      "The draft slips from 'I' to 'we' when it loses confidence, and spells one name two ways. The piece finds the pattern; you decide whether it's a problem.",
    note: "An actual local walkthrough with a fictional manuscript. These checks and fixes work without a model; the overall score shown is an estimate.",
    steps: [
      {
        title: "Open The piece",
        instruction:
          "In the Compositor, choose Review, then The piece; the small score beside the manuscript opens it too. It gathers shifts in stance, spelling variants, exceptions to your own style, and gaps between a name's appearances, each tied to the passages that caused it.",
        image: `${assets}01-piece-overview.webp`,
        alt: "The piece beside a sample flood memoir, showing an approximate score, a Consistency measure, Stance, Names, Style and Presence lenses, and findings tied to the manuscript.",
        width: 1440,
        height: 900,
      },
      {
        title: "Look at the evidence, then preview the fix",
        instruction:
          "Open Editorial 'we' in an 'I' essay. The flagged passages come first; the other plural and singular uses are folded underneath so you can see the pattern in full. Hover or keyboard-focus a proposed fix and the page shows it in place. The preview is only a preview; the draft hasn't changed.",
        image: `${assets}02-preview.webp`,
        alt: "The expanded stance finding shows passages and Make it I controls, with a temporary replacement preview in the sample manuscript.",
        width: 1440,
        height: 900,
      },
      {
        title: "Change it, knowing you can change it back",
        instruction:
          "Choose Make it I for one passage, or Make all for the whole list. The manuscript and the consistency measure update together. Your usual Undo reverses it, and a batch is a single undo step. A 'we' that means an actual group of people is left alone.",
        image: `${assets}03-revised.webp`,
        alt: "After applying one proposed fix, the manuscript reads I argue and the stance finding counts two remaining editorial uses of we.",
        width: 1440,
        height: 900,
      },
      {
        title: "Tell it when you meant it",
        instruction:
          "Hollis and Hollins look like a typo and are in fact two people. Choose Hollis is a different name and the finding stands down. That choice stays with this folio on this device. Check these again brings the finding back; a new spelling that matches neither can still be flagged.",
        image: `${assets}04-deliberate.webp`,
        alt: "A naming finding marked as deliberate, with its explanation and Check these again control visible.",
        width: 1440,
        height: 900,
      },
      {
        title: "Follow a person through the sections",
        instruction:
          "Open a presence finding to see which headed sections mention a recurring name. Select a passage to go there; the Presence lens marks the names on the page. A section where someone vanishes is a question about structure, not an instruction to add a cameo. Escape clears the focus; Escape again closes the desk.",
        image: `${assets}05-presence.webp`,
        alt: "A section-by-section presence table shows Mara Okafor appearing before and after the waterline section, with related names highlighted in the manuscript.",
        width: 1440,
        height: 900,
      },
    ],
  },
} satisfies ManualGuides;
