/** Authored fixtures. These labels are editorial expectations, not generated gold. */
export const CORPUS_VERSION = "instruments-2026-10-09-v1";
export const deskCases = [
  {
    id: "stance-editorial",
    text: "I kept my notebook. I recorded my account. We argue for a safer bridge.",
    expected: { stance: 1 },
  },
  {
    id: "stance-family",
    text: "I kept my notebook. I recorded my account. My family and I arrived. We ate together.",
    expected: { stance: 0 },
  },
  {
    id: "stance-reader",
    text: "I kept my notebook. I recorded my account. As we have seen, the bridge needs repair.",
    expected: { stance: 0 },
  },
  {
    id: "stance-dialogue",
    text: "I kept my notebook. I recorded my account. “We argue for a bridge,” Mara said.",
    expected: { stance: 0 },
  },
  {
    id: "naming-variant",
    text: "At Hollins I met Hollins and remembered Hollins. I returned to Hollis.",
    expected: { "naming:hollins": 1 },
  },
  {
    id: "naming-uncertain",
    text: "I met Hollins and Hollis at the gate.",
    expected: { "naming:hollins": 0 },
  },
  {
    id: "spelling-majority",
    text: "The color of the center changed. I preferred its colour.",
    expected: { "style:us-uk": 1 },
  },
  {
    id: "spelling-tie",
    text: "The color and colour mattered.",
    expected: { "style:us-uk": 0 },
  },
  {
    id: "spelling-context",
    text: "The colour, honour and flavour remained. Check the door. Program the machine. License the work. Meter the flow.",
    expected: { "style:us-uk": 0 },
  },
  {
    id: "number-units",
    text: "I saw three birds and two nests on October 3 at 4:30, beside 5 kg of feed costing $9.",
    expected: { "style:numbers": 0 },
  },
  {
    id: "number-majority",
    text: "I saw three birds and two trees with 4 nests.",
    expected: { "style:numbers": 1 },
  },
  {
    id: "style-protected-quote",
    text: "The color of the center changed.",
    protected: "The colour will remain in this quotation.",
    expected: { "style:us-uk": 0 },
  },
] as const;

export const rewriteCases = [
  {
    id: "purpose-phrase",
    text: "Mara waited in order to help the 12 children.",
    expected: "Mara waited to help the 12 children.",
    preserve: ["Mara", "12", "children"],
  },
  {
    id: "negative-purpose",
    text: "I did not leave in order to avoid the rain.",
    expected: "I did not leave to avoid the rain.",
    preserve: ["not", "avoid"],
  },
  {
    id: "cause-phrase",
    text: "The train stopped due to the fact that the bridge flooded.",
    expected: "The train stopped because the bridge flooded.",
    preserve: ["train", "bridge", "flooded"],
  },
  {
    id: "emphasis-choice",
    text: "The quiet street was very beautiful.",
    expected: "The quiet street was beautiful.",
    preserve: ["quiet", "street"],
  },
  {
    id: "unfinished-word",
    text: "The river carr",
    expected: null,
    preserve: [],
  },
  {
    id: "unfinished-clause",
    text: "The river carried the town's",
    expected: null,
    preserve: [],
  },
  {
    id: "clean-sentence",
    text: "Mara closed the window.",
    expected: null,
    preserve: [],
  },
] as const;

export const missions = [
  {
    id: "offline-rewrite",
    task: "With model access disabled, shorten a complete sentence, preview it in context, apply it, then undo it.",
    assertions: [
      "complete alternatives",
      "rule provenance",
      "preview leaves source unchanged",
      "single Undo restores marks and text",
    ],
    automation: "e2e/instruments.e2e.ts",
    liveRequirement: "Browser and Harper WASM; no hosted model",
  },
  {
    id: "deliberate-drift",
    task: "Keep a deliberate editorial we, reload, then add a new editorial we elsewhere.",
    assertions: [
      "saved exception remains",
      "new drift is flagged",
      "group and quoted we are untouched",
    ],
    automation: "e2e/living-desk.e2e.ts",
    liveRequirement: "Browser; no hosted model",
  },
  {
    id: "sentence-position",
    task: "Move a sentence within its paragraph, listen in context, then undo.",
    assertions: [
      "surrounding text is visible",
      "formatting survives",
      "one Undo restores order",
      "voice status is truthful",
    ],
    automation: null,
    liveRequirement: "Browser; available speech provider",
  },
  {
    id: "closed-tab-research",
    task: "Queue research against an approved account resource, close the tab, return, inspect the exact excerpts, and save usefulness feedback.",
    assertions: [
      "server accepted queue before close",
      "result belongs to current account",
      "source excerpts retained",
      "feedback survives reload",
    ],
    automation: null,
    liveRequirement:
      "Signed-in test account, synced folio, approved resource and hosted model credit",
  },
  {
    id: "threads-evidence",
    task: "Inspect a proposed relationship, jump to both passages, then edit one passage before a judgement returns.",
    assertions: [
      "both endpoints are actual spans",
      "no invented offsets",
      "stale judgement is discarded",
      "no-relation result is respected",
    ],
    automation: null,
    liveRequirement: "Browser; optional configured Jev",
  },
  {
    id: "scene-inventions",
    task: "Open an underspecified scene, inspect what is on the page, and identify the details an illustration would need to invent.",
    assertions: [
      "each specified detail links to source text",
      "missing details are separate",
      "generation requires explicit action and cost disclosure",
    ],
    automation: null,
    liveRequirement: "Browser; optional configured media provider",
  },
] as const;
