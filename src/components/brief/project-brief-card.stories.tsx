import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { ProjectBrief } from "../../types";
import { ProjectBriefCard } from "./project-brief-card";

const filedBrief: ProjectBrief = {
  answers: {
    workingTitle: "Libraries as Civic Infrastructure",
    format: "Magazine feature",
    audience: "Municipal leaders and engaged city residents",
    goal: "Show why the modern library belongs in infrastructure budgets.",
    tone: "Reported, practical, and quietly urgent",
    constraints: "Lead with lived experience; support every funding claim.",
    successSignal: "A reader can name one concrete policy change to support.",
  },
  attachments: [
    {
      id: "reference-1",
      kind: "link",
      title: "Canadian Urban Libraries Council data",
      url: "https://example.com/library-data",
      why: "Provides the national usage baseline.",
      addedAt: Date.UTC(2026, 7, 31, 13, 0),
    },
    {
      id: "reference-2",
      kind: "document",
      title: "Branch interview notes",
      text: "Selected notes from interviews with patrons and staff.",
      why: "Anchors the opening scene and service examples.",
      addedAt: Date.UTC(2026, 7, 31, 13, 10),
    },
  ],
  probes: [
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
      answer: 4,
      relatesTo: "tone",
    },
  ],
  completedAt: Date.UTC(2026, 7, 31, 14, 0),
  updatedAt: Date.UTC(2026, 7, 31, 14, 30),
};

const partialBrief: ProjectBrief = {
  ...filedBrief,
  answers: {
    ...filedBrief.answers,
    workingTitle: "",
    constraints: "",
  },
  attachments: [],
  probes: [
    filedBrief.probes![0],
    {
      id: "probe-3",
      kind: "choice",
      prompt: "Which city should provide the closing example?",
      options: ["Toronto", "Halifax", "Winnipeg"],
      relatesTo: "successSignal",
    },
  ],
  updatedAt: Date.UTC(2026, 7, 31, 14, 45),
};

const meta = {
  title: "Brief/ProjectBriefCard",
  component: ProjectBriefCard,
  decorators: [
    (Story) => <div class="w-96 max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    brief: null,
    onStartInterview$: $(() => {}),
  },
} satisfies Meta<typeof ProjectBriefCard>;

export default meta;
type Story = StoryObj<typeof ProjectBriefCard>;

export const Empty: Story = {};

export const Filed: Story = {
  args: { brief: filedBrief },
};

export const IncompleteParticulars: Story = {
  args: { brief: partialBrief },
};
