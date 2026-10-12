//! Fuzzy scorer for slash-command menus (port of the TS `fuzzyCommandScore`).
//! Pure std. No command metadata, UI, or action execution lives here: the
//! caller joins the full Source metadata (label, description, id, search
//! terms, slash keywords) into `haystack` in the same order as the JS join.

/// Port of the TS `normalise`: lowercase, collapse every run of characters
/// that are not ASCII `a-z0-9` into a single space, then trim.
fn normalise(value: &str) -> String {
    // Mirrors JS `toLocaleLowerCase` before the regex replace.
    let lowered = value.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut pending_space = false;
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            // JS keeps only ASCII `a-z0-9` (regex `[^a-z0-9]`); any other
            // character starts or extends a run, and a run of length n
            // is replaced by exactly one space (`+` quantifier), so we
            // only emit a space when the previous char was not part of
            // the same non-alphanumeric run.
            out.push(ch);
            pending_space = false;
        } else if !pending_space {
            out.push(' ');
            pending_space = true;
        }
    }
    // Final trim removes leading/trailing spaces produced by edge runs,
    // matching the JS `.trim()`.
    out.trim().to_string()
}

/// Port of the TS `fuzzyCommandScore` for one command.
/// Exact label match wins, then label prefix, then word prefix, then
/// containment in the joined haystack, then an ordered subsequence.
/// A query that cannot be matched in order is excluded (`None`) rather
/// than given an arbitrary low score; an empty normalised query is `Some(0)`.
pub fn score(label: &str, haystack: &str, query: &str) -> Option<i32> {
    let needle = normalise(query);
    if needle.is_empty() {
        return Some(0);
    }
    let label = normalise(label);
    let haystack = normalise(haystack);

    if label == needle {
        return Some(1000);
    }
    if label.starts_with(&needle) {
        // Normalised output is ASCII, so byte and char positions coincide.
        return Some(800 - (label.len() as i32 - needle.len() as i32));
    }
    if let Some(index) = label.split(' ').position(|word| word.starts_with(&needle)) {
        return Some(650 - index as i32 * 10);
    }
    if let Some(index) = haystack.find(&needle) {
        return Some(500 - index.min(200) as i32);
    }

    let mut cursor = 0;
    let mut gap_penalty = 0;
    // The JS walk strips all whitespace from the needle first
    // (`needle.replace(/\s/g, "")`); after normalise only spaces remain.
    for character in needle.chars().filter(|c| !c.is_whitespace()) {
        let offset = haystack[cursor..].find(character)?;
        let found = cursor + offset;
        gap_penalty += (found - cursor) as i32;
        cursor = found + 1;
    }
    Some(250 - gap_penalty.min(200))
}
