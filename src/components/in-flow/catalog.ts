/**
 * The in-flow tool catalog — the only components a tool spec may name.
 *
 * Built on json-render's core: the catalog validates every spec (a model's
 * output is never rendered until it passes), and its SpecStream compiler turns
 * a model's JSONL patches into a live spec as they arrive, so a tool fills in
 * while it streams. There is no Qwik renderer upstream; `tool-renderer.tsx`
 * maps each component name to its Qwik component.
 *
 * Specs are seeded deterministically — the writer's own attempts, their
 * sentence lengths, their sentences — and a model only ever *adds* to the
 * fields listed in {@link STREAMABLE_PATHS}.
 */
import {
  createSpecStreamCompiler,
  defineCatalog,
  defineSchema,
} from "@json-render/core";
import { z } from "zod";
import type { ToolKind } from "../../utils/struggle-signals";

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: s.propsOf("catalog.components"),
        children: s.array(s.string()),
      }),
    ),
  }),
  catalog: s.object({
    components: s.map({
      props: s.zod(),
      slots: s.array(s.string()),
      description: s.string(),
      example: s.any(),
    }),
  }),
}));

const sentenceLabProps = z.object({
  sentence: z.string().min(1).max(1200),
  attempts: z.array(z.string().max(1200)).max(6),
  variants: z.array(z.string().min(1).max(1200)).max(3),
});
const rhythmStripProps = z.object({
  sentences: z
    .array(z.object({ text: z.string(), words: z.number().int().min(0) }))
    .min(1)
    .max(40),
  targetMin: z.number().int().min(1).max(80),
  targetMax: z.number().int().min(2).max(120),
});
const claimCheckProps = z.object({
  claim: z.string().min(1).max(1200),
  slots: z
    .array(z.object({ label: z.string().min(1).max(60), filled: z.boolean() }))
    .min(1)
    .max(5),
});
const readerQuestionsProps = z.object({
  angle: z.string().max(200),
  questions: z.array(z.string().min(3).max(240)).max(4),
});

export type SentenceLabProps = z.infer<typeof sentenceLabProps>;
export type RhythmStripProps = z.infer<typeof rhythmStripProps>;
export type ClaimCheckProps = z.infer<typeof claimCheckProps>;
export type ReaderQuestionsProps = z.infer<typeof readerQuestionsProps>;

export const toolCatalog = defineCatalog(schema, {
  components: {
    SentenceLab: {
      props: sentenceLabProps,
      slots: [],
      description:
        "One sentence the writer keeps rewording: their own earlier attempts beside up to three fresh variants.",
    },
    RhythmStrip: {
      props: rhythmStripProps,
      slots: [],
      description:
        "Sentence lengths in a paragraph as bars, against a comfortable range.",
    },
    ClaimCheck: {
      props: claimCheckProps,
      slots: [],
      description:
        "The paragraph's load-bearing claim with slots for the support it needs.",
    },
    ReaderQuestions: {
      props: readerQuestionsProps,
      slots: [],
      description:
        "Up to four questions a reader would ask at this point in the draft.",
    },
  },
});

export const COMPONENT_FOR: Record<ToolKind, ToolComponent> = {
  "sentence-lab": "SentenceLab",
  "rhythm-strip": "RhythmStrip",
  "claim-check": "ClaimCheck",
  "reader-questions": "ReaderQuestions",
};

export type ToolComponent =
  | "SentenceLab"
  | "RhythmStrip"
  | "ClaimCheck"
  | "ReaderQuestions";

type PropsFor = {
  SentenceLab: SentenceLabProps;
  RhythmStrip: RhythmStripProps;
  ClaimCheck: ClaimCheckProps;
  ReaderQuestions: ReaderQuestionsProps;
};

export type ToolElement = {
  [K in ToolComponent]: { type: K; props: PropsFor[K]; children: string[] };
}[ToolComponent];

