# The Manual

> A writer's guide to the editorial room.

## I. The Dossier

Every piece worth writing needs a brief. The dossier is Twyne's way of
keeping the writer honest about what they're trying to do.

Before the room opens, we ask seven questions. They are not optional
flourishes — they are the spine of the editorial conversation. When you know
your audience, your goal, your tone, your constraints, and what success looks
like, the editors have something to grip. Without it, even the cleverest
feedback is fishing in the dark.

The seven fields:

- **Working Title** — A name the room can hold onto.
- **Format** — Essay, memo, chapter, dispatch, proposal…
- **Audience** — Name the actual reader, not a demographic.
- **Goal** — What should the piece accomplish?
- **Tone** — How should it feel, not just sound?
- **Constraints** — Sources to keep, jargon to avoid, anecdotes to protect.
- **Success Signal** — How will you know the draft has landed?

> **Pro tip:** You can refine the dossier at any time by clicking "Refine the
> dossier" in the masthead. The room picks up the new brief on the next pass.

## II. The Room of Editors

Five resident voices. Each reads with a different lens. Together they cover
the ground a single editor can't.

### Mlle. Sceptique — The Devil's Advocate

Hunts the unstated assumption, the soft claim, the argument that quietly
evades its strongest objection. When she speaks, listen — she is testing
whether your draft would survive a hostile reader.

### Sœur Encourageante — The Patron of Strengths

Reads for the alive paragraph — the one with a real sentence in it — and
tells you to protect it. Not empty praise; specific, earned defence of what's
working.

### Professeur Athenæum — The Scholar

Points to where citation is owed, where evidence wants weight, where
definition would clean a sentence. Think of him as the footnotes you haven't
written yet.

### M. Le Stylo — The Copy Chief

Carries the blue pencil. Catches diction, rhythm, repetition, and any
sentence that does not earn its place. He is the one who will tell you to
cut your favourite line.

### Le Lecteur — The Target Reader

Reads as your stated audience would — confused here, engaged there, won over
(or not) by the close. If Le Lecteur is lost, your audience is lost.

> **Custom editors:** Visit [the Room of Editors](/personas) to add, edit, or
> rearrange your cast. Each editor needs a name, a role, and a description of
> their voice. The AI uses these to stay in character.

### Changing the Model

Each editor's voice is shaped by the model that reads for them. A careful,
precise model makes Mme. Sceptique sharper. A warmer model makes Sœur
Encourageante more generous. Go to [Preferences](/settings) to assign
different models to different tasks — the room adapts.

## III. The Galley Proof

The rubric reads your draft in two ways: numbers the eye can see, and judges
who read like people.

The **static features** are deterministic — sentence length distribution,
type-token ratio, citation density, paragraph shape. These never call an
API and never cost a token. They give you a cold, honest picture of the
draft's mechanical health.

The **five judges** are the same personas from the room, but now they give a
single integer score from 1 to 10 and a one-line rationale. The rubric
combines their scores with the static features into an overall grade (A+
through F) and a short editorial note.

Grading scale:

- **A range** — Publishable or nearly so. Minor polish.
- **B range** — Solid draft with clear, fixable issues.
- **C range** — Doing the work but needs a real pass.
- **D–F range** — The important next pass is still ahead.

> **Interpreting the grade:** Most first drafts land in the C range. That is
> not failure; that is the honest place where writing starts. The rubric's
> job is to tell you where to push.

## IV. The Marginalia

Threaded comments alongside the draft. Your own notes, plus the editors'
voices when you ask them in.

Select any passage in the manuscript and click "Add comment" to pencil a
margin note. Comments are folio-scoped — they travel with the draft, not
the global state. Each comment can have replies, and you can ask any editor
to weigh in by clicking "Ask an editor."

When an editor replies, their colour and voice are preserved so you know
who is speaking. Strike a comment when you've addressed it; it softens into
the background but stays in the archive.

## V. The Apparatus

Research, bibliography, and citation — the machinery behind the prose.

The Apparatus has three jobs: find sources, save them, and cite them. As you
write, it detects DOIs, URLs, ISBNs, and author-year references
automatically. You can also search for sources by query — the panel fetches
a shortlist with title, author, publisher, and a snippet. Save what matters
to your bibliography.

Bibliographies are formatted in your chosen style — MLA, APA, or Chicago.
Switch at any time; the saved entries reformat instantly. Copy the whole
bibliography to your clipboard with one click.

> The full Apparatus is available at [/apparatus](/apparatus). The right-panel
> citation tab shows a quick view of detected references.

## VI. Bring Your Own Key

Twyne works out of the box. But if you want to use your own AI models, your
own keys, and your own cost envelope — you can.

**Step 1: Add a provider.** Go to [Preferences](/settings) and turn on
"Bring Your Own Key." Add your OpenAI, Anthropic, or Google key. For other
providers (Groq, Together, Rivet), use the "OpenAI-compatible" option with
your base URL.

**Step 2: Pick models per feature.** Not all tasks need the most expensive
model. You might want Claude Sonnet for the full room convene (needs deep
comprehension) and GPT-4o-mini for rubric judges (simple scoring). The
per-feature grid lets you assign exactly that.

**Step 3: Test the connection.** Each provider card has a "Test connection"
button. It sends a cheap ping and shows latency. Green means go.

Supported providers:

- OpenAI (GPT-4o, GPT-4o-mini, o3-mini, …)
- Anthropic (Claude Sonnet, Claude Haiku, …)
- Google (Gemini 2.5 Flash, Gemini 2.5 Pro, …)
- OpenAI-compatible (Groq, Together, Rivet, local servers, …)

> **Important:** Twyne does not fall back silently. If your key is invalid or
> the provider is down, you'll see an error and the app falls back to the
> server-side path (or local templates if the server is also unavailable).
> The draft is never blocked.

## VII. Privacy & Your Data

Your manuscript is yours. We intend to keep it that way.

**API keys:** Stored only in your browser's IndexedDB. Never sent to Twyne's
servers. Never logged. We can't see them, and we don't want to.

**Drafts and folios:** Saved locally in your browser via IndexedDB. If you
sign in, they sync to your own Convex account for cross-device access. They
are not shared, sold, or used to train models.

**AI calls:** When you BYOK, your draft text goes directly from your browser
to the provider you chose (OpenAI, Anthropic, etc.). Twyne's servers never
see the prompt or the response. When you use the default server path, the
call goes through our Convex backend, but drafts are not retained.

**Published pieces:** Only what you explicitly publish becomes public.
Everything else stays private to your account.

## VIII. Folios, Export & Share

One project. Many drafts. Each lives in its own folio.

Folios are separate documents within the same project. You might have a main
draft, a scratch notes folio, and an outline. Switch between them from the
left drawer. Each folio keeps its own word count, update time, and
(optionally) its own layout settings.

**Export** your folio as Markdown, standalone HTML, plain text, or a full
Twyne backup (JSON with brief, folios, and content). Use the File menu in
the masthead.

**Share** a public reading view of any folio. Anyone with the link can read
it; no one can edit it. Unpublish instantly.

## IX. Keyboard Shortcuts

### Text formatting

- `⌘B` — Bold
- `⌘I` — Italic
- `⌘U` — Underline

### Editor commands

- `⌘Z` — Undo
- `⌘⇧Z` — Redo
- `⌘↵` — Send reply / ask editor
