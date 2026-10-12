//! Native Typst source editing adapters. The syntax rules and snippets follow
//! `typst-code-editor.ts`; source remains a rope until a save/apply boundary.

use crate::theme;
use gpui_kit::component::input::{
    EditorState, FoldRange, HighlightStyleResolver, InputEdit, InputHighlighter, Rope, RopeExt,
};
use gpui_kit::{Context, FontStyle, FontWeight, HighlightStyle, SharedString, Window, rgb};
use std::{ops::Range, rc::Rc};

#[derive(Clone, Copy, Debug)]
pub enum Snippet {
    Bold,
    Italic,
    Heading,
    Equation,
    Link,
    PageBreak,
}

pub struct SourceInsertion {
    pub text: String,
    pub selection: Range<usize>,
}

pub fn snippet(kind: Snippet, selected: &str, at_line_start: bool) -> SourceInsertion {
    let (before, after, placeholder, block) = match kind {
        Snippet::Bold => ("*", "*", "bold text", false),
        Snippet::Italic => ("_", "_", "italic text", false),
        Snippet::Heading => ("= ", "", "Heading", true),
        Snippet::Equation => ("$ ", " $", "x^2 + y^2 = z^2", false),
        Snippet::Link => ("#link(\"https://example.com\")[", "]", "link text", false),
        Snippet::PageBreak => ("#pagebreak()", "", "", true),
    };
    let content = if selected.is_empty() {
        placeholder
    } else {
        selected
    };
    let prefix = if block && !at_line_start { "\n" } else { "" };
    let suffix = if block { "\n" } else { "" };
    let start = prefix.len() + before.len();
    SourceInsertion {
        text: format!("{prefix}{before}{content}{after}{suffix}"),
        selection: start..start + content.len(),
    }
}

/// Toggle the selected *logical* lines as one edit, preserving CRLF and Unicode.
/// Callers expand the byte selection to complete lines before passing it here.
pub fn toggle_line_comments(text: &str) -> String {
    comment_edit(text, 0..0).text
}

/// CodeMirror's line-comment command uses the smallest selected indent and
/// maps the existing caret/selection through the edit. Offsets are relative
/// UTF-8 bytes; an endpoint after the final selected line is also mapped.
pub fn comment_edit(text: &str, selection: Range<usize>) -> SourceInsertion {
    struct Line<'a> {
        offset: usize,
        content: &'a str,
        indent: usize,
        indent_chars: usize,
    }
    let mut lines = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let content = line.strip_suffix('\n').unwrap_or(line);
        let content = content.strip_suffix('\r').unwrap_or(content);
        let indent_chars = content
            .chars()
            .take_while(|ch| ch.is_whitespace() || *ch == '\u{feff}')
            .count();
        let indent = content
            .char_indices()
            .nth(indent_chars)
            .map_or(content.len(), |(at, _)| at);
        lines.push(Line {
            offset,
            content,
            indent,
            indent_chars,
        });
        offset += line.len();
    }
    if lines.is_empty() {
        lines.push(Line {
            offset: 0,
            content: "",
            indent: 0,
            indent_chars: 0,
        });
    }
    let single = lines.len() == 1;
    let comment = lines.iter().any(|line| {
        (single || line.indent < line.content.len())
            && !line.content[line.indent..].starts_with("//")
    });
    let min_indent = lines
        .iter()
        .filter(|line| line.indent < line.content.len())
        .map(|line| line.indent_chars)
        .min();
    let mut changes: Vec<(Range<usize>, &str)> = Vec::new();
    for line in lines {
        if comment {
            if single || line.indent < line.content.len() {
                let indent_chars = min_indent.unwrap_or(line.indent_chars);
                let indent = line
                    .content
                    .char_indices()
                    .nth(indent_chars)
                    .map_or(line.content.len(), |(at, _)| at);
                let at = line.offset + indent;
                changes.push((at..at, "// "));
            }
        } else if line.content[line.indent..].starts_with("//") {
            let start = line.offset + line.indent;
            let space = usize::from(line.content[line.indent + 2..].starts_with(' '));
            changes.push((start..start + 2 + space, ""));
        }
    }
    let map = |position: usize| {
        let mut removed = 0;
        let mut inserted = 0;
        for (range, replacement) in &changes {
            if position < range.start {
                break;
            }
            if position < range.end {
                return range.start - removed + inserted + replacement.len();
            }
            removed += range.len();
            inserted += replacement.len();
        }
        position - removed + inserted
    };
    let mapped = map(selection.start)..map(selection.end);
    let mut output = String::with_capacity(text.len() + inserted_comment_capacity(&changes));
    let mut from = 0;
    for (range, replacement) in changes {
        output.push_str(&text[from..range.start]);
        output.push_str(replacement);
        from = range.end;
    }
    output.push_str(&text[from..]);
    SourceInsertion {
        text: output,
        selection: mapped,
    }
}

