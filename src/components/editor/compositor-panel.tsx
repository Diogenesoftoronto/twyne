import { component$, type PropFunction } from "@builder.io/qwik";
import type { LayoutSettings } from "../../types";
import { MARGIN_RANGE, resolveMargins, resolvePageSetup } from "../../types";
import {
  COMPOSITOR_TABS,
  moveCompositorTab,
} from "../../utils/compositor-toolbar";
import { COMPOSITOR_ICONS, EDITOR_TOOL_ICONS } from "../../utils/icon-system";
import {
  DEFAULT_MANUSCRIPT_FONT_LABEL,
  DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL,
  FONT_CHOICES,
  FONT_SIZES,
  LINE_SPACINGS,
  PARAGRAPH_SPACINGS,
  type TextCase,
} from "../../utils/typography-options";
import { ColorPicker } from "../ui/color-picker";
import { Icon } from "../ui/icon";
import { SpeechTransport } from "../ui/speech-transport";
import type { EditorPanelState } from "./editor-state";
import { MANUSCRIPT_READING_ID } from "./manuscript-panel";
import { SyncDot } from "./sync-indicator";

interface CompositorPanelProps {
  store: EditorPanelState;
  onCommand$: PropFunction<(command: string) => void>;
  onHighlight$: PropFunction<(hex: string | null) => void>;
  onTextColor$: PropFunction<(hex: string | null) => void>;
  onFontFamily$: PropFunction<(stack: string | null) => void>;
  onFontSize$: PropFunction<(size: string | null) => void>;
  onLineHeight$: PropFunction<(value: string | null) => void>;
  onSpaceBefore$: PropFunction<(points: number | null) => void>;
  onSpaceAfter$: PropFunction<(points: number | null) => void>;
  onKeepWithNext$: PropFunction<(enabled: boolean) => void>;
  onTextCase$: PropFunction<(mode: TextCase) => void>;
  onReadAloud$: PropFunction<() => void>;
  onLayoutChange$: PropFunction<(next: LayoutSettings) => void>;
  onChromeTextChange$: PropFunction<
    (kind: "header" | "footer", value: string) => void
  >;
  onSavePdf$: PropFunction<() => void>;
}

/**
 * The task-oriented compositor ribbon. It owns presentation and panel-local
 * toggles; document commands and persistence are delegated to the editor.
 */
