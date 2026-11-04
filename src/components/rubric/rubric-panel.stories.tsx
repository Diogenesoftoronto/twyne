import { component$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { SPINE_CRITERIA } from "../../types";
import { scoreStaticFeatures } from "../../utils/rubric";
import {
  RubricPanel,
  type RubricPanelPreview,
  type RubricResult,
} from "./rubric-panel";
import {
  fixtureTime,
  ModalCardStage,
  passage,
} from "../editor/modal-card.fixtures";

/** Deliberately simulated marks to inspect the UI, never a model evaluation. */
const quickMark: RubricResult = {
  folioId: "storybook-rubric",
  scoringMethod: "judgement",
  overallScore: 64,
  overallGrade: "C",
  summary:
    "A concrete opening; the argument still needs evidence and a clearer ending.",
  timestamp: fixtureTime,
  judges: [],
  staticScore: scoreStaticFeatures(passage),
  criteria: SPINE_CRITERIA.filter((c) => c.id !== "engagement").map((c, i) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    score: [7, 6, 4, 5, 7, 7, 6, 7, 8, 7][i] ?? 6,
    maxScore: 10,
    feedback:
      c.id === "evidence"
        ? "The claim needs support. Ask the editors for a second opinion."
        : "A simulated criterion reading for this Storybook example.",
  })),
};

const RubricPreview = component$<{ fixture: RubricPanelPreview }>((props) => (
  <ModalCardStage
    status="Simulated grade fixture. No model calls or saved account changes."
    onReset$={() => window.location.reload()}
  >
    <aside
      aria-label="Rubric estimate preview"
      style="width: min(100%, 28rem); height: 48rem; margin-top: 1.5rem; border: 1px solid var(--color-paper-3);"
    >
      <RubricPanel
        activeFolioId="storybook-rubric"
        brief={null}
        preview={props.fixture}
      />
    </aside>
  </ModalCardStage>
));
const meta = {
  title: "Rubric/QuickMark",
  component: RubricPreview,
  parameters: { layout: "fullscreen" },
  args: { fixture: { result: quickMark, section: "marks" } },
} satisfies Meta<typeof RubricPreview>;
export default meta;
type Story = StoryObj<typeof RubricPreview>;

export const EstimatedGrade: Story = {};
export const ChangeCriteria: Story = {
  args: {
    fixture: { result: quickMark, section: "marks", criteriaOpen: true },
  },
};
export const WaitingForEditors: Story = {
  args: { fixture: { result: quickMark, section: "room" } },
};
export const Passages: Story = {
  args: { fixture: { result: quickMark, section: "review" } },
};
export const NoGradeYet: Story = { args: { fixture: { result: null } } };
export const ReadingDraft: Story = {
  args: { fixture: { result: null, isAnalyzing: true } },
};
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
