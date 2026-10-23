#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import {
  exportBundles,
  fetchFolioBundles,
  importSources,
  parseImportSource,
  stripHtml,
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
  PERSONA_IDS,
  type CitationEntry,
  type EditorNote,
  type DraftInput,
  type FolioInclude,
  type FolioType,
} from "./types.js";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  env: NodeJS.ProcessEnv;
  readStdin?: () => Promise<string>;
}

const DEFAULT_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  readStdin,
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
  twyne editors list [--json]
  twyne room convene (--folio ID | --file FILE | --stdin) [--editors devil,angel] [--brief FILE] [--locale xx] [--json]
  twyne editor ask PERSONA (--folio ID | --file FILE | --stdin) [--instruction feedback|elaborate|riff|rewrite-suggestion] [--message TEXT] [--anchor TEXT] [--brief FILE] [--json]
  twyne rewrite PERSONA (--folio ID | --file FILE | --stdin) --original TEXT [--level sentence|paragraph] [--brief FILE] [--json]
  twyne grade (--folio ID | --file FILE | --stdin) [--brief FILE] [--criteria FILE] [--json]
  twyne dossier check --brief FILE (--folio ID | --file FILE | --stdin) [--json]
  twyne interview turn --messages FILE [--mode first-run|refine] [--brief FILE] [--starting FILE] [--json]
  twyne research targets (--folio ID | --file FILE | --stdin) [--strategy hosted|model] [--max N] [--brief FILE] [--existing TITLE ...] [--json]
  twyne research sources --kind KIND --anchor TEXT --query TEXT [--reason TEXT] [--max N] [--json]
  twyne research sources --target FILE [--max N] [--json]

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
  return Buffer.concat(chunks).toString("utf8");
}

async function readAccessToken(io: CliIo): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return (await (io.readStdin ?? readStdin)()).trim();
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
    throw new Error(
      "Usage: twyne provider login|status|logout codex|anthropic",
    );
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

const draftOptions = {
  folio: { type: "string" },
  file: { type: "string" },
  stdin: { type: "boolean" },
  brief: { type: "string" },
  json: { type: "boolean", default: false },
} as const;
const briefSchema = z.record(z.string(), z.unknown()).nullable();

async function readDraftFile(path: string): Promise<string> {
  const content = await readFile(path, "utf8");
  return /\.html?$/i.test(path) ? stripHtml(content) : content;
}

async function draftInput(
  values: { folio?: string; file?: string; stdin?: boolean; brief?: string },
  io: CliIo,
): Promise<DraftInput> {
  const sources =
    Number(values.folio !== undefined) +
    Number(values.file !== undefined) +
    Number(values.stdin === true);
  if (sources !== 1)
    throw new Error("Supply exactly one of --folio, --file, or --stdin");
  const source =
    values.folio !== undefined
      ? { folioId: required(values.folio, "--folio") }
      : {
          draftText:
            values.file !== undefined
              ? await readDraftFile(required(values.file, "--file"))
              : await (io.readStdin ?? readStdin)(),
        };
  return {
    ...source,
    ...(values.brief !== undefined
      ? { brief: briefSchema.parse(await readJson(values.brief)) }
      : {}),
  };
}

function printNote(io: CliIo, note: EditorNote): void {
  println(io.stdout, `[${note.personaName}] (${note.type}) ${note.text}`);
  for (const anchor of new Set([
    ...(note.anchor ? [note.anchor] : []),
    ...(note.anchors ?? []),
  ])) {
    println(
      io.stdout,
      anchor
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    );
  }
}

function requireAction(args: string[], command: string, action: string): void {
  if (args.shift() !== action)
    throw new Error(`Usage: twyne ${command} ${action}`);
}

function noPositionals(positionals: string[]): void {
  if (positionals.length)
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
}

async function editorsCommand(args: string[], io: CliIo): Promise<void> {
  requireAction(args, "editors", "list");
  const parsed = commandArgs(args, {
    json: { type: "boolean", default: false },
  });
  noPositionals(parsed.positionals);
  const editors = await (await clientFrom(io)).listEditors();
  if (parsed.values.json) return json(io, editors);
  for (const editor of editors)
    println(io.stdout, `${editor.id}\t${editor.name}\t${editor.role}`);
}

