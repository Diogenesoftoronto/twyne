#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { pathToFileURL } from "node:url";
import {
  exportBundles,
  fetchFolioBundles,
  importSources,
  parseImportSource,
  type ExportFormat,
  type ImportSource,
} from "./archive.js";
import { TwyneClient } from "./client.js";
import {
  defaultConfigPath,
  deleteConfig,
  loadCredentials,
  writeConfig,
} from "./config.js";
import {
  runSdkAuthCommand,
  type SdkAuthAction,
  type SdkProvider,
} from "./provider-auth.js";
import {
  FOLIO_INCLUDES,
  type CitationEntry,
  type FolioInclude,
  type FolioType,
} from "./types.js";

interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  env: NodeJS.ProcessEnv;
}

const DEFAULT_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
};

const HELP = `Twyne CLI

Usage:
  twyne auth login --url URL [--token TOKEN]
  twyne auth status
  twyne auth logout
  twyne provider login codex|anthropic
  twyne provider status codex|anthropic
  twyne provider logout codex|anthropic
  twyne folio list [--json]
  twyne folio get ID [--include content,brief,feedback,rubric,suggestions,citations]
  twyne folio create --name NAME [--type draft|notes|outline] [--file FILE] [--brief FILE]
  twyne folio update ID [--name NAME] [--type TYPE] [--file FILE] [--brief FILE] [--expected-updated-at MS]
  twyne folio search QUERY [--limit N]
  twyne folio import FILE... [--type TYPE]
  twyne folio export [ID...] [--format archive|markdown|html|txt] [--output FILE]
  twyne feedback get ID
  twyne citations list [--folio-id ID] [--search QUERY]
  twyne citations upsert --folio-id ID --file FILE

Credentials are read from TWYNE_API_URL + TWYNE_ACCESS_TOKEN first, then from
the chmod-0600 config written by auth login. Login prompts securely when a
token is not supplied, and also accepts one on stdin.

Provider sign-in delegates to the official local CLI (codex or ant). Its SDK
then reuses that CLI-owned credential; Twyne never copies or stores the token.
`;

function println(stream: Pick<NodeJS.WriteStream, "write">, value = ""): void {
  stream.write(`${value}\n`);
}

function json(io: CliIo, value: unknown): void {
  println(io.stdout, JSON.stringify(value, null, 2));
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function parseNumber(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number`);
  return parsed;
}

function parseType(value: string | undefined): FolioType | undefined {
  if (value === undefined) return undefined;
  if (value === "draft" || value === "notes" || value === "outline")
    return value;
  throw new Error("type must be draft, notes, or outline");
}

function parseIncludes(value: string | undefined): FolioInclude[] | undefined {
  if (value === undefined) return undefined;
  const includes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowed = new Set<string>(FOLIO_INCLUDES);
  const invalid = includes.filter((entry) => !allowed.has(entry));
  if (invalid.length)
    throw new Error(`Unknown include values: ${invalid.join(", ")}`);
  return includes as FolioInclude[];
}

function commandArgs<T extends ParseArgsOptionsConfig>(
  args: string[],
  options: T,
) {
  return parseArgs({
    args,
    options,
    allowPositionals: true,
    strict: true,
  } as const);
}

async function clientFrom(io: CliIo): Promise<TwyneClient> {
  return TwyneClient.fromCredentials(
    await loadCredentials(io.env, defaultConfigPath(io.env)),
  );
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${path} is not valid JSON`);
    throw error;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readAccessToken(io: CliIo): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return await readStdin();
  }
  const input = process.stdin;
  const wasRaw = input.isRaw;
  io.stdout.write("Twyne access token: ");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      io.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Login cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function authCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action === "login") {
    const parsed = commandArgs(args, {
      url: { type: "string" },
      token: { type: "string" },
    });
    const apiUrl = required(
      parsed.values.url ?? io.env.TWYNE_API_URL,
      "--url or TWYNE_API_URL",
    );
    const accessToken = required(
      parsed.values.token ??
        io.env.TWYNE_ACCESS_TOKEN ??
        (await readAccessToken(io)),
      "--token, TWYNE_ACCESS_TOKEN, or a token on stdin",
    );
    const client = new TwyneClient({ apiUrl, accessToken });
    await client.listFolios();
    const path = await writeConfig(
      { apiUrl, accessToken },
      defaultConfigPath(io.env),
    );
    println(
      io.stdout,
      `Authenticated with Twyne. Credentials saved to ${path} (mode 0600).`,
    );
    return;
  }
  if (action === "status") {
    commandArgs(args, {});
    const credentials = await loadCredentials(
      io.env,
      defaultConfigPath(io.env),
    );
    const folios = await TwyneClient.fromCredentials(credentials).listFolios();
    json(io, {
      authenticated: true,
      apiUrl: credentials.apiUrl,
      source: credentials.source,
      tokenPrefix: `${credentials.accessToken.slice(0, 18)}…`,
      folioCount: folios.length,
    });
    return;
  }
  if (action === "logout") {
    commandArgs(args, {});
    const path = defaultConfigPath(io.env);
    const removed = await deleteConfig(path);
    println(
      io.stdout,
      removed ? `Removed ${path}.` : `No saved Twyne config at ${path}.`,
    );
    if (io.env.TWYNE_API_URL || io.env.TWYNE_ACCESS_TOKEN) {
      println(
        io.stderr,
        "Environment credentials remain active; unset them to fully log out.",
      );
    }
    return;
  }
  throw new Error("Usage: twyne auth login|status|logout");
}

