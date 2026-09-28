/**
 * Settings → Judgement model.
 *
 * The judgement model answers Twyne's typed questions — the rubric's marks,
 * quick review, margin tools, passage triage. Writers can keep Twyne's hosted
 * Jev, use Jev on their own TypeSafe key, or point Twyne at any server that
 * speaks the same API, such as Kev running on their own computer.
 */
import { $, component$, useStore, type PropFunction } from "@qwik.dev/core";
import type { JudgementSettings } from "../../types";
import { useConvexClient } from "../../utils/convex-context";
import {
  DEFAULT_ENDPOINT_MODEL,
  DEFAULT_TYPESAFE_MODEL,
  LOCAL_KEV_URL,
  normalizeEndpointUrl,
  testJudgement,
} from "../../utils/judgement-client";

const SOURCES: Array<{
  id: JudgementSettings["source"];
  title: string;
  body: string;
}> = [
  {
    id: "twyne",
    title: "Twyne's Jev",
    body: "The default. Included with your account.",
  },
  {
    id: "typesafe",
    title: "Jev, your key",
    body: "Your own TypeSafe key and usage. Twyne's server passes each request on and never stores the key.",
  },
  {
    id: "endpoint",
    title: "Your own server",
    body: "Kev or any server with the same API — on this computer, Modal or RunPod. Requests go straight from your browser.",
  },
];

const label =
  "block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1";
const input =
  "w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1.5 text-sm text-[var(--color-ink)] focus:border-[var(--color-cobalt)] focus:outline-none";

