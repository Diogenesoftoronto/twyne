//! Self-contained dynamic-dependency reader for ELF, Mach-O and PE binaries.
//!
//! Packaging verification must be deterministic and offline, so this module
//! parses the loader metadata itself instead of shelling out to `ldd`,
//! `otool`, or `dumpbin`. It reads only headers and the loader tables; it does
//! not execute the binary and does not follow symlinks or load libraries.

export type BinaryFormat = "elf" | "macho" | "pe" | "unknown";

export interface BinaryDependencies {
  format: BinaryFormat;
  /** Dynamic libraries the loader must resolve (DT_NEEDED / LC_LOAD_DYLIB / import table). */
  libraries: string[];
  /** ELF PT_INTERP or Mach-O LC_LOAD_DYLINKER; empty when none is declared. */
  interpreter: string | null;
  /** ELF DT_RPATH/DT_RUNPATH or Mach-O LC_RPATH search paths. */
  runpaths: string[];
  /** Architecture string when it could be determined. */
  architecture: string | null;
}

const EMPTY: BinaryDependencies = {
  format: "unknown",
  libraries: [],
  interpreter: null,
  runpaths: [],
  architecture: null,
};

function u16(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 2 > bytes.length) throw new RangeError("truncated u16");
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 4 > bytes.length) throw new RangeError("truncated u32");
  return little
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
        0
    : ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
        0;
}

function u64(bytes: Uint8Array, offset: number, little: boolean): bigint {
  const low = BigInt(u32(bytes, offset, little));
  const high = BigInt(u32(bytes, offset + 4, little));
  return little ? (high << 32n) | low : (low << 32n) | high;
}

function cString(bytes: Uint8Array, offset: number, limit = 4096): string {
  if (offset < 0 || offset >= bytes.length) return "";
  const end = Math.min(bytes.length, offset + limit);
  let cursor = offset;
  while (cursor < end && bytes[cursor] !== 0) cursor += 1;
  return new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(offset, cursor),
  );
}

const ELF_MACHINES: Record<number, string> = {
  0x03: "i386",
  0x28: "arm",
  0x3e: "x86_64",
  0xb7: "aarch64",
  0xf3: "riscv",
};

