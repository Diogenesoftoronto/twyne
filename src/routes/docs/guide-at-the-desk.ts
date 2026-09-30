import type { ManualGuides } from "./manual-guide-types";

export const AT_THE_DESK_GUIDES = {
  "getting-started": {
    title: "Find your way around the desk",
    summary:
      "Keep the dossier beside the manuscript, then handle each editorial mark where it belongs.",
    note: "Illustrated with a sample draft and staged editorial feedback.",
    steps: [
      {
        title: "Write with the dossier beside you",
        instruction:
          "Open the drawer at the upper left to see the current dossier and switch folios. Write is the editable manuscript; Home holds type, heading, and list controls.",
        image: "/assets/manual/desk/desk-drawer.webp",
        alt: "The Salt Roads manuscript in Write mode, with the drawer open to its filed dossier and the Home formatting controls above the page.",
        width: 1340,
        height: 800,
      },
      {
        title: "Open a note at its passage",
        instruction:
          "Select an underlined note or its coloured dot to see the quoted passage and the editor's reasoning. Write a Reply to continue the conversation, or Strike once you've addressed the note.",
        image: "/assets/manual/desk/desk-note.webp",
        alt: "Marguerite's Pacing note beside the marked passage, with a reply field, Strike, and Reply controls.",
        width: 1100,
        height: 650,
      },
      {
        title: "Decide on a proposed edit",
        instruction:
          "Select a proposed edit's dot to compare the current words with the replacement. Accept & stamp applies the change; Strike keeps your original wording. Close the card to leave the decision open.",
        image: "/assets/manual/desk/desk-suggestion.webp",
        alt: "A proposed replacement for progress slowed considerably, showing the existing words, the mules refused the water, the rationale, Strike, and Accept & stamp.",
        width: 1100,
        height: 650,
      },
    ],
  },
  dossier: {
    title: "File the intent, then refine it",
    summary:
      "Give the room a reader, an aim, and useful material to work from. Revisit those choices as the piece develops.",
    steps: [
      {
        title: "Begin with a working title",
        instruction:
          "Name the piece, then use Next or the numbered sections along the foot of the sheet. The working copy on the left shows the dossier taking shape.",
        image: "/assets/manual/desk/dossier-create.webp",
        alt: "The initial dossier form for The Coast in Winter, showing the working-title input, working-copy preview, Form and Conversation choices, Next, and the section navigation.",
        width: 1100,
        height: 780,
      },
      {
        title: "Say what the piece should accomplish",
        instruction:
          "Describe the change you want in the reader. The Goal box updates in the working copy as you type; select another section to set the audience, tone, constraints, or success signal.",
        image: "/assets/manual/desk/dossier-intent.webp",
        alt: "Section IV asks what the piece should accomplish; the harbour essay's answer appears in both the editable field and the highlighted Goal preview.",
        width: 1100,
        height: 780,
      },
      {
        title: "Attach material with a purpose",
        instruction:
          "Choose Document or Link, give it a title, and explain why it matters. Add to dossier adds it to the working copy; Send to press files the answers and attached references.",
        image: "/assets/manual/desk/dossier-references.webp",
        alt: "The References section with Document and Link controls, title and material fields, a reason field, Add to dossier, a sample Harbour field notes reference, and Send to press.",
        width: 1100,
        height: 780,
      },
      {
        title: "Refile a changed brief",
        instruction:
          "Choose Refine dossier at the desk and select the answer to change. Send to press files a new edition; Back to desk leaves the current filed copy in place.",
        image: "/assets/manual/desk/dossier-refine.webp",
        alt: "The refined dossier on its Voice section, with a changed tone in the field and preview, Back to desk, Start over, and the inherited-standards link.",
        width: 1100,
        height: 780,
      },
    ],
  },
  house: {
    title: "Let shared intent flow into each folio",
    summary:
      "Set House defaults, narrow them for a collection, and inspect the context and history of an individual piece.",
    steps: [
      {
        title: "Set the House defaults and Charter",
        instruction:
          "Open House and select the House card in The cabinet. Fill Reader, Aim, or Tone for defaults each piece can inherit. Add a Charter article and choose Must or Prefer for a shared standard.",
        image: "/assets/manual/desk/house-defaults.webp",
        alt: "The House cabinet beside editable Reader, Aim, and Tone defaults, and a Charter article requiring each claim to be grounded in a concrete scene.",
        width: 1052,
        height: 967,
      },
      {
        title: "Give a collection its own direction",
        instruction:
          "Select a collection to set its own tone or other defaults. Check a folio under Folios in this collection to move it into that collection; a folio belongs to one collection at a time.",
        image: "/assets/manual/desk/house-collection.webp",
        alt: "Journeys & Returns overrides the House tone, inherits its Charter, and shows membership checkboxes for Salt Roads and The Coast in Winter.",
        width: 1052,
        height: 967,
      },
      {
        title: "Inspect the folio's inherited context",
        instruction:
          "Select a folio and scroll to its context. Source stamps show the winning layer; crossed-out defaults show what it overrides. What the models read previews the merged dossier and Charter, before tools add their task context.",
        image: "/assets/manual/desk/house-folio-context.webp",
        alt: "Salt Roads inherits its reader and aim from the House while its own tone overrides collection and House tones; the collection selector, inherited Charter, and merged model-context preview appear below.",
        width: 1052,
        height: 967,
      },
      {
        title: "Follow changes in the register",
        instruction:
          "Use The register to follow changes in intent and standards. Filter Dossiers, Collections, or Charters to see where a change was filed and compare its old and new value.",
        image: "/assets/manual/desk/house-register.webp",
        alt: "The register with Everything, Amendments, Dossiers, Charters, and Collections filters, and dated rows showing the source and changed values of dossier and House edits.",
        width: 1052,
        height: 967,
      },
    ],
  },
  flow: {
    title: "Choose when the room becomes quiet",
    summary:
      "Control automatic review and focus, enter focus yourself, and return to the notes connected to your draft.",
    note: "Illustrated with a sample draft and staged editorial feedback.",
    steps: [
      {
        title: "Choose the automatic controls",
        instruction:
          "Open the editorial board and select Tools. Automatic focus follows your writing pace. Turn Automatic review off to pause review and its dependent controls; Margin tools and Cover lookups have their own switches.",
        image: "/assets/manual/desk/flow-review-controls.webp",
        alt: "The Tools board shows Automatic review, Margin tools, and Automatic focus on, Cover lookups off, and a link to AI settings.",
        width: 650,
        height: 410,
      },
      {
        title: "Follow a margin connection",
        instruction:
          "Hover or keyboard-focus a margin card to see its connection to the passage. Select the card to open the note's discussion while the manuscript stays in place.",
        image: "/assets/manual/desk/flow-margin.webp",
        alt: "Two margin cards beside Salt Roads, with a bracket and line connecting the writer's map-checking note to its marked passage.",
        width: 1140,
        height: 710,
      },
      {
        title: "Enter focus yourself",
        instruction:
          "Choose View, then Focus, to quiet the desk immediately. The drawer and editorial board close, and note and comment marks fade while you keep writing.",
        image: "/assets/manual/desk/flow-manual-focus.webp",
        alt: "The compositor's View tab with its Focus button above the annotated manuscript.",
        width: 1140,
        height: 710,
      },
      {
        title: "Return to the room when you're ready",
        instruction:
          "Move the pointer over the toolbar and choose Focus again to return to the room. Escape releases focus entered automatically; your draft stays on the page throughout.",
        image: "/assets/manual/desk/flow-focus-page.webp",
        alt: "Salt Roads in focus mode, with editor notes and writer-comment marks hidden and the proposed edit still visible in the manuscript.",
        width: 840,
        height: 520,
      },
    ],
  },
} satisfies ManualGuides;
