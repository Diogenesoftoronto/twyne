import { component$, useStore, useTask$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { UserCommentPopover } from "./editor-state";
import { UserCommentPanel } from "./user-comment-panel";
import {
  copyFixture,
  fixtureTime,
  ModalCardStage,
  writerComment,
} from "./modal-card.fixtures";

const WriterNotePreview = component$<{ comment: UserCommentPopover }>(
  (props) => {
    const state = useStore({
      comment: copyFixture(props.comment) as UserCommentPopover | null,
      status: "Local preview. Place, reply to, or resolve a margin note.",
    });
    useTask$(({ track }) => {
      state.comment = copyFixture(track(() => props.comment));
    });
    return (
      <div
        onInput$={(event) => {
          const input = event.target as HTMLTextAreaElement;
          if (input.dataset.threadDraftKind === "comment" && state.comment)
            state.comment.draft = input.value;
        }}
      >
        <ModalCardStage
          status={state.status}
          onReset$={() => {
            state.comment = copyFixture(props.comment);
            state.status = "Preview reset";
          }}
        >
          <UserCommentPanel
            comment={state.comment}
            onClose$={() => {
              state.comment = null;
              state.status = "Margin note closed";
            }}
            onDiscard$={() => {
              state.comment = null;
              state.status = "Draft discarded";
            }}
            onCreate$={() => {
              if (!state.comment?.draft.trim()) return;
              state.comment.text = state.comment.draft.trim();
              state.comment.draft = "";
              state.comment.mode = "thread";
              state.comment.createdAt = Date.now();
              state.status = "Margin note placed locally";
            }}
            onSubmit$={() => {
              if (!state.comment?.draft.trim()) return;
              state.comment.replies.push({
                id: `reply-${state.comment.replies.length}`,
                author: "You",
                authorKind: "user",
                text: state.comment.draft.trim(),
                createdAt: Date.now(),
              });
              state.comment.draft = "";
              state.status = "Writer reply added locally";
            }}
            onToggleResolved$={() => {
              if (!state.comment) return;
              state.comment.resolved = !state.comment.resolved;
              state.status = state.comment.resolved
                ? "Margin note resolved"
                : "Margin note reopened";
            }}
            onDelete$={() => {
              state.comment = null;
              state.status = "Margin note erased";
            }}
          />
        </ModalCardStage>
      </div>
    );
  },
);

const meta = {
  title: "Editor/UserCommentPanel",
  component: WriterNotePreview,
  parameters: { layout: "fullscreen" },
  args: { comment: writerComment },
} satisfies Meta<typeof WriterNotePreview>;
export default meta;
type Story = StoryObj<typeof WriterNotePreview>;

export const OpenNote: Story = {};
export const Compose: Story = {
  args: { comment: { ...writerComment, mode: "compose", text: "" } },
};
export const ComposeDraft: Story = {
  args: {
    comment: {
      ...writerComment,
      mode: "compose",
      text: "",
      draft: "Check the branch opening hours before making this claim.",
    },
  },
};
export const ReplyDraft: Story = {
  args: {
    comment: {
      ...writerComment,
      draft: "I have booked the interview for Thursday.",
    },
  },
};
export const Conversation: Story = {
  args: {
    comment: {
      ...writerComment,
      replies: [
        {
          id: "writer-1",
          author: "You",
          authorKind: "user",
          text: "The north branch closes early on Fridays.",
          createdAt: fixtureTime + 60000,
        },
        {
          id: "editor-1",
          author: "M. Le Stylo",
          authorKind: "persona",
          text: "Then make that qualification visible. **Access** includes hours, not only admission.",
          createdAt: fixtureTime + 120000,
        },
      ],
    },
  },
};
export const Resolved: Story = {
  args: { comment: { ...writerComment, resolved: true } },
};
export const LongQuote: Story = {
  args: {
    comment: {
      ...writerComment,
      quote: Array(6).fill(writerComment.quote).join(" "),
    },
  },
};
export const InMargin: Story = {
  args: {
    comment: { ...writerComment, margin: "story-margin-slot", width: 300 },
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
