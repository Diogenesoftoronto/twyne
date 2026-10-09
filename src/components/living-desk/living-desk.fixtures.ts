import {
  EMPTY_LIVING_DESK,
  type LivingDeskSnapshot,
  type Occurrence,
} from "../../utils/living-desk-contract";

export const FLOOD_MEMOIR = [
  {
    title: "The warning",
    paragraphs: [
      "I was nine the spring the river came up through Hollins. We kids were sent to the church hall, where Mara Okafor counted us at the door. I remember her pencil more than the water.",
      "We would argue that the archive was never neutral. I spent two winters in it, and the warnings are filed in the order they were answered, not the order they were sent.",
    ],
  },
  {
    title: "The town",
    paragraphs: [
      "As we'll see, the order matters. Hollins had two sirens and one man who knew how to work both. When he drove north to check the levee, the south siren stayed quiet.",
      "Every family lost something that spring. The ones on the north bank lost the most, and theirs are the accounts the archive kept.",
    ],
  },
  {
    title: "The ledger",
    paragraphs: [
      "Mara kept the church ledger: names, times and what was carried in. Here we must admit the record is thin, but it is honest about being thin.",
      "Our view is that the ledger, not the archive, holds the town's memory. I have read it more times than I can count, and on every page Hollis reads like a smaller town than the one I grew up in.",
    ],
  },
];

let position = 1;
const sections = FLOOD_MEMOIR.map((section, index) => {
  const text = section.paragraphs.join(" ");
  const from = position;
  position += text.length + section.title.length + 6;
  return {
    index,
    title: section.title,
    from,
    to: position - 1,
    words: text.split(/\s+/).length,
  };
});

function occurrence(
  id: string,
  paragraph: number,
  text: string,
  before: string,
  after: string,
  extra: Partial<Occurrence> = {},
): Occurrence {
  const section = Math.floor((paragraph - 1) / 2);
  const offset =
    FLOOD_MEMOIR[section].paragraphs[(paragraph - 1) % 2].indexOf(text);
  const from = sections[section].from + Math.max(0, offset);
  return {
    id,
    paragraph,
    section,
    from,
    to: from + text.length,
    text,
    before,
    after,
    provenance: "rule",
    flagged: true,
    ...extra,
  };
}

const stance = [
  occurrence(
    "stance:we2",
    2,
    "We",
    "",
    "would argue that the archive was never neutral.",
    {
      fix: "I",
      label: "editorial",
      probability: 0.88,
      provenance: "jev",
      note: "the author alone",
    },
  ),
  occurrence("stance:we5", 5, "we", "Here", "must admit the record is thin.", {
    fix: "I",
    label: "editorial",
    probability: 0.93,
    provenance: "jev",
    note: "the author alone",
  }),
  occurrence(
    "stance:our6",
    6,
    "Our",
    "",
    "view is that the ledger holds the town's memory.",
    {
      fix: "My",
      label: "editorial",
      probability: 0.84,
      provenance: "jev",
      note: "the author alone",
    },
  ),
  occurrence(
    "stance:group",
    1,
    "We",
    "the river came up through Hollins.",
    "kids were sent to the church hall.",
    {
      flagged: false,
      label: "group",
      probability: 0.96,
      provenance: "jev",
      note: "a group the author belonged to",
    },
  ),
  occurrence("stance:inclusive", 3, "we'll", "As", "see, the order matters.", {
    flagged: false,
    label: "inclusive",
    probability: 0.91,
    provenance: "jev",
    note: "author and reader",
  }),
  ...[1, 1, 2, 6, 6, 6].map((paragraph, i) =>
    occurrence(`stance:i${i}`, paragraph, "I", "", "remember the town.", {
      flagged: false,
      label: "singular",
      note: "first-person singular",
    }),
  ),
];

