import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;
const DEFAULT_TOC_TITLE = "Contents";
const EMPTY_HEADING_LABEL = "Untitled section";

export type OutlineDocument = ProseMirrorNode | JSONContent;

/**
 * One heading and the section that starts at it.
 *
 * Positions use ProseMirror's coordinate system. `from` is the position before
 * the heading node, `contentFrom` is the first selectable position inside it,
 * and `to` is the first position after the complete section, including all
 * subordinate headings. Those ranges are deliberately part of the Wave 1
 * contract so section reordering can move `[from, to)` in one transaction.
 */
export interface DocumentOutlineHeading {
  id: string;
  text: string;
  label: string;
  level: number;
  depth: number;
  index: number;
  from: number;
  contentFrom: number;
  to: number;
  children: DocumentOutlineHeading[];
}

export interface DocumentOutlineModel {
  items: DocumentOutlineHeading[];
  flat: DocumentOutlineHeading[];
  byId: Record<string, DocumentOutlineHeading>;
  documentSize: number;
}

export interface TableOfContentsEntry {
  id: string;
  title: string;
  level: number;
  depth: number;
  children: TableOfContentsEntry[];
}

/**
 * Serializable input for a future TOC node, export renderer, or command.
 * Positions are intentionally omitted because a TOC remains portable after
 * document edits; navigation resolves its stable id against the live outline.
 */
export interface TableOfContentsPayload {
  type: "tableOfContents";
  version: 1;
  title: string;
  entries: TableOfContentsEntry[];
}

export interface TableOfContentsOptions {
  title?: string;
  minLevel?: number;
  maxLevel?: number;
}

interface HeadingCandidate {
  preferredId: string | null;
  text: string;
  level: number;
  from: number;
}

interface DescendantDocument {
  content: { size: number };
  descendants: (
    callback: (node: ProseMirrorNode, pos: number) => boolean | void,
  ) => void;
}

/**
 * Turn heading text into a readable, deterministic identifier.
 *
 * Unicode letters and numbers are retained rather than reducing every
 * non-English heading to "section". Combining marks are removed after NFKD
 * normalization, punctuation becomes a single hyphen, and empty headings use
 * the same stable fallback as other word processors' generated bookmarks.
 */
export function slugifyOutlineHeading(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function headingLevel(value: unknown): number | null {
  const level =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(level) &&
    level >= MIN_HEADING_LEVEL &&
    level <= MAX_HEADING_LEVEL
    ? level
    : null;
}

function preferredHeadingId(
  attrs: Record<string, unknown> | undefined,
): string | null {
  if (!attrs) return null;
  const candidates = [
    attrs.id,
    attrs.headingId,
    attrs["data-heading-id"],
    attrs["data-id"],
  ];
  const id = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim() !== "",
  );
  return id?.trim() ?? null;
}

function jsonTextContent(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(jsonTextContent).join("");
}

function jsonNodeSize(node: JSONContent, root = false): number {
  if (typeof node.text === "string") return node.text.length;
  if (!node.content) return root ? 0 : 1;
  const contentSize = node.content.reduce(
    (size, child) => size + jsonNodeSize(child),
    0,
  );
  return root ? contentSize : contentSize + 2;
}

function isDescendantDocument(
  document: OutlineDocument,
): document is ProseMirrorNode & DescendantDocument {
  return (
    typeof (document as Partial<DescendantDocument>).descendants ===
      "function" &&
    typeof (document as Partial<DescendantDocument>).content?.size === "number"
  );
}

function collectProseMirrorHeadings(
  document: ProseMirrorNode & DescendantDocument,
): HeadingCandidate[] {
  const headings: HeadingCandidate[] = [];
  document.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = headingLevel(node.attrs.level);
    if (level == null) return false;
    headings.push({
      preferredId: preferredHeadingId(node.attrs),
      text: normalizeHeadingText(node.textContent),
      level,
      from: pos,
    });
    return false;
  });
  return headings;
}

function collectJsonHeadings(document: JSONContent): HeadingCandidate[] {
  const headings: HeadingCandidate[] = [];

  const walk = (node: JSONContent, pos: number, root = false): void => {
    if (!root && node.type === "heading") {
      const level = headingLevel(node.attrs?.level);
      if (level != null) {
        headings.push({
          preferredId: preferredHeadingId(node.attrs),
          text: normalizeHeadingText(jsonTextContent(node)),
          level,
          from: pos,
        });
      }
      // Heading content cannot contain another block heading.
      return;
    }

    let childPos = root ? pos : pos + 1;
    for (const child of node.content ?? []) {
      walk(child, childPos);
      childPos += jsonNodeSize(child);
    }
  };

  walk(document, 0, document.type === "doc");
  return headings;
}

function allocateHeadingId(
  preferredId: string | null,
  text: string,
  usedIds: Set<string>,
  nextSuffixByBase: Map<string, number>,
): string {
  const base = preferredId ?? slugifyOutlineHeading(text);
  let candidate = base;
  let suffix = nextSuffixByBase.get(base) ?? 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  nextSuffixByBase.set(base, suffix);
  return candidate;
}

/**
 * Build the canonical outline and section model from either a live
 * ProseMirror document or Tiptap JSON.
 *
 * Hierarchy is based on the nearest preceding heading with a lower numeric
 * level. Missing intermediate levels never create synthetic nodes, so an h4
 * after an h2 is simply a child of that h2. A heading closes at the next
 * heading of the same or a higher rank, which gives section-dragging a stable
 * range even when levels are skipped.
 */
