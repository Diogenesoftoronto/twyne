import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/instruments/";

export const WRITING_INSTRUMENT_GUIDES = {
  "instrument-room": {
    title: "Ask the room from inside the sentence",
    summary:
      "Morgan has a rewording on the bench and can't tell if it's better. Instead of leaving the sentence, invite an editor to it.",
    note: "Actual app screenshots with a fictional manuscript and explicitly simulated model responses. They demonstrate the interaction and attribution, not live Jev selection or the quality of a generated critique.",
    steps: [
      {
        title: "Ask without leaving the bench",
        instruction:
          "Sentence bench, each Threads pair and Scene bench carry an Ask the room button. Your judgement model reads the passage, the unapplied wording and the tool's question, then picks the editor most likely to help. It may pick nobody, which is an answer too. You can also name an editor yourself. The original passage and the proposal travel as separate context, so the editor knows which is which.",
        image: "/assets/manual/instrument-room-invitation-v1.webp",
        alt: "The real Sentence bench beside a fictional manuscript, showing its working wording and the Ask the room invitation before an editor is selected.",
        width: 1440,
        height: 900,
      },
      {
        title: "Carry on with a familiar face",
        instruction:
          "The reply arrives in Marginalia with the editor's portrait, name and role above it. Passage and invitation details shows the saved source, the proposal and the record of how the editor was chosen. The selection score describes the model's confidence in its choice of editor; it says nothing about your writing. Nothing in the manuscript changes until you change it.",
        image: "/assets/manual/instrument-room-reply-v1.webp",
        alt: "An anchored Marginalia conversation with the selected editor's portrait and name above a reply clearly marked as a browser transport fixture, beside unchanged manuscript text.",
        width: 1440,
        height: 900,
      },
    ],
  },
  "scene-bench": {
    title: "Take stock of a scene before you fix it",
    summary:
      "The kitchen scene feels thin and Morgan can't say why. Scene bench lists what the passage actually gives the reader, sense by sense.",
    note: "The actual Scene bench component with a fictional passage. This example uses local English cues and a writer-added idea; no model reading or media generation is shown.",
    steps: [
      {
        title: "See what's on the page",
        instruction:
          "Select a passage and open Scene bench. Place, time, light, sound, movement and pressure each quote the exact sentences that supply them, and Find in passage jumps to the quote on the page. A local cue is a word the scan recognised; no cue found means it found nothing, which is a prompt to look, not proof of absence. Here, sound is doing the least work.",
        image: `${assets}scene-bench-offline-v1.png`,
        alt: "The Scene bench dialog quoting the fictional kitchen passage and listing literal evidence for place, time, light, sound, movement and pressure, each with a Find in passage control.",
        width: 1280,
        height: 1600,
      },
      {
        title: "Park an idea next to the evidence",
        instruction:
          "Under Try a detail, add the thing you want to try, a bell beyond the doorway, without putting it in the draft. Save this idea keeps it on this device, attached to this exact passage, with Remove idea beside it. Prepare sound brief, or an image or motion brief, copies the original passage and your labelled additions, kept separate, for use in another tool. Copy brief sends nothing anywhere. Generate picture is a separate, optional panel and stays off until you turn it on.",
        image: `${assets}scene-bench-brief-v1.png`,
        alt: "A saved fictional bell idea above the switched-off picture-generation controls and a prepared local Sound brief with Copy brief; no media was generated.",
        width: 1280,
        height: 1600,
      },
    ],
  },
} satisfies ManualGuides;