export const DESK_FIXTURE: LivingDeskSnapshot = {
  folioId: "flood-memoir",
  open: true,
  lens: "stance",
  focusedFinding: null,
  previewing: null,
  sections,
  judgement: "idle",
  updatedAt: 1000,
  analysisStatus: "ready",
  presence: [
    { entity: "Hollins", variants: ["Hollis"], counts: [1, 1, 1] },
    { entity: "Mara Okafor", variants: ["Mara"], counts: [1, 0, 1] },
  ],
  findings: [
    {
      id: "stance",
      lens: "stance",
      level: "piece",
      title: "Editorial “we” in an “I” essay",
      metric: "3 editorial “we” · 6 “I”",
      count: 3,
      criterion: "consistency",
      impact: 0.27,
      effort: 3,
      state: "open",
      occurrences: stance,
      actions: ["fix-one", "fix-all", "deliberate", "jump"],
      provenance: "jev",
    },
    {
      id: "naming:hollins",
      lens: "naming",
      level: "piece",
      title: "Hollins is spelled two ways",
      metric: "“Hollis” once in ¶6, “Hollins” twice",
      count: 1,
      criterion: "consistency",
      impact: 0.04,
      effort: 1,
      state: "open",
      provenance: "rule",
      actions: ["fix-one", "deliberate", "jump"],
      occurrences: [
        occurrence(
          "naming:hollis",
          6,
          "Hollis",
          "and on every page",
          "reads like a smaller town.",
          {
            fix: "Hollins",
            label: "variant",
            note: "one spelling differs from the other mentions",
          },
        ),
        occurrence(
          "naming:hollins",
          1,
          "Hollins",
          "the river came up through",
          ". We kids were sent to the church hall.",
          { flagged: false, label: "canonical" },
        ),
      ],
    },
    {
      id: "style:serial-comma",
      lens: "style",
      level: "sentence",
      title: "One list drops the serial comma",
      metric: "1 list without a serial comma",
      count: 1,
      criterion: "consistency",
      impact: 0.02,
      effort: 1,
      state: "open",
      provenance: "rule",
      actions: ["fix-one", "deliberate", "jump"],
      occurrences: [
        occurrence(
          "style:comma",
          5,
          "times and",
          "Mara kept the church ledger: names,",
          "what was carried in.",
          {
            fix: "times, and",
            label: "serial comma",
            note: "matches the style sheet",
          },
        ),
      ],
    },
    {
      id: "presence:mara",
      lens: "presence",
      level: "section",
      title: "Mara Okafor drops out of §II",
      metric: "counts the children in §I, keeps the ledger in §III",
      count: 1,
      criterion: "structure",
      impact: null,
      effort: 0,
      state: "open",
      provenance: "rule",
      actions: ["jump"],
      occurrences: [
        occurrence(
          "presence:mara1",
          1,
          "Mara Okafor",
          "where",
          "counted us at the door.",
          { flagged: false, label: "Mara Okafor" },
        ),
        occurrence("presence:mara5", 5, "Mara", "", "kept the church ledger.", {
          flagged: false,
          label: "Mara Okafor",
        }),
      ],
    },
  ],
  score: {
    confirmed: 6.3,
    confirmedAt: 500,
    confirmedLetter: "C+",
    estimate: 6.8,
    editsSinceConfirmed: 5,
    lastChange: null,
    criteria: [
      {
        key: "consistency",
        label: "Consistency",
        value: 7.1,
        delta: 0.5,
        source: "rule",
        scope: "paragraph",
      },
      {
        key: "evidence",
        label: "Evidence",
        value: 5.4,
        delta: 0,
        source: "rule",
        scope: "paragraph",
      },
      {
        key: "integrity",
        label: "Integrity",
        value: 7.2,
        delta: 0.1,
        source: "rule",
        scope: "paragraph",
      },
      {
        key: "structure",
        label: "Organisation",
        value: 7,
        delta: 0,
        source: "review",
        scope: "piece",
      },
    ],
  },
};

export const FOCUSED_FIXTURE: LivingDeskSnapshot = {
  ...DESK_FIXTURE,
  focusedFinding: "stance",
  previewing: "stance:we2",
  score: {
    ...DESK_FIXTURE.score,
    lastChange: {
      criterion: "consistency",
      delta: 0.3,
      source: "¶6",
      at: 1000,
    },
  },
};
export const RESOLVED_FIXTURE: LivingDeskSnapshot = {
  ...DESK_FIXTURE,
  lens: null,
  findings: DESK_FIXTURE.findings.map((f) => ({
    ...f,
    state: "resolved",
    count: 0,
    metric: "No drift remains.",
    occurrences: [],
    impact: 0,
  })),
};
export const EMPTY_FIXTURE: LivingDeskSnapshot = {
  ...DESK_FIXTURE,
  findings: [],
  lens: null,
};
export const SHORT_FIXTURE: LivingDeskSnapshot = {
  ...EMPTY_LIVING_DESK,
  open: true,
  judgement: "idle",
  sections: [{ index: 0, title: "Opening", from: 1, to: 78, words: 16 }],
};
export const LIMITED_FIXTURE: LivingDeskSnapshot = {
  ...SHORT_FIXTURE,
  analysisStatus: "limited",
};
export const STALE_FIXTURE: LivingDeskSnapshot = {
  ...FOCUSED_FIXTURE,
  findings: DESK_FIXTURE.findings.map((f) =>
    f.id !== "stance"
      ? f
      : {
          ...f,
          occurrences: f.occurrences.map((o, i) =>
            i === 0
              ? {
                  ...o,
                  fix: undefined,
                  note: "This changed since it was found",
                }
              : o,
          ),
        },
  ),
};
