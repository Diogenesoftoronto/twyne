import { Lexer } from "marked";

/** A verified character map from the exact clip input to its rendered prose. */
export interface SpeechSourceMap {
  source: string;
  rendered: string;
  sourceToRendered: ReadonlyMap<number, number>;
  renderedStart: number;
  renderedEnd: number;
}

interface SourceProjection {
  text: string;
  offsets: Array<number | undefined>;
}

interface MappingToken {
  type: string;
  raw: string;
  text?: string;
  tokens?: MappingToken[];
  items?: MappingToken[];
}

/** Keep whitespace flexible while preserving every literal UTF-16 position. */
function canonicalize(projection: SourceProjection): SourceProjection {
  let text = "";
  const offsets: SourceProjection["offsets"] = [];
  let space: number | undefined;
  let pendingSpace = false;
  for (let index = 0; index < projection.text.length; index += 1) {
    const character = projection.text[index];
    if (/\s/u.test(character)) {
      if (!pendingSpace) space = projection.offsets[index];
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && text) {
      text += " ";
      offsets.push(space);
    }
    pendingSpace = false;
    text += character;
    offsets.push(projection.offsets[index]);
  }
  return { text, offsets };
}

/**
 * Project only visible Markdown leaves. In particular, link destinations and
 * image alt text are not DOM text and must never steal a repeated word's map.
 * Unrecognized or transformed content is left unmapped; the final rendered
 * text comparison below rejects an incomplete projection.
 */
function markdownProjection(source: string): SourceProjection {
  let text = "";
  const offsets: SourceProjection["offsets"] = [];
  const space = () => {
    text += "\n";
    offsets.push(undefined);
  };
  const literal = (value: string, start: number, end: number): number => {
    let cursor = start;
    for (const part of value.split(/(\n)/u)) {
      if (part === "\n") {
        space();
        continue;
      }
      if (!part) continue;
      const found = source.indexOf(part, cursor);
      if (found < 0 || found + part.length > end) continue;
      text += part;
      for (let index = 0; index < part.length; index += 1)
        offsets.push(found + index);
      cursor = found + part.length;
    }
    return cursor;
  };
  const walk = (tokens: MappingToken[], start: number, end: number): number => {
    let cursor = start;
    for (const token of tokens) {
      const found = source.indexOf(token.raw, cursor);
      const located = found >= 0 && found + token.raw.length <= end;
      const tokenStart = located ? found : cursor;
      const tokenEnd = located ? found + token.raw.length : end;
      let consumed = tokenStart;
      if (
        token.type === "image" ||
        token.type === "def" ||
        token.type === "hr"
      ) {
        // None of these renders a text node.
      } else if (token.items || token.tokens) {
        consumed = walk(
          token.items ?? token.tokens ?? [],
          tokenStart,
          tokenEnd,
        );
      } else if (token.type === "space" || token.type === "br") {
        space();
      } else if (
        ["text", "html", "escape", "codespan", "code"].includes(token.type)
      ) {
        consumed = literal(token.text ?? token.raw, tokenStart, tokenEnd);
      }
      if (
        ["paragraph", "heading", "list_item", "blockquote", "code"].includes(
          token.type,
        )
      )
        space();
      cursor = located ? tokenEnd : consumed;
    }
    return cursor;
  };
  const lexer = new Lexer({ gfm: true, breaks: true });
  walk(lexer.lex(source) as MappingToken[], 0, source.length);
  return { text, offsets };
}

function uniqueIndexOf(text: string, part: string): number {
  const start = text.indexOf(part);
  return start >= 0 && text.indexOf(part, start + 1) < 0 ? start : -1;
}

/**
 * A plain selection uses its explicit manuscript offset, including repeated
 * passages. Otherwise the complete literal/Markdown projection must match one
 * unique rendered occurrence. A partial word match is never enough evidence.
 */
export function buildSpeechSourceMap(
  source: string,
  rendered: string,
  options: { sourceOffset?: number | null; markdown?: boolean } = {},
): SpeechSourceMap | null {
  if (!source) return null;
  const requested = options.sourceOffset;
  const explicit =
    typeof requested === "number" &&
    Number.isInteger(requested) &&
    requested >= 0 &&
    rendered.slice(requested, requested + source.length) === source;
  const start = explicit ? requested : uniqueIndexOf(rendered, source);
  if (start >= 0) {
    return {
      source,
      rendered,
      sourceToRendered: new Map(
        Array.from({ length: source.length }, (_, index) => [
          index,
          start + index,
        ]),
      ),
      renderedStart: start,
      renderedEnd: start + source.length,
    };
  }
  if (!options.markdown) return null;

  const projected = canonicalize(markdownProjection(source));
  const target = canonicalize({
    text: rendered,
    offsets: Array.from({ length: rendered.length }, (_, index) => index),
  });
  if (!projected.text) return null;
  const targetStart = uniqueIndexOf(target.text, projected.text);
  if (targetStart < 0) return null;
  const sourceToRendered = new Map<number, number>();
  for (let index = 0; index < projected.text.length; index += 1) {
    const sourceOffset = projected.offsets[index];
    const renderedOffset = target.offsets[targetStart + index];
    if (sourceOffset !== undefined && renderedOffset !== undefined)
      sourceToRendered.set(sourceOffset, renderedOffset);
  }
  return {
    source,
    rendered,
    sourceToRendered,
    renderedStart: target.offsets[targetStart]!,
    renderedEnd: target.offsets[targetStart + projected.text.length - 1]! + 1,
  };
}

/** Translate a provider range only when every spoken character is verified. */
export function mapSpeechSourceRange(
  map: SpeechSourceMap | null,
  sourceStart: number,
  sourceEnd: number,
): { start: number; end: number } | null {
  if (
    !map ||
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    sourceStart < 0 ||
    sourceEnd > map.source.length ||
    sourceEnd <= sourceStart
  )
    return null;
  let start: number | null = null;
  let end = 0;
  for (let index = sourceStart; index < sourceEnd; index += 1) {
    if (/\s/u.test(map.source[index])) continue;
    const rendered = map.sourceToRendered.get(index);
    if (rendered === undefined || (start !== null && rendered < end))
      return null;
    start ??= rendered;
    end = rendered + 1;
  }
  if (start === null) return null;
  const spoken = map.source.slice(sourceStart, sourceEnd).replace(/\s/gu, "");
  const visible = map.rendered.slice(start, end).replace(/\s/gu, "");
  return spoken === visible ? { start, end } : null;
}
