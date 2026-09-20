import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ConvexProvider } from "../../utils/convex-context";
import {
  WRITING_LENSES,
  type WritingLensFinding,
} from "../../utils/writing-lenses";
import { WritingTools } from "./writing-tools";

const meta = {
  title: "WritingTools/WritingTools",
  component: WritingTools,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <ConvexProvider>{Story()}</ConvexProvider>],
} satisfies Meta<typeof WritingTools>;

export default meta;
type Story = StoryObj<typeof WritingTools>;

/**
 * Full tool. In Storybook there is no active folio in IDB, so this settles
 * on the "Start with a draft" empty state (via a brief loading state).
 * Needs the ConvexProvider decorator: WritingTools reads useConvexClient().
 * Note it also renders Qwik City Links (desk navigation).
 */
export const Default: Story = {};

const exampleFindings: WritingLensFinding[] = [
  {
    id: "reader-2",
    title: "Missing context may block understanding",
    detail:
      "A first-time reader may need more context here. This check cannot see later paragraphs.",
    passage:
      "The grant assumed the branch would stay open late, which the budget no longer allows.",
    kind: "reader",
  },
  {
    id: "reader-3",
    title: "Review: an open question invites reading on",
    detail:
      "The judgement is uncertain. Compare the quoted evidence before deciding.",
    passage: "Who decides what a library is for?",
    needsReview: true,
    kind: "reader",
  },
];

/**
 * Pure catalogue of the 8 lenses — no folio, IDB, or judgement call needed.
 * Useful as docs for what each check explores.
 */
export const LensCatalogue: Story = {
  render: () => (
    <main style="max-width: 70rem; margin: auto; padding: 2rem 1rem;">
      <p class="dept-label">Twyne</p>
      <h1>Writing tools — lens catalogue</h1>
      <p class="muted">
        The same 8 checks offered by the full tool, without needing a draft.
      </p>
      <ul style="display: grid; gap: 1rem; padding: 0; list-style: none; margin-top: 1.5rem;">
        {WRITING_LENSES.map((lens) => (
          <li
            key={lens.id}
            style="border: 1px solid var(--color-paper-3); border-radius: 3px; padding: 1rem; background: var(--color-paper);"
          >
            <h2 style="font-size: 1rem;">{lens.label}</h2>
            <p class="muted" style="margin: 0.25rem 0;">
              {lens.description}
            </p>
            <code style="font-size: 0.8rem;">{lens.id}</code>
          </li>
        ))}
      </ul>
    </main>
  ),
};

/**
 * Shape of a completed check result, rendered without running Jev.
 * Mirrors the findings list in the results column.
 */
export const ExampleFindings: Story = {
  render: () => (
    <main style="max-width: 70rem; margin: auto; padding: 2rem 1rem;">
      <p class="dept-label">Second look</p>
      <h1>Read without the ending</h1>
      <p class="muted">2 of 4 paragraphs in the reviewed draft prefix.</p>
      {exampleFindings.map((finding) => (
        <article
          key={finding.id}
          style="padding: 1.25rem 0; border-bottom: 1px solid var(--color-paper-3);"
        >
          <h3>{finding.title}</h3>
          {finding.needsReview && (
            <p style="font-size: 0.75rem; color: var(--color-ink-light); margin: 0.5rem 0;">
              Tentative · review this in context
            </p>
          )}
          <p>{finding.detail}</p>
          {finding.passage && (
            <blockquote style="margin: 0.75rem 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 2px solid var(--color-paper-3); font-family: var(--font-serif); white-space: pre-wrap;">
              {finding.passage}
            </blockquote>
          )}
        </article>
      ))}
    </main>
  ),
};
