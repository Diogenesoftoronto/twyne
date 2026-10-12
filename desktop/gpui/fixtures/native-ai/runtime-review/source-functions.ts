import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import * as parsing from "../../../../../src/utils/llm-parsing";
import { stripReasoningTags } from "../../../../../src/utils/reasoning-tags";

export const root = resolve(import.meta.dir, "../../../../..");
export const sourcePaths = [
  "src/utils/ai-client.ts", "src/types/index.ts", "src/utils/llm-parsing.ts",
  "src/utils/research-targets.ts", "src/utils/reasoning-tags.ts", "desktop/litert-server.ts",
];
export function sourceHashes() {
  return Object.fromEntries(sourcePaths.map(path => [path,
    createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")]));
}

// Select unchanged Source declarations with the TS parser. Removing export is
// the only declaration change; no SDK/provider module is evaluated. Explicit
// dependency substitutions below are the proof boundary, not production mocks.
function declarations(path: string, names: string[]) {
  const source = readFileSync(resolve(root, path), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = new Map<string, string>();
  for (const node of file.statements) {
    const keys = ts.isFunctionDeclaration(node) && node.name ? [node.name.text]
      : ts.isVariableStatement(node) ? node.declarationList.declarations
        .filter(decl => ts.isIdentifier(decl.name)).map(decl => decl.name.getText(file)) : [];
    for (const name of keys) if (names.includes(name)) {
      selected.set(name, node.getText(file).replace(/^export\s+/, ""));
    }
  }
  for (const name of names) if (!selected.has(name)) throw Error(`Missing Source declaration ${name}`);
  return [...new Set(names.map(name => selected.get(name)))].join("\n");
}
function execute(source: string, bindings: Record<string, unknown>, returns: string[]) {
  const js = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(source);
  return new Function(...Object.keys(bindings), `${js}\nreturn {${returns.join(",")}};`)(...Object.values(bindings));
}

export const contracts = parsing;
export const research = execute(declarations("src/utils/research-targets.ts", [
  "normalizeKind", "hashToken", "collectList", "parseResearchTargets",
]), { stripReasoningTags, stripJsonFences: parsing.stripJsonFences,
  extractFirstJsonObject: parsing.extractFirstJsonObject, MAX_ANCHOR_CHARS: 200 }, ["parseResearchTargets"]);

const routeFunctions = [
  "isOpenAiCompatibleProvider", "TINKER_HOST", "isTinkerProviderConfig", "isVoiceOnlyProvider",
  "VOICE_FEATURES", "VOICE_ASR_PROVIDERS", "supportsVoiceFeature", "providerSupportsFeature",
  "resolveFeatureConfig", "resolveFeatureConfigForPersona", "hasConfiguredAiProvider",
  "hasConfiguredVoiceProvider", "modelAcceptsDirectAudio", "defaultModelForFeature",
  "defaultTemperature", "defaultMaxTokens",
];
export const routing = execute(
  declarations("src/types/index.ts", ["VOICE_ONLY_PROVIDER_TYPES"]) + "\n" +
  declarations("src/utils/ai-client.ts", routeFunctions), {
    // Only already-normalized fixtures: managed provider injection/stripping is
    // explicitly not part of this corpus or native DTO.
    normalizeAiSettings: (settings: unknown) => settings,
  }, ["resolveFeatureConfig", "resolveFeatureConfigForPersona", "hasConfiguredAiProvider", "hasConfiguredVoiceProvider"]);

export type LifecycleCase = {
  name: string; flag?: string; missing?: boolean; registered?: boolean;
  registryExit?: number; importExit?: number; throwStage?: "list" | "import" | "serve";
  readiness?: "ready" | "exited" | "timeout" | "listener-before-exit";
};
export async function runLifecycle(input: LifecycleCase) {
  const calls: Array<{cmd: string[]; stdout: string; stderr: string}> = [];
  let clock = 0, kills = 0, checks = 0;
  const source = declarations("desktop/litert-server.ts", [
    "STARTUP_TIMEOUT_MS", "STARTUP_POLL_MS", "LOCAL_MODEL_ID", "enabled", "serverBinPath",
    "modelPath", "waitForServerReady", "modelIsRegistered", "importModel", "startLocalAiServer",
  ]);
  const api = execute(source, {
    process: { env: { TWYNE_DESKTOP_LOCAL_AI: input.flag,
      LITERT_LM_STARTUP_TIMEOUT_MS: "300", LITERT_LM_BIN: "fixture-bin", LOCAL_MODEL_PATH: "fixture-model" } },
    resolve, existsSync: () => !input.missing, freePort: async () => 45123,
    isPortAcceptingConnections: async () => { checks++; return input.readiness === "ready" || input.readiness === "listener-before-exit"; },
    Date: { now: () => clock }, Bun: { sleep: async (ms: number) => { clock += ms; await Promise.resolve(); } },
    console: { log() {}, warn() {}, error() {} }, Response,
    spawn: (options: {cmd: string[]; stdout: string; stderr: string}) => {
      calls.push(options);
      const stage = options.cmd[1];
      if (input.throwStage === stage) throw Error("synthetic child failure");
      const exit = stage === "list" ? input.registryExit ?? 0 : stage === "import" ? input.importExit ?? 0 : 1;
      return {
        stdout: stage === "list" ? new Blob([input.registered ? "other\nminicpm5-2b\n" : "minicpm5-2b-suffix"]).stream() : null,
        exited: stage !== "serve" || input.readiness === "exited" || input.readiness === "listener-before-exit"
          ? Promise.resolve(exit) : new Promise(() => {}),
        kill: () => { kills++; },
      };
    },
  }, ["startLocalAiServer"]);
  const server = await api.startLocalAiServer();
  const ready = server !== null;
  if (server) server.stop();
  return { name: input.name, ready, port: server?.port ?? null, checks, kills,
    calls: calls.map(call => ({stage: call.cmd[1], args: call.cmd.slice(2).map(value =>
      value === resolve("fixture-model") ? "<fixture-model>" : value), stdout: call.stdout, stderr: call.stderr})) };
}
