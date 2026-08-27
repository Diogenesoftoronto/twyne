import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import { USAGE_LIMITS, type UsageEvent } from "./usage-domain";
import { usageLedger, type UsageLedger } from "./usage-ledger";

export const USAGE_SYNC_STATE_META_KEY = "usage-sync-state-v1";
export const USAGE_SYNC_BATCH_LIMIT = 50;
export const USAGE_SYNC_MAX_BATCHES = 20;

export interface UsageSyncState {
  version: 1;
  enabled: boolean;
  associatedAccountId?: string;
  updatedAt: number;
}

export interface UsageSyncStateStore {
  load(): Promise<UsageSyncState | null>;
  save(state: UsageSyncState): Promise<void>;
}

export const indexedDbUsageSyncStateStore: UsageSyncStateStore = {
  load: () => loadMetaFromIdb<UsageSyncState>(USAGE_SYNC_STATE_META_KEY),
  save: (state) => saveMetaToIdb(USAGE_SYNC_STATE_META_KEY, state),
};

export type UsageSyncReadiness =
  | { status: "disabled" }
  | { status: "ready"; state: UsageSyncState }
  | {
      status: "account_choice_required";
      previousAccountId: string;
      requestedAccountId: string;
    };

export type UsageAccountSwitchChoice =
  | "attach-unsynchronized"
  | "keep-device-only";

export interface UsageBatchUploader {
  upload(input: {
    accountId: string;
    events: readonly UsageEvent[];
  }): Promise<{ acknowledgedEventKeys: readonly string[] }>;
}

export interface UsageSyncResult {
  status: "disabled" | "account_choice_required" | "complete" | "partial";
  uploaded: number;
  batches: number;
  previousAccountId?: string;
  requestedAccountId?: string;
}

function validAccountId(accountId: string): string {
  const value = accountId.trim();
  if (!value || value.length > USAGE_LIMITS.opaqueId) {
    throw new TypeError("accountId must be a bounded opaque identifier");
  }
  return value;
}

function isUsageSyncState(
  value: UsageSyncState | null,
): value is UsageSyncState {
  return Boolean(
    value &&
      value.version === 1 &&
      typeof value.enabled === "boolean" &&
      Number.isSafeInteger(value.updatedAt) &&
      value.updatedAt >= 0 &&
      (value.associatedAccountId === undefined ||
        (typeof value.associatedAccountId === "string" &&
          value.associatedAccountId.length > 0 &&
          value.associatedAccountId.length <= USAGE_LIMITS.opaqueId)),
  );
}

export async function usageSyncReadiness(
  accountId: string,
  stateStore: UsageSyncStateStore = indexedDbUsageSyncStateStore,
): Promise<UsageSyncReadiness> {
  const requestedAccountId = validAccountId(accountId);
  const loaded = await stateStore.load();
  const state = isUsageSyncState(loaded) ? loaded : null;
  if (!state?.enabled || !state.associatedAccountId) {
    return { status: "disabled" };
  }
  if (state.associatedAccountId !== requestedAccountId) {
    return {
      status: "account_choice_required",
      previousAccountId: state.associatedAccountId,
      requestedAccountId,
    };
  }
  return { status: "ready", state };
}

/** Explicit preference write; it never silently crosses account identity. */
export async function setUsageSyncEnabled(input: {
  accountId: string;
  enabled: boolean;
  now?: number;
  stateStore?: UsageSyncStateStore;
}): Promise<UsageSyncReadiness> {
  const accountId = validAccountId(input.accountId);
  const stateStore = input.stateStore ?? indexedDbUsageSyncStateStore;
  const loaded = await stateStore.load();
  const prior = isUsageSyncState(loaded) ? loaded : null;
  if (
    input.enabled &&
    prior?.associatedAccountId &&
    prior.associatedAccountId !== accountId
  ) {
    return {
      status: "account_choice_required",
      previousAccountId: prior.associatedAccountId,
      requestedAccountId: accountId,
    };
  }
  const state: UsageSyncState = {
    version: 1,
    enabled: input.enabled,
    associatedAccountId: prior?.associatedAccountId ?? accountId,
    updatedAt: input.now ?? Date.now(),
  };
  await stateStore.save(state);
  return input.enabled ? { status: "ready", state } : { status: "disabled" };
}

export async function resolveUsageAccountSwitch(input: {
  accountId: string;
  choice: UsageAccountSwitchChoice;
  now?: number;
  ledger?: UsageLedger;
  stateStore?: UsageSyncStateStore;
}): Promise<UsageSyncState> {
  const accountId = validAccountId(input.accountId);
  const ledger = input.ledger ?? usageLedger;
  const stateStore = input.stateStore ?? indexedDbUsageSyncStateStore;
  if (input.choice === "keep-device-only") {
    await ledger.excludeUnsynchronized();
  }
  const state: UsageSyncState = {
    version: 1,
    enabled: true,
    associatedAccountId: accountId,
    updatedAt: input.now ?? Date.now(),
  };
  await stateStore.save(state);
  return state;
}

export async function syncLocalUsageHistory(input: {
  accountId: string;
  uploader: UsageBatchUploader;
  ledger?: UsageLedger;
  stateStore?: UsageSyncStateStore;
  batchLimit?: number;
  maxBatches?: number;
}): Promise<UsageSyncResult> {
  const accountId = validAccountId(input.accountId);
  const ledger = input.ledger ?? usageLedger;
  const stateStore = input.stateStore ?? indexedDbUsageSyncStateStore;
  const readiness = await usageSyncReadiness(accountId, stateStore);
  if (readiness.status === "disabled") {
    return { status: "disabled", uploaded: 0, batches: 0 };
  }
  if (readiness.status === "account_choice_required") {
    return { ...readiness, uploaded: 0, batches: 0 };
  }
  const batchLimit = Math.max(
    1,
    Math.min(
      USAGE_SYNC_BATCH_LIMIT,
      input.batchLimit ?? USAGE_SYNC_BATCH_LIMIT,
    ),
  );
  const maxBatches = Math.max(
    1,
    Math.min(
      USAGE_SYNC_MAX_BATCHES,
      input.maxBatches ?? USAGE_SYNC_MAX_BATCHES,
    ),
  );
  let uploaded = 0;
  let batches = 0;
  for (; batches < maxBatches; batches += 1) {
    const page = await ledger.listPendingUsageEvents({
      accountId,
      limit: batchLimit,
    });
    if (page.events.length === 0) {
      return { status: "complete", uploaded, batches };
    }
    const offered = new Set(page.events.map((event) => event.eventKey));
    const response = await input.uploader.upload({
      accountId,
      events: page.events,
    });
    const acknowledged = [
      ...new Set(
        response.acknowledgedEventKeys.filter((eventKey) =>
          offered.has(eventKey),
        ),
      ),
    ];
    if (acknowledged.length > 0) {
      await ledger.markSynchronized(acknowledged, accountId);
      uploaded += acknowledged.length;
    }
    if (acknowledged.length !== page.events.length) {
      return { status: "partial", uploaded, batches: batches + 1 };
    }
    if (page.events.length < batchLimit) {
      return { status: "complete", uploaded, batches: batches + 1 };
    }
  }
  return { status: "partial", uploaded, batches };
}
