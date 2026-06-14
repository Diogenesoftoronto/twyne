import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import type { Folio } from "../../types";
import {
  loadFoliosFromIdb,
  loadFolioContentFromIdb,
  saveActiveFolioIdToIdb,
} from "../../utils/idb";

interface FolioCard extends Folio {
  words: number;
  preview: string;
}

interface LibraryStore {
  cards: FolioCard[];
  sort: "recent" | "name";
  loaded: boolean;
}

function stripHtml(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent ?? "";
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TYPE_LABEL: Record<Folio["type"], string> = {
  draft: "Draft",
  notes: "Notes",
  outline: "Outline",
};

export default component$(() => {
  const nav = useNavigate();
  const store = useStore<LibraryStore>({
    cards: [],
    sort: "recent",
    loaded: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const folios = await loadFoliosFromIdb();
    const cards: FolioCard[] = [];
    for (const f of folios) {
      const html = await loadFolioContentFromIdb(f.id);
      const text = stripHtml(html).replace(/\s+/g, " ").trim();
      cards.push({
        ...f,
        words: text ? text.split(/\s+/).length : 0,
        preview: text.slice(0, 220),
      });
    }
    store.cards = cards;
    store.loaded = true;
  });

  useStylesScoped$(`
    .doc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: 1rem;
    }
    .doc-card {
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      border-radius: 4px;
      padding: 1rem;
      text-align: left;
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.12s;
      display: flex;
      flex-direction: column;
      min-height: 11rem;
    }
    .doc-card:hover {
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
      transform: translateY(-2px);
    }
    .doc-preview {
      font-family: var(--font-serif);
      font-size: 0.82rem;
      line-height: 1.5;
      color: var(--color-ink-light);
      flex: 1;
      overflow: hidden;
    }
  `);

  const open = $(async (id: string) => {
    await saveActiveFolioIdToIdb(id);
    await nav("/");
  });

  const sorted = [...store.cards].sort((a, b) =>
    store.sort === "name"
      ? a.name.localeCompare(b.name)
      : b.updatedAt - a.updatedAt,
  );

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-5xl mx-auto px-6 py-8">
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
              The Library
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              Every piece on your desk. {store.cards.length} folio
              {store.cards.length === 1 ? "" : "s"}.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <button
              onClick$={() => {
                store.sort = store.sort === "recent" ? "name" : "recent";
              }}
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Sort: {store.sort === "recent" ? "Recent" : "Name"}
            </button>
            <Link
              href="/"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Back to desk
            </Link>
          </div>
        </div>

        {store.loaded && store.cards.length === 0 && (
          <div class="text-center py-20 text-[var(--color-ink-muted)]">
            <p>No folios yet.</p>
            <Link href="/" class="btn-press mt-4 inline-block text-sm">
              Start writing →
            </Link>
          </div>
        )}

        <div class="doc-grid">
          {sorted.map((c) => (
            <button key={c.id} class="doc-card" onClick$={() => open(c.id)}>
              <div class="flex items-center justify-between mb-2">
                <span
                  class="dept-label text-[0.6rem]"
                  style={{
                    fontFamily: "var(--font-typewriter)",
                    color: "var(--color-vermilion)",
                  }}
                >
                  {TYPE_LABEL[c.type] ?? "Draft"}
                </span>
                <span
                  class="text-[0.65rem] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {relativeTime(c.updatedAt)}
                </span>
              </div>
              <h3
                class="text-base font-semibold mb-1"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {c.name || "Untitled"}
              </h3>
              <p class="doc-preview">{c.preview || "Empty draft."}</p>
              <p
                class="text-[0.65rem] text-[var(--color-ink-muted)] mt-2"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {c.words.toLocaleString()} word{c.words === 1 ? "" : "s"}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Library · Twyne",
  meta: [
    { name: "description", content: "All your Twyne folios in one place." },
  ],
};
