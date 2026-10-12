//! Cold insertion operations for exact-text Markdown drafts.
//! Detection is separate and reads only the current line on each keystroke.
use super::{SlashQuery, detect, parameters::Parameters};
use std::ops::Range;

#[derive(Debug, PartialEq, Eq)]
pub struct Edit {
    pub range: Range<usize>,
    pub text: String,
    /// Absolute UTF-8 byte selection after this atomic edit.
    pub selection: Range<usize>,
}

pub fn plan(
    text: &str,
    query: &SlashQuery,
    id: &str,
    values: &Parameters,
) -> Result<Edit, &'static str> {
    let range = &query.range;
    if range.start > range.end || text.get(range.clone()) != Some(&format!("/{}", query.query)) {
        return Err("The insertion position has changed. Type / again.");
    }
    let line_start = text[..range.start].rfind('\n').map_or(0, |v| v + 1);
    let detected = detect(&text[line_start..range.end]);
    if detected.is_none_or(|v| v.query != query.query || v.range.start + line_start != range.start)
    {
        return Err("The insertion position has changed. Type / again.");
    }
    plan_validated(text, query.range.clone(), id, values)
}

/// Insertion after a parameter command has already removed its slash query.
pub fn plan_at(
    text: &str,
    position: usize,
    id: &str,
    values: &Parameters,
) -> Result<Edit, &'static str> {
    if !text.is_char_boundary(position) {
        return Err("The insertion position has changed. Type / again.");
    }
    plan_validated(text, position..position, id, values)
}

fn plan_validated(
    text: &str,
    range: Range<usize>,
    id: &str,
    values: &Parameters,
) -> Result<Edit, &'static str> {
    let line_start = text[..range.start].rfind('\n').map_or(0, |v| v + 1);
    let line_end = text[range.end..]
        .find('\n')
        .map_or(text.len(), |v| range.end + v);
    let line_end = if text[..line_end].ends_with('\r') {
        line_end - 1
    } else {
        line_end
    };
    let mut line = String::from(&text[line_start..range.start]);
    line.push_str(&text[range.end..line_end]);
    let prefix = match id {
        "paragraph.heading-1" => Some("# "),
        "paragraph.heading-2" => Some("## "),
        "paragraph.heading-3" => Some("### "),
        "paragraph.bullet-list" => Some("- "),
        "paragraph.numbered-list" => Some("1. "),
        "paragraph.task-list" => Some("- [ ] "),
        "paragraph.blockquote" => Some("> "),
        _ => None,
    };
    if let Some(prefix) = prefix {
        let before = &text[line_start..range.start];
        let indent = before.len() - before.trim_start_matches([' ', '\t']).len();
        let proposed = strip_prefix(&line[indent..]);
        let removed = line.len() - indent - proposed.len();
        // A marker in the suffix was authored after the caret; do not
        // mistake it for the paragraph prefix being converted.
        let (stripped, removed) = if indent + removed <= before.len() {
            (proposed, removed)
        } else {
            (&line[indent..], 0)
        };
        let mut replacement = line[..indent].to_owned();
        replacement.push_str(prefix);
        replacement.push_str(stripped);
        let caret = line_start + (range.start - line_start).saturating_sub(removed) + prefix.len();
        let caret = caret.min(line_start + replacement.len());
        return Ok(Edit {
            range: line_start..line_end,
            text: replacement,
            selection: caret..caret,
        });
    }
    if id == "paragraph.code-block" {
        let fence = fence(&line);
        let replacement = format!("{fence}\n{line}\n{fence}");
        let caret = line_start + fence.len() + 1 + range.start - line_start;
        return Ok(Edit {
            range: line_start..line_end,
            text: replacement,
            selection: caret..caret,
        });
    }
    let (snippet, block) = match (id, values) {
        ("insert.horizontal-rule", _) => ("---".to_owned(), true),
        ("insert.page-break", _) => (
            "<div data-type=\"page-break\" data-page-break=\"true\"></div>".into(),
            true,
        ),
        ("insert.link", Parameters::Link { text, href })
            if !text.trim().is_empty() && !href.trim().is_empty() =>
        {
            (
                format!("[{}](<{}>)", escape_label(text), escape_destination(href)),
                false,
            )
        }
        ("insert.image", Parameters::Image { src, alt }) if !src.trim().is_empty() => (
            format!("![{}](<{}>)", escape_label(alt), escape_destination(src)),
            true,
        ),
        ("insert.math-inline", Parameters::None) => (inline_math_html(""), false),
        ("insert.math-block", Parameters::None) => (block_math_html(""), true),
        ("insert.math-inline", Parameters::Text(source)) if !source.trim().is_empty() => (
            if source.contains('$') {
                inline_math_html(source)
            } else {
                format!("${source}$")
            },
            false,
        ),
        ("insert.math-block", Parameters::Text(source)) if !source.trim().is_empty() => (
            if source.contains('$') {
                block_math_html(source)
            } else {
                format!("$$\n{source}\n$$")
            },
            true,
        ),
        ("insert.mermaid", Parameters::Text(source)) if !source.trim().is_empty() => {
            let fence = fence(source);
            (format!("{fence}mermaid\n{source}\n{fence}"), true)
        }
        (
            "insert.table",
            Parameters::Table {
                rows,
                columns,
                header,
            },
        ) if (1..=100).contains(rows) && (1..=100).contains(columns) => {
            (table(*rows, *columns, *header), true)
        }
        ("insert.endnote" | "insert.footnote", Parameters::Text(note))
            if !note.trim().is_empty() =>
        {
            let kind = if id == "insert.footnote" {
                "footnote"
            } else {
                "endnote"
            };
            let mut index = 1;
            while text.contains(&format!("[^{kind}-{index}]")) {
                index += 1;
            }
            let reference = format!("[^{kind}-{index}]");
            let mut replacement = text[..range.start].to_owned();
            replacement.push_str(&reference);
            let caret = replacement.len();
            replacement.push_str(&text[range.end..]);
            if !replacement.ends_with('\n') {
                replacement.push('\n');
            }
            replacement.push_str(&format!(
                "\n{reference}: {}\n",
                note.replace('\n', "\n    ")
            ));
            return Ok(Edit {
                range: 0..text.len(),
                text: replacement,
                selection: caret..caret,
            });
        }
        _ => return Err("Complete the insertion fields before inserting."),
    };
    let before = &text[..range.start];
    let after = &text[range.end..];
    let leading = if !block || before.is_empty() || before.ends_with("\n\n") {
        ""
    } else if before.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let trailing = if !block || after.starts_with("\n\n") {
        ""
    } else if after.starts_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let replacement = format!("{leading}{snippet}{trailing}");
    let caret = range.start + leading.len() + snippet.len() + trailing.len();
    Ok(Edit {
        range: range.clone(),
        text: replacement,
        selection: caret..caret,
    })
}

