import { component$, type PropFunction } from "@qwik.dev/core";
import type { TwyneIconName } from "../../utils/icon-system";
import { Icon } from "../ui/icon";
import type { TypstCodeCommand, TypstSnippet } from "./typst-code-editor";

const inserts: { id: TypstSnippet; label: string; icon: TwyneIconName }[] = [
  { id: "bold", label: "Bold", icon: "text-bold" },
  { id: "italic", label: "Italic", icon: "text-italic" },
  { id: "heading", label: "Heading", icon: "heading" },
  { id: "equation", label: "Equation", icon: "math" },
  { id: "link", label: "Link", icon: "link" },
  { id: "pageBreak", label: "Page break", icon: "page" },
];

export interface TypstSourceRibbonProps {
  canUndo: boolean;
  canRedo: boolean;
  codeReady: boolean;
  sessionReady: boolean;
  readOnly?: boolean;
  applying: boolean;
  wrapping: boolean;
  onCommand$: PropFunction<(command: TypstCodeCommand) => void>;
  onInsert$: PropFunction<(snippet: TypstSnippet) => void>;
  onToggleWrap$: PropFunction<() => void>;
  onSaveCopy$: PropFunction<() => void>;
}

/** Source controls shared by the editor workspace and isolated previews. */
export const TypstSourceRibbon = component$<TypstSourceRibbonProps>((props) => (
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
        disabled={!!props.readOnly || props.applying || !props.canUndo}
        onClick$={() => props.onCommand$("undo")}
      >
        <Icon name="undo" size={17} />
      </button>
      <button
        type="button"
        class="tool-btn typst-tool-btn"
        aria-label="Redo source edit"
        title="Redo (⌘/Ctrl Shift Z)"
        disabled={!!props.readOnly || props.applying || !props.canRedo}
        onClick$={() => props.onCommand$("redo")}
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
        disabled={!props.codeReady}
        title="Find and replace (⌘/Ctrl F)"
        aria-label="Find and replace in source"
        onClick$={() => props.onCommand$("find")}
      >
        <Icon name="search" size={17} />
        <span class="compositor-tool-label">Find</span>
      </button>
      <button
        type="button"
        class="tool-btn typst-tool-btn"
        disabled={!props.codeReady}
        title="Go to line (Alt G)"
        aria-label="Go to line"
        onClick$={() => props.onCommand$("goToLine")}
      >
        <Icon name="list" size={17} />
        <span class="compositor-tool-label">Go to line</span>
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
          disabled={!props.sessionReady || !!props.readOnly || props.applying}
          onClick$={() => props.onInsert$(item.id)}
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
        disabled={!props.sessionReady || !!props.readOnly || props.applying}
        onClick$={() => props.onCommand$("comment")}
      >
        <Icon name="code" size={17} />
        <span class="compositor-tool-label">Comment</span>
      </button>
      <button
        type="button"
        class="tool-btn typst-tool-btn"
        aria-label="Wrap lines"
        title="Wrap long lines"
        aria-pressed={props.wrapping}
        onClick$={props.onToggleWrap$}
      >
        <Icon name="text-wrap" size={17} />
        <span class="compositor-tool-label">Wrap</span>
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
        disabled={!props.sessionReady}
        onClick$={props.onSaveCopy$}
      >
        <Icon name="code-file" size={17} />
        <span class="compositor-tool-label">Save .typ</span>
      </button>
    </div>
  </div>
));
