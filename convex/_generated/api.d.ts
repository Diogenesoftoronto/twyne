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
import type * as accountExport from "../accountExport.js";
import type * as accountExportBuild from "../accountExportBuild.js";
import type * as achievements from "../achievements.js";
import type * as admins from "../admins.js";
import type * as agentPrompts from "../agentPrompts.js";
import type * as agentTools from "../agentTools.js";
import type * as agents from "../agents.js";
import type * as aiFeedback from "../aiFeedback.js";
import type * as arizeTracing from "../arizeTracing.js";
import type * as auth from "../auth.js";
import type * as collaboration from "../collaboration.js";
import type * as collectionBackfill from "../collectionBackfill.js";
import type * as crons from "../crons.js";
import type * as extraction from "../extraction.js";
import type * as house from "../house.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as instrumentTaskValidators from "../instrumentTaskValidators.js";
import type * as instrumentTasks from "../instrumentTasks.js";
import type * as instrumentTasksRunner from "../instrumentTasksRunner.js";
import type * as integrationAi from "../integrationAi.js";
import type * as integrations from "../integrations.js";
import type * as interviewStreams from "../interviewStreams.js";
import type * as knowledge from "../knowledge.js";
import type * as legacyAccounts from "../legacyAccounts.js";
import type * as lib_applicationErrors from "../lib/applicationErrors.js";
import type * as lib_authIdentity from "../lib/authIdentity.js";
import type * as lib_charterExceptionValidator from "../lib/charterExceptionValidator.js";
import type * as lib_collections from "../lib/collections.js";
import type * as lib_entitlement from "../lib/entitlement.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_hostedTransports from "../lib/hostedTransports.js";
import type * as lib_integrationAiRequests from "../lib/integrationAiRequests.js";
import type * as lib_judgementContract from "../lib/judgementContract.js";
import type * as lib_noteEvidence from "../lib/noteEvidence.js";
import type * as lib_notorganic from "../lib/notorganic.js";
import type * as lib_notorganicAchievements from "../lib/notorganicAchievements.js";
import type * as lib_notorganicSignIn from "../lib/notorganicSignIn.js";
import type * as lib_personaResearch from "../lib/personaResearch.js";
import type * as lib_providerCheckout from "../lib/providerCheckout.js";
import type * as lib_providerLink from "../lib/providerLink.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as liveVoice from "../liveVoice.js";
import type * as lixBlobs from "../lixBlobs.js";
import type * as lixRelay from "../lixRelay.js";
import type * as mcp from "../mcp.js";
import type * as native from "../native.js";
import type * as personaNoteStreams from "../personaNoteStreams.js";
import type * as posthog from "../posthog.js";
import type * as preferenceValidators from "../preferenceValidators.js";
import type * as preferences from "../preferences.js";
import type * as profiles from "../profiles.js";
import type * as providerIdentity from "../providerIdentity.js";
import type * as publicDesk from "../publicDesk.js";
import type * as published from "../published.js";
import type * as rateLimit from "../rateLimit.js";
import type * as research from "../research.js";
import type * as sceneMedia from "../sceneMedia.js";
import type * as sharedLix from "../sharedLix.js";
import type * as streamSweep from "../streamSweep.js";
import type * as sync from "../sync.js";
import type * as systemOne from "../systemOne.js";
import type * as traction from "../traction.js";
import type * as usage from "../usage.js";
import type * as userComments from "../userComments.js";
import type * as voice from "../voice.js";
import type * as waitlist from "../waitlist.js";
import type * as writingActivity from "../writingActivity.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  accountExport: typeof accountExport;
  accountExportBuild: typeof accountExportBuild;
  achievements: typeof achievements;
  admins: typeof admins;
  agentPrompts: typeof agentPrompts;
  agentTools: typeof agentTools;
  agents: typeof agents;
  aiFeedback: typeof aiFeedback;
  arizeTracing: typeof arizeTracing;
  auth: typeof auth;
  collaboration: typeof collaboration;
  collectionBackfill: typeof collectionBackfill;
  crons: typeof crons;
  extraction: typeof extraction;
  house: typeof house;
  http: typeof http;
  images: typeof images;
  instrumentTaskValidators: typeof instrumentTaskValidators;
  instrumentTasks: typeof instrumentTasks;
  instrumentTasksRunner: typeof instrumentTasksRunner;
  integrationAi: typeof integrationAi;
  integrations: typeof integrations;
  interviewStreams: typeof interviewStreams;
  knowledge: typeof knowledge;
  legacyAccounts: typeof legacyAccounts;
  "lib/applicationErrors": typeof lib_applicationErrors;
  "lib/authIdentity": typeof lib_authIdentity;
  "lib/charterExceptionValidator": typeof lib_charterExceptionValidator;
  "lib/collections": typeof lib_collections;
  "lib/entitlement": typeof lib_entitlement;
  "lib/errors": typeof lib_errors;
  "lib/hostedTransports": typeof lib_hostedTransports;
  "lib/integrationAiRequests": typeof lib_integrationAiRequests;
  "lib/judgementContract": typeof lib_judgementContract;
  "lib/noteEvidence": typeof lib_noteEvidence;
  "lib/notorganic": typeof lib_notorganic;
  "lib/notorganicAchievements": typeof lib_notorganicAchievements;
  "lib/notorganicSignIn": typeof lib_notorganicSignIn;
  "lib/personaResearch": typeof lib_personaResearch;
  "lib/providerCheckout": typeof lib_providerCheckout;
  "lib/providerLink": typeof lib_providerLink;
  "lib/rateLimit": typeof lib_rateLimit;
  liveVoice: typeof liveVoice;
  lixBlobs: typeof lixBlobs;
  lixRelay: typeof lixRelay;
  mcp: typeof mcp;
  native: typeof native;
  personaNoteStreams: typeof personaNoteStreams;
  posthog: typeof posthog;
  preferenceValidators: typeof preferenceValidators;
  preferences: typeof preferences;
  profiles: typeof profiles;
  providerIdentity: typeof providerIdentity;
  publicDesk: typeof publicDesk;
  published: typeof published;
  rateLimit: typeof rateLimit;
  research: typeof research;
  sceneMedia: typeof sceneMedia;
  sharedLix: typeof sharedLix;
  streamSweep: typeof streamSweep;
  sync: typeof sync;
  systemOne: typeof systemOne;
  traction: typeof traction;
  usage: typeof usage;
  userComments: typeof userComments;
  voice: typeof voice;
  waitlist: typeof waitlist;
  writingActivity: typeof writingActivity;
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
