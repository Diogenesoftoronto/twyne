import {
  component$,
  useComputed$,
  useSignal,
  useVisibleTask$,
} from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import { KeybindingList } from "../../components/editor/keybinding-list";
import { keybindingList, type ShortcutPlatform } from "../../utils/keybindings";
import "./manual.css";

import { LaunchFilm } from "../../components/landing/launch-film";
import { ManualWalkthrough } from "./manual-walkthrough";
import { ManualVideo } from "./manual-video";
import { MANUAL_FILMS } from "./manual-films";
import {
  ManualNarration,
  ManualNarrationHost,
  pauseManualNarration,
} from "./manual-narration";
import { ManualEditors } from "./manual-editors";
import { AT_THE_DESK_GUIDES } from "./guide-at-the-desk";
import { EDITORIAL_GUIDES } from "./guide-editorial-room";
import { YOUR_WORK_GUIDES } from "./guide-your-work";
import { MANUSCRIPT_CRAFT_GUIDES } from "./guide-manuscript-craft";
import { LIVING_DESK_GUIDES } from "./guide-living-desk";
import { WRITING_INSTRUMENT_GUIDES } from "./guide-writing-instruments";
import type { ManualGuides } from "./manual-guide-types";

const GUIDES: ManualGuides = {
  ...AT_THE_DESK_GUIDES,
  ...EDITORIAL_GUIDES,
  ...YOUR_WORK_GUIDES,
  ...MANUSCRIPT_CRAFT_GUIDES,
  ...LIVING_DESK_GUIDES,
  ...WRITING_INSTRUMENT_GUIDES,
};

const ChapterIllustrations = component$<{ chapter: string }>(({ chapter }) => (
  <>
    {MANUAL_FILMS[chapter] && <ManualVideo film={MANUAL_FILMS[chapter]} />}
    {GUIDES[chapter] && (
      <ManualWalkthrough id={chapter} guide={GUIDES[chapter]} />
    )}
  </>
));

const CHAPTERS = [
  {
    label: "At the desk",
    links: [
      ["getting-started", "01", "Begin a piece"],
      ["dossier", "02", "The dossier"],
      ["house", "03", "The House & collections"],
      ["flow", "04", "Writing in flow"],
      ["the-piece", "05", "The piece"],
      ["writing-instruments", "06", "Writing instruments"],
    ],
  },
  {
    label: "The editorial room",
    links: [
      ["room", "07", "Your editors"],
      ["rubric", "08", "The galley proof"],
      ["marginalia", "09", "Margin conversations"],
      ["apparatus", "10", "Research & citations"],
      ["account-and-live", "11", "Your account & Live"],
    ],
  },
  {
    label: "Your work",
    links: [
      ["manuscript-tools", "12", "Manuscript & source tools"],
      ["folios", "13", "Folios, export & publishing"],
      ["byok", "14", "Bring your own key"],
      ["privacy", "15", "Privacy & your data"],
      ["shortcuts", "16", "Keyboard shortcuts"],
      ["launch-film", "—", "Watch the film"],
    ],
  },
] as const;

const MANUSCRIPT_TOPICS = [
  ["outline-and-find", "Outline & search"],
  ["tables-and-images", "Tables & images"],
  ["source-and-proof", "Source & proof"],
  ["page-layout", "Page layout"],
  ["notes-and-equations", "Notes & equations"],
] as const;

const INSTRUMENT_TOPICS = [
  ["sentence-bench", "Compare a revision"],
  ["writing-threads", "Threads"],
  ["writing-entities", "Entities & continuity"],
  ["paragraph-readings", "Paragraphs & Charter"],
  ["task-desk", "Task desk"],
  ["on-device-writing", "On-device tools & Say it"],
  ["scene-bench", "Scene bench"],
] as const;

const CHAPTER_TOPICS: Record<string, readonly (readonly [string, string])[]> = {
  "manuscript-tools": MANUSCRIPT_TOPICS,
  "writing-instruments": INSTRUMENT_TOPICS,
};

const CHAPTER_LINKS = CHAPTERS.flatMap<readonly [string, string, string]>(
  (group) => group.links,
);

const chapterTitle = (id: string) =>
  CHAPTER_LINKS.find(([chapter]) => chapter === id)?.[2] ?? "";

const CHAPTER_TITLES = Object.fromEntries(
  CHAPTER_LINKS.map(([id, , title]) => [id, title]),
);

const ReadingPosition = component$<{
  chapter: string;
  title: string;
  progress: number;
}>((props) => (
  <div class="manual-reading-position">
    <p class="manual-reading-label">
      {props.chapter === "—"
        ? "Closing film"
        : `Reading · ${Number(props.chapter)} of ${CHAPTER_LINKS.length - 1}`}
    </p>
    <p class="manual-reading-title">{props.title}</p>
    <div
      class="manual-reading-track"
      role="progressbar"
      aria-label="Reading position in the manual"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.progress}
      aria-valuetext={`${props.progress}% through the guide`}
    >
      <span style={{ width: `${props.progress}%` }} />
    </div>
    <p class="manual-reading-percent">{props.progress}% through the guide</p>
  </div>
));

