import {
  component$,
  isDev,
  createContextId,
  Slot,
  useContext,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  noSerialize,
  type NoSerialize,
  type Signal,
} from "@qwik.dev/core";
import { ConvexClient, type ConvexClientOptions } from "convex/browser";
import { capturePostHogEvent } from "./posthog-context";
import {
  normalizeApplicationError,
  sanitizeErrorMetadata,
} from "./application-errors";

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

type ConvexLogger = NonNullable<
  Exclude<ConvexClientOptions["logger"], boolean>
>;

export function createProductionConvexLogger(): ConvexLogger {
  const capture = (level: "warn" | "error", args: unknown[]) => {
    const error = normalizeApplicationError(args[args.length - 1], {
      source: "convex",
    });
    void capturePostHogEvent("$exception", {
      distinct_id: "convex-browser",
      $exception_type: "ConvexClientError",
      $exception_message: error.message,
      $exception_is_unhandled: false,
      $level: level,
      twyne_error_code: error.code,
      twyne_error_reference_id: error.referenceId,
      twyne_error_source: error.source,
      ...sanitizeErrorMetadata({ operation: "convex-client" }),
    });
  };
  return {
    logVerbose() {},
    log() {},
    warn(...args: unknown[]) {
      capture("warn", args);
    },
    error(...args: unknown[]) {
      capture("error", args);
    },
  };
}

export const ConvexProvider = component$(
  ({ client, options, url }: ConvexProviderProps) => {
    const clientSignal = useSignal<NoSerialize<ConvexClient> | null>(
      client ? noSerialize(client) : null,
    );

    useContextProvider(ConvexClientContext, clientSignal);

    // Keep the client creation on the client side so SSR never evaluates browser state.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ cleanup, track }) => {
        const trackedUrl = track(() => url);

        if (clientSignal.value || !trackedUrl) {
          return;
        }

        const createdClient = new ConvexClient(trackedUrl, {
          ...options,
          logger:
            options?.logger ?? (isDev ? true : createProductionConvexLogger()),
          verbose: options?.verbose ?? false,
          reportDebugInfoToConvex: options?.reportDebugInfoToConvex ?? false,
        });
        clientSignal.value = noSerialize(createdClient);

        cleanup(() => {
          if (clientSignal.value === createdClient) {
            clientSignal.value = null;
          }

          void createdClient.close();
        });
      },
      { strategy: "document-ready" },
    );

    return <Slot />;
  },
);
