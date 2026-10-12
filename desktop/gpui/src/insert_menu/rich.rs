//! One atomic native document transaction: remove the query and apply its intent.
use super::{SlashQuery, detect_rich, parameters::Parameters};
use crate::editor::{
    BlockObject, Command, CommandOutcome, EditDelta, EditorError, ImageAttributes, InlineObject,
    Mark, MarkKind, NoteKind, RichEditor, Selection,
};

pub fn apply(
    editor: &mut RichEditor,
    query: &SlashQuery,
    expected_revision: u64,
    id: &str,
    values: &Parameters,
) -> Result<CommandOutcome, EditorError> {
    if editor.is_read_only() {
        return Err(EditorError::ReadOnly);
    }
    if !super::commands().iter().any(|command| command.id == id) {
        return Err(EditorError::UnsupportedStructure(
            "Unknown insertion command.",
        ));
    }
    if editor.revision() != expected_revision
        || detect_rich(editor.document(), editor.selection()).as_ref() != Some(query)
    {
        return Err(EditorError::UnsupportedStructure(
            "The insertion position has changed. Type / again.",
        ));
    }
    // Resolve and validate before touching history. Failed commands never
    // delete a typed slash or partially mutate the accepted editor.
    let commands = intents(id, values)?;
    let mut accepted = editor.clone();
    let before = accepted.selection();
    accepted.begin_history_group();
    accepted.set_selection(Selection::new(query.range.start, query.range.end))?;
    let mut outcome = accepted.execute(Command::ReplaceSelection(String::new()))?;
    for command in commands {
        let next = accepted.execute(command)?;
        outcome.document_changed |= next.document_changed;
        outcome.history_changed |= next.history_changed;
        outcome.edit_delta = match (outcome.edit_delta, next.edit_delta) {
            (Some(a), Some(b)) => Some(EditDelta {
                inserted_utf16: a.inserted_utf16.saturating_add(b.inserted_utf16),
                deleted_utf16: a.deleted_utf16.saturating_add(b.deleted_utf16),
            }),
            _ => None,
        };
    }
    accepted.end_history_group();
    outcome.selection_changed = before != accepted.selection();
    *editor = accepted;
    Ok(outcome)
}

/// Source removes the query when a parameter flow opens, not when it commits.
pub fn remove_query(
    editor: &mut RichEditor,
    query: &SlashQuery,
    expected_revision: u64,
) -> Result<CommandOutcome, EditorError> {
    if editor.is_read_only() {
        return Err(EditorError::ReadOnly);
    }
    if editor.revision() != expected_revision
        || detect_rich(editor.document(), editor.selection()).as_ref() != Some(query)
    {
        return Err(EditorError::UnsupportedStructure(
            "The insertion position has changed. Type / again.",
        ));
    }
    let mut accepted = editor.clone();
    let before = accepted.selection();
    accepted.set_selection(Selection::new(query.range.start, query.range.end))?;
    let mut outcome = accepted.execute(Command::ReplaceSelection(String::new()))?;
    outcome.selection_changed = before != accepted.selection();
    *editor = accepted;
    Ok(outcome)
}

/// A retained parameter flow is bound to the post-removal cursor/revision.
pub fn apply_at(
    editor: &mut RichEditor,
    expected_revision: u64,
    selection: Selection,
    id: &str,
    values: &Parameters,
) -> Result<CommandOutcome, EditorError> {
    if editor.is_read_only() {
        return Err(EditorError::ReadOnly);
    }
    if editor.revision() != expected_revision
        || editor.selection() != selection
        || !selection.is_empty()
    {
        return Err(EditorError::UnsupportedStructure(
            "The insertion position has changed. Type / again.",
        ));
    }
    if !super::commands().iter().any(|command| command.id == id) {
        return Err(EditorError::UnsupportedStructure(
            "Unknown insertion command.",
        ));
    }
    let commands = intents(id, values)?;
    let mut accepted = editor.clone();
    accepted.begin_history_group();
    let mut outcome = CommandOutcome::default();
    for command in commands {
        let next = accepted.execute(command)?;
        let previous_changed = outcome.document_changed;
        outcome.document_changed |= next.document_changed;
        outcome.history_changed |= next.history_changed;
        outcome.edit_delta = match (outcome.edit_delta, next.edit_delta) {
            (Some(a), Some(b)) => Some(EditDelta {
                inserted_utf16: a.inserted_utf16.saturating_add(b.inserted_utf16),
                deleted_utf16: a.deleted_utf16.saturating_add(b.deleted_utf16),
            }),
            (None, delta) if !previous_changed => delta,
            (delta, None) if !next.document_changed => delta,
            _ => None,
        };
    }
    accepted.end_history_group();
    outcome.selection_changed = selection != accepted.selection();
    *editor = accepted;
    Ok(outcome)
}

fn intents(id: &str, values: &Parameters) -> Result<Vec<Command>, EditorError> {
    let invalid =
        || EditorError::UnsupportedStructure("Complete the insertion fields before inserting.");
    if let Parameters::None = values
        && let Some(command) = Command::from_id(id)
    {
        return Ok(vec![command]);
    }
    Ok(match (id, values) {
        (
            "insert.table",
            Parameters::Table {
                rows,
                columns,
                header,
            },
        ) => {
            let object = BlockObject::Table {
                rows: *rows,
                columns: *columns,
                header: *header,
            };
            object.node()?;
            vec![Command::InsertBlock(object)]
        }
        ("insert.link", Parameters::Link { text, href })
            if !text.trim().is_empty() && !href.trim().is_empty() =>
        {
            vec![
                Command::SetMark(Mark::Link { href: href.clone() }),
                Command::InsertText(text.clone()),
                Command::UnsetMark(MarkKind::Link),
            ]
        }
        ("insert.image", Parameters::Image { src, alt }) if !src.trim().is_empty() => {
            vec![Command::InsertBlock(BlockObject::Image(ImageAttributes {
                src: src.clone(),
                alt: alt.clone(),
                ..Default::default()
            }))]
        }
        ("insert.mermaid", Parameters::Text(source)) if !source.trim().is_empty() => {
            vec![Command::InsertBlock(BlockObject::Mermaid {
                source: source.clone(),
            })]
        }
        ("insert.math-inline", Parameters::None) => {
            vec![Command::InsertInline(InlineObject::Math {
                source: String::new(),
            })]
        }
        ("insert.math-block", Parameters::None) => vec![Command::InsertBlock(BlockObject::Math {
            source: String::new(),
        })],
        ("insert.math-inline", Parameters::Text(source)) if !source.trim().is_empty() => {
            vec![Command::InsertInline(InlineObject::Math {
                source: source.clone(),
            })]
        }
        ("insert.math-block", Parameters::Text(source)) if !source.trim().is_empty() => {
            vec![Command::InsertBlock(BlockObject::Math {
                source: source.clone(),
            })]
        }
        ("insert.endnote" | "insert.footnote", Parameters::Text(text))
            if !text.trim().is_empty() =>
        {
            vec![
                Command::InsertInline(InlineObject::Note {
                    kind: if id == "insert.footnote" {
                        NoteKind::Footnote
                    } else {
                        NoteKind::Endnote
                    },
                    text: text.clone(),
                }),
                Command::InsertText(" ".into()),
            ]
        }
        _ => return Err(invalid()),
    })
}