fn inserted_comment_capacity(changes: &[(Range<usize>, &str)]) -> usize {
    changes.iter().map(|(_, text)| text.len()).sum()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TokenKind {
    Keyword,
    String,
    Number,
    Heading,
    Comment,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Token {
    range: Range<usize>,
    kind: TokenKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LexedLine {
    text: String,
    incoming_comment: bool,
    outgoing_comment: bool,
    tokens: Vec<Token>,
}

fn word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn lex_line(text: String, mut comment: bool) -> LexedLine {
    let incoming_comment = comment;
    let bytes = text.as_bytes();
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let start = at;
        let remaining = &text[at..];
        let kind = if comment {
            if let Some(end) = remaining.find("*/") {
                at += end + 2;
                comment = false;
            } else {
                at = bytes.len();
            }
            Some(TokenKind::Comment)
        } else if remaining.starts_with("//") {
            at = bytes.len();
            Some(TokenKind::Comment)
        } else if remaining.starts_with("/*") {
            at += 2;
            comment = true;
            if let Some(end) = text[at..].find("*/") {
                at += end + 2;
                comment = false;
            } else {
                at = bytes.len();
            }
            Some(TokenKind::Comment)
        } else if bytes[at] == b'"' {
            at += 1;
            while at < bytes.len() {
                if bytes[at] == b'\\' {
                    at += 1;
                    if at < bytes.len() {
                        at += text[at..].chars().next().unwrap().len_utf8();
                    }
                } else if bytes[at] == b'"' {
                    at += 1;
                    break;
                } else {
                    at += text[at..].chars().next().unwrap().len_utf8();
                }
            }
            Some(TokenKind::String)
        } else if at == 0 && bytes[at] == b'=' {
            let mut end = at;
            while end < bytes.len() && bytes[end] == b'=' {
                end += 1;
            }
            if text[end..].chars().next().is_some_and(char::is_whitespace) {
                at = bytes.len();
                Some(TokenKind::Heading)
            } else {
                at += 1;
                None
            }
        } else if bytes[at] == b'#'
            && bytes
                .get(at + 1)
                .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
        {
            at += 2;
            while at < bytes.len() && (word(bytes[at]) || bytes[at] == b'-') {
                at += 1;
            }
            Some(TokenKind::Keyword)
        } else if bytes[at].is_ascii_digit() && (at == 0 || !word(bytes[at - 1])) {
            at += 1;
            while at < bytes.len() && bytes[at].is_ascii_digit() {
                at += 1;
            }
            if bytes.get(at) == Some(&b'.') && bytes.get(at + 1).is_some_and(u8::is_ascii_digit) {
                at += 1;
                while at < bytes.len() && bytes[at].is_ascii_digit() {
                    at += 1;
                }
            }
            if let Some(unit) = ["pt", "em", "cm", "mm", "in", "%"]
                .into_iter()
                .find(|unit| text[at..].starts_with(unit))
            {
                at += unit.len();
            }
            Some(TokenKind::Number)
        } else if bytes[at].is_ascii_alphabetic() && (at == 0 || !word(bytes[at - 1])) {
            at += 1;
            while at < bytes.len() && word(bytes[at]) {
                at += 1;
            }
            [
                "true", "false", "none", "auto", "let", "set", "show", "import", "include",
            ]
            .contains(&&text[start..at])
            .then_some(TokenKind::Keyword)
        } else {
            at += text[at..].chars().next().unwrap().len_utf8();
            None
        };
        if let Some(kind) = kind {
            tokens.push(Token {
                range: start..at,
                kind,
            });
        }
    }
    LexedLine {
        text,
        incoming_comment,
        outgoing_comment: comment,
        tokens,
    }
}

#[derive(Default)]
struct LexCache {
    text: Rope,
    lines: Vec<Option<LexedLine>>,
}

impl LexCache {
    /// Reparse the changed lines and propagate block-comment state only until
    /// an unchanged cached line agrees. Unrelated paragraphs are not scanned.
    fn update(&mut self, edit: Option<InputEdit>, text: &Rope) -> usize {
        let start = if let Some(edit) = edit.filter(|_| !self.lines.is_empty()) {
            let start = edit.start_position.row.min(self.lines.len());
            let old_end = (edit.old_end_position.row + 1).min(self.lines.len());
            let new_count = edit.new_end_position.row.saturating_sub(start) + 1;
            self.lines.splice(
                start..old_end,
                std::iter::repeat_with(|| None).take(new_count),
            );
            start
        } else {
            self.lines.clear();
            self.lines.resize_with(text.lines_len(), || None);
            0
        };
        self.lines.resize_with(text.lines_len(), || None);
        self.text = text.clone();
        let mut comment = start
            .checked_sub(1)
            .and_then(|row| self.lines[row].as_ref())
            .is_some_and(|line| line.outgoing_comment);
        let mut parsed = 0;
        for row in start..self.lines.len() {
            let text = self.text.slice_line(row).to_string();
            if self.lines[row]
                .as_ref()
                .is_some_and(|line| line.text == text && line.incoming_comment == comment)
            {
                break;
            }
            let line = lex_line(text, comment);
            comment = line.outgoing_comment;
            self.lines[row] = Some(line);
            parsed += 1;
        }
        parsed
    }
}

struct TypstHighlighter {
    cache: LexCache,
    colors: theme::Palette,
}

impl TypstHighlighter {
    fn style(&self, kind: TokenKind) -> HighlightStyle {
        HighlightStyle {
            color: Some(
                rgb(match kind {
                    TokenKind::Keyword => self.colors.vermilion,
                    TokenKind::String => self.colors.cobalt,
                    TokenKind::Number => self.colors.writer_note,
                    TokenKind::Heading => self.colors.ink,
                    TokenKind::Comment => self.colors.ink_light,
                })
                .into(),
            ),
            font_weight: (kind == TokenKind::Heading).then_some(FontWeight::SEMIBOLD),
            font_style: (kind == TokenKind::Comment).then_some(FontStyle::Italic),
            ..Default::default()
        }
    }
}

impl InputHighlighter for TypstHighlighter {
    fn language(&self) -> SharedString {
        "typst".into()
    }

    fn update(
        &mut self,
        edit: Option<InputEdit>,
        text: &Rope,
        _: bool,
        _: &mut Window,
        cx: &mut Context<EditorState>,
    ) {
        self.colors = *theme::palette(cx);
        self.cache.update(edit, text);
    }

    fn styles(
        &self,
        range: &Range<usize>,
        _: &dyn HighlightStyleResolver,
    ) -> Vec<(Range<usize>, HighlightStyle)> {
        let mut result = Vec::new();
        let mut cursor = range.start;
        let start_line = self.cache.text.offset_to_point(range.start).row;
        let end_line = self
            .cache
            .text
            .offset_to_point(range.end)
            .row
            .min(self.cache.lines.len().saturating_sub(1));
        for row in start_line..=end_line {
            let offset = self.cache.text.line_start_offset(row);
            let Some(line) = self.cache.lines.get(row).and_then(Option::as_ref) else {
                continue;
            };
            for token in &line.tokens {
                let start = (offset + token.range.start).max(range.start);
                let end = (offset + token.range.end).min(range.end);
                if start >= end {
                    continue;
                }
                if cursor < start {
                    result.push((cursor..start, HighlightStyle::default()));
                }
                result.push((start..end, self.style(token.kind)));
                cursor = end;
            }
        }
        if cursor < range.end {
            result.push((cursor..range.end, HighlightStyle::default()));
        }
        result
    }

    fn fold_ranges(&self, text: &Rope) -> Vec<FoldRange> {
        if text.slice_line(0) != "// twyne-document:1" {
            return Vec::new();
        }
        self.cache
            .lines
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, line)| {
                line.as_ref()
                    .is_some_and(|line| line.text == "// twyne-document:body")
            })
            // Kit keeps a fold's final line visible. The original editor
            // also folds the body marker, leaving the first authored line.
            .map_or_else(Vec::new, |(row, _)| vec![FoldRange::new(0, row + 1)])
    }
}

