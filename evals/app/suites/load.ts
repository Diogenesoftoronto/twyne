import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EVALS = fileURLToPath(new URL("../../", import.meta.url));

/** Read a JSON Lines corpus relative to `evals/`. Blank lines are skipped. */
export function readJsonl<T>(relative: string): T[] {
  const path = `${EVALS}${relative}`;
  if (!existsSync(path))
    throw new Error(`Missing eval corpus: evals/${relative}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new Error(`evals/${relative}:${index + 1} is not valid JSON`);
      }
    });
}