export const JudgementModelSettings = component$<{
  value: JudgementSettings | undefined;
  onChange$: PropFunction<(next: JudgementSettings) => void>;
}>((props) => {
  const clientSig = useConvexClient();
  const current: JudgementSettings = props.value ?? { source: "twyne" };
  const state = useStore({
    testing: false,
    result: "" as string,
    ok: false,
  });

  const set = $((patch: Partial<JudgementSettings>) => {
    state.result = "";
    return props.onChange$({ ...current, ...patch });
  });

  const test = $(async () => {
    state.testing = true;
    state.result = "";
    const result = await testJudgement(clientSig.value, current);
    state.testing = false;
    state.ok = result.ok;
    const answer = result.answers?.complaint as { noul?: number } | undefined;
    state.result = result.ok
      ? `Connected to ${result.model ?? "the model"}${
          result.latencyMs !== undefined ? ` in ${result.latencyMs} ms` : ""
        }. Test answer: ${Math.round((answer?.noul ?? 0) * 100)}% sure a late, damaged parcel is a complaint.`
      : ({
          network:
            current.source === "endpoint"
              ? "Couldn't reach the server. Is it running, and does it allow requests from this site?"
              : "Couldn't reach Twyne's server.",
          unauthorized: "The key was refused.",
          unconfigured:
            current.source === "endpoint"
              ? "Add the server's address first."
              : "Add your key first.",
          "signed out": "Sign in to use this option.",
          "rate limited": "Rate limited — try again in a minute.",
          provider: "The server answered, but not in the expected format.",
        }[result.error ?? ""] ??
        `It didn't work (${result.error ?? "unknown error"}).`);
  });

  const endpointUrl = current.endpointUrl ?? "";
  const urlInvalid = !!endpointUrl.trim() && !normalizeEndpointUrl(endpointUrl);

  return (
    <section class="folio p-5">
      <h2
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Judgement model
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mb-4">
        The model behind the rubric's scores, quick review and the margin tools.
        It doesn't write — it answers yes/no, pick-one and rating questions with
        a probability for each answer.
      </p>

      <div class="grid gap-2 sm:grid-cols-3" role="radiogroup">
        {SOURCES.map((source) => {
          const on = current.source === source.id;
          return (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick$={() => set({ source: source.id })}
              class={[
                "text-left border p-3 focus-ring",
                on
                  ? "border-[var(--color-cobalt)] bg-[var(--color-paper-soft)]"
                  : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]",
              ]}
              style={{
                borderRadius: "2px",
                boxShadow: on ? "inset 3px 0 0 var(--color-cobalt)" : "none",
              }}
            >
              <span
                class="block text-sm text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                {source.title}
              </span>
              <span class="mt-1 block text-xs leading-snug text-[var(--color-ink-light)]">
                {source.body}
              </span>
            </button>
          );
        })}
      </div>

      {current.source === "typesafe" && (
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label
              class={label}
              for="judgement-typesafe-key"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              TypeSafe API key
            </label>
            <input
              id="judgement-typesafe-key"
              type="password"
              autoComplete="off"
              class={input}
              value={current.typesafeKey ?? ""}
              onInput$={(_, el) => set({ typesafeKey: el.value })}
            />
          </div>
          <div>
            <label
              class={label}
              for="judgement-typesafe-model"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Model
            </label>
            <input
              id="judgement-typesafe-model"
              class={input}
              placeholder={DEFAULT_TYPESAFE_MODEL}
              value={current.typesafeModel ?? ""}
              onInput$={(_, el) => set({ typesafeModel: el.value.trim() })}
            />
          </div>
        </div>
      )}

      {current.source === "endpoint" && (
        <div class="mt-4 space-y-3">
          <div class="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <label
                class={label}
                for="judgement-endpoint-url"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Server address
              </label>
              <input
                id="judgement-endpoint-url"
                class={input}
                placeholder={LOCAL_KEV_URL}
                value={endpointUrl}
                aria-invalid={urlInvalid}
                onInput$={(_, el) => set({ endpointUrl: el.value })}
              />
              {urlInvalid && (
                <p class="mt-1 text-xs text-[var(--color-vermilion)]">
                  Use a full address starting with http:// or https://.
                </p>
              )}
            </div>
            <div>
              <label
                class={label}
                for="judgement-endpoint-model"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Model
              </label>
              <input
                id="judgement-endpoint-model"
                class={input}
                placeholder={DEFAULT_ENDPOINT_MODEL}
                value={current.endpointModel ?? ""}
                onInput$={(_, el) => set({ endpointModel: el.value.trim() })}
              />
            </div>
          </div>
          <div>
            <label
              class={label}
              for="judgement-endpoint-key"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Key (if the server needs one)
            </label>
            <input
              id="judgement-endpoint-key"
              type="password"
              autoComplete="off"
              class={input}
              value={current.endpointKey ?? ""}
              onInput$={(_, el) => set({ endpointKey: el.value })}
            />
          </div>
          <details class="text-xs text-[var(--color-ink-light)]">
            <summary class="cursor-pointer text-[var(--color-ink)]">
              Run Kev on this computer
            </summary>
            <p class="mt-2">
              Kev-4B is an open-weight judgement model that answers the same
              questions as Jev. It needs Python 3.13 and{" "}
              <a
                href="https://docs.astral.sh/uv/"
                target="_blank"
                rel="noreferrer"
                class="underline"
              >
                uv
              </a>
              . It's fastest on a GPU or an Apple Silicon Mac; on a laptop CPU,
              expect a few seconds per check.
            </p>
            <pre
              class="mt-2 overflow-x-auto bg-[var(--color-paper-2)] p-2 text-[0.7rem]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {`git clone https://github.com/jaredpalmer/kev.git && cd kev
uv sync --extra serve
uv run --extra serve python -m kev.serve \\
  --run jaredpalmer/kev-4b --port 8009`}
            </pre>
            <p class="mt-2">
              Then use <code>{LOCAL_KEV_URL}</code> as the server address.
            </p>
          </details>
        </div>
      )}

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-paper text-xs"
          disabled={state.testing}
          onClick$={test}
        >
          {state.testing ? "Testing…" : "Test"}
        </button>
        {state.result && (
          <p
            role="status"
            class="text-xs"
            style={{
              color: state.ok
                ? "var(--color-accent-green)"
                : "var(--color-vermilion)",
            }}
          >
            {state.result}
          </p>
        )}
      </div>
      {current.source !== "twyne" && (
        <p class="mt-3 text-xs text-[var(--color-ink-muted)]">
          If your model can't be reached, judgements pause rather than quietly
          switching back to Twyne's.
        </p>
      )}
    </section>
  );
});
