//! View-only English break opportunities, expressed in original scalar offsets.
//!
//! The browser's dictionary and exact line-breaking algorithm are not a public
//! CSS contract. This follows the current manuscript CSS and Chromium's default
//! English limits, using the already shipped US English TeX pattern trie. The
//! native shaped layout still decides whether a discretionary break fits.

use hypher::{Lang, hyphenate_bounded};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

use crate::editor::{ElementShell, NodeKind, RichBlock, RunContent};

#[derive(Default)]
pub(super) struct Hyphenation {
    breaks: Vec<usize>,
    words: Vec<Range<usize>>,
    graphemes: Vec<usize>,
    emergency: Vec<usize>,
    segments: Vec<usize>,
}

impl Hyphenation {
    pub(super) fn for_block(block: &RichBlock, inherited_language: &str) -> Self {
        let Some(element) = block.node.as_element() else {
            return Self::default();
        };
        let language = element.shell.attr("lang").unwrap_or(inherited_language);
        let paragraph_auto =
            block.kind == NodeKind::Paragraph && automatic(&element.shell, true, true);
        let mut text = String::new();
        let mut eligible = Vec::new();
        let block_wrap = emergency_wrap(&element.shell, true);
        let mut wrap_eligible = Vec::new();
        for run in &block.runs {
            let mut run_language = language;
            let mut run_auto = paragraph_auto;
            let mut run_wrap = block_wrap;
            for wrapper in &run.wrappers {
                run_language = wrapper.attr("lang").unwrap_or(run_language);
                run_auto = automatic(wrapper, run_auto, false);
                run_wrap = emergency_wrap(wrapper, run_wrap);
            }
            let enabled = run_auto && english_dictionary(run_language);
            match &run.content {
                RunContent::Text(value) => {
                    text.push_str(value);
                    eligible.extend(value.chars().map(|_| enabled));
                    wrap_eligible.extend(value.chars().map(|_| run_wrap));
                }
                RunContent::HardBreak => {
                    text.push('\n');
                    eligible.push(false);
                    wrap_eligible.push(false);
                }
                RunContent::Object(node) if node.projection_len() != 0 => {
                    text.push('\u{fffc}');
                    eligible.push(false);
                    wrap_eligible.push(false);
                }
                RunContent::Object(_) | RunContent::Comment(_) => {}
            }
        }
        let mut breaks = Vec::new();
        let mut words = Vec::new();
        let mut previous_byte = 0;
        let mut scalar = 0;
        for (byte, word) in text.unicode_word_indices() {
            scalar += text[previous_byte..byte].chars().count();
            let length = word.chars().count();
            words.push(scalar..scalar + length);
            // Conservative US English scope. Avoid capitalized words, as
            // Chromium does for English, and never split a Unicode grapheme.
            // Bound dictionary work for pathological unbroken pasted strings.
            if block.kind == NodeKind::Paragraph
                && (5..=128).contains(&length)
                && word.bytes().all(|byte| byte.is_ascii_alphabetic())
                && word.as_bytes()[0].is_ascii_lowercase()
                && !touches_url_separator(&text, byte, byte + word.len())
                && eligible[scalar..scalar + length].iter().all(|value| *value)
            {
                let mut prefix = 0;
                let mut syllables = hyphenate_bounded(word, Lang::English, 2, 2).peekable();
                while let Some(syllable) = syllables.next() {
                    prefix += syllable.len(); // The eligible word is ASCII.
                    if syllables.peek().is_some() {
                        breaks.push(scalar + prefix);
                    }
                }
            }
            scalar += length;
            previous_byte = byte + word.len();
        }
        let mut graphemes = Vec::new();
        let mut emergency = Vec::new();
        let mut scalar = 0;
        for grapheme in text.graphemes(true) {
            let start = scalar;
            scalar += grapheme.chars().count();
            graphemes.push(scalar);
            if wrap_eligible[start..scalar].iter().all(|enabled| *enabled) {
                emergency.push(scalar);
            }
        }
        let mut segments = Vec::new();
        let mut previous_byte = 0;
        let mut scalar = 0;
        for (byte, _) in unicode_linebreak::linebreaks(&text) {
            scalar += text[previous_byte..byte].chars().count();
            previous_byte = byte;
            if graphemes.binary_search(&scalar).is_ok() && ascii_url_boundary(&text, byte) {
                segments.push(scalar);
            }
        }
        Self {
            breaks,
            words,
            graphemes,
            emergency,
            segments,
        }
    }

