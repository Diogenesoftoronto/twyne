/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admins from "../admins.js";
import type * as agentPrompts from "../agentPrompts.js";
import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lixBlobs from "../lixBlobs.js";
import type * as payments from "../payments.js";
import type * as posthog from "../posthog.js";
import type * as published from "../published.js";
import type * as research from "../research.js";
import type * as sync from "../sync.js";
import type * as userComments from "../userComments.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admins: typeof admins;
  agentPrompts: typeof agentPrompts;
  agents: typeof agents;
  auth: typeof auth;
  http: typeof http;
  lixBlobs: typeof lixBlobs;
  payments: typeof payments;
  posthog: typeof posthog;
  published: typeof published;
  research: typeof research;
  sync: typeof sync;
  userComments: typeof userComments;
  voice: typeof voice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
