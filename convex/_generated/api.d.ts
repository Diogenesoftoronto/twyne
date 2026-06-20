/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as admins from "../admins.js";
import type * as agentPrompts from "../agentPrompts.js";
import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as collaboration from "../collaboration.js";
import type * as http from "../http.js";
import type * as lib_creem from "../lib/creem.js";
import type * as lib_entitlement from "../lib/entitlement.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lixBlobs from "../lixBlobs.js";
import type * as lixRelay from "../lixRelay.js";
import type * as payments from "../payments.js";
import type * as posthog from "../posthog.js";
import type * as profiles from "../profiles.js";
import type * as published from "../published.js";
import type * as rateLimit from "../rateLimit.js";
import type * as research from "../research.js";
import type * as sharedLix from "../sharedLix.js";
import type * as sync from "../sync.js";
import type * as testing from "../testing.js";
import type * as userComments from "../userComments.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  admins: typeof admins;
  agentPrompts: typeof agentPrompts;
  agents: typeof agents;
  auth: typeof auth;
  collaboration: typeof collaboration;
  http: typeof http;
  "lib/creem": typeof lib_creem;
  "lib/entitlement": typeof lib_entitlement;
  "lib/errors": typeof lib_errors;
  "lib/rateLimit": typeof lib_rateLimit;
  lixBlobs: typeof lixBlobs;
  lixRelay: typeof lixRelay;
  payments: typeof payments;
  posthog: typeof posthog;
  profiles: typeof profiles;
  published: typeof published;
  rateLimit: typeof rateLimit;
  research: typeof research;
  sharedLix: typeof sharedLix;
  sync: typeof sync;
  testing: typeof testing;
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
