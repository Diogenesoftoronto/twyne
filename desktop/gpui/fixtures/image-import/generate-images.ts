// Technical codec fixtures only; these are not application artwork.
import sharp from "sharp";
import { deflateSync } from "node:zlib";

const first = Buffer.from([
  193, 39, 45, 255, 244, 236, 216, 255, 31, 27, 22, 255, 52, 88, 124, 255, 123,
  140, 97, 255, 183, 146, 62, 255,
]);
const second = Buffer.from([
  31, 27, 22, 255, 193, 39, 45, 255, 244, 236, 216, 255, 183, 146, 62, 255, 52,
  88, 124, 255, 123, 140, 97, 255,
]);
const still = () => sharp(first, { raw: { width: 3, height: 2, channels: 4 } });
const animated = () =>
  sharp(Buffer.concat([first, second]), {
    raw: { width: 3, height: 4, channels: 4, pageHeight: 2 },
  });
await still()
  .png()
  .toFile(new URL("plate.png", import.meta.url).pathname);
await still()
  .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
  .toFile(new URL("plate.jpg", import.meta.url).pathname);
await still()
  .withMetadata({ orientation: 6 })
  .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
  .toFile(new URL("rotated.jpg", import.meta.url).pathname);
await still()
  .gif()
  .toFile(new URL("plate.gif", import.meta.url).pathname);
await still()
  .webp({ lossless: true })
  .toFile(new URL("plate.webp", import.meta.url).pathname);
await animated()
  .gif({ loop: 0, delay: [20, 20] })
  .toFile(new URL("animated.gif", import.meta.url).pathname);
await animated()
  .webp({ lossless: true, loop: 0, delay: [20, 20] })
  .toFile(new URL("animated.webp", import.meta.url).pathname);

// Tiny complete APNG, checked by both the real browser and pinned Rust decoder.
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, bytes: Buffer): Buffer {
  const name = Buffer.from(kind, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([header, name, bytes, crc]);
}
function frameControl(sequence: number): Buffer {
  const bytes = Buffer.alloc(26);
  bytes.writeUInt32BE(sequence, 0);
  bytes.writeUInt32BE(3, 4);
  bytes.writeUInt32BE(2, 8);
  bytes.writeUInt16BE(1, 20);
  bytes.writeUInt16BE(50, 22);
  return bytes;
}
function scanlines(pixels: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0]),
    pixels.subarray(0, 12),
    Buffer.from([0]),
    pixels.subarray(12),
  ]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(3, 0);
header.writeUInt32BE(2, 4);
header[8] = 8;
header[9] = 6;
const control = Buffer.alloc(8);
control.writeUInt32BE(2, 0);
const frameData = Buffer.alloc(4);
frameData.writeUInt32BE(2);
const apng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("acTL", control),
  chunk("fcTL", frameControl(0)),
  chunk("IDAT", deflateSync(scanlines(first))),
  chunk("fcTL", frameControl(1)),
  chunk("fdAT", Buffer.concat([frameData, deflateSync(scanlines(second))])),
  chunk("IEND", Buffer.alloc(0)),
]);
await Bun.write(new URL("animated.png", import.meta.url), apng);
console.log(
  "Generated eight tiny codec fixtures, including EXIF and animated GIF/WebP/APNG.",
);
