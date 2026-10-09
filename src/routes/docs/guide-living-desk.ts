import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/manual/living-desk/";

export const LIVING_DESK_GUIDES = {
  "the-piece": {
    title: "Follow a pattern across the piece",
    summary:
      "Find the passages behind a pattern, try a change, and keep the choices that belong to your voice.",
    note: "An actual local walkthrough with a fictional manuscript. These checks and fixes work without a model; the overall score shown is an estimate.",
    steps: [
      {
        title: "Open The piece",
        instruction:
          "In the Compositor, choose Review, then The piece. The small score beside the manuscript opens it too. The desk brings together shifts in stance, spelling variants, style exceptions and gaps between a name’s appearances.",
        image: `${assets}01-piece-overview.webp`,
        alt: "The piece beside a sample flood memoir, showing an approximate score, a Consistency measure, Stance, Names, Style and Presence lenses, and findings tied to the manuscript.",
        width: 1440,
        height: 900,
      },
      {
        title: "Inspect and preview",
        instruction:
          "Open Editorial ‘we’ in an ‘I’ essay. The flagged passages come first; other plural and singular uses are folded below. Hover or keyboard-focus a proposed fix to preview it on the page. The preview leaves your draft unchanged.",
        image: `${assets}02-preview.webp`,
        alt: "The expanded stance finding shows passages and Make it I controls, with a temporary replacement preview in the sample manuscript.",
        width: 1440,
        height: 900,
      },
      {
        title: "Make a change you can undo",
        instruction:
          "Choose Make it I for one passage, or Make all for the listed fixes. The manuscript and local consistency measure update together. Use your usual Undo shortcut to reverse the change; a batch is one undo step. Uses referring to a real group are left alone.",
        image: `${assets}03-revised.webp`,
        alt: "After applying one proposed fix, the manuscript reads I argue and the stance finding counts two remaining editorial uses of we.",
        width: 1440,
        height: 900,
      },
      {
        title: "Keep an intentional exception",
        instruction:
          "Similar spellings can be different names. If Hollis and Hollins are distinct in your piece, choose Hollis is a different name. That choice stays with this folio on this device. Check these again restores the finding; new, unaccepted occurrences can still be flagged.",
        image: `${assets}04-deliberate.webp`,
        alt: "A naming finding marked as deliberate, with its explanation and Check these again control visible.",
        width: 1440,
        height: 900,
      },
      {
        title: "Trace someone through the sections",
        instruction:
          "Open a presence finding to see which headed sections mention a recurring name. Select a passage to go to it; the Presence lens marks the names in the manuscript. A gap is an invitation to inspect the structure, not a request to insert a character. Press Escape to clear the focus, then again to close the desk.",
        image: `${assets}05-presence.webp`,
        alt: "A section-by-section presence table shows Mara Okafor appearing before and after the waterline section, with related names highlighted in the manuscript.",
        width: 1440,
        height: 900,
      },
    ],
  },
} satisfies ManualGuides;
