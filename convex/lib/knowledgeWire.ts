import { convexToJson, type Value } from "convex/values";

/** MCP payloads are JSON objects. Preserve their keys even when Convex reserves
 * a field name (for example $schema or $ref in a tool's input schema). */
export function encodeMcpObject<T>(value: T): T | string {
  try {
    convexToJson(value as Value);
    return value;
  } catch {
    return JSON.stringify(value);
  }
}

export function decodeMcpObject(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
