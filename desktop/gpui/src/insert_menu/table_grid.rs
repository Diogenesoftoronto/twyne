//! Table chooser rules from Source's table-insertion-grid.tsx.
pub const DEFAULT_ROWS: usize = 8;
pub const DEFAULT_COLUMNS: usize = 10;
pub const MAX_ROWS: usize = 20;
pub const MAX_COLUMNS: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct Dimensions {
    pub rows: usize,
    pub columns: usize,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub enum Direction {
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Home,
    End,
}

impl Dimensions {
    pub fn limits(rows: usize, columns: usize) -> Self {
        Self {
            rows: rows.clamp(1, MAX_ROWS),
            columns: columns.clamp(1, MAX_COLUMNS),
        }
    }
    pub fn clamped(self, limits: Self) -> Self {
        let limits = Self::limits(limits.rows, limits.columns);
        Self {
            rows: self.rows.clamp(1, limits.rows),
            columns: self.columns.clamp(1, limits.columns),
        }
    }
    pub fn moved(self, direction: Direction, limits: Self) -> Self {
        let limits = Self::limits(limits.rows, limits.columns);
        let mut next = self.clamped(limits);
        match direction {
            Direction::ArrowUp => next.rows = next.rows.saturating_sub(1).max(1),
            Direction::ArrowDown => next.rows = (next.rows + 1).min(limits.rows),
            Direction::ArrowLeft => next.columns = next.columns.saturating_sub(1).max(1),
            Direction::ArrowRight => next.columns = (next.columns + 1).min(limits.columns),
            Direction::Home => {
                next = Self {
                    rows: 1,
                    columns: 1,
                }
            }
            Direction::End => next = limits,
        }
        next
    }
    pub fn contains(self, cell: Self) -> bool {
        cell.rows <= self.rows && cell.columns <= self.columns
    }
}