fn strip_prefix(line: &str) -> &str {
    if let Some(rest) = line
        .strip_prefix("- [ ] ")
        .or_else(|| line.strip_prefix("- [x] "))
        .or_else(|| line.strip_prefix("- [X] "))
    {
        return rest;
    }
    if let Some(rest) = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))
        .or_else(|| line.strip_prefix("> "))
    {
        return rest;
    }
    let heading = line.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&heading) && line.as_bytes().get(heading) == Some(&b' ') {
        return &line[heading + 1..];
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && (line[digits..].starts_with(". ") || line[digits..].starts_with(") ")) {
        return &line[digits + 2..];
    }
    line
}
fn escape_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}
fn escape_destination(value: &str) -> String {
    value
        .replace('<', "%3C")
        .replace('>', "%3E")
        .replace(['\r', '\n'], "")
}
fn fence(value: &str) -> String {
    let longest = value.split(|ch| ch != '`').map(str::len).max().unwrap_or(0);
    "`".repeat(3.max(longest + 1))
}
fn inline_math_html(source: &str) -> String {
    use crate::editor::{InlineObject, Node, RichDocument};
    let html = RichDocument::new(vec![Node::paragraph(vec![
        InlineObject::Math {
            source: source.to_owned(),
        }
        .node(),
    ])])
    .to_html();
    html.strip_prefix("<p>")
        .and_then(|s| s.strip_suffix("</p>"))
        .unwrap()
        .to_owned()
}
fn block_math_html(source: &str) -> String {
    use crate::editor::{BlockObject, RichDocument};
    RichDocument::new(vec![
        BlockObject::Math {
            source: source.to_owned(),
        }
        .node()
        .unwrap(),
    ])
    .to_html()
}
fn table(rows: usize, columns: usize, header: bool) -> String {
    if !header {
        let cells = "<td></td>".repeat(columns);
        return format!(
            "<table><tbody>{}</tbody></table>",
            format!("<tr>{cells}</tr>").repeat(rows)
        );
    }
    let line = format!("|{}", "   |".repeat(columns));
    let separator = format!("|{}", " --- |".repeat(columns));
    let mut result = format!("{line}\n{separator}");
    for _ in 1..rows {
        result.push('\n');
        result.push_str(&line);
    }
    result
}
