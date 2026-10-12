/* Reviewed Sakana proposal. Matches current Source catalog admission; never grants consent. */
export interface CatalogTool {
  name: string;
  title?: unknown;
  description?: unknown;
  inputSchema?: unknown;
}

export interface AccountSource {
  id: string;
  label: string;
  tools: CatalogTool[];
  resources_allowed: boolean;
}

export const SOURCE_LIMIT = 100;
export const TOOL_LIMIT = 128;
export const SERIALIZED_LIMIT = 1_048_576;
export const ID_LIMIT = 256;
export const LABEL_LIMIT = 200;
export const TOOL_NAME_LIMIT = 256;
export const INPUT_SCHEMA_LIMIT = 65_536;

export function validateCatalog(raw: unknown): AccountSource[] {
  const data = (raw as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) throw new Error("Invalid sources response");
  if (JSON.stringify(data).length > SERIALIZED_LIMIT)
    throw new Error("Source catalog is too large");
  if (data.length > SOURCE_LIMIT)
    throw new Error("Source catalog is too large");
  const seen = new Set<string>();
  return data.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("Invalid source catalog");
    const source = value as AccountSource;
    if (
      typeof source.id !== "string" ||
      !source.id ||
      source.id.length > ID_LIMIT ||
      seen.has(source.id) ||
      typeof source.label !== "string" ||
      source.label.length > LABEL_LIMIT ||
      !Array.isArray(source.tools) ||
      source.tools.length > TOOL_LIMIT ||
      typeof source.resources_allowed !== "boolean"
    )
      throw new Error("Invalid source catalog");
    seen.add(source.id);
    const toolNames = new Set<string>();
    for (const tool of source.tools) {
      if (
        !tool ||
        typeof tool.name !== "string" ||
        !tool.name ||
        tool.name.length > TOOL_NAME_LIMIT ||
        toolNames.has(tool.name) ||
        !tool.inputSchema ||
        typeof tool.inputSchema !== "object" ||
        Array.isArray(tool.inputSchema) ||
        (tool.inputSchema as { type?: unknown }).type !== "object" ||
        JSON.stringify(tool.inputSchema).length > INPUT_SCHEMA_LIMIT
      )
        throw new Error("Invalid tool schema");
      toolNames.add(tool.name);
    }
    return source;
  });
}

export function toolDefinition(tool: CatalogTool): string {
  return JSON.stringify({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  });
}