export const CompositorPanel = component$<CompositorPanelProps>((props) => {
  const store = props.store;
  const runCommand = props.onCommand$;
  const applyHighlight = props.onHighlight$;
  const applyTextColor = props.onTextColor$;
  const applyFontFamily = props.onFontFamily$;
  const applyFontSize = props.onFontSize$;
  const applyLineHeight = props.onLineHeight$;
  const applySpaceBefore = props.onSpaceBefore$;
  const applySpaceAfter = props.onSpaceAfter$;
  const applyKeepWithNext = props.onKeepWithNext$;
  const applyTextCase = props.onTextCase$;
  const readAloud = props.onReadAloud$;
  const emitLayout = props.onLayoutChange$;
  const updateChromeText = props.onChromeTextChange$;
  const saveAsPdf = props.onSavePdf$;
  const Sep = () => null;

  return (
    <>
      {/* ── Task-oriented compositor ribbon ───────────── */}
      <div
        class="twyne-toolbar border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
        style="font-family: var(--font-typewriter);"
        role="toolbar"
        aria-label="Document compositor"
        data-active-tab={store.toolbarTab}
      >
        <div class="compositor-tabs" role="tablist" aria-label="Tools">
          <span class="compositor-title">Compositor</span>
          {COMPOSITOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={store.toolbarTab === tab.id}
              aria-controls="compositor-ribbon"
              data-tab-id={tab.id}
              class="compositor-tab"
              onClick$={() => {
                store.toolbarTab = tab.id;
                store.openPicker = null;
                store.showLayout = false;
              }}
              onKeyDown$={(event, element) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                event.preventDefault();
                const next = moveCompositorTab(
                  tab.id,
                  event.key === "ArrowRight" ? 1 : -1,
                );
                store.toolbarTab = next;
                store.openPicker = null;
                store.showLayout = false;
                const target = element.parentElement?.querySelector(
                  `[data-tab-id="${next}"]`,
                );
                if (target instanceof HTMLElement) target.focus();
              }}
            >
              {tab.label}
            </button>
          ))}

          <span class="compositor-tab-spacer" />

          <div class="compositor-quick-actions" aria-label="History">
            <button
              title="Undo (⌘Z)"
              aria-label="Undo"
              disabled={!store.canUndo}
              onClick$={() => runCommand("undo")}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Icon name={COMPOSITOR_ICONS.undo} size={17} />
            </button>
            <button
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
              disabled={!store.canRedo}
              onClick$={() => runCommand("redo")}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Icon name={COMPOSITOR_ICONS.redo} size={17} />
            </button>
            <SyncDot />
          </div>
        </div>

        <div
          id="compositor-ribbon"
          class="compositor-ribbon"
          role="tabpanel"
          aria-label={`${store.toolbarTab} tools`}
        >
          <div
            class="compositor-group"
            data-compositor-tab="home"
            data-group-label="Character"
            role="group"
            aria-label="Character"
          >
            <button
              title="Bold (⌘B)"
              aria-label="Bold"
              aria-pressed={!!store.active.bold}
              onClick$={() => runCommand("bold")}
              class="tool-btn"
            >
              <b style="font-family: var(--font-display);">B</b>
            </button>
            <button
              title="Italic (⌘I)"
              aria-label="Italic"
              aria-pressed={!!store.active.italic}
              onClick$={() => runCommand("italic")}
              class="tool-btn"
            >
              <i style="font-family: var(--font-display);">I</i>
            </button>
            <button
              title="Underline (⌘U)"
              aria-label="Underline"
              aria-pressed={!!store.active.underline}
              onClick$={() => runCommand("underline")}
              class="tool-btn"
            >
              <u style="font-family: var(--font-display);">U</u>
            </button>
            <button
              title="Strikethrough"
              aria-label="Strikethrough"
              aria-pressed={!!store.active.strike}
              onClick$={() => runCommand("strike")}
              class="tool-btn"
            >
              <s style="font-family: var(--font-display);">S</s>
            </button>
            <button
              title="Superscript"
              aria-label="Superscript"
              aria-pressed={!!store.active.superscript}
              onClick$={() => runCommand("superscript")}
              class="tool-btn"
            >
              <span style="font-family: var(--font-display);">
                x<sup>2</sup>
              </span>
            </button>
            <button
              title="Subscript"
              aria-label="Subscript"
              aria-pressed={!!store.active.subscript}
              onClick$={() => runCommand("subscript")}
              class="tool-btn"
            >
              <span style="font-family: var(--font-display);">
                x<sub>2</sub>
              </span>
            </button>

            {/* Highlight: a toggle for the last colour used, plus a caret to
                change it. Splitting the two is what makes multicolor usable —
                Highlight has been configured `multicolor: true` since the
                editor was written, and the toolbar only ever called the bare
                toggle, so the capability shipped unreachable. */}
            <div class="flex items-center relative">
              <button
                title="Highlight"
                aria-label="Highlight"
                aria-pressed={!!store.active.highlight}
                onClick$={() =>
                  store.active.highlight
                    ? applyHighlight(null)
                    : applyHighlight(store.currentHighlight ?? "#fbeaa8")
                }
                class="tool-btn"
              >
                <span
                  style={{
                    background: `linear-gradient(transparent 60%, ${store.currentHighlight ?? "#fbeaa8"} 60%)`,
                  }}
                >
                  Hi
                </span>
              </button>
              <button
                title="Highlight colour"
                aria-label="Choose highlight colour"
                aria-expanded={store.openPicker === "highlight"}
                onClick$={() => {
                  store.openPicker =
                    store.openPicker === "highlight" ? null : "highlight";
                }}
                class="tool-btn px-1"
              >
                ▾
              </button>
              {store.openPicker === "highlight" && (
                <ColorPicker
                  kind="highlight"
                  title="Highlight"
                  value={store.currentHighlight}
                  clearLabel="No highlight"
                  onPick$={(hex) => applyHighlight(hex)}
                  onClear$={() => applyHighlight(null)}
                  onClose$={() => {
                    store.openPicker = null;
                  }}
                />
              )}
            </div>

            {/* Text colour, from the darker palette — every entry clears
                WCAG AA against the manuscript's paper. */}
            <div class="flex items-center relative">
              <button
                title="Text colour"
                aria-label="Text colour"
                aria-expanded={store.openPicker === "textColor"}
                onClick$={() => {
                  store.openPicker =
                    store.openPicker === "textColor" ? null : "textColor";
                }}
                class="tool-btn"
              >
                <span
                  style={{
                    color: store.currentColor ?? "var(--color-ink)",
                    fontFamily: "var(--font-display)",
                    borderBottom: `2px solid ${store.currentColor ?? "var(--color-ink)"}`,
                  }}
                >
                  A
                </span>
              </button>
              {store.openPicker === "textColor" && (
                <ColorPicker
                  kind="text"
                  title="Text colour"
                  value={store.currentColor}
                  clearLabel="Default ink"
                  onPick$={(hex) => applyTextColor(hex)}
                  onClear$={() => applyTextColor(null)}
                  onClose$={() => {
                    store.openPicker = null;
                  }}
                />
              )}
            </div>

            <button
              title="Clear formatting"
              aria-label="Clear formatting"
              onClick$={() => runCommand("clearFormatting")}
              class="tool-btn"
            >
              ⌫ fmt
            </button>
          </div>

          <Sep />

          {/* Font family and point size stay visible, as they do in a
              conventional word processor. Less frequent paragraph controls
              remain in the adjacent advanced panel. */}
          <div
            class="compositor-group relative"
            data-compositor-tab="home"
            data-group-label="Type"
            role="group"
            aria-label="Type"
          >
            <select
              class="compositor-font-select"
              value={store.currentFontFamily ?? ""}
              onChange$={(_, element) =>
                applyFontFamily(element.value === "" ? null : element.value)
              }
              aria-label="Font family"
              title="Font family"
            >
              <option value="">{DEFAULT_MANUSCRIPT_FONT_LABEL}</option>
              {FONT_CHOICES.map((font) => (
                <option key={font.id} value={font.stack}>
                  {font.label}
                </option>
              ))}
            </select>
            <select
              class="compositor-size-select"
              value={store.currentFontSize ?? ""}
              onChange$={(_, element) =>
                applyFontSize(element.value === "" ? null : element.value)
              }
              aria-label="Font size in points"
              title="Font size in points"
            >
              <option value="">{DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL}</option>
              {FONT_SIZES.map((size) => (
                <option key={size.value} value={size.value}>
                  {size.label}
                </option>
              ))}
            </select>
            <button
              title="Advanced type and paragraph options"
              aria-label="Advanced type and paragraph options"
              aria-expanded={store.openPicker === "type"}
              onClick$={() => {
                store.openPicker = store.openPicker === "type" ? null : "type";
              }}
              class="tool-btn"
            >
              More ▾
            </button>
            {store.openPicker === "type" && (
              <div
                data-type-popover
                class="absolute left-0 top-full mt-1 p-3 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg w-60"
                style={{
                  zIndex: "var(--z-dropdown)",
                  borderRadius: "2px",
                  fontFamily: "var(--font-typewriter)",
                }}
                role="dialog"
                aria-label="Advanced type and paragraph options"
              >
                <p class="dept-label mb-1.5">Line spacing</p>
                <div class="flex items-center gap-1 mb-3">
                  {LINE_SPACINGS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick$={() => applyLineHeight(s.value)}
                      class={[
                        "flex-1 text-[0.62rem] py-1 border",
                        {
                          "border-[var(--color-vermilion)]":
                            store.currentLineHeight === s.value,
                          "text-[var(--color-vermilion)]":
                            store.currentLineHeight === s.value,
                          "border-[var(--color-paper-3)]":
                            store.currentLineHeight !== s.value,
                          "text-[var(--color-ink-light)]":
                            store.currentLineHeight !== s.value,
                        },
                      ]}
                      style="border-radius: 1px;"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <p class="dept-label mb-1.5">Paragraph spacing</p>
                <div class="grid grid-cols-2 gap-2 mb-3">
                  <label class="text-[0.62rem] text-[var(--color-ink-light)]">
                    <span class="block mb-1">Before</span>
                    <select
                      class="field-input text-[0.68rem]"
                      value={
                        store.currentSpaceBefore == null
                          ? ""
                          : String(store.currentSpaceBefore)
                      }
                      onChange$={(_, el) =>
                        applySpaceBefore(
                          el.value === "" ? null : Number(el.value),
                        )
                      }
                      aria-label="Space before paragraph"
                    >
                      <option value="">Default</option>
                      {PARAGRAPH_SPACINGS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="text-[0.62rem] text-[var(--color-ink-light)]">
                    <span class="block mb-1">After</span>
                    <select
                      class="field-input text-[0.68rem]"
                      value={
                        store.currentSpaceAfter == null
                          ? ""
                          : String(store.currentSpaceAfter)
                      }
                      onChange$={(_, el) =>
                        applySpaceAfter(
                          el.value === "" ? null : Number(el.value),
                        )
                      }
                      aria-label="Space after paragraph"
                    >
                      <option value="">Default</option>
                      {PARAGRAPH_SPACINGS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label class="compositor-check-row mb-3">
                  <span class="min-w-0">
                    <span class="block text-[0.7rem] text-[var(--color-ink)]">
                      Keep with next
                    </span>
                    <span class="block text-[0.6rem] text-[var(--color-ink-muted)]">
                      {store.active.h1 || store.active.h2 || store.active.h3
                        ? "Always on for headings"
                        : "Prevent a page break after this paragraph"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    class="compositor-checkbox"
                    checked={store.currentKeepWithNext}
                    disabled={
                      !!store.active.h1 ||
                      !!store.active.h2 ||
                      !!store.active.h3
                    }
                    onChange$={(_, el) => applyKeepWithNext(el.checked)}
                    aria-label="Keep paragraph with next"
                  />
                </label>

                <p class="dept-label mb-1.5">Case</p>
                <div class="flex items-center gap-1">
                  {(
                    [
                      ["upper", "AA"],
                      ["lower", "aa"],
                      ["title", "Aa"],
                      ["sentence", "A."],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!store.hasSelection}
                      aria-label={`${mode} case`}
                      title={`${mode} case${store.hasSelection ? "" : " — select some text first"}`}
                      onClick$={() => applyTextCase(mode as TextCase)}
                      class="flex-1 text-[0.65rem] py-1 border border-[var(--color-paper-3)] text-[var(--color-ink-light)] disabled:opacity-30 disabled:cursor-not-allowed"
                      style="border-radius: 1px;"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Sep />

          <div
            class="compositor-group"
            data-compositor-tab="home"
            data-group-label="Styles"
            role="group"
            aria-label="Styles"
          >
            <button
              title="Heading 1"
              aria-label="Heading 1"
              aria-pressed={!!store.active.h1}
              onClick$={() => runCommand("h1")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₁
            </button>
            <button
              title="Heading 2"
              aria-label="Heading 2"
              aria-pressed={!!store.active.h2}
              onClick$={() => runCommand("h2")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₂
            </button>
            <button
              title="Heading 3"
              aria-label="Heading 3"
              aria-pressed={!!store.active.h3}
              onClick$={() => runCommand("h3")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₃
            </button>
          </div>

          <Sep />

          <div
            class="compositor-group"
            data-compositor-tab="home"
            data-group-label="Lists"
            role="group"
            aria-label="Lists"
          >
            <button
              title="Bullet list"
              aria-label="Bullet list"
              aria-pressed={!!store.active.bullet}
              onClick$={() => runCommand("bullet")}
              class="tool-btn"
            >
              <Icon name={EDITOR_TOOL_ICONS.bulletList} size={16} /> list
            </button>
            <button
              title="Numbered list"
              aria-label="Numbered list"
              aria-pressed={!!store.active.ordered}
              onClick$={() => runCommand("ordered")}
              class="tool-btn"
            >
              <Icon name={EDITOR_TOOL_ICONS.numberedList} size={16} /> list
            </button>
            <button
              title="Checklist"
              aria-label="Checklist"
              aria-pressed={!!store.active.taskList}
              onClick$={() => runCommand("taskList")}
              class="tool-btn"
            >
              <Icon name={EDITOR_TOOL_ICONS.checklist} size={16} /> Checklist
            </button>
            <button
              title="Pull quote"
              aria-label="Pull quote"
              aria-pressed={!!store.active.blockquote}
              onClick$={() => runCommand("blockquote")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.quote} size={16} />
            </button>
            <button
              title="Code block"
              aria-label="Code block"
              aria-pressed={!!store.active.code}
              onClick$={() => runCommand("code")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.codeBlock} size={16} />
            </button>
          </div>

          <Sep />

          <div
            class="compositor-group"
            data-compositor-tab="home"
            data-group-label="Alignment"
            role="group"
            aria-label="Alignment"
          >
            <button
              title="Align left"
              aria-label="Align left"
              aria-pressed={!!store.active.left}
              onClick$={() => runCommand("left")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.alignLeft} size={16} />
            </button>
            <button
              title="Align center"
              aria-label="Align center"
              aria-pressed={!!store.active.center}
              onClick$={() => runCommand("center")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.alignCenter} size={16} />
            </button>
            <button
              title="Align right"
              aria-label="Align right"
              aria-pressed={!!store.active.right}
              onClick$={() => runCommand("right")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.alignRight} size={16} />
            </button>
            <button
              title="Justify"
              aria-label="Justify"
              aria-pressed={!!store.active.justify}
              onClick$={() => runCommand("justify")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.justify} size={16} />
            </button>
          </div>

          <Sep />

          <div
            class="compositor-group"
            data-compositor-tab="insert"
            data-group-label="Objects"
            role="group"
            aria-label="Objects"
          >
            <button
              title="Insert plate (image)"
              aria-label="Insert image"
              onClick$={() => {
                store.showImageInput = true;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.image} size={16} /> Image
            </button>
            <button
              title="Insert tabular (table)"
              aria-label="Insert table"
              aria-expanded={store.showTableInsertion}
              onClick$={() => {
                store.showTableInsertion = !store.showTableInsertion;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.table} size={16} /> Table
            </button>
            <button
              title="Insert diagram (Mermaid)"
              aria-label="Insert Mermaid diagram"
              onClick$={() => {
                store.showMermaidInput = true;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.diagram} size={16} /> Diagram
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="insert"
            data-group-label="Breaks"
            role="group"
            aria-label="Breaks"
          >
            <button
              title="Section break"
              aria-label="Section break"
              onClick$={() => runCommand("horizontal")}
              class="tool-btn"
            >
              <Icon name={EDITOR_TOOL_ICONS.sectionBreak} size={18} />
            </button>
            <button
              title="Page break (Ctrl/Cmd + Enter)"
              aria-label="Insert page break"
              onClick$={() => runCommand("pageBreak")}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.pageBreak} size={16} /> Page
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="review"
            data-group-label="Comments"
            role="group"
            aria-label="Comments"
          >
            <button
              title="Add a note beside the selected passage"
              aria-label="Add margin note"
              disabled={!store.hasSelection}
              onClick$={() => runCommand("addComment")}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Icon name={COMPOSITOR_ICONS.comment} size={16} /> Add margin
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="review"
            data-group-label="Listening"
            role="group"
            aria-label="Listening"
          >
            <SpeechTransport
              id={MANUSCRIPT_READING_ID}
              onPlay$={readAloud}
              playLabel="Read the selection aloud — or the whole draft when nothing is selected"
            />
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="insert"
            data-group-label="Notes"
            role="group"
            aria-label="Notes"
          >
            <button
              title="Insert endnote — collected under Notes on export"
              aria-label="Insert endnote"
              aria-pressed={store.noteInputKind === "endnote"}
              onClick$={() => {
                store.noteInputKind =
                  store.noteInputKind === "endnote" ? null : "endnote";
                store.noteText = "";
              }}
              class="tool-btn"
            >
              ¹ endnote
            </button>
            <button
              title="Insert footnote — collected under Footnotes on export"
              aria-label="Insert footnote"
              aria-pressed={store.noteInputKind === "footnote"}
              onClick$={() => {
                store.noteInputKind =
                  store.noteInputKind === "footnote" ? null : "footnote";
                store.noteText = "";
              }}
              class="tool-btn"
            >
              † footnote
            </button>
          </div>

          {/* Zen mode — dims inline notes/comments and asks the route to
              collapse the side panels, for distraction-free writing. */}
          <div
            class="compositor-group"
            data-compositor-tab="view"
            data-group-label="Focus"
            role="group"
            aria-label="Focus"
          >
            <button
              title={
                store.zenMode
                  ? "Exit distraction-free writing"
                  : "Distraction-free writing — hides notes, comments, and side panels"
              }
              aria-label="Toggle zen mode"
              aria-pressed={store.zenMode}
              onClick$={() => {
                store.zenMode = !store.zenMode;
                window.dispatchEvent(
                  new CustomEvent("twyne:zen-mode", {
                    detail: { on: store.zenMode },
                  }),
                );
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.zen} size={16} />
              {store.zenMode ? "Exit focus" : "Focus"}
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="review"
            data-group-label="Proofing"
            role="group"
            aria-label="Proofing"
          >
            <button
              title="Find and replace (⌘F / ⌘H)"
              aria-label="Find and replace"
              aria-pressed={store.showFindReplace}
              onClick$={() => {
                store.showFindReplace = !store.showFindReplace;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.find} size={16} /> Find
            </button>
            <button
              title="Grammar suggestions"
              aria-label="Grammar suggestions"
              aria-pressed={store.showGrammar}
              onClick$={() => {
                store.showGrammar = !store.showGrammar;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.grammar} size={16} /> Grammar
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="view"
            data-group-label="Navigation"
            role="group"
            aria-label="Navigation"
          >
            <button
              title="Document outline (⌘⇧O)"
              aria-label="Document outline"
              aria-pressed={store.showOutline}
              onClick$={() => {
                store.showOutline = !store.showOutline;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.outline} size={16} /> Outline
            </button>
          </div>

          <div
            class="compositor-group"
            data-compositor-tab="view"
            data-group-label="Help"
            role="group"
            aria-label="Help"
          >
            <button
              title="Keyboard shortcuts (⌘/)"
              aria-label="Keyboard shortcuts"
              onClick$={() => {
                store.showShortcutDialog = true;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.keyboard} size={16} /> Shortcuts
            </button>
          </div>

          {/* Layout popover — one control for width, margin, running header, page numbers */}
          <div
            class="compositor-group relative"
            data-compositor-tab="view"
            data-group-label="Page"
            role="group"
            aria-label="Page"
          >
            <button
              title="Page layout"
              aria-label="Page layout"
              aria-expanded={store.showLayout}
              onClick$={(_, el) => {
                // Cap the panel to the room actually below the button. A bare
                // `max-height` cannot do this: it knows the viewport but not
                // where the panel starts, so a tall panel opened from a
                // toolbar partway down the page still ran off the bottom.
                const below =
                  window.innerHeight - el.getBoundingClientRect().bottom - 16;
                store.layoutPanelMaxH = Math.max(220, Math.round(below));
                store.showLayout = !store.showLayout;
              }}
              class="tool-btn"
            >
              <Icon name={COMPOSITOR_ICONS.layout} size={16} /> Layout
            </button>
            {store.showLayout && (
              <div
                data-layout-popover
                class="compositor-layout-panel absolute right-0 top-full mt-1 z-50 w-[23rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto p-4 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg"
                style={{
                  borderRadius: "2px",
                  fontFamily: "var(--font-typewriter)",
                  maxHeight: `${store.layoutPanelMaxH}px`,
                  overscrollBehavior: "contain",
                }}
                role="dialog"
                aria-label="Page layout"
              >
                <header class="layout-panel-header">
                  <h2>Page layout</h2>
                  <p>Paper, flow, margins, and running heads.</p>
                </header>

                <fieldset class="layout-section">
                  <legend>Paper</legend>
                  <div class="flex items-center gap-1 mb-2">
                    {(
                      [
                        ["letter", "Letter"],
                        ["a4", "A4"],
                        ["legal", "Legal"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={
                          resolvePageSetup(store.layout).paper === value
                        }
                        onClick$={() =>
                          emitLayout({ ...store.layout, paper: value })
                        }
                        class="layout-choice"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div class="flex items-center gap-1 mb-3">
                    {(
                      [
                        ["portrait", "Portrait"],
                        ["landscape", "Landscape"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={
                          resolvePageSetup(store.layout).orientation === value
                        }
                        onClick$={() =>
                          emitLayout({
                            ...store.layout,
                            orientation: value,
                          })
                        }
                        class="layout-choice"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset class="layout-section">
                  <legend>Flow</legend>
                  <div class="flex items-center gap-1 mb-3">
                    {(
                      [
                        ["paginated", "Pages"],
                        ["continuous", "Scroll"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={
                          resolvePageSetup(store.layout).pagination === value
                        }
                        onClick$={() =>
                          emitLayout({ ...store.layout, pagination: value })
                        }
                        class="layout-choice"
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* The column-width presets only mean anything without a
                    sheet. On a paginated canvas the paper decides the width
                    and the margins decide the column. */}
                  {resolvePageSetup(store.layout).pagination ===
                    "continuous" && (
                    <>
                      <p class="dept-label mb-2">Column</p>
                      <div class="flex items-center gap-1 mb-3">
                        {(["narrow", "normal", "wide"] as const).map((w) => (
                          <button
                            key={w}
                            type="button"
                            aria-pressed={store.layout.width === w}
                            onClick$={() =>
                              emitLayout({ ...store.layout, width: w })
                            }
                            class="layout-choice"
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </fieldset>

                <fieldset class="layout-section">
                  <legend>Margins</legend>
                  {/* Two columns, paired the way the page reads: the opposing
                    edges sit beside each other, so setting a symmetric margin
                    is a comparison rather than a memory test. */}
                  <div class="grid grid-cols-2 gap-x-3 gap-y-2">
                    {(
                      [
                        ["Left", "left", "marginLeft"],
                        ["Right", "right", "marginRight"],
                        ["Top", "top", "marginTop"],
                        ["Bottom", "bottom", "marginBottom"],
                      ] as const
                    ).map(([label, rangeKey, field]) => {
                      const range = MARGIN_RANGE[rangeKey];
                      const value = resolveMargins(store.layout)[rangeKey];
                      return (
                        <label
                          key={field}
                          class="block text-[0.7rem] text-[var(--color-ink-light)]"
                        >
                          <span class="flex items-baseline justify-between mb-1 gap-2">
                            <span>{label}</span>
                            <span class="tabular-nums text-[0.65rem] text-[var(--color-ink-muted)]">
                              {value.toFixed(2)} rem
                            </span>
                          </span>
                          <input
                            type="range"
                            class="margin-slider"
                            aria-label={`${label} margin, rem`}
                            min={range.min}
                            max={range.max}
                            step={range.step}
                            value={value}
                            onInput$={(e) =>
                              emitLayout({
                                ...store.layout,
                                [field]: Number(
                                  (e.target as HTMLInputElement).value,
                                ),
                              })
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                  <label class="compositor-check-row mt-3">
                    <span class="min-w-0">
                      <span class="block text-[0.7rem] text-[var(--color-ink)]">
                        Margin guides
                      </span>
                      <span class="block text-[0.6rem] text-[var(--color-ink-muted)]">
                        Show the printable text boundary
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      class="compositor-checkbox"
                      checked={store.layout.showMarginGuides === true}
                      onChange$={(e) =>
                        emitLayout({
                          ...store.layout,
                          showMarginGuides: (e.target as HTMLInputElement)
                            .checked,
                        })
                      }
                    />
                  </label>
                </fieldset>

                {/* Header, footer and page numbers are one subject — the
                    running heads — and used to be interleaved with the margin
                    guides and each other. */}
                <fieldset class="layout-section">
                  <legend>Running heads</legend>
                  <label class="compositor-check-row mb-2">
                    <span>Show running header</span>
                    <input
                      type="checkbox"
                      class="compositor-checkbox"
                      checked={store.layout.runningHeader}
                      onChange$={(e) =>
                        emitLayout({
                          ...store.layout,
                          runningHeader: (e.target as HTMLInputElement).checked,
                        })
                      }
                    />
                  </label>
                  <label class="compositor-check-row mb-3">
                    <span>Page numbers</span>
                    <input
                      type="checkbox"
                      class="compositor-checkbox"
                      checked={store.layout.pageNumbers}
                      onChange$={(e) =>
                        emitLayout({
                          ...store.layout,
                          pageNumbers: (e.target as HTMLInputElement).checked,
                        })
                      }
                    />
                  </label>
                  <div class="mb-2">
                    <label
                      class="block text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] mb-1"
                      for="layout-header-text"
                    >
                      Header line
                    </label>
                    <input
                      id="layout-header-text"
                      value={store.headerText}
                      placeholder="Optional running header"
                      class="field-input text-[0.78rem]"
                      style="font-family: var(--font-typewriter);"
                      onInput$={(e) =>
                        updateChromeText(
                          "header",
                          (e.target as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                  <div>
                    <label
                      class="block text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] mb-1"
                      for="layout-footer-text"
                    >
                      Footer line
                    </label>
                    <input
                      id="layout-footer-text"
                      value={store.footerText}
                      placeholder="Optional running footer"
                      class="field-input text-[0.78rem]"
                      style="font-family: var(--font-typewriter);"
                      onInput$={(e) =>
                        updateChromeText(
                          "footer",
                          (e.target as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                </fieldset>
                <label class="compositor-check-row mb-2">
                  <span>
                    <span class="block">Include persona comments</span>
                    <span class="mt-0.5 block text-[0.61rem] leading-4 text-[var(--color-ink-muted)]">
                      Adds the room&apos;s notes as endnotes.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    class="compositor-checkbox"
                    checked={store.includePersonaCommentsInExport}
                    onChange$={(_, element) => {
                      store.includePersonaCommentsInExport = element.checked;
                    }}
                  />
                </label>
                {/* Page setup and "print it" belong together — this is the
                    panel where the writer just decided what the page looks
                    like, so it is where they look to commit it to paper. */}
                <button
                  type="button"
                  onClick$={saveAsPdf}
                  disabled={store.exportingPdf}
                  class="btn-paper w-full py-1.5 text-[0.7rem] disabled:opacity-40"
                >
                  {store.exportingPdf ? "Preparing…" : "Save as PDF…"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
});
