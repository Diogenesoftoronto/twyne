use std::collections::{BTreeMap, BTreeSet};

use super::{
    EditorError, ElementShell, Node, NodeKind, NodePath, RichDocument, TableCommand,
    command::empty_cell,
};

#[derive(Clone)]
struct Cell {
    path: NodePath,
    row: usize,
    column: usize,
    rowspan: usize,
    colspan: usize,
    node: Node,
}
struct Grid {
    table_path: NodePath,
    table: Node,
    rows: Vec<NodePath>,
    cells: Vec<Cell>,
    slots: Vec<Vec<usize>>,
    width: usize,
}

pub(crate) fn apply(
    document: &RichDocument,
    cell_path: &[usize],
    command: TableCommand,
) -> Result<RichDocument, EditorError> {
    let add_row_before = command == TableCommand::AddRowBefore;
    let grid = grid_for(document, cell_path)?;
    let selected = grid
        .cells
        .iter()
        .find(|cell| cell.path == cell_path)
        .ok_or(EditorError::UnsupportedStructure(
            "The selected node is not a table cell",
        ))?;
    if command == TableCommand::DeleteTable {
        return document
            .replace_node(&grid.table_path, vec![Node::paragraph(Vec::new())])
            .ok_or(EditorError::MissingTextBlock);
    }
    let mut edits = BTreeMap::<NodePath, Option<Node>>::new();
    let mut insertions = BTreeMap::<NodePath, Vec<(usize, Node)>>::new();
    let mut row_replacement: Option<(NodePath, Vec<Node>)> = None;
    match command {
        TableCommand::AddRowBefore | TableCommand::AddRowAfter => {
            if grid.rows.len() >= 100 {
                return Err(EditorError::InvalidTableSize);
            }
            let position = selected.row + usize::from(command == TableCommand::AddRowAfter);
            let mut occupied = BTreeSet::new();
            for cell in &grid.cells {
                if cell.row < position && cell.row + cell.rowspan > position {
                    edits.insert(
                        cell.path.clone(),
                        Some(with_spans(&cell.node, cell.rowspan + 1, cell.colspan)),
                    );
                    occupied.extend(cell.column..cell.column + cell.colspan);
                }
            }
            let prototype = document
                .node(&grid.rows[selected.row])
                .and_then(Node::as_element)
                .expect("table row");
            let header = grid
                .cells
                .iter()
                .filter(|cell| cell.row == selected.row)
                .all(|cell| {
                    cell.node
                        .as_element()
                        .is_some_and(|element| element.shell.tag == "th")
                });
            let children = (0..grid.width)
                .filter(|column| !occupied.contains(column))
                .map(|_| empty_cell(header))
                .collect();
            let row = Node::element(prototype.shell.clone(), children);
            let existing = document
                .node(&grid.rows[selected.row])
                .expect("table row")
                .clone();
            row_replacement = Some((
                grid.rows[selected.row].clone(),
                if command == TableCommand::AddRowBefore {
                    vec![row, existing]
                } else {
                    vec![existing, row]
                },
            ));
        }
        TableCommand::DeleteRow => {
            if grid.rows.len() == 1 {
                return document
                    .replace_node(&grid.table_path, vec![Node::paragraph(Vec::new())])
                    .ok_or(EditorError::MissingTextBlock);
            }
            for cell in &grid.cells {
                if cell.row < selected.row && cell.row + cell.rowspan > selected.row {
                    edits.insert(
                        cell.path.clone(),
                        Some(with_spans(&cell.node, cell.rowspan - 1, cell.colspan)),
                    );
                } else if cell.row == selected.row && cell.rowspan > 1 {
                    let next_row = &grid.rows[selected.row + 1];
                    let index = insertion_index(document, &grid, selected.row + 1, cell.column);
                    insertions.entry(next_row.clone()).or_default().push((
                        index,
                        with_spans(&cell.node, cell.rowspan - 1, cell.colspan),
                    ));
                }
            }
            row_replacement = Some((grid.rows[selected.row].clone(), Vec::new()));
        }
        TableCommand::AddColumnBefore | TableCommand::AddColumnAfter => {
            if grid.width >= 100 {
                return Err(EditorError::InvalidTableSize);
            }
            let position = selected.column
                + if command == TableCommand::AddColumnAfter {
                    selected.colspan
                } else {
                    0
                };
            let mut occupied_rows = BTreeSet::new();
            for cell in &grid.cells {
                if cell.column < position && cell.column + cell.colspan > position {
                    edits.insert(
                        cell.path.clone(),
                        Some(with_spans(&cell.node, cell.rowspan, cell.colspan + 1)),
                    );
                    occupied_rows.extend(cell.row..cell.row + cell.rowspan);
                }
            }
            for (row, path) in grid.rows.iter().enumerate() {
                if occupied_rows.contains(&row) {
                    continue;
                }
                let prototype_column = position.min(grid.width - 1);
                let prototype = &grid.cells[grid.slots[row][prototype_column]];
                let header = prototype
                    .node
                    .as_element()
                    .is_some_and(|element| element.shell.tag == "th");
                insertions.entry(path.clone()).or_default().push((
                    insertion_index(document, &grid, row, position),
                    empty_cell(header),
                ));
            }
        }
        TableCommand::DeleteColumn => {
            if grid.width == 1 {
                return document
                    .replace_node(&grid.table_path, vec![Node::paragraph(Vec::new())])
                    .ok_or(EditorError::MissingTextBlock);
            }
            let column = selected.column;
            for cell in &grid.cells {
                if cell.column <= column && cell.column + cell.colspan > column {
                    edits.insert(
                        cell.path.clone(),
                        (cell.colspan > 1)
                            .then(|| with_spans(&cell.node, cell.rowspan, cell.colspan - 1)),
                    );
                }
            }
        }
        TableCommand::MergeCells { from, to } => {
            let first = grid.cells.iter().find(|cell| cell.path == from).ok_or(
                EditorError::UnsupportedStructure("The first merge cell is outside this table"),
            )?;
            let last = grid.cells.iter().find(|cell| cell.path == to).ok_or(
                EditorError::UnsupportedStructure("The last merge cell is outside this table"),
            )?;
            let top = first.row.min(last.row);
            let left = first.column.min(last.column);
            let bottom = (first.row + first.rowspan).max(last.row + last.rowspan);
            let right = (first.column + first.colspan).max(last.column + last.colspan);
            let mut indices = BTreeSet::new();
            for row in top..bottom {
                for column in left..right {
                    indices.insert(grid.slots[row][column]);
                }
            }
            for &index in &indices {
                let cell = &grid.cells[index];
                if cell.row < top
                    || cell.column < left
                    || cell.row + cell.rowspan > bottom
                    || cell.column + cell.colspan > right
                {
                    return Err(EditorError::UnsupportedStructure(
                        "The merge selection cuts through an existing merged cell",
                    ));
                }
            }
            let target = &grid.cells[grid.slots[top][left]];
            if target.row != top || target.column != left {
                return Err(EditorError::UnsupportedStructure(
                    "The merge rectangle does not begin at a cell origin",
                ));
            }
            let mut children = Vec::new();
            for index in indices {
                let cell = &grid.cells[index];
                let element = cell.node.as_element().expect("cell");
                children.extend(element.children.clone());
                if cell.path != target.path {
                    edits.insert(cell.path.clone(), None);
                }
            }
            let element = target.node.as_element().expect("cell");
            let merged = Node::element(element.shell.clone(), children);
            edits.insert(
                target.path.clone(),
                Some(with_spans(&merged, bottom - top, right - left)),
            );
        }
        TableCommand::SplitCell => {
            if selected.rowspan == 1 && selected.colspan == 1 {
                return Ok(document.clone());
            }
            edits.insert(
                selected.path.clone(),
                Some(with_spans(&selected.node, 1, 1)),
            );
            let element = selected.node.as_element().expect("cell");
            for row in selected.row..selected.row + selected.rowspan {
                for column in selected.column..selected.column + selected.colspan {
                    if row == selected.row && column == selected.column {
                        continue;
                    }
                    let mut shell = element.shell.clone();
                    shell.remove_attr("rowspan");
                    shell.remove_attr("colspan");
                    shell.remove_attr("colwidth");
                    let cell = Node::element(shell, vec![Node::paragraph(Vec::new())]);
                    let index = if row == selected.row {
                        selected.path.last().copied().expect("cell index") + 1
                    } else {
                        insertion_index(document, &grid, row, column)
                    };
                    insertions
                        .entry(grid.rows[row].clone())
                        .or_default()
                        .push((index, cell));
                }
            }
        }
        TableCommand::ToggleHeaderRow => {
            let all_header = grid.cells.iter().filter(|cell| cell.row == 0).all(|cell| {
                cell.node
                    .as_element()
                    .is_some_and(|element| element.shell.tag == "th")
            });
            for cell in &grid.cells {
                if cell.row == 0 {
                    let element = cell.node.as_element().expect("cell");
                    let mut shell = element.shell.clone();
                    shell.tag = if all_header { "td" } else { "th" }.into();
                    edits.insert(
                        cell.path.clone(),
                        Some(Node::element(shell, element.children.clone())),
                    );
                }
            }
        }
        TableCommand::DeleteTable => unreachable!("handled above"),
    }
    let edited = rewrite(
        &grid.table,
        &mut grid.table_path.clone(),
        &edits,
        &insertions,
    )
    .expect("table retained");
    let mut result = document
        .replace_node(&grid.table_path, vec![edited])
        .ok_or(EditorError::MissingTextBlock)?;
    if let Some((path, mut replacements)) = row_replacement {
        // Cell/rowspan edits precede row insertion/removal, so paths refer to
        // the original geometry until the final structural operation.
        if !replacements.is_empty() {
            let existing = result.node(&path).expect("existing edited row").clone();
            if add_row_before {
                replacements[1] = existing;
            } else {
                replacements[0] = existing;
            }
        }
        result = result
            .replace_node(&path, replacements)
            .ok_or(EditorError::MissingTextBlock)?;
    }
    Ok(result)
}

