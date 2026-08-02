/**
 * The editor's command catalogue.
 *
 * This is deliberately UI-agnostic. Toolbars, the slash menu, the shortcut
 * reference, and the Manual all need the same names and search vocabulary,
 * but none of those surfaces should have to import Qwik or TipTap to ask
 * "which commands exist?".
 */

export type EditorCommandGroup =
  | "text"
  | "paragraph"
  | "structure"
  | "insert"
  | "review"
  | "navigation"
  | "table"
  | "history"
  | "view";

export interface EditorCommandContext {
  hasSelection?: boolean;
  inTable?: boolean;
  canMergeCells?: boolean;
  canSplitCell?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  hasDocument?: boolean;
  paginationActive?: boolean;
  readOnly?: boolean;
}

export type EditorCommandAvailability =
  | "always"
  | "editable"
  | "selection"
  | "table"
  | "mergeable-cells"
  | "splittable-cell"
  | "undo"
  | "redo"
  | "document"
  | "paginated";

export type EditorCommandSurface =
  | "toolbar"
  | "slash"
  | "shortcut-dialog"
  | "manual";

export interface SlashCommandMetadata {
  /** Label used for grouping in the slash menu. */
  group: "Write" | "Structure" | "Insert" | "Review";
  /** Extra fuzzy-search words that do not belong in the visible label. */
  keywords?: readonly string[];
  /** Lower values sort first within a group. */
  order: number;
}

export interface EditorCommandDefinition {
  id: string;
  label: string;
  description: string;
  group: EditorCommandGroup;
  searchTerms: readonly string[];
  availability: EditorCommandAvailability;
  surfaces: readonly EditorCommandSurface[];
  slash?: SlashCommandMetadata;
}

const TOOLBAR_AND_REFERENCE = ["toolbar", "shortcut-dialog", "manual"] as const;
const REFERENCE_ONLY = ["shortcut-dialog", "manual"] as const;
const INSERT_SURFACES = [
  "toolbar",
  "slash",
  "shortcut-dialog",
  "manual",
] as const;

/**
 * Stable command IDs.
 *
 * IDs describe intent rather than a particular TipTap method so the editor can
 * change implementation without invalidating persisted command preferences or
 * documentation anchors.
 */
