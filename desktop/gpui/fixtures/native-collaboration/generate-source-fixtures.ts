import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReference } from "./source-functions";
const reference = await buildReference();
const path = resolve(import.meta.dir, "source-reference.json");
writeFileSync(path, JSON.stringify(reference, null, 2) + "\n");
console.log(`Recorded original Source observations at ${path}`);
