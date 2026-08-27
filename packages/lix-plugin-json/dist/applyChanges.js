import { changeIsLeafOf } from "@lix-js/sdk";
import { unflatten } from "flat";
import { JSONPropertySchema } from "./schemas/JSONPropertySchema.js";

export const applyChanges = async ({ lix, changes }) => {
  const leafChanges = [
    ...new Set(
      await Promise.all(
        changes.map(async (change) => {
          const leafChange = await lix.db
            .selectFrom("change")
            .where(changeIsLeafOf({ id: change.id }))
            .selectAll()
            .executeTakeFirst();
          return JSON.stringify(leafChange);
        }),
      ),
    ),
  ].map((value) => JSON.parse(value));

  const flattened = {};
  for (const change of leafChanges) {
    if (change.schema_key === JSONPropertySchema.key) {
      const snapshot = await lix.db
        .selectFrom("snapshot")
        .where("id", "=", change.snapshot_id)
        .selectAll()
        .executeTakeFirstOrThrow();
      flattened[change.entity_id] = snapshot.content?.value;
    }
  }

  return {
    fileData: new TextEncoder().encode(JSON.stringify(unflatten(flattened))),
  };
};