pub fn install_highlighter(state: &mut EditorState, cx: &mut Context<EditorState>) {
    let colors = *theme::palette(cx);
    state.set_highlighter_factory(
        Rc::new(move |language| {
            (language == "typst").then(|| {
                Box::new(TypstHighlighter {
                    cache: LexCache::default(),
                    colors,
                }) as Box<dyn InputHighlighter>
            })
        }),
        cx,
    );
}

/// Hydration is an explicit freshness boundary. Fold the original generated
/// helpers while keeping authored source byte-for-byte and history empty.
pub fn set_source(
    state: &mut EditorState,
    source: impl Into<SharedString>,
    window: &mut Window,
    cx: &mut Context<EditorState>,
) {
    let source = source.into();
    if state.text().slice(..) == source.as_ref() {
        return;
    }
    state.set_value(source.as_ref(), window, cx);
    let text = state.text();
    if text.slice_line(0) != "// twyne-document:1" {
        return;
    }
    let Some(row) = text
        .iter_lines()
        .enumerate()
        .skip(1)
        .find(|(_, line)| *line == "// twyne-document:body")
        .map(|(row, _)| row)
    else {
        return;
    };
    state.apply_highlighter_fold_candidates(vec![FoldRange::new(0, row + 1)], cx);
    state.set_folded(0, true, cx);
    let body_start = state
        .text()
        .line_start_offset(row + 1)
        .min(state.text().len());
    state.set_selected_range(body_start..body_start, cx);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippets_preserve_unicode_and_select_the_inserted_contents() {
        let inserted = snippet(Snippet::Link, "Café 東京", true);
        assert_eq!(&inserted.text[inserted.selection], "Café 東京");
        let heading = snippet(Snippet::Heading, "", false);
        assert_eq!(heading.text, "\n= Heading\n");
        assert_eq!(&heading.text[heading.selection], "Heading");
        assert_eq!(snippet(Snippet::PageBreak, "", true).text, "#pagebreak()\n");
    }

    #[test]
    fn comments_round_trip_crlf_unicode_and_blank_lines() {
        let source = "  Café\r\n\t東京\r\n\r\n";
        let commented = toggle_line_comments(source);
        assert_eq!(commented, " //  Café\r\n\t// 東京\r\n\r\n");
        assert_eq!(toggle_line_comments(&commented), source);
    }

    #[test]
    fn comments_preserve_the_caret_and_map_multiline_selections() {
        let text = "  Café 東京";
        let caret = text.find('東').unwrap();
        let edit = comment_edit(text, caret..caret);
        assert_eq!(edit.selection, caret + 3..caret + 3);
        assert_eq!(&edit.text[edit.selection.start..], "東京");
        let uncommented = comment_edit(&edit.text, edit.selection);
        assert_eq!(uncommented.text, text);
        assert_eq!(uncommented.selection, caret..caret);

        let source = "  one\r\n    two\r\n\r\n";
        let selected = 2..source.len();
        let edit = comment_edit(source, selected.clone());
        assert_eq!(edit.text, "  // one\r\n  //   two\r\n\r\n");
        assert_eq!(edit.selection, 5..source.len() + 6);
        let uncommented = comment_edit(&edit.text, edit.selection);
        assert_eq!(uncommented.text, source);
        assert_eq!(uncommented.selection, selected);

        let blank = comment_edit("", 0..0);
        assert_eq!(blank.text, "// ");
        assert_eq!(blank.selection, 3..3);
        let beyond_line = comment_edit("one", 0..4);
        assert_eq!(beyond_line.selection, 3..7);
    }

    #[test]
    fn lexer_matches_typst_reference_rules_and_utf8_boundaries() {
        let line = lex_line("#set text(12pt, \"Café\\\"東京\") // note".into(), false);
        assert_eq!(
            line.tokens
                .iter()
                .map(|token| token.kind)
                .collect::<Vec<_>>(),
            [
                TokenKind::Keyword,
                TokenKind::Number,
                TokenKind::String,
                TokenKind::Comment
            ]
        );
        for token in &line.tokens {
            assert!(
                line.text.is_char_boundary(token.range.start)
                    && line.text.is_char_boundary(token.range.end)
            );
        }
        assert_eq!(
            lex_line("== Heading".into(), false).tokens[0].kind,
            TokenKind::Heading
        );
        assert!(lex_line("/* comment".into(), false).outgoing_comment);
        assert!(!lex_line("closed */ #let a = true".into(), true).outgoing_comment);
    }

    #[test]
    fn ordinary_typing_reparses_only_the_changed_line() {
        let mut cache = LexCache::default();
        let text = Rope::from(
            (0..1000)
                .map(|row| format!("Paragraph {row}\n"))
                .collect::<String>(),
        );
        cache.update(None, &text);
        let mut changed = text.clone();
        let offset = text.line_start_offset(500);
        changed.replace(offset..offset, "Café ");
        let edit = InputEdit {
            start_byte: offset,
            old_end_byte: offset,
            new_end_byte: offset + 6,
            start_position: text.offset_to_point(offset),
            old_end_position: text.offset_to_point(offset),
            new_end_position: changed.offset_to_point(offset + 6),
        };
        assert_eq!(cache.update(Some(edit), &changed), 1);
        assert!(cache.lines[999].as_ref().unwrap().text.contains("999"));
    }
}
