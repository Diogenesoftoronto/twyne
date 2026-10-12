The native writer derives US English discretionary opportunities with the
cached hypher0.1.8 dictionary, then measures the actual styled prefix plus a
U+2010 display hyphen against the current line's remaining width. Original
scalar/UTF16 positions, HTML, copy text, notes, source atoms, and review metadata
remain unchanged. Source words spanning several mark wrappers share one break
opportunity set. An unchanged block reuses both its dictionary data and shaped
layout; width reflow reuses the dictionary. Ordinary input neither serializes
HTML nor scans other document descendants.

This follows current global.css's paragraph hyphens:auto rule and its explicit
text-align/manual selector. Explicit hyphens:none/manual disable automatic
breaks. en/en-US are supported; explicit other languages, capitalized words,
non-ASCII words, and words longer than128 scalars do not receive automatic
English breaks. Headings and source/code blocks do not receive paragraph
hyphenation. Unicode word boundaries still allow native CJK wrapping.
The [current Chromium limits](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/hyphenation.h)
are minimum word5, prefix2, suffix2, and
[English capitalized words are excluded](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/hyphenation.cc).
Chromium uses its own dictionary, so equal limits are not general dictionary
parity. The hypher code and English-pattern notices are shipped under the
root-owned licenses directory.

Native GPUI interaction checks cover clicking the displayed hyphen, selecting
and formatting a word across marks/lines, plain-text clipboard content,
surrogate-safe IME replacement/undo, and unchanged-block cache retention. They
use GPUI test fonts and establish interaction/source invariants, not real-font
browser geometry.

The historical native capture `/tmp/twyne-native-quiet-parity.png` and retained
browser capture `/tmp/twyne-reference-quiet-current.png` use the original79-word
quiet fixture. Both show be-/gun and ar-/riving, the same
two paragraph rows, float carry, section, and closing paragraph positions.
Title/emblem raster baselines/centering and section handles differ; whole-UI
pixel identity has not been established. That capture predates the UI correction
from bundled static Lora3.021 to the original variable3.008 outlines; its matched
line breaks do not prove current font raster parity. The current URL/comment
fixtures explicitly use the original3.008 fonts and document their remaining
dictionary/layout differences separately.

`capture-hyphenation-web.ts` reproduces current CSS/fonts and the actual
IlluminatedInitial Tiptap decoration with local assets and zero remote requests.
Fresh isolated Chrome154 has no English dictionary component here, so its
reported auto/manual lineflow does not demonstrate automatic hyphenation. The
retained dictionary-enabled browser capture is the comparison baseline. No
user profile files are read by this fixture. Manual soft-hyphen/wbr opportunities,
other dictionaries, full Unicode CSS casing, bidi behavior, and explicit caret
affinity at a shared wrap boundary remain separate work.
