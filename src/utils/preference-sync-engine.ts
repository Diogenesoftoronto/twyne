import {
  PREFERENCE_KINDS,
  mergePreference,
  type PreferenceKind,
  type PreferenceValue,
} from "./account-preferences-contract";
import type { PreferenceJournal } from "./preference-outbox";
export interface PreferenceRow {
  kind: PreferenceKind;
  json: string;
  revision: number;
}
export interface PreferenceSyncDependencies {
  readJournal(): PreferenceJournal;
  writeJournal(journal: PreferenceJournal): void;
  readLocal(kind: PreferenceKind): Promise<PreferenceValue>;
  applyLocal(kind: PreferenceKind, value: PreferenceValue): Promise<void>;
  pull(): Promise<PreferenceRow[]>;
  put(row: PreferenceRow): Promise<{ accepted: boolean; revision: number }>;
  seed: boolean;
  emptyValue?(kind: PreferenceKind): PreferenceValue;
  onError(error: unknown): void;
}
export function createPreferenceSync(deps: PreferenceSyncDependencies) {
  let disposed = false;
  let running: Promise<void> | null = null;
  let again = false;
  async function run() {
    let attempts = 0;
    do {
      if (++attempts > 8)
        throw new Error(
          "Settings changed repeatedly during sync. Retrying shortly.",
        );
      again = false;
      const remote = await deps.pull();
      if (disposed) return;
      for (const kind of PREFERENCE_KINDS) {
        if (disposed) return;
        const row = remote.find((row) => row.kind === kind);
        const journal = deps.readJournal();
        const base = journal.base[kind];
        const pending = journal.pending[kind];
        const server = row
          ? (JSON.parse(row.json) as PreferenceValue)
          : undefined;
        let next = server;
        if (pending)
          next =
            server && base
              ? (mergePreference(base, pending, server) as PreferenceValue)
              : pending;
        else if (!server)
          next = deps.seed
            ? await deps.readLocal(kind)
            : deps.emptyValue?.(kind);
        if (disposed || !next) continue;
        if (JSON.stringify(next) !== JSON.stringify(server)) {
          const result = await deps.put({
            kind,
            json: JSON.stringify(next),
            revision: row?.revision ?? 0,
          });
          if (disposed) return;
          if (!result.accepted) {
            again = true;
            continue;
          }
        }
        const latest = deps.readJournal();
        // A new edit during the network request must survive its acknowledgement.
        if (JSON.stringify(latest.pending[kind]) !== JSON.stringify(pending)) {
          again = true;
          continue;
        }
        latest.base[kind] = next;
        delete latest.pending[kind];
        deps.writeJournal(latest);
        if (
          JSON.stringify(await deps.readLocal(kind)) !== JSON.stringify(next)
        ) {
          if (disposed || deps.readJournal().pending[kind]) {
            again = true;
            continue;
          }
          await deps.applyLocal(kind, next);
        }
      }
    } while (again && !disposed);
  }
  return {
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (running) {
        again = true;
        return running;
      }
      running = run()
        .catch(deps.onError)
        .finally(() => {
          running = null;
        });
      return running;
    },
    dispose() {
      disposed = true;
    },
  };
}