function parseSdkProvider(value: string | undefined): SdkProvider {
  if (value === "codex" || value === "anthropic") return value;
  throw new Error("provider must be codex or anthropic");
}

async function providerCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action !== "login" && action !== "status" && action !== "logout") {
    throw new Error("Usage: twyne provider login|status|logout codex|anthropic");
  }
  const parsed = commandArgs(args, {});
  const provider = parseSdkProvider(parsed.positionals[0]);
  if (parsed.positionals.length > 1) {
    throw new Error("provider commands accept exactly one provider");
  }
  await runSdkAuthCommand(provider, action as SdkAuthAction, io.env);
}

async function folioCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = commandArgs(args, {
      json: { type: "boolean", default: false },
    });
    const folios = await (await clientFrom(io)).listFolios();
    if (parsed.values.json) return json(io, folios);
    if (!folios.length) return println(io.stdout, "No folios.");
    for (const folio of folios) {
      println(
        io.stdout,
        [
          folio.id ?? "-",
          folio.type ?? "draft",
          folio.updatedAt ?? "-",
          folio.name,
        ].join("\t"),
      );
    }
    return;
  }

  if (action === "get") {
    const parsed = commandArgs(args, { include: { type: "string" } });
    const folioId = required(parsed.positionals[0], "folio ID");
    if (parsed.positionals.length > 1)
      throw new Error("folio get accepts one ID");
    const bundle = await (
      await clientFrom(io)
    ).getFolio(folioId, parseIncludes(parsed.values.include));
    if (!bundle) throw new Error(`Folio not found: ${folioId}`);
    return json(io, bundle);
  }

  if (action === "create") {
    const parsed = commandArgs(args, {
      name: { type: "string" },
      type: { type: "string" },
      file: { type: "string" },
      brief: { type: "string" },
    });
    const file = parsed.values.file;
    const parsedFile = file
      ? parseImportSource({ name: file, content: await readFile(file, "utf8") })
          .folios[0]
      : undefined;
    const folio = await (
      await clientFrom(io)
    ).putFolio({
      folio: {
        name: required(parsed.values.name ?? parsedFile?.folio.name, "--name"),
        type:
          parseType(parsed.values.type) ?? parsedFile?.folio.type ?? "draft",
      },
      ...(parsedFile?.html !== undefined ? { html: parsedFile.html } : {}),
      ...(parsed.values.brief
        ? { brief: await readJson(parsed.values.brief) }
        : {}),
    });
    return json(io, folio);
  }

  if (action === "update") {
    const parsed = commandArgs(args, {
      name: { type: "string" },
      type: { type: "string" },
      file: { type: "string" },
      brief: { type: "string" },
      "expected-updated-at": { type: "string" },
    });
    const folioId = required(parsed.positionals[0], "folio ID");
    if (parsed.positionals.length > 1)
      throw new Error("folio update accepts one ID");
    const client = await clientFrom(io);
    const current = await client.getFolio(folioId, []);
    if (!current) throw new Error(`Folio not found: ${folioId}`);
    const file = parsed.values.file;
    const parsedFile = file
      ? parseImportSource({ name: file, content: await readFile(file, "utf8") })
          .folios[0]
      : undefined;
    const updated = await client.putFolio({
      folio: {
        ...current.folio,
        id: folioId,
        name: parsed.values.name ?? current.folio.name,
        type: parseType(parsed.values.type) ?? current.folio.type,
      },
      ...(parsedFile?.html !== undefined ? { html: parsedFile.html } : {}),
      ...(parsed.values.brief
        ? { brief: await readJson(parsed.values.brief) }
        : {}),
      ...(parsed.values["expected-updated-at"] !== undefined
        ? {
            expectedUpdatedAt: parseNumber(
              parsed.values["expected-updated-at"],
              "--expected-updated-at",
            ),
          }
        : {}),
    });
    return json(io, updated);
  }

  if (action === "search") {
    const parsed = commandArgs(args, { limit: { type: "string" } });
    const query = required(parsed.positionals.join(" "), "search query");
    const limit = parseNumber(parsed.values.limit, "--limit") ?? 20;
    return json(io, await (await clientFrom(io)).searchFolios(query, limit));
  }

  if (action === "import") {
    const parsed = commandArgs(args, { type: { type: "string" } });
    if (!parsed.positionals.length)
      throw new Error("folio import needs at least one file");
    const type = parseType(parsed.values.type);
    const sources: ImportSource[] = await Promise.all(
      parsed.positionals.map(async (name) => ({
        name,
        content: await readFile(name, "utf8"),
        type,
      })),
    );
    return json(io, await importSources(await clientFrom(io), sources));
  }

  if (action === "export") {
    const parsed = commandArgs(args, {
      format: { type: "string", default: "archive" },
      output: { type: "string" },
    });
    const format = parsed.values.format as ExportFormat;
    if (
      !(["archive", "markdown", "html", "txt"] as string[]).includes(format)
    ) {
      throw new Error("--format must be archive, markdown, html, or txt");
    }
    const artifact = exportBundles(
      await fetchFolioBundles(await clientFrom(io), parsed.positionals),
      format,
    );
    if (parsed.values.output) {
      await writeFile(parsed.values.output, artifact.content, "utf8");
      return json(io, {
        output: parsed.values.output,
        format: artifact.format,
        mimeType: artifact.mimeType,
      });
    }
    io.stdout.write(artifact.content);
    return;
  }

  throw new Error(
    "Usage: twyne folio list|get|create|update|search|import|export",
  );
}