function parseElf(bytes: Uint8Array): BinaryDependencies {
  const little = bytes[5] === 1;
  const is64 = bytes[4] === 2;
  const machine = u16(bytes, 18, little);
  const phoff = is64 ? Number(u64(bytes, 32, little)) : u32(bytes, 28, little);
  const phentsize = u16(bytes, is64 ? 54 : 42, little);
  const phnum = u16(bytes, is64 ? 56 : 44, little);
  const libraries: string[] = [];
  const runpaths: string[] = [];
  let interpreter: string | null = null;

  interface Segment {
    vaddr: number;
    offset: number;
    filesz: number;
  }
  const segments: Segment[] = [];
  let dynamicOffset = -1;
  let dynamicSize = 0;

  for (let index = 0; index < phnum; index += 1) {
    const base = phoff + index * phentsize;
    if (base + phentsize > bytes.length) break;
    const type = u32(bytes, base, little);
    if (is64) {
      const offset = Number(u64(bytes, base + 8, little));
      const vaddr = Number(u64(bytes, base + 16, little));
      const filesz = Number(u64(bytes, base + 32, little));
      if (type === 1) segments.push({ vaddr, offset, filesz });
      if (type === 2) {
        dynamicOffset = offset;
        dynamicSize = filesz;
      }
      if (type === 3) interpreter = cString(bytes, offset).trim() || null;
    } else {
      const offset = u32(bytes, base + 4, little);
      const vaddr = u32(bytes, base + 8, little);
      const filesz = u32(bytes, base + 16, little);
      if (type === 1) segments.push({ vaddr, offset, filesz });
      if (type === 2) {
        dynamicOffset = offset;
        dynamicSize = filesz;
      }
      if (type === 3) interpreter = cString(bytes, offset).trim() || null;
    }
  }

  const vaddrToOffset = (address: number): number => {
    for (const segment of segments) {
      if (
        address >= segment.vaddr &&
        address < segment.vaddr + segment.filesz
      ) {
        return segment.offset + (address - segment.vaddr);
      }
    }
    return -1;
  };

  if (dynamicOffset >= 0) {
    const entrySize = is64 ? 16 : 8;
    const count = Math.floor(dynamicSize / entrySize);
    let stringTable = -1;
    const neededOffsets: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const base = dynamicOffset + index * entrySize;
      if (base + entrySize > bytes.length) break;
      const tag = is64
        ? Number(u64(bytes, base, little))
        : u32(bytes, base, little);
      const value = is64
        ? Number(u64(bytes, base + 8, little))
        : u32(bytes, base + 4, little);
      if (tag === 0) break;
      if (tag === 1) neededOffsets.push(value);
      if (tag === 5) stringTable = vaddrToOffset(value);
    }
    if (stringTable >= 0) {
      const resolvedRunpaths: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const base = dynamicOffset + index * entrySize;
        if (base + entrySize > bytes.length) break;
        const tag = is64
          ? Number(u64(bytes, base, little))
          : u32(bytes, base, little);
        if (tag === 0) break;
        if (tag === 15 || tag === 29) {
          const value = is64
            ? Number(u64(bytes, base + 8, little))
            : u32(bytes, base + 4, little);
          resolvedRunpaths.push(
            ...cString(bytes, stringTable + value)
              .split(":")
              .filter(Boolean),
          );
        }
      }
      for (const offset of neededOffsets) {
        const name = cString(bytes, stringTable + offset);
        if (name) libraries.push(name);
      }
      runpaths.length = 0;
      runpaths.push(...resolvedRunpaths);
    }
  }

  return {
    format: "elf",
    libraries,
    interpreter,
    runpaths,
    architecture: ELF_MACHINES[machine] ?? null,
  };
}

const MACHO_CPUS: Record<number, string> = {
  0x01000007: "x86_64",
  0x0100000c: "aarch64",
  0x00000007: "i386",
  0x0000000c: "arm",
};

function parseMachOAt(
  bytes: Uint8Array,
  base: number,
): BinaryDependencies | null {
  const magic = u32(bytes, base, true);
  const is64 = magic === 0xfeedfacf;
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return null;
  const cputype = u32(bytes, base + 4, true);
  const ncmds = u32(bytes, base + 16, true);
  const headerSize = is64 ? 32 : 28;
  let cursor = base + headerSize;
  const libraries: string[] = [];
  const runpaths: string[] = [];
  let interpreter: string | null = null;

  for (let index = 0; index < ncmds; index += 1) {
    if (cursor + 8 > bytes.length) break;
    const cmd = u32(bytes, cursor, true);
    const cmdsize = u32(bytes, cursor + 4, true);
    if (cmdsize < 8 || cursor + cmdsize > bytes.length) break;
    const isLoadDylib = cmd === 0xc || cmd === 0x18 || cmd === 0x1f;
    const isRpath = (cmd & 0x7fffffff) === 0x1c && (cmd & 0x80000000) !== 0;
    if (isLoadDylib) {
      const nameOffset = u32(bytes, cursor + 8, true);
      const name = cString(bytes, cursor + nameOffset, 1024);
      if (name) libraries.push(name);
    } else if (isRpath) {
      const pathOffset = u32(bytes, cursor + 8, true);
      const path = cString(bytes, cursor + pathOffset, 1024);
      if (path) runpaths.push(path);
    } else if (cmd === 0xe) {
      const nameOffset = u32(bytes, cursor + 8, true);
      interpreter = cString(bytes, cursor + nameOffset, 1024) || null;
    }
    cursor += cmdsize;
  }

  return {
    format: "macho",
    libraries,
    interpreter,
    runpaths,
    architecture: MACHO_CPUS[cputype] ?? null,
  };
}

