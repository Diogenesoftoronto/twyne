import { describe, expect, test, vi } from "vitest";
import type { Agent } from "@atproto/api";
import { publicDeskRecord, type PublicDeskJob } from "./public-desk-contract";
import { syncPublicDesk } from "./public-desk-sync";
const uri = "at://did:plc:writer/love.twyne.desk/self";
const confirmation = { data: { cid: "new-cid", uri } };
function fixture() {
  const putRecord = vi.fn(async (...input: unknown[]) => {
    void input;
    return confirmation;
  });
  const deleteRecord = vi.fn(async () => ({}));
  const getRecord = vi.fn(async () => ({ data: { cid: "old-cid", uri } }));
  const agent = {
    did: "did:plc:writer",
    com: { atproto: { repo: { putRecord, deleteRecord, getRecord } } },
  } as unknown as Agent;
  const job: PublicDeskJob = {
    did: "did:plc:writer",
    revision: 1,
    publicationId: "one",
    pending: true,
    record: publicDeskRecord({ handle: "writer" }, { daysWritten30: 1 }, 1),
  };
  return { agent, job, putRecord, deleteRecord, getRecord };
}
describe("public desk PDS transport", () => {
  test("writes deterministic key with compare-and-swap and acknowledges only success", async () => {
    const f = fixture();
    const acknowledge = vi.fn(async () => true);
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge,
      active: () => true,
    });
    expect(f.putRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: f.job.did,
        collection: "love.twyne.desk",
        rkey: "self",
        swapRecord: "old-cid",
        record: { ...f.job.record, visibility: "public", publicationId: "one" },
      }),
    );
    expect(acknowledge).toHaveBeenCalledWith(1);
  });
  test("refuses another account before network access", async () => {
    const f = fixture();
    f.job.did = "did:plc:other";
    await expect(
      syncPublicDesk({
        ...f,
        prepare: async () => f.job,
        acknowledge: async () => true,
        active: () => true,
      }),
    ).rejects.toThrow("linked to your Twyne");
    expect(f.getRecord).not.toHaveBeenCalled();
  });
  test("missing record gets a private marker before removal is acknowledged", async () => {
    const f = fixture();
    f.job.record = null;
    f.getRecord.mockRejectedValue({ error: "RecordNotFound" });
    const acknowledge = vi.fn(async () => true);
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge,
      active: () => true,
    });
    expect(f.deleteRecord).not.toHaveBeenCalled();
    expect(f.putRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        swapRecord: null,
        record: {
          $type: "love.twyne.desk",
          version: 1,
          visibility: "private",
          publicationId: "one",
        },
      }),
    );
    expect(acknowledge).toHaveBeenCalledWith(1);
  });
  test("network failure does not turn into absence or an acknowledgement", async () => {
    const f = fixture();
    f.job.record = null;
    f.getRecord.mockRejectedValue(new Error("network"));
    const acknowledge = vi.fn(async () => true);
    await expect(
      syncPublicDesk({
        ...f,
        prepare: async () => f.job,
        acknowledge,
        active: () => true,
      }),
    ).rejects.toThrow("network");
    expect(acknowledge).not.toHaveBeenCalled();
  });
  test("privacy revoked during PUT is compensated by a private marker before success", async () => {
    const f = fixture();
    const acknowledge = vi.fn(async () => true);
    f.putRecord.mockImplementationOnce(async () => {
      f.job = { ...f.job, revision: 2, publicationId: "two", record: null };
      return confirmation;
    });
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge,
      active: () => true,
    });
    expect(f.putRecord).toHaveBeenCalledTimes(2);
    expect(f.deleteRecord).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith(2);
    expect(acknowledge).not.toHaveBeenCalledWith(1);
  });
  test("CAS conflicts retry with fresh state, and a stopped account writes nothing", async () => {
    const f = fixture();
    f.putRecord.mockRejectedValueOnce({ error: "InvalidSwap" });
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge: async () => true,
      active: () => true,
    });
    expect(f.putRecord).toHaveBeenCalledTimes(2);
    f.putRecord.mockClear();
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge: async () => true,
      active: () => false,
    });
    expect(f.putRecord).not.toHaveBeenCalled();
  });
  test("reconciles a stale remote record even after an earlier removal was acknowledged", async () => {
    const f = fixture();
    f.job.record = null;
    f.job.pending = false;
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge: async () => true,
      active: () => true,
    });
    expect(f.putRecord).toHaveBeenCalledTimes(1);
  });
  test("does not rewrite an already-matching public snapshot", async () => {
    const f = fixture();
    f.getRecord.mockResolvedValue({
      data: {
        cid: "old-cid",
        uri,
        value: { ...f.job.record, visibility: "public", publicationId: "one" },
      },
    } as never);
    await syncPublicDesk({
      ...f,
      prepare: async () => f.job,
      acknowledge: async () => true,
      active: () => true,
    });
    expect(f.putRecord).not.toHaveBeenCalled();
    expect(f.deleteRecord).not.toHaveBeenCalled();
  });
  test("malformed GET and PUT confirmations never acknowledge withdrawal", async () => {
    for (const stage of ["get", "put"]) {
      const f = fixture();
      f.job.record = null;
      const acknowledge = vi.fn(async () => true);
      if (stage === "get")
        f.getRecord.mockResolvedValue({ data: { uri } } as never);
      else f.putRecord.mockResolvedValue({} as never);
      await expect(
        syncPublicDesk({
          ...f,
          prepare: async () => f.job,
          acknowledge,
          active: () => true,
        }),
      ).rejects.toThrow(/PDS/);
      expect(acknowledge).not.toHaveBeenCalled();
    }
  });
  test.each([null, "earlier-private-marker"])(
    "revocation fences delayed publish against %s even when old writer stops",
    async (initialCid) => {
      const f = fixture();
      let remote: { cid: string; record: Record<string, unknown> } | null =
        initialCid
          ? {
              cid: initialCid,
              record: {
                visibility: "private",
                publicationId: "previous-generation",
              },
            }
          : null;
      let live = true;
      let release!: () => void;
      let started!: () => void;
      const delay = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        started = resolve;
      });
      const getRecord = async () => {
        if (!remote) throw { error: "RecordNotFound" };
        return { data: { uri, cid: remote.cid, value: remote.record } };
      };
      const putRecord = async (input: {
        swapRecord: string | null;
        record: Record<string, unknown>;
      }) => {
        if (input.record.visibility === "public") {
          started();
          await delay;
        }
        if (input.swapRecord !== (remote?.cid ?? null))
          throw { error: "InvalidSwap" };
        remote = {
          cid: String(input.record.publicationId),
          record: input.record,
        };
        return { data: { uri, cid: remote.cid } };
      };
      const agent = {
        did: f.job.did,
        com: { atproto: { repo: { getRecord, putRecord } } },
      } as unknown as Agent;
      const prepare = async () => f.job;
      const acknowledge = vi.fn(async () => true);
      const older = syncPublicDesk({
        agent,
        prepare,
        acknowledge,
        active: () => live,
      });
      await pending;
      f.job = {
        ...f.job,
        record: null,
        revision: 2,
        publicationId: "revoked-generation",
      };
      await syncPublicDesk({ agent, prepare, acknowledge, active: () => true });
      live = false;
      release();
      await older;
      expect(remote?.record).toEqual({
        $type: "love.twyne.desk",
        version: 1,
        visibility: "private",
        publicationId: "revoked-generation",
      });
      expect(acknowledge).toHaveBeenCalledWith(2);
      expect(acknowledge).not.toHaveBeenCalledWith(1);
    },
  );
  test("allowlist drops private data and bounds heatmap output", () => {
    const record = publicDeskRecord(
      { handle: "writer" },
      {
        draftTitle: "secret",
        folioId: "private",
        aiCost: 10,
        writingHeatmap: Array.from({ length: 400 }, () => ({
          day: "2026-10-11",
          count: 2,
          folioId: "secret",
        })),
      },
      1,
    );
    expect(record.stats.writingHeatmap).toHaveLength(371);
    expect(JSON.stringify(record)).not.toMatch(/secret|private|aiCost|folioId/);
  });
});
