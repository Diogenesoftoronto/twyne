import type { Node as PmNode } from "@tiptap/pm/model";
import type {
  Occurrence,
  SectionInfo,
  Finding,
  LensId,
} from "../living-desk-contract";

export interface Block {
  kind: "paragraph" | "heading" | "quote" | "code" | "other";
  text: string;
  pos: number;
  paragraph: number;
  section: number;
  /** Text runs retain document gaps occupied by inline atoms. */
  runs?: { offset: number; length: number; pos: number }[];
}
export interface Segments {
  blocks: Block[];
  sections: SectionInfo[];
  plainText: string;
}

export function posAtOffset(block: Block, offset: number, end = false): number {
  const runs = block.runs;
  if (!runs?.length) return block.pos + offset;
  // At a text/atom boundary, starts belong to the next text and ends to the preceding text.
  const run = runs.find(
    (r) =>
      offset >= r.offset &&
      (end ? offset <= r.offset + r.length : offset < r.offset + r.length),
  );
  if (run) return run.pos + offset - run.offset;
  const last = runs[runs.length - 1];
  return last.pos + last.length;
}

export function segmentDocument(doc: PmNode): Segments {
  const blocks: Block[] = [];
  const sections: SectionInfo[] = [];
  let paragraph = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const quote = Array.from(
      { length: doc.resolve(pos).depth + 1 },
      (_, i) => doc.resolve(pos).node(i).type.name,
    ).includes("blockquote");
    const kind: Block["kind"] = quote
      ? "quote"
      : node.type.name === "codeBlock"
        ? "code"
        : node.type.name === "heading"
          ? "heading"
          : node.type.name === "paragraph"
            ? "paragraph"
            : "other";
    if (!sections.length || kind === "heading") {
      if (sections.length) sections[sections.length - 1].to = pos;
      sections.push({
        index: sections.length,
        title: kind === "heading" ? node.textContent : "Opening",
        from: pos + 1,
        to: doc.content.size,
        words: 0,
      });
    }
    let text = "";
    const runs: NonNullable<Block["runs"]> = [];
    node.descendants((child, offset) => {
      if (child.isText) {
        runs.push({
          offset: text.length,
          length: child.text!.length,
          pos: pos + 1 + offset,
        });
        text += child.text;
      }
    });
    const section = sections.length - 1;
    if (kind !== "heading") paragraph++;
    blocks.push({
      kind,
      text,
      pos: pos + 1,
      paragraph: Math.max(1, paragraph),
      section,
      runs,
    });
    sections[section].words += text.trim().split(/\s+/).filter(Boolean).length;
    return false;
  });
  return {
    blocks,
    sections,
    plainText: blocks.map((b) => b.text).join("\n\n"),
  };
}

export function occurrence(
  block: Block,
  offset: number,
  length: number,
  id: string,
  extra: Partial<Occurrence> = {},
): Occurrence {
  const contextStart = Math.max(0, offset - 55);
  const contextEnd = Math.min(block.text.length, offset + length + 55);
  let before = block.text.slice(contextStart, offset);
  let after = block.text.slice(offset + length, contextEnd);
  if (contextStart > 0 && /\S/.test(block.text[contextStart - 1]))
    before = before.replace(/^\S*\s/, "");
  if (contextEnd < block.text.length && /\S/.test(block.text[contextEnd]))
    after = after.replace(/\s\S*$/, "");
  return {
    id: `${id}:${posAtOffset(block, offset)}`,
    from: posAtOffset(block, offset),
    to: posAtOffset(block, offset + length, true),
    text: block.text.slice(offset, offset + length),
    before: before.trimStart(),
    after: after.trimEnd(),
    section: block.section,
    paragraph: block.paragraph,
    provenance: "rule",
    flagged: true,
    ...extra,
  };
}

export function finding(
  id: string,
  lens: LensId,
  title: string,
  metric: string,
  occurrences: Occurrence[],
): Finding {
  const count = occurrences.filter((o) => o.flagged).length;
  return {
    id,
    lens,
    title,
    metric,
    level: "piece",
    criterion: "consistency",
    count,
    effort: count,
    impact: null,
    state: count ? "open" : "resolved",
    occurrences: [...occurrences].sort(
      (a, b) => Number(b.flagged) - Number(a.flagged),
    ),
    actions: ["fix-one", "fix-all", "deliberate", "jump"],
    provenance: occurrences.some((o) => o.provenance === "jev")
      ? "jev"
      : "rule",
  };
}

export function matchCase(original: string, replacement: string): string {
  if (/[A-Z]/.test(original) && original === original.toUpperCase())
    return replacement.toUpperCase();
  return /^[A-Z]/.test(original)
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;
}
