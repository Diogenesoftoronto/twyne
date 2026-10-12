import { expect, test } from "vitest";
import { lexicons } from "@atproto/api";
import schema from "../../public/lexicons/love.twyne.desk.json";
import { publicDeskRecord } from "./public-desk-contract";

test("shipped lexicon accepts public snapshots and content-free withdrawal markers", () => {
  lexicons.add(schema as Parameters<typeof lexicons.add>[0]);
  const publicationId = "00000000-0000-4000-8000-000000000001";
  const publicRecord = {
    ...publicDeskRecord({ handle: "writer" }, { daysWritten30: 4 }, 1),
    visibility: "public",
    publicationId,
  };
  const marker = {
    $type: "love.twyne.desk",
    version: 1,
    visibility: "private",
    publicationId,
  };
  expect(() =>
    lexicons.assertValidRecord(schema.id, publicRecord),
  ).not.toThrow();
  expect(() => lexicons.assertValidRecord(schema.id, marker)).not.toThrow();
  expect(() =>
    lexicons.assertValidRecord(schema.id, { ...marker, version: 2 }),
  ).toThrow();
  expect(() =>
    lexicons.assertValidRecord(schema.id, {
      ...publicRecord,
      stats: { daysWritten30: -1 },
    }),
  ).toThrow();
});