export function buildDocumentOutline(
  document: OutlineDocument,
): DocumentOutlineModel {
  const proseMirrorDocument = isDescendantDocument(document);
  const candidates = proseMirrorDocument
    ? collectProseMirrorHeadings(document)
    : collectJsonHeadings(document as JSONContent);
  const documentSize = proseMirrorDocument
    ? document.content.size
    : jsonNodeSize(
        document as JSONContent,
        (document as JSONContent).type === "doc",
      );

  const usedIds = new Set<string>();
  const nextSuffixByBase = new Map<string, number>();
  const flat: DocumentOutlineHeading[] = candidates.map((heading, index) => ({
    id: allocateHeadingId(
      heading.preferredId,
      heading.text,
      usedIds,
      nextSuffixByBase,
    ),
    text: heading.text,
    label: heading.text || EMPTY_HEADING_LABEL,
    level: heading.level,
    depth: 0,
    index,
    from: heading.from,
    contentFrom: heading.from + 1,
    to: documentSize,
    children: [],
  }));

  // A section ends where the next peer or ancestor begins.
  for (let index = 0; index < flat.length; index += 1) {
    const heading = flat[index];
    for (let next = index + 1; next < flat.length; next += 1) {
      if (flat[next].level <= heading.level) {
        heading.to = flat[next].from;
        break;
      }
    }
  }

  const items: DocumentOutlineHeading[] = [];
  const stack: DocumentOutlineHeading[] = [];
  for (const heading of flat) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    heading.depth = stack.length;
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(heading);
    else items.push(heading);
    stack.push(heading);
  }

  const byId = Object.fromEntries(flat.map((heading) => [heading.id, heading]));
  return { items, flat, byId, documentSize };
}

/** Alias for call sites that describe the operation as extraction. */
export const extractDocumentOutline = buildDocumentOutline;

function isOutlineModel(value: unknown): value is DocumentOutlineModel {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<DocumentOutlineModel>).items) &&
    Array.isArray((value as Partial<DocumentOutlineModel>).flat)
  );
}

function isHeadingList(
  value: unknown,
): value is readonly DocumentOutlineHeading[] {
  return Array.isArray(value);
}

function cloneTocEntries(
  headings: readonly DocumentOutlineHeading[],
  minLevel: number,
  maxLevel: number,
): TableOfContentsEntry[] {
  const entries: TableOfContentsEntry[] = [];
  const stack: TableOfContentsEntry[] = [];

  for (const heading of headings) {
    if (heading.level < minLevel || heading.level > maxLevel) continue;
    const entry: TableOfContentsEntry = {
      id: heading.id,
      title: heading.label,
      level: heading.level,
      depth: 0,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    entry.depth = stack.length;
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(entry);
    else entries.push(entry);
    stack.push(entry);
  }

  return entries;
}

/**
 * Produce a versioned, position-free TOC payload.
 *
 * The function accepts a document, an already-built model, or its flat list so
 * editor commands and export code do not need to rebuild data they already
 * have. Level filtering reconstructs the hierarchy rather than leaving
 * children attached to a filtered-out parent.
 */
export function createTableOfContentsPayload(
  source:
    | OutlineDocument
    | DocumentOutlineModel
    | readonly DocumentOutlineHeading[],
  options: TableOfContentsOptions = {},
): TableOfContentsPayload {
  const minLevel = Math.max(
    MIN_HEADING_LEVEL,
    Math.min(MAX_HEADING_LEVEL, options.minLevel ?? MIN_HEADING_LEVEL),
  );
  const maxLevel = Math.max(
    minLevel,
    Math.min(MAX_HEADING_LEVEL, options.maxLevel ?? MAX_HEADING_LEVEL),
  );
  const flat = isHeadingList(source)
    ? source
    : isOutlineModel(source)
      ? source.flat
      : buildDocumentOutline(source).flat;

  return {
    type: "tableOfContents",
    version: 1,
    title: options.title?.trim() || DEFAULT_TOC_TITLE,
    entries: cloneTocEntries(flat, minLevel, maxLevel),
  };
}

/** Alias retained for command code that uses "build" terminology. */
export const buildTableOfContentsPayload = createTableOfContentsPayload;

export interface OutlineFocusableEditor {
  state: { doc: ProseMirrorNode };
  commands: {
    setTextSelection: (position: number) => boolean;
    focus: () => boolean;
    scrollIntoView: () => boolean;
  };
}

/**
 * Resolve a heading against the current document, select its first content
 * position, focus the editor, and ask ProseMirror to scroll the caret into
 * view. Resolving by id first avoids using a stale position after intervening
 * edits.
 */
export function focusOutlineHeading(
  editor: OutlineFocusableEditor,
  heading: Pick<DocumentOutlineHeading, "id" | "contentFrom"> | string,
): boolean {
  const requestedId = typeof heading === "string" ? heading : heading.id;
  const current = buildDocumentOutline(editor.state.doc).byId[requestedId];
  const position =
    current?.contentFrom ??
    (typeof heading === "string" ? null : heading.contentFrom);
  if (position == null || !editor.commands.setTextSelection(position)) {
    return false;
  }
  editor.commands.focus();
  editor.commands.scrollIntoView();
  return true;
}
