/** Stdin/stdout transport for Python; no HTTP listener and no secrets in arguments. */
import { readFileSync } from "node:fs";
import { createEvalClient, evalConfiguration } from "./llm-client";

try {
  evalConfiguration();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({ ok: true }));
  } else {
    const input: unknown = JSON.parse(readFileSync(0, "utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Chat object required");
    const content = await createEvalClient()(
      input as Record<string, unknown>,
      AbortSignal.timeout(180_000),
    );
    console.log(JSON.stringify({ content }));
  }
} catch {
  // This process receives signing keys via environment. Do not relay raw errors.
  console.error(
    "Not Organic optimizer request failed; check configuration, account access, and gateway status.",
  );
  process.exitCode = 1;
}
