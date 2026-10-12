import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MathExtensions } from "../../../../../src/components/editor/extensions/math";
import { loadKatexPeer } from "../../../../../src/components/editor/math/math-renderer";
import corpus from "./cases.json";

// Only this assembly/measurement scaffold is authored here. Source NodeViews,
// form, renderer, transactions, selection and history remain actual imports.
const scenarioId = new URL(location.href).searchParams.get("scenario");
const scenario = corpus.scenarios.find((row) => row.id === scenarioId);
if (!scenario) throw new Error("Unknown authored inline-geometry scenario.");
const selected = corpus.cases.find((row) => row.id === scenario.caseId)!;
const controlWidthMode = new URL(location.href).searchParams.get("controlWidth") ?? "flow";
if (!["flow", "min-content", "max-content"].includes(controlWidthMode)) {
  throw new Error("Unknown explicitly authored intrinsic control.");
}
const root = document.querySelector("#inline-geometry-cases")!;
const status = document.querySelector("#inline-geometry-status")!;
const report = document.querySelector("#inline-geometry-report")!;

type Sample = {
  variant: "markers" | "control";
  editor: Editor;
  section: HTMLElement;
  initialHtml: string;
  canonical: { html: string; json: unknown };
  version: number;
};
const samples: Sample[] = [];
const mathPosition = 1 + selected.prefix.length; // ProseMirror uses UTF16.
const markerSpecs = [
  { name: "prefix-start", position: 1, side: -1 },
  { name: "before-math", position: mathPosition, side: -1 },
  { name: "after-math", position: mathPosition + 1, side: 1 },
  {
    name: "suffix-end",
    position: mathPosition + 1 + selected.suffix.length,
    side: 1,
  },
];
let dirty = true;
let ready = false;
let heartbeat = 0;
let reportVersion = 0;
const started = performance.now();

for (const variant of ["markers", "control"] as const) {
  const section = document.createElement("section");
  section.dataset.probeVariant = variant;
  section.className = "fixture-slab";
  const caption = document.createElement("h2");
  caption.className = "fixture-caption";
  caption.textContent = selected.id + " / " + variant;
  const navigation = document.createElement("div");
  navigation.className = "fixture-navigation";
  const before = document.createElement("button");
  before.type = "button";
  before.dataset.testid = "caret-before";
  before.textContent = "Caret before equation";
  const after = document.createElement("button");
  after.type = "button";
  after.dataset.testid = "caret-after";
  after.textContent = "Caret after equation";
  navigation.append(before, after);
  const element = document.createElement("div");
  element.className = "twyne-editor probe-prose-width";
  element.dataset.probeWidthMode = variant === "control" ? controlWidthMode : "flow";
  section.append(caption, navigation, element);
  root.append(section);

  const editor = new Editor({
    element,
    extensions: [StarterKit, ...MathExtensions],
    content: {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: selected.prefix },
          { type: "inlineMath", attrs: { source: selected.source } },
          { type: "text", text: selected.suffix },
        ],
      }],
    },
    editorProps: {
      attributes: { class: "ProseMirror" },
      decorations(state) {
        if (variant === "control") return null;
        return DecorationSet.create(state.doc, markerSpecs.map((marker) =>
          Decoration.widget(
            marker.position,
            () => {
              const dom = document.createElement("span");
              dom.className = "probe-baseline-marker";
              dom.dataset.probeBaseline = marker.name;
              dom.dataset.probePosition = String(marker.position);
              dom.setAttribute("aria-hidden", "true");
              dom.setAttribute("contenteditable", "false");
              return dom;
            },
            { key: "probe-" + marker.name, side: marker.side },
          ),
        ));
      },
    },
  });
  const sample: Sample = {
    variant,
    section,
    editor,
    initialHtml: editor.getHTML(),
    canonical: { html: editor.getHTML(), json: editor.getJSON() },
    version: 0,
  };
  samples.push(sample);
  editor.on("transaction", () => {
    // Canonical snapshots are explicit fixture transaction boundaries, not
    // copied renderer HTML and not a new product input path.
    sample.canonical = { html: editor.getHTML(), json: editor.getJSON() };
    sample.version++;
    dirty = true;
  });
  before.addEventListener("click", () => {
    editor.chain().setTextSelection(mathPosition).focus().run();
    dirty = true;
  });
  after.addEventListener("click", () => {
    editor.chain().setTextSelection(mathPosition + 1).focus().run();
    dirty = true;
  });
  for (const event of ["input", "focusin", "focusout", "keyup", "pointerup"]) {
    section.addEventListener(event, () => { dirty = true; });
  }
  // Preview replacement and actual form resize can affect surrounding flow
  // without creating a manuscript transaction.
  new ResizeObserver(() => { dirty = true; }).observe(element);
  new MutationObserver(() => { dirty = true; }).observe(editor.view.dom, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
}

