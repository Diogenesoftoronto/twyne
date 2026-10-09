import {
  component$,
  useStyles$,
  useSignal,
  useContextProvider,
} from "@qwik.dev/core";
import { AuthContext, type AuthState } from "../../utils/auth-context";
import { ConvexProvider } from "../../utils/convex-context";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { SentenceLabProps } from "./catalog";
import { SentenceBench } from "./sentence-bench";
import {
  OFFLINE_BENCH_FIXTURE,
  SETTLED_BENCH_FIXTURE,
  STALE_BENCH_FIXTURE,
} from "./sentence-bench.fixtures";
const Preview = component$<{ fixture: SentenceLabProps }>(({ fixture }) => {
  useContextProvider(
    AuthContext,
    useSignal<AuthState>({ user: null, loading: false }),
  );
  useStyles$(
    `.sentence-story { min-height:100dvh; padding:3rem 1rem; background:var(--color-paper-2); color:var(--color-ink); } .sentence-story aside { max-width:30rem; margin:auto; background:var(--color-paper); border:1px solid var(--color-paper-3); border-radius:2px; padding:1rem; } .sentence-story h1 { font:600 1.25rem var(--font-display); margin-bottom:1rem; }`,
  );
  return (
    <ConvexProvider>
      <main class="sentence-story">
        <aside aria-label="Sentence bench preview">
          <h1>Sentence bench</h1>
          <SentenceBench props={fixture} filling={false} toolId="story" />
        </aside>
      </main>
    </ConvexProvider>
  );
});
const meta = {
  title: "Writing instruments/Sentence bench",
  component: Preview,
  parameters: { layout: "fullscreen" },
  args: { fixture: OFFLINE_BENCH_FIXTURE },
} satisfies Meta<{ fixture: SentenceLabProps }>;
export default meta;
type Story = StoryObj<{ fixture: SentenceLabProps }>;
export const Offline: Story = {};
export const SettledHistory: Story = {
  args: { fixture: SETTLED_BENCH_FIXTURE },
};
export const Stale: Story = { args: { fixture: STALE_BENCH_FIXTURE } };
