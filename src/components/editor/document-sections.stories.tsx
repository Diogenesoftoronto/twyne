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
import {
  buildDocumentOutline,
  type DocumentOutlineModel,
} from "../../utils/document-outline";
import { DocumentOutline } from "./document-outline";

const SectionsPreview = component$<{ empty: boolean }>((props) => {
  const mount = useSignal<HTMLElement>();
  const editor = useSignal<NoSerialize<Editor>>();
  const state = useStore({
    outline: buildDocumentOutline({
      type: "doc",
      content: [],
    }) as DocumentOutlineModel,
    activeId: "",
    status:
      "Click an outline heading to visit it. Drag a heading handle to reorder its section.",
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const empty = track(() => props.empty);
    const [{ Editor }, { StarterKit }, { SectionReorder }] = await Promise.all([
      import("@tiptap/core"),
      import("@tiptap/starter-kit"),
      import("./extensions/section-reorder"),
    ]);
    if (!mount.value) return;
    const instance = new Editor({
      element: mount.value,
      extensions: [StarterKit, SectionReorder],
      content: empty
        ? "<p>Begin writing here. Apply a heading style to create the first section.</p>"
        : "<h1>The public room</h1><p>The library opens to everyone who needs a chair.</p><h2>Who gets to stay</h2><p>A reader settles beside the atlas. Nobody asks him to buy a coffee.</p><h3>The morning shift</h3><p>By nine, the first visitors are already waiting.</p><h2>What cities should fund</h2><p>A public room needs staff, long hours, and a place on the city budget.</p>",
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Section manuscript",
          "aria-multiline": "true",
          style:
            "min-height: 24rem; outline: none; font: 1.1rem/1.8 var(--font-serif);",
        },
      },
      onUpdate: ({ editor }) => {
        state.outline = buildDocumentOutline(editor.state.doc);
      },
      onSelectionUpdate: ({ editor }) => {
        const heading = buildDocumentOutline(editor.state.doc)
          .flat.filter((h) => h.from <= editor.state.selection.from)
          .at(-1);
        state.activeId = heading?.id ?? "";
      },
    });
    editor.value = noSerialize(instance);
    state.outline = buildDocumentOutline(instance.state.doc);
    cleanup(() => {
      instance.destroy();
      editor.value = undefined;
    });
  });
  return (
    <section style="min-height: 100dvh; padding: 1.5rem; background: var(--color-paper-soft);">
      <p class="mb-4 text-xs text-[var(--color-ink-light)]" role="status">
        {state.status}
      </p>
      <div class="flex flex-wrap items-start gap-6">
        <aside class="w-64 border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3">
          <h2 class="dept-label mb-3">Sections</h2>
          <DocumentOutline
            outline={state.outline}
            activeId={state.activeId}
            editor={editor.value}
          />
          <button
            class="btn-paper mt-4 text-xs"
            disabled={
              state.outline.items.length < 1 || state.outline.flat.length < 3
            }
            onClick$={() => {
              const headings = state.outline.flat.filter((h) => h.level === 2);
              if (headings.length < 2) return;
              editor.value?.commands.moveSection(
                headings[1].id,
                headings[0].id,
                "before",
              );
              state.status =
                "Last section moved before the first. Its content moved with it.";
            }}
          >
            Move last section up
          </button>
        </aside>
        <article
          class="twyne-editor paper-sheet"
          style="flex: 1 1 20rem; max-width: 42rem; padding: 2rem;"
        >
          <div ref={mount} />
        </article>
      </div>
    </section>
  );
});
const meta = {
  title: "Editor/DocumentSections",
  component: SectionsPreview,
  parameters: { layout: "fullscreen" },
  args: { empty: false },
} satisfies Meta<typeof SectionsPreview>;
export default meta;
type Story = StoryObj<typeof SectionsPreview>;
export const NavigateAndReorder: Story = {};
export const NoHeadings: Story = { args: { empty: true } };
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