export const EDITOR_COMMANDS = [
  {
    id: "format.bold",
    label: "Bold",
    description: "Make the selected text bold.",
    group: "text",
    searchTerms: ["strong", "weight"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.italic",
    label: "Italic",
    description: "Italicize the selected text.",
    group: "text",
    searchTerms: ["emphasis"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.underline",
    label: "Underline",
    description: "Underline the selected text.",
    group: "text",
    searchTerms: ["line"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.strike",
    label: "Strikethrough",
    description: "Strike through the selected text.",
    group: "text",
    searchTerms: ["delete", "cross out"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.highlight",
    label: "Highlight",
    description: "Apply the current highlight colour.",
    group: "text",
    searchTerms: ["marker", "background", "colour", "color"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.superscript",
    label: "Superscript",
    description: "Raise the selected text above the baseline.",
    group: "text",
    searchTerms: ["exponent", "raised"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.subscript",
    label: "Subscript",
    description: "Lower the selected text below the baseline.",
    group: "text",
    searchTerms: ["chemical", "lowered"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "format.clear",
    label: "Clear formatting",
    description: "Return text and paragraphs to manuscript defaults.",
    group: "text",
    searchTerms: ["remove styles", "reset"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "paragraph.heading-1",
    label: "Heading 1",
    description: "Turn the current block into a top-level heading.",
    group: "structure",
    searchTerms: ["title", "h1"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Structure", order: 10, keywords: ["h1", "title"] },
  },
  {
    id: "paragraph.heading-2",
    label: "Heading 2",
    description: "Turn the current block into a second-level heading.",
    group: "structure",
    searchTerms: ["subtitle", "h2"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Structure", order: 20, keywords: ["h2", "subtitle"] },
  },
  {
    id: "paragraph.heading-3",
    label: "Heading 3",
    description: "Turn the current block into a third-level heading.",
    group: "structure",
    searchTerms: ["subheading", "h3"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Structure", order: 30, keywords: ["h3", "subheading"] },
  },
  {
    id: "paragraph.bullet-list",
    label: "Bullet list",
    description: "Start or toggle a bulleted list.",
    group: "paragraph",
    searchTerms: ["unordered list", "bullets"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Write", order: 30, keywords: ["unordered", "bullets"] },
  },
  {
    id: "paragraph.numbered-list",
    label: "Numbered list",
    description: "Start or toggle a numbered list.",
    group: "paragraph",
    searchTerms: ["ordered list", "numbers"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Write", order: 40, keywords: ["ordered", "numbers"] },
  },
  {
    id: "paragraph.task-list",
    label: "Checklist",
    description: "Start or toggle a checklist.",
    group: "paragraph",
    searchTerms: ["task list", "todo", "checkbox"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Write", order: 50, keywords: ["tasks", "todo"] },
  },
  {
    id: "paragraph.blockquote",
    label: "Pull quote",
    description: "Set the current block as a quotation.",
    group: "paragraph",
    searchTerms: ["blockquote", "quote"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Write", order: 60, keywords: ["blockquote", "quote"] },
  },
  {
    id: "paragraph.code-block",
    label: "Code block",
    description: "Set the current block as preformatted code.",
    group: "paragraph",
    searchTerms: ["preformatted", "source"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Write", order: 70, keywords: ["source", "pre"] },
  },
  {
    id: "paragraph.align-left",
    label: "Align left",
    description: "Align the current paragraph to the left.",
    group: "paragraph",
    searchTerms: ["alignment"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "paragraph.align-center",
    label: "Align center",
    description: "Center the current paragraph.",
    group: "paragraph",
    searchTerms: ["alignment", "centre"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "paragraph.align-right",
    label: "Align right",
    description: "Align the current paragraph to the right.",
    group: "paragraph",
    searchTerms: ["alignment"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "paragraph.justify",
    label: "Justify",
    description: "Align the paragraph evenly to both margins.",
    group: "paragraph",
    searchTerms: ["alignment", "full"],
    availability: "editable",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "paragraph.indent",
    label: "Increase indent",
    description: "Move the current paragraph one tab stop inward.",
    group: "paragraph",
    searchTerms: ["tab", "nest"],
    availability: "editable",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "paragraph.outdent",
    label: "Decrease indent",
    description: "Move the current paragraph one tab stop outward.",
    group: "paragraph",
    searchTerms: ["shift tab", "unnest"],
    availability: "editable",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "insert.horizontal-rule",
    label: "Section break",
    description: "Insert an ornamental section divider.",
    group: "insert",
    searchTerms: ["horizontal rule", "divider", "hr"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Structure", order: 50, keywords: ["rule", "divider"] },
  },
  {
    id: "insert.page-break",
    label: "Page break",
    description: "Begin the following content on a new page.",
    group: "insert",
    searchTerms: ["new page", "pagination"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Structure", order: 60, keywords: ["new page"] },
  },
  {
    id: "insert.image",
    label: "Image",
    description: "Insert a plate from a file or URL.",
    group: "insert",
    searchTerms: ["picture", "photo", "plate", "media"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Insert", order: 10, keywords: ["picture", "plate"] },
  },
  {
    id: "insert.table",
    label: "Table",
    description: "Insert a table into the manuscript.",
    group: "insert",
    searchTerms: ["grid", "tabular", "rows", "columns"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Insert", order: 20, keywords: ["grid", "tabular"] },
  },
  {
    id: "insert.mermaid",
    label: "Mermaid diagram",
    description: "Insert a diagram from Mermaid source.",
    group: "insert",
    searchTerms: ["chart", "flowchart", "graph"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Insert", order: 30, keywords: ["chart", "graph"] },
  },
  {
    id: "insert.math-inline",
    label: "Inline equation",
    description: "Insert a LaTeX equation within a paragraph.",
    group: "insert",
    searchTerms: ["math", "latex", "formula"],
    availability: "editable",
    surfaces: ["slash", "shortcut-dialog", "manual"],
    slash: {
      group: "Insert",
      order: 40,
      keywords: ["math", "latex", "formula"],
    },
  },
  {
    id: "insert.math-block",
    label: "Equation block",
    description: "Insert a display LaTeX equation.",
    group: "insert",
    searchTerms: ["math", "latex", "formula", "display"],
    availability: "editable",
    surfaces: ["slash", "shortcut-dialog", "manual"],
    slash: {
      group: "Insert",
      order: 50,
      keywords: ["math", "latex", "display"],
    },
  },
  {
    id: "insert.endnote",
    label: "Endnote",
    description: "Insert a note collected at the end of the manuscript.",
    group: "insert",
    searchTerms: ["note", "citation"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Insert", order: 60, keywords: ["note", "reference"] },
  },
  {
    id: "insert.footnote",
    label: "Footnote",
    description: "Insert a note attached to the current page.",
    group: "insert",
    searchTerms: ["note", "citation"],
    availability: "editable",
    surfaces: INSERT_SURFACES,
    slash: { group: "Insert", order: 70, keywords: ["note", "reference"] },
  },
  {
    id: "review.comment",
    label: "Add comment",
    description: "Attach a writer comment to the selected text.",
    group: "review",
    searchTerms: ["annotation", "marginalia", "note"],
    availability: "selection",
    surfaces: INSERT_SURFACES,
    slash: { group: "Review", order: 10, keywords: ["annotation", "note"] },
  },
  {
    id: "review.read-aloud",
    label: "Read aloud",
    description: "Read the selection, or the manuscript, using narration.",
    group: "review",
    searchTerms: ["voice", "speak", "listen", "audio"],
    availability: "document",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "navigate.find",
    label: "Find",
    description: "Find text in the manuscript.",
    group: "navigation",
    searchTerms: ["search", "locate"],
    availability: "document",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "navigate.replace",
    label: "Find and replace",
    description: "Find text and replace one or every occurrence.",
    group: "navigation",
    searchTerms: ["search", "substitute"],
    availability: "document",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "navigate.outline",
    label: "Document outline",
    description: "Open the heading outline.",
    group: "navigation",
    searchTerms: ["headings", "table of contents", "toc"],
    availability: "document",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "view.shortcuts",
    label: "Keyboard shortcuts",
    description: "Open the searchable shortcut reference.",
    group: "view",
    searchTerms: ["help", "keys", "bindings"],
    availability: "always",
    surfaces: REFERENCE_ONLY,
  },
  {
    id: "view.zen",
    label: "Zen mode",
    description: "Hide surrounding panels and focus on the manuscript.",
    group: "view",
    searchTerms: ["focus", "distraction free"],
    availability: "always",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "history.undo",
    label: "Undo",
    description: "Undo the last manuscript change.",
    group: "history",
    searchTerms: ["revert", "back"],
    availability: "undo",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "history.redo",
    label: "Redo",
    description: "Redo the last undone manuscript change.",
    group: "history",
    searchTerms: ["repeat", "forward"],
    availability: "redo",
    surfaces: TOOLBAR_AND_REFERENCE,
  },
  {
    id: "table.add-row-before",
    label: "Add row above",
    description: "Add a table row above the active cell.",
    group: "table",
    searchTerms: ["table", "row", "above"],
    availability: "table",
    surfaces: ["shortcut-dialog", "manual"],
  },
  {
    id: "table.add-row-after",
    label: "Add row below",
    description: "Add a table row below the active cell.",
    group: "table",
    searchTerms: ["table", "row", "below"],
    availability: "table",
    surfaces: ["shortcut-dialog", "manual"],
  },
  {
    id: "table.add-column-before",
    label: "Add column left",
    description: "Add a table column left of the active cell.",
    group: "table",
    searchTerms: ["table", "column", "left"],
    availability: "table",
    surfaces: ["shortcut-dialog", "manual"],
  },
  {
    id: "table.add-column-after",
    label: "Add column right",
    description: "Add a table column right of the active cell.",
    group: "table",
    searchTerms: ["table", "column", "right"],
    availability: "table",
    surfaces: ["shortcut-dialog", "manual"],
  },
  {
    id: "table.merge-cells",
    label: "Merge cells",
    description: "Merge the selected table cells.",
    group: "table",
    searchTerms: ["table", "combine"],
    availability: "mergeable-cells",
    surfaces: ["shortcut-dialog", "manual"],
  },
  {
    id: "table.split-cell",
    label: "Split cell",
    description: "Split the active merged table cell.",
    group: "table",
    searchTerms: ["table", "divide"],
    availability: "splittable-cell",
    surfaces: ["shortcut-dialog", "manual"],
  },
] as const satisfies readonly EditorCommandDefinition[];

export type EditorCommandId = (typeof EDITOR_COMMANDS)[number]["id"];

export interface FilterEditorCommandsOptions {
  query?: string;
  group?: EditorCommandGroup;
  surface?: EditorCommandSurface;
  context?: EditorCommandContext;
  /** Include unavailable commands rather than hiding them. */
  includeUnavailable?: boolean;
}

const commandById = new Map<string, EditorCommandDefinition>(
  EDITOR_COMMANDS.map((command) => [command.id, command]),
);

export function getEditorCommand(
  id: EditorCommandId | string,
): EditorCommandDefinition | undefined {
  return commandById.get(id);
}

/** Availability is data-driven and can be evaluated outside a rendered UI. */
export function isEditorCommandAvailable(
  command: EditorCommandDefinition,
  context: EditorCommandContext = {},
): boolean {
  switch (command.availability) {
    case "always":
      return true;
    case "editable":
      return context.readOnly !== true;
    case "selection":
      return context.readOnly !== true && context.hasSelection === true;
    case "table":
      return context.readOnly !== true && context.inTable === true;
    case "mergeable-cells":
      return (
        context.readOnly !== true &&
        context.inTable === true &&
        context.canMergeCells === true
      );
    case "splittable-cell":
      return (
        context.readOnly !== true &&
        context.inTable === true &&
        context.canSplitCell === true
      );
    case "undo":
      return context.readOnly !== true && context.canUndo === true;
    case "redo":
      return context.readOnly !== true && context.canRedo === true;
    case "document":
      return context.hasDocument !== false;
    case "paginated":
      return context.paginationActive === true;
  }
}

function searchableText(command: EditorCommandDefinition): string {
  return [
    command.id,
    command.label,
    command.description,
    command.group,
    ...command.searchTerms,
    ...(command.slash?.keywords ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Search and filter the catalogue.
 *
 * Every whitespace-separated query term must match somewhere, so "table row"
 * narrows correctly without requiring an exact phrase.
 */
export function filterEditorCommands(
  options: FilterEditorCommandsOptions = {},
): EditorCommandDefinition[] {
  const terms = (options.query ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return EDITOR_COMMANDS.filter((command) => {
    if (options.group && command.group !== options.group) return false;
    if (
      options.surface &&
      !command.surfaces.includes(options.surface as never)
    ) {
      return false;
    }
    if (
      !options.includeUnavailable &&
      !isEditorCommandAvailable(command, options.context)
    ) {
      return false;
    }
    const haystack = searchableText(command);
    return terms.every((term) => haystack.includes(term));
  });
}

/** Slash commands are sorted by their declared group/order, never DOM order. */
export function getSlashCommands(
  query = "",
  context: EditorCommandContext = {},
): EditorCommandDefinition[] {
  return filterEditorCommands({
    query,
    surface: "slash",
    context,
  }).sort((a, b) => {
    const group = (a.slash?.group ?? "").localeCompare(b.slash?.group ?? "");
    if (group !== 0) return group;
    return (a.slash?.order ?? 0) - (b.slash?.order ?? 0);
  });
}
