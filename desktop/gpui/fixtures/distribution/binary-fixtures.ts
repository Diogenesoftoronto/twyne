/** Loader-table fixtures, NOT runnable executables. All three formats are
 * constructed on any host without a compiler, subprocess or binary execution. */
import type { Platform } from "../../packaging/stage";

export function loaderFixture(platform: Platform, arm64 = false): Buffer {
  const bytes = Buffer.alloc(1024);
  if (platform === "linux") {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    bytes.writeUInt16LE(3, 16); // ET_DYN (PIE-like table only).
    bytes.writeUInt16LE(arm64 ? 0xb7 : 0x3e, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeBigUInt64LE(64n, 32);
    bytes.writeUInt16LE(64, 52);
    bytes.writeUInt16LE(56, 54);
    bytes.writeUInt16LE(3, 56);
    // PT_LOAD covers the string and dynamic tables.
    bytes.writeUInt32LE(1, 64);
    bytes.writeBigUInt64LE(0x400000n, 80);
    bytes.writeBigUInt64LE(1024n, 96);
    // PT_INTERP.
    bytes.writeUInt32LE(3, 120);
    bytes.writeBigUInt64LE(256n, 128);
    bytes.writeBigUInt64LE(28n, 152);
    bytes.write("/lib/fixture-loader.so\0", 256);
    // PT_DYNAMIC, DT_STRTAB, DT_NEEDED, DT_RUNPATH, DT_NULL.
    bytes.writeUInt32LE(2, 176);
    bytes.writeBigUInt64LE(512n, 184);
    bytes.writeBigUInt64LE(64n, 208);
    bytes.writeBigUInt64LE(5n, 512);
    bytes.writeBigUInt64LE(0x400300n, 520);
    bytes.writeBigUInt64LE(1n, 528);
    bytes.writeBigUInt64LE(0n, 536);
    bytes.writeBigUInt64LE(29n, 544);
    bytes.writeBigUInt64LE(10n, 552);
    bytes.write("libc.so.6\0", 768);
    bytes.write("$ORIGIN/lib\0", 778);
  } else if (platform === "macos") {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(arm64 ? 0x0100000c : 0x01000007, 4);
    bytes.writeUInt32LE(2, 12); // MH_EXECUTE table only.
    bytes.writeUInt32LE(3, 16);
    bytes.writeUInt32LE(192, 20);
    for (const [offset, command, value] of [
      [32, 0x0c, "/usr/lib/libSystem.B.dylib"],
      [96, 0x0e, "/usr/lib/dyld"],
      [160, 0x8000001c, "@executable_path/lib"],
    ] as const) {
      bytes.writeUInt32LE(command, offset);
      bytes.writeUInt32LE(64, offset + 4);
      bytes.writeUInt32LE(24, offset + 8);
      bytes.write(`${value}\0`, offset + 24);
    }
  } else {
    bytes.write("MZ", 0);
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write("PE\0\0", 0x80);
    bytes.writeUInt16LE(arm64 ? 0xaa64 : 0x8664, 0x84);
    bytes.writeUInt16LE(1, 0x86); // One .rdata section.
    bytes.writeUInt16LE(240, 0x94);
    bytes.writeUInt16LE(0x22, 0x96);
    bytes.writeUInt16LE(0x20b, 0x98);
    bytes.writeUInt32LE(16, 0x98 + 108);
    bytes.writeUInt32LE(0x1000, 0x98 + 120);
    const section = 0x98 + 240;
    bytes.write(".rdata", section);
    bytes.writeUInt32LE(256, section + 8);
    bytes.writeUInt32LE(0x1000, section + 12);
    bytes.writeUInt32LE(256, section + 16);
    bytes.writeUInt32LE(512, section + 20);
    bytes.writeUInt32LE(0x1080, 512 + 12);
    bytes.writeUInt32LE(0x1090, 512 + 16);
    bytes.write("KERNEL32.dll\0", 640);
  }
  return bytes;
}
