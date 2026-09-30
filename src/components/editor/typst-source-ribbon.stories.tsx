import {
  component$,
  noSerialize,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { mountTypstCodeEditor, TypstCodeState } from "./typst-code-editor";
import { TypstSourceRibbon } from "./typst-source-ribbon";
import styles from "./typst-workspace.css?inline";

interface SourceStoryProps {
  readOnly: boolean;
}

const SAMPLE_SOURCE = `#set text(size: 12pt)
#set page(margin: 1in)

= The printing house

At the edge of the harbour, the old printing house kept its windows open.
The scent of ink drifted into the street, where a reader paused over the
first page of a book.

Each letter had been placed with care; each line left room for the next thought.
`;

/** Real source editor commands, without typesetting, sync, or persistence. */
const SourceRibbonPreview = component$<SourceStoryProps>((props) => {
  useStyles$(styles);
  const mount = useSignal<HTMLElement>();
  const code =
    useSignal<NoSerialize<ReturnType<typeof mountTypstCodeEditor>>>();
  const source = useSignal(SAMPLE_SOURCE);
  const wrapping = useSignal(true);
  const codeState = useStore<TypstCodeState>({
    line: 1,
    column: 1,
    lines: 1,
    canUndo: false,
    canRedo: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const readOnly = track(() => props.readOnly);
    let disposed = false;
    cleanup(() => {
      disposed = true;
      code.value?.destroy();
      code.value = undefined;
    });
    const { mountTypstCodeEditor } = await import("./typst-code-editor");
    if (disposed || !mount.value) return;
    const editor = mountTypstCodeEditor(mount.value, source.value, {
      readOnly,
      onChange: (next) => {
        source.value = next;
      },
      onApply: () => {},
      onState: (next) => Object.assign(codeState, next),
    });
    editor.setWrapping(wrapping.value);
    code.value = noSerialize(editor);
  });

  return (
    <section
      class="typst-workspace"
      style="min-height: 100dvh; background: var(--color-paper);"
    >
      <header class="typst-source-heading">
        <span class="typst-source-filename">printing-house.typ</span>
        <span>{props.readOnly ? "Read-only source" : "Source"}</span>
      </header>
      <TypstSourceRibbon
        canUndo={codeState.canUndo}
        canRedo={codeState.canRedo}
        codeReady={!!code.value}
        sessionReady={!!code.value}
        readOnly={props.readOnly}
        applying={false}
        wrapping={wrapping.value}
        onCommand$={(command) => code.value?.command(command)}
        onInsert$={(snippet) => code.value?.insert(snippet)}
        onToggleWrap$={() => {
          wrapping.value = !wrapping.value;
          code.value?.setWrapping(wrapping.value);
        }}
        onSaveCopy$={() => {
          const url = URL.createObjectURL(
            new Blob([source.value], { type: "text/plain;charset=utf-8" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "printing-house.typ";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      />
      <div class="typst-source" style="min-height: 24rem;">
        <div
          class="typst-source-editor"
          ref={mount}
          style="min-height: 24rem;"
        />
      </div>
      <footer class="typst-statusbar" role="status">
        <span>
          Line {codeState.line}, column {codeState.column}
        </span>
        <span>{codeState.lines} lines</span>
      </footer>
    </section>
  );
});

const meta = {
  title: "Editor/TypstSourceRibbon",
  component: SourceRibbonPreview,
  parameters: { layout: "fullscreen" },
  args: { readOnly: false },
} satisfies Meta<SourceStoryProps>;

export default meta;
type Story = StoryObj<SourceStoryProps>;

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
};
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
export const SmallPhone: Story = {
  globals: { viewport: { value: "compactPhone", isRotated: false } },
};
export const MobileReadOnly: Story = {
  args: { readOnly: true },
  globals: { viewport: { value: "phone", isRotated: false } },
};
