/**
 * The manual, read aloud as Morgan's story.
 *
 * Each chapter has a short narration that follows Morgan Vale and Salt Roads
 * through the same ground as the written chapter: what Morgan does, and what
 * the desk does on its own. The narration is a companion to the chapter, not
 * a reading of it, so it names the controls a listener needs and leaves the
 * tables and limits to the page.
 *
 * Audio is rendered ahead of time by `scripts/gen-manual-narration.ts` with
 * the launch films' narrator, so every reader hears the same voice with no
 * account and no cost. Each paragraph is one rendered segment; the generated
 * manifest records the script hash, so changed wording is caught by a test
 * until the audio is regenerated.
 *
 * Names are spelled out as spoken ("Mademoiselle", "Athenaeum") so the
 * transcript matches the voice.
 */

export interface ManualNarration {
  /** Paragraphs, each rendered as one segment. */
  script: string[];
}

export const NARRATOR = {
  voice: "Gacrux",
  style:
    "A warm, literate audiobook narrator telling a short story about a writer named Morgan. Unhurried and intimate, lightly wry, with clear diction. Let the short sentences land.",
} as const;

export const MANUAL_NARRATION: Record<string, ManualNarration> = {
  "getting-started": {
    script: [
      "Morgan Vale has four thousand words about salt caravans, and no idea what the essay is for. The draft is called Salt Roads. It has camels in it, and a merchant's ledger, and a harbour that closed, and it does not yet know why any of them are there. This is the story of how it finds out.",
      "Twyne is a writing desk with an editorial room attached. Morgan writes on the page. Five editors read in the margin, each looking for something different, and not one of them can change a word until Morgan says so.",
      "Three habits make the room worth having. Say what the piece is for, because editors with a brief give better notes than editors guessing. Write first, and read the notes later: the draft saves as Morgan types, and the editors, the grade and the research all read it on their own whenever Morgan pauses. There is nothing to press. And revise on your own terms. Every note can be followed, argued with, or refused.",
    ],
  },
  dossier: {
    script: [
      "Morgan's first draft of Salt Roads was beautiful and pointless. So before the room opens, it asks a few questions. They feel like paperwork. They are the opposite.",
      "There is a working title, and a form: an essay, this time. There is the reader, who has to be one real person rather than a demographic, so Morgan writes, a friend who hates travel writing. Then comes the hard one. The intent. What should be different in that friend when they finish? Morgan looks at the question for a long time. The answer, when it comes, fixes the essay.",
      "The rest go faster. The voice it should have. The non-negotiables, like the story of the salt merchant, which must survive every cut. The landing, a test an editor can actually apply: the reader can picture the journey. And the field notes, with a line on why they matter.",
      "As Morgan types, each answer is marked from vague to specific. A red mark is not a failure. It is the question the room would ask first. And when the piece changes its mind halfway through, Morgan refines the dossier, and the editors read the new edition on their next pass.",
    ],
  },
  house: {
    script: [
      "Salt Roads is the second of five coastal essays, and Morgan is not going to type the same reader into five dossiers. That is what the House is for.",
      "The House holds what Morgan would otherwise repeat: the usual reader, the standards that always apply, the tone of the whole enterprise. A collection narrows that for the series. And each folio, each single manuscript, keeps its own dossier. Context flows downward, and the most specific layer wins. A field Morgan fills in for Salt Roads overrides the collection, which overrides the House. Leave it blank, and it inherits.",
      "Standards are the exception. Charter articles add up, so a House rule like, every claim grounded in a concrete scene, applies to every essay, even when the collection adds rules of its own. And when the margin proposes a change to the brief, that amendment waits until Morgan files it.",
      "One afternoon an editor asks about a reader Morgan never mentioned in Salt Roads. Morgan opens the House and reads the register. It is a collection default, and the stamp on the field says so.",
    ],
  },
  flow: {
    script: [
      "Morgan writes in long runs, and resents anything that interrupts one. The room is built to wait.",
      "While Morgan works, the margin fills quietly: a comment, a source, a book cover, an echo of something Morgan wrote last year, each beside the passage it concerns. Nothing pops up over the page. When the typing settles into a steady rhythm, the room goes quiet. New cards wait, the controls recede, and the page is the only thing left. When Morgan pauses, the room comes back.",
      "Halfway through, Morgan writes about the merchant's ledger, and a card appears beside it. Earlier in this piece. Unpaid promise. The opening said the ledger would explain the road, and nothing has explained it yet. The card shows both passages, and Morgan can go to either one.",
      "A relationship like that is a reading, not a fault. Some promises are meant to stay open. Morgan chooses, That's the connection, and makes a note to pay it off. When a card is wrong, Not how I read it sets it aside for good. And when a sentence stalls, the margin may offer one short way into the next. Ignore it, and it goes away.",
    ],
  },
  "the-piece": {
    script: [
      "Some problems only show up across the whole draft. For eleven pages the narrator of Salt Roads says I, and then, without warning, we. And the guide's name is spelled one way in the first section and another way in the second.",
      "The piece catches both, and it does it on Morgan's own device, with no model and no cost. It watches the first person, similar names, and the conventions the draft mostly follows: spelling, small numbers, quotation marks, dashes. It maps where each recurring name appears, section by section. Morgan chooses Stance, and the turn to we lights up on the page.",
      "A finding is a pattern worth a look. Whether it is a problem is Morgan's call. The we, it turns out, is deliberate: the caravan has joined up. Morgan keeps it as an exception, and it stays kept. The guide's name is a typo, and Morgan fixes it.",
      "The score beside the piece wears a small approximately sign, because it is an estimate. When Morgan wants a fresh editorial reading of the whole draft, Confirm with a full read asks for one.",
    ],
  },
  "writing-instruments": {
    script: [
      "Morgan's opening line has been rewritten nine times. Morgan selects it, and the tools that fit a whole sentence open beside it, not on top of it.",
      "Sentence bench keeps the working wording at the top. Below it are Morgan's own earlier versions, rule-based changes, and alternatives from a model, each showing what it adds or cuts. Resting on one previews it in place, between its real neighbours. Morgan reads the fourth twice, and keeps it. Undo is always there.",
      "Threads pairs sentences that may be talking to each other. One of Morgan's sentences appears twice, word for word, three pages apart. Repetition is sometimes the point. This time it is not, and Morgan removes one copy in a single edit.",
      "The river crossing feels thin. Scene bench takes stock of it by sense: place, time, light, sound, movement and pressure, each backed by an exact quote. Sound is doing the least work. Morgan saves an idea, the creak of loaded saddlebags, without touching the manuscript.",
      "And from any of these tools, Ask the room brings the right editor into the question Morgan is already working on. The reply arrives in the margin. The manuscript stays Morgan's.",
    ],
  },
  room: {
    script: [
      "Five resident editors read Salt Roads, each for something different. Mademoiselle Sceptique, the devil's advocate. Sœur Encourageante, patron of strengths. Professeur Athenaeum, the scholar. Monsieur Le Stylo, the copy chief. And Le Lecteur, the reader the piece is for. No single editor is right about everything, which is rather the point of having five.",
      "Morgan never convenes them. Once the draft passed five hundred words, they read it on their own the first time Morgan paused. Now they come back whenever about two hundred words are new or rewritten and the page has been quiet for a minute. Tightening the harbour section counts as much as writing a new one. Their notes arrive marked, in passing.",
      "When Professeur Athenaeum quotes three lines in one note, each quotation is underlined and leads to its own passage. If a phrase appears twice, the words around it in the note decide which one is meant. If it could be either, or Morgan has since rewritten it, the quotation is left unlinked, with a dotted line that says why. Twyne would rather not guess.",
      "The ferry scene ends abruptly, on purpose, and Mademoiselle Sceptique will not stop saying so. Morgan marks the note, intentional. A note about the opening's length, Morgan marks for later. Either way, that editor will not raise the same passage again until its words change.",
    ],
  },
  rubric: {
    script: [
      "The grade on Salt Roads is a B. That is not information. The reasons under the grade are.",
      "Morgan never asked for the grade. Once the draft had five hundred words and Morgan paused, Twyne ran a quick check against the essay's criteria and set the grade on the proof. Then, without being asked, the editors read the new version themselves. The grade stayed on screen while they worked.",
      "Under it, the static features measure the mechanics: sentence lengths, vocabulary, the shape of the paragraphs. They are cold and honest, and they say nothing about whether the essay is any good. The editors do. Each gives a score and a reason, and where they disagree is usually where the revision is. Target Fit holds the whole thing to the dossier, because a beautiful essay for the wrong reader is still the wrong essay.",
      "When Morgan edits again, the quick grade refreshes, and the editors' notes stay, marked as being about the earlier version until they have read the new one. Morgan reads the reasons, not the letter, and decides which complaints deserve a revision.",
    ],
  },
  marginalia: {
    script: [
      "Every argument about a passage happens next to the passage.",
      "Morgan is not sure about the paragraph on salt taxes, so Morgan selects it, chooses Comment, and leaves a note in the margin. Too much arithmetic? The note belongs to the folio, and travels with it. Ask an editor brings a particular voice into the thread, and Monsieur Le Stylo arrives with an opinion.",
      "Selecting a marker unfolds its thread beside the manuscript. Morgan replies, asks another editor, or resolves it. One conversation holds the foreground at a time, and Escape closes it. A reply Morgan has not sent survives switching threads, but not a reload. Send it, or lose it.",
    ],
  },
  apparatus: {
    script: [
      "The 1911 survey. The tide table. The book Morgan keeps paraphrasing. The Apparatus keeps them in order.",
      "Morgan does not ask for sources. A short while after the typing stops, the Apparatus reads the draft and picks out what a careful reader would want backed up: a figure about the salt trade, a line quoted from the survey, the year the harbour closed. It searches for each one, and files what it finds under the claim that prompted it.",
      "The panel always says what it is doing, or why it is waiting. Every claim explains its result. Found means there are sources on file, so Morgan checks that they support the wording. No match means the search ran and came back empty; perhaps the sentence needs softer wording. Failed means the search broke, which is not the same thing, and Twyne tries again on its own.",
      "References gather as Morgan writes: links, book numbers, author and year. Morgan saves what matters to the bibliography, in MLA, APA or Chicago, and switches styles the moment an editor changes their mind.",
    ],
  },
  "account-and-live": {
    script: [
      "Some days, typing is too slow.",
      "Morgan signs in with Not Organic, so the account, the hosted credit and the plan come along to every device. The editors address Morgan by name; the email address stays in private settings. Anyone can keep writing locally without signing in at all.",
      "From one of Le Lecteur's notes, Morgan chooses Talk, and the voice desk opens. Live shows captions, lets Morgan mute the microphone, and can find passages or propose edits in the middle of the conversation. A proposed edit waits for Morgan's approval before it touches the manuscript. Neither the captions nor the audio are kept. The desk shows its spending limits before the conversation starts, which is why Morgan reads them.",
    ],
  },
  "manuscript-tools": {
    script: [
      "Salt Roads needs a table of caravan stages, a footnote, and one pull quote set just so.",
      "Morgan types a slash at the start of a line, and the insert menu opens. The outline jumps between headings, and dragging a heading moves its whole section in one edit. Find and Replace understands whole words and patterns.",
      "The table gets a caption and a little shading. A photograph of the salt flats goes in with a caption and a description for readers who cannot see it. Footnotes are written beside the words they belong to, and equations render on the device.",
      "When the page is not enough, there is the source underneath it. The Typst workspace shows the source on one side and a paginated proof on the other. A draft that does not compile is never applied. It waits there to be fixed.",
    ],
  },
  folios: {
    script: [
      "Salt Roads, its outline, and a scratch file of cut paragraphs share a collection, and nothing else. Each is its own folio, with its own dossier, word count and layout.",
      "Twyne keeps checkpoints on its own as Morgan writes. A week into the revision, Morgan opens Version history and compares today with Monday. The comparison describes itself in a sentence. Rewrote three passages and cut one. The changes reach passages Monsieur Le Stylo had notes on. Each passage shows its before and after, and where a rewrite reached an editor's note, the note sits beside it. That shows the change reached the passage. Whether it answered the note is for Morgan to judge.",
      "Before a risky pass, Morgan saves a checkpoint and writes what it is for: pay off the ledger promise. Restoring an earlier version always saves the current draft first.",
      "When the essay is done, Morgan exports a PDF, typeset on the device, with the private editorial notes left out. Share publishes a page anyone with the link can read, and publishing to a personal data server files the essay in Morgan's own repository. Unpublishing takes it down at once.",
    ],
  },
  byok: {
    script: [
      "Morgan already pays for a model, and would like the editors to use it. It takes three steps, once.",
      "In Preferences, Morgan switches on Bring Your Own Key and adds a provider: OpenAI, Anthropic, Google, or any service that speaks the OpenAI format, with its address. Test key checks that the key reaches the list of models. Then a grid assigns a model to each job: the expensive one where the reading matters, something cheaper for the rest.",
      "If the provider goes down, the desk keeps working. Only the editors go quiet.",
    ],
  },
  privacy: {
    script: [
      "Salt Roads belongs to Morgan. Here is exactly where it goes.",
      "The drafts live in Morgan's browser. Signing out does not erase them, and signing in is what carries them to another device. Keys live in the browser too. A request with Morgan's own key passes through Twyne's relay to the chosen provider, and the relay keeps neither the key nor the request. A model running on Morgan's own machine is called directly.",
      "When an editor reads, the draft goes to whichever model is doing the reading. Hosted readings go through Twyne's service and Not Organic. And nothing becomes public until Morgan publishes it. An essay about salt roads is nobody's business until Morgan says it is.",
    ],
  },
};

/** Chapters in reading order, so one narration can lead into the next. */
export const NARRATION_ORDER = [
  "getting-started",
  "dossier",
  "house",
  "flow",
  "the-piece",
  "writing-instruments",
  "room",
  "rubric",
  "marginalia",
  "apparatus",
  "account-and-live",
  "manuscript-tools",
  "folios",
  "byok",
  "privacy",
] as const;

/** Stable digest of a chapter's spoken text and voice. */
export function narrationHash(chapter: ManualNarration): string {
  const text = [NARRATOR.voice, NARRATOR.style, ...chapter.script].join("\n");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const narrationSrc = (chapter: string) =>
  `/assets/manual/narration/${chapter}.m4a`;
