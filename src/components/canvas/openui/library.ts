/**
 * The OpenUI component library — the contract between the model and the canvas.
 *
 * When a source is extracted, the model does not fill in a fixed schema. It
 * *composes* each card from the primitives below, choosing the shape that fits
 * the material: a definition list becomes a KeyValueTable, a cascade becomes a
 * Flow, a side-by-side becomes a Comparison. That is why this is OpenUI Lang
 * and not `streamObject` — the reference boards are heterogeneous, and the
 * model is the one who knows which shape a given passage wants.
 *
 * Two boundaries this file draws, both load-bearing:
 *
 *   1. **The model composes card interiors. It never authors canvas geometry.**
 *      No component here has an x, y, width, or z-index. Node positions, edges,
 *      clusters, pan, and zoom are Twyne's own state in `/source-canvas.json`.
 *
 *   2. **Transcription, not composition of new claims.** Every description below
 *      says so, because `library.prompt()` turns these descriptions into the
 *      extraction system prompt. There is no `source-extract-system.md` — adding
 *      a card shape means adding a component here, and the prompt follows.
 *
 * The renderer (`renderer.tsx` / `render-node.tsx`) walks the parsed AST and
 * calls the Qwik component in each definition's `component` slot. lang-core
 * never inspects that value; it is opaque to the parser and consumed only by
 * our adapter.
 */

import { z } from "zod";
import {
  createLibrary,
  defineComponent,
  type DefinedComponent,
} from "@openuidev/lang-core";

import type { CanvasComponent } from "./primitives";
import {
  AnnotationBlock,
  CalloutBlock,
  CardBlock,
  CardsRoot,
  ComparisonBlock,
  FigureBlock,
  FlowBlock,
  KeyValueTableBlock,
  OutlineBlock,
  ProseBlock,
  QuoteBlock,
} from "./primitives";

/**
 * Shared fidelity language. Repeated into the descriptions the model actually
 * reads rather than stated once, because the prompt generator emits each
 * component's description independently and a rule stated only at the top of
 * the library is a rule the model sees once and drifts from by card forty.
 */
const VERBATIM = "Use the source's own wording. Do not paraphrase or embellish.";

/* ── Leaf shapes ─────────────────────────────────────────────────────────── */

export const Prose = defineComponent({
  name: "Prose",
  description:
    "A short run of plain explanatory text, one to four sentences. The fallback " +
    "when the passage has no other structure. " +
    VERBATIM +
    " Prefer Outline when the source uses numbering or bullets.",
  props: z.object({
    text: z.string().describe("The passage, as it appears in the source."),
  }),
  component: ProseBlock,
});

export const Outline = defineComponent({
  name: "Outline",
  description:
    "A hierarchical list: numbered sections, lettered sub-points, bullets. This " +
    "is the workhorse for reference material, which is mostly nested outlines. " +
    "Nesting is expressed by each item's `depth` rather than by containment, so " +
    "a deep list streams without waiting for closing brackets. " +
    VERBATIM +
    " Keep the source's own numbering inside the text (e.g. \"(1) Antithrombin III\").",
  props: z.object({
    items: z
      .array(
        z.object({
          text: z.string().describe("One line of the outline, numbering included."),
          depth: z
            .number()
            .int()
            .min(0)
            .max(4)
            .describe("Indent level. 0 is top level; each nesting step adds one."),
          emphasis: z
            .boolean()
            .optional()
            .describe("True if the source bolds or underlines this line."),
        }),
      )
      .describe("Lines in document order."),
  }),
  component: OutlineBlock,
});

export const KeyValueTable = defineComponent({
  name: "KeyValueTable",
  description:
    "A two-column definition table: a term on the left, its explanation on the " +
    "right. Use for glossaries, factor lists, property/description pairs, and " +
    "any 'X — what X does' layout. " +
    VERBATIM,
  props: z.object({
    caption: z.string().optional().describe("Table heading, if the source gives one."),
    rows: z
      .array(
        z.object({
          key: z.string().describe("The term, in the left column."),
          value: z.string().describe("Its explanation, in the right column."),
        }),
      )
      .describe("Rows in document order."),
  }),
  component: KeyValueTableBlock,
});

export const Comparison = defineComponent({
  name: "Comparison",
  description:
    "A matrix comparing two or more things across the same set of attributes — " +
    "the 'TTP vs. HUS' shape. Use when the source sets items side by side. Every " +
    "row must have one cell per column, in column order; use an empty string when " +
    "the source leaves a cell blank. " +
    VERBATIM,
  props: z.object({
    caption: z.string().optional().describe("What is being compared."),
    columns: z
      .array(z.string())
      .describe("The things being compared, e.g. [\"TTP\", \"Typical HUS\"]."),
    rows: z
      .array(
        z.object({
          label: z.string().describe("The attribute, e.g. \"Etiology\"."),
          cells: z
            .array(z.string())
            .describe("One value per column, in the same order as `columns`."),
        }),
      )
      .describe("Attribute rows in document order."),
  }),
  component: ComparisonBlock,
});

