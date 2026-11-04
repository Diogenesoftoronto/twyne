import { component$, useStore, useTask$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { NotePopover } from "./editor-state";
import { PersonaNotePanel } from "./persona-note-panel";
import {
  passage,
  copyFixture,
  fixtureTime,
  ModalCardStage,
  personaNote,
} from "./modal-card.fixtures";

const PersonaNotePreview = component$<{ note: NotePopover }>((props) => {
  const state = useStore({
    note: copyFixture(props.note) as NotePopover | null,
    status: "Local preview. Replies stay in this story.",
  });
  useTask$(({ track }) => {
    state.note = copyFixture(track(() => props.note));
  });
  return (
    <div
      onInput$={(event) => {
        const input = event.target as HTMLTextAreaElement;
        if (input.dataset.threadDraftKind === "note" && state.note)
          state.note.draft = input.value;
      }}
    >
      <ModalCardStage
        status={state.status}
        onReset$={() => {
          state.note = copyFixture(props.note);
          state.status = "Preview reset";
        }}
      >
        <PersonaNotePanel
          note={state.note}
          onPin$={() => {
            if (state.note) state.note.pinned = true;
          }}
          onClose$={() => {
            state.note = null;
            state.status = "Note closed";
          }}
          onStrike$={() => {
            state.note = null;
            state.status = "Note struck";
          }}
          onDismissError$={() => {
            if (state.note) state.note.error = null;
          }}
          onReply$={(noteId, text) => {
            if (!state.note || !text.trim()) return;
            state.note.thread.push({
              id: `preview-${state.note.thread.length}`,
              noteId,
              author: "You",
              authorKind: "user",
              text: text.trim(),
              timestamp: Date.now(),
            });
            state.note.draft = "";
            state.note.error = null;
            state.status =
              "Writer reply added locally. No editor response is generated.";
          }}
        />
      </ModalCardStage>
    </div>
  );
});

/** The draft a story's quotations are checked against, as the editor would answer. */
let storyDraft = "";
if (typeof window !== "undefined")
  window.addEventListener("twyne:request-draft", () =>
    window.dispatchEvent(
      new CustomEvent("twyne:draft-text", { detail: storyDraft }),
    ),
  );

const meta = {
  title: "Editor/PersonaNotePanel",
  component: PersonaNotePreview,
  parameters: { layout: "fullscreen" },
  args: { note: personaNote },
  loaders: [
    async ({ parameters }) => {
      storyDraft = (parameters.draft as string | undefined) ?? "";
      return {};
    },
  ],
} satisfies Meta<typeof PersonaNotePreview>;
export default meta;
type Story = StoryObj<typeof PersonaNotePreview>;

export const Note: Story = {};
export const ReplyDraft: Story = {
  args: {
    note: {
      ...personaNote,
      draft: "I can open with the reader sleeping beside the atlas.",
    },
  },
};
export const Conversation: Story = {
  args: {
    note: {
      ...personaNote,
      thread: [
        {
          id: "writer-1",
          noteId: personaNote.id,
          author: "You",
          authorKind: "user",
          text: "Would a concrete scene make the opening clearer?",
          timestamp: fixtureTime,
        },
        {
          id: "editor-1",
          noteId: personaNote.id,
          author: personaNote.author,
          authorKind: "persona",
          text: "Yes. Let the reader see a person using the room before you argue for it.",
          timestamp: fixtureTime + 60000,
        },
      ],
    },
  },
};
export const WithEvidence: Story = {
  args: {
    note: {
      ...personaNote,
      evidence: {
        passages: [
          "At nine each morning, the doors opened to anyone who needed a chair.",
        ],
        facts: [
          {
            id: "opening_hour",
            label: "opening hour",
            value: "09:00",
            passages: [
              "At nine each morning, the doors opened to anyone who needed a chair.",
            ],
          },
        ],
      },
    },
  },
};
export const WaitingForReply: Story = {
  args: { note: { ...personaNote, replying: true } },
};
export const StreamingReply: Story = {
  args: {
    note: {
      ...personaNote,
      replying: true,
      streamingReply:
        "Start with the chair by the window. A specific reader gives the claim",
    },
  },
};
export const ReplyError: Story = {
  args: {
    note: {
      ...personaNote,
      error: "The reply could not be completed. Your draft is still here.",
      draft: "What should I cut from the opening?",
    },
  },
};
export const InMargin: Story = {
  args: { note: { ...personaNote, margin: "story-margin-slot", width: 300 } },
};
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
export const Warnings: Story = {
  parameters: { draft: passage },
  args: {
    note: {
      ...personaNote,
      note: "‘nobody had to buy anything’ is the claim. Earlier you wrote ‘the doors were never locked’; show us that instead of telling us.",
      evidence: {
        passages: [],
        facts: [
          {
            id: "opening_hour",
            label: "opening hour",
            value: "about nine",
            near: true,
            passages: [passage],
          },
        ],
      },
      error:
        "The editor could not reply. Check your connection and send it again.",
      draft: "What should I cut from the opening?",
    },
  },
};
