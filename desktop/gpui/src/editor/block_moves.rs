//! Closed block moves. A preview is a pure plan; only an accepted transaction
//! rebuilds the sibling vector, retaining every moved node and its metadata.

use std::ops::Range;

use super::{EditorError, Node, NodeKind, NodePath, RichDocument, Selection};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DropPlacement {
    Before,
    After,
}

/// Child indexes and insertion boundary refer to the original parent. Scalar
/// bounds use the visual editor's projection, never serialized HTML offsets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockMovePlan {
    pub parent: NodePath,
    pub source: Range<usize>,
    pub insert_at: usize,
    pub scalar_range: Range<usize>,
    pub destination: usize,
}

impl RichDocument {
    /// Build a closed top-level outline in one metadata pass at an explicit
    /// drag boundary. Repeated pointer previews can retain this index.
    pub(crate) fn section_ranges(&self) -> Vec<Range<usize>> {
        let mut sections = Vec::<Range<usize>>::new();
        let mut stack = Vec::<(u8, usize)>::new();
        for (index, node) in self.nodes().iter().enumerate() {
            let Some(NodeKind::Heading(level)) = node.as_element().map(|element| &element.kind)
            else {
                continue;
            };
            while stack.last().is_some_and(|(previous, _)| previous >= level) {
                let (_, section) = stack.pop().unwrap();
                sections[section].end = index;
            }
            stack.push((*level, sections.len()));
            sections.push(index..self.nodes().len());
        }
        sections
    }
    /// A heading carries its complete section through the next heading of the
    /// same or a higher level. Nested container headings are deliberately not
    /// treated as closed root sections.
    pub fn section_range(&self, heading: &[usize]) -> Result<Range<usize>, EditorError> {
        let [index] = heading else {
            return Err(EditorError::UnsupportedStructure(
                "only closed top-level heading sections can be reordered",
            ));
        };
        let Some(NodeKind::Heading(level)) = self
            .nodes()
            .get(*index)
            .and_then(Node::as_element)
            .map(|element| &element.kind)
        else {
            return Err(EditorError::UnsupportedStructure(
                "section source must be a heading",
            ));
        };
        let end = self
            .nodes()
            .iter()
            .enumerate()
            .skip(index + 1)
            .find_map(|(next, node)| {
                matches!(node.as_element().map(|e| &e.kind),
                Some(NodeKind::Heading(next_level)) if next_level <= level)
                .then_some(next)
            })
            .unwrap_or(self.nodes().len());
        Ok(*index..end)
    }

    pub fn plan_section_move(
        &self,
        source: &[usize],
        target: &[usize],
        placement: DropPlacement,
    ) -> Result<Option<BlockMovePlan>, EditorError> {
        let source = self.section_range(source)?;
        let target = self.section_range(target)?;
        if source.start == target.start {
            return Ok(None);
        }
        if source.contains(&target.start) {
            return Err(EditorError::UnsupportedStructure(
                "a section cannot move into itself or its child",
            ));
        }
        let insert_at = match placement {
            DropPlacement::Before => target.start,
            DropPlacement::After => target.end,
        };
        self.plan_move(&[], source, insert_at, true)
    }

    /// Complete siblings only. List/table structural children cannot be
    /// smuggled into ordinary block containers, nor moved between cells.
    pub fn plan_block_move(
        &self,
        parent: &[usize],
        source: Range<usize>,
        insert_at: usize,
    ) -> Result<Option<BlockMovePlan>, EditorError> {
        self.plan_move(parent, source, insert_at, false)
    }

