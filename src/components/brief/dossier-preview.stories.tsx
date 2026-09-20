import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type {
  DossierAttachment,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../../types";
import { DossierPreview } from "./dossier-preview";

const answers: ProjectInterviewAnswers = {
  workingTitle: "Libraries as Civic Infrastructure",
  format: "Magazine feature",
  audience: "Municipal leaders and engaged city residents",
  goal: "Show why the modern library belongs in infrastructure budgets.",
  tone: "Reported, practical, and quietly urgent",
  constraints: "Lead with lived experience; support every funding claim.",
  successSignal: "A reader can name one concrete policy change to support.",
};

const probes: DossierProbe[] = [
  {
    id: "probe-1",
    kind: "choice",
    prompt: "Which case should carry the argument?",
    options: ["Public health", "Workforce access", "Social connection"],
    answer: "Social connection",
    relatesTo: "goal",
  },
  {
    id: "probe-2",
    kind: "scale",
    prompt: "How forceful should the policy recommendation be?",
    min: 1,
    max: 5,
    minLabel: "Suggestive",
    maxLabel: "Prescriptive",
    relatesTo: "tone",
  },
  {
    id: "probe-3",
    kind: "choice",
    prompt: "Which city should provide the closing example?",
    options: ["Toronto", "Halifax", "Winnipeg"],
    relatesTo: "successSignal",
  },
];

const attachments: DossierAttachment[] = [
  {
    id: "reference-1",
    kind: "link",
    title: "Canadian Urban Libraries Council data",
    url: "https://example.com/library-data",
    why: "Provides the national usage baseline.",
    addedAt: Date.UTC(2026, 7, 31, 13, 0),
  },
];

const meta = {
  title: "Brief/DossierPreview",
  component: DossierPreview,
  decorators: [
    (Story) => <div class="w-[30rem] max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    answers,
    probes,
    attachments,
    mode: "first-run",
    existingMaterialWords: 1840,
    onJumpToField$: $(() => {}),
  },
} satisfies Meta<typeof DossierPreview>;

export default meta;
type Story = StoryObj<typeof DossierPreview>;

export const WorkingCopy: Story = {};

export const ActiveField: Story = {
  args: { activeField: "goal" },
};

export const Refine: Story = {
  args: { mode: "refine", headline: "Second edition" },
};

export const DraftAligned: Story = {
  args: {
    draftReview: { observations: [], provider: "storybook" },
    onReadDraft$: $(() => {}),
    onApplyObservation$: $(() => {}),
    onDismissObservation$: $(() => {}),
  },
};

export const DraftDrift: Story = {
  args: {
    draftReview: {
      observations: [
        {
          field: "audience",
          current: answers.audience,
          suggested: "Provincial funders weighing capital grants",
          reason:
            "The manuscript now argues about capital budgets, which speaks past municipal leaders.",
        },
      ],
      provider: "storybook",
    },
    onReadDraft$: $(() => {}),
    onApplyObservation$: $(() => {}),
    onDismissObservation$: $(() => {}),
  },
};

export const ReviewError: Story = {
  args: {
    draftReviewError: "The draft could not be read. Try again shortly.",
    onReadDraft$: $(() => {}),
  },
};

export const Sparse: Story = {
  args: {
    answers: {
      workingTitle: "",
      format: "",
      audience: "",
      goal: "",
      tone: "",
      constraints: "",
      successSignal: "",
    },
    probes: [],
    attachments: [],
    existingMaterialWords: 0,
  },
};
