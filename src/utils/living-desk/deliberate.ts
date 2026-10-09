import type { Finding, Occurrence } from "../living-desk-contract";
import type { Block } from "./segment";

export type DeliberateBaseline = Map<string, number>;
function signature(o: Occurrence, blocks: Block[]): string {
  const block = blocks.find(
    (b) =>
      b.paragraph === o.paragraph &&
      b.section === o.section &&
      b.kind !== "heading",
  );
  let offset = o.from - (block?.pos ?? o.from);
  const run = block?.runs?.find(
    (r) => o.from >= r.pos && o.from < r.pos + r.length,
  );
  if (run) offset = run.offset + o.from - run.pos;
  const text = block?.text ?? o.before + o.text + o.after;
  const start =
    Math.max(
      text.lastIndexOf(".", offset - 1),
      text.lastIndexOf("!", offset - 1),
      text.lastIndexOf("?", offset - 1),
    ) + 1;
  const end = text.slice(offset + o.text.length).search(/[.!?]/);
  const sentence = text
    .slice(start, end < 0 ? undefined : offset + o.text.length + end + 1)
    .trim()
    .replace(/\s+/g, " ");
  const priorText =
    text.slice(0, start).trim() ||
    blocks
      .slice(0, block ? blocks.indexOf(block) : 0)
      .filter((b) => b.kind !== "code" && b.kind !== "quote")
      .at(-1)
      ?.text.trim() ||
    "";
  const previous =
    priorText
      .match(/[^.!?]+[.!?]*$/)?.[0]
      .trim()
      .replace(/\s+/g, " ") ?? "";
  return JSON.stringify([previous, sentence, o.text]);
}

export function deliberateBaseline(
  finding: Finding,
  blocks: Block[],
): DeliberateBaseline {
  const baseline: DeliberateBaseline = new Map();
  finding.occurrences
    .filter((o) => o.flagged || o.label === "deliberate")
    .forEach((o) => {
      const key = signature(o, blocks);
      baseline.set(key, (baseline.get(key) ?? 0) + 1);
    });
  return baseline;
}

export function respectDeliberate(
  finding: Finding,
  blocks: Block[],
  baseline: DeliberateBaseline,
): Finding {
  const remaining = new Map(baseline);
  const occurrences = finding.occurrences
    .map((o) => {
      if (!o.flagged) return o;
      const key = signature(o, blocks),
        allowed = remaining.get(key) ?? 0;
      if (!allowed) return o;
      remaining.set(key, allowed - 1);
      return {
        ...o,
        flagged: false,
        fix: undefined,
        label: "deliberate",
        note: "Kept on purpose",
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged));
  const count = occurrences.filter((o) => o.flagged).length;
  return {
    ...finding,
    occurrences,
    count,
    effort: count,
    state: count ? "open" : "deliberate",
    metric: count
      ? `${count} new exception${count === 1 ? "" : "s"} · existing uses kept on purpose`
      : finding.metric,
    deliberateNote: "Kept on purpose. Twyne will flag only new drift.",
  };
}