async function roomCommand(args: string[], io: CliIo): Promise<void> {
  requireAction(args, "room", "convene");
  const parsed = commandArgs(args, {
    ...draftOptions,
    editors: { type: "string" },
    locale: { type: "string" },
  });
  noPositionals(parsed.positionals);
  const input = {
    ...(await draftInput(parsed.values, io)),
    personaIds:
      parsed.values.editors === undefined
        ? undefined
        : z
            .array(z.enum(PERSONA_IDS))
            .min(1)
            .parse(parsed.values.editors.split(",").map((id) => id.trim())),
    responseLocale: z
      .enum(["en", "fr", "es", "zh", "hi", "ja"])
      .optional()
      .parse(parsed.values.locale),
  };
  const result = await (await clientFrom(io)).conveneRoom(input);
  if (parsed.values.json) return json(io, result);
  for (const note of result.notes) printNote(io, note);
}

async function editorCommand(args: string[], io: CliIo): Promise<void> {
  requireAction(args, "editor", "ask");
  const parsed = commandArgs(args, {
    ...draftOptions,
    instruction: { type: "string" },
    message: { type: "string" },
    anchor: { type: "string" },
  });
  const personaId = z.enum(PERSONA_IDS).parse(parsed.positionals[0]);
  noPositionals(parsed.positionals.slice(1));
  const input = {
    ...(await draftInput(parsed.values, io)),
    personaId,
    instruction: z
      .enum(["feedback", "elaborate", "riff", "rewrite-suggestion"])
      .optional()
      .parse(parsed.values.instruction),
    userMessage: parsed.values.message,
    anchor: parsed.values.anchor,
  };
  const result = await (await clientFrom(io)).askEditor(input);
  if (parsed.values.json) return json(io, result);
  printNote(io, result.note);
}

async function rewriteCommand(args: string[], io: CliIo): Promise<void> {
  const parsed = commandArgs(args, {
    ...draftOptions,
    original: { type: "string" },
    level: { type: "string", default: "sentence" },
  });
  const personaId = z.enum(PERSONA_IDS).parse(parsed.positionals[0]);
  noPositionals(parsed.positionals.slice(1));
  required(parsed.values.original, "--original");
  const input = {
    ...(await draftInput(parsed.values, io)),
    personaId,
    // Preserve whitespace: this must be a verbatim passage in the draft.
    original: parsed.values.original!,
    level: z.enum(["sentence", "paragraph"]).parse(parsed.values.level),
  };
  const result = await (await clientFrom(io)).suggestRewrite(input);
  if (parsed.values.json) return json(io, result);
  println(io.stdout, `${result.replacement}\n\nRationale: ${result.rationale}`);
}

async function gradeCommand(args: string[], io: CliIo): Promise<void> {
  const parsed = commandArgs(args, {
    ...draftOptions,
    criteria: { type: "string" },
  });
  noPositionals(parsed.positionals);
  const input = {
    ...(await draftInput(parsed.values, io)),
    criteria:
      parsed.values.criteria === undefined
        ? undefined
        : z
            .array(z.object({ label: z.string(), description: z.string() }))
            .parse(await readJson(parsed.values.criteria)),
  };
  const result = await (await clientFrom(io)).gradeDraft(input);
  if (parsed.values.json) return json(io, result);
  println(io.stdout, `Grade: ${result.grade}`);
  println(io.stdout, "Judge\tScore\tRationale");
  for (const judge of result.judges)
    println(
      io.stdout,
      `${judge.personaId}\t${judge.score}\t${judge.rationale}`,
    );
}

async function dossierCommand(args: string[], io: CliIo): Promise<void> {
  requireAction(args, "dossier", "check");
  const parsed = commandArgs(args, draftOptions);
  noPositionals(parsed.positionals);
  required(parsed.values.brief, "--brief");
  const input = await draftInput(parsed.values, io);
  const result = await (
    await clientFrom(io)
  ).checkDossier({ ...input, brief: input.brief! });
  if (parsed.values.json) return json(io, result);
  for (const observation of result.observations) {
    println(
      io.stdout,
      typeof observation.text === "string"
        ? observation.text
        : JSON.stringify(observation),
    );
  }
  if (!result.observations.length)
    println(io.stdout, "No dossier observations.");
}