    fn plan_move(
        &self,
        parent: &[usize],
        source: Range<usize>,
        insert_at: usize,
        section: bool,
    ) -> Result<Option<BlockMovePlan>, EditorError> {
        let nodes = block_children(self, parent)?;
        if source.start >= source.end || source.end > nodes.len() || insert_at > nodes.len() {
            return Err(EditorError::UnsupportedStructure(
                "block move indexes are outside the parent",
            ));
        }
        if !section
            && !nodes[source.clone()].iter().all(|node| {
                node.as_element().is_some_and(|element| {
                    element.kind.is_block()
                        && !matches!(
                            element.kind,
                            NodeKind::ListItem { .. }
                                | NodeKind::TableSection
                                | NodeKind::TableRow
                                | NodeKind::TableCell { .. }
                        )
                })
            })
        {
            return Err(EditorError::UnsupportedStructure(
                "only complete content blocks can be moved",
            ));
        }
        if source.start <= insert_at && insert_at <= source.end {
            return Ok(None);
        }
        let parent_start = self
            .offset_of_node(parent)
            .ok_or(EditorError::MissingTextBlock)?;
        let start = parent_start
            + nodes[..source.start]
                .iter()
                .map(Node::projection_len)
                .sum::<usize>();
        let length = nodes[source.clone()]
            .iter()
            .map(Node::projection_len)
            .sum::<usize>();
        let old_destination = parent_start
            + nodes[..insert_at]
                .iter()
                .map(Node::projection_len)
                .sum::<usize>();
        Ok(Some(BlockMovePlan {
            parent: parent.to_vec(),
            source,
            insert_at,
            scalar_range: start..start + length,
            destination: if old_destination > start {
                old_destination - length
            } else {
                old_destination
            },
        }))
    }
}

fn block_children<'a>(
    document: &'a RichDocument,
    parent: &[usize],
) -> Result<&'a [Node], EditorError> {
    if parent.is_empty() {
        return Ok(document.nodes());
    }
    let element = document
        .node(parent)
        .and_then(Node::as_element)
        .ok_or(EditorError::MissingTextBlock)?;
    if !matches!(
        element.kind,
        NodeKind::BlockQuote | NodeKind::ListItem { .. } | NodeKind::TableCell { .. }
    ) {
        return Err(EditorError::UnsupportedStructure(
            "this container does not accept closed content block moves",
        ));
    }
    Ok(&element.children)
}

pub(super) fn apply(
    document: &RichDocument,
    plan: &BlockMovePlan,
    selection: Selection,
    section: bool,
) -> Result<(RichDocument, Selection), EditorError> {
    let mut children = block_children(document, &plan.parent)?.to_vec();
    let moved: Vec<_> = children.drain(plan.source.clone()).collect();
    let insert_at = if plan.insert_at > plan.source.end {
        plan.insert_at - plan.source.len()
    } else {
        plan.insert_at
    };
    children.splice(insert_at..insert_at, moved);
    let next = if plan.parent.is_empty() {
        RichDocument::new(children)
    } else {
        let parent = document
            .node(&plan.parent)
            .and_then(Node::as_element)
            .ok_or(EditorError::MissingTextBlock)?;
        document
            .replace_node(
                &plan.parent,
                vec![Node::element(parent.shell.clone(), children)],
            )
            .ok_or(EditorError::MissingTextBlock)?
    };
    let selected_inside = !section
        && [selection.anchor, selection.head].iter().all(|position| {
            plan.scalar_range.start <= *position && *position <= plan.scalar_range.end
        })
        && (plan.scalar_range.contains(&selection.anchor)
            || plan.scalar_range.contains(&selection.head));
    let map = |position| {
        let range = &plan.scalar_range;
        let length = range.len();
        if !section && (range.contains(&position) || selected_inside) {
            return plan.destination + position - range.start;
        }
        let deleted = if position < range.start {
            position
        } else if position > range.end {
            position - length
        } else {
            range.start
        };
        if deleted >= plan.destination {
            deleted + length
        } else {
            deleted
        }
    };
    // The original section transaction lets ProseMirror map selection through
    // delete+insert. Atom moves can instead follow selection inside the node.
    Ok((
        next,
        Selection::new(map(selection.anchor), map(selection.head)),
    ))
}
