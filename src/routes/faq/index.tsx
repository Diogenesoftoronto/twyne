import { component$, useStylesScoped$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { LegalPage } from "../../components/legal/legal-page";

interface QA {
  q: string;
  a: string;
}

const FAQS: QA[] = [
  {
    q: "What is Twyne?",
    a: "Twyne is a writing desk with a room of editors in residence. You file a short brief about what you're writing, then draft in the centre while AI personas read over your shoulder, leave marginalia, and grade the draft against a rubric.",
  },
  {
    q: "Do I need an account to use it?",
    a: "No. You can start writing immediately. Your brief and drafts are saved locally in your browser. Signing in is optional, and only needed if you want sync, backup, or account-based publishing.",
  },
  {
    q: "Where is my writing stored?",
    a: "By default, everything lives on your device in the browser's IndexedDB. Your writing leaves the device when you choose a feature that needs it: signing in to sync, using hosted AI, publishing, or sharing a reading link.",
  },
  {
    q: 'What does "bring your own key" (BYOK) mean?',
    a: "You can add your own OpenAI, Anthropic, Google, or OpenAI-compatible API key in Settings. BYOK requests run from your browser to the provider you choose, and the key is stored locally rather than on Twyne's servers.",
  },
  {
    q: "Which AI providers are supported?",
    a: "Twyne supports hosted AI when configured, BYOK providers such as OpenAI, Anthropic, Google, and OpenAI-compatible endpoints, plus desktop local model support when the native shell exposes it.",
  },
  {
    q: "What is a folio?",
    a: "A folio is a single document inside a project: a draft, notes, an outline, or another working version. A project can hold several folios, and each one carries its own content, layout, and running headers.",
  },
  {
    q: "How do I sign in?",
    a: "Two short steps: enter your email, then sign in with a passkey or a one-time code. A fresh code is sent on first sign-up and every time a passkey hasn't been set up — once you register one, the passkey becomes the default. Bluesky / ATProto is also available as a third option. Twyne does not use password login.",
  },
  {
    q: "Is Twyne free?",
    a: "The core writing desk is free to use, especially with your own AI key. Paid plans, when available, add hosted AI, higher limits, sync, publishing, or early access features.",
  },
  {
    q: "How do I get my work out of Twyne?",
    a: "Every folio can be exported as Markdown, HTML, plain text, or a .twyne.json backup from the folio menu. Your writing is yours.",
  },
  {
    q: "How do I get support?",
    a: "Email support@twyne.love. Include what you were trying to do, the browser or desktop version you used, and whether the work was local-only, synced, or published.",
  },
  {
    q: "Where can I learn more?",
    a: "The Manual covers the full editorial room in depth: the dossier, personas, galley proof, marginalia, apparatus, BYOK, privacy model, folios, export, and sharing.",
  },
];

export default component$(() => {
  useStylesScoped$(`
    .faq-list {
      display: grid;
      gap: 0.55rem;
    }

    .faq-item {
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      border-radius: 2px;
      overflow: clip;
    }

    .faq-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-height: 3.1rem;
      padding: 0.85rem 1rem;
      cursor: pointer;
      color: var(--color-ink);
      font-family: var(--font-display);
      font-size: 1rem;
      font-weight: 600;
      list-style: none;
      transition:
        background 0.15s ease,
        color 0.15s ease;
    }

    .faq-summary::-webkit-details-marker {
      display: none;
    }

    .faq-summary::after {
      content: "+";
      flex: 0 0 auto;
      width: 1.4rem;
      height: 1.4rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--color-paper-3);
      color: var(--color-vermilion);
      font-family: var(--font-typewriter);
      font-size: 0.9rem;
      line-height: 1;
      transition:
        transform 0.18s ease,
        border-color 0.15s ease;
    }

    .faq-item[open] .faq-summary {
      background: var(--color-paper-soft);
      color: var(--color-vermilion-2);
    }

    .faq-item[open] .faq-summary::after {
      content: "−";
      border-color: var(--color-vermilion);
      transform: rotate(180deg);
    }

    .faq-summary:hover {
      background: var(--color-paper-soft);
    }

    .faq-summary:focus-visible {
      outline: 2px solid var(--color-vermilion);
      outline-offset: -2px;
    }

    .faq-answer {
      padding: 0 1rem 1rem;
      border-top: 1px dashed var(--color-paper-3);
    }

    .faq-answer p {
      margin: 0.85rem 0 0;
      max-width: 68ch;
    }

    @media (prefers-reduced-motion: reduce) {
      .faq-summary,
      .faq-summary::after {
        transition: none;
      }
    }
  `);

  return (
    <LegalPage
      title="Frequently Asked Questions"
      lead="The short answers, before you file your brief."
    >
      <div class="faq-list">
        {FAQS.map((item, index) => (
          <details key={item.q} class="faq-item" open={index === 0}>
            <summary class="faq-summary">{item.q}</summary>
            <div class="faq-answer">
              <p class="doc-p">
                {item.a.includes("support@twyne.love") ? (
                  <>
                    Email{" "}
                    <a href="mailto:support@twyne.love">support@twyne.love</a>.
                    Include what you were trying to do, the browser or desktop
                    version you used, and whether the work was local-only,
                    synced, or published.
                  </>
                ) : (
                  item.a
                )}
              </p>
            </div>
          </details>
        ))}
      </div>
    </LegalPage>
  );
});

export const head: DocumentHead = {
  title: "FAQ · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Answers to common questions about Twyne: accounts, where your writing is stored, bring-your-own-key AI, folios, and exporting your work.",
    },
  ],
};
