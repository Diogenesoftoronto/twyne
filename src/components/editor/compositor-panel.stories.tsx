import {
  component$,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
} from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { DEFAULT_LAYOUT } from "../../types";
import type { CompositorTab } from "../../utils/compositor-toolbar";
import { CompositorPanel } from "./compositor-panel";
import type { EditorPanelState } from "./editor-state";
import { EMPTY_TABLE_TOOLBAR_SNAPSHOT } from "./table-core";

interface RibbonStoryProps {
  initialTab: CompositorTab;
  openPicker: EditorPanelState["openPicker"];
  layoutOpen: boolean;
}

/** Serializable panel state; stories don't mount persistence or AI providers. */
function ribbonState(): EditorPanelState {
  return {
    meta: {
      title: "The printing house",
      wordCount: 67,
      characterCount: 376,
      readingTime: 1,
    },
    isDragOver: false,
    isAnalysisRunning: false,
    active: { bold: true, isInTable: false },
    showImageInput: false,
    imageUrl: "",
    selectedImage: null,
    imageUploadError: null,
    showMermaidInput: false,
    mermaidSource: "",
    noteInputKind: null,
    noteText: "",
    notes: [],
    hasSelection: true,
    selectionAction: null,
    notePopover: null,
    suggestionPopover: null,
    stampVisible: false,
    lastSavedAt: null,
    userCommentPopover: null,
    canUndo: true,
    canRedo: false,
    activeFolioId: "storybook-ribbon",
    layout: { ...DEFAULT_LAYOUT },
    headerText: "The printing house",
    footerText: "",
    showLayout: false,
    layoutPanelMaxH: 544,
    exportingPdf: false,
    includePersonaCommentsInExport: false,
    showFindReplace: false,
    showGrammar: false,
    showShortcutDialog: false,
    showOutline: false,
    outline: { items: [], flat: [], byId: {}, documentSize: 0 },
    showTableInsertion: false,
    tableToolbar: { ...EMPTY_TABLE_TOOLBAR_SNAPSHOT },
    cellFormat: {
      cellCount: 0,
      backgroundColor: null,
      horizontalAlignment: null,
      verticalAlignment: null,
      borderColor: null,
      borderStyle: null,
      borderWidth: null,
      stylePreset: null,
    },
    slashOpen: false,
    slashQuery: "",
    slashLeft: 0,
    slashTop: 0,
    zenMode: false,
    openPicker: null,
    currentColor: null,
    currentHighlight: "#fbeaa8",
    currentFontFamily: null,
    currentFontSize: null,
    currentLineHeight: null,
    currentSpaceBefore: null,
    currentSpaceAfter: null,
    currentKeepWithNext: false,
    pageCount: 1,
    paginationActive: false,
    toolbarTab: "home",
  };
}

