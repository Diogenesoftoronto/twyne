import type { ManualGuides } from "./manual-guide-types";

const assets = "/assets/manual/editorial/";
const stagedReading =
  "Illustrated with a sample draft and staged editorial feedback.";

export const EDITORIAL_GUIDES = {
  room: {
    title: "Build the room that reads Salt Roads",
    summary:
      "Morgan wants hard questions about the argument and a light hand on the prose. Each editor gets a job and a limit on how much they may change.",
    note: "Sample editor and model configuration. No model connection is shown.",
    steps: [
      {
        title: "Set each editor's remit",
        instruction:
          "Open Room of Editors from the drawer, or Edit cast from the board's Cast tab. For each editor choose comments, sentence or paragraph: that is the largest unit they are allowed to rewrite. Morgan lets M. Le Stylo touch sentences and keeps Mlle. Sceptique to comments, because her job is the argument, not the wording. Select may propose to stop an editor offering edits at all. Edit revises an editor; the arrows change the order they read in.",
        image: `${assets}room-assistance.webp`,
        alt: "Room of Editors management page with per-editor comments, sentence and paragraph controls, may propose buttons, and an editor's Edit and Remove actions.",
        width: 872,
        height: 748,
      },
      {
        title: "Add the editor the piece is missing",
        instruction:
          "Salt Roads is full of routes and distances, and nobody in the room checks them. Select New editor and describe The Route Reader: a name, a role, how they talk and what they look for. Biography, editorial doctrine and voiceprint make the perspective concrete enough to hold. Upload portrait gives them a face, or leave No portrait and they sign with initials. Add sample notes so you can hear them, pick a colour for their marks, and Create. Cancel leaves the cast as it was.",
        image: `${assets}room-new-editor.webp`,
        alt: "New editor form for the fictional Route Reader, including No portrait, Upload portrait, biography, doctrine, voiceprint, sample notes, colour swatches and Create and Cancel.",
        width: 848,
        height: 917,
      },
      {
        title: "Choose the model behind each job",
        instruction:
          "In Preferences, enable advanced configuration and configure a provider; Per-Feature Models appears. Expand Read My Draft, which is what the room uses for its notes, and choose a provider and model. Temperature and Max tokens tune that one feature. Reply Thread, rewrites and full analysis each have their own row, so a cheaper model can answer replies while a careful one reads the whole draft. Reset to defaults removes an override.",
        image: `${assets}room-model-routing.webp`,
        alt: "Per-Feature Models settings with Read My Draft expanded to show provider, model, temperature, max tokens and Reset to defaults, followed by separate Reply Thread, rewrite and analysis rows.",
        width: 872,
        height: 840,
      },
    ],
  },
  rubric: {
    title: "Turn a B into a revision plan",
    summary:
      "The grade is the least useful thing on the galley proof. The reasons underneath it tell Morgan what to do next.",
    note: stagedReading,
    steps: [
      {
        title: "Open the weakest criterion first",
        instruction:
          "Open the editorial board, choose Rubric, then Criteria. The grade and the weakest criterion sit above the marks. Select a criterion, here Evidence, and it unfolds into an explanation and a Try this next move. That sentence is the real product; the letter is just a summary of it. Grade again asks for a fresh reading of the saved draft.",
        image: `${assets}rubric-criteria.webp`,
        alt: "Rubric panel showing a staged B grade, 76 out of 100, Criteria, Editors and Passages tabs, and expanded Evidence feedback with a concrete next move and Grade again.",
        width: 464,
        height: 788,
      },
      {
        title: "Grade what you actually care about",
        instruction:
          "Below the criteria, open Change what's graded. Untick anything that doesn't matter for this piece and use the weight controls to say what matters most. Morgan adds Sense of place, with a sentence describing it, and selects Add. Suggest asks the editors for criteria you might not have thought of. Changing weights re-scores immediately; a new criterion needs a fresh reading.",
        image: `${assets}rubric-configure.webp`,
        alt: "Rubric configuration with enabled criterion checkboxes, weight steppers, a sample Sense of place criterion, and Add and Suggest controls beneath the saved grade.",
        width: 464,
        height: 788,
      },
      {
        title: "Hear the editors disagree",
        instruction:
          "Choose Editors for each editor's own rationale, with their portrait and role above it. When M. Le Stylo and Professeur Athenæum score the same passage differently, the gap between them is usually where the revision is. Criteria returns to the marks; Passages opens the saved-draft review. A quick check may show no editor opinions yet; use Ask the editors there to request a full room reading.",
        image: `${assets}rubric-readings.webp`,
        alt: "The rubric’s Editors tab with portraits, names and roles above two staged readings, with Criteria, Passages and Grade again still available.",
        width: 464,
        height: 845,
      },
      {
        title: "Check the arithmetic",
        instruction:
          "Choose Full report and find What the rubric counted. Length, structure, pacing, evidence, vocabulary and paragraph shape are measured on this device, with word, paragraph, sentence and citation counts beside them. They cost nothing and they never lie, but they also cannot tell whether a claim is true. Use them to sanity-check a reading, not to replace one.",
        image: `${assets}rubric-static-features.webp`,
        alt: "Static Features section of the actual Galley Proof report, with six feature measurements, manuscript counts and local feedback on the sample draft.",
        width: 472,
        height: 448,
      },
    ],
  },
  marginalia: {
    title: "Argue in the margin, not in a separate document",
    summary:
      "Morgan isn't sure 'the road forgot the sea entirely' is too much. The conversation about it stays pinned to those six words.",
    note: stagedReading,
    steps: [
      {
        title: "Open the note at its anchor",
        instruction:
          "Select the coloured mark beside a passage to open its note. The quoted phrase at the top is the anchor; the thread belongs to it. To start a note of your own, select a passage, choose Comment, write it, then Place note. In a note you started, the reply field is already yours.",
        image: `${assets}marginalia-anchor.webp`,
        alt: "A coloured manuscript anchor for the road forgot the sea entirely beside its actual writer-note card, quoted anchor, reply draft, Resolve and Reply controls.",
        width: 900,
        height: 650,
      },
      {
        title: "Keep the thread in one place",
        instruction:
          "Select Reply. The message lands beneath the original note and the field clears for the next turn. Everything about this passage stays here, with the passage. The board's Marginalia tab lists the same pending notes if you'd rather work through them as a queue.",
        image: `${assets}marginalia-reply.webp`,
        alt: "The same anchored note after the actual Reply action, showing the writer's saved response beneath the original note and an empty reply field.",
        width: 900,
        height: 650,
      },
      {
        title: "Bring in the right editor",
        instruction:
          "A question about whether an image is earned is a question for Professeur Athenæum. In the board's Marginalia tab, find the note and choose Ask an editor, pick the editor, then Send to editor. Their reply arrives in the same thread. Cancel closes the picker. The scholar shown here is an example; no request was sent for this illustration.",
        image: `${assets}marginalia-ask-editor.webp`,
        alt: "Actual Marginalia board thread with Ask an editor open, Professeur Athenæum selected, and Send to editor and Cancel visible.",
        width: 760,
        height: 720,
      },
      {
        title: "Resolve it, and reopen it if you were wrong",
        instruction:
          "Select Resolve when the question is settled. The status turns green and the thread stays readable. Reopen puts it back in the pending work with the whole conversation intact. Erase is the only control that actually throws the note away.",
        image: `${assets}marginalia-resolve.webp`,
        alt: "The actual writer thread after Resolve, with a green resolved status, its saved reply preserved, and Reopen, Erase and Reply controls.",
        width: 900,
        height: 650,
      },
    ],
  },
  apparatus: {
    title: "Keep the sources that Salt Roads leans on",
    summary:
      "The essay quotes a 1911 survey and links to a tide table. The Apparatus notices both and keeps them in whichever citation style the editor finally asks for.",
    note: "Illustrated with a sample draft and saved sample references. Detection and citation formatting run locally.",
    steps: [
      {
        title: "Let it find what's already in the text",
        instruction:
          "Open The Apparatus from the drawer. Detected in the manuscript lists the URLs and author-year citations it has spotted in your draft. Use look up to see what a reference points at, and Add to bib to keep it. Detection recognises the shape of a citation, not its truth, so check the source before you depend on it.",
        image: `${assets}apparatus-manuscript.webp`,
        alt: "Actual Apparatus showing two saved sample references, MLA selected, and detected URL and author-year references with look up and Add to bib controls.",
        width: 576,
        height: 490,
      },
      {
        title: "Build the bibliography beside the draft",
        instruction:
          "Your bibliography holds the sources saved for this folio. A cited in draft marker shows which saved link the manuscript actually uses. Choose APA and every entry reformats. Drop removes a source from the list without touching the manuscript.",
        image: `${assets}apparatus-apa.webp`,
        alt: "The same actual bibliography reformatted by the APA button, including a cited in draft marker, Drop actions and the detected references below.",
        width: 576,
        height: 490,
      },
      {
        title: "Switch styles and copy the list",
        instruction:
          "The magazine wants Chicago. Select it above Your bibliography and the entries change in place while the detected list stays put. Copy all puts the formatted bibliography on the clipboard. Read the entries once before they go into a finished piece; a formatter can only format what it was given.",
        image: `${assets}apparatus-chicago.webp`,
        alt: "The same bibliography with Chicago selected, visibly changed citation text, Copy all, and the unchanged manuscript reference detection list.",
        width: 576,
        height: 490,
      },
    ],
  },
} satisfies ManualGuides;
