"use node";
/** Builds the "export everything" zip. See accountExport.ts. */
import { makeFunctionReference, type FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { strToU8, zipSync, type Zippable } from "fflate";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  EXPORT_OMITTED_FIELDS,
  EXPORT_TABLES,
  type ExportTable,
} from "./accountExport";
import { listNotOrganicAchievements } from "./lib/notorganicAchievements";

const getJob = makeFunctionReference<
  "query",
  { exportId: Id<"accountExports"> },
  {
    ownerId: string;
    productSubject: string;
    status: string;
    link: { did: string; sessionVersion: number } | null;
  } | null
>("accountExport:getJob");
const exportPage = makeFunctionReference<
  "query",
  {
    table: string;
    value: string;
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      maximumBytesRead?: number;
    };
  },
  { page: Record<string, unknown>[]; continueCursor: string; isDone: boolean }
>("accountExport:exportPage");
const finish = makeFunctionReference<
  "mutation",
  {
    exportId: Id<"accountExports">;
    storageId: Id<"_storage">;
    bytes: number;
    rowCount: number;
  },
  null
>("accountExport:finish");
const fail = makeFunctionReference<
  "mutation",
  { exportId: Id<"accountExports">; error: string },
  null
>("accountExport:fail");

/** Storage-backed columns whose files are copied into the zip. */
const STORAGE_FIELDS: Partial<Record<ExportTable, string>> = {
  images: "storageId",
  sharedLixBlobs: "storageId",
  handles: "avatarStorageId",
};

const EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

const README = `Twyne account export

data/<table>.json   Every synced row your account owns, one JSON array per table.
files/              Files those rows point to: images, profile picture, and
                    Lix documents (your manuscripts' version history).
                    A row's "<field>File" or {"file": ...} value names its file.
notorganic/achievements.json
                    Achievements from your Not Organic account.
this-device/        Added by the browser that downloaded this archive: folios,
                    briefs, personas and settings kept only on that device.
                    API keys are never included.

Integration token secrets are not stored by Twyne and are not included.
`;

export const build = internalAction({
  args: { exportId: v.id("accountExports") },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.runQuery(getJob, { exportId });
    if (!job || job.status !== "running") return null;
    try {
      const files: Zippable = {};
      const tables: Record<string, number> = {};
      let rowCount = 0;

      const addFile = async (
        table: string,
        rowId: string,
        bytes: Uint8Array,
        extension: string,
      ) => {
        const path = `files/${table}/${rowId}${extension}`;
        files[path] = [bytes, { level: 0 }];
        return path;
      };

      for (const [table, spec] of Object.entries(EXPORT_TABLES) as Array<
        [ExportTable, (typeof EXPORT_TABLES)[ExportTable]]
      >) {
        const value = spec.key === "subject" ? job.productSubject : job.ownerId;
        const omitted = new Set(EXPORT_OMITTED_FIELDS[table] ?? []);
        const storageField = STORAGE_FIELDS[table];
        const rows: Record<string, unknown>[] = [];
        let cursor: string | null = null;
        for (;;) {
          const result: FunctionReturnType<typeof exportPage> =
            await ctx.runQuery(exportPage, {
              table,
              value,
              paginationOpts: {
                numItems: 100,
                cursor,
                maximumBytesRead: 4 * 1024 * 1024,
              },
            });
          for (const source of result.page) {
            const row: Record<string, unknown> = {};
            const rowId = String(source._id);
            for (const [field, fieldValue] of Object.entries(source)) {
              if (omitted.has(field)) continue;
              if (fieldValue instanceof ArrayBuffer) {
                row[field] = {
                  file: await addFile(
                    table,
                    `${rowId}-${field}`,
                    new Uint8Array(fieldValue),
                    table === "lixBlobs" ? ".lix" : ".bin",
                  ),
                };
                continue;
              }
              row[field] = fieldValue;
            }
            const storageId = storageField
              ? (source[storageField] as Id<"_storage"> | undefined)
              : undefined;
            if (storageId) {
              const blob = await ctx.storage.get(storageId);
              if (blob)
                row[`${storageField}File`] = await addFile(
                  table,
                  rowId,
                  new Uint8Array(await blob.arrayBuffer()),
                  table === "sharedLixBlobs"
                    ? ".lix"
                    : (EXTENSIONS[blob.type] ?? ".bin"),
                );
            }
            rows.push(row);
          }
          if (result.isDone) break;
          cursor = result.continueCursor;
        }
        if (!rows.length) continue;
        tables[table] = rows.length;
        rowCount += rows.length;
        files[`data/${table}.json`] = strToU8(JSON.stringify(rows, null, 2));
      }

      let achievements: "included" | "unavailable" | "not-linked" =
        "not-linked";
      if (job.link) {
        try {
          files["notorganic/achievements.json"] = strToU8(
            JSON.stringify(await listNotOrganicAchievements(job.link), null, 2),
          );
          achievements = "included";
        } catch (error) {
          console.warn(
            "[twyne:account-export] achievements unavailable",
            error,
          );
          achievements = "unavailable";
        }
      }

      files["README.txt"] = strToU8(README);
      files["manifest.json"] = strToU8(
        JSON.stringify(
          {
            format: "twyne-account-export",
            version: 1,
            exportedAt: new Date().toISOString(),
            did: job.link?.did ?? null,
            tables,
            achievements,
          },
          null,
          2,
        ),
      );

      const zip = zipSync(files, { level: 6 });
      const storageId = await ctx.storage.store(
        new Blob([zip], { type: "application/zip" }),
      );
      await ctx.runMutation(finish, {
        exportId,
        storageId,
        bytes: zip.byteLength,
        rowCount,
      });
    } catch (error) {
      console.error("[twyne:account-export] build failed", error);
      await ctx.runMutation(fail, {
        exportId,
        error: "The export could not be built. Try again in a few minutes.",
      });
    }
    return null;
  },
});