async function interviewCommand(args: string[], io: CliIo): Promise<void> {
  requireAction(args, "interview", "turn");
  const parsed = commandArgs(args, {
    messages: { type: "string" },
    mode: { type: "string", default: "first-run" },
    brief: { type: "string" },
    starting: { type: "string" },
    json: { type: "boolean", default: false },
  });
  noPositionals(parsed.positionals);
  const input = {
    messages: z
      .array(
        z.object({
          author: z.enum(["writer", "interviewer"]),
          text: z.string(),
        }),
      )
      .parse(await readJson(required(parsed.values.messages, "--messages"))),
    mode: z.enum(["first-run", "refine"]).parse(parsed.values.mode),
    currentBrief:
      parsed.values.brief === undefined
        ? undefined
        : briefSchema.parse(await readJson(parsed.values.brief)),
    startingMaterial:
      parsed.values.starting === undefined
        ? undefined
        : await readDraftFile(parsed.values.starting),
  };
  const result = await (await clientFrom(io)).interviewTurn(input);
  if (parsed.values.json) return json(io, result);
  if (result.kind === "question") println(io.stdout, result.text);
  else
    for (const [field, value] of Object.entries(result.brief ?? {})) {
      println(
        io.stdout,
        `${field}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
    }
}

function researchMax(
  value: string | undefined,
  limit: number,
): number | undefined {
  const parsed = parseNumber(value, "--max");
  if (
    parsed !== undefined &&
    (!Number.isInteger(parsed) || parsed < 1 || parsed > limit)
  )
    throw new Error(`--max must be an integer from 1 to ${limit}`);
  return parsed;
}

async function researchCommand(args: string[], io: CliIo): Promise<void> {
  const action = args.shift();
  if (action === "targets") {
    const parsed = commandArgs(args, {
      ...draftOptions,
      strategy: { type: "string" },
      max: { type: "string" },
      existing: { type: "string", multiple: true },
    });
    noPositionals(parsed.positionals);
    const strategy = z
      .enum(["hosted", "model"])
      .optional()
      .parse(parsed.values.strategy);
    const maxTargets = researchMax(parsed.values.max, 12);
    const input = {
      ...(await draftInput(parsed.values, io)),
      strategy,
      maxTargets,
      existingSources: parsed.values.existing,
    };
    const result = await (await clientFrom(io)).findResearchTargets(input);
    if (parsed.values.json) return json(io, result);
    for (const target of result.targets) {
      println(
        io.stdout,
        `[${target.kind}] ${target.importance} → ${target.query}`,
      );
      println(io.stdout, `> ${target.anchor}`);
    }
    return;
  }
  if (action === "sources") {
    const parsed = commandArgs(args, {
      target: { type: "string" },
      kind: { type: "string" },
      anchor: { type: "string" },
      query: { type: "string" },
      reason: { type: "string" },
      max: { type: "string" },
      json: { type: "boolean", default: false },
    });
    noPositionals(parsed.positionals);
    const { target: path, kind, anchor, query, reason } = parsed.values;
    if (
      path !== undefined &&
      [kind, anchor, query, reason].some((value) => value !== undefined)
    )
      throw new Error(
        "Supply --target or --kind/--anchor/--query/--reason, not both",
      );
    if (path === undefined) {
      required(kind, "--kind");
      required(anchor, "--anchor");
      required(query, "--query");
    }
    // Strip id, importance and other file metadata from the search request.
    // Validate without trimming the verbatim anchor.
    const target = z
      .object({
        kind: z.enum([
          "quote",
          "work",
          "person",
          "statistic",
          "claim",
          "event",
        ]),
        anchor: z
          .string()
          .refine((value) => value.trim().length > 0, "anchor is required"),
        query: z
          .string()
          .refine((value) => value.trim().length > 0, "query is required"),
        reason: z.string().optional(),
      })
      .parse(
        path === undefined
          ? { kind, anchor, query, ...(reason !== undefined ? { reason } : {}) }
          : await readJson(required(path, "--target")),
      );
    const maxResults = researchMax(parsed.values.max, 10);
    const result = await (
      await clientFrom(io)
    ).searchResearchSources({ target, maxResults });
    if (parsed.values.json) return json(io, result);
    for (const source of result.ranked) {
      const details = [source.publisher, source.date]
        .filter(Boolean)
        .join(" · ");
      println(
        io.stdout,
        `${source.title} — ${source.url}${details ? ` (${details})` : ""}`,
      );
    }
    return;
  }
  throw new Error("Usage: twyne research targets|sources");
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
    else if (command === "editors") await editorsCommand(args, io);
    else if (command === "room") await roomCommand(args, io);
    else if (command === "editor") await editorCommand(args, io);
    else if (command === "rewrite") await rewriteCommand(args, io);
    else if (command === "grade") await gradeCommand(args, io);
    else if (command === "dossier") await dossierCommand(args, io);
    else if (command === "interview") await interviewCommand(args, io);
    else if (command === "research") await researchCommand(args, io);
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
