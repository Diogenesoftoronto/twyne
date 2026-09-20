import type { Meta, StoryObj } from "storybook-framework-qwik";
import { WorkspacePreview } from "./workspace-preview";

/**
 * The writer's room as a working mock: every board tab, folio, persona, and
 * rail toggle is clickable, all against canned data. The per-tab stories open
 * the room on each board tab the way a visitor would find it.
 */
const meta = {
  title: "Landing/WorkspacePreview",
  component: WorkspacePreview,
  decorators: [
    (Story) => (
      <div class="w-[56rem] max-w-[calc(100vw-2rem)]">
        <div style="aspect-ratio: 16 / 10;">{Story()}</div>
      </div>
    ),
  ],
  argTypes: {
    initialTab: {
      control: "select",
      options: ["personas", "rubric", "comments", "citations", "history"],
    },
    initialFolioId: {
      control: "select",
      options: ["folio-1", "folio-2", "folio-3"],
    },
    drawerOpen: { control: "boolean" },
    panelOpen: { control: "boolean" },
  },
} satisfies Meta<typeof WorkspacePreview>;

export default meta;
type Story = StoryObj<typeof WorkspacePreview>;

/** The full room: drawer, manuscript, and the Cast reading along. */
export const Default: Story = {};

/** The Rubric tab: the B+ grade and its four criteria. */
export const RubricTab: Story = {
  args: { initialTab: "rubric" },
};

/** The Marginalia tab: the cast's notes in the margin. */
export const MarginaliaTab: Story = {
  args: { initialTab: "comments" },
};

/** The Apparatus tab: sources kept where they can be inspected. */
export const ApparatusTab: Story = {
  args: { initialTab: "citations" },
};

/** The Versions tab: the revision history behind the draft. */
export const VersionsTab: Story = {
  args: { initialTab: "history" },
};

/** Folio II open: the manuscript switches to the research notes. */
export const ResearchNotes: Story = {
  args: { initialFolioId: "folio-2" },
};

/** Both rails closed: the manuscript takes the full width. */
export const RailsClosed: Story = {
  args: { drawerOpen: false, panelOpen: false },
};