function parseMachO(bytes: Uint8Array): BinaryDependencies | null {
  const fatMagic = u32(bytes, 0, false);
  if (fatMagic === 0xcafebabe) {
    const count = u32(bytes, 4, false);
    const slices: BinaryDependencies[] = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 8 + index * 20;
      const offset = u32(bytes, entry + 8, false);
      const slice = parseMachOAt(bytes, offset);
      if (slice) slices.push(slice);
    }
    if (slices.length === 0) return null;
    return {
      format: "macho",
      libraries: [
        ...new Set(slices.flatMap((slice) => slice.libraries)),
      ].sort(),
      interpreter: slices[0].interpreter,
      runpaths: [...new Set(slices.flatMap((slice) => slice.runpaths))].sort(),
      architecture: slices.map((slice) => slice.architecture).join("+") || null,
    };
  }
  return parseMachOAt(bytes, 0);
}

function parsePe(bytes: Uint8Array): BinaryDependencies | null {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a)
    return null;
  const peOffset = u32(bytes, 0x3c, true);
  if (peOffset + 24 > bytes.length) return null;
  if (
    bytes[peOffset] !== 0x50 ||
    bytes[peOffset + 1] !== 0x45 ||
    bytes[peOffset + 2] !== 0 ||
    bytes[peOffset + 3] !== 0
  ) {
    return null;
  }
  const machine = u16(bytes, peOffset + 4, true);
  const optionalOffset = peOffset + 24;
  const optionalMagic = u16(bytes, optionalOffset, true);
  const is64 = optionalMagic === 0x20b;
  if (!is64 && optionalMagic !== 0x10b) return null;
  const dataDirectoryOffset = optionalOffset + (is64 ? 112 : 96);
  const importRva = u32(bytes, dataDirectoryOffset + 8, true);

  const sectionCount = u16(bytes, peOffset + 6, true);
  const sectionOffset = optionalOffset + u16(bytes, peOffset + 20, true);
  interface Section {
    vaddr: number;
    vsize: number;
    raw: number;
    rawSize: number;
  }
  const sections: Section[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const base = sectionOffset + index * 40;
    if (base + 40 > bytes.length) break;
    sections.push({
      vsize: u32(bytes, base + 8, true),
      vaddr: u32(bytes, base + 12, true),
      rawSize: u32(bytes, base + 16, true),
      raw: u32(bytes, base + 20, true),
    });
  }
  const rvaToOffset = (rva: number): number => {
    for (const section of sections) {
      const size = Math.max(section.vsize, section.rawSize);
      if (rva >= section.vaddr && rva < section.vaddr + size) {
        return section.raw + (rva - section.vaddr);
      }
    }
    return -1;
  };

  const libraries: string[] = [];
  if (importRva > 0) {
    const descriptorOffset = rvaToOffset(importRva);
    if (descriptorOffset >= 0) {
      for (let index = 0; index < 512; index += 1) {
        const base = descriptorOffset + index * 20;
        if (base + 20 > bytes.length) break;
        const nameRva = u32(bytes, base + 12, true);
        const firstThunk = u32(bytes, base + 16, true);
        if (nameRva === 0 && firstThunk === 0) break;
        const nameOffset = rvaToOffset(nameRva);
        if (nameOffset < 0) break;
        const name = cString(bytes, nameOffset, 260);
        if (name) libraries.push(name);
      }
    }
  }

  const architectures: Record<number, string> = {
    0x014c: "i386",
    0x8664: "x86_64",
    0xaa64: "aarch64",
  };

  return {
    format: "pe",
    libraries,
    interpreter: null,
    runpaths: [],
    architecture: architectures[machine] ?? null,
  };
}

/** Detect and parse a binary's loader metadata without executing it. */
export function readBinaryDependencies(bytes: Uint8Array): BinaryDependencies {
  try {
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x7f &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x4c &&
      bytes[3] === 0x46
    ) {
      return parseElf(bytes);
    }
    if (bytes.length >= 4) {
      const macho = parseMachO(bytes);
      if (macho) return macho;
    }
    const pe = parsePe(bytes);
    if (pe) return pe;
  } catch {
    return { ...EMPTY };
  }
  return { ...EMPTY };
}
