import { makeFunctionReference } from "convex/server";
import type { Agent } from "@atproto/api";
import {
  PUBLIC_DESK_COLLECTION,
  PUBLIC_DESK_RKEY,
  type PublicDeskJob,
  type PublicDeskPdsRecord,
} from "./public-desk-contract";

export const PUBLIC_DESK_SYNC_EVENT = "twyne:public-desk-sync";
export interface PublicDeskStatus {
  enabled: boolean;
  pending: boolean;
  did: string | null;
  linkedDid: string | null;
}
export const deskStatusRef = makeFunctionReference<
  "query",
  Record<string, never>,
  PublicDeskStatus
>("publicDesk:getStatus");
export const deskEnabledRef = makeFunctionReference<
  "mutation",
  { enabled: boolean },
  null
>("publicDesk:setEnabled");
export const deskPrepareRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  (Omit<PublicDeskJob, "record"> & { recordJson: string | null }) | null
>("publicDesk:prepare");
export const deskAcknowledgeRef = makeFunctionReference<
  "mutation",
  { revision: number },
  boolean
>("publicDesk:acknowledge");

function recordMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "error" in error &&
    error.error === "RecordNotFound"
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Deterministic transport; failures leave durable server intent pending. */
export async function syncPublicDesk(options: {
  agent: Agent;
  prepare: () => Promise<PublicDeskJob | null>;
  acknowledge: (revision: number) => Promise<boolean>;
  active: () => boolean;
}): Promise<void> {
  const { agent, prepare, acknowledge, active } = options;
  const did = agent.did ?? agent.assertDid;
  // Re-read after each write to compensate for privacy changes during IO.
  for (let attempt = 0; attempt < 4 && active(); attempt++) {
    let job = await prepare();
    if (!job || !active()) return;
    if (job.did !== did)
      throw new Error(
        "Connect the PDS linked to your Twyne account to finish desk synchronization.",
      );
    const address = {
      repo: did,
      collection: PUBLIC_DESK_COLLECTION,
      rkey: PUBLIC_DESK_RKEY,
    };
    let cid: string | null = null;
    let current: unknown = null;
    try {
      const response = await agent.com.atproto.repo.getRecord(address);
      if (
        typeof response.data.cid !== "string" ||
        !response.data.cid ||
        response.data.uri !==
          `at://${did}/${PUBLIC_DESK_COLLECTION}/${PUBLIC_DESK_RKEY}`
      ) {
        throw new Error("The PDS returned an invalid desk record response.");
      }
      cid = response.data.cid;
      current = response.data.value;
    } catch (error) {
      if (!recordMissing(error)) throw error;
    }
    // Consent may have changed during the network read.
    job = await prepare();
    if (!job || job.did !== did || !active()) return;
    const desired: PublicDeskPdsRecord = job.record
      ? {
          ...job.record,
          visibility: "public",
          publicationId: job.publicationId,
        }
      : {
          $type: PUBLIC_DESK_COLLECTION,
          version: 1,
          visibility: "private",
          publicationId: job.publicationId,
        };
    try {
      if (canonical(current) !== canonical(desired)) {
        const response = await agent.com.atproto.repo.putRecord({
          ...address,
          record: { ...desired },
          swapRecord: cid,
          validate: false,
        });
        if (
          typeof response.data?.cid !== "string" ||
          !response.data.cid ||
          response.data.uri !==
            `at://${did}/${PUBLIC_DESK_COLLECTION}/${PUBLIC_DESK_RKEY}`
        ) {
          throw new Error("The PDS did not confirm the desk record write.");
        }
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "error" in error &&
        error.error === "InvalidSwap"
      )
        continue;
      throw error;
    }
    if (!active()) return;
    // Acknowledgement is UI bookkeeping, never an authorization decision.
    const latest = await prepare();
    if (!latest) return;
    if (latest.revision !== job.revision) continue;
    if (!latest.pending || (await acknowledge(job.revision))) return;
  }
  if (active())
    throw new Error(
      "Your desk changed during synchronization. It will retry shortly.",
    );
}