function coordinate(sample: Sample, position: number, side: number) {
  try {
    return { position, side, rect: sample.editor.view.coordsAtPos(position, side) };
  } catch (error) {
    return { position, side, unavailable: String(error) };
  }
}

function publish() {
  // This explicit fixture reporter calls the installed Editor API. The Parent
  // CDP script reads attributes; it never evaluates DOM/layout code. These
  // are raw caret rectangles, never inferred baseline metrics.
  const rows = samples.map((sample) => {
    const editor = sample.editor;
    const field = sample.section.querySelector("textarea");
    const current = editor.state.selection;
    return {
      variant: sample.variant,
      transactionVersion: sample.version,
      initialHtml: sample.initialHtml,
      canonical: sample.canonical,
      unchangedHtml: sample.canonical.html === sample.initialHtml,
      sourceUtf16Length: selected.source.length,
      mathPosition,
      selection: {
        type: current.toJSON().type,
        className: current.constructor.name,
        from: current.from,
        to: current.to,
        anchor: current.anchor,
        head: current.head,
      },
      actualSelectionCoords: [
        coordinate(sample, current.anchor, -1),
        coordinate(sample, current.head, 1),
      ],
      adjacentAtomCoords: [
        coordinate(sample, mathPosition, -1),
        coordinate(sample, mathPosition, 1),
        coordinate(sample, mathPosition + 1, -1),
        coordinate(sample, mathPosition + 1, 1),
      ],
      field: field ? {
        value: field.value,
        rows: field.rows,
        selectionStart: field.selectionStart,
        selectionEnd: field.selectionEnd,
        selectionDirection: field.selectionDirection,
        focused: document.activeElement === field,
      } : null,
      focusedInEditor: editor.view.dom.contains(document.activeElement),
    };
  });
  report.setAttribute("data-state", JSON.stringify({
    version: 1,
    reportVersion: ++reportVersion,
    ready,
    scenario,
    controlWidthMode,
    selected,
    devicePixelRatio: window.devicePixelRatio,
    fontStatus: document.fonts.status,
    activeElement: document.activeElement?.tagName ?? null,
    rows,
    coordinateSpace: "Editor.view.coordsAtPos client CSS pixels; element CDP quads are recorded separately.",
    markerScope: "Authored zero-width Decoration widgets, absent from canonical HTML; no-marker control is mandatory.",
  }));
}

document.addEventListener("selectionchange", () => { dirty = true; });
window.addEventListener("resize", () => { dirty = true; });
document.fonts.addEventListener("loadingdone", () => { dirty = true; });
function frame() {
  report.setAttribute("data-frame", String(++heartbeat));
  if (dirty) {
    dirty = false;
    publish();
  }
  if (performance.now() - started < 8 * 60 * 1000) requestAnimationFrame(frame);
  else report.setAttribute("data-heartbeat-stopped", "true");
}
requestAnimationFrame(frame);
await loadKatexPeer();
await document.fonts.ready;
ready = true;
dirty = true;
status.textContent = "Actual Source inline geometry ready";
