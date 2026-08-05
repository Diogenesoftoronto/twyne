import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import {
  loadStandardSitePublication,
  standardSiteRouteDid,
  type StandardSitePublicationPage,
} from "../../../../utils/standard-site-reader.server";

interface LoaderData {
  page: StandardSitePublicationPage | null;
}

export const useStandardSitePublication = routeLoader$(
  async ({ params, status }): Promise<LoaderData> => {
    try {
      const did = standardSiteRouteDid(params.did ?? "");
      const page = await loadStandardSitePublication(
        did,
        params.publication ?? "",
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
  const loaded = useStandardSitePublication();
  const page = loaded.value.page;

  return (
    <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <header class="border-b border-[var(--color-paper-3)]">
        <div class="mx-auto max-w-2xl px-6 pt-10 pb-8">
          <p
            class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-2"
            style="font-family: var(--font-typewriter);"
          >
            <Link href="/" class="hover:text-[var(--color-vermilion)]">
              ← Twyne
            </Link>
          </p>
          {page ? (
            <>
              <h1
                class="text-3xl text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 700;"
              >
                {page.publication.name}
              </h1>
              {page.publication.description && (
                <p
                  class="mt-3 text-base leading-relaxed text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  {page.publication.description}
                </p>
              )}
              <p
                class="mt-3 text-[10px] tracking-[0.16em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                Standard.site publication · owned by its writer on ATProto
              </p>
            </>
          ) : (
            <h1
              class="text-3xl text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 700;"
            >
              This publication isn't here.
            </h1>
          )}
        </div>
      </header>

      <div class="mx-auto max-w-2xl px-6 py-10">
        {page && page.documents.length === 0 && (
          <p
            class="text-sm italic text-[var(--color-ink-muted)]"
            style="font-family: var(--font-serif);"
          >
            Nothing published yet.
          </p>
        )}
        {page && page.documents.length > 0 && (
          <ul class="space-y-8">
            {page.documents.map((document) => (
              <li key={document.uri}>
                <p
                  class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  {formatDate(document.publishedAt)}
                </p>
                <h2
                  class="mt-1 text-2xl text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 700;"
                >
                  <a
                    href={document.url}
                    class="hover:text-[var(--color-vermilion)]"
                  >
                    {document.title}
                  </a>
                </h2>
                {document.description && (
                  <p
                    class="mt-1 text-sm leading-relaxed text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    {document.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
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
  const page = resolveValue(useStandardSitePublication).page;
  const title = page?.publication.name ?? "Publication";
  const description =
    page?.publication.description ?? "A Standard.site publication on Twyne.";
  return {
    title: `Twyne · ${title}`,
    meta: [
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
    links: page
      ? [
          {
            key: "standard-site-publication",
            rel: "site.standard.publication",
            href: page.publication.uri,
          },
        ]
      : [],
    frontmatter: { did: params.did, publication: params.publication },
  };
};
