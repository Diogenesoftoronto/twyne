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
  ["sentence-bench", "Sentence bench"],
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
    const onPlay = (event: Event) => pauseAll(event.target);
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
              follow a walkthrough, then try it in your own draft.
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
                Give the room a direction. Then make the page your own.
              </p>
              <ChapterIllustrations chapter="getting-started" />
              <ol class="manual-start">
                <li>
                  <strong>Set the brief.</strong> The{" "}
                  <a href="#dossier">dossier</a> holds your audience, purpose
                  and the shape of the piece.
                </li>
                <li>
                  <strong>Write at the desk.</strong> Your draft saves on this
                  device.
                  <a href="#flow"> The margin</a> makes room for feedback
                  without taking you away.
                </li>
                <li>
                  <strong>Make a revision.</strong> Follow a comment to its
                  passage, ask an editor, or inspect the{" "}
                  <a href="#rubric">galley proof</a>. You choose what changes.
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
                Every piece worth writing needs a brief. The dossier is Twyne's
                way of keeping the writer honest about what they're trying to
                do.
              </p>
              <ChapterIllustrations chapter="dossier" />
              <p class="manual-p">
                Before the room opens, we ask seven questions. They are not
                optional flourishes — they are the spine of the editorial
                conversation. When you know your audience, your goal, your tone,
                your constraints, and what success looks like, the editors have
                something to grip. Without it, even the cleverest feedback is
                fishing in the dark.
              </p>
              <p class="manual-p">The seven fields:</p>
              <ul class="manual-ul">
                <li>
                  <strong>Working Title</strong> — A name the room can hold
                  onto.
                </li>
                <li>
                  <strong>Format</strong> — Essay, memo, chapter, dispatch,
                  proposal…
                </li>
                <li>
                  <strong>Audience</strong> — Name the actual reader, not a
                  demographic.
                </li>
                <li>
                  <strong>Goal</strong> — What should the piece accomplish?
                </li>
                <li>
                  <strong>Tone</strong> — How should it feel, not just sound?
                </li>
                <li>
                  <strong>Constraints</strong> — Sources to keep, jargon to
                  avoid, anecdotes to protect.
                </li>
                <li>
                  <strong>Success Signal</strong> — How will you know the draft
                  has landed?
                </li>
              </ul>
              <div class="manual-callout">
                <p>
                  <strong>Pro tip:</strong> You can refine the dossier at any
                  time by clicking "Refine the dossier" in the masthead. The
                  room picks up the new brief on the next pass.
                </p>
              </div>
            </section>
            <section id="house" class="manual-section">
              <p class="manual-chapter">03 · At the desk</p>
              <h2 class="manual-h2">The House &amp; collections</h2>
              <p class="manual-lead">
                A standard you set once can follow the next piece.
              </p>
              <ChapterIllustrations chapter="house" />
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
                A filled-in folio field takes precedence over its collection,
                then the House. Leave a field blank to inherit it. Working
                titles belong to each folio; charter articles accumulate across
                the three levels.
              </p>
              <dl class="manual-terms">
                <div>
                  <dt>Dossier</dt>
                  <dd>The brief that tells the room what a piece is for.</dd>
                </div>
                <div>
                  <dt>Charter</dt>
                  <dd>
                    Required or preferred standards for your House, collection
                    or folio.
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
                    A proposed change to the dossier. It takes effect when you
                    file it.
                  </dd>
                </div>
              </dl>
              <p class="manual-p">
                Open <Link href="/house/">the House</Link> to arrange
                collections, inspect inherited context and read the register of
                changes. “What the models read” shows the assembled dossier and
                charter; individual tools add their own instructions and
                excerpts. The Engine room holds developer diagnostics.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>When the piece changes direction:</strong> Refine the
                  dossier yourself, or review an amendment offered in the
                  margin. The room uses the updated brief on its next pass.
                </p>
              </div>
            </section>
            <section id="flow" class="manual-section">
              <p class="manual-chapter">04 · At the desk</p>
              <h2 class="manual-h2">Writing in flow</h2>
              <p class="manual-lead">
                The page stays central. Help can wait in the margin.
              </p>
              <ChapterIllustrations chapter="flow" />
              <p class="manual-p">
                While you work, Twyne can bring comments, sources, books,
                records and connections to earlier writing beside the relevant
                passage. Hover or focus a marker to see its connections; click
                it to open the conversation in the same margin.
              </p>
              <h3 class="manual-h3">A quieter page</h3>
              <p class="manual-p">
                Automatic focus uses your typing cadence to quiet the room
                during a sustained run. New ambient cards wait. When you pause
                or reach for the room, its controls return. You can enter focus
                yourself or leave it with <kbd class="manual-kbd">Esc</kbd>.
              </p>
              <h3 class="manual-h3">Help when you need it</h3>
              <p class="manual-p">
                When a passage stalls, the margin can offer one relevant
                connection or a short way into the next sentence. These are
                suggestions you can set aside. A change of purpose may prompt an
                amendment; it never silently rewrites your dossier.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>Your controls:</strong> Automatic review, margin
                  tools, automatic focus and cover lookups have separate
                  switches in the review controls. Timing and item preferences
                  are learned on this device. Cover lookups send book or record
                  titles to external catalogues.
                </p>
              </div>
            </section>
            <section id="the-piece" class="manual-section">
              <p class="manual-chapter">05 · At the desk</p>
              <h2 class="manual-h2">The piece</h2>
              <p class="manual-lead">
                See what changes across the draft, with the passages and
                controls to work on it.
              </p>
              <ChapterIllustrations chapter="the-piece" />
              <h3 class="manual-h3">Useful without a model</h3>
              <p class="manual-p">
                The local desk watches first-person stance, similar names and
                the conventions your draft mostly follows: spelling, small
                numbers, quotation marks, dashes and list punctuation. It also
                maps recurring names across headed sections. A finding is a
                pattern to inspect; you decide whether it needs a change.
              </p>
              <p class="manual-p">
                Select Stance, Names, Style or Presence to see that lens on the
                page. Open a finding for its passages and available actions. On
                a narrow screen, the desk sits below the writing area; Close
                returns the space to your draft. Zen hides it while you write.
              </p>
              <h3 class="manual-h3">Know what the score means</h3>
              <p class="manual-p">
                The ≈ sign identifies an estimate. Consistency can update from
                local rules as you revise; that change is not a new editorial
                reading. Score details separates measures by rule from those by
                review. An overall estimate begins at about 150 words.
              </p>
              <p class="manual-p">
                Confirm with a full read requests a fresh review of the current
                draft. It needs automatic review enabled, at least 500 words and
                an available signed-in model service. The desk explains when a
                request cannot run. Later edits make the score an estimate again
                until the revised draft has been read.
              </p>
              <div class="manual-callout">
                <p>
                  <strong>Your choices stay yours.</strong> Fixes change only
                  the listed passages and support Undo. Deliberate exceptions
                  stay with the folio on this device. For pieces above 80,000
                  characters, the desk pauses these checks and asks you to
                  divide the work into folios.
                </p>
              </div>
            </section>
            <section id="writing-instruments" class="manual-section">
              <p class="manual-chapter">06 · At the desk</p>
              <h2 class="manual-h2">Writing instruments</h2>
              <p class="manual-lead">
                Choose the words, hear their rhythm, follow a connection, or
                leave a question working at the desk.
              </p>
              <p class="manual-p">
                Select text in the manuscript to open the tools that belong to
                it. A word offers Word alternatives; a passage offers Sentence
                bench, Hear, Threads, Scene bench and Task desk. The Compositor
                also opens Task desk from Review. Close a tool or press Escape
                to return to the page.
              </p>
              <ChapterIllustrations chapter="writing-instruments" />
              <h3 id="sentence-bench" class="manual-h3">
                Work on a whole sentence
              </h3>
              <p class="manual-p">
                <strong>Rewrite</strong> brings together complete earlier
                wordings, available rule changes and model alternatives. Each
                identifies its source and word-count change. Compare alongside
                keeps the original beside the candidate; hover or keyboard-focus
                a candidate to preview it in the manuscript. Edit the working
                wording, then choose Use this wording. Grammar status and any
                unverified meaning are shown; your usual Undo restores the edit.
              </p>
              <p class="manual-p">
                <strong>Words</strong> shows bundled thesaurus choices inside
                the complete sentence and underlines words repeated in the
                paragraph. These choices can change the meaning. With the Words
                in context pack installed, On-device alternatives adds local
                word predictions. A likely word still needs your reading.
              </p>
              <p class="manual-p">
                <strong>Place</strong> shows neighbouring positions with the
                sentences on either side. Read each arrangement before choosing
                Move here. The reasons come from local rules; the positions have
                not received a model judgement. <strong>Hear</strong> reads the
                preceding sentence, the working wording and the following
                sentence through your narration player. It can use a downloaded
                local voice or your configured voice service.
              </p>
              <h3 id="writing-threads" class="manual-h3">
                Follow a thread
              </h3>
              <p class="manual-p">
                Threads pairs exact sentences from the manuscript. Hover or
                keyboard-focus a pair to mark both passages; choose a sentence
                to go to it. Local checks identify repeated wording, word
                overlap and possible references. A relation remains unverified
                unless the judgement service has read it; model readings name
                their source and show their uncertainty.
              </p>
              <p class="manual-p">
                For an exact repeat, you can remove either occurrence as one
                undoable edit. Repetition may be deliberate, so leaving both is
                always a choice. If the passage changes, reopen the instrument
                before acting on its earlier reading.
              </p>
              <h3 id="writing-entities" class="manual-h3">
                Follow an entity through the piece
              </h3>
              <p class="manual-p">
                In the instrument desk, choose Entities. Select a name candidate
                to see its mentions across sections and inspect the source
                passages. This local index can include places or ordinary
                capitalised words; a name candidate is not a confirmed
                character. Spelling variants are grouped by a local rule.
              </p>
              <p class="manual-p">
                Choose a reading, then Read with judgement model to inspect
                relationships by section, compare a named attribute such as a
                coat's colour, or try blind dialogue attribution. The blind
                reading withholds speaker tags and can answer Unknown. Each
                result keeps its exact evidence and full distribution available.
                A possible contradiction is a lead to inspect, and a model's
                confidence is not a grade for characterisation or dialogue.
              </p>
              <h3 id="paragraph-readings" class="manual-h3">
                Read paragraphs; keep your choices
              </h3>
              <p class="manual-p">
                Open Paragraph readings in The piece to inspect each paragraph's
                scores and narrating tense. Local English cues and Jev readings
                are labelled separately. Inspect distributions and context shows
                the exact paragraph behind a reading, including a split or
                uncertain result. These readings are separate from the
                whole-piece grade and its estimate.
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
                Sentence bench, each Threads pair and Scene bench offer
                <strong> Ask the room</strong>. Your judgement model, including
                Jev when selected, reads the current passage, your working
                proposal and the tool's question to choose a helpful editor. It
                can choose no one. You can also choose an editor yourself.
              </p>
              <p class="manual-p">
                The chosen editor replies in Marginalia, with their portrait and
                name above the critique. The saved question keeps the original
                passage separate from unapplied wording or scene ideas. The
                reply uses your writing model; provider settings govern charges.
                If the source changes before the request is filed, reopen the
                instrument. Your manuscript text stays yours to revise.
              </p>
              <ChapterIllustrations chapter="instrument-room" />
              <h3 id="task-desk" class="manual-h3">
                Leave a question at the Task desk
              </h3>
              <p class="manual-p">
                Choose Writing review or Research selected account resources,
                check the reference passage, and describe what would help. For
                research, enable resource access in Account sources and choose
                up to three texts. The task reads those resources; it does not
                search the open web.
              </p>
              <p class="manual-p">
                Sign in with Not Organic and sync the folio before queueing.
                Once your account accepts the request, server work can continue
                after the tab closes. It uses your hosted model and account
                credit. Return to this folio's Task desk for its status, result,
                saved passage and source excerpts. If the draft has changed,
                review the earlier context before using the result.
              </p>
              <p class="manual-p">
                You can cancel unfinished work. A request already sent to a
                provider may still finish and incur its charge, but its
                cancelled result is discarded. Mark a returned result Useful or
                Not useful and add a comment to save feedback with the task.
                Results remain proposals for your review.
              </p>
              <h3 id="on-device-writing" class="manual-h3">
                Keep a few tools on your device
              </h3>
              <p class="manual-p">
                From Task desk, choose On-device tools. Passage connections,
                Words in context and Say it are separate English-language packs
                with their download sizes shown. Download &amp; load is an
                explicit choice; Stop download and Remove pack are available.
                Model files come from Hugging Face and the shared runtime from
                jsDelivr. Keep the page open for the first load. These
                operations use no account credit, and your passages and
                recordings stay on this device.
              </p>
              <p class="manual-p">
                Passage connections compares nearby passages you supply. Its
                similarity measure invites a closer reading; it does not prove a
                repetition or missing transition. For <strong>Say it</strong>,
                install the speech pack, select a sentence, then record up to a
                minute or choose an audio clip. Review and edit the transcript
                before using it as a sentence candidate. Browser storage can be
                cleared or evicted, so a saved pack may need downloading again.
              </p>
              <h3 id="scene-bench" class="manual-h3">
                See what a scene gives you
              </h3>
              <p class="manual-p">
                Scene bench inventories place, time, light, sound, movement and
                pressure through exact quotes from the selected passage. The
                local English scan names its cues. A cue it does not find may
                still be present in the writing. An optional judgement reading
                can select evidence and assess pressure; its service and cost
                information appear before you request it. Hear the passage uses
                your narration player.
              </p>
              <ChapterIllustrations chapter="scene-bench" />
              <div class="manual-callout">
                <p>
                  <strong>Ideas stay beside the evidence.</strong> Save a detail
                  you want to try without changing the manuscript. Image, sound
                  and motion briefs keep those additions separate from the
                  original passage. You can copy a brief into another tool;
                  media generation is not connected here. The bench asks for a
                  shorter selection above 12,000 characters or 64 sentences.
                </p>
              </div>
            </section>
            <section id="room" class="manual-section">
              <p class="manual-chapter">07 · The editorial room</p>
              <h2 class="manual-h2">Your editors</h2>
              <p class="manual-lead">
                Five resident voices. Each reads with a different lens. Together
                they cover the ground a single editor can't.
              </p>
              <ManualVideo film={MANUAL_FILMS.room} />
              <ManualEditors />
              <p class="manual-p">
                Recognise a voice by its face as well as its name. The same
                portraits accompany the editors' critiques, margin replies and
                individual rubric readings. A custom editor without a portrait
                uses their initials. From a writing instrument, Ask the room
                brings an editor into the question you are already working on.
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
                  to add, edit, or rearrange your cast. Each editor needs a
                  name, a role, and a description of their voice. The AI uses
                  these to stay in character.
                </p>
              </div>

              <h3 class="manual-h3">Changing the Model</h3>
              <p class="manual-p">
                Each editor's voice is shaped by the model that reads for them.
                A careful, precise model makes Mlle. Sceptique sharper. A warmer
                model makes Sœur Encourageante more generous. Go to{" "}
                <Link
                  href="/settings"
                  class="underline hover:text-[var(--color-vermilion)]"
                >
                  Preferences
                </Link>{" "}
                to assign different models to different tasks — the room adapts.
              </p>
            </section>
            <section id="rubric" class="manual-section">
              <p class="manual-chapter">08 · The editorial room</p>
              <h2 class="manual-h2">The galley proof</h2>
              <p class="manual-lead">
                Check the shape of the draft, then choose an editorial reading.
              </p>
              <ChapterIllustrations chapter="rubric" />
              <p class="manual-p">
                The <strong>static features</strong> are deterministic —
                sentence length distribution, type-token ratio, citation
                density, paragraph shape. These never call an API and never cost
                a token. They give you a cold, honest picture of the draft's
                mechanical health.
              </p>
              <h3 class="manual-h3">Quick check</h3>
              <p class="manual-p">
                When the signed-in service is available, the default check uses
                one typed judgement request to assess your enabled criteria,
                including custom ones. This produces a grade without separate
                verdicts from the five editors. If the quick check is
                unavailable, Twyne tries the room reading instead.
              </p>
              <h3 class="manual-h3">Ask the editors</h3>
              <p class="manual-p">
                Choose “Ask the editors” for the independent room reading. Each
                persona gives a score and rationale. That path combines
                editorial verdicts with static features; its Target Fit check
                caps shape scores when the piece misses its audience or purpose.
              </p>
              <p class="manual-p">Grading scale:</p>
              <ul class="manual-ul">
                <li>
                  <strong>A range</strong> — Publishable or nearly so. Minor
                  polish.
                </li>
                <li>
                  <strong>B range</strong> — Solid draft with clear, fixable
                  issues.
                </li>
                <li>
                  <strong>C range</strong> — Doing the work but needs a real
                  pass.
                </li>
                <li>
                  <strong>D–F range</strong> — The important next pass is still
                  ahead.
                </li>
              </ul>
              <div class="manual-callout">
                <p>
                  <strong>Use the rationale:</strong> Read the explanation
                  beside a grade and compare it with your purpose. The rubric
                  gives you another reading of the draft; you decide what
                  deserves a revision.
                </p>
              </div>
            </section>
            <section id="marginalia" class="manual-section">
              <p class="manual-chapter">09 · The editorial room</p>
              <h2 class="manual-h2">Margin conversations</h2>
              <p class="manual-lead">
                Threaded comments alongside the draft. Your own notes, plus the
                editors' voices when you ask them in.
              </p>
              <ChapterIllustrations chapter="marginalia" />
              <p class="manual-p">
                Select any passage in the manuscript and click "Add margin" to
                pencil a margin note. Comments are folio-scoped — they travel
                with the draft, not the global state. Each comment can have
                replies, and you can ask any editor to weigh in by clicking "Ask
                an editor."
              </p>
              <p class="manual-p">
                Click a passage marker to unfold its thread beside the
                manuscript. Reply, ask an editor or resolve the comment there.
                One conversation stays in the foreground at a time; on a narrow
                screen, its card stays anchored to the passage. Press Esc to
                close it. Unsent replies survive switching threads during this
                visit, but not a reload.
              </p>
            </section>
            <section id="apparatus" class="manual-section">
              <p class="manual-chapter">10 · The editorial room</p>
              <h2 class="manual-h2">Research &amp; citations</h2>
              <p class="manual-lead">
                Research, bibliography, and citation — the machinery behind the
                prose.
              </p>
              <ChapterIllustrations chapter="apparatus" />
              <p class="manual-p">
                The Apparatus has three jobs: find sources, save them, and cite
                them. As you write, it detects DOIs, URLs, ISBNs, and
                author-year references automatically. You can also search for
                sources by query — the panel fetches a shortlist with title,
                author, publisher, and a snippet. Save what matters to your
                bibliography.
              </p>
              <p class="manual-p">
                Bibliographies are formatted in your chosen style — MLA, APA, or
                Chicago. Switch at any time; the saved entries reformat
                instantly. Copy the whole bibliography to your clipboard with
                one click.
              </p>
              <div class="manual-callout">
                <p>
                  The full Apparatus is available at{" "}
                  <Link
                    href="/apparatus"
                    class="underline hover:text-[var(--color-vermilion)]"
                  >
                    /apparatus
                  </Link>
                  . The right-panel citation tab shows a quick view of detected
                  references.
                </p>
              </div>
            </section>
            <section id="account-and-live" class="manual-section">
              <p class="manual-chapter">11 · The editorial room</p>
              <h2 class="manual-h2">Your account &amp; Live</h2>
              <p class="manual-lead">
                A name in the room. A conversation when you need one.
              </p>
              <ChapterIllustrations chapter="account-and-live" />
              <p class="manual-p">
                Sign in with Not Organic to use your account, hosted credits and
                plan across devices. Your account name and picture identify you
                in the room; your email belongs in private account settings. You
                can keep writing locally without signing in.
              </p>
              <p class="manual-p">
                Open Talk from the compositor, an editor’s comment or the
                narration player to speak with an editor. Live shows captions,
                lets you mute the microphone, and can find passages or propose
                edits. Approve a proposed edit before it changes your
                manuscript. Switching folios ends the conversation; captions and
                microphone recordings are not saved.
              </p>
              <p class="manual-p">
                Live requires a Pro plan or available Twyne welcome credit. A
                conversation reserves up to $0.50; delegated language requests
                have a separate $0.05 maximum each. The voice desk shows these
                limits before you start.
              </p>
            </section>
            <section id="manuscript-tools" class="manual-section">
              <p class="manual-chapter">12 · Your work</p>
              <h2 class="manual-h2">Manuscript &amp; source tools</h2>
              <p class="manual-lead">
                Structure the page, work in the source, and check the printed
                proof.
              </p>
              <ManualVideo film={MANUAL_FILMS["manuscript-tools"]} />
              <h3 class="manual-h3" id="outline-and-find">
                Move through the manuscript
              </h3>
              <ChapterIllustrations chapter="outline-and-find" />
              <p class="manual-p">
                Type <strong>/</strong> at the start of a block to open the
                command menu. Use the outline to jump among headings, or drag a
                heading's section handle to move that section and all of its
                subsections in one undoable edit. Find and Replace supports
                whole words, case sensitivity, and regular expressions.
              </p>
              <h3 class="manual-h3" id="tables-and-images">
                Tables and images
              </h3>
              <ChapterIllustrations chapter="tables-and-images" />
              <p class="manual-p">
                Tables support a dimension picker, captions, row and column
                tools, cell shading, alignment, borders, and reusable visual
                presets. Images can be dropped, pasted, or selected from disk;
                selecting an image reveals its alt text, caption, alignment,
                width, and upload status. Online images are stored with the
                folio, while deliberately offline work keeps an inline copy.
              </p>
              <h3 class="manual-h3" id="source-and-proof">
                Source and proof
              </h3>
              <ManualWalkthrough
                id="manuscript-tools"
                guide={GUIDES["manuscript-tools"]}
              />
              <p class="manual-p">
                The Typst workspace lets you edit the source and inspect a
                paginated proof. Source drafts recover locally after a reload.
                Apply a valid draft to update the folio; if another device has
                changed its base, resolve that conflict before applying. An
                invalid draft stays available to fix.
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
                Inline and display equations accept LaTeX and render locally.
                Footnotes and endnotes can be edited beside their references,
                and View → Layout holds the running header and footer controls.
                Inspect their placement in the proof. Notes and equations remain
                portable in HTML and Markdown exports.
              </p>
            </section>
            <section id="folios" class="manual-section">
              <p class="manual-chapter">13 · Your work</p>
              <h2 class="manual-h2">Folios, export &amp; publishing</h2>
              <p class="manual-lead">
                One piece per folio. Related pieces can share a collection.
              </p>
              <ChapterIllustrations chapter="folios" />
              <p class="manual-p">
                Folios are separate documents. You might keep a main draft,
                scratch notes and an outline together in a collection. Switch
                between them from the left drawer. Each folio keeps its own word
                count, update time, and (optionally) its own layout settings.
              </p>
              <p class="manual-p">
                <strong>Export</strong> your folio as Markdown, standalone HTML,
                plain text, PDF, Word, Typst source, or a full Twyne backup
                (JSON with brief, folios, and content). Use the File menu in the
                masthead.
              </p>
              <p class="manual-p">
                <strong>Share</strong> a public reading view of any folio.
                Anyone with the link can read it; no one can edit it. Unpublish
                instantly.
              </p>
              <p class="manual-p">
                <strong>Publish to your PDS</strong> by connecting Bluesky or
                another ATProto provider in the Share dialog. This publishing
                connection is separate from your Not Organic sign-in. Twyne
                files a Standard.site publication and document in your own
                repository, serves a verifiable public reading page, and updates
                the same record when you re-publish. Unpublishing removes the
                document from your PDS.
              </p>
              <p class="manual-p">
                <strong>PDF (Typst)</strong> compiles your manuscript on this
                device with bundled fonts. The proof supports equations and
                diagrams, and reports source or asset problems before export.
                You can also download the .typ source. Private editorial
                annotations are removed from that exported copy; your saved
                source stays intact.
              </p>
            </section>
            <section id="byok" class="manual-section">
              <p class="manual-chapter">14 · Your work</p>
              <h2 class="manual-h2">Bring your own key</h2>
              <p class="manual-lead">
                Choose a hosted model or connect a provider you already use.
              </p>
              <ChapterIllustrations chapter="byok" />
              <p class="manual-p">
                <strong>Step 1: Add a provider.</strong> Go to{" "}
                <Link
                  href="/settings"
                  class="underline hover:text-[var(--color-vermilion)]"
                >
                  Preferences
                </Link>{" "}
                and turn on "Bring Your Own Key." Add your OpenAI, Anthropic, or
                Google key. For other providers (Groq, Together, Rivet), use the
                "OpenAI-compatible" option with your base URL.
              </p>
              <p class="manual-p">
                <strong>Step 2: Pick models per feature.</strong> The
                per-feature grid lets you choose different models for the room,
                rubric and other tools. Use the models available from your
                connected provider.
              </p>
              <p class="manual-p">
                <strong>Step 3: Test the key.</strong> Choose "Test key" on the
                provider card to check access to its model list. A successful
                check lets you refresh the available models and choose one for
                the feature you want to use.
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
                  <strong>If a connection fails:</strong> Check the provider and
                  key in Preferences, then test the connection again. You can
                  keep drafting while the provider is unavailable.
                </p>
              </div>
            </section>
            <section id="privacy" class="manual-section">
              <p class="manual-chapter">15 · Your work</p>
              <h2 class="manual-h2">Privacy &amp; your data</h2>
              <p class="manual-lead">
                Your manuscript is yours. We intend to keep it that way.
              </p>
              <ChapterIllustrations chapter="privacy" />
              <p class="manual-p">
                <strong>API keys:</strong> Saved in your browser’s IndexedDB.
                Remote BYOK requests pass through Twyne’s server relay, which
                forwards your key and request to the selected provider. Local
                model endpoints stay direct.
              </p>
              <p class="manual-p">
                <strong>Drafts and folios:</strong> Saved locally in your
                browser profile via IndexedDB. Signing out does not erase that
                local copy. Signing into an account with no cloud snapshot can
                sync the existing local work into that account. Signed-in sync
                provides cross-device access.
              </p>
              <p class="manual-p">
                <strong>AI calls:</strong> When you BYOK, your draft text goes
                to the provider you chose, through the relay for remote
                endpoints. Hosted calls go through Convex and Not Organic.
                Provider processing and content-logging consent are managed in
                Not Organic.
              </p>
              <p class="manual-p">
                <strong>Published pieces:</strong> Only what you explicitly
                publish becomes a public reading page. Local work remains in the
                browser profile; sharing and collaboration grant the access you
                choose through their own controls.
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
        "The writer’s guide to Twyne: your desk, reusable House context, margin conversations, source and proof, privacy, and keyboard shortcuts.",
    },
  ],
};
