import {
  $,
  component$,
  noSerialize,
  Slot,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import type { EditorPanelState } from "./editor-state";
import type { ProjectBrief } from "../../types";
import type {
  createTypstSession,
  TypstSessionState,
} from "../../utils/typst/session";
import { buildFolioExportPayload } from "../../utils/folio-export";
import { Icon } from "../ui/icon";
import type { TwyneIconName } from "../../utils/icon-system";
import type { TypstCodeState, TypstSnippet } from "./typst-code-editor";
import styles from "./typst-workspace.css?inline";

type Session = Awaited<ReturnType<typeof createTypstSession>>;
const views = [
  {
    id: "write",
    label: "Write",
    icon: "pen-nib",
    title: "Write and format your manuscript",
  },
  {
    id: "source",
    label: "Source",
    icon: "code-file",
    title: "Edit Typst source",
  },
  {
    id: "proof",
    label: "Proof",
    icon: "book-open",
    title: "Review typeset pages",
  },
] as const;
const inserts: { id: TypstSnippet; label: string; icon: TwyneIconName }[] = [
  { id: "bold", label: "Bold", icon: "text-bold" },
  { id: "italic", label: "Italic", icon: "text-italic" },
  { id: "heading", label: "Heading", icon: "heading" },
  { id: "equation", label: "Equation", icon: "math" },
  { id: "link", label: "Link", icon: "link" },
  { id: "pageBreak", label: "Page break", icon: "page" },
];

export const TypstWorkspace = component$<{
  store: EditorPanelState;
  editor?: NoSerialize<import("@tiptap/core").Editor>;
  readOnly?: boolean;
  folioName: string;
  brief?: ProjectBrief | null;
}>((props) => {
  useStyles$(styles);
  const state = useStore<TypstSessionState>({
    source: "",
    dirty: false,
    conflict: false,
    status: "Preparing typesetter…",
    error: "",
    pages: [],
    pdfUrl: "",
    applying: false,
  });
  const mode = useSignal<"write" | "source" | "proof">("write");
  const split = useSignal(false);
  const wrapping = useSignal(true);
  const zoom = useSignal(100);
  const codeState = useStore<TypstCodeState>({
    line: 1,
    column: 1,
    lines: 1,
    canUndo: false,
    canRedo: false,
  });
  const session = useSignal<NoSerialize<Session>>();
  const code =
    useSignal<
      NoSerialize<
        ReturnType<
          (typeof import("./typst-code-editor"))["mountTypstCodeEditor"]
        >
      >
    >();
  const sourceMount = useSignal<HTMLElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    props.store.typstView = track(() => mode.value);
  });

  // Focus after the source pane has become visible, including recovered drafts.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const activeMode = track(() => mode.value);
    const codeEditor = track(() => code.value);
    if (activeMode !== "source" || !codeEditor) return;
    const frame = requestAnimationFrame(() => codeEditor.focus());
    cleanup(() => cancelAnimationFrame(frame));
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const editor = track(() => props.editor);
    const folioId = track(() => props.store.activeFolioId);
    const readOnly = track(() => props.readOnly);
    if (!editor || !folioId || !sourceMount.value) return;
    let disposed = false;
    let current: Session | undefined;
    let codeEditor:
      | ReturnType<
          (typeof import("./typst-code-editor"))["mountTypstCodeEditor"]
        >
      | undefined;
    cleanup(() => {
      disposed = true;
      current?.destroy();
      codeEditor?.destroy();
      session.value = undefined;
      code.value = undefined;
      props.store.typstSourcePending = false;
      props.store.typstView = "write";
    });
    try {
      const [{ createTypstSession }, { mountTypstCodeEditor }] =
        await Promise.all([
          import("../../utils/typst/session"),
          import("./typst-code-editor"),
        ]);
      if (disposed) return;
      codeEditor = mountTypstCodeEditor(sourceMount.value, "", {
        readOnly: true,
        onChange: (source) => current?.changeSource(source),
        onApply: () => {
          void current?.apply();
        },
        onState: (next) => Object.assign(codeState, next),
      });
      codeEditor.setWrapping(wrapping.value);
      code.value = noSerialize(codeEditor);
      current = await createTypstSession({
        editor,
        folioId,
        readOnly: !!readOnly,
        onState: (next) => {
          if (disposed) return;
          Object.assign(state, next);
          props.store.typstSourcePending = next.dirty || next.applying;
          codeEditor?.setSource(next.source);
          codeEditor?.setReadOnly(!current || !!readOnly || next.applying);
        },
        getPayload: (source) =>
          buildFolioExportPayload({
            folioId,
            folioName: props.folioName,
            brief: props.brief,
            layout: props.store.layout,
            header: props.store.headerText,
            footer: props.store.footerText,
            typstSource: source,
          }),
        onPages: (count) => {
          props.store.pageCount = count;
          props.store.paginationActive = false;
        },
      });
      if (disposed) {
        current.destroy();
        return;
      }
      session.value = noSerialize(current);
      codeEditor.setReadOnly(!!readOnly || state.applying);
      if (state.dirty) mode.value = "source";
    } catch (error) {
      if (!disposed) {
        state.error = String(error);
        state.status = "Typesetter unavailable";
      }
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => JSON.stringify(props.store.layout));
    track(() => props.store.headerText);
    track(() => props.store.footerText);
    session.value?.refreshProof();
  });
  const saveSourceCopy = $(() => {
    const url = URL.createObjectURL(
      new Blob([state.source], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.folioName || "Untitled"}.typ`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return (
    <section class="typst-workspace" aria-label="Manuscript workspace">
      <div class="typst-bar">
        <div class="typst-views" role="group" aria-label="Editor view">
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              class="compositor-tab typst-view"
              title={view.title}
              aria-pressed={mode.value === view.id}
              onClick$={() => {
                mode.value = view.id;
              }}
            >
              <Icon name={view.icon} size={17} />
              {view.label}
            </button>
          ))}
        </div>
        <div class="typst-bar-actions">
          {mode.value !== "proof" && (
            <button
              type="button"
              class="tool-btn typst-tool-btn typst-split-toggle"
              title="Show typeset proof beside the editor"
              aria-label="Show proof"
              aria-pressed={split.value}
              onClick$={() => {
                split.value = !split.value;
              }}
            >
              <Icon name="sidebar-right" size={17} />
              <span class="typst-action-label">Split proof</span>
            </button>
          )}
          {state.pdfUrl && !state.error && (
            <a
              class="tool-btn typst-tool-btn"
              href={state.pdfUrl}
              download={`${props.folioName || "Untitled"}.pdf`}
              title={state.dirty ? "Download draft PDF" : "Download PDF"}
            >
              <Icon name="file-download" size={17} />
              {state.dirty ? "Draft PDF" : "PDF"}
            </a>
          )}
        </div>
      </div>
      <Slot name="writing-tools" />
      {mode.value === "source" && (
        <div
          class="typst-ribbon compositor-ribbon"
          role="toolbar"
          aria-label="Typst source tools"
        >
          <div
            class="compositor-group"
            data-group-label="History"
            role="group"
            aria-label="Source history"
          >
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Undo source edit"
              title="Undo (⌘/Ctrl Z)"
              disabled={
                !!props.readOnly || state.applying || !codeState.canUndo
              }
              onClick$={() => code.value?.command("undo")}
            >
              <Icon name="undo" size={17} />
            </button>
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Redo source edit"
              title="Redo (⌘/Ctrl Shift Z)"
              disabled={
                !!props.readOnly || state.applying || !codeState.canRedo
              }
              onClick$={() => code.value?.command("redo")}
            >
              <Icon name="redo" size={17} />
            </button>
          </div>
          <div
            class="compositor-group"
            data-group-label="Navigate"
            role="group"
            aria-label="Source navigation"
          >
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              disabled={!code.value}
              title="Find and replace (⌘/Ctrl F)"
              onClick$={() => code.value?.command("find")}
            >
              <Icon name="search" size={17} /> Find
            </button>
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              disabled={!code.value}
              title="Go to line (Alt G)"
              onClick$={() => code.value?.command("goToLine")}
            >
              <Icon name="list" size={17} /> Go to line
            </button>
          </div>
          <div
            class="compositor-group"
            data-group-label="Insert"
            role="group"
            aria-label="Insert Typst"
          >
            {inserts.map((item) => (
              <button
                key={item.id}
                type="button"
                class="tool-btn typst-tool-btn"
                aria-label={`Insert ${item.label.toLowerCase()}`}
                title={item.label}
                disabled={!session.value || !!props.readOnly || state.applying}
                onClick$={() => code.value?.insert(item.id)}
              >
                <Icon name={item.icon} size={17} />
              </button>
            ))}
          </div>
          <div
            class="compositor-group"
            data-group-label="Code"
            role="group"
            aria-label="Code tools"
          >
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Toggle comment"
              title="Toggle comment (⌘/Ctrl /)"
              disabled={!session.value || !!props.readOnly || state.applying}
              onClick$={() => code.value?.command("comment")}
            >
              <Icon name="code" size={17} /> Comment
            </button>
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Wrap lines"
              title="Wrap long lines"
              aria-pressed={wrapping.value}
              onClick$={() => {
                wrapping.value = !wrapping.value;
                code.value?.setWrapping(wrapping.value);
              }}
            >
              <Icon name="text-wrap" size={17} /> Wrap
            </button>
          </div>
          <div
            class="compositor-group"
            data-group-label="File"
            role="group"
            aria-label="Source file"
          >
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Save source copy"
              title="Download Typst source (.typ)"
              disabled={!session.value}
              onClick$={saveSourceCopy}
            >
              <Icon name="code-file" size={17} /> Save .typ
            </button>
          </div>
        </div>
      )}
      {mode.value === "proof" && (
        <div class="typst-proof-tools" role="group" aria-label="Proof zoom">
          <span class="typst-pane-title">
            <Icon name="book-open" size={16} /> Typeset proof
          </span>
          <button
            type="button"
            class="tool-btn typst-tool-btn"
            aria-label="Zoom out"
            disabled={zoom.value <= 50}
            onClick$={() => {
              zoom.value = Math.max(50, zoom.value - 25);
            }}
          >
            <Icon name="section-divider" size={16} />
          </button>
          <span class="typst-zoom-value">{zoom.value}%</span>
          <button
            type="button"
            class="tool-btn typst-tool-btn"
            aria-label="Zoom in"
            disabled={zoom.value >= 200}
            onClick$={() => {
              zoom.value = Math.min(200, zoom.value + 25);
            }}
          >
            <Icon name="add" size={16} />
          </button>
          <button
            type="button"
            class="tool-btn typst-tool-btn"
            onClick$={() => {
              zoom.value = 100;
            }}
            title="Fit proof to available width"
          >
            <Icon name="fullscreen" size={16} /> Fit
          </button>
        </div>
      )}
      {state.dirty && (
        <div class="typst-draft-bar">
          <span class="typst-draft-message">
            <Icon name="edit" size={16} /> Source draft{" "}
            <span class="typst-draft-detail">· kept on this device</span>
          </span>
          <div class="typst-draft-actions">
            <button
              type="button"
              class="tool-btn typst-tool-btn"
              aria-label="Discard source changes"
              title="Discard source changes and restore the manuscript source"
              disabled={state.applying}
              onClick$={async () => {
                await session.value?.discard();
              }}
            >
              <Icon name="undo" size={16} /> Discard
            </button>
            <button
              type="button"
              class="tool-btn typst-tool-btn typst-apply"
              aria-label="Apply source"
              title="Apply source to manuscript (⌘/Ctrl Enter)"
              disabled={
                !!props.readOnly ||
                !session.value ||
                state.applying ||
                state.conflict
              }
              onClick$={async () => {
                await session.value?.apply();
              }}
            >
              <Icon name="check" size={16} />
              {state.applying ? "Applying…" : "Apply source"}
            </button>
          </div>
        </div>
      )}
      {(state.conflict || state.error) && (
        <div class="typst-error" role="alert">
          <Icon name="alert-triangle" size={18} />
          <div>
            <strong>
              {state.conflict
                ? "The manuscript has changed"
                : "Check your source"}
            </strong>
            <p>
              {state.conflict
                ? "Save your source copy, then discard these changes to load the latest manuscript."
                : state.error}
            </p>
            {state.conflict && (
              <button
                type="button"
                class="tool-btn typst-tool-btn"
                onClick$={saveSourceCopy}
              >
                <Icon name="code-file" size={16} /> Save source copy
              </button>
            )}
          </div>
        </div>
      )}
      <div class="typst-panes">
        <div class="typst-writing" hidden={mode.value !== "write"}>
          <Slot />
        </div>
        <div class="typst-source" hidden={mode.value !== "source"}>
          <div class="typst-source-heading">
            <span
              class="typst-source-filename"
              title={`${props.folioName || "Untitled"}.typ`}
            >
              <Icon name="code-file" size={15} />
              {props.folioName || "Untitled"}.typ
            </span>
            <span>{props.readOnly ? "Read only" : "Typst"}</span>
          </div>
          <div ref={sourceMount} class="typst-source-editor" />
        </div>
        <div
          class={{ "typst-proof": true, "typst-split": mode.value !== "proof" }}
          hidden={mode.value !== "proof" && !split.value}
          aria-label="Typeset pages"
        >
          {mode.value !== "proof" && (
            <div class="typst-split-heading">
              <Icon name="book-open" size={15} /> Typeset proof
            </div>
          )}
          {!state.pages.length && (
            <div class="typst-proof-empty">
              <Icon name="book-open" size={32} />
              <p>
                {state.error
                  ? "Proof is waiting for valid source."
                  : "Preparing your typeset pages…"}
              </p>
            </div>
          )}
          <div
            class="typst-proof-pages"
            style={
              mode.value === "proof"
                ? {
                    width: `${zoom.value}%`,
                    maxWidth: `${(54 * zoom.value) / 100}rem`,
                  }
                : undefined
            }
          >
            {state.pages.map((page, index) => (
              <figure key={page}>
                <img
                  src={page}
                  width={800}
                  height={1130}
                  alt={`Typeset page ${index + 1}`}
                />
                <figcaption>
                  Page {index + 1} of {state.pages.length}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div class="typst-statusbar">
        <span class="typst-status" role="status" aria-live="polite">
          <Icon
            name={
              state.error || state.conflict
                ? "alert-triangle"
                : state.pages.length
                  ? "file-check"
                  : "page"
            }
            size={14}
          />
          {state.status}
        </span>
        {mode.value === "source" && (
          <span class="typst-cursor" title={`${codeState.lines} lines`}>
            Ln {codeState.line}, Col {codeState.column}
          </span>
        )}
      </div>
    </section>
  );
});
