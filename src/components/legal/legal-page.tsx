import { component$, Slot, useStylesScoped$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

interface TocEntry {
  /** Anchor id of the section heading. */
  id: string;
  /** Label shown in the contents index. */
  label: string;
}

interface LegalPageProps {
  /** Small department label above the title (e.g. "Twyne"). */
  kicker?: string;
  /** Page title (e.g. "Terms of Service"). */
  title: string;
  /** Italic lead line under the title. */
  lead?: string;
  /** Human "last updated" string, shown in the masthead. */
  updated?: string;
  /** Optional in-page index, rendered as a broadsheet "Contents" card. */
  toc?: TocEntry[];
}

/**
 * Shared broadsheet-styled shell for the static legal / informational pages
 * (Terms, Privacy, Downloads, FAQ). The body is projected through <Slot/> into
 * a scrollable "manuscript" editor frame that echoes the landing workspace.
 *
 * The `.doc-*` typographic classes and the `.legal-editor*` frame live in
 * global.css — not in this component's scoped block — because projected Slot
 * content is owned by the parent route and never receives this component's
 * scope attribute, so scoped rules would not reach it.
 */
export const LegalPage = component$<LegalPageProps>(
  ({ kicker = "Twyne", title, lead, updated, toc }) => {
    useStylesScoped$(`
      .doc-toc {
        margin-bottom: 1.25rem;
      }
      .doc-toc-title {
        font-family: var(--font-typewriter);
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--color-ink-muted);
        margin-bottom: 0.75rem;
      }
      .doc-toc-list {
        counter-reset: toc;
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.1rem 1.5rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      @media (min-width: 640px) {
        .doc-toc-list {
          grid-template-columns: 1fr 1fr;
        }
      }
      .doc-toc-list a {
        counter-increment: toc;
        display: flex;
        align-items: baseline;
        gap: 0.6rem;
        padding: 0.32rem 0.25rem;
        font-family: var(--font-serif);
        font-size: 0.9rem;
        line-height: 1.45;
        color: var(--color-ink-light);
        border-bottom: 1px dotted transparent;
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .doc-toc-list a::before {
        content: counter(toc, decimal-leading-zero);
        flex: 0 0 auto;
        font-family: var(--font-typewriter);
        font-size: 0.68rem;
        color: var(--color-vermilion);
      }
      .doc-toc-list a:hover {
        color: var(--color-ink);
        border-bottom-color: var(--color-paper-3);
      }
    `);

    return (
      <div
        class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        <div class="max-w-3xl mx-auto px-6 py-8">
          <div class="flex items-start justify-between mb-8 gap-4">
            <div>
              <p
                class="dept-label mb-1"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {kicker}
              </p>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "1.75rem",
                }}
              >
                {title}
              </h1>
              {lead && <p class="doc-lead mt-2 !mb-0">{lead}</p>}
              {updated && (
                <p
                  class="mt-2 text-[0.7rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  Last updated {updated}
                </p>
              )}
            </div>
            <Link
              href="/"
              class="btn-paper text-sm flex-shrink-0"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Home
            </Link>
          </div>

          {toc && toc.length > 0 && (
            <nav class="folio doc-toc p-6 md:p-7" aria-label="Contents">
              <p class="doc-toc-title">In this document</p>
              <ul class="doc-toc-list">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a href={`#${entry.id}`}>{entry.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div class="legal-editor">
            <div class="legal-editor__bar" aria-hidden="true">
              <span class="rule" />
              <span class="star">✦</span>
              <span class="mark">Folio · {title}</span>
              <span class="star">✦</span>
              <span class="rule" />
            </div>
            <div class="legal-editor__scroll" tabIndex={0}>
              <article class="legal-doc">
                <Slot />
              </article>
            </div>
          </div>

          <nav
            class="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--color-ink-light)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
            aria-label="Footer"
          >
            <Link href="/docs/" class="hover:text-[var(--color-ink)]">
              The Manual
            </Link>
            <Link href="/faq/" class="hover:text-[var(--color-ink)]">
              FAQ
            </Link>
            <Link href="/downloads/" class="hover:text-[var(--color-ink)]">
              Downloads
            </Link>
            <Link href="/terms/" class="hover:text-[var(--color-ink)]">
              Terms
            </Link>
            <Link href="/privacy/" class="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
          </nav>
        </div>
      </div>
    );
  },
);
