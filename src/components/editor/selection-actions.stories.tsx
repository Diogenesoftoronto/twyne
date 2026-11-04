import {
  component$,
  noSerialize,
  useSignal,
  useStore,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import type { Editor } from "@tiptap/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { NotePopover, SelectionActionState } from "./editor-state";
import { SelectionActions } from "./selection-actions";
import { PersonaNotePanel } from "./persona-note-panel";
import {
  copyFixture,
  ModalCardStage,
  passage,
  personaNote,
} from "./modal-card.fixtures";

interface SelectionStoryProps {
  initial: "writing" | "selection" | "note";
  singleWord: boolean;
}

/** A real editable Tiptap range and persona mark; no persistence or AI calls. */
const ManuscriptSelectionPreview = component$<SelectionStoryProps>((props) => {
  const mount = useSignal<HTMLElement>();
  const editor = useSignal<NoSerialize<Editor>>();
  const state = useStore({
    selection: null as SelectionActionState | null,
    note: null as NotePopover | null,
    status:
      "Type in the manuscript, select a passage, or click the red button at the end of its persona mark.",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const initial = track(() => props.initial);
    const singleWord = track(() => props.singleWord);
    const [
      { Editor },
      { StarterKit },
      { PersonaNoteMark },
      { MarkAnchorWidgets },
    ] = await Promise.all([
      import("@tiptap/core"),
      import("@tiptap/starter-kit"),
      import("./extensions/persona-note-mark"),
      import("./extensions/mark-anchor-widgets"),
    ]);
    if (!mount.value) return;
    state.note = null;
    state.selection = null;
    const openNote = (anchor?: HTMLElement) => {
      const mark =
        anchor ??
        mount.value?.querySelector(
          ".twyne-mark-anchor[data-anchor-kind='note']",
        );
      if (!mark) return;
      const rect = mark.getBoundingClientRect();
      state.note = {
        ...copyFixture(personaNote),
        x: Math.max(12, Math.min(rect.right + 24, window.innerWidth - 364)),
        top: Math.max(96, Math.min(rect.top, window.innerHeight - 400)),
        maxH: Math.max(240, window.innerHeight - 120),
      };
      state.selection = null;
      state.status =
        "Persona note for the marked passage. The text remains editable.";
    };
    const instance = new Editor({
      element: mount.value,
      extensions: [StarterKit, PersonaNoteMark, MarkAnchorWidgets],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: passage,
                marks: [
                  {
                    type: "personaNote",
                    attrs: {
                      id: personaNote.id,
                      author: personaNote.author,
                      color: personaNote.color,
                      label: personaNote.label,
                      note: personaNote.note,
                      quote: passage,
                    },
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "At nine each morning, the doors opened to anyone who needed a chair. A student spread her notes beside the atlas. By the window, a man read yesterday’s newspaper.",
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Continue the scene here, or select a few words to try the passage tools.",
              },
            ],
          },
        ],
      },
      editorProps: {
        attributes: {
          "aria-label": "Manuscript",
          role: "textbox",
          "aria-multiline": "true",
          style:
            "min-height: 18rem; outline: none; font: 1.1rem/1.8 var(--font-serif);",
        },
        handleClick: (_view, _pos, event) => {
          const target = event.target as Element;
          if (!target.closest("[data-persona-note-id], .twyne-mark-anchor"))
            state.note = null;
          return false;
        },
      },
      onSelectionUpdate: ({ editor: current }) => {
        const { from, to, empty } = current.state.selection;
        if (empty || state.note) {
          state.selection = null;
          return;
        }
        const start = current.view.coordsAtPos(from);
        const end = current.view.coordsAtPos(to);
        state.selection = {
          from,
          to,
          text: current.state.doc.textBetween(from, to, " "),
          x: Math.max(
            Math.min(300, window.innerWidth / 2),
            Math.min((start.left + end.right) / 2, window.innerWidth - 300),
          ),
          y: Math.max(88, start.top - 12),
          placement: "above",
          error: null,
        };
      },
    });
    // Match the editor shell: the chip opens the card; the text places the caret.
    const host = mount.value;
    const onAnchorClick = (event: MouseEvent) => {
      const chip = (event.target as Element).closest<HTMLElement>(
        ".twyne-mark-anchor[data-anchor-kind='note']",
      );
      if (!chip || chip.dataset.anchorId !== personaNote.id) return;
      event.preventDefault();
      openNote(chip);
    };
    host.addEventListener("click", onAnchorClick);
    editor.value = noSerialize(instance);
    if (initial === "selection")
      instance.commands.setTextSelection({
        from: 1,
        to: singleWord ? 4 : passage.length + 1,
      });
    if (initial === "note") {
      instance.commands.setTextSelection({ from: 1, to: passage.length + 1 });
      openNote();
    }
    instance.commands.focus();
    cleanup(() => {
      host.removeEventListener("click", onAnchorClick);
      instance.destroy();
      editor.value = undefined;
    });
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
          state.note = null;
          state.selection = null;
          editor.value?.commands.setTextSelection({
            from: 1,
            to: props.singleWord ? 4 : passage.length + 1,
          });
          editor.value?.commands.focus();
          state.status = "Marked passage selected. Edits stay in this preview.";
        }}
      >
        <article
          class="twyne-editor paper-sheet"
          style="max-width: 42rem; margin: 4rem 0 0; padding: 2rem;"
        >
          <h1 style="font: 1.75rem/1.3 var(--font-display); margin-bottom: 1.5rem;">
            The public room
          </h1>
          <div ref={mount} />
        </article>
        <SelectionActions
          selection={state.selection}
          onSentenceBench$={() => {
            state.status =
              "Compare a revision requested for the selected passage";
          }}
          onGetSources$={() => {
            state.status = "Find sources requested for the selected passage";
          }}
          onAddMargin$={() => {
            state.status = "Writer comment requested for the selected passage";
          }}
          onSendToPersona$={(_id, name) => {
            state.status = `Reading requested from ${name}. No provider call is made in this preview.`;
          }}
          onHear$={() => {
            state.status = "Read aloud requested for the selected passage";
          }}
          onThreads$={() => {
            state.status = "Threads requested for the selected passage";
          }}
          onTaskDesk$={() => {
            state.status = "Task desk requested for the selected passage";
          }}
          onSceneBench$={() => {
            state.status = "Scene bench requested for the selected passage";
          }}
          onClose$={() => {
            state.selection = null;
          }}
        />
        <PersonaNotePanel
          note={state.note}
          onPin$={() => {
            if (state.note) state.note.pinned = true;
          }}
          onClose$={() => {
            state.note = null;
          }}
          onStrike$={() => {
            state.note = null;
            state.status = "Note dismissed in preview";
          }}
          onReply$={(noteId, text) => {
            if (!state.note || !text.trim()) return;
            state.note.thread.push({
              id: `preview-${state.note.thread.length}`,
              noteId,
              author: "You",
              authorKind: "user",
              text,
              timestamp: Date.now(),
            });
            state.note.draft = "";
          }}
        />
      </ModalCardStage>
    </div>
  );
});

const meta = {
  title: "Editor/SelectionActions",
  component: ManuscriptSelectionPreview,
  parameters: { layout: "fullscreen" },
  args: { initial: "selection", singleWord: false },
} satisfies Meta<typeof ManuscriptSelectionPreview>;
export default meta;
type Story = StoryObj<typeof ManuscriptSelectionPreview>;

export const SelectedPassage: Story = {};
export const SingleWord: Story = { args: { singleWord: true } };
export const Writing: Story = { args: { initial: "writing" } };
export const PersonaNoteAnchor: Story = { args: { initial: "writing" } };
export const PersonaMarkedPassage: Story = { args: { initial: "note" } };
export const MobileSelection: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobilePersonaNote: Story = {
  args: { initial: "note" },
  globals: { viewport: { value: "phone", isRotated: false } },
};
