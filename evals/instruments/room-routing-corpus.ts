import type { InstrumentRoomContext } from "../../src/utils/instrument-room";

export const ROOM_ROUTING_CORPUS_VERSION = "room-routing-fictional-v1";
export interface RoomRoutingCase {
  id: string;
  context: InstrumentRoomContext;
  /** Authored acceptable choices, not universal truth or measured Jev quality. */
  acceptableEditorIds: string[];
  expectation: string;
}
export const roomRoutingCases: RoomRoutingCase[] = [
  {
    id: "sentence-smallest-cut",
    context: {
      instrument: "sentence",
      key: "fiction:sentence-cut",
      source: "We made a decision to leave in order to find a very quiet room.",
      proposal: "We decided to leave to find a quiet room.",
      question:
        "Which exact phrases drag when this sentence is read aloud, and what is the smallest useful cut?",
      detail:
        "Before: The old map remained. After: We followed the river. Active pane: rewrite. Local cuts are unapplied; meaning has not been verified.",
    },
    acceptableEditorIds: ["editor"],
    expectation:
      "The Copy Chief's stated method covers audible drag, buried verbs and minimal cuts.",
  },
  {
    id: "sentence-causal-premise",
    context: {
      instrument: "sentence",
      key: "fiction:causality",
      source:
        "The new river wall alone saved every house, so the town must build another one.",
      question:
        "What is the strongest reasonable objection to the causal premise this conclusion depends on?",
      detail:
        "Before: Rainfall was lower that spring, and volunteers cleared the drains. Active pane: rewrite. No causal judgement is verified.",
    },
    acceptableEditorIds: ["devil"],
    expectation:
      "The Devil's Advocate tests a load-bearing premise and causal counterexamples.",
  },
  {
    id: "sentence-citation-owed",
    context: {
      instrument: "sentence",
      key: "fiction:source-duty",
      source:
        "Forty percent of the town's wells became unsafe within three days of the flood.",
      question:
        "What source, dates and definitions would this numerical assertion need before publication?",
      detail:
        "This fictional draft has no source attached. Active pane: words. The number is an assertion, not a verified finding.",
    },
    acceptableEditorIds: ["scholar"],
    expectation:
      "The Scholar distinguishes assertion from support and asks for provenance and definitions.",
  },
  {
    id: "sentence-protect-image",
    context: {
      instrument: "sentence",
      key: "fiction:image",
      source:
        "After everyone left, the porch light kept a small yellow place for him.",
      proposal: "After everyone left, the porch light stayed on.",
      question:
        "Which exact phrase has life here, and what should revision protect rather than flatten?",
      detail:
        "Active pane: rewrite. The shorter wording is only an unapplied comparison.",
    },
    acceptableEditorIds: ["angel"],
    expectation:
      "The Patron of Strengths locates a concrete living image and protects it during revision.",
  },
  {
    id: "sentence-unclear-reference",
    context: {
      instrument: "sentence",
      key: "fiction:reference",
      source:
        "She returned it before they closed, but that was not what he had asked for.",
      question:
        "Where does an ordinary reader lose track of this sentence's references?",
      detail:
        "Before: Mara carried a ledger and a borrowed map to the archive. Jules waited beside the shop. Active pane: words. No antecedent has been confirmed.",
    },
    acceptableEditorIds: ["reader", "editor"],
    expectation:
      "The Target Reader can report confusion; the Copy Chief can also identify unclear diction. Both are acceptable contributions.",
  },
  {
    id: "threads-repeated-explanation",
    context: {
      instrument: "threads",
      key: "fiction:repeat",
      source:
        "The ledger held every name we remembered. This was our only trace. The ledger held every name we remembered.",
      proposal:
        "The ledger held every name we remembered. This was our only trace.",
      question:
        "Does the repeated wording slow the paragraph's movement or the reader's attention? Which use would you question?",
      detail:
        "Code indexed an exact literal repeat. The proposed deletion is unapplied; no model has verified its literary purpose.",
    },
    acceptableEditorIds: ["editor", "reader"],
    expectation:
      "The Copy Chief attends to repetition and movement, while the Target Reader can report the reading symptom.",
  },
  {
    id: "threads-source-chronology",
    context: {
      instrument: "threads",
      key: "fiction:chronology",
      source:
        "The council minutes date the evacuation order to 12 May. Mara's diary records receiving it on 10 May.",
      question:
        "What provenance or chronology needs checking before these accounts are treated as the same event?",
      detail:
        "These are exact code-proposed sentence spans. Their relationship and dates have not been verified.",
    },
    acceptableEditorIds: ["scholar"],
    expectation:
      "The Scholar's method includes provenance, chronology and limits of documentary evidence.",
  },
  {
    id: "scene-follow-the-action",
    context: {
      instrument: "scene",
      key: "fiction:scene-action",
      source:
        "Jules was under the arch. Mara lifted the ledger. A door slammed behind the bridge. She called from the upstairs room.",
      question:
        "As a first-time reader, where do you lose the scene's geography or the sequence of action?",
      detail:
        "Local cue inventory found an arch, bridge and room. It did not establish where the characters are or confirm who called.",
    },
    acceptableEditorIds: ["reader"],
    expectation:
      "The Target Reader reports where comprehension fails in sequence, without asserting a new geography.",
  },
  {
    id: "scene-preserve-atmosphere",
    context: {
      instrument: "scene",
      key: "fiction:scene-strength",
      source:
        "The lamp's narrow circle left the rest of the room to the rain. Mara held the unopened ledger inside that light.",
      proposal: "The room was rainy and dim. Mara held the unopened ledger.",
      question:
        "Which concrete image gives this scene its atmosphere, and what should survive a revision?",
      detail:
        "The proposed plain wording is unapplied. The local light cue is source evidence, not a quality judgement.",
    },
    acceptableEditorIds: ["angel", "editor"],
    expectation:
      "The Patron of Strengths protects the scene's live image; a careful Copy Chief may also protect the phrase while judging the cut.",
  },
  {
    id: "scene-no-editorial-question",
    context: {
      instrument: "scene",
      key: "fiction:no-contribution",
      source: "Mara opened the window and listened to the rain.",
      proposal: "Mara opened the window and listened to the rain.",
      question:
        "No editorial question is open. The writer asks only to play this already-approved line aloud. Is any editorial contribution needed now?",
      detail:
        "The writer explicitly declines further critique and revisions. This is a playback request, not an invitation to invent a writing problem.",
    },
    acceptableEditorIds: ["none"],
    expectation:
      "An explicit no-contribution outcome should respect the absence of an editorial question. Playback is handled by code.",
  },
];
