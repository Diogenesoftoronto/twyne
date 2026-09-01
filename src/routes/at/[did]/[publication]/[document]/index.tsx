import { component$ } from "@qwik.dev/core";
import { Link, routeLoader$, type DocumentHead } from "@qwik.dev/router";
import {
  loadStandardSiteDocument,
  standardSiteRouteDid,
  type StandardSiteDocumentPage,
} from "../../../../../utils/standard-site-reader.server";

interface LoaderData {
  page: StandardSiteDocumentPage | null;
}

export const useStandardSiteDocument = routeLoader$(
  async ({ params, status }): Promise<LoaderData> => {
    try {
      const did = standardSiteRouteDid(params.did ?? "");
      const page = await loadStandardSiteDocument(
        did,
        params.publication ?? "",
        params.document ?? "",
      );
      if (!page) status(404);
      return { page };
    } catch {
      status(404);
      return { page: null };
    }
  },
);

export default component$(() => {
  const loaded = useStandardSiteDocument();
  const page = loaded.value.page;

  return (
    <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <header class="border-b border-[var(--color-paper-3)]">
        <div class="mx-auto max-w-2xl px-6 pt-10 pb-6">
          <p class="text-center">
            {page ? (
              <a
                href={page.publication.url}
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                ← {page.publication.name}
              </a>
            ) : (
              <Link
                href="/"
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                ← Twyne
              </Link>
            )}
          </p>
        </div>
      </header>

      <div class="mx-auto max-w-2xl px-6 py-10">
        {!page && (
          <div
            class="border border-dashed border-[var(--color-paper-3)] p-8 text-center"
            style="border-radius: 2px;"
          >
            <p
              class="text-base text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              This Standard.site piece isn't here.
            </p>
            <p
              class="mt-2 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              Its writer may have unpublished it from their PDS.
            </p>
          </div>
        )}

        {page && (
          <article>
            <p
              class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              {formatDate(page.document.publishedAt)} · {page.publication.name}
            </p>
            <h1
              class="mt-2 text-4xl text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em;"
            >
              {page.document.title}
            </h1>
            {page.document.description && (
              <p
                class="mt-3 text-base italic leading-relaxed text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                {page.document.description}
              </p>
            )}
            <div
              class="mt-8 twyne-blog-prose text-[var(--color-ink)]"
              style="font-family: var(--font-serif);"
              dangerouslySetInnerHTML={page.document.html}
            />
            <p class="mt-12 border-t border-dashed border-[var(--color-paper-3)] pt-6">
              <a
                href={`https://pdsls.dev/${encodeURIComponent(page.document.uri)}`}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                Inspect the writer-owned record ↗
              </a>
            </p>
          </article>
        )}
      </div>
    </main>
  );
});

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const head: DocumentHead = ({ params, resolveValue }) => {
  const page = resolveValue(useStandardSiteDocument).page;
  const title = page?.document.title ?? "Read";
  const description =
    page?.document.description ||
    page?.document.textContent.slice(0, 180) ||
    "A Standard.site piece published from Twyne.";
  return {
    title: `Twyne · ${title}`,
    meta: [
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...(page ? [{ name: "author", content: page.publication.name }] : []),
    ],
    links: page
      ? [
          {
            key: "standard-site-document",
            rel: "site.standard.document",
            href: page.document.uri,
          },
        ]
      : [],
    frontmatter: {
      did: params.did,
      publication: params.publication,
      document: params.document,
    },
  };
};