/** A tool is always a single root element; the flat map is json-render's shape. */
export interface ToolSpec {
  root: "tool";
  elements: { tool: ToolElement };
}

export function toolSpec(element: ToolElement): ToolSpec {
  return { root: "tool", elements: { tool: element } };
}

const PROPS_FOR: Record<ToolComponent, z.ZodType> = {
  SentenceLab: sentenceLabProps,
  RhythmStrip: rhythmStripProps,
  ClaimCheck: claimCheckProps,
  ReaderQuestions: readerQuestionsProps,
};

/**
 * Validate a spec — including one a model produced — before it is shown.
 * json-render checks the component is in the catalog, but checks props only
 * loosely, so each element's props are also held to its own component's
 * schema here.
 */
export function validateToolSpec(spec: unknown): ToolSpec | null {
  const result = toolCatalog.validate(spec);
  if (!result.success) return null;
  const tool = (
    result.data as {
      elements?: Record<string, { type: string; props: unknown }>;
    }
  ).elements?.tool;
  const schema = tool && PROPS_FOR[tool.type as ToolComponent];
  if (!schema || !schema.safeParse(tool.props).success) return null;
  return result.data as unknown as ToolSpec;
}

/** The only fields a model may append to, per component. */
export const STREAMABLE_PATHS: Partial<Record<ToolComponent, string>> = {
  SentenceLab: "/elements/tool/props/variants/-",
  ReaderQuestions: "/elements/tool/props/questions/-",
};

/**
 * Prompt fragment telling a model how to stream into a seeded spec. One JSON
 * Patch per line, append-only, to exactly one path — anything else is dropped.
 */
export function streamingInstructions(component: ToolComponent, max: number) {
  const path = STREAMABLE_PATHS[component];
  if (!path) return "";
  return `Respond with JSONL only: one RFC 6902 JSON Patch operation per line, nothing else — no prose, no code fences.
Each line must be exactly: {"op":"add","path":"${path}","value":"<text>"}
Write at most ${max} lines.`;
}

/**
 * Feed model text into a seeded spec as it streams. Returns the latest valid
 * spec after each chunk; patches aimed anywhere but the allowed path are
 * ignored, so a model cannot rewrite the writer's own words.
 */
export function createToolStream(seed: ToolSpec, max: number) {
  const path = STREAMABLE_PATHS[seed.elements.tool.type];
  const compiler = createSpecStreamCompiler<ToolSpec>(
    structuredClone(seed) as never,
  );
  let consumed = 0;
  let buffer = "";
  let latest = seed;

  const allowed = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return false;
    try {
      const op = JSON.parse(trimmed) as {
        op?: string;
        path?: string;
        value?: unknown;
      };
      return (
        op.op === "add" && op.path === path && typeof op.value === "string"
      );
    } catch {
      return false;
    }
  };

  const feed = (lines: string[]): ToolSpec => {
    const patches = lines.filter(allowed);
    if (!path || patches.length === 0) return latest;
    compiler.push(patches.join("\n") + "\n");
    const candidate = structuredClone(
      compiler.getResult() as unknown as ToolSpec,
    );
    const list = listAt(candidate);
    if (list && list.length > max) list.length = max;
    const valid = validateToolSpec(candidate);
    if (valid) latest = valid;
    return latest;
  };

  return {
    /** `text` is the cumulative model output so far. */
    push(text: string): ToolSpec {
      buffer += text.slice(consumed);
      consumed = text.length;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return feed(lines);
    },
    /** Flush a final line that arrived without a trailing newline. */
    finish(): ToolSpec {
      const rest = buffer;
      buffer = "";
      return rest.trim() ? feed([rest]) : latest;
    },
  };
}

function listAt(spec: ToolSpec): string[] | null {
  const props = spec.elements.tool.props as Record<string, unknown>;
  const list = props.variants ?? props.questions;
  return Array.isArray(list) ? (list as string[]) : null;
}
