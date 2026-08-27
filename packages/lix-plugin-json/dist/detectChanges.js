import { flatten } from "flat";
import { JSONPropertySchema } from "./schemas/JSONPropertySchema.js";

export const detectChanges = async ({ before, after }) => {
  const detectedChanges = [];
  const beforeParsed = before?.data
    ? JSON.parse(new TextDecoder().decode(before.data))
    : {};
  const afterParsed = after?.data
    ? JSON.parse(new TextDecoder().decode(after.data))
    : {};
  const flattenedBefore = flatten(beforeParsed, { safe: true });
  const flattenedAfter = flatten(afterParsed, { safe: true });

  for (const key in flattenedBefore) {
    if (!(key in flattenedAfter)) {
      detectedChanges.push({
        schema: JSONPropertySchema,
        entity_id: key,
        snapshot: undefined,
      });
    } else if (
      JSON.stringify(flattenedBefore[key]) !== JSON.stringify(flattenedAfter[key])
    ) {
      detectedChanges.push({
        schema: JSONPropertySchema,
        entity_id: key,
        snapshot: {
          property: key,
          value: flattenedAfter[key],
        },
      });
    }
  }

  for (const key in flattenedAfter) {
    if (!(key in flattenedBefore)) {
      detectedChanges.push({
        schema: JSONPropertySchema,
        entity_id: key,
        snapshot: {
          property: key,
          value: flattenedAfter[key],
        },
      });
    }
  }

  return detectedChanges;
};