const ContentsLinks = component$<{ active: string; topic: string }>((props) => (
  <div class="manual-contents-groups">
    {CHAPTERS.map((group) => (
      <div class="manual-contents-group" key={group.label}>
        <p class="manual-contents-label">{group.label}</p>
        <ol>
          {group.links.map(([id, number, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                class={{ "toc-link": true, "is-current": props.active === id }}
                aria-current={props.active === id ? "location" : undefined}
              >
                <span aria-hidden="true">{number}</span>
                {label}
              </a>
              {CHAPTER_TOPICS[id] && (
                <ul class="manual-contents-topics">
                  {CHAPTER_TOPICS[id].map(([topic, title]) => (
                    <li key={topic}>
                      <a
                        href={`#${topic}`}
                        class={{ "is-current": props.topic === topic }}
                      >
                        {title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    ))}
  </div>
));

export default component$(() => {
  const platform = useSignal<ShortcutPlatform>("mac");
  const shortcuts = useComputed$(() => keybindingList(platform.value));
  const activeSection = useSignal("getting-started");
  const activeTopic = useSignal("");
  const readingProgress = useSignal(0);
  const currentChapter = useComputed$(
    () =>
      CHAPTER_LINKS.find(([id]) => id === activeSection.value) ??
      CHAPTER_LINKS[0],
  );

  // Native videos do not bubble play. A single capture listener covers both
  // the contextual films and the locale-aware introduction.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const manual = document.querySelector(".twyne-manual");
    if (!manual) return;
    const content = manual.querySelector<HTMLElement>(".manual-content");
    const sections = Array.from(
      manual.querySelectorAll<HTMLElement>(".manual-content > section[id]"),
    );
    const topics = Object.fromEntries(
      Object.entries(CHAPTER_TOPICS).map(([chapter, entries]) => [
        chapter,
        entries
          .map(([id]) => document.getElementById(id))
          .filter((element): element is HTMLElement => element !== null),
      ]),
    );
    let frame = 0;
    const updateReadingPosition = () => {
      frame = 0;
      const line = Math.min(160, window.innerHeight * 0.18);
      let current = sections[0]?.id ?? "getting-started";
      for (const section of sections) {
        if (section.getBoundingClientRect().top > line) break;
        current = section.id;
      }
      if (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      ) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      let topic = "";
      if (topics[current]) {
        for (const element of topics[current]) {
          if (element.getBoundingClientRect().top > line) break;
          topic = element.id;
        }
      }
      if (activeSection.value !== current) activeSection.value = current;
      if (activeTopic.value !== topic) activeTopic.value = topic;
      if (content) {
        const bounds = content.getBoundingClientRect();
        const start = bounds.top + window.scrollY;
        const distance = Math.max(1, bounds.height - window.innerHeight);
        const progress = Math.round(
          Math.max(0, Math.min(1, (window.scrollY - start) / distance)) * 100,
        );
        if (readingProgress.value !== progress)
          readingProgress.value = progress;
      }
    };
    const scheduleReadingPosition = () => {
      if (!frame) frame = window.requestAnimationFrame(updateReadingPosition);
    };
    const pauseAll = (except?: EventTarget | null) => {
      manual.querySelectorAll("video").forEach((video) => {
        if (video !== except && !video.paused) video.pause();
      });
    };
    // Films and narration take turns: a film pauses the narration, and the
    // narration's own play event pauses any film. Narration is left playing
    // through tab switches and contents links, because listening is meant to
    // go on while you look elsewhere.
    const onPlay = (event: Event) => {
      pauseAll(event.target);
      if (event.target instanceof HTMLVideoElement) pauseManualNarration();
    };
    const onVisibility = () => {
      if (document.hidden) pauseAll();
    };
    const onNavigate = () => pauseAll();
    const onLinkNavigate = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) {
        pauseAll();
      }
    };
    manual.addEventListener("play", onPlay, true);
    manual.addEventListener("click", onLinkNavigate, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("scroll", scheduleReadingPosition, {
      passive: true,
    });
    window.addEventListener("resize", scheduleReadingPosition);
    const resizeObserver = new ResizeObserver(scheduleReadingPosition);
    if (content) resizeObserver.observe(content);
    scheduleReadingPosition();
    cleanup(() => {
      pauseAll();
      manual.removeEventListener("play", onPlay, true);
      manual.removeEventListener("click", onLinkNavigate, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener("scroll", scheduleReadingPosition);
      window.removeEventListener("resize", scheduleReadingPosition);
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    });
  });

  return (
    <div class="twyne-manual" id="manual-top" role="main">
      <ManualNarrationHost titles={CHAPTER_TITLES} />
      <a class="manual-skip" href="#manual-content">
        Skip to the guide
      </a>
      <div class="manual-shell">
        <header class="manual-masthead">
          <div>
            <p class="manual-eyebrow">Twyne · A writer’s reference</p>
            <h1>The Manual</h1>
            <p class="manual-deck">
              From the first idea to the final proof. A guide to your writing
              desk, the House, and the voices in the margin. See the controls,
              follow a walkthrough, then try it in your own draft. Or press
              Listen at any chapter and hear Morgan's story read through to the
              end.
            </p>
          </div>
          <Link href="/editor/" class="btn-paper manual-desk-link">
            ← Back to the desk
          </Link>
        </header>
        <div class="manual-layout">
          <nav class="manual-contents" aria-label="Manual contents">
            <div class="manual-desktop-contents">
              <h2 class="manual-contents-title">In this guide</h2>
              <ReadingPosition
                chapter={currentChapter.value[1]}
                title={currentChapter.value[2]}
                progress={readingProgress.value}
              />
              <ContentsLinks
                active={activeSection.value}
                topic={activeTopic.value}
              />
            </div>
            <details class="manual-mobile-contents">
              <summary>In this guide</summary>
              <ReadingPosition
                chapter={currentChapter.value[1]}
                title={currentChapter.value[2]}
                progress={readingProgress.value}
              />
              <ContentsLinks
                active={activeSection.value}
                topic={activeTopic.value}
              />
            </details>
            <Link href="/house/" class="manual-house-link">
              Open your House →
            </Link>
          </nav>
          <article
            class="manual-content"
            id="manual-content"
            aria-label="The Twyne manual"
          >
            <section id="getting-started" class="manual-section">
              <p class="manual-chapter">01 · At the desk</p>
              <h2 class="manual-h2">Begin a piece</h2>
              <p class="manual-lead">
                Meet Morgan Vale, who has four thousand words about salt
                caravans and no idea what the essay is for. This manual follows
                that draft, Salt Roads, from a brief to a proof.
              </p>
              <ManualNarration
                chapter="getting-started"
                title={chapterTitle("getting-started")}
              />
              <ChapterIllustrations chapter="getting-started" />
              <p class="manual-p">
                Twyne is a writing desk with an editorial room attached. You
                write on the page. A small cast of editors reads in the margin,
                each with a different job, and nothing they say changes a word
                until you say so. Three habits make the room worth having:
              </p>
              <ol class="manual-start">
                <li>
                  <strong>Say what the piece is for.</strong> The{" "}
                  <a href="#dossier">dossier</a> holds the reader, the goal and
                  the shape of the piece. Editors with a brief give better notes
                  than editors guessing.
                </li>
                <li>
                  <strong>Write first, read notes later.</strong> Your draft
                  saves on this device as you type. The editors, the grade and
                  the research read it on their own when you pause; there is
                  nothing to press. <a href="#flow">The margin</a> holds
                  feedback beside the passage it belongs to, and waits until you
                  look up.
                </li>
                <li>
                  <strong>Revise on your own terms.</strong> Follow a note to
                  its passage, argue with it, ask a different editor, or check
                  the <a href="#rubric">galley proof</a>. Every change is yours
                  to make or refuse.
                </li>
              </ol>
              <p class="manual-route">
                <Link href="/editor/">Go to the writing desk →</Link>
              </p>
            </section>
            <section id="dossier" class="manual-section">
              <p class="manual-chapter">02 · At the desk</p>
              <h2 class="manual-h2">The dossier</h2>
              <p class="manual-lead">
                Morgan's first draft of Salt Roads was beautiful and pointless.
                The dossier is where you admit what a piece is supposed to do,
                so the editors can tell you whether it does it.
              </p>
              <ManualNarration
                chapter="dossier"
                title={chapterTitle("dossier")}
              />
              <ChapterIllustrations chapter="dossier" />
              <p class="manual-p">
                Before the room opens, it asks a short series of questions. They
                feel like paperwork and they are the opposite: a dossier is the
                difference between an editor saying "this paragraph is weak" and
                an editor saying "this paragraph loses the reader you said you
                were writing for." Answer briefly and honestly. You can change
                any answer later.
              </p>
              <p class="manual-p">
                Ten sections, and what each is really asking:
              </p>
              <ul class="manual-ul">
                <li>
                  <strong>Working title.</strong> A name the room can use. It
                  does not have to be the final one.
                </li>
                <li>
                  <strong>Form.</strong> Essay, memo, chapter, dispatch,
                  proposal. The shape sets expectations about length and
                  manners.
                </li>
                <li>
                  <strong>Reader.</strong> One real person, not a demographic.
                  "A friend who hates travel writing" beats "general readers."
                </li>
                <li>
                  <strong>Intent.</strong> What should be different in the
                  reader when they finish? This is the question Morgan could not
                  answer, and the one that fixed the essay.
                </li>
                <li>
                  <strong>Voice.</strong> How it should feel to read, not just
                  how it should sound.
                </li>
                <li>
                  <strong>Non-negotiables.</strong> Sources to keep, jargon to
                  avoid, the anecdote that must survive every cut.
                </li>
                <li>
                  <strong>Landing.</strong> How you will know the draft has done
                  its job. "The reader can picture the journey" is a test an
                  editor can apply.
                </li>
                <li>
                  <strong>Particulars.</strong> A few follow-up questions drawn
                  from your own answers, to sharpen the softest ones.
                </li>
                <li>
                  <strong>Prior material and References.</strong> Earlier
                  drafts, field notes, links: anything the room should read,
                  with a line on why it matters.
                </li>
              </ul>
              <p class="manual-p">
                The working copy grades each answer as you type, from vague to
                specific, and counts how many answers are carrying weight. A red
                mark is not a failure. It is the room telling you which question
                it would ask first.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>When the piece changes its mind:</strong> choose
                  Refine the dossier at the desk and rewrite the answer that no
                  longer holds. Each filing is kept as an edition, and the room
                  reads the new one on its next pass.
                </p>
              </div>
            </section>
            <section id="house" class="manual-section">
              <p class="manual-chapter">03 · At the desk</p>
              <h2 class="manual-h2">The House &amp; collections</h2>
              <p class="manual-lead">
                Salt Roads is the second of five coastal essays. Morgan is not
                going to type the same reader into five dossiers.
              </p>
              <ManualNarration chapter="house" title={chapterTitle("house")} />
              <ChapterIllustrations chapter="house" />
              <p class="manual-p">
                The House is everything you would otherwise repeat: the reader
                you usually write for, the standards you always hold, the tone
                of the whole enterprise. A collection narrows that for a series.
                A folio is one manuscript with its own dossier. Context flows
                downward, and the most specific layer wins:
              </p>
              <ol class="manual-inheritance" aria-label="Context inheritance">
                <li>
                  <strong>House</strong>
                  <span>Your reusable audience, purpose and standards.</span>
                </li>
                <li>
                  <strong>Collection</strong>
                  <span>Shared context for a series of related pieces.</span>
                </li>
                <li>
                  <strong>Folio</strong>
                  <span>One manuscript, with its own dossier.</span>
                </li>
              </ol>
              <p class="manual-p">
                A filled-in folio field overrides its collection, which
                overrides the House. Leave a field blank and it inherits.
                Working titles belong to each folio alone. Charter articles are
                the exception: they accumulate, so a House rule applies to every
                piece even when a collection adds rules of its own.
              </p>
              <dl class="manual-terms">
                <div>
                  <dt>Dossier</dt>
                  <dd>The brief that tells the room what a piece is for.</dd>
                </div>
                <div>
                  <dt>Charter</dt>
                  <dd>
                    Standards you require or prefer, at House, collection or
                    folio level. "Every claim grounded in a concrete scene" is a
                    Charter article.
                  </dd>
                </div>
                <div>
                  <dt>Edition</dt>
                  <dd>
                    A saved version of the dossier, with its source and reason.
                  </dd>
                </div>
                <div>
                  <dt>Amendment</dt>
                  <dd>
                    A proposed change to the dossier, usually offered from the
                    margin. It takes effect only when you file it.
                  </dd>
                </div>
              </dl>
              <p class="manual-p">
                Open <Link href="/house/">the House</Link> to arrange
                collections, inspect what a folio inherited, and read the
                register of changes. "What the models read" is the assembled
                dossier and charter exactly as the editors receive it; each tool
                adds its own instructions and excerpts on top. The Engine room
                holds developer diagnostics and nothing a writer needs.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>
                    If the editors start asking about something you never told
                    them:
                  </strong>{" "}
                  look in the register. A collection default or an inherited
                  Charter article is usually the answer, and the source stamp on
                  each field says which.
                </p>
              </div>
            </section>
            <section id="flow" class="manual-section">
              <p class="manual-chapter">04 · At the desk</p>
              <h2 class="manual-h2">Writing in flow</h2>
              <p class="manual-lead">
                Morgan writes in long runs and resents anything that interrupts
                one. The room is built to wait.
              </p>
              <ManualNarration chapter="flow" title={chapterTitle("flow")} />
              <ChapterIllustrations chapter="flow" />
              <p class="manual-p">
                While you work, Twyne can bring comments, sources, books,
                records and echoes of your earlier writing into the margin, each
                beside the passage it concerns. Nothing pops up over the page.
                Hover or focus a marker to see what it connects to; select it to
                open the conversation in the same margin.
              </p>
              <h3 class="manual-h3">A quieter page</h3>
              <p class="manual-p">
                Automatic focus reads your typing cadence. When you have been
                writing steadily for a while, it quiets the room: new cards
                wait, controls recede, and the page is the only thing left.
                Pause, or reach for the room, and it comes back. You can also
                enter focus yourself with Zen in the manuscript status bar, and
                leave it with <kbd class="manual-kbd">Esc</kbd>.
              </p>
              <h3 class="manual-h3">Help when you need it</h3>
              <p class="manual-p">
                When a passage stalls, the margin may offer a single connection
                or a short way into the next sentence. These are offers, not
                corrections; ignore them and they go away. If what you are
                writing drifts from the dossier, the room may propose an
                amendment. It never rewrites the brief behind your back.
              </p>
              <h3 class="manual-h3">Why two passages are side by side</h3>
              <p class="manual-p">
                Halfway through Salt Roads, Morgan writes about the salt
                merchant's ledger, and a card appears: Earlier in this piece.
                Unpaid promise. The opening said the ledger would explain the
                road, and nothing has explained it yet. The card names the
                relationship (an unpaid promise, a tension, an echo, a
                repetition, or the same subject) and says in a sentence why it
                matters. It shows both passages; select either to go to it.
              </p>
              <p class="manual-p">
                A relationship is a reading, not a fault. Some promises are
                meant to stay open. Choose That's the connection if the reading
                is right, or Not how I read it to set the card aside for good. A
                card matched only on shared words says so, rather than
                pretending to know more.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>Your controls:</strong> Automatic review, margin
                  tools, automatic focus and cover lookups each have their own
                  switch in the review controls. The desk learns your timing and
                  preferences on this device. Cover lookups are the one feature
                  here that talks to the outside world: they send book or record
                  titles to external catalogues.
                </p>
              </div>
            </section>
            <section id="the-piece" class="manual-section">
              <p class="manual-chapter">05 · At the desk</p>
              <h2 class="manual-h2">The piece</h2>
              <p class="manual-lead">
                Some problems only show up across the whole draft: the voice
                that shifts, the name spelled two ways, the character who
                vanishes for a chapter.
              </p>
              <ManualNarration
                chapter="the-piece"
                title={chapterTitle("the-piece")}
              />
              <ChapterIllustrations chapter="the-piece" />
              <h3 class="manual-h3">Useful without a model</h3>
              <p class="manual-p">
                The piece runs on this device, with no model and no cost. It
                watches first-person stance, similar names, and the conventions
                your draft mostly follows: spelling, small numbers, quotation
                marks, dashes and list punctuation. It also maps where each
                recurring name appears across the headed sections. A finding is
                a pattern worth a look. Whether it is a problem is your call.
              </p>
              <p class="manual-p">
                Choose Stance, Names, Style or Presence to see that lens on the
                page. Open a finding for its passages and the actions it offers.
                On a narrow screen the desk sits below the writing area, and
                Close gives the space back to the draft. Zen hides it while you
                write.
              </p>
              <h3 class="manual-h3">Know what the score means</h3>
              <p class="manual-p">
                The ≈ sign marks an estimate. Consistency can move as you
                revise, because local rules re-count; that movement is not a new
                editorial opinion. Score details separates the measures made by
                rule from those made by review. An overall estimate appears at
                about 150 words.
              </p>
              <p class="manual-p">
                Confirm with a full read asks for a fresh editorial reading of
                the current draft. It needs automatic review switched on, at
                least 500 words, and a signed-in model service. The desk says so
                when a request cannot run. Edit again afterwards and the score
                becomes an estimate until the new draft has been read.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>Your choices stay yours.</strong> Fixes change only
                  the listed passages, and Undo reverses them. A deliberate
                  exception stays with the folio on this device. Above 80,000
                  characters the desk pauses these checks and asks you to divide
                  the work into folios.
                </p>
              </div>
            </section>
            <section id="writing-instruments" class="manual-section">
              <p class="manual-chapter">06 · At the desk</p>
              <h2 class="manual-h2">Writing instruments</h2>
              <p class="manual-lead">
                A sentence that is almost right. A paragraph that sounds like
                one you wrote earlier. A scene with no sound in it. Each gets a
                tool that opens beside the words, not instead of them.
              </p>
              <ManualNarration
                chapter="writing-instruments"
                title={chapterTitle("writing-instruments")}
              />
              <p class="manual-p">
                Select text in the manuscript and the tools that fit it appear.
                Compare a revision works on one sentence; Hear it read, Threads,
                Scene bench and Task desk sit under More. The Compositor also
                opens Task desk from Review. Close a tool, or press Escape, and
                the page is back.
              </p>
              <ChapterIllustrations chapter="writing-instruments" />
              <h3 id="sentence-bench" class="manual-h3">
                Compare a revision
              </h3>
              <p class="manual-p">
                Put the cursor in a sentence, or select it, and choose{" "}
                <strong>Compare a revision</strong>. The original stays fixed at
                the top. Below it is a copy for you to change, and the sentence
                in its paragraph, showing the changes word by word. Switch to
                Revision or Original to read the paragraph either way. Fragments
                and more than one sentence are fine; nothing is generated for
                you, and grammar never blocks your own wording.
              </p>
              <p class="manual-p">
                <strong>Use revision</strong> makes the change as one edit, so
                one Undo puts the original back, and returns you to the page.
                Bold, italics, links and notes outside the words you changed are
                kept. If a change would cut through a note or mix formatting,
                the bench says so and leaves the page alone; copy the revision
                and make that edit yourself. <strong>Keep original</strong>, or
                Escape, closes the bench without touching the manuscript. If the
                sentence or its paragraph changes while the bench is open, Use
                revision stops working and your revision stays there to copy.
              </p>
              <p class="manual-p">
                <strong>Read the difference</strong> is optional, and only when
                you ask. It sends the original, your revision and the paragraph
                to your connected prose model once, and shows at most two
                changes in what a reader would understand, each quoting the
                words it is about. It does not rewrite, rank the versions or
                call a change safe. If it returns nothing, that is all it means;
                if you edit the revision, read it again. Selecting more than one
                sentence, or text that appears twice without a selection, is
                refused rather than guessed. Hear it in context reads the
                sentence before, your revision and the sentence after.
              </p>
              <h3 id="writing-threads" class="manual-h3">
                Follow a thread
              </h3>
              <p class="manual-p">
                Threads pairs exact sentences from the manuscript that may be
                talking to each other. Hover or keyboard-focus a pair to mark
                both passages; choose a sentence to go to it. Local checks find
                repeated wording, shared vocabulary and possible references. A
                relation stays unverified until the judgement service has read
                it; a model reading names its source and shows how sure it is.
              </p>
              <p class="manual-p">
                For an exact repeat, you can remove either occurrence as one
                undoable edit. Repetition is sometimes the point, so leaving
                both is always an option. If the passage changes, reopen the
                instrument before trusting its earlier reading.
              </p>
              <h3 id="writing-entities" class="manual-h3">
                Follow an entity through the piece
              </h3>
              <p class="manual-p">
                In the instrument desk, choose Entities. Select a name candidate
                to see every mention across the sections and read the source
                passages. The index is local and literal: it can include places
                or ordinary capitalised words, and a candidate is not a
                confirmed character. Spelling variants are grouped by a local
                rule.
              </p>
              <p class="manual-p">
                Choose a reading, then Read with judgement model to inspect
                relationships by section, compare a named attribute such as the
                colour of a coat, or try blind dialogue attribution. The blind
                reading hides speaker tags and is allowed to answer Unknown.
                Every result keeps its exact evidence and full distribution. A
                possible contradiction is a lead to chase, and a model's
                confidence is not a grade for your characterisation.
              </p>
              <h3 id="paragraph-readings" class="manual-h3">
                Read paragraphs; keep your choices
              </h3>
              <p class="manual-p">
                Open Paragraph readings in The piece to see each paragraph's
                scores and narrating tense. Local English cues and Jev readings
                are labelled separately so you know which is which. Inspect
                distributions and context shows the exact paragraph behind a
                reading, including a split or uncertain result. These readings
                stand apart from the whole-piece grade and its estimate.
              </p>
              <p class="manual-p">
                Keeping a deliberate style or name exception saves the existing
                uses in the folio's Charter. New drift can still be flagged.
                Check these again removes the exception. A save notice tells you
                if the choice could only be kept on this device.
              </p>
              <h3 id="instrument-room" class="manual-h3">
                Invite an editor into the work
              </h3>
              <p class="manual-p">
                Compare a revision, each Threads pair and Scene bench offer
                <strong> Ask the room</strong>. Your judgement model, Jev when
                selected, reads the passage, your working proposal and the
                tool's question, then chooses the editor most likely to help. It
                may choose no one. You can also pick an editor yourself.
              </p>
              <p class="manual-p">
                The chosen editor replies in Marginalia, with their portrait and
                name above the critique. The saved question keeps the original
                passage separate from any unapplied wording or scene idea, so
                the editor knows what is on the page and what is only proposed.
                The reply uses your writing model and your provider settings
                govern the charge. If the source changes before the request is
                filed, reopen the instrument. The manuscript stays yours.
              </p>
              <ChapterIllustrations chapter="instrument-room" />
              <h3 id="task-desk" class="manual-h3">
                Leave a question at the Task desk
              </h3>
              <p class="manual-p">
                Some questions need more than a margin note: "does the ford
                scene contradict the field notes?" Choose Writing review or
                Research selected account resources, confirm the reference
                passage, and describe what would help. For research, enable
                resource access in Account sources and choose up to three texts.
                The task reads those and only those; it does not search the open
                web.
              </p>
              <p class="manual-p">
                Sign in with Not Organic and sync the folio before queueing.
                Once your account accepts the request, the work continues on the
                server after you close the tab, using your hosted model and
                account credit. Come back to this folio's Task desk for the
                status, the result, the saved passage and the source excerpts.
                If the draft has moved on, read the earlier context before
                acting on the answer.
              </p>
              <p class="manual-p">
                You can cancel unfinished work. A request already with a
                provider may still finish and incur its charge, but its result
                is discarded. Mark a returned result Useful or Not useful and
                add a comment; the feedback is saved with the task. Results are
                proposals, never edits.
              </p>
              <h3 id="on-device-writing" class="manual-h3">
                Keep a few tools on your device
              </h3>
              <p class="manual-p">
                From Task desk, choose On-device tools. Passage connections,
                Words in context and Say it are separate English-language packs,
                each with its download size shown. Download &amp; load is an
                explicit choice, with Stop download and Remove pack beside it.
                Model files come from Hugging Face and the shared runtime from
                jsDelivr; keep the page open for the first load. Once installed,
                these tools use no account credit, and your passages and
                recordings never leave the device.
              </p>
              <p class="manual-p">
                Passage connections compares nearby passages you choose. Its
                similarity score is an invitation to read closer; it does not
                prove a repetition or a missing transition. For{" "}
                <strong>Say it</strong>, install the speech pack, select a
                sentence, then record up to a minute or pick an audio clip.
                Review the transcript before using it as a candidate wording.
                Browsers can clear or evict storage, so a pack may one day need
                downloading again.
              </p>
              <h3 id="scene-bench" class="manual-h3">
                See what a scene gives you
              </h3>
              <p class="manual-p">
                Scene bench takes stock of a passage by sense: place, time,
                light, sound, movement and pressure, each backed by exact quotes
                from your selection. The local English scan names the cue it
                found. A cue it did not find may still be there in a form it
                does not recognise. An optional judgement reading can select
                evidence and assess pressure; its service and cost appear before
                you ask for it. Hear the passage uses your narration player.
              </p>
              <ChapterIllustrations chapter="scene-bench" />
              <div class="manual-callout">
                <p>
                  <strong>Ideas stay beside the evidence.</strong> Under Try a
                  detail, save a sound or an image you want to try without
                  touching the manuscript. Image, sound and motion briefs keep
                  those additions clearly separate from the original passage,
                  ready to paste into another tool. See it as a reader might can
                  sketch a picture of the scene, but scene pictures are off
                  until you enable them in Settings, because generating one
                  spends credit. Above 12,000 characters or 64 sentences the
                  bench asks for a shorter selection.
                </p>
              </div>
            </section>
            <section id="room" class="manual-section">
              <p class="manual-chapter">07 · The editorial room</p>
              <h2 class="manual-h2">Your editors</h2>
              <p class="manual-lead">
                Five resident voices, each reading for something different. No
                single editor is right about everything, which is rather the
                point of having five.
              </p>
              <ManualNarration chapter="room" title={chapterTitle("room")} />
              <ManualVideo film={MANUAL_FILMS.room} />
              <ManualEditors />
              <p class="manual-p">
                You will come to know them by their faces. The same portraits
                accompany each editor's critiques, margin replies and rubric
                readings, so a glance tells you whether it was the sceptic or
                the copy chief who objected. A custom editor without a portrait
                signs with their initials. From any writing instrument, Ask the
                room brings one of them into the question you are already
                working on.
              </p>
              <h3 class="manual-h3">They read without being asked</h3>
              <p class="manual-p">
                Morgan never convenes the room. Once a draft reaches 500 words,
                the editors read it on their own the first time Morgan pauses.
                After that they come back whenever about 200 words are new or
                rewritten and the page has been quiet for a minute. A rewrite
                counts as much as new material, so tightening the harbour
                section brings fresh notes. They read only the paragraphs that
                changed, along with a sketch of how the draft has been moving.
              </p>
              <p class="manual-p">
                Those notes arrive marked in passing, lighter than the notes you
                ask for. There are at least five minutes between readings and a
                limit per session, because this spends model calls without a
                click. Get notes is still there when you want the whole room
                now. Read as I write, in the room settings, turns the automatic
                reading off.
              </p>
              <h3 class="manual-h3">Every quotation leads somewhere</h3>
              <p class="manual-p">
                When Professeur Athenæum quotes three lines of Salt Roads in one
                note, each quotation is underlined and goes to its own passage,
                not to the first one. Twyne matches the words literally. It
                ignores curly quotes, capitals and spacing, and follows a
                quotation with an ellipsis in it. If the same phrase appears
                twice, the words around the quotation in the note decide which
                one is meant.
              </p>
              <p class="manual-p">
                A quotation that could be either, or that is no longer in the
                draft because Morgan has since rewritten it, gets a dotted
                underline instead of a link. Hover over it to see why. Twyne
                would rather leave a quotation unplaced than send you to the
                wrong sentence, and it checks again every time the draft
                changes.
              </p>
              <h3 class="manual-h3">Meant as written, or for later</h3>
              <p class="manual-p">
                The abrupt ending of the ferry scene is deliberate, and Mlle.
                Sceptique will not stop pointing it out. Choose intentional on
                her note. Choose later for a note you agree with but will deal
                with after this draft. Either way, that editor will not raise
                the same passage again until its words change. The settled note
                steps back on the page, and selecting the label again undoes the
                decision. Decisions are kept on this device.
              </p>
              <h3 class="manual-h3">Arrange your room</h3>
              <ManualWalkthrough id="room" guide={GUIDES.room} />

              <div class="manual-callout">
                <p>
                  <strong>Custom editors:</strong> Visit{" "}
                  <Link
                    href="/personas"
                    class="underline hover:text-[var(--color-vermilion)]"
                  >
                    the Room of Editors
                  </Link>{" "}
                  to add, edit or reorder the cast. An editor needs a name, a
                  role and a description of how they talk; the more specific the
                  description, the more consistently the model stays in
                  character. Morgan's Route Reader exists because nobody else in
                  the room cared about distances.
                </p>
              </div>

              <h3 class="manual-h3">Changing the model</h3>
              <p class="manual-p">
                Each editor is only as good as the model reading for them. A
                careful, precise model makes Mlle. Sceptique sharper. A warmer
                one makes Sœur Encourageante more generous. In{" "}
                <Link
                  href="/settings"
                  class="underline hover:text-[var(--color-vermilion)]"
                >
                  Preferences
                </Link>{" "}
                you can assign different models to different jobs, and the room
                adapts.
              </p>
            </section>
            <section id="rubric" class="manual-section">
              <p class="manual-chapter">08 · The editorial room</p>
              <h2 class="manual-h2">The galley proof</h2>
              <p class="manual-lead">
                Salt Roads got a B. That is not information. The reasons under
                the grade are.
              </p>
              <ManualNarration
                chapter="rubric"
                title={chapterTitle("rubric")}
              />
              <ChapterIllustrations chapter="rubric" />
              <p class="manual-p">
                The <strong>static features</strong> are the part of the proof
                that never guesses: sentence length distribution, type-token
                ratio, citation density, paragraph shape. They are computed on
                this device, cost nothing and call nothing. They give you a
                cold, honest picture of the draft's mechanics, and nothing at
                all about whether it is any good.
              </p>
              <h3 class="manual-h3">Quick check</h3>
              <p class="manual-p">
                When the signed-in service is available, the default check makes
                one typed judgement request against your enabled criteria,
                custom ones included. You get a grade without separate verdicts
                from the five editors. If the quick check is unavailable, Twyne
                falls back to the room reading.
              </p>
              <h3 class="manual-h3">The editors' reading</h3>
              <p class="manual-p">
                The grade arrives on its own. Once the draft has 500 words and
                you pause, Twyne runs the quick check. The editors then read the
                new version themselves, at most once every ten minutes, and the
                grade stays on screen while they work. Until they finish, the
                Editors tab says soon rather than showing a zero. Choose Ask
                them now there if you would rather not wait. When the quick
                check refreshes after an edit, the editors' notes stay, marked
                as being about an earlier version until they read the new one.
                Each editor gives a score and a rationale, and the places where
                they disagree are usually where the revision is. This path
                combines editorial verdicts with the static features. Its Target
                Fit check caps the shape scores when a piece misses the audience
                or purpose in its dossier, because a beautifully built essay for
                the wrong reader is still the wrong essay.
              </p>
              <p class="manual-p">What the letters mean:</p>
              <ul class="manual-ul">
                <li>
                  <strong>A range.</strong> Publishable or nearly so. Polish.
                </li>
                <li>
                  <strong>B range.</strong> A solid draft with clear, fixable
                  problems. This is where Salt Roads sits.
                </li>
                <li>
                  <strong>C range.</strong> Doing the work, but a real pass is
                  still needed.
                </li>
                <li>
                  <strong>D to F range.</strong> The important next pass is
                  still ahead.
                </li>
              </ul>
              <div class="manual-callout">
                <p>
                  <strong>Use the rationale, not the letter:</strong> read the
                  explanation beside each criterion and hold it against your own
                  purpose. The rubric is one more reading of the draft. You
                  decide which of its complaints deserve a revision.
                </p>
              </div>
            </section>
            <section id="marginalia" class="manual-section">
              <p class="manual-chapter">09 · The editorial room</p>
              <h2 class="manual-h2">Margin conversations</h2>
              <p class="manual-lead">
                Every argument about a passage happens next to the passage. Your
                notes, the editors' notes, and the replies between them.
              </p>
              <ManualNarration
                chapter="marginalia"
                title={chapterTitle("marginalia")}
              />
              <ChapterIllustrations chapter="marginalia" />
              <p class="manual-p">
                Select any passage and choose Comment to leave a note in the
                margin. Notes belong to the folio and travel with it. Each one
                can hold replies, and Ask an editor invites a particular voice
                into the thread when you want a second opinion on your own
                doubt.
              </p>
              <p class="manual-p">
                Select a passage marker to unfold its thread beside the
                manuscript. Reply, ask an editor or resolve it there. One
                conversation is in the foreground at a time; on a narrow screen
                its card stays anchored to the passage. Press Esc to close it. A
                reply you have not sent survives switching threads during the
                visit, but not a reload, so send it or lose it.
              </p>
            </section>
            <section id="apparatus" class="manual-section">
              <p class="manual-chapter">10 · The editorial room</p>
              <h2 class="manual-h2">Research &amp; citations</h2>
              <p class="manual-lead">
                The 1911 survey, the tide table, the book Morgan keeps
                paraphrasing. The Apparatus notices them and keeps them in
                order.
              </p>
              <ManualNarration
                chapter="apparatus"
                title={chapterTitle("apparatus")}
              />
              <ChapterIllustrations chapter="apparatus" />
              <p class="manual-p">
                The Apparatus does three things: finds sources, keeps them, and
                cites them. As you write it recognises DOIs, URLs, ISBNs and
                author-year references in the text. You can also search by
                query; the panel returns a shortlist with title, author,
                publisher and a snippet. Save what matters to the bibliography
                and ignore the rest.
              </p>
              <p class="manual-p">
                The bibliography is formatted in the style you choose, MLA, APA
                or Chicago, and switches instantly when an editor changes their
                mind. Copy the whole list to the clipboard in one go.
              </p>
              <h3 class="manual-h3">Research that runs itself</h3>
              <p class="manual-p">
                Morgan does not ask for sources. A short while after Morgan
                stops typing, the Apparatus reads the draft and picks out what a
                careful reader would want backed up: the figure about the salt
                trade, the line quoted from the 1911 survey, the year the
                harbour closed. It searches for each one and files what it finds
                under the claim that prompted it. With your own model
                configured, that model picks the claims. Signed in without one,
                Twyne finds them in the text and Jev confirms which really need
                a source. In fiction, invented events are left alone.
              </p>
              <p class="manual-p">
                The panel always says what it is doing: reading the draft,
                searching, or why it is idle. It might be waiting for a pause,
                the draft might be too short, there might be no claims that need
                a source, or every claim may already be covered. Each claim in
                Deep trace explains its result. Found means sources are on file,
                so check that they support your wording. No match means the
                search ran and found nothing, so the claim may need softer
                wording or a source of your own. Failed means the search broke,
                which is not the same as finding nothing. Twyne tries a failed
                search again on its own after thirty seconds, two minutes and
                ten minutes; retry is there if you want it sooner. Go to the
                claim shows the sentence in the manuscript.
              </p>
              <div class="manual-callout">
                <p>
                  The full Apparatus lives at{" "}
                  <Link
                    href="/apparatus"
                    class="underline hover:text-[var(--color-vermilion)]"
                  >
                    /apparatus
                  </Link>
                  . The citation tab in the right panel shows a quick view of
                  what has been detected without leaving the page.
                </p>
              </div>
            </section>
            <section id="account-and-live" class="manual-section">
              <p class="manual-chapter">11 · The editorial room</p>
              <h2 class="manual-h2">Your account &amp; Live</h2>
              <p class="manual-lead">
                A name for the editors to address you by, and a way to talk to
                one out loud when typing is too slow.
              </p>
              <ManualNarration
                chapter="account-and-live"
                title={chapterTitle("account-and-live")}
              />
              <ChapterIllustrations chapter="account-and-live" />
              <p class="manual-p">
                Sign in with Not Organic to carry your account, hosted credits
                and plan across devices. Your name and picture identify you in
                the room; your email stays in private account settings and
                appears nowhere else. You can keep writing locally without ever
                signing in.
              </p>
              <p class="manual-p">
                Talk opens a voice conversation with an editor, from the
                compositor, from one of their comments, or from the narration
                player. Live shows captions, lets you mute the microphone, and
                can find passages or propose edits as you speak. A proposed edit
                waits for your approval before it touches the manuscript.
                Switching folios ends the conversation. Captions and microphone
                audio are not saved.
              </p>
              <p class="manual-p">
                Live needs a Pro plan or available Twyne welcome credit. A
                conversation reserves up to $0.50; delegated language requests
                cap at $0.05 each on top. The voice desk shows these limits
                before you start, which is why it is worth reading.
              </p>
            </section>
            <section id="manuscript-tools" class="manual-section">
              <p class="manual-chapter">12 · Your work</p>
              <h2 class="manual-h2">Manuscript &amp; source tools</h2>
              <p class="manual-lead">
                Headings, tables, a footnote, a pull quote set just so. The page
                is a real page, and when it is not enough there is the source
                underneath it.
              </p>
              <ManualNarration
                chapter="manuscript-tools"
                title={chapterTitle("manuscript-tools")}
              />
              <ManualVideo film={MANUAL_FILMS["manuscript-tools"]} />
              <h3 class="manual-h3" id="outline-and-find">
                Move through the manuscript
              </h3>
              <ChapterIllustrations chapter="outline-and-find" />
              <p class="manual-p">
                Type <strong>/</strong> at the start of a block to open the
                insert menu. The outline jumps between headings, and dragging a
                heading's section handle moves that section with everything
                under it in one undoable edit. Find and Replace understands
                whole words, case and regular expressions.
              </p>
              <h3 class="manual-h3" id="tables-and-images">
                Tables and images
              </h3>
              <ChapterIllustrations chapter="tables-and-images" />
              <p class="manual-p">
                Tables come with a size picker, captions, row and column tools,
                cell shading, alignment, borders and reusable visual presets.
                Images can be dropped, pasted or chosen from disk; select one to
                set its alt text, caption, alignment, width and see its upload
                status. Online images are stored with the folio. Deliberately
                offline work keeps an inline copy instead.
              </p>
              <h3 class="manual-h3" id="source-and-proof">
                Source and proof
              </h3>
              <ManualWalkthrough
                id="manuscript-tools"
                guide={GUIDES["manuscript-tools"]}
              />
              <p class="manual-p">
                The Typst workspace lets you edit the source directly and read a
                paginated proof. A source draft recovers on this device after a
                reload. Apply a valid draft to update the folio; if another
                device has changed the base in the meantime, resolve that
                conflict first. An invalid draft is never applied and stays
                there for you to fix.
              </p>
              <h3 class="manual-h3" id="page-layout">
                Shape the page
              </h3>
              <ChapterIllustrations chapter="page-layout" />
              <h3 class="manual-h3" id="notes-and-equations">
                Notes and equations
              </h3>
              <ChapterIllustrations chapter="notes-and-equations" />
              <p class="manual-p">
                Inline and display equations accept LaTeX and render on this
                device. Footnotes and endnotes are edited beside their
                references. The running header and footer live under View, then
                Layout, and the proof is where you check their placement. Notes
                and equations survive HTML and Markdown export intact.
              </p>
            </section>
            <section id="folios" class="manual-section">
              <p class="manual-chapter">13 · Your work</p>
              <h2 class="manual-h2">Folios, export &amp; publishing</h2>
              <p class="manual-lead">
                One piece per folio. Salt Roads, its outline and a scratch file
                of cut paragraphs share a collection and nothing else.
              </p>
              <ManualNarration
                chapter="folios"
                title={chapterTitle("folios")}
              />
              <ChapterIllustrations chapter="folios" />
              <p class="manual-p">
                Folios are separate documents with separate dossiers. Switch
                between them from the drawer. Each keeps its own word count,
                last-updated time and, if you want, its own layout settings.
              </p>
              <p class="manual-p">
                <strong>Export</strong> a folio as Markdown, standalone HTML,
                plain text, PDF, Word, Typst source, or a full Twyne backup: a
                JSON file with the brief, the folios and their content. All of
                it is under File in the masthead.
              </p>
              <p class="manual-p">
                <strong>Share</strong> publishes a public reading view of a
                folio. Anyone with the link can read it and nobody can edit it.
                Unpublish takes it down at once.
              </p>
              <p class="manual-p">
                <strong>Publish to your PDS</strong> by connecting Bluesky or
                another ATProto provider in the Share dialog. That connection is
                separate from your Not Organic sign-in. Twyne files a
                Standard.site publication and document in your own repository,
                serves a verifiable public reading page, and updates the same
                record when you publish again. Unpublishing removes the document
                from your PDS.
              </p>
              <p class="manual-p">
                <strong>PDF (Typst)</strong> compiles the manuscript on this
                device with bundled fonts, equations and diagrams included, and
                reports any source or asset problem before the export. You can
                also download the .typ source. Private editorial annotations are
                stripped from the exported copy; your saved source keeps them.
              </p>
              <h3 class="manual-h3">What a revision did</h3>
              <p class="manual-p">
                Twyne saves checkpoints on its own as you write, and whenever
                you ask for a grade. Version history describes each comparison
                in a sentence, written from the changes themselves: Rewrote
                three passages and cut one. The changes reach passages M. Le
                Stylo had notes on. Each changed passage is labelled Rewritten,
                Cut or New passage, with the before and after text together.
                When a rewrite reaches a passage an editor had a note on, the
                note is shown beside it. That shows the change reached the
                passage, not that it answered the note.
              </p>
              <p class="manual-p">
                Save checkpoint takes an optional line saying what the revision
                was for, such as "pay off the ledger promise", and that line
                names the checkpoint afterwards. The word and passage counts are
                still there under Size of the change. Restore always saves the
                current draft first.
              </p>
            </section>
            <section id="byok" class="manual-section">
              <p class="manual-chapter">14 · Your work</p>
              <h2 class="manual-h2">Bring your own key</h2>
              <p class="manual-lead">
                Morgan already pays for a model and would like the editors to
                use it. Three steps, once.
              </p>
              <ManualNarration chapter="byok" title={chapterTitle("byok")} />
              <ChapterIllustrations chapter="byok" />
              <p class="manual-p">
                <strong>Add a provider.</strong> In{" "}
                <Link
                  href="/settings"
                  class="underline hover:text-[var(--color-vermilion)]"
                >
                  Preferences
                </Link>
                , switch on Bring Your Own Key and add an OpenAI, Anthropic or
                Google key. For anything else, Groq, Together, Rivet, a local
                server, choose the OpenAI-compatible option and give it the base
                URL.
              </p>
              <p class="manual-p">
                <strong>Test the key.</strong> Choose Test key on the provider
                card. A successful check proves the key reaches the model list,
                and lets you refresh the models you can pick from.
              </p>
              <p class="manual-p">
                <strong>Pick models per feature.</strong> The per-feature grid
                assigns different models to the room, the rubric and the other
                tools. Spend the expensive model where reading quality matters
                and leave the rest on something cheaper.
              </p>
              <p class="manual-p">Supported providers:</p>
              <ul class="manual-ul">
                <li>OpenAI</li>
                <li>Anthropic</li>
                <li>Google</li>
                <li>
                  OpenAI-compatible (Groq, Together, Rivet, local servers, …)
                </li>
              </ul>
              <div class="manual-callout">
                <p>
                  <strong>If a connection fails:</strong> check the provider and
                  key in Preferences and test again. The desk keeps working
                  while a provider is down; only the editors go quiet.
                </p>
              </div>
            </section>
            <section id="privacy" class="manual-section">
              <p class="manual-chapter">15 · Your work</p>
              <h2 class="manual-h2">Privacy &amp; your data</h2>
              <p class="manual-lead">
                The manuscript is yours. Here is exactly where it goes, and
                where it does not.
              </p>
              <ManualNarration
                chapter="privacy"
                title={chapterTitle("privacy")}
              />
              <ChapterIllustrations chapter="privacy" />
              <p class="manual-p">
                <strong>API keys</strong> are saved in your browser's IndexedDB.
                A remote BYOK request passes through Twyne's server relay, which
                forwards your key and the request to the provider you chose and
                keeps neither. Local model endpoints are called directly.
              </p>
              <p class="manual-p">
                <strong>Drafts and folios</strong> are saved in your browser
                profile. Signing out does not erase that local copy. Signing in
                to an account that has no cloud snapshot can sync the existing
                local work into it, and signed-in sync is what gives you the
                same work on another device.
              </p>
              <p class="manual-p">
                <strong>AI calls</strong> send draft text to whichever model is
                reading. With your own key, that is the provider you chose,
                through the relay for remote endpoints. Hosted calls go through
                Convex and Not Organic, where provider processing and
                content-logging consent are managed.
              </p>
              <p class="manual-p">
                <strong>Published pieces</strong> are the only ones anyone else
                can read. Nothing becomes public until you publish it. Sharing
                and collaboration grant exactly the access you choose, through
                their own controls.
              </p>
            </section>
            <section id="shortcuts" class="manual-section">
              <p class="manual-chapter">16 · Your work</p>
              <h2 class="manual-h2">Keyboard shortcuts</h2>
              <p class="manual-p">
                Choose the labels for your keyboard. The same shortcut registry
                powers this guide and the desk.
              </p>
              <fieldset class="manual-platform">
                <legend>Shortcut labels</legend>
                <label>
                  <input
                    type="radio"
                    name="shortcut-platform"
                    value="mac"
                    checked={platform.value === "mac"}
                    onChange$={() => (platform.value = "mac")}
                  />
                  macOS
                </label>
                <label>
                  <input
                    type="radio"
                    name="shortcut-platform"
                    value="windows"
                    checked={platform.value === "windows"}
                    onChange$={() => (platform.value = "windows")}
                  />
                  Windows / Linux
                </label>
              </fieldset>
              <div class="manual-shortcuts">
                <KeybindingList entries={shortcuts.value} />
              </div>
            </section>
            <section id="launch-film" class="manual-section">
              <LaunchFilm />
              <p class="manual-p mt-5">
                The film follows your language choice in Preferences. French
                readers see the French edition, including narration and
                on-screen text; English and other languages use the English
                edition. With Automatic selected, Twyne follows your browser’s
                language preferences.
              </p>
            </section>
            <footer class="manual-colophon">
              <span>Twyne · The editorial room</span>
              <a href="#manual-top">Back to the beginning ↑</a>
            </footer>
          </article>
        </div>
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
        "The writer’s guide to Twyne, told through one essay: the brief, the House, the editorial room, source and proof, privacy, and keyboard shortcuts.",
    },
  ],
};