export const Flow = defineComponent({
  name: "Flow",
  description:
    "A process or decision tree: a cascade, a pathway, a diagnostic algorithm. " +
    "Steps are given as a flat list; a step that follows others names them in " +
    "`after`, which lets one list describe both a straight sequence and a " +
    "branching tree. Omit `after` on the entry step. " +
    VERBATIM,
  props: z.object({
    caption: z.string().optional().describe("What the flow depicts."),
    steps: z
      .array(
        z.object({
          id: z
            .string()
            .describe("Short stable handle for this step, referenced by `after`."),
          label: z.string().describe("The step, as the source names it."),
          detail: z.string().optional().describe("A clarifying clause, if the source gives one."),
          after: z
            .array(z.string())
            .optional()
            .describe("Ids of the steps this one follows. Omit for the entry step."),
        }),
      )
      .describe("Every step in the process."),
  }),
  component: FlowBlock,
});

export const Quote = defineComponent({
  name: "Quote",
  description:
    "A verbatim passage worth citing directly — the writer may quote it in the " +
    "draft, so it must be exact. Never trim, normalise, or fix the source's " +
    "wording. Include a page or section locator in `locator` when the source " +
    "shows one.",
  props: z.object({
    text: z.string().describe("The passage, character for character."),
    locator: z
      .string()
      .optional()
      .describe("Page, section, or timestamp, e.g. \"p. 412\" or \"§3.2\"."),
  }),
  component: QuoteBlock,
});

export const Figure = defineComponent({
  name: "Figure",
  description:
    "An image, diagram, or micrograph from the source. Only ever use a `src` URL " +
    "that appears in the source text — never invent, guess, or reconstruct an " +
    "image URL. When the source describes a figure you cannot link to, use " +
    "Callout with the description instead.",
  props: z.object({
    src: z.string().describe("Image URL exactly as it appears in the source."),
    alt: z.string().describe("What the figure shows, for screen readers."),
    caption: z.string().optional().describe("The source's own caption, if it has one."),
  }),
  component: FigureBlock,
});

export const Callout = defineComponent({
  name: "Callout",
  description:
    "A boxed aside the source itself sets apart: a warning, a contraindication, " +
    "a key takeaway, a note. Use `tone` to match how the source frames it. Do not " +
    "promote ordinary prose into a Callout for emphasis — reserve it for material " +
    "the source visually distinguishes.",
  props: z.object({
    tone: z
      .enum(["note", "warning", "key", "caveat"])
      .describe("How the source frames this aside."),
    title: z.string().optional().describe("The aside's own heading, if any."),
    text: z.string().describe("The aside's content."),
  }),
  component: CalloutBlock,
});

/**
 * The one component whose content the model authors rather than transcribes.
 * Kept deliberately separate from the transcription primitives, and rendered in
 * a visually distinct register, so the writer can always tell the source's voice
 * from the machine's.
 */
export const Annotation = defineComponent({
  name: "Annotation",
  description:
    "Your own note on how this card bears on the writer's draft — the single " +
    "place you may write rather than transcribe. Say what the card does for the " +
    "argument: what it supports, complicates, or contradicts. Quote the draft " +
    "passage you mean in `draftAnchor`, verbatim and short. At most one " +
    "Annotation per card, and only when you have something substantive; an " +
    "Annotation that restates the card is worse than none.",
  props: z.object({
    stance: z
      .enum(["supports", "complicates", "contradicts", "background"])
      .describe("How this card sits with what the draft currently claims."),
    relevance: z.string().describe("One or two sentences on why this matters here."),
    draftAnchor: z
      .string()
      .optional()
      .describe("The draft passage this speaks to, quoted verbatim, under 30 words."),
    score: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("1–5: how much the writer should care right now. 5 is urgent."),
  }),
  component: AnnotationBlock,
});

/* ── Card and root ───────────────────────────────────────────────────────── */

const BLOCK_REFS = [
  Prose.ref,
  Outline.ref,
  KeyValueTable.ref,
  Comparison.ref,
  Flow.ref,
  Quote.ref,
  Figure.ref,
  Callout.ref,
  Annotation.ref,
] as const;

export const Card = defineComponent({
  name: "Card",
  description:
    "One card on the canvas: a single coherent section of the source. Split a " +
    "source at its own section boundaries — a card should be one idea a reader " +
    "could take in at a glance, not a whole document and not a single sentence. " +
    "Give it the source's own section heading as `title`. Compose the interior " +
    "from whichever blocks fit the material; mixing them is normal and expected.",
  props: z.object({
    title: z.string().describe("The section heading, from the source where possible."),
    blocks: z.array(z.union([...BLOCK_REFS])).describe("The card's contents, in document order."),
  }),
  component: CardBlock,
});