fn grid_for(document: &RichDocument, cell_path: &[usize]) -> Result<Grid, EditorError> {
    let mut table_path = cell_path.to_vec();
    while !table_path.is_empty() {
        if document
            .node(&table_path)
            .and_then(Node::as_element)
            .is_some_and(|element| element.kind == NodeKind::Table)
        {
            break;
        }
        table_path.pop();
    }
    let table = document
        .node(&table_path)
        .cloned()
        .ok_or(EditorError::UnsupportedStructure(
            "The selected cell has no table",
        ))?;
    let mut rows = Vec::new();
    collect_rows(&table, &mut table_path.clone(), &mut rows);
    if rows.is_empty() || rows.len() > 100 {
        return Err(EditorError::InvalidTableSize);
    }
    let mut slots = vec![Vec::<Option<usize>>::new(); rows.len()];
    let mut cells = Vec::new();
    let mut width = 0;
    for (row, path) in rows.iter().enumerate() {
        let element = document
            .node(path)
            .and_then(Node::as_element)
            .expect("table row");
        let mut column = 0;
        for (child, node) in element.children.iter().enumerate() {
            let Some(element) = node
                .as_element()
                .filter(|element| matches!(element.kind, NodeKind::TableCell { .. }))
            else {
                continue;
            };
            while slots[row].get(column).is_some_and(Option::is_some) {
                column += 1;
            }
            let colspan = span(&element.shell, "colspan", 1).max(1);
            let rowspan_raw = span(&element.shell, "rowspan", 1);
            let rowspan = if rowspan_raw == 0 {
                rows.len() - row
            } else {
                rowspan_raw.min(rows.len() - row).max(1)
            };
            if column + colspan > 100 {
                return Err(EditorError::InvalidTableSize);
            }
            let index = cells.len();
            for slot_row in slots.iter_mut().skip(row).take(rowspan) {
                slot_row.resize(slot_row.len().max(column + colspan), None);
                for slot in slot_row.iter_mut().skip(column).take(colspan) {
                    if slot.is_some() {
                        return Err(EditorError::UnsupportedStructure(
                            "This table has overlapping merged cells",
                        ));
                    }
                    *slot = Some(index);
                }
            }
            let mut cell_path = path.clone();
            cell_path.push(child);
            cells.push(Cell {
                path: cell_path,
                row,
                column,
                rowspan,
                colspan,
                node: node.clone(),
            });
            width = width.max(column + colspan);
            column += colspan;
        }
    }
    if width == 0
        || slots
            .iter()
            .any(|row| row.len() != width || row.iter().any(Option::is_none))
    {
        return Err(EditorError::UnsupportedStructure(
            "This table has an incomplete grid; its contents were preserved",
        ));
    }
    Ok(Grid {
        table_path,
        table,
        rows,
        cells,
        slots: slots
            .into_iter()
            .map(|row| row.into_iter().map(Option::unwrap).collect())
            .collect(),
        width,
    })
}

