/** Bounded filesystem reads for declared input/staging roots. No symlink or
 * special-file leaf is opened. Relative paths are portable/canonical; each child
 * directory is checked before open, and the opened file identity is compared
 * with lstat. This is not a general adversarial-filesystem sandbox/openat API. */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, resolve } from "node:path";

export class PackagingPathError extends Error {
  constructor(
    public code: "unsafe-path" | "unsafe-file" | "size-limit",
    message: string,
  ) {
    super(message);
  }
}

export function safeRelative(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /[\\:<>"|?*\u0000-\u001f\u007f]/.test(value) ||
    posix.normalize(value) !== value
  ) {
    throw new PackagingPathError(
      "unsafe-path",
      "Expected a canonical portable relative file path.",
    );
  }
  if (Buffer.byteLength(value) > 1024 || value.split("/").length > 32)
    throw new PackagingPathError(
      "unsafe-path",
      "Relative file path exceeds the portable depth/length limit.",
    );
  for (const part of value.split("/")) {
    if (
      !part ||
      Buffer.byteLength(part) > 255 ||
      part === "." ||
      part === ".." ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    ) {
      throw new PackagingPathError(
        "unsafe-path",
        "Relative file paths cannot traverse or use reserved components.",
      );
    }
  }
  return value;
}

export function safeName(value: unknown): string {
  const name = safeRelative(value);
  if (name.includes("/"))
    throw new PackagingPathError(
      "unsafe-path",
      "Executable names must be a single path component.",
    );
  return name;
}

export async function canonicalDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  const before = await lstat(absolute);
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new PackagingPathError(
      "unsafe-file",
      "Expected a real directory, not a symlink or special file.",
    );
  // Canonicalize aliases above the declared root (e.g. macOS /tmp); symlinks
  // inside that root are still forbidden.
  return realpath(absolute);
}

export async function checkedChild(
  root: string,
  relative: string,
  kind: "file" | "directory",
): Promise<string> {
  const parts = safeRelative(relative).split("/");
  let path = root;
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const info = await lstat(path);
    const last = index === parts.length - 1;
    if (
      info.isSymbolicLink() ||
      (last && kind === "file" ? !info.isFile() : !info.isDirectory())
    ) {
      throw new PackagingPathError(
        "unsafe-file",
        `Unsupported filesystem entry at ${relative}.`,
      );
    }
  }
  return path;
}

export interface RegularBytes {
  bytes: Buffer;
  mode: number;
}

export async function readRegular(
  root: string,
  relative: string,
  maxBytes = 1024 * 1024 * 1024,
): Promise<RegularBytes> {
  const path = await checkedChild(root, relative, "file");
  const before = await lstat(path);
  if (before.size > maxBytes)
    throw new PackagingPathError(
      "size-limit",
      `Input exceeds its bounded read limit: ${relative}.`,
    );
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs
    ) {
      throw new PackagingPathError(
        "unsafe-file",
        `Input changed while opening: ${relative}.`,
      );
    }
    const bytes = Buffer.allocUnsafe(opened.size);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(
        bytes,
        count,
        Math.min(bytes.length - count, 1024 * 1024),
        count,
      );
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    const tail = await handle.read(Buffer.alloc(1), 0, 1, opened.size);
    const after = await handle.stat();
    const current = await lstat(await checkedChild(root, relative, "file"));
    if (
      count !== bytes.length ||
      tail.bytesRead !== 0 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      after.mode !== opened.mode ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.size !== opened.size ||
      current.mtimeMs !== opened.mtimeMs ||
      current.mode !== opened.mode
    ) {
      throw new PackagingPathError(
        "unsafe-file",
        `Input changed while reading: ${relative}.`,
      );
    }
    return { bytes, mode: opened.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

export async function readRegularPath(
  path: string,
  maxBytes?: number,
): Promise<RegularBytes> {
  return readRegular(
    await canonicalDirectory(dirname(resolve(path))),
    safeName(basename(path)),
    maxBytes,
  );
}

/** No deletion or replacement is allowed, including an empty dir or dangling
 * symlink. Caller must use exclusive mkdir again immediately before writing. */
export async function freshDestination(path: string): Promise<string> {
  const absolute = resolve(path);
  const parent = await canonicalDirectory(dirname(absolute));
  const destination = join(parent, safeName(basename(absolute)));
  try {
    await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return destination;
    throw error;
  }
  throw new Error(
    "The distribution destination already exists. Choose a fresh path; existing data is never removed.",
  );
}
