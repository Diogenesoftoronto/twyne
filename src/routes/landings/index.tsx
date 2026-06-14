import { component$, useStore, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import { LandingPage } from "../../components/landing/landing-page";
import { LandingBroadsheet } from "../../components/landing/landing-broadsheet";
import { LandingQuarterly } from "../../components/landing/landing-quarterly";
import { LandingTelegram } from "../../components/landing/landing-telegram";

type Variant = "page" | "broadsheet" | "quarterly" | "telegram";

const VARIANTS: { id: Variant; label: string; note: string }[] = [
  { id: "page", label: "Page", note: "Embedded live editor preview (current /)" },
  { id: "broadsheet", label: "Broadsheet", note: "Newspaper — From the Editor's Desk" },
  { id: "quarterly", label: "Quarterly", note: "Editorial quarterly / manifesto" },
  { id: "telegram", label: "Telegram", note: "Western Editorial Bureau wire" },
];

/**
 * Internal gallery for previewing every landing-page variant in one place.
 * Visit /landings/ and use the switcher bar to flip between them.
 */
export default component$(() => {
  const nav = useNavigate();
  const store = useStore<{ active: Variant }>({ active: "page" });

  const startBrief = $(() => void nav("/onboarding/"));
  const skipToEditor = $(() => void nav("/editor/"));

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "sticky",
          top: "0",
          zIndex: "50",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: "var(--color-ink, #1a1a1a)",
          color: "var(--color-paper, #f5f1e8)",
          fontFamily: "var(--font-typewriter, monospace)",
          fontSize: "0.75rem",
          borderBottom: "2px solid var(--color-mustard, #c9a227)",
        }}
      >
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", opacity: "0.7" }}>
          Landing gallery
        </span>
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            onClick$={() => (store.active = v.id)}
            title={v.note}
            style={{
              cursor: "pointer",
              padding: "0.3rem 0.7rem",
              borderRadius: "2px",
              border: "1px solid currentColor",
              background:
                store.active === v.id
                  ? "var(--color-mustard, #c9a227)"
                  : "transparent",
              color: store.active === v.id ? "var(--color-ink, #1a1a1a)" : "inherit",
              fontWeight: store.active === v.id ? "700" : "400",
            }}
          >
            {v.label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", opacity: "0.6" }}>
          {VARIANTS.find((v) => v.id === store.active)?.note}
        </span>
      </div>

      {store.active === "page" && (
        <LandingPage onStartBrief$={startBrief} onSkipToEditor$={skipToEditor} />
      )}
      {store.active === "broadsheet" && <LandingBroadsheet onStartBrief$={startBrief} />}
      {store.active === "quarterly" && <LandingQuarterly onStartBrief$={startBrief} />}
      {store.active === "telegram" && <LandingTelegram onStartBrief$={startBrief} />}
    </div>
  );
});

export const head: DocumentHead = {
  title: "Landing gallery · Twyne",
  meta: [{ name: "robots", content: "noindex" }],
};