fn collect_rows(node: &Node, path: &mut NodePath, rows: &mut Vec<NodePath>) {
    let Some(element) = node.as_element() else {
        return;
    };
    if element.kind == NodeKind::TableRow {
        rows.push(path.clone());
        return;
    }
    for (index, child) in element.children.iter().enumerate() {
        if child
            .as_element()
            .is_some_and(|element| element.kind == NodeKind::Table)
        {
            continue;
        }
        path.push(index);
        collect_rows(child, path, rows);
        path.pop();
    }
}

fn span(shell: &ElementShell, name: &str, fallback: usize) -> usize {
    shell
        .attr(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

fn with_spans(node: &Node, rowspan: usize, colspan: usize) -> Node {
    let element = node.as_element().expect("cell");
    let mut shell = element.shell.clone();
    if rowspan == 1 {
        shell.remove_attr("rowspan");
    } else {
        shell.set_attr("rowspan", rowspan.to_string());
    }
    if colspan == 1 {
        shell.remove_attr("colspan");
    } else {
        shell.set_attr("colspan", colspan.to_string());
    }
    // Column widths describe individual logical columns. A changed colspan
    // must not retain a stale width vector with a different column count.
    if colspan != span(&element.shell, "colspan", 1) {
        shell.remove_attr("colwidth");
    }
    Node::element(shell, element.children.clone())
}

fn insertion_index(document: &RichDocument, grid: &Grid, row: usize, column: usize) -> usize {
    grid.cells
        .iter()
        .filter(|cell| cell.row == row && cell.column >= column)
        .map(|cell| *cell.path.last().expect("cell child index"))
        .min()
        .unwrap_or_else(|| {
            document
                .node(&grid.rows[row])
                .and_then(Node::as_element)
                .expect("row")
                .children
                .len()
        })
}

fn rewrite(
    node: &Node,
    path: &mut NodePath,
    edits: &BTreeMap<NodePath, Option<Node>>,
    insertions: &BTreeMap<NodePath, Vec<(usize, Node)>>,
) -> Option<Node> {
    if let Some(edit) = edits.get(path) {
        return edit.clone();
    }
    let Some(element) = node.as_element() else {
        return Some(node.clone());
    };
    if element.kind.is_atom() {
        return Some(node.clone());
    }
    let mut children = Vec::new();
    let additions = insertions.get(path);
    for (index, child) in element.children.iter().enumerate() {
        if let Some(additions) = additions {
            children.extend(
                additions
                    .iter()
                    .filter(|(at, _)| *at == index)
                    .map(|(_, node)| node.clone()),
            );
        }
        path.push(index);
        if let Some(child) = rewrite(child, path, edits, insertions) {
            children.push(child);
        }
        path.pop();
    }
    if let Some(additions) = additions {
        children.extend(
            additions
                .iter()
                .filter(|(at, _)| *at >= element.children.len())
                .map(|(_, node)| node.clone()),
        );
    }
    Some(Node::element(element.shell.clone(), children))
}
