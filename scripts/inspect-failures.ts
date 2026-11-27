#!/usr/bin/env bun
/**
 * Find and summarise failures in a Convex deployment's logs.
 *
 *   bun run failures                         # dev, last 2000 log events
 *   bun run failures -- --prod               # production
 *   bun run failures -- --prod --ref 1f2e…   # the log lines behind a reference id
 *   bun run failures -- --prod --feature research
 *   bun run failures -- --prod --history 10000 --since 2h
 *
 * A writer's "What happened" panel and "Copy diagnostics" report carry a
 * `Reference:` line. Pass it to --ref to see the server side of the same
 * failure: which step failed, which provider, and what it answered.
 *
 * The summary groups uncaught errors and `[twyne:<feature>]` reports by
 * function and message, so a failure that repeats hundreds of times (the
 * persona-label crash in `systemOne:ask`, say) shows up as one line with a
 * count instead of scrolling past.
 */
import { spawn } from "node:child_process";

interface Args {
  prod: boolean;
  ref?: string;
  feature?: string;
  history: number;
  sinceMs?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { prod: false, history: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--prod") args.prod = true;
    else if (a === "--ref") args.ref = next();
    else if (a === "--feature") args.feature = next();
    else if (a === "--history") args.history = Number(next()) || args.history;
    else if (a === "--since") {
      const m = /^(\d+)([mhd])$/.exec(next() ?? "");
      if (m)
        args.sinceMs =
          Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: bun run failures -- [--prod] [--ref <id>] [--feature <name>] [--history N] [--since 30m|2h|1d]",
      );
      process.exit(0);
    }
  }
  return args;
}

interface LogEvent {
  timestamp?: number;
  topic?: string;
  function?: { path?: string; type?: string };
  udfType?: string;
  identifier?: string;
  log_level?: string;
  message?: string;
  messages?: string[];
  error?: string;
  error_message?: string;
  status?: string;
}

/** Collect JSONL log events; `convex logs` streams, so stop after a quiet spell. */
function readLogs(args: Args): Promise<LogEvent[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "convex",
        "logs",
        "--jsonl",
        "--history",
        String(args.history),
        ...(args.prod ? ["--prod"] : []),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const events: LogEvent[] = [];
    let buffer = "";
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => child.kill("SIGTERM"), 4000);
    };
    settle();
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          events.push(JSON.parse(line) as LogEvent);
        } catch {
          /* partial line */
        }
      }
      settle();
    });
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(quiet);
      resolve(events);
    });
  });
}

function textOf(e: LogEvent): string {
  return [
    e.message,
    ...(e.messages ?? []),
    e.error,
    e.error_message,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
}

function fnOf(e: LogEvent): string {
  return e.function?.path ?? e.identifier ?? e.topic ?? "?";
}

function when(ts?: number): string {
  if (!ts) return "?";
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

const args = parseArgs(process.argv.slice(2));
const target = args.prod ? "production" : "dev";
console.error(`Reading the last ${args.history} log events from ${target}…`);
let events = await readLogs(args);
if (args.sinceMs) {
  const cutoff = Date.now() - args.sinceMs;
  events = events.filter((e) => {
    const ms = (e.timestamp ?? 0) > 1e12 ? e.timestamp! : (e.timestamp ?? 0) * 1000;
    return ms >= cutoff;
  });
}

const failing = events.filter((e) => {
  const t = textOf(e);
  return (
    e.status === "failure" ||
    e.log_level === "ERROR" ||
    /Uncaught|\[twyne:/.test(t)
  );
});

if (args.ref) {
  const hits = events.filter((e) => textOf(e).includes(args.ref!));
  if (!hits.length) {
    console.log(
      `No log line mentions ${args.ref} in the last ${args.history} events on ${target}. Try --history 20000, or the other deployment.`,
    );
    process.exit(1);
  }
  for (const e of hits) console.log(`${when(e.timestamp)}  ${fnOf(e)}\n  ${textOf(e)}\n`);
  process.exit(0);
}

const scoped = args.feature
  ? failing.filter((e) => `${fnOf(e)} ${textOf(e)}`.includes(args.feature!))
  : failing;

/** Strip ids and numbers so repeats of one failure group together. */
function signature(e: LogEvent): string {
  return `${fnOf(e)} :: ${textOf(e)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b\d{2,}\b/g, "<n>")
    .slice(0, 220)}`;
}

const groups = new Map<string, { count: number; first?: number; last?: number; sample: LogEvent }>();
for (const e of scoped) {
  const key = signature(e);
  const g = groups.get(key) ?? { count: 0, sample: e };
  g.count += 1;
  g.first = Math.min(g.first ?? Infinity, e.timestamp ?? Infinity);
  g.last = Math.max(g.last ?? 0, e.timestamp ?? 0);
  g.sample = e;
  groups.set(key, g);
}

console.log(
  `${scoped.length} failing events in ${events.length} read from ${target}${args.feature ? ` matching "${args.feature}"` : ""}.\n`,
);
for (const [, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
  console.log(
    `${String(g.count).padStart(5)}×  ${fnOf(g.sample)}   last ${when(g.last)}\n        ${textOf(g.sample).slice(0, 400)}\n`,
  );
}
