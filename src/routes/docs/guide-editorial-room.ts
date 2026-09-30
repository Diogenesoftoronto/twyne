import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/manual/editorial/";
const stagedReading =
  "Illustrated with a sample draft and staged editorial feedback.";

export const EDITORIAL_GUIDES = {
  room: {
    title: "Shape the room that reads your draft",
    summary:
      "Give each editor a job, set how far they may edit, and choose the models behind the room's work.",
    note: "Sample editor and model configuration. No model connection is shown.",
    steps: [
      {
        title: "Set each editor's remit",
        instruction:
          "Open Room of Editors from the drawer, or Edit cast in the board's Cast tab. Choose comments, sentence, or paragraph for each editor; click may propose to block their proposed edits. Use Edit to revise an editor and the arrows to change the order.",
        image: `${assets}room-assistance.webp`,
        alt: "Room of Editors management page with per-editor comments, sentence and paragraph controls, may propose buttons, and an editor's Edit and Remove actions.",
        width: 872,
        height: 748,
      },
      {
        title: "Create an editor with a specific perspective",
        instruction:
          "Click New editor. Give them a name, role, voice description and focus; use backstory, editorial doctrine and voiceprint to make their approach concrete. Add sample lines and a colour, then click Create. Cancel leaves the cast as it was.",
        image: `${assets}room-new-editor.webp`,
        alt: "Actual New editor form filled with a sample research editor, The Route Reader, including focus, doctrine, voice, sample lines, colour swatches and Create and Cancel buttons.",
        width: 848,
        height: 840,
      },
      {
        title: "Choose the model for the job",
        instruction:
          "In Settings, enable advanced configuration and configure a provider to reveal Per-Feature Models. Expand Read My Draft (room notes), then choose a provider and model. Temperature and Max tokens tune that feature. Reply Thread, rewrites and full analysis have separate rows; Reset to defaults removes an override.",
        image: `${assets}room-model-routing.webp`,
        alt: "Per-Feature Models settings with Read My Draft expanded to show provider, model, temperature, max tokens and Reset to defaults, followed by separate Reply Thread, rewrite and analysis rows.",
        width: 872,
        height: 840,
      },
    ],
  },
  rubric: {
    title: "Turn a grade into a revision",
    summary:
      "Read the reason behind a mark, adjust your criteria, and compare editorial readings with local measurements.",
    note: stagedReading,
    steps: [
      {
        title: "Open the mark that needs work",
        instruction:
          "Open the editorial board and choose Rubric, then Criteria. The grade and weakest criterion sit above the marks. Click a criterion, such as Evidence, to reveal its explanation and Try this next move. Grade again requests a fresh reading of the saved draft.",
        image: `${assets}rubric-criteria.webp`,
        alt: "Rubric panel showing a staged B grade, 76 out of 100, Criteria, Editors and Passages tabs, and expanded Evidence feedback with a concrete next move and Grade again.",
        width: 464,
        height: 788,
      },
      {
        title: "Change what counts",
        instruction:
          "Below the criteria, open Change what's graded. Check the criteria you want and adjust how much each counts with the weight controls. Add your own name and description, then click Add. Suggest asks the editors for possible criteria. Weights change your weighted score; new criteria need a fresh reading.",
        image: `${assets}rubric-configure.webp`,
        alt: "Rubric configuration with enabled criterion checkboxes, weight steppers, a sample Sense of place criterion, and Add and Suggest controls beneath the saved grade.",
        width: 464,
        height: 788,
      },
      {
        title: "Compare the readings",
        instruction:
          "Choose Editors for the individual rationales behind a room reading. Criteria returns to the marks; Passages opens the saved-draft review view. A quick check can have no editor opinions yet: use Ask the editors in that view to request a separate room reading.",
        image: `${assets}rubric-readings.webp`,
        alt: "The Editors tab of the rubric with two staged editor rationales, while Criteria, Passages, Grade again and Full report remain available.",
        width: 464,
        height: 788,
      },
      {
        title: "Read what was counted locally",
        instruction:
          "Choose Full report and find What the rubric counted. Inspect length, structure, pacing, evidence, vocabulary and paragraph shape alongside the word, paragraph, sentence and citation counts. These measurements help you interpret the reading; they cannot establish whether a claim is true.",
        image: `${assets}rubric-static-features.webp`,
        alt: "Static Features section of the actual Galley Proof report, with six feature measurements, manuscript counts and local feedback on the sample draft.",
        width: 472,
        height: 448,
      },
    ],
  },
  marginalia: {
    title: "Keep the conversation attached to the passage",
    summary:
      "Open a marked phrase, reply in its thread, invite an editor, and resolve the note when its work is done.",
    note: stagedReading,
    steps: [
      {
        title: "Open the anchored thread",
        instruction:
          "Click the coloured mark beside a passage to open its note. The quoted phrase identifies the anchor. To make a new note, select a passage and choose Add margin, write the note, then Place note. In an existing writer note, type into Reply as the writer.",
        image: `${assets}marginalia-anchor.webp`,
        alt: "A coloured manuscript anchor for the road forgot the sea entirely beside its actual writer-note card, quoted anchor, reply draft, Resolve and Reply controls.",
        width: 760,
        height: 550,
      },
      {
        title: "Keep the reply in the thread",
        instruction:
          "Click Reply. The message appears beneath the original note and the reply field clears, ready for the next turn. Open Marginalia in the editorial board to browse the same pending notes and their replies.",
        image: `${assets}marginalia-reply.webp`,
        alt: "The same anchored note after the actual Reply action, showing the writer's saved response beneath the original note and an empty reply field.",
        width: 760,
        height: 550,
      },
      {
        title: "Invite a particular editor",
        instruction:
          "In the board's Marginalia tab, find the note and choose Ask an editor. Pick the editor whose perspective fits, then Send to editor to request a response in the thread. Cancel closes the picker. The selected scholar here is an example; no request was sent for this illustration.",
        image: `${assets}marginalia-ask-editor.webp`,
        alt: "Actual Marginalia board thread with Ask an editor open, Professeur Athenæum selected, and Send to editor and Cancel visible.",
        width: 760,
        height: 550,
      },
      {
        title: "Resolve, then reopen if needed",
        instruction:
          "Click Resolve in the anchored note when you have dealt with it. Its status changes to resolved and the thread remains available. Reopen returns it to the pending work without discarding the conversation. Erase removes the note instead.",
        image: `${assets}marginalia-resolve.webp`,
        alt: "The actual writer thread after Resolve, with a green resolved status, its saved reply preserved, and Reopen, Erase and Reply controls.",
        width: 760,
        height: 550,
      },
    ],
  },
  apparatus: {
    title: "Build a bibliography around the draft",
    summary:
      "Recognize references in the manuscript, keep useful sources, and switch their citation format.",
    note: "Illustrated with a sample draft and saved sample references. Detection and citation formatting run locally.",
    steps: [
      {
        title: "Recognize references already in the text",
        instruction:
          "Open The Apparatus from the drawer. Detected in the manuscript lists references such as URLs and author-year citations. Use look up to inspect a reference and Add to bib to keep it. Detection identifies a reference pattern; check the source before relying on it.",
        image: `${assets}apparatus-manuscript.webp`,
        alt: "Actual Apparatus showing two saved sample references, MLA selected, and detected URL and author-year references with look up and Add to bib controls.",
        width: 576,
        height: 490,
      },
      {
        title: "Keep the working bibliography beside the draft",
        instruction:
          "Your bibliography holds sources saved for the active folio. The cited in draft marker connects a saved URL to the manuscript. Choose APA to reformat the entries. Drop removes a source from the bibliography; it does not rewrite the manuscript.",
        image: `${assets}apparatus-apa.webp`,
        alt: "The same actual bibliography reformatted by the APA button, including a cited in draft marker, Drop actions and the detected references below.",
        width: 576,
        height: 490,
      },
      {
        title: "Choose a style and copy the list",
        instruction:
          "Switch between MLA, APA and Chicago above Your bibliography. The saved entries are formatted in the selected style; the detected reference list stays beside them. Click Copy all to copy the formatted bibliography, then check source details before using it in a finished piece.",
        image: `${assets}apparatus-chicago.webp`,
        alt: "The same bibliography with Chicago selected, visibly changed citation text, Copy all, and the unchanged manuscript reference detection list.",
        width: 576,
        height: 490,
      },
    ],
  },
} satisfies ManualGuides;
