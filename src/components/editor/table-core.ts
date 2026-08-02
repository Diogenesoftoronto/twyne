/**
 * Wave 1 TC integration surface.
 *
 * Coordinator-owned editor integration should import from this module rather
 * than reaching into component internals:
 *
 * 1. Replace the stock Table/TableRow/TableCell/TableHeader entries with
 *    `createTableCoreExtensions()`.
 * 2. Render `TableInsertionGrid` from the insert-table command and dispatch
 *    its dimensions to `editor.commands.insertTable(...)`.
 * 3. Create a `createTableToolbarController(...)` beside the editor instance,
 *    copy its snapshots into UI state, render `FloatingTableToolbar`, and pass
 *    intents to `runTableToolbarIntent(...)`.
 */
export {
  FormattedTable,
  TABLE_ACTIONS,
  TABLE_ALIGNMENTS,
  TABLE_STYLE_IDS,
  TableFormat,
  createTableCoreExtensions,
  getActiveTableFormat,
  getTableActionAvailability,
  normalizeTableAlignment,
  normalizeTableCaption,
  normalizeTableStyle,
  normalizeTableWidth,
  resolveDistributedColumnWidths,
  runTableToolbarIntent,
  type DistributeTableColumnsOptions,
  type TableActionAvailability,
  type TableActionDefinition,
  type TableActionId,
  type TableAlignment,
  type TableCoreExtensionOptions,
  type TableFormatAttributes,
  type TableStyleId,
  type TableToolbarIntent,
  type TableWidth,
  type TableWidthInput,
} from "./extensions/table-format";

export {
  EMPTY_TABLE_TOOLBAR_SNAPSHOT,
  FloatingTableToolbar,
  computeTableToolbarPosition,
  createTableToolbarController,
  getActiveTableElement,
  readTableToolbarSnapshot,
  type PlainRect,
  type TableToolbarController,
  type TableToolbarPosition,
  type TableToolbarSnapshot,
} from "./floating-table-toolbar";

export {
  TABLE_GRID_DEFAULT_COLUMNS,
  TABLE_GRID_DEFAULT_ROWS,
  TABLE_INSERT_MAX_COLUMNS,
  TABLE_INSERT_MAX_ROWS,
  TableInsertionGrid,
  clampTableDimensions,
  isTableGridCellSelected,
  moveTableGridSelection,
  type TableDimensions,
  type TableGridDirection,
} from "./table-insertion-grid";
