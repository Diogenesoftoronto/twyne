import type { ManualGuides } from "./manual-guide-types";

/**
 * The worked example throughout the manual: Morgan Vale is revising
 * Salt Roads, a travel essay that reads like a diary and needs a point.
 */
export const AT_THE_DESK_GUIDES = {
  "getting-started": {
    title: "Morgan's first hour with Salt Roads",
    summary:
      "The draft is open, the brief sits beside it, and three marks are waiting in the margin. Here is where everything lives.",
    note: "Illustrated with a sample draft and staged editorial feedback.",
    steps: [
      {
        title: "Keep the brief in sight",
        instruction:
          "The drawer at the upper left holds the dossier Morgan filed for Salt Roads: reader, goal, tone, the lot. Open it when a sentence starts drifting and you want to remember who it was for. Write is the page you type on. Home, directly above it, holds type, heading and list controls. Close the drawer and the page takes the room back.",
        image: "/assets/manual/desk/desk-drawer.webp",
        alt: "The Salt Roads manuscript in Write mode, with the drawer open to its filed dossier and the Home formatting controls above the page.",
        width: 1340,
        height: 800,
      },
      {
        title: "Read a note where it was written",
        instruction:
          "A coloured dot and a soft underline mean an editor has something to say about those exact words. Select either to open the note: it quotes the passage and gives the editor's reasoning. Type a Reply if you want to argue, or Strike once you've dealt with it. The manuscript never moves while you read.",
        image: "/assets/manual/desk/desk-note.webp",
        alt: "Marguerite’s staged Pacing note beside the marked passage, with her editorial role, the quoted passage, a reply field, Strike and Reply controls.",
        width: 1100,
        height: 650,
      },
      {
        title: "Decide on a proposed edit",
        instruction:
          "Some marks carry a replacement, not just an opinion. Select the dot to see Morgan's words beside the editor's, with the reason underneath. Accept & stamp swaps the words in. Strike keeps the original. Closing the card leaves the decision for later, which is a perfectly good decision.",
        image: "/assets/manual/desk/desk-suggestion.webp",
        alt: "A staged proposed replacement beside Salt Roads, showing the current words, the replacement, the editor’s reason, Strike, and Accept & stamp.",
        width: 1100,
        height: 650,
      },
    ],
  },
  dossier: {
    title: "Tell the room what Salt Roads is for",
    summary:
      "Morgan's draft had scenery and no destination. The dossier is where you say who the piece is for and what it should do to them.",
    steps: [
      {
        title: "Give it a working name",
        instruction:
          "Start with a title you can stand to say out loud. It does not have to be final. Next walks you through ten numbered sections, from Working Title and Form through Reader, Intent and Voice to Particulars, Prior Material and References; you can also pick any numeral directly. The working copy on the left fills in as you answer and grades each answer's strength, so you can see where the brief is still soft.",
        image: "/assets/manual/desk/dossier-create.webp",
        alt: "The Coast in Winter working-title form with a live brief-strength strip, graded answers in the working copy, a Particulars summary and ten-section navigation.",
        width: 1100,
        height: 780,
      },
      {
        title: "Say what should change in the reader",
        instruction:
          "Section IV, Intent, asks what the piece should accomplish. Answer with a change, not a topic: 'make the central argument feel inevitable' gives an editor something to test; 'about salt caravans' does not. The Goal box in the working copy updates as you type, and the strength note under it tells you if the answer is still vague. Reader, Voice, Non-Negotiables and Landing work the same way.",
        image: "/assets/manual/desk/dossier-intent.webp",
        alt: "Intent section IV with the harbour essay goal in the field and the working copy, and answer-strength feedback beneath it.",
        width: 1100,
        height: 780,
      },
      {
        title: "Attach material and say why it matters",
        instruction:
          "Morgan's field notes from the harbour are the kind of thing the room should be able to read. Choose Document or Link, give it a title, and write one line about why it belongs. Add to dossier puts it in the working copy. Send to press files the whole brief, references included.",
        image: "/assets/manual/desk/dossier-references.webp",
        alt: "References section X with Document and Link inputs, a saved fictional Harbour field notes link, graded working-copy answers and Send to press.",
        width: 1100,
        height: 780,
      },
      {
        title: "Refile when the piece changes its mind",
        instruction:
          "Halfway through, Morgan realised the tone needed to be drier. Choose Refine dossier at the desk, open the section that changed, and rewrite it. Send to press files a new edition and the editors use it on their next pass. Back to desk leaves the current filed copy in place.",
        image: "/assets/manual/desk/dossier-refine.webp",
        alt: "Voice section V while refining The Coast in Winter, showing the changed tone, live strength feedback, the reviewed count and ten-section navigation.",
        width: 1100,
        height: 780,
      },
    ],
  },
  house: {
    title: "Set a standard once and let the next piece inherit it",
    summary:
      "Salt Roads is the second essay in a series. The House holds what every piece shares, so Morgan stops retyping the same reader into every dossier.",
    steps: [
      {
        title: "Write the House defaults and a Charter",
        instruction:
          "Open House and select the House card in The cabinet. Fill Reader, Aim or Tone with what is true of everything you write here; each new piece inherits them unless it says otherwise. Add a Charter article for a standard you want enforced, and choose Must or Prefer to say how hard.",
        image: "/assets/manual/desk/house-defaults.webp",
        alt: "The House cabinet beside editable Reader, Aim, and Tone defaults, and a Charter article requiring each claim to be grounded in a concrete scene.",
        width: 1052,
        height: 967,
      },
      {
        title: "Give the series its own direction",
        instruction:
          "Select a collection, here Journeys & Returns, to set a tone or reader that only this series needs. Under Folios in this collection, check a folio to move it in. A folio belongs to one collection at a time, so moving Salt Roads here takes it out of wherever it was.",
        image: "/assets/manual/desk/house-collection.webp",
        alt: "Journeys & Returns overrides the House tone, inherits its Charter, and shows membership checkboxes for Salt Roads and The Coast in Winter.",
        width: 1052,
        height: 967,
      },
      {
        title: "See which layer won",
        instruction:
          "Select a folio and scroll to its context. Every field carries a source stamp saying where it came from; crossed-out values show what the folio overrode. What the models read is the merged brief and Charter exactly as the editors receive it, before any tool adds its own instructions. If something surprising is in there, this is where you find out.",
        image: "/assets/manual/desk/house-folio-context.webp",
        alt: "Salt Roads inherits its reader and aim from the House while its own tone overrides collection and House tones; the collection selector, inherited Charter, and merged model-context preview appear below.",
        width: 1052,
        height: 967,
      },
      {
        title: "Trace a change back to its filing",
        instruction:
          "The register lists every change to intent and standards, with its old and new value and where it was filed. Filter by Dossiers, Collections or Charters when you want to know why the editors started asking about something new.",
        image: "/assets/manual/desk/house-register.webp",
        alt: "The register with Everything, Amendments, Dossiers, Charters, and Collections filters, and dated rows showing the source and changed values of dossier and House edits.",
        width: 1052,
        height: 967,
      },
    ],
  },
  flow: {
    title: "Decide when the room goes quiet",
    summary:
      "Morgan writes best in long runs and hates being interrupted mid-sentence. These controls keep the editors in the margin until there is a reason to look up.",
    note: "Illustrated with a sample draft and staged editorial feedback.",
    steps: [
      {
        title: "Choose what runs on its own",
        instruction:
          "Open the editorial board and select Tools. Automatic focus watches your typing pace and hushes the room during a sustained run. Automatic review decides whether the editors read at all; turning it off pauses review and everything that depends on it. Margin tools and Cover lookups have their own switches, so you can keep one without the other.",
        image: "/assets/manual/desk/flow-review-controls.webp",
        alt: "The Tools board shows Automatic review, Margin tools, and Automatic focus on, Cover lookups off, and a link to AI settings.",
        width: 463,
        height: 650,
      },
      {
        title: "Follow a card back to its passage",
        instruction:
          "Cards wait in the margin beside the passage they belong to. Hover or keyboard-focus one and a bracket draws the connection on the page. Select it to open the conversation without the manuscript moving an inch.",
        image: "/assets/manual/desk/flow-margin.webp",
        alt: "Two margin cards beside Salt Roads, with a bracket and line connecting the writer's map-checking note to its marked passage.",
        width: 1140,
        height: 710,
      },
      {
        title: "Ask for silence yourself",
        instruction:
          "When you can feel a paragraph coming, choose Zen in the status bar at the lower right of the manuscript. The drawer and board close and the marks fade from the page. View, above the page, keeps Outline, Shortcuts and Layout within reach. Nothing is deleted; the room is holding its notes until you come back.",
        image: "/assets/manual/desk/flow-manual-focus.webp",
        alt: "The View ribbon shows Outline, Shortcuts and Layout above Salt Roads; the Zen toggle sits in the lower-right status bar.",
        width: 1440,
        height: 850,
      },
      {
        title: "Come back when you're ready",
        instruction:
          "Choose Zen again to let the room back in. Escape leaves a focus the desk entered on its own. Either way the draft stays exactly where you left it, wide on the page with the proposal still marked.",
        image: "/assets/manual/desk/flow-focus-page.webp",
        alt: "Salt Roads in the wide writing-focus layout, with the title, opening initial and proposed wording visible while note marks are hidden.",
        width: 1440,
        height: 680,
      },
    ],
  },
} satisfies ManualGuides;
