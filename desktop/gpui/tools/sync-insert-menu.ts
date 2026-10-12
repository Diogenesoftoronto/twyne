// Regenerate or verify native fixtures by executing the actual Source registry.
import { getSlashCommands } from "../../../src/utils/editor-commands";
import { fuzzySlashCommands } from "../../../src/utils/slash-command-filter";
import {
  keybindingsForCommand,
  shortcutHints,
} from "../../../src/utils/keybindings";
import { insertionModals } from "./source-insert-panels";
import {
  clampTableDimensions,
  moveTableGridSelection,
  TABLE_GRID_DEFAULT_ROWS,
  TABLE_GRID_DEFAULT_COLUMNS,
  TABLE_INSERT_MAX_ROWS,
  TABLE_INSERT_MAX_COLUMNS,
  type TableGridDirection,
} from "./source-table-grid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const check = process.argv.includes("--check");
const directory = resolve(import.meta.dir, "../fixtures/insert-menu");
const context = { readOnly: false, hasSelection: false };
const catalog = getSlashCommands("", context).map((command) => ({
  id: command.id,
  label: command.label,
  description: command.description,
  group: command.slash!.group,
  order: command.slash!.order,
  searchTerms: command.searchTerms,
  keywords: command.slash!.keywords ?? [],
  availability: command.availability,
  shortcut: shortcutHints(command.id, "mac")[0] ?? null,
  keybinding: keybindingsForCommand(command.id)[0]?.shortcut ?? null,
}));
const oldCases = JSON.parse(
  await readFile(resolve(directory, "source-filter-cases.json"), "utf8"),
) as { query: string }[];
const cases = oldCases.map(({ query }) => ({
  query,
  results: fuzzySlashCommands(query, context).map(({ command, score }) => ({
    id: command.id,
    score,
  })),
}));
const limits = {
  rows: TABLE_GRID_DEFAULT_ROWS,
  columns: TABLE_GRID_DEFAULT_COLUMNS,
};
const moves = [
  { rows: 1, columns: 1 },
  { rows: 2, columns: 4 },
  { rows: 8, columns: 10 },
  { rows: 0, columns: 99 },
].flatMap((current) =>
  (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ] as TableGridDirection[]
  ).map((direction) => ({
    current,
    direction,
    limits,
    expected: moveTableGridSelection(current, direction, limits),
  })),
);
const table = {
  constants: {
    defaultRows: TABLE_GRID_DEFAULT_ROWS,
    defaultColumns: TABLE_GRID_DEFAULT_COLUMNS,
    maxRows: TABLE_INSERT_MAX_ROWS,
    maxColumns: TABLE_INSERT_MAX_COLUMNS,
  },
  moves,
  clamps: [
    { rows: 0, columns: 0 },
    { rows: 99, columns: 99 },
    { rows: 2, columns: 4 },
  ].map((current) => ({
    current,
    limits: { rows: TABLE_INSERT_MAX_ROWS, columns: TABLE_INSERT_MAX_COLUMNS },
    expected: clampTableDimensions(current),
  })),
};
for (const [name, value] of [
  ["source-catalog.json", catalog],
  ["source-filter-cases.json", cases],
  ["source-table-grid-cases.json", table],
  ["source-text-modals.json", insertionModals],
] as const) {
  const path = resolve(directory, name);
  if (check) {
    const stored = JSON.parse(await readFile(path, "utf8"));
    if (!isDeepStrictEqual(stored, value))
      throw new Error(
        `${name} differs from the current Source registry. Review and regenerate the fixture.`,
      );
  } else {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n");
  }
}
console.log(
  JSON.stringify({
    status: check ? "matched" : "generated",
    commands: catalog.length,
    queries: cases.length,
    tableCases: moves.length + table.clamps.length,
    textModals: Object.keys(insertionModals).length,
    nativeLinkIncluded: false,
    networkUsed: false,
  }),
);
