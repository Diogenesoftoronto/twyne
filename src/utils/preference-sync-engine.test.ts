import { describe, expect, test } from "bun:test";
import {
  createPreferenceSync,
  type PreferenceRow,
} from "./preference-sync-engine";
import type { PreferenceJournal } from "./preference-outbox";
import { portablePreference } from "./account-preferences-contract";
import { DEFAULT_AI_SETTINGS, DEFAULT_APPARATUS_SETTINGS } from "../types";

function harness(remote: PreferenceRow[] = []) {
  let journal: PreferenceJournal = { base: {}, pending: {} };
  const local: Record<string, Record<string, unknown>> = {};
  const errors: unknown[] = [];
  let puts = 0;
  let fail = false;
  const deps = {
    seed: false,
    readJournal: () => structuredClone(journal),
    writeJournal: (next: PreferenceJournal) => {
      journal = structuredClone(next);
    },
    readLocal: async (kind: string) => local[kind] ?? {},
    applyLocal: async (kind: string, value: Record<string, unknown>) => {
      local[kind] = value;
    },
    pull: async () => structuredClone(remote),
    put: async (row: PreferenceRow) => {
      puts++;
      if (fail) throw new Error("offline");
      const existing = remote.find((r) => r.kind === row.kind);
      if (existing && existing.revision !== row.revision)
        return { accepted: false, revision: existing.revision };
      const next = { ...row, revision: row.revision + 1 };
      remote = remote.filter((r) => r.kind !== row.kind).concat(next);
      return { accepted: true, revision: next.revision };
    },
    onError: (error: unknown) => {
      errors.push(error);
    },
  };
  return {
    deps,
    local,
    errors,
    journal: () => journal,
    remote: () => remote,
    puts: () => puts,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
describe("account preferences", () => {
  test("switching to an empty account uses defaults rather than the previous account's private context", async () => {
    const h = harness();
    h.local.writer = { profile: { personalFacts: "previous account" } };
    await createPreferenceSync({ ...h.deps, emptyValue: () => ({}) }).refresh();
    expect(h.local.writer).toEqual({});
    expect(JSON.stringify(h.remote())).not.toContain("previous account");
  });
  test("a revision conflict re-pulls before retrying and preserves unrelated remote changes", async () => {
    const h = harness([{ kind: "writer", json: '{"a":1,"b":1}', revision: 1 }]);
    h.deps.writeJournal({
      base: { writer: { a: 1, b: 1 } },
      pending: { writer: { a: 2, b: 1 } },
    });
    const put = h.deps.put;
    let first = true;
    h.deps.put = async (row) => {
      if (first) {
        first = false;
        await put({ kind: "writer", json: '{"a":1,"b":2}', revision: 1 });
      }
      return put(row);
    };
    await createPreferenceSync(h.deps).refresh();
    expect(JSON.parse(h.remote()[0].json)).toEqual({ a: 2, b: 2 });
    expect(h.journal().pending).toEqual({});
  });
  test("a second device pulls account preferences without echoing them", async () => {
    const h = harness([
      {
        kind: "writer",
        json: '{"profile":{"displayName":"Writer"}}',
        revision: 3,
      },
    ]);
    await createPreferenceSync(h.deps).refresh();
    expect(h.local.writer).toEqual({ profile: { displayName: "Writer" } });
    expect(h.puts()).toBe(0);
  });
  test("offline edits survive a restart and merge independent remote edits", async () => {
    const h = harness([
      {
        kind: "writer",
        json: '{"profile":{"displayName":"Remote","feedbackNotes":"old"}}',
        revision: 2,
      },
    ]);
    h.deps.writeJournal({
      base: {
        writer: { profile: { displayName: "Old", feedbackNotes: "old" } },
      },
      pending: {
        writer: {
          profile: { displayName: "Old", feedbackNotes: "local edit" },
        },
      },
    });
    h.fail(true);
    const first = createPreferenceSync(h.deps);
    await first.refresh();
    first.dispose();
    expect(h.journal().pending.writer).toBeDefined();
    h.fail(false);
    await createPreferenceSync(h.deps).refresh();
    expect(h.local.writer).toEqual({
      profile: { displayName: "Remote", feedbackNotes: "local edit" },
    });
    expect(h.journal().pending).toEqual({});
  });
  test("an edit made during a push is not acknowledged as saved", async () => {
    const h = harness([
      { kind: "appearance", json: '{"preset":"editorial"}', revision: 1 },
    ]);
    h.deps.writeJournal({
      base: { appearance: { preset: "editorial" } },
      pending: { appearance: { preset: "nightpress" } },
    });
    const put = h.deps.put;
    let first = true;
    h.deps.put = async (row) => {
      const result = await put(row);
      if (first) {
        first = false;
        const journal = h.deps.readJournal();
        journal.pending.appearance = { preset: "sepia" };
        h.deps.writeJournal(journal);
      }
      return result;
    };
    await createPreferenceSync(h.deps).refresh();
    expect(JSON.parse(h.remote()[0].json)).toEqual({ preset: "sepia" });
    expect(h.puts()).toBe(2);
  });
  test("sign-out discards a late remote response", async () => {
    const h = harness();
    let release!: (rows: PreferenceRow[]) => void;
    h.deps.pull = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const engine = createPreferenceSync(h.deps);
    const pending = engine.refresh();
    engine.dispose();
    release([
      { kind: "appearance", json: '{"preset":"nightpress"}', revision: 1 },
    ]);
    await pending;
    expect(h.local).toEqual({});
    expect(h.puts()).toBe(0);
  });
  test("portable AI and research preferences exclude credentials and endpoints", () => {
    const ai = portablePreference("ai", {
      ...DEFAULT_AI_SETTINGS,
      providers: [
        {
          id: "p",
          type: "openai",
          name: "Mine",
          defaultModel: "model",
          apiKey: "SECRET",
          baseUrl: "https://secret",
        },
      ],
      judgement: {
        source: "endpoint",
        endpointKey: "SECRET",
        endpointUrl: "http://localhost",
        endpointModel: "kev",
      },
    });
    const apparatus = portablePreference("apparatus", {
      ...DEFAULT_APPARATUS_SETTINGS,
      searchBackend: { apiKey: "SECRET" },
      mcpServers: [{ bearerToken: "SECRET" }],
    });
    expect(JSON.stringify({ ai, apparatus })).not.toContain("SECRET");
    expect(JSON.stringify(ai)).not.toContain("localhost");
    expect(ai.providers).toEqual([
      { id: "p", type: "openai", name: "Mine", defaultModel: "model" },
    ]);
  });
});