const RibbonPreview = component$<RibbonStoryProps>((props) => {
  const store = useStore(ribbonState());
  const action = useSignal("Try a tab, formatting control, or page layout.");

  useTask$(({ track }) => {
    store.toolbarTab = track(() => props.initialTab);
    store.openPicker = track(() => props.openPicker);
    store.showLayout = track(() => props.layoutOpen);
  });

  // The editor shell normally owns dismissal; keep the same behavior here.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "[data-color-picker], [data-type-popover], [data-layout-popover], [aria-expanded]",
        )
      )
        return;
      store.openPicker = null;
      store.showLayout = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      store.openPicker = null;
      store.showLayout = false;
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    cleanup(() => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    });
  });

  return (
    <section style="min-height: 100dvh; background: var(--color-paper-soft);">
      <CompositorPanel
        store={store}
        onCommand$={(command) => {
          if (command === "undo" || command === "redo") {
            store.canUndo = command === "redo";
            store.canRedo = command === "undo";
          } else if (
            [
              "bold",
              "italic",
              "underline",
              "strike",
              "h1",
              "h2",
              "h3",
            ].includes(command)
          ) {
            store.active[command] = !store.active[command];
          } else if (command === "clearFormatting") {
            store.active = { isInTable: false };
          }
          action.value = `Preview action: ${command}`;
        }}
        onHighlight$={(hex) => {
          store.currentHighlight = hex;
          store.active.highlight = !!hex;
          action.value = hex ? `Highlight: ${hex}` : "Highlight cleared";
        }}
        onTextColor$={(hex) => {
          store.currentColor = hex;
          action.value = hex ? `Text colour: ${hex}` : "Default ink";
        }}
        onFontFamily$={(value) => {
          store.currentFontFamily = value;
        }}
        onFontSize$={(value) => {
          store.currentFontSize = value;
        }}
        onLineHeight$={(value) => {
          store.currentLineHeight = value;
        }}
        onSpaceBefore$={(value) => {
          store.currentSpaceBefore = value;
        }}
        onSpaceAfter$={(value) => {
          store.currentSpaceAfter = value;
        }}
        onKeepWithNext$={(value) => {
          store.currentKeepWithNext = value;
        }}
        onTextCase$={(value) => {
          action.value = `Preview case: ${value}`;
        }}
        onReadAloud$={() => {
          action.value = "Read aloud requested";
        }}
        onLayoutChange$={(value) => {
          store.layout = value;
          action.value = "Page layout updated";
        }}
        onChromeTextChange$={(kind, value) => {
          if (kind === "header") store.headerText = value;
          else store.footerText = value;
        }}
        onSavePdf$={() => {
          action.value = "PDF export requested";
        }}
      />
      <main style="max-width: 42rem; margin: auto; padding: 1.5rem 1rem;">
        <p
          role="status"
          style="font: 0.75rem/1.5 var(--font-sans); color: var(--color-ink-light); margin-bottom: 1.5rem;"
        >
          {action.value}
        </p>
        <article class="paper-sheet" style="padding: 1.5rem;">
          <h1 style="font: 1.5rem/1.25 var(--font-serif); margin-bottom: 1rem;">
            The printing house
          </h1>
          <p
            style={{
              fontFamily: store.currentFontFamily ?? "var(--font-serif)",
              fontSize: store.currentFontSize ?? "1rem",
              lineHeight: store.currentLineHeight ?? "1.65",
              fontWeight: store.active.bold ? "700" : "400",
              fontStyle: store.active.italic ? "italic" : "normal",
              textDecoration:
                [
                  store.active.underline ? "underline" : "",
                  store.active.strike ? "line-through" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || "none",
              color: store.currentColor ?? "var(--color-ink)",
              backgroundColor: store.active.highlight
                ? (store.currentHighlight ?? "transparent")
                : "transparent",
            }}
          >
            At the edge of the harbour, the old printing house kept its windows
            open. The scent of ink drifted into the street, where a reader
            paused over the first page of a book.
          </p>
          <p style="font: 1rem/1.65 var(--font-serif); margin-top: 1rem;">
            Each letter had been placed with care; each line left room for the
            next thought.
          </p>
        </article>
      </main>
    </section>
  );
});

const meta = {
  title: "Editor/CompositorRibbon",
  component: RibbonPreview,
  parameters: { layout: "fullscreen" },
  args: { initialTab: "home", openPicker: null, layoutOpen: false },
  argTypes: {
    initialTab: {
      control: "select",
      options: ["home", "insert", "review", "view"],
    },
    openPicker: {
      control: "select",
      options: [null, "highlight", "textColor", "type"],
    },
    layoutOpen: { control: "boolean" },
  },
} satisfies Meta<RibbonStoryProps>;

export default meta;
type Story = StoryObj<RibbonStoryProps>;
const phone = { viewport: { value: "phone", isRotated: false } };

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
};
export const MobileHome: Story = { globals: phone };
export const MobileInsert: Story = {
  args: { initialTab: "insert" },
  globals: phone,
};
export const MobileReview: Story = {
  args: { initialTab: "review" },
  globals: phone,
};
export const MobileView: Story = {
  args: { initialTab: "view" },
  globals: phone,
};
export const SmallPhone: Story = {
  globals: { viewport: { value: "compactPhone", isRotated: false } },
};
export const MobileColourPicker: Story = {
  args: { openPicker: "textColor" },
  globals: phone,
};
export const MobileTypeOptions: Story = {
  args: { openPicker: "type" },
  globals: phone,
};
export const MobilePageLayout: Story = {
  args: { initialTab: "view", layoutOpen: true },
  globals: phone,
};