export const Cards = defineComponent({
  name: "Cards",
  description:
    "The root. Holds every card extracted from one source, in document order. " +
    "Emit cards as you reach them — each completed card is painted on the canvas " +
    "immediately, so a reader watches the board fill in rather than waiting for " +
    "the whole source to finish.",
  props: z.object({
    cards: z.array(Card.ref).describe("Cards in the order they appear in the source."),
  }),
  component: CardsRoot,
});

/* ── Library ─────────────────────────────────────────────────────────────── */

/**
 * Declared at the widened `CanvasComponent` type so the heterogeneous entries
 * agree on one `C`. See the note on `CanvasComponent` in `primitives.tsx`.
 * The `any` on the schema parameter mirrors lang-core's own `LibraryDefinition`,
 * which declares `components: DefinedComponent<any, C>[]` for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const components: DefinedComponent<any, CanvasComponent>[] = [
  Cards,
  Card,
  Prose,
  Outline,
  KeyValueTable,
  Comparison,
  Flow,
  Quote,
  Figure,
  Callout,
  Annotation,
];

export const canvasLibrary = createLibrary<CanvasComponent>({
  id: "twyne-source-canvas",
  root: "Cards",
  components,
  componentGroups: [
    {
      name: "Structure",
      components: ["Cards", "Card"],
      notes: [
        "Every response is exactly one Cards root containing one or more Card.",
        "Split at the source's own section boundaries, never mid-sentence.",
      ],
    },
    {
      name: "Transcription blocks",
      components: [
        "Prose",
        "Outline",
        "KeyValueTable",
        "Comparison",
        "Flow",
        "Quote",
        "Figure",
        "Callout",
      ],
      notes: [
        "These carry the source's content. Reproduce its wording; do not summarise.",
        "Pick the block whose shape the passage already has. Outline is the common case.",
        "Never emit a Figure whose src does not appear in the source text.",
      ],
    },
    {
      name: "Your own voice",
      components: ["Annotation"],
      notes: [
        "The only block you author. At most one per card, and only when substantive.",
      ],
    },
  ],
});

/**
 * lang-core appends a fixed "## Important Rules" block to every generated
 * prompt. It is written for the tool's usual job — composing a UI to show data —
 * and its first bullet tells the model to **invent plausible data**:
 *
 *     - When asked about data, generate realistic/plausible data
 *
 * On a transcription task that is an instruction to fabricate, and this is a
 * research tool: a hallucinated line on a source card is one the writer may go
 * on to cite. The second bullet is merely wrong for us — it advertises charts
 * and forms, which this library does not define.
 *
 * `PromptOptions` exposes no way to suppress the block, so we excise it. The
 * throw is the point: if a lang-core upgrade rewords these lines, the excision
 * would silently stop matching and the fabrication instruction would return
 * unnoticed. Better to fail loudly here — `library.test.ts` runs this on every
 * CI pass, so the break surfaces long before a writer sees it.
 */
const FABRICATION_RULE =
  "- When asked about data, generate realistic/plausible data";
const COMPONENT_CHOICE_RULE =
  "- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)";

export function redactUpstreamRules(prompt: string): string {
  if (!prompt.includes(FABRICATION_RULE)) {
    throw new Error(
      "@openuidev/lang-core no longer emits the expected boilerplate rule " +
        `(${JSON.stringify(FABRICATION_RULE)}). Its default prompt has changed. ` +
        "Re-read the generated prompt and update redactUpstreamRules before " +
        "shipping — extraction must never be told to invent data.",
    );
  }
  return prompt
    .replace(
      FABRICATION_RULE,
      "- Never invent data. Every value on a card must come from the source text; " +
        "if the source does not say it, leave it out.",
    )
    .replace(
      COMPONENT_CHOICE_RULE,
      "- Choose the block whose shape the passage already has, rather than the one " +
        "that would look best.",
    );
}

/**
 * The extraction system prompt, generated from the definitions above.
 *
 * This is why there is no `prompts/source-extract-system.md`: the components
 * *are* the prompt. Changing a description here changes what the model is told,
 * with no second place to keep in sync.
 */
export function canvasSystemPrompt(): string {
  return redactUpstreamRules(
    canvasLibrary.prompt({
      preamble:
        "You are transcribing one research source into cards for a writer's " +
        "research canvas. The writer will read these cards beside their own draft, " +
        "so fidelity to the source matters more than polish: they need to trust " +
        "that what a card says is what the source said.",
      additionalRules: [
        "Work through the source in order. Do not reorder, merge distant sections, or skip ahead.",
        "Transcribe. The only place you write in your own voice is Annotation.",
        "If a passage has no clear structure, use Prose rather than inventing one.",
        "Omit a section entirely rather than padding a card with material that is not there.",
        "Never emit a URL — for a Figure or anywhere else — that does not appear in the source text.",
      ],
    }),
  );
}

/** JSON schema for `createStreamingParser`. Consumed by `stream.ts`. */
export function canvasSchema() {
  return canvasLibrary.toJSONSchema();
}
