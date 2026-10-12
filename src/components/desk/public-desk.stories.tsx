import {
  component$,
  createContextId,
  noSerialize,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type Signal,
} from "@qwik.dev/core";
import type { ConvexClient } from "convex/browser";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { AuthContext, type AuthState } from "../../utils/auth-context";
import type { PublicDeskStatus } from "../../utils/public-desk-sync";
import { PublicDeskSettings } from "./public-desk";

/** Isolated synthetic UI: no auth cookies, network clients, or PDS writes. */
const PublicDeskPreview = component$(() => {
  const auth = useSignal<AuthState>({
    loading: false,
    provider: "convex",
    convexAuthenticated: true,
    user: { id: "synthetic-writer", email: "writer@example.test" },
  });
  const client = useSignal<NoSerialize<ConvexClient> | null>(null);
  const status = useSignal<PublicDeskStatus>({
    enabled: false,
    pending: false,
    did: "did:plc:synthetic",
    linkedDid: "did:plc:synthetic",
  });
  useContextProvider(AuthContext, auth);
  useContextProvider(
    createContextId<Signal<NoSerialize<ConvexClient> | null>>(
      "twyne.convex-client",
    ),
    client,
  );
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    let listener: ((value: PublicDeskStatus) => void) | undefined;
    client.value = noSerialize({
      onUpdate: (
        _ref: unknown,
        _args: unknown,
        callback: (value: PublicDeskStatus) => void,
      ) => {
        listener = callback;
        callback(status.value);
        return () => {
          listener = undefined;
        };
      },
      mutation: async (_ref: unknown, args: { enabled: boolean }) => {
        status.value = {
          ...status.value,
          enabled: args.enabled,
          pending: true,
        };
        listener?.(status.value);
        return null;
      },
    } as unknown as ConvexClient);
  });
  return (
    <main
      class="paper-sheet p-8"
      style="width:min(40rem,100%); min-height:24rem"
    >
      <h1>Public writing statistics</h1>
      <p>
        Only selected statistics are published. This preview uses a synthetic
        account.
      </p>
      <PublicDeskSettings />
    </main>
  );
});
export default {
  title: "Desk/PublicDesk",
  component: PublicDeskPreview,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PublicDeskPreview>;
type Story = StoryObj<typeof PublicDeskPreview>;
export const Settings: Story = {};
