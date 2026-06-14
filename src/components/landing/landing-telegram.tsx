/* eslint-disable qwik/jsx-img */
import { component$, type PropFunction } from "@builder.io/qwik";

interface Props {
  onStartBrief$: PropFunction<() => void>;
}

const items = [
  ["I.", "OPENS WITH AN INTERVIEW. NO BLANK PAGE."],
  ["II.", "EDITORIAL VOICES, GROUNDED IN YOUR BRIEF."],
  ["III.", "THREADED MARGINALIA AGAINST EVERY LINE."],
  ["IV.", "RUBRIC SCORING ALWAYS IN PLAIN VIEW."],
  ["V.", "CITATIONS DETECTED, NEVER BURIED."],
];

export const LandingTelegram = component$(({ onStartBrief$ }: Props) => {
  return (
    <div class="telegram paper-sheet">
      <div class="telegram-sheet paper-foxed">
        <span class="telegram-stamp">★ Urgent ★ Rcvd ★</span>

        <header class="telegram-header">
          <p class="from">— Western Editorial Bureau —</p>
          <h1>Telegram № 0427</h1>
        </header>

        <div class="telegram-meta">
          <div>
            From
            <strong>Twyne &amp; Co.</strong>
          </div>
          <div>
            To
            <strong>The Writer</strong>
          </div>
          <div>
            Filed
            <strong>26 Apr · MMXXVI</strong>
          </div>
        </div>

        <div class="telegram-body">
          <p>
            HAVE OPENED A WRITER-FIRST EDITING ROOM
            <span class="telegram-stop">STOP</span>
            CONTEXT FIRST, NEVER BLANK PAGES
            <span class="telegram-stop">STOP</span>
          </p>
          <p>
            BRIEF · DRAFT · CAST · RUBRIC · CITATIONS, ALL IN ONE ROOM
            <span class="telegram-stop">STOP</span>
            REVISE WITH VOICES, NOT ALGORITHMS
            <span class="telegram-stop">STOP</span>
          </p>
          <p>DEPARTMENTS HEREWITH ENUMERATED:</p>

          <ul class="telegram-list">
            {items.map(([n, body]) => (
              <li key={n}>
                <span class="num">{n}</span>
                <span>{body}</span>
              </li>
            ))}
          </ul>

          <p>
            REQUEST IMMEDIATE FILING OF FIRST DOSSIER
            <span class="telegram-stop">STOP</span>
            EDITORS ARE IN
            <span class="telegram-stop">STOP</span>
            END MESSAGE
            <span class="telegram-stop">STOP</span>
          </p>
        </div>

        <div class="telegram-actions">
          <button onClick$={onStartBrief$} class="telegram-button">
            ▸ Open a Dossier
          </button>
          <a href="#bottom" class="telegram-button ghost">
            Read Manifest
          </a>
          <img
            src="/approval-stamp.svg"
            alt=""
            class="h-12 w-12 stamp-tilt opacity-80 ml-auto"
          />
        </div>

        <p class="telegram-signoff" id="bottom">
          — Filed by Editorial Staff · Twyne &amp; Co. ✦ MMXXVI —
        </p>
      </div>

      {/* Second sheet — manifesto */}
      <div class="telegram-sheet paper-foxed mt-10">
        <header class="telegram-header">
          <p class="from">— Manifesto, Continued —</p>
          <h1>Why a Room?</h1>
        </header>

        <div class="telegram-body">
          <p>
            THE TROUBLE WITH MOST WRITING TOOLS, OUR CORRESPONDENT REPORTS, IS A
            PERFECT BLANK PAGE
            <span class="telegram-stop">STOP</span>
            INSPIRATION DOES NOT FOLLOW
            <span class="telegram-stop">STOP</span>
          </p>
          <p>
            TWYNE OPENS INSTEAD WITH A BRIEF — A SHORT, FIRM INTERVIEW
            <span class="telegram-stop">STOP</span>
            EVERY PARAGRAPH HAS SOMEWHERE TO POINT
            <span class="telegram-stop">STOP</span>
          </p>
          <p>
            VOICES, NOT AUTOMATED CHEERFULNESS
            <span class="telegram-stop">STOP</span>
            CITATIONS, NEVER FLATTERED — VERIFIED
            <span class="telegram-stop">STOP</span>
            END.
          </p>
        </div>

        <div class="telegram-actions">
          <button onClick$={onStartBrief$} class="telegram-button">
            ▸ Start Writing
          </button>
          <span class="telegram-signoff" style="margin-top:0;">
            Set in Special Elite
          </span>
        </div>
      </div>
    </div>
  );
});
