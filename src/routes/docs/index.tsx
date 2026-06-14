import { component$, useStylesScoped$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";

export default component$(() => {
  useStylesScoped$(`
    .doc-section {
      border-bottom: 1px dashed var(--color-paper-3);
      padding-bottom: 2.5rem;
      margin-bottom: 2.5rem;
    }
    .doc-section:last-child {
      border-bottom: none;
      padding-bottom: 0;
      margin-bottom: 0;
    }
    .doc-h2 {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.5rem;
      color: var(--color-ink);
      margin: 0 0 0.6rem;
    }
    .doc-h3 {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 1.1rem;
      color: var(--color-vermilion);
      margin: 1.5rem 0 0.4rem;
    }
    .doc-lead {
      font-family: var(--font-serif);
      font-style: italic;
      font-size: 1.05rem;
      line-height: 1.7;
      color: var(--color-ink-light);
      margin-bottom: 1rem;
    }
    .doc-p {
      font-family: var(--font-serif);
      font-size: 0.95rem;
      line-height: 1.7;
      color: var(--color-ink);
      margin-bottom: 0.85rem;
    }
    .doc-ul {
      margin: 0.5rem 0 1rem 1.25rem;
      list-style: none;
    }
    .doc-ul li {
      position: relative;
      padding-left: 1rem;
      font-family: var(--font-serif);
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--color-ink);
      margin-bottom: 0.4rem;
    }
    .doc-ul li::before {
      content: "❦";
      position: absolute;
      left: -0.25rem;
      color: var(--color-vermilion);
      font-size: 0.7rem;
    }
    .doc-callout {
      background: var(--color-paper-soft);
      border-left: 3px solid var(--color-vermilion);
      padding: 1rem 1.25rem;
      margin: 1rem 0;
    }
    .doc-callout p {
      margin: 0;
      font-family: var(--font-serif);
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--color-ink-light);
    }
    .doc-kbd {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      background: var(--color-paper-2);
      padding: 0.1rem 0.35rem;
      border-radius: 2px;
      border: 1px solid var(--color-paper-3);
    }
    .toc-link {
      display: block;
      font-family: var(--font-typewriter);
      font-size: 0.78rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--color-ink-light);
      padding: 0.35rem 0;
      transition: color 0.15s ease;
    }
    .toc-link:hover {
      color: var(--color-vermilion);
    }
  `);

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div class="flex items-center justify-between mb-8">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
              }}
            >
              The Manual
            </h1>
            <p class="doc-lead mt-2 !mb-0">
              A writer's guide to the editorial room.
            </p>
          </div>
          <Link
            href="/"
            class="btn-paper text-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ← Back to desk
          </Link>
        </div>

        {/* TOC */}
        <nav class="folio p-5 mb-8">
          <p
            class="text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-3"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Contents
          </p>
          <div class="grid sm:grid-cols-2 gap-x-6">
            <a href="#dossier" class="toc-link">
              I. The Dossier
            </a>
            <a href="#room" class="toc-link">
              II. The Room of Editors
            </a>
            <a href="#rubric" class="toc-link">
              III. The Galley Proof
            </a>
            <a href="#marginalia" class="toc-link">
              IV. The Marginalia
            </a>
            <a href="#apparatus" class="toc-link">
              V. The Apparatus
            </a>
            <a href="#byok" class="toc-link">
              VI. Bring Your Own Key
            </a>
            <a href="#privacy" class="toc-link">
              VII. Privacy &amp; Your Data
            </a>
            <a href="#folios" class="toc-link">
              VIII. Folios, Export &amp; Share
            </a>
            <a href="#shortcuts" class="toc-link">
              IX. Keyboard Shortcuts
            </a>
          </div>
        </nav>

        {/* ── I. The Dossier ── */}
        <section id="dossier" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section I
          </p>
          <h2 class="doc-h2">The Dossier</h2>
          <p class="doc-lead">
            Every piece worth writing needs a brief. The dossier is Twyne's way
            of keeping the writer honest about what they're trying to do.
          </p>
          <p class="doc-p">
            Before the room opens, we ask seven questions. They are not optional
            flourishes — they are the spine of the editorial conversation. When
            you know your audience, your goal, your tone, your constraints, and
            what success looks like, the editors have something to grip. Without
            it, even the cleverest feedback is fishing in the dark.
          </p>
          <p class="doc-p">
            The seven fields:
          </p>
          <ul class="doc-ul">
            <li><strong>Working Title</strong> — A name the room can hold onto.</li>
            <li><strong>Format</strong> — Essay, memo, chapter, dispatch, proposal…</li>
            <li><strong>Audience</strong> — Name the actual reader, not a demographic.</li>
            <li><strong>Goal</strong> — What should the piece accomplish?</li>
            <li><strong>Tone</strong> — How should it feel, not just sound?</li>
            <li><strong>Constraints</strong> — Sources to keep, jargon to avoid, anecdotes to protect.</li>
            <li><strong>Success Signal</strong> — How will you know the draft has landed?</li>
          </ul>
          <div class="doc-callout">
            <p>
              <strong>Pro tip:</strong> You can refine the dossier at any time
              by clicking "Refine the dossier" in the masthead. The room picks
              up the new brief on the next pass.
            </p>
          </div>
        </section>

        {/* ── II. The Room of Editors ── */}
        <section id="room" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section II
          </p>
          <h2 class="doc-h2">The Room of Editors</h2>
          <p class="doc-lead">
            Five resident voices. Each reads with a different lens. Together they
            cover the ground a single editor can't.
          </p>

          <h3 class="doc-h3">Mlle. Sceptique — The Devil's Advocate</h3>
          <p class="doc-p">
            Hunts the unstated assumption, the soft claim, the argument that
            quietly evades its strongest objection. When she speaks, listen — she
            is testing whether your draft would survive a hostile reader.
          </p>

          <h3 class="doc-h3">Sœur Encourageante — The Patron of Strengths</h3>
          <p class="doc-p">
            Reads for the alive paragraph — the one with a real sentence in it —
            and tells you to protect it. Not empty praise; specific, earned
            defence of what's working.
          </p>

          <h3 class="doc-h3">Professeur Athenæum — The Scholar</h3>
          <p class="doc-p">
            Points to where citation is owed, where evidence wants weight, where
            definition would clean a sentence. Think of him as the footnotes you
            haven't written yet.
          </p>

          <h3 class="doc-h3">M. Le Stylo — The Copy Chief</h3>
          <p class="doc-p">
            Carries the blue pencil. Catches diction, rhythm, repetition, and any
            sentence that does not earn its place. He is the one who will tell
            you to cut your favourite line.
          </p>

          <h3 class="doc-h3">Le Lecteur — The Target Reader</h3>
          <p class="doc-p">
            Reads as your stated audience would — confused here, engaged there,
            won over (or not) by the close. If Le Lecteur is lost, your audience
            is lost.
          </p>

          <div class="doc-callout">
            <p>
              <strong>Custom editors:</strong> Visit{" "}
              <Link href="/personas" class="underline hover:text-[var(--color-vermilion)]">
                the Room of Editors
              </Link>{" "}
              to add, edit, or rearrange your cast. Each editor needs a name, a
              role, and a description of their voice. The AI uses these to stay
              in character.
            </p>
          </div>

          <h3 class="doc-h3">Changing the Model</h3>
          <p class="doc-p">
            Each editor's voice is shaped by the model that reads for them. A
            careful, precise model makes Mme. Sceptique sharper. A warmer model
            makes Sœur Encourageante more generous. Go to{" "}
            <Link href="/settings" class="underline hover:text-[var(--color-vermilion)]">
              Preferences
            </Link>{" "}
            to assign different models to different tasks — the room adapts.
          </p>
        </section>

        {/* ── III. The Galley Proof ── */}
        <section id="rubric" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section III
          </p>
          <h2 class="doc-h2">The Galley Proof</h2>
          <p class="doc-lead">
            The rubric reads your draft in two ways: numbers the eye can see,
            and judges who read like people.
          </p>
          <p class="doc-p">
            The <strong>static features</strong> are deterministic — sentence
            length distribution, type-token ratio, citation density, paragraph
            shape. These never call an API and never cost a token. They give you
            a cold, honest picture of the draft's mechanical health.
          </p>
          <p class="doc-p">
            The <strong>five judges</strong> are the same personas from the room,
            but now they give a single integer score from 1 to 10 and a one-line
            rationale. The rubric combines their scores with the static features
            into an overall grade (A+ through F) and a short editorial note.
          </p>
          <p class="doc-p">
            Grading scale:
          </p>
          <ul class="doc-ul">
            <li><strong class="text-[var(--color-accent-green)]">A range</strong> — Publishable or nearly so. Minor polish.</li>
            <li><strong class="text-[var(--color-accent-blue)]">B range</strong> — Solid draft with clear, fixable issues.</li>
            <li><strong class="text-[var(--color-accent-amber)]">C range</strong> — Doing the work but needs a real pass.</li>
            <li><strong class="text-[var(--color-accent-red)]">D–F range</strong> — The important next pass is still ahead.</li>
          </ul>
          <div class="doc-callout">
            <p>
              <strong>Interpreting the grade:</strong> Most first drafts land in
              the C range. That is not failure; that is the honest place where
              writing starts. The rubric's job is to tell you where to push.
            </p>
          </div>
        </section>

        {/* ── IV. The Marginalia ── */}
        <section id="marginalia" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section IV
          </p>
          <h2 class="doc-h2">The Marginalia</h2>
          <p class="doc-lead">
            Threaded comments alongside the draft. Your own notes, plus the
            editors' voices when you ask them in.
          </p>
          <p class="doc-p">
            Select any passage in the manuscript and click "Add comment" to
            pencil a margin note. Comments are folio-scoped — they travel with
            the draft, not the global state. Each comment can have replies, and
            you can ask any editor to weigh in by clicking "Ask an editor."
          </p>
          <p class="doc-p">
            When an editor replies, their colour and voice are preserved so you
            know who is speaking. Strike a comment when you've addressed it; it
            softens into the background but stays in the archive.
          </p>
        </section>

        {/* ── V. The Apparatus ── */}
        <section id="apparatus" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section V
          </p>
          <h2 class="doc-h2">The Apparatus</h2>
          <p class="doc-lead">
            Research, bibliography, and citation — the machinery behind the
            prose.
          </p>
          <p class="doc-p">
            The Apparatus has three jobs: find sources, save them, and cite them.
            As you write, it detects DOIs, URLs, ISBNs, and author-year
            references automatically. You can also search for sources by query —
            the panel fetches a shortlist with title, author, publisher, and a
            snippet. Save what matters to your bibliography.
          </p>
          <p class="doc-p">
            Bibliographies are formatted in your chosen style — MLA, APA, or
            Chicago. Switch at any time; the saved entries reformat instantly.
            Copy the whole bibliography to your clipboard with one click.
          </p>
          <div class="doc-callout">
            <p>
              The full Apparatus is available at{" "}
              <Link href="/apparatus" class="underline hover:text-[var(--color-vermilion)]">
                /apparatus
              </Link>
              . The right-panel citation tab shows a quick view of detected
              references.
            </p>
          </div>
        </section>

        {/* ── VI. Bring Your Own Key ── */}
        <section id="byok" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section VI
          </p>
          <h2 class="doc-h2">Bring Your Own Key</h2>
          <p class="doc-lead">
            Twyne works out of the box. But if you want to use your own AI
            models, your own keys, and your own cost envelope — you can.
          </p>
          <p class="doc-p">
            <strong>Step 1: Add a provider.</strong> Go to{" "}
            <Link href="/settings" class="underline hover:text-[var(--color-vermilion)]">
              Preferences
            </Link>{" "}
            and turn on "Bring Your Own Key." Add your OpenAI, Anthropic, or
            Google key. For other providers (Groq, Together, Rivet), use the
            "OpenAI-compatible" option with your base URL.
          </p>
          <p class="doc-p">
            <strong>Step 2: Pick models per feature.</strong> Not all tasks need
            the most expensive model. You might want Claude Sonnet for the full
            room convene (needs deep comprehension) and GPT-4o-mini for rubric
            judges (simple scoring). The per-feature grid lets you assign exactly
            that.
          </p>
          <p class="doc-p">
            <strong>Step 3: Test the connection.</strong> Each provider card has
            a "Test connection" button. It sends a cheap ping and shows latency.
            Green means go.
          </p>
          <p class="doc-p">
            Supported providers:
          </p>
          <ul class="doc-ul">
            <li>OpenAI (GPT-4o, GPT-4o-mini, o3-mini, …)</li>
            <li>Anthropic (Claude Sonnet, Claude Haiku, …)</li>
            <li>Google (Gemini 2.5 Flash, Gemini 2.5 Pro, …)</li>
            <li>OpenAI-compatible (Groq, Together, Rivet, local servers, …)</li>
          </ul>
          <div class="doc-callout">
            <p>
              <strong>Important:</strong> Twyne does not fall back silently. If
              your key is invalid or the provider is down, you'll see an error
              and the app falls back to the server-side path (or local templates
              if the server is also unavailable). The draft is never blocked.
            </p>
          </div>
        </section>

        {/* ── VII. Privacy ── */}
        <section id="privacy" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section VII
          </p>
          <h2 class="doc-h2">Privacy &amp; Your Data</h2>
          <p class="doc-lead">
            Your manuscript is yours. We intend to keep it that way.
          </p>
          <p class="doc-p">
            <strong>API keys:</strong> Stored only in your browser's IndexedDB.
            Never sent to Twyne's servers. Never logged. We can't see them, and
            we don't want to.
          </p>
          <p class="doc-p">
            <strong>Drafts and folios:</strong> Saved locally in your browser via
            IndexedDB. If you sign in, they sync to your own Convex account for
            cross-device access. They are not shared, sold, or used to train
            models.
          </p>
          <p class="doc-p">
            <strong>AI calls:</strong> When you BYOK, your draft text goes
            directly from your browser to the provider you chose (OpenAI,
            Anthropic, etc.). Twyne's servers never see the prompt or the
            response. When you use the default server path, the call goes through
            our Convex backend, but drafts are not retained.
          </p>
          <p class="doc-p">
            <strong>Published pieces:</strong> Only what you explicitly publish
            becomes public. Everything else stays private to your account.
          </p>
        </section>

        {/* ── VIII. Folios, Export & Share ── */}
        <section id="folios" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section VIII
          </p>
          <h2 class="doc-h2">Folios, Export &amp; Share</h2>
          <p class="doc-lead">
            One project. Many drafts. Each lives in its own folio.
          </p>
          <p class="doc-p">
            Folios are separate documents within the same project. You might have
            a main draft, a scratch notes folio, and an outline. Switch between
            them from the left drawer. Each folio keeps its own word count,
            update time, and (optionally) its own layout settings.
          </p>
          <p class="doc-p">
            <strong>Export</strong> your folio as Markdown, standalone HTML,
            plain text, or a full Twyne backup (JSON with brief, folios, and
            content). Use the File menu in the masthead.
          </p>
          <p class="doc-p">
            <strong>Share</strong> a public reading view of any folio. Anyone
            with the link can read it; no one can edit it. Unpublish instantly.
          </p>
        </section>

        {/* ── IX. Shortcuts ── */}
        <section id="shortcuts" class="doc-section">
          <p
            class="text-[0.65rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Section IX
          </p>
          <h2 class="doc-h2">Keyboard Shortcuts</h2>
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <h3 class="doc-h3">Text formatting</h3>
              <ul class="doc-ul">
                <li>
                  <span class="doc-kbd">⌘B</span> Bold
                </li>
                <li>
                  <span class="doc-kbd">⌘I</span> Italic
                </li>
                <li>
                  <span class="doc-kbd">⌘U</span> Underline
                </li>
              </ul>
            </div>
            <div>
              <h3 class="doc-h3">Editor commands</h3>
              <ul class="doc-ul">
                <li>
                  <span class="doc-kbd">⌘Z</span> Undo
                </li>
                <li>
                  <span class="doc-kbd">⌘⇧Z</span> Redo
                </li>
                <li>
                  <span class="doc-kbd">⌘↵</span> Send reply / ask editor
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Manual · Twyne",
  meta: [
    {
      name: "description",
      content:
        "The writer's guide to Twyne — the editorial room, the dossier, the galley proof, and bringing your own key.",
    },
  ],
};
