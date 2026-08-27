import { describe, expect, test } from "bun:test";
import {
  IDB_USAGE_EVENT_STORE,
  IDB_USAGE_OCCURRED_AT_INDEX,
  IDB_WRITING_ACTIVITY_STORE,
  IDB_WRITING_DAY_INDEX,
  upgradeTwyneDatabase,
} from "./idb";

describe("IndexedDB usage migration", () => {
  test("adds both v4 stores and their bounded-read indexes additively", () => {
    const names = new Set([
      "folios",
      "folio-content",
      "brief",
      "comments",
      "personas",
      "meta",
      "ai-settings",
      "lix-blob",
      "voice-notes",
      "models",
    ]);
    const created: Array<{ name: string; keyPath: string }> = [];
    const indexes: Array<{
      store: string;
      name: string;
      keyPath: string;
      unique: boolean;
    }> = [];
    const db = {
      objectStoreNames: { contains: (name: string) => names.has(name) },
      createObjectStore: (name: string, options: { keyPath: string }) => {
        names.add(name);
        created.push({ name, keyPath: options.keyPath });
        return {
          createIndex: (
            indexName: string,
            keyPath: string,
            indexOptions: { unique: boolean },
          ) => {
            indexes.push({
              store: name,
              name: indexName,
              keyPath,
              unique: indexOptions.unique,
            });
          },
        };
      },
    } as unknown as IDBDatabase;

    upgradeTwyneDatabase(db);

    expect(created).toEqual([
      { name: IDB_USAGE_EVENT_STORE, keyPath: "eventKey" },
      { name: IDB_WRITING_ACTIVITY_STORE, keyPath: "activityKey" },
    ]);
    expect(indexes).toEqual([
      {
        store: IDB_USAGE_EVENT_STORE,
        name: IDB_USAGE_OCCURRED_AT_INDEX,
        keyPath: "occurredAt",
        unique: false,
      },
      {
        store: IDB_WRITING_ACTIVITY_STORE,
        name: IDB_WRITING_DAY_INDEX,
        keyPath: "day",
        unique: false,
      },
    ]);
  });

  test("is a no-op when every store already exists", () => {
    const names = new Set([
      "folios",
      "folio-content",
      "brief",
      "comments",
      "personas",
      "meta",
      "ai-settings",
      "lix-blob",
      "voice-notes",
      "models",
      IDB_USAGE_EVENT_STORE,
      IDB_WRITING_ACTIVITY_STORE,
    ]);
    let createCalls = 0;
    upgradeTwyneDatabase({
      objectStoreNames: { contains: (name: string) => names.has(name) },
      createObjectStore: () => {
        createCalls += 1;
        throw new Error("existing stores must not be recreated");
      },
    } as unknown as IDBDatabase);
    expect(createCalls).toBe(0);
  });
});