    pub(super) fn in_range(&self, start: usize, end: usize) -> &[usize] {
        let first = self.breaks.partition_point(|offset| *offset <= start);
        let last = self.breaks.partition_point(|offset| *offset < end);
        &self.breaks[first..last]
    }
    pub(super) fn word_end(&self, offset: usize) -> Option<usize> {
        let index = self.words.partition_point(|word| word.end <= offset);
        self.words
            .get(index)
            .filter(|word| word.start <= offset)
            .map(|word| word.end)
    }

    pub(super) fn segment_end(&self, offset: usize) -> Option<usize> {
        self.segments
            .get(self.segments.partition_point(|end| *end <= offset))
            .copied()
    }

    pub(super) fn graphemes_in(&self, range: Range<usize>) -> &[usize] {
        let first = self
            .graphemes
            .partition_point(|offset| *offset <= range.start);
        let last = self
            .graphemes
            .partition_point(|offset| *offset <= range.end);
        &self.graphemes[first..last]
    }

    pub(super) fn emergency_in(&self, range: Range<usize>) -> &[usize] {
        let first = self
            .emergency
            .partition_point(|offset| *offset <= range.start);
        let last = self
            .emergency
            .partition_point(|offset| *offset <= range.end);
        &self.emergency[first..last]
    }

    pub(super) fn grapheme_edges(&self, offset: usize) -> (usize, usize) {
        let next = self.graphemes.partition_point(|end| *end < offset);
        if self.graphemes.get(next) == Some(&offset) || offset == 0 {
            return (offset, offset);
        }
        let before = next.checked_sub(1).map_or(0, |index| self.graphemes[index]);
        (before, self.graphemes.get(next).copied().unwrap_or(before))
    }
}

fn touches_url_separator(text: &str, start: usize, end: usize) -> bool {
    let bytes = text.as_bytes();
    let separator = |byte: u8| matches!(byte, b'/' | b'@' | b'=');
    start
        .checked_sub(1)
        .is_some_and(|index| separator(bytes[index]))
        || bytes.get(end).is_some_and(|&byte| separator(byte))
}

/// Chromium's normal printable-ASCII tailoring does not allow a break after
/// slash, dot, or colon before another ASCII URL character. UAX14 permits
/// some of these opportunities. Keep its Unicode behavior and the browser's
/// opening-punctuation opportunities; emergency wrapping is still grapheme
/// based and only happens when the resulting segment cannot fit a whole row.
fn ascii_url_boundary(text: &str, byte: usize) -> bool {
    let bytes = text.as_bytes();
    let Some(&next) = bytes.get(byte) else {
        return true;
    };
    let Some(previous) = byte.checked_sub(1).map(|index| bytes[index]) else {
        return true;
    };
    !(matches!(previous, b'/' | b'.' | b':')
        && next.is_ascii_graphic()
        && !matches!(next, b'(' | b'<' | b'[' | b'{'))
}

fn emergency_wrap(shell: &ElementShell, inherited: bool) -> bool {
    shell
        .style("overflow-wrap")
        .or_else(|| shell.style("word-wrap"))
        .map_or(inherited, |value| match value.trim() {
            value if value.eq_ignore_ascii_case("normal") => false,
            value
                if value.eq_ignore_ascii_case("break-word")
                    || value.eq_ignore_ascii_case("anywhere") =>
            {
                true
            }
            _ => inherited,
        })
}

