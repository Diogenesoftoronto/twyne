/**
 * Synthetic editorial notes that exercise what a margin note can carry.
 *
 * One set of strings shared by the renderer's unit tests and the browser
 * checks that compare the compact card, the full conversation and the
 * gathered sheet, so every surface is judged against the same input.
 */

/** Bold, italic, code, a link with a query, an emoji, a line break, a list. */
export const RICH_NOTE = [
  "**Bold claim**, an _aside_ and `the_map()`, see [the survey](https://example.com/map?a=1&b=2) 🧭",
  "A second line in the same paragraph.",
  "",
  "- first reason",
  "- second, **stressed**",
].join("\n");

/** A reply in the thread, as the card previews it. */
export const RICH_REPLY =
  "Agreed: *slow* the second sentence, keep **the turn**.";

/**
 * Long enough to be cut in the card, with the cut landing inside the bold
 * span. The text before the bold run is 256 characters.
 */
export const LONG_NOTE = `${"The caravan scene is doing three jobs at once. ".repeat(5)}Then the road turns. **The inland turn has to land here or the ending loses its answer, so slow it down** and let the drivers notice the quiet.`;

/** The words that sit after the card's cut and only the full note shows. */
export const LONG_NOTE_TAIL = "let the drivers notice the quiet.";

/** Raw HTML and hostile URLs, each of which must stay inert text. */
export const HOSTILE_NOTE = [
  'Inline <img src=x onerror="window.__twyneXss=1"> tag.',
  "Raw block <code> <img/src=x onerror=window.__twyneXss=2> after it.",
  "[a script link](javascript:window.__twyneXss=3) and [data](data:text/html,<b>x</b>)",
  "![tracker](https://tracker.example/p.png)",
  "",
  "<script>window.__twyneXss=4</script>",
].join("\n");

/** A reply arriving in pieces, each a prefix of the next. */
export const STREAMING_REPLY = [
  "Read it **alou",
  "Read it **aloud** and the `rhyth",
  "Read it **aloud** and the `rhythm` shows:\n\n- the first clause",
  "Read it **aloud** and the `rhythm` shows:\n\n- the first clause\n- then the [second](https://example.com/s)",
];
