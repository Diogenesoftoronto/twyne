import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ILLUMINATED_INITIAL_ARTWORK } from "../../utils/illuminated-initials";

const prose =
  "At the edge of the harbour, the old printing house kept its windows open. The scent of ink drifted into the street, where a reader paused over the first page of a book. Each letter had been placed with care; each line left room for the next thought.";

const InitialManuscript = component$<{ content?: string }>((props) => {
  const mount = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    let disposed = false;
    const mounted: { editor?: import("@tiptap/core").Editor } = {};
    cleanup(() => {
      disposed = true;
      mounted.editor?.destroy();
    });
    const [{ Editor }, { StarterKit }, { IlluminatedInitial }] =
      await Promise.all([
        import("@tiptap/core"),
        import("@tiptap/starter-kit"),
        import("./extensions/illuminated-initial"),
      ]);
    if (disposed || !mount.value) return;
    mounted.editor = new Editor({
      element: mount.value,
      extensions: [StarterKit, IlluminatedInitial],
      content:
        props.content ??
        `<p>${prose}</p><p>The manuscript remains editable. Change its opening letter to try another initial, then undo to restore it.</p>`,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Illuminated manuscript",
          "aria-multiline": "true",
        },
      },
    });
  });
  return (
    <div
      class="paper-sheet"
      style="width: min(48rem, 100%); padding: clamp(1.25rem, 5vw, 3rem);"
    >
      <div class="twyne-editor" ref={mount} />
    </div>
  );
});

const InitialCollection = component$(() => (
  <div class="paper-sheet" style="padding: 2rem; max-width: 70rem;">
    <div style="display: flex; flex-wrap: wrap; gap: 1.5rem;">
      {ILLUMINATED_INITIAL_ARTWORK.map((url) => {
        const name = url.split("/").pop()!.replace(".avif", "");
        const label = name.endsWith("-alt")
          ? `${name[0].toUpperCase()} alternate`
          : name.toUpperCase();
        return (
          <figure key={url} style="margin: 0; width: 8rem; text-align: center;">
            <img
              src={url}
              width={128}
              height={128}
              alt={`Illuminated ${label}`}
              style="object-fit: contain;"
            />
            <figcaption style="margin-top: 0.5rem; font-family: var(--font-mono); font-size: 0.8rem;">
              {label}
            </figcaption>
          </figure>
        );
      })}
    </div>
  </div>
));

export default {
  title: "Editorial/Illuminated initials",
  component: InitialManuscript,
  parameters: { layout: "centered" },
} satisfies Meta<typeof InitialManuscript>;
type Story = StoryObj<typeof InitialManuscript>;
export const Manuscript: Story = {};
export const QuotedOpening: Story = {
  args: {
    content: `<p>“<strong>${prose}</strong>”</p><p>A second paragraph remains ordinary text.</p>`,
  },
};
export const LinkedOpening: Story = {
  args: {
    content: `<p><a href="https://example.com">A printer</a> knows that the first letter invites the reader into the page. The manuscript keeps its links and formatting.</p>`,
  },
};
export const UnicodeOpening: Story = {
  args: {
    content:
      "<p>Écrire, c’est prendre le temps de regarder. Accented letters keep their exact glyph and use the typographic drop cap.</p>",
  },
};
export const FullCollection: Story = { render: () => <InitialCollection /> };
