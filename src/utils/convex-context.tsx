import {
  component$,
  createContextId,
  Slot,
  useContext,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  noSerialize,
  type NoSerialize,
  type Signal,
} from "@builder.io/qwik";
import { ConvexClient, type ConvexClientOptions } from "convex/browser";

const ConvexClientContext = createContextId<
  Signal<NoSerialize<ConvexClient> | null>
>("twyne.convex-client");

interface ConvexProviderProps {
  client?: ConvexClient;
  options?: ConvexClientOptions;
  url?: string;
}

export function useConvexClient() {
  return useContext(ConvexClientContext);
}

export const ConvexProvider = component$(
  ({ client, options, url }: ConvexProviderProps) => {
    const clientSignal = useSignal<NoSerialize<ConvexClient> | null>(
      client ? noSerialize(client) : null,
    );

    useContextProvider(ConvexClientContext, clientSignal);

    // Keep the client creation on the client side so SSR never evaluates browser state.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup, track }) => {
      const trackedUrl = track(() => url);

      if (clientSignal.value || !trackedUrl) {
        return;
      }

      const createdClient = new ConvexClient(trackedUrl, options);
      clientSignal.value = noSerialize(createdClient);

      cleanup(() => {
        if (clientSignal.value === createdClient) {
          clientSignal.value = null;
        }

        void createdClient.close();
      });
    });

    return <Slot />;
  },
);
