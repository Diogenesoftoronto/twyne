---
twyne: minor
---

The page is yours to set, and the desk stops being a dead end.

**A ruler you can drag.** Page layout was a popover of rem sliders, which asks a writer to translate "3.25 rem" into a picture of their page. There is now a Word-style ruler above the manuscript, spanning exactly the page it describes: the shaded ends are the margins, the pale middle is the live text column, and dragging a marker moves the edge of the text with the draft reflowing under your hand. Margins are independent left and right rather than one symmetric value, the arrow keys drive the markers for anyone not using a mouse, and documents saved before the ruler still open to the page their writer chose.

**Tab indents, and lists look like lists.** Tab did nothing in the manuscript: inside a list it nested the item, but anywhere else it fell through to the browser and threw you out of your own draft. It now indents the current block a tab stop, Shift+Tab takes it back, and lists and tables keep the behaviour they had. The indent is stored on the block rather than painted on the screen, so it survives into exports and the PDF. Escape releases focus, so binding Tab does not trap anyone on a keyboard. Bullet and numbered lists were also rendering with no markers at all — a global stylesheet reset had stripped them and nothing put them back — so pressing "list" appeared to do nothing. They are back, with markers that cycle by depth the way a word processor's do, in the editor and in the exported document alike.

**Export as PDF.** From the File menu or straight from the layout tool, since page setup and printing belong together. The PDF carries your own margins and page numbers, and the text stays selectable and searchable. Two silent bugs went with it: exports were dropping the layout entirely and quietly falling back to the default page, and one export path read the saved copy rather than the open editor, so the last sentence you typed could go missing.

**Reading aloud actually works.** Two separate faults each broke it on their own. Narration was gated on having *any* voice-capable provider, so a writer running an LLM for the room and Google for dictation resolved to no narrator at all, failed, and never reached the hosted fallback. And playback was requested after synthesis had already returned, by which point the browser no longer considered the press a user gesture and refused to make noise — every attempt failed identically. A blocked playback now says the browser blocked it rather than blaming your API key.

**One place to write from.** The message composer is a single surface holding the text, the microphone and the send key, instead of three stacked controls. Enter sends, Shift+Enter breaks the line, the box grows with what you write, and dictation lands in the draft you are looking at rather than in a second box asking you to approve your own words twice.

**The editor is no longer a one-way door.** The blog, the manual, the FAQ, the press room, preferences, terms and privacy were reachable only from the landing page footer — so once you were at the desk, you were stuck there. They are all in the drawer now. Signing in also stops redirecting you to the editor, and the front page stops bouncing anyone who has ever filed a brief, which together had made the landing page unreachable for returning writers.

The manuscript's decorative header and footer bars have been removed from the page.
