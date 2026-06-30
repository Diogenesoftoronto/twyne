import { component$, $, useStore, type PropFunction } from "@builder.io/qwik";
import type { DossierAttachment } from "../../types";

const MAX_DOCUMENT_CHARS = 2000;

interface DossierAttachmentsEditorProps {
  attachments: DossierAttachment[];
  onChange$: PropFunction<(next: DossierAttachment[]) => void>;
}

export const DossierAttachmentsEditor = component$(
  ({ attachments, onChange$ }: DossierAttachmentsEditorProps) => {
    const store = useStore({
      kind: "document" as DossierAttachment["kind"],
      title: "",
      url: "",
      text: "",
      why: "",
      filename: "",
      truncatedNotice: "",
    });

    const reset = $(() => {
      store.title = "";
      store.url = "";
      store.text = "";
      store.why = "";
      store.filename = "";
      store.truncatedNotice = "";
    });

    const handleFile = $(async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      const file = input?.files?.[0];
      if (!file) return;
      const raw = await file.text();
      store.text = raw.slice(0, MAX_DOCUMENT_CHARS);
      store.filename = file.name;
      store.truncatedNotice =
        raw.length > MAX_DOCUMENT_CHARS
          ? `Trimmed to ${MAX_DOCUMENT_CHARS} characters for the dossier.`
          : "";
      if (!store.title) store.title = file.name;
      if (input) input.value = "";
    });

    const add = $(async () => {
      const why = store.why.trim();
      const title = store.title.trim();
      if (!why || !title) return;
      if (store.kind === "link" && !store.url.trim()) return;
      if (store.kind === "document" && !store.text.trim()) return;

      const next: DossierAttachment = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: store.kind,
        title,
        why,
        addedAt: Date.now(),
        ...(store.kind === "link"
          ? { url: store.url.trim() }
          : { text: store.text.trim().slice(0, MAX_DOCUMENT_CHARS) }),
      };
      await onChange$([...attachments, next]);
      await reset();
    });

    const remove = $(async (id: string) => {
      await onChange$(attachments.filter((a) => a.id !== id));
    });

    return (
      <div>
        <div class="flex gap-2">
          {(["document", "link"] as const).map((kind) => (
            <button
              key={kind}
              onClick$={() => {
                store.kind = kind;
              }}
              class={`flex-1 rounded-[3px] border py-1.5 text-sm ${
                store.kind === kind
                  ? "border-[var(--color-vermilion)] bg-[var(--color-vermilion)]/5"
                  : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]"
              }`}
              style="font-family: var(--font-typewriter);"
            >
              {kind === "document" ? "Document" : "Link"}
            </button>
          ))}
        </div>

        <input
          value={store.title}
          onInput$={(e) => {
            store.title = (e.target as HTMLInputElement).value;
          }}
          placeholder="Title"
          class="mt-3 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
          style="font-family: var(--font-serif); border-radius: 2px;"
        />

        {store.kind === "link" ? (
          <input
            value={store.url}
            onInput$={(e) => {
              store.url = (e.target as HTMLInputElement).value;
            }}
            placeholder="https://…"
            class="mt-2 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
            style="font-family: var(--font-serif); border-radius: 2px;"
          />
        ) : (
          <div class="mt-2">
            <textarea
              value={store.text}
              onInput$={(e) => {
                const raw = (e.target as HTMLTextAreaElement).value;
                store.text = raw.slice(0, MAX_DOCUMENT_CHARS);
                store.truncatedNotice =
                  raw.length > MAX_DOCUMENT_CHARS
                    ? `Trimmed to ${MAX_DOCUMENT_CHARS} characters for the dossier.`
                    : "";
                if (store.filename) store.filename = "";
              }}
              placeholder="Paste the document text"
              rows={4}
              class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
              style="font-family: var(--font-serif); border-radius: 2px;"
            />
            <div class="mt-1.5 flex items-center gap-3">
              <label
                class="btn-paper cursor-pointer text-xs"
                title="Upload a .txt, .md, or .html file"
              >
                ⇪ Upload a file
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html"
                  onChange$={handleFile}
                  class="hidden"
                />
              </label>
              {store.filename && (
                <span
                  class="text-xs text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Filed · {store.filename}
                </span>
              )}
            </div>
            {store.truncatedNotice && (
              <p
                class="mt-1 text-xs text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                {store.truncatedNotice}
              </p>
            )}
          </div>
        )}

        <input
          value={store.why}
          onInput$={(e) => {
            store.why = (e.target as HTMLInputElement).value;
          }}
          placeholder="Why does this matter to the piece? (one line)"
          class="mt-2 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
          style="font-family: var(--font-serif); border-radius: 2px;"
        />

        <button onClick$={add} class="btn-paper mt-2 text-sm">
          + Add to dossier
        </button>

        {attachments.length > 0 && (
          <ul class="mt-4 space-y-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                class="flex items-start justify-between gap-3 border border-[var(--color-paper-3)] px-3 py-2"
                style="border-radius: 2px;"
              >
                <div class="min-w-0">
                  <p
                  class="text-sm font-semibold text-[var(--color-ink)] truncate"
                  style="font-family: var(--font-display);"
                >
                    [{a.kind === "link" ? "link" : "doc"}] {a.title}
                  </p>
                  <p
                    class="mt-0.5 text-xs text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif); font-style: italic;"
                  >
                    {a.why}
                  </p>
                  {a.kind === "link" && a.url && (
                    <p
                      class="mt-1 text-[11px] text-[var(--color-ink-muted)] truncate"
                      style="font-family: var(--font-typewriter);"
                    >
                      {a.url}
                    </p>
                  )}
                </div>
                <button
                  onClick$={() => void remove(a.id)}
                  class="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                  aria-label={`Remove ${a.title}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