async function feedbackCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action !== "get") throw new Error("Usage: twyne feedback get ID");
  const parsed = commandArgs(args, {});
  const folioId = required(parsed.positionals[0], "folio ID");
  if (parsed.positionals.length > 1)
    throw new Error("feedback get accepts one ID");
  json(io, await (await clientFrom(io)).getFeedback(folioId));
}

function parseCitationEntries(value: unknown): CitationEntry[] {
  const entries = Array.isArray(value) ? value : [value];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Citation ${index + 1} must be an object`);
    }
    if (typeof (entry as Record<string, unknown>).title !== "string") {
      throw new Error(`Citation ${index + 1} needs a title`);
    }
  }
  return entries as CitationEntry[];
}

async function citationsCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = commandArgs(args, {
      "folio-id": { type: "string" },
      search: { type: "string" },
    });
    return json(
      io,
      await (
        await clientFrom(io)
      ).listCitations({
        ...(parsed.values["folio-id"]
          ? { folioId: parsed.values["folio-id"] }
          : {}),
        ...(parsed.values.search ? { search: parsed.values.search } : {}),
      }),
    );
  }
  if (action === "upsert") {
    const parsed = commandArgs(args, {
      "folio-id": { type: "string" },
      file: { type: "string" },
    });
    const folioId = required(parsed.values["folio-id"], "--folio-id");
    const path = required(parsed.values.file, "--file");
    return json(
      io,
      await (
        await clientFrom(io)
      ).putCitations(folioId, parseCitationEntries(await readJson(path))),
    );
  }
  throw new Error("Usage: twyne citations list|upsert");
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = DEFAULT_IO,
): Promise<number> {
  const command = args.shift();
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    io.stdout.write(HELP);
    return 0;
  }
  try {
    if (command === "auth") await authCommand(args, io);
    else if (command === "provider") await providerCommand(args, io);
    else if (command === "folio") await folioCommand(args, io);
    else if (command === "feedback") await feedbackCommand(args, io);
    else if (command === "citations") await citationsCommand(args, io);
    else throw new Error(`Unknown command: ${command}`);
    return 0;
  } catch (error) {
    println(
      io.stderr,
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runCli();
}
