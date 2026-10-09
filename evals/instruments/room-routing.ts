import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS } from "../../src/utils/personas";
import { normalizeEndpointUrl } from "../../src/utils/judgement-client";
import {
  buildInstrumentRoomRequest,
  readInstrumentRoomChoice,
  type InstrumentRoomPrepared,
  type InstrumentRoomSelection,
} from "../../src/utils/instrument-room";
import {
  ROOM_ROUTING_CORPUS_VERSION,
  roomRoutingCases,
  type RoomRoutingCase,
} from "./room-routing-corpus";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export interface RoomRoutingOptions {
  runModel: boolean;
  caseId?: string;
  endpoint?: string;
  model: string;
  timeoutMs: number;
  output: string;
  help: boolean;
}
export function parseRoomRoutingOptions(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
): RoomRoutingOptions {
  const values: Record<string, string> = {};
  const toggles = new Set<string>();
  const valueFlags = [
    "--case",
    "--endpoint",
    "--model",
    "--timeout-ms",
    "--output",
  ];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--run-model" || flag === "--help") {
      if (toggles.has(flag)) throw new Error(`Duplicate option ${flag}.`);
      toggles.add(flag);
    } else if (valueFlags.includes(flag)) {
      if (values[flag] !== undefined)
        throw new Error(`Duplicate option ${flag}.`);
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Option ${flag} needs a value.`);
      values[flag] = value;
    } else
      throw new Error(
        "Unsupported option. Use --help; credentials are accepted only through the environment.",
      );
  }
  if (
    values["--case"] &&
    !roomRoutingCases.some((fixture) => fixture.id === values["--case"])
  )
    throw new Error(
      "Unknown room-routing case. Use an exact case ID from room-routing-corpus.ts.",
    );
  const timeoutMs = Number(values["--timeout-ms"] ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)
    throw new Error(
      "Request timeout must be an integer from 1000 to 120000 ms.",
    );
  const rawEndpoint = values["--endpoint"] ?? env.TWYNE_ROOM_ROUTING_ENDPOINT;
  const endpoint = rawEndpoint ? normalizeEndpointUrl(rawEndpoint) : null;
  if (rawEndpoint && !endpoint)
    throw new Error("Endpoint must be a valid http(s) URL.");
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash)
      throw new Error(
        "Endpoint must not contain credentials, query parameters or fragments. Use the API key environment variable.",
      );
  }
  const runModel = toggles.has("--run-model");
  if (runModel && !endpoint)
    throw new Error(
      "--run-model requires --endpoint or TWYNE_ROOM_ROUTING_ENDPOINT. No model was called.",
    );
  const model =
    values["--model"] ?? env.TWYNE_ROOM_ROUTING_MODEL ?? "jev-latest";
  if (!model.trim() || model.length > 200)
    throw new Error("Provide a model name of 1–200 characters.");
  return {
    runModel,
    ...(values["--case"] ? { caseId: values["--case"] } : {}),
    ...(endpoint ? { endpoint } : {}),
    model,
    timeoutMs,
    output: resolve(
      values["--output"] ??
        `artifacts/instrument-evals/room-routing/${new Date().toISOString().replaceAll(":", "-")}`,
    ),
    help: toggles.has("--help"),
  };
}
export function validateRoomRoutingCorpus(
  cases: readonly RoomRoutingCase[] = roomRoutingCases,
): InstrumentRoomPrepared[] {
  if (!cases.length || cases.length > 12)
    throw new Error("The authored corpus must contain 1–12 bounded cases.");
  const ids = new Set<string>();
  const allowed = new Set([...PERSONAS.map((persona) => persona.id), "none"]);
  return cases.map((fixture) => {
    if (!/^[a-z][a-z0-9-]*$/.test(fixture.id) || ids.has(fixture.id))
      throw new Error("Corpus case IDs must be unique stable labels.");
    ids.add(fixture.id);
    if (
      !fixture.acceptableEditorIds.length ||
      new Set(fixture.acceptableEditorIds).size !==
        fixture.acceptableEditorIds.length ||
      fixture.acceptableEditorIds.some((id) => !allowed.has(id))
    )
      throw new Error(
        `Invalid authored acceptable editor set for ${fixture.id}.`,
      );
    if (!fixture.expectation.trim())
      throw new Error(`Missing authored expectation for ${fixture.id}.`);
    return buildInstrumentRoomRequest(fixture.context, PERSONAS);
  });
}
export function roomRoutingFailureFlags(
  fixture: RoomRoutingCase,
  selection: InstrumentRoomSelection,
): string[] {
  if (selection.status !== "selected" && selection.status !== "none")
    return [`${fixture.id}:${selection.status}`];
  const selected = selection.status === "none" ? "none" : selection.personaId;
  if (selected && fixture.acceptableEditorIds.includes(selected)) return [];
  return [
    `${fixture.id}:outside-authored-acceptable-set`,
    ...(fixture.acceptableEditorIds.length === 1 &&
    fixture.acceptableEditorIds[0] === "none"
      ? [`${fixture.id}:none-required`]
      : []),
  ];
}
function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
function markdownCell(value: string): string {
  return value
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("`", "'");
}
export async function runRoomRouting(options: RoomRoutingOptions) {
  // Always validate the whole corpus, even when one exact case is selected.
  const requests = validateRoomRoutingCorpus();
  const selected = roomRoutingCases
    .map((fixture, index) => ({ fixture, request: requests[index] }))
    .filter(({ fixture }) => !options.caseId || fixture.id === options.caseId);
  if (!selected.length)
    throw new Error("No exact room-routing case was selected.");
  if (options.runModel && !options.endpoint)
    throw new Error("An explicit endpoint is required before model execution.");
  const key = process.env.TWYNE_ROOM_ROUTING_API_KEY?.trim();
  const safe = (value: string) =>
    key ? value.replaceAll(key, "[redacted]") : value;
  const flags: string[] = [];
  const results: Array<{
    id: string;
    instrument: string;
    acceptableEditorIds: string[];
    authoredExpectation: string;
    input: InstrumentRoomPrepared["input"];
    requestSha256: string;
    validation: "passed";
    modelRun: null | {
      status: InstrumentRoomSelection["status"];
      selectedEditorId: string | null;
      model: string | null;
      confidence: number | null;
      probabilities: Record<string, number> | null;
      requestMs: number;
      httpStatus: number | null;
      responseBytes: number | null;
      flags: string[];
      observedDistribution?: Array<{
        option: string;
        probability: number | null;
        valueType: string;
      }>;
      unexpectedOptionCount?: number;
    };
  }> = [];
  for (const { fixture, request } of selected) {
    const row: (typeof results)[number] = {
      id: fixture.id,
      instrument: fixture.context.instrument,
      acceptableEditorIds: fixture.acceptableEditorIds,
      authoredExpectation: fixture.expectation,
      input: request.input,
      requestSha256: sha(
        JSON.stringify({ model: options.model, ...request.input }),
      ),
      validation: "passed",
      modelRun: null,
    };
    // Environment configuration alone never opts into a network request.
    if (options.runModel) {
      const started = performance.now();
      let status: number | null = null,
        responseBytes: number | null = null;
      let selection: InstrumentRoomSelection;
      let observed:
        | {
            observedDistribution: Array<{
              option: string;
              probability: number | null;
              valueType: string;
            }>;
            unexpectedOptionCount: number;
          }
        | undefined;
      try {
        const response = await fetch(`${options.endpoint}/v1/systemone`, {
          method: "POST",
          signal: AbortSignal.timeout(options.timeoutMs),
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({ model: options.model, ...request.input }),
        });
        status = response.status;
        if (!response.ok)
          selection = readInstrumentRoomChoice(request, { ok: false });
        else {
          const body = await response.text();
          responseBytes = Buffer.byteLength(body);
          if (responseBytes > 256_000)
            throw new Error("oversized provider response");
          let raw: unknown;
          try {
            raw = JSON.parse(body);
          } catch {
            raw = null;
          }
          const data =
            raw && typeof raw === "object" && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : {};
          const answers =
            data.answers &&
            typeof data.answers === "object" &&
            !Array.isArray(data.answers)
              ? (data.answers as Record<string, unknown>)
              : {};
          selection = readInstrumentRoomChoice(request, {
            ok: true,
            ...(typeof data.model === "string"
              ? { model: safe(data.model).slice(0, 200) }
              : {}),
            answers,
          });
          if (selection.status === "malformed") {
            // Record all expected numeric entries without echoing provider prose or unknown keys (which could expose credentials).
            const editor =
              answers.editor && typeof answers.editor === "object"
                ? (answers.editor as Record<string, unknown>)
                : {};
            const values =
              editor.probabilities &&
              typeof editor.probabilities === "object" &&
              !Array.isArray(editor.probabilities)
                ? (editor.probabilities as Record<string, unknown>)
                : {};
            observed = {
              observedDistribution: request.choices.map((option) => ({
                option,
                probability:
                  typeof values[option] === "number" &&
                  Number.isFinite(values[option])
                    ? (values[option] as number)
                    : null,
                valueType:
                  values[option] === undefined
                    ? "missing"
                    : typeof values[option],
              })),
              unexpectedOptionCount: Object.keys(values).filter(
                (option) => !request.choices.includes(option),
              ).length,
            };
          }
        }
      } catch {
        selection = readInstrumentRoomChoice(request, { ok: false });
      }
      const failures = roomRoutingFailureFlags(fixture, selection);
      flags.push(...failures);
      row.modelRun = {
        status: selection.status,
        selectedEditorId:
          selection.status === "none" ? "none" : (selection.personaId ?? null),
        model: selection.model ?? null,
        confidence: selection.confidence ?? null,
        probabilities: selection.probabilities ?? null,
        requestMs: performance.now() - started,
        httpStatus: status,
        responseBytes,
        flags: failures,
        ...(observed ?? {}),
      };
    }
    results.push(row);
  }
  const dirtyStatus = git(["status", "--porcelain"]);
  const report = {
    schemaVersion: 1,
    mode: options.runModel
      ? "endpoint-model-routing"
      : "offline-corpus-validation",
    at: new Date().toISOString(),
    revision: git(["rev-parse", "HEAD"]),
    dirty: dirtyStatus === null ? null : !!dirtyStatus,
    corpusVersion: ROOM_ROUTING_CORPUS_VERSION,
    corpusSha256: sha(
      readFileSync(
        new URL("./room-routing-corpus.ts", import.meta.url),
        "utf8",
      ),
    ),
    sourceSha256: Object.fromEntries(
      [
        "evals/instruments/room-routing.ts",
        "src/utils/instrument-room.ts",
        "src/utils/personas.ts",
      ].map((path) => [path, sha(readFileSync(resolve(REPO, path), "utf8"))]),
    ),
    canonicalCastSha256: sha(JSON.stringify(PERSONAS)),
    canonicalCast: PERSONAS.map(({ id, name, role }) => ({ id, name, role })),
    endpoint: options.runModel ? options.endpoint : null,
    requestedModel: options.runModel ? options.model : null,
    timeoutMs: options.timeoutMs,
    caseFilter: options.caseId ?? null,
    proof: options.runModel
      ? "Actual endpoint selection responses against authored acceptable choices; not persona contribution quality or live-account proof."
      : "Offline fixture/request validation only. Jev semantic quality, model distributions and latency were not measured.",
    limitations: [
      "Expectations are authored for fictional passages, not universal truth or a calibrated benchmark.",
      "No comment generation, writer-model endpoint or account-backed pathway is invoked by this runner.",
    ],
    results,
    flags,
    modelQuality: options.runModel
      ? flags.length
        ? "authored-reference-flags"
        : "within-authored-acceptable-sets"
      : "not-run",
    reproduction: {
      command: `bun evals/instruments/room-routing.ts${options.runModel ? " --run-model --endpoint <chosen-endpoint> --model <chosen-model>" : ""}${options.caseId ? ` --case ${options.caseId}` : ""}`,
      credentialEnvironment:
        "TWYNE_ROOM_ROUTING_API_KEY (optional; never included in reports)",
      configuredEndpointEnvironment:
        "TWYNE_ROOM_ROUTING_ENDPOINT (still requires --run-model)",
    },
  };
  mkdirSync(options.output, { recursive: true });
  writeFileSync(
    resolve(options.output, "report.json"),
    safe(JSON.stringify(report, null, 2)) + "\n",
  );
  const markdown = [
    "# Authored editor-routing evaluation",
    "",
    report.proof,
    "",
    `Corpus: ${ROOM_ROUTING_CORPUS_VERSION}. Revision: ${report.revision ?? "unavailable"}; dirty: ${report.dirty ?? "unavailable"}.`,
    `Corpus SHA256: ${report.corpusSha256}.`,
    "",
    "| Case | Acceptable editor IDs (authored) | Selected | Model | Status | Request ms |",
    "| --- | --- | --- | --- | --- | ---: |",
    ...results.map(
      (row) =>
        `| ${row.id} | ${row.acceptableEditorIds.join(", ")} | ${row.modelRun?.selectedEditorId ?? "not run"} | ${markdownCell(row.modelRun?.model ?? "not run")} | ${row.modelRun?.status ?? "corpus valid; quality not run"} | ${row.modelRun?.requestMs.toFixed(2) ?? "not measured"} |`,
    ),
    "",
    ...results.flatMap((row) =>
      row.modelRun
        ? [
            `### ${row.id} · returned distribution`,
            "",
            `Reported model: ${markdownCell(row.modelRun.model ?? "not returned")}; confidence: ${row.modelRun.confidence ?? "not valid"}.`,
            "| Code option | Exact editor ID | Distribution weight |",
            "| --- | --- | ---: |",
            ...(row.modelRun.probabilities
              ? Object.entries(row.modelRun.probabilities).map(
                  ([option, probability]) => {
                    const editor =
                      option === "none"
                        ? "none"
                        : (PERSONAS[Number(option.replace("editor-", ""))]
                            ?.id ?? "unmapped");
                    return `| ${option} | ${editor} | ${probability} |`;
                  },
                )
              : ["| not valid | not selected | no valid full distribution |"]),
            "",
          ]
        : [],
    ),
    ...results.map((row) => `- ${row.id}: ${row.authoredExpectation}`),
    "",
    `Failure flags: ${flags.join(", ") || "none"}.`,
    "Full request inputs, validated distributions, confidence, response status, timings and source hashes are in report.json.",
    ...report.limitations,
    "",
  ].join("\n");
  writeFileSync(resolve(options.output, "report.md"), safe(markdown));
  console.log(
    `${results.length} authored cases validated; ${options.runModel ? `${flags.length} endpoint routing flags` : "model quality not run"}. Reports written.`,
  );
  return report;
}
if (import.meta.main) {
  try {
    const options = parseRoomRoutingOptions(process.argv.slice(2));
    if (options.help)
      console.log(
        "Usage: bun evals/instruments/room-routing.ts [--case exact-id] [--output directory]\nOptional explicit model run: --run-model --endpoint http(s)://host [--model name] [--timeout-ms 1000..120000]\nEndpoint may use TWYNE_ROOM_ROUTING_ENDPOINT. Credentials only TWYNE_ROOM_ROUTING_API_KEY. Default is offline corpus validation; no network calls.",
      );
    else {
      const report = await runRoomRouting(options);
      if (report.flags.length) process.exitCode = 1;
    }
  } catch (error) {
    // Only locally authored validation errors are exposed, never provider bodies or credential values.
    console.error(
      error instanceof Error
        ? error.message
        : "Room routing evaluation could not finish.",
    );
    process.exitCode = 1;
  }
}