fn english_dictionary(language: &str) -> bool {
    language.eq_ignore_ascii_case("en") || language.eq_ignore_ascii_case("en-us")
}

fn automatic(shell: &ElementShell, inherited: bool, paragraph: bool) -> bool {
    if let Some(value) = shell
        .style("hyphens")
        .or_else(|| shell.style("-webkit-hyphens"))
    {
        return match value.trim() {
            value if value.eq_ignore_ascii_case("auto") => true,
            value
                if value.eq_ignore_ascii_case("inherit") || value.eq_ignore_ascii_case("unset") =>
            {
                inherited
            }
            _ => false,
        };
    }
    // Match the existing p[style*="text-align"] selector exactly: an explicit
    // paragraph alignment changes the web editor to manual hyphenation.
    if paragraph
        && shell
            .attr("style")
            .is_some_and(|style| style.contains("text-align"))
    {
        return false;
    }
    inherited
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::RichDocument;

    #[test]
    fn actual_browser_url_segments_keep_unicode_edges_and_prose_dictionary_offsets() {
        let text = "🦊 https://twyne.example/arriving/longpath?query=words arriving begun/arriving 東京/東京";
        let document = RichDocument::from_html(&format!("<p>{text}</p>")).unwrap();
        let block = document.block(&[0]).unwrap();
        let opportunities = Hyphenation::for_block(&block, "en");
        let scalar_at = |byte: usize| text[..byte].chars().count();
        let url_start = scalar_at(text.find("https:").unwrap());
        let query_start = scalar_at(text.find("?query").unwrap() + 1);
        assert_eq!(opportunities.segment_end(url_start), Some(query_start));
        assert!(opportunities.in_range(url_start, query_start).is_empty());
        let prose_start = scalar_at(text.find(" arriving begun").unwrap() + 1);
        assert_eq!(
            opportunities.in_range(prose_start, prose_start + "arriving".len()),
            &[prose_start + 2, prose_start + 5]
        );
        let cjk_after_slash = scalar_at(text.rfind("/東京").unwrap() + 1);
        assert!(opportunities.segments.contains(&cjk_after_slash));
        assert_eq!(document.plain_text(), text);
    }

    #[test]
    fn web_words_keep_source_offsets_across_marks_languages_and_atoms() {
        let source = "<p>🦊 be<strong data-future=\"keep\">gun</strong> ar<em>riving</em> <span lang=\"de\">beginning</span> <sup data-type=\"endnote\" data-endnote-text=\"keep\"></sup> Beginning</p>";
        let document = RichDocument::from_html(source).unwrap();
        let block = document.block(&[0]).unwrap();
        let opportunities = Hyphenation::for_block(&block, "en");
        assert_eq!(opportunities.in_range(0, block.range.end), &[4, 10, 13]);
        assert!(
            document
                .to_html()
                .contains("be<strong data-future=\"keep\">gun")
        );
        assert!(!document.to_html().contains("be-"));
    }

    #[test]
    fn explicit_web_alignment_and_inherited_other_language_disable_auto() {
        let document = RichDocument::from_html("<p style=\"text-align: justify\">begun arriving</p><p lang=\"en-US\" style=\"hyphens: auto; text-align: left\">begun arriving</p><h2>begun arriving</h2><p>begun arriving</p>").unwrap();
        assert!(
            Hyphenation::for_block(&document.block(&[0]).unwrap(), "en")
                .breaks
                .is_empty()
        );
        assert_eq!(
            Hyphenation::for_block(&document.block(&[1]).unwrap(), "de").breaks,
            [2, 8, 11]
        );
        assert!(
            Hyphenation::for_block(&document.block(&[2]).unwrap(), "en")
                .breaks
                .is_empty()
        );
        assert!(
            Hyphenation::for_block(&document.block(&[3]).unwrap(), "de")
                .breaks
                .is_empty()
        );
    }
}
