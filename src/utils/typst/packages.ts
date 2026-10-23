import { FetchPackageRegistry } from "@myriaddreamin/typst.ts/fs/package";
import type { PackageSpec } from "@myriaddreamin/typst.ts/internal.types";

/** Typst Universe packages, the same index `typst compile` resolves `@preview/…` from. */
export const TYPST_UNIVERSE = "https://packages.typst.org/preview";
const CACHE = "twyne-typst-packages-v1";
const MAX_PACKAGES = 48;
const MAX_ARCHIVE = 24_000_000;
const IMPORT = /@preview\/([a-z0-9][a-z0-9-]*):(\d+\.\d+\.\d+)/g;

export interface TypstPackage {
  name: string;
  version: string;
}
const key = ({ name, version }: TypstPackage) => `${name}:${version}`;

/** Every `@preview/name:version` the text names, in order, without duplicates. */
export function typstPackageImports(text: string): TypstPackage[] {
  const found = new Map<string, TypstPackage>();
  for (const [, name, version] of text.matchAll(IMPORT))
    found.set(`${name}:${version}`, { name, version });
  return [...found.values()];
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Text of the package's Typst and manifest files; enough to find its own imports. */
function tarTexts(tar: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const field = (at: number, length: number) =>
    decoder.decode(tar.subarray(at, at + length)).replace(/\0[\s\S]*$/, "");
  const texts: string[] = [];
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = field(at, 100);
    if (!name) break;
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = field(at + 156, 1);
    const body = at + 512;
    if ((type === "0" || type === "") && /\.(typ|toml)$/.test(name))
      texts.push(decoder.decode(tar.subarray(body, body + size)));
    at = body + Math.ceil(size / 512) * 512;
  }
  return texts;
}

async function archive(pkg: TypstPackage): Promise<Uint8Array | undefined> {
  const url = `${TYPST_UNIVERSE}/${pkg.name}-${pkg.version}.tar.gz`;
  // Published versions never change, so a stored archive is always current.
  const cache =
    typeof caches === "undefined"
      ? undefined
      : await caches.open(CACHE).catch(() => undefined);
  const stored = await cache?.match(url);
  if (stored) return new Uint8Array(await stored.arrayBuffer());
  const response = await fetch(url).catch(() => undefined);
  if (!response?.ok) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE) return undefined;
  await cache
    ?.put(
      url,
      new Response(bytes as BlobPart, {
        headers: { "content-type": "application/gzip" },
      }),
    )
    .catch(() => undefined);
  return bytes;
}

/**
 * Download the packages a source imports, and the packages those import,
 * before compilation. The compiler resolves imports synchronously, so the
 * work it would otherwise block on happens here, once, and is kept offline.
 */
export async function prefetchTypstPackages(
  source: string,
  onProgress?: (message: string) => void,
): Promise<Map<string, Uint8Array>> {
  const archives = new Map<string, Uint8Array>();
  const queue = typstPackageImports(source);
  const seen = new Set(queue.map(key));
  while (queue.length && archives.size < MAX_PACKAGES) {
    const pkg = queue.shift()!;
    onProgress?.(`Loading package ${pkg.name} ${pkg.version}…`);
    const bytes = await archive(pkg);
    if (!bytes) continue;
    archives.set(key(pkg), bytes);
    try {
      for (const dependency of typstPackageImports(
        tarTexts(await gunzip(bytes)).join("\n"),
      )) {
        if (seen.has(key(dependency))) continue;
        seen.add(key(dependency));
        queue.push(dependency);
      }
    } catch {
      // A malformed archive still goes to the compiler, which reports it precisely.
    }
  }
  return archives;
}

/** Serves prefetched archives; anything else falls back to a direct download. */
export class TwynePackageRegistry extends FetchPackageRegistry {
  archives = new Map<string, Uint8Array>();
  override pullPackageData(spec: PackageSpec): Uint8Array | undefined {
    return this.archives.get(key(spec)) ?? super.pullPackageData(spec);
  }
}

/** The bundled typesetter; packages needing a newer Typst cannot compile here. */
export const TYPST_COMPILER_VERSION = "0.14.2";

export interface TypstPackageListing extends TypstPackage {
  description: string;
}

const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

let index: Promise<TypstPackageListing[]> | undefined;
/** The newest version of each Universe package this typesetter can compile. */
export function loadTypstPackageIndex(): Promise<TypstPackageListing[]> {
  index ??= (async () => {
    const response = await fetch(`${TYPST_UNIVERSE}/index.json`);
    if (!response.ok) throw new Error("Typst Universe is unavailable.");
    const entries = (await response.json()) as {
      name: string;
      version: string;
      description?: string;
      compiler?: string;
    }[];
    const latest = new Map<string, TypstPackageListing>();
    for (const entry of entries) {
      if (entry.compiler && newer(entry.compiler, TYPST_COMPILER_VERSION))
        continue;
      const known = latest.get(entry.name);
      if (!known || newer(entry.version, known.version))
        latest.set(entry.name, {
          name: entry.name,
          version: entry.version,
          description: entry.description ?? "",
        });
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  })().catch((error) => {
    index = undefined;
    throw error;
  });
  return index;
}
