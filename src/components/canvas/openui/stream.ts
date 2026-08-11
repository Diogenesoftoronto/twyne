import { createStreamingParser, type ElementNode, type ParseResult } from "@openuidev/lang-core";
import { canvasSchema } from "./library";

export interface OpenUiStreamSnapshot {
  source: string;
  root: ElementNode | null;
  cards: ElementNode[];
  completedCards: ElementNode[];
  completedPrograms: string[];
  incomplete: boolean;
  errors: ParseResult["meta"]["errors"];
}

function elementChildren(value: unknown): ElementNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ElementNode =>
      !!item && typeof item === "object" && (item as ElementNode).type === "element",
  );
}

export function snapshotFromParse(source: string, result: ParseResult): OpenUiStreamSnapshot {
  const root = result.root;
  const cards = root?.typeName === "Cards" ? elementChildren(root.props.cards) : [];
  const completedPrograms = extractCompleteCardPrograms(source);
  const independentlyComplete = completedPrograms
    .map((program) => createStreamingParser(canvasSchema(), "Cards").set(program).root)
    .flatMap((parsed) =>
      parsed?.typeName === "Cards" ? elementChildren(parsed.props.cards) : [],
    )
    .filter((card) => !card.partial);
  return {
    source,
    root,
    cards,
    completedCards: root?.partial
      ? independentlyComplete
      : cards.filter((card) => !card.partial),
    completedPrograms,
    incomplete: result.meta.incomplete || !!root?.partial,
    errors: result.meta.errors,
  };
}

/**
 * lang-core deliberately marks every descendant partial while the root call is
 * still open. For a streaming board that would hold back every card until the
 * final token. This scanner finds syntactically closed, top-level Card calls
 * while respecting strings and escapes, then each card is parsed in isolation.
 */
export function extractCompleteCardPrograms(source: string): string[] {
  const cards: string[] = [];
  let start = -1;
  let depth = 0;
  let quote = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') {
      quote = true;
      continue;
    }
    if (start < 0 && source.startsWith("Card(", i)) {
      start = i;
      depth = 1;
      i += 4;
      continue;
    }
    if (start < 0) continue;
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) {
        cards.push(`root = Cards([${source.slice(start, i + 1)}])`);
        start = -1;
      }
    }
  }
  return cards;
}

export function createOpenUiStream() {
  const parser = createStreamingParser(canvasSchema(), "Cards");
  let source = "";
  return {
    push(delta: string): OpenUiStreamSnapshot {
      source += delta;
      return snapshotFromParse(source, parser.push(delta));
    },
    set(fullText: string): OpenUiStreamSnapshot {
      source = fullText;
      return snapshotFromParse(source, parser.set(fullText));
    },
    getSnapshot(): OpenUiStreamSnapshot {
      return snapshotFromParse(source, parser.getResult());
    },
  };
}

export function cardProgram(card: ElementNode): string {
  const title = typeof card.props.title === "string" ? card.props.title : "Extracted section";
  const escaped = title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `root = Cards([Card("${escaped}", [])])`;
}
