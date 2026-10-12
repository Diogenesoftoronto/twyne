#!/usr/bin/env bun
/**
 * Copies the existing Twyne product assets into the native package, renders
 * semantic icons with the same source function as the web app, and emits a
 * dependency-free Rust embed catalog. Run from any directory:
 *
 *   bun desktop/gpui/tools/sync-assets.ts
 *   bun desktop/gpui/tools/sync-assets.ts --check
 *
 * ImageMagick is needed only when an AVIF source changes. GPUI's image build
 * decodes WebP, but does not enable AVIF; codec copies use lossless WebP with
 * exact RGBA verification. Originals remain in the source tree unchanged.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderTwyneIconSvg,
  type TwyneIconName,
} from "../../../src/utils/icon-system";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(nativeRoot, "../..");
const assetRoot = join(nativeRoot, "assets");
const check = process.argv.includes("--check");
const failures: string[] = [];
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

interface AssetRecord {
  path: string;
  file: string;
  source: string;
  sourceSha256: string;
  sha256: string;
  bytes: number;
  rgbaSha256?: string;
  encoding?: string;
  archiveSha256?: string;
}

const records: AssetRecord[] = [];
const manifestPath = join(assetRoot, "manifest.json");
const previous = await readFile(manifestPath, "utf8")
  .then((text) => JSON.parse(text).assets as AssetRecord[])
  .catch(() => [] as AssetRecord[]);
const previousByPath = new Map(previous.map((entry) => [entry.path, entry]));

async function emit(file: string, bytes: Uint8Array | string) {
  const dest = join(assetRoot, file);
  const desired = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  const actual = await readFile(dest).catch(() => null);
  if (actual && Buffer.from(desired).equals(actual)) return;
  if (check) {
    failures.push(relative(root, dest));
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
}

async function copy(source: string, path: string, file: string) {
  const bytes = await readFile(join(root, source));
  await emit(file, bytes);
  records.push({
    path,
    file,
    source,
    sourceSha256: sha(bytes),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}

function magick(args: string[]): Buffer {
  const result = Bun.spawnSync(["magick", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`ImageMagick failed: ${result.stderr.toString()}`);
  }
  return Buffer.from(result.stdout);
}

async function copyAvif(source: string, path: string, file: string) {
  const original = await readFile(join(root, source));
  const sourceHash = sha(original);
  const old = previousByPath.get(path);
  const dest = join(assetRoot, file);
  let bytes = await readFile(dest).catch(() => null);
  let rgbaHash = old?.rgbaSha256;
  if (
    !bytes ||
    !old ||
    old.sourceSha256 !== sourceHash ||
    old.sha256 !== sha(bytes) ||
    !rgbaHash
  ) {
    if (check) {
      failures.push(relative(root, dest));
      return;
    }
    await mkdir(dirname(dest), { recursive: true });
    magick([
      join(root, source),
      "-define",
      "webp:lossless=true",
      "-define",
      "webp:exact=true",
      "-quality",
      "100",
      dest,
    ]);
    const sourceRgba = magick([join(root, source), "-depth", "8", "RGBA:-"]);
    const nativeRgba = magick([dest, "-depth", "8", "RGBA:-"]);
    if (!sourceRgba.equals(nativeRgba)) {
      throw new Error(`Native codec copy changed RGBA pixels: ${source}`);
    }
    rgbaHash = sha(sourceRgba);
    bytes = await readFile(dest);
  }
  records.push({
    path,
    file,
    source,
    sourceSha256: sourceHash,
    sha256: sha(bytes!),
    bytes: bytes!.length,
    rgbaSha256: rgbaHash,
    encoding: "Lossless WebP; decoded 8-bit RGBA matches the source exactly",
  });
}

// All manuscript/export faces already shipped by Twyne, together with their
// original notices. The theme's derived UI-only Lora faces are separate; the
// original font book retains exactly these source bytes and names.
for (const file of (await readdir(join(root, "src/assets/typst"))).sort()) {
  if (/\.(ttf|otf|txt)$/.test(file) || ["LICENSE", "NOTICE"].includes(file)) {
    await copy(`src/assets/typst/${file}`, `fonts/${file}`, `fonts/${file}`);
  }
}
const loraUi = JSON.parse(
  await readFile(join(assetRoot, "lora-ui-provenance.json"), "utf8"),
) as {
  instances: {
    file: string;
    source: string;
    sourceSha256: string;
    sha256: string;
    axes: { wght: number };
  }[];
  licenseSource: string;
  licenseSha256: string;
};
for (const instance of loraUi.instances) {
  const original = await readFile(join(root, instance.source));
  const bytes = await readFile(join(assetRoot, instance.file));
  if (
    sha(original) !== instance.sourceSha256 ||
    sha(bytes) !== instance.sha256
  ) {
    throw new Error(
      `Reproduce the original 3.008 UI face with tools/sync-lora-ui.py: ${instance.file}`,
    );
  }
  records.push({
    path: instance.file,
    file: instance.file,
    source: `${instance.source}#wght=${instance.axes.wght}`,
    sourceSha256: instance.sourceSha256,
    sha256: instance.sha256,
    bytes: bytes.length,
    encoding:
      "Original Lora 3.008 static instance; derived internal family Twyne Body",
  });
}
await copy(
  loraUi.licenseSource,
  "licenses/twyne-body-OFL.txt",
  "licenses/twyne-body-OFL.txt",
);
for (const file of [
  "lora-ui-provenance.json",
  "licenses/twyne-body-FONTLOG.txt",
]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-lora-ui.py#Lora3.008-instance-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-lora-ui.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
const buttonFont = JSON.parse(
  await readFile(join(assetRoot, "button-font-provenance.json"), "utf8"),
) as {
  source: string;
  sourceSha256: string;
  file: string;
  sha256: string;
  licenseSource: string;
};
const buttonFontBytes = await readFile(join(assetRoot, buttonFont.file));
if (
  sha(await readFile(join(root, buttonFont.source))) !==
    buttonFont.sourceSha256 ||
  sha(buttonFontBytes) !== buttonFont.sha256
) {
  throw new Error(
    "Reproduce the original 12px/600 face with tools/sync-button-font.py",
  );
}
records.push({
  path: buttonFont.file,
  file: buttonFont.file,
  source: `${buttonFont.source}#opsz12,wght600`,
  sourceSha256: buttonFont.sourceSha256,
  sha256: buttonFont.sha256,
  bytes: buttonFontBytes.length,
  encoding:
    "Original DM Sans4.004 static paper-button instance; explicit internal UI family",
});
await copy(
  buttonFont.licenseSource,
  "licenses/twyne-button-sans-OFL.txt",
  "licenses/twyne-button-sans-OFL.txt",
);
for (const file of [
  "button-font-provenance.json",
  "licenses/twyne-button-sans-FONTLOG.txt",
]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-button-font.py#original12px600-button-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-button-font.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
// Source uses the exact Noto Mono 2.014 faces selected by the original app's
// current browser, plus a source-derived native synthetic-oblique adapter.
// Packaged originals allow offline reproduction; shared/code/Typst mono stays.
const sourceFonts = JSON.parse(
  await readFile(join(assetRoot, "source-font-provenance.json"), "utf8"),
) as {
  originals: { file: string; sha256: string }[];
  faces: {
    file: string;
    sha256: string;
    source: string;
    sourceSha256: string;
    style: string;
  }[];
  helperFont: {
    file: string;
    sha256: string;
    source: string;
    sourceSha256: string;
    licenseSource: string;
    licenseSha256: string;
  };
  licenseFile: string;
  licenseSha256: string;
  licenseSource: string;
};
for (const original of sourceFonts.originals) {
  const bytes = await readFile(join(assetRoot, original.file));
  if (sha(bytes) !== original.sha256)
    throw new Error(
      `Restore exact original browser Source font: ${original.file}`,
    );
  records.push({
    path: original.file,
    file: original.file,
    source: `Fedora google-noto-sans-mono-fonts-20250301-1.fc42.noarch:${original.file}`,
    sourceSha256: original.sha256,
    sha256: original.sha256,
    bytes: bytes.length,
  });
}
for (const face of sourceFonts.faces) {
  const bytes = await readFile(join(assetRoot, face.file));
  if (sha(bytes) !== face.sha256)
    throw new Error(
      `Reproduce Source face with tools/sync-source-fonts.py: ${face.file}`,
    );
  records.push({
    path: face.file,
    file: face.file,
    source: `${face.source}#${face.style}`,
    sourceSha256: face.sourceSha256,
    sha256: face.sha256,
    bytes: bytes.length,
    encoding:
      "Source-only Noto Mono2.014 renamed UI adapter; glyph IDs and advances unchanged",
  });
}
const helperFont = sourceFonts.helperFont;
const helperBytes = await readFile(join(assetRoot, helperFont.file));
if (sha(helperBytes) !== helperFont.sha256)
  throw new Error(
    "Reproduce original Source helper face with tools/sync-source-fonts.py",
  );
records.push({
  path: helperFont.file,
  file: helperFont.file,
  source: `${helperFont.source}#opsz11,wght400`,
  sourceSha256: helperFont.sourceSha256,
  sha256: helperFont.sha256,
  bytes: helperBytes.length,
  encoding: "Original DM4.00411px helper-only optical-size instance",
});
await copy(
  helperFont.licenseSource,
  "licenses/twyne-source-label-OFL.txt",
  "licenses/twyne-source-label-OFL.txt",
);
const sourceLicenseBytes = await readFile(
  join(assetRoot, sourceFonts.licenseFile),
);
if (sha(sourceLicenseBytes) !== sourceFonts.licenseSha256)
  throw new Error("Restore original Source OFL notice");
records.push({
  path: sourceFonts.licenseFile,
  file: sourceFonts.licenseFile,
  source: sourceFonts.licenseSource,
  sourceSha256: sourceFonts.licenseSha256,
  sha256: sourceFonts.licenseSha256,
  bytes: sourceLicenseBytes.length,
});
for (const file of [
  "source-font-provenance.json",
  "licenses/twyne-source-FONTLOG.txt",
]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-source-fonts.py#original-Source-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-source-fonts.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
// The shared native mono's missing italic face comes from the same official
// 2.37 archive as the original bundled regular Mono. The companion tool checks
// that regular is byte-identical before extracting this licensed sibling.
const monoArchive =
  "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2";
for (const [file, member, expected] of [
  [
    "fonts/DejaVuSansMono-Oblique.ttf",
    "ttf/DejaVuSansMono-Oblique.ttf",
    "742097840c541870e8d6dc5c9b37bb1ceeea6c0dedd1d475faf903ef9df734b0",
  ],
  [
    "licenses/dejavu-LICENSE.txt",
    "LICENSE",
    "7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93",
  ],
]) {
  const bytes = await readFile(join(assetRoot, file));
  if (sha(bytes) !== expected)
    throw new Error(
      `Restore the matching Mono face with tools/sync-mono-oblique.py: ${file}`,
    );
  records.push({
    path: file,
    file,
    source: `${monoArchive}#${member}`,
    sourceSha256: expected,
    sha256: expected,
    bytes: bytes.length,
    archiveSha256:
      "fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7",
  });
}
// The original browser's writing fallback is a non-Latin Droid face supplied
// by its local font package. Retain the exact executed bytes and notice; the
// companion copier verifies both hashes and records browser/font provenance.
for (const [file, expected] of [
  [
    "fonts/DroidSansFallbackFull.ttf",
    "2392015530438bafc48edfc4aee6d9de2387f627a6134d8ab3dfcc99d21c8240",
  ],
  [
    "licenses/droid-sans-fallback-NOTICE.txt",
    "38751245389e1e23f73e6f5384b5cbe7fa972cc4410c5adc9c04b082a0b9561a",
  ],
]) {
  const bytes = await readFile(join(assetRoot, file));
  if (sha(bytes) !== expected)
    throw new Error(
      `Restore the original CJK face with tools/sync-cjk-fallback.py: ${file}`,
    );
  records.push({
    path: file,
    file,
    source: `Fedora google-droid-sans-fonts-20200215-22.fc42.noarch:${file}`,
    sourceSha256: expected,
    sha256: expected,
    bytes: bytes.length,
  });
}
await copy(
  "public/licenses/typst-fonts.txt",
  "licenses/typst-fonts.txt",
  "licenses/typst-fonts.txt",
);
// Original app's File U+25BE selects this local Math3.000 face. It is an
// explicit arrow-only UI face, outside the original Typst fontbook/order.
for (const [file, expected] of [
  [
    "fonts/NotoSansMath-Regular.ttf",
    "d51afd5739c7ba6c44fcab35a88160e25dfb69a2d4ad0bd99533f8d894af1f96",
  ],
  [
    "licenses/noto-sans-math-OFL.txt",
    "403a95275b469061b7d4371c328e0ada3bc7d63328abe2e88aad5cd243b2fe21",
  ],
]) {
  const bytes = await readFile(join(assetRoot, file));
  if (sha(bytes) !== expected)
    throw new Error(
      `Restore original File glyph with tools/sync-file-arrow-font.py: ${file}`,
    );
  records.push({
    path: file,
    file,
    source: `Fedora google-noto-sans-math-fonts-20250301-1.fc42.noarch:${file}`,
    sourceSha256: expected,
    sha256: expected,
    bytes: bytes.length,
  });
}
for (const file of [
  "file-arrow-font-provenance.json",
  "licenses/file-arrow-FONTLOG.txt",
]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-file-arrow-font.py#original-File-glyph-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-file-arrow-font.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
// Actual original-app Cast symbols select three local fallback faces, rather
// than the requested Google DM Sans subset. Package exact faces only for the
// explicit badge chain; shared/default/Source/Typst descriptors are unchanged.
const castFonts = JSON.parse(
  await readFile(join(assetRoot, "cast-font-provenance.json"), "utf8"),
) as {
  fonts: {
    file: string;
    sha256: string;
    source: string;
    sourceSha256: string;
    licenseFile: string;
    licenseSha256: string;
    licenseSource: string;
    copy: string;
  }[];
};
for (const face of castFonts.fonts) {
  for (const [file, expected, source, sourceHash, encoding] of [
    [face.file, face.sha256, face.source, face.sourceSha256, face.copy],
    [
      face.licenseFile,
      face.licenseSha256,
      face.licenseSource,
      face.licenseSha256,
      "Original SIL Open Font License/copyright notice",
    ],
  ]) {
    const bytes = await readFile(join(assetRoot, file));
    if (sha(bytes) !== expected)
      throw new Error(
        `Restore exact Cast fallback with tools/sync-cast-fonts.py: ${file}`,
      );
    records.push({
      path: file,
      file,
      source,
      sourceSha256: sourceHash,
      sha256: expected,
      bytes: bytes.length,
      encoding,
    });
  }
}
for (const file of ["cast-font-provenance.json", "licenses/cast-FONTLOG.txt"]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-cast-fonts.py#original-Cast-symbol-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-cast-fonts.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
// Manager assistance raw glyphs inherit the original display font, so their
// exact serif fallback is separate from the circular DM Sans badge chain.
const castRawFont = JSON.parse(
  await readFile(join(assetRoot, "cast-raw-font-provenance.json"), "utf8"),
) as {
  file: string;
  sha256: string;
  source: string;
  sourceSha256: string;
  licenseFile: string;
  licenseSha256: string;
  licenseSource: string;
};
for (const [file, expected, source, sourceHash] of [
  [
    castRawFont.file,
    castRawFont.sha256,
    castRawFont.source,
    castRawFont.sourceSha256,
  ],
  [
    castRawFont.licenseFile,
    castRawFont.licenseSha256,
    castRawFont.licenseSource,
    castRawFont.licenseSha256,
  ],
]) {
  const bytes = await readFile(join(assetRoot, file));
  if (sha(bytes) !== expected)
    throw new Error(
      `Restore original Manager glyph face with tools/sync-cast-raw-font.py: ${file}`,
    );
  records.push({
    path: file,
    file,
    source,
    sourceSha256: sourceHash,
    sha256: expected,
    bytes: bytes.length,
  });
}
for (const file of [
  "cast-raw-font-provenance.json",
  "licenses/cast-raw-FONTLOG.txt",
]) {
  const bytes = await readFile(join(assetRoot, file));
  records.push({
    path: file,
    file,
    source: "tools/sync-cast-raw-font.py#original-Manager-raw-glyph-provenance",
    sourceSha256: sha(
      await readFile(join(nativeRoot, "tools/sync-cast-raw-font.py")),
    ),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
const reiconLicense = await readFile(
  join(assetRoot, "licenses/reicon-LICENSE.txt"),
);
records.push({
  path: "licenses/reicon-LICENSE.txt",
  file: "licenses/reicon-LICENSE.txt",
  source: "https://github.com/dqev/reicon/blob/main/LICENSE",
  sourceSha256: sha(reiconLicense),
  sha256: sha(reiconLicense),
  bytes: reiconLicense.length,
});

// The original product identity, paper/proof textures, and stamp artwork.
for (const file of (await readdir(join(root, "public/assets"))).sort()) {
  if (/\.(svg|png|webp)$/.test(file)) {
    await copy(
      `public/assets/${file}`,
      `assets/${file}`,
      `public/assets/${file}`,
    );
  }
}
for (const file of [
  "favicon.svg",
  "favicon.ico",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
  "approval-stamp.svg",
  "twyne-wordmark.svg",
]) {
  await copy(`public/${file}`, file, `public/${file}`);
}
for (const dir of [
  "avatars/engraved-2026-09",
  "rubric-stamps",
  "manual/editors",
]) {
  for (const file of (await readdir(join(root, "public/assets", dir))).sort()) {
    const included =
      dir === "manual/editors"
        ? /\.webp$/.test(file) || file === "manifest.json"
        : dir === "avatars/engraved-2026-09"
          ? /\.webp$/.test(file)
          : /\.(png|svg)$/.test(file);
    if (included) {
      await copy(
        `public/assets/${dir}/${file}`,
        `assets/${dir}/${file}`,
        `public/assets/${dir}/${file}`,
      );
    }
  }
}

for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  for (const suffix of ["", "-alt"]) {
    await copyAvif(
      `public/assets/illuminated-initials/${letter}${suffix}.avif`,
      `assets/illuminated-initials/${letter}${suffix}.avif`,
      `public/assets/illuminated-initials/${letter}${suffix}.webp`,
    );
  }
}
for (const name of ["fox", "hare", "owl", "raven"]) {
  await copyAvif(
    `public/assets/avatars/engraved-2026-09/${name}.avif`,
    `assets/avatars/engraved-2026-09/${name}.avif`,
    `public/assets/avatars/engraved-2026-09/${name}-avif.webp`,
  );
}
for (const dir of ["page-borders", "page-borders/slices"]) {
  for (const file of (await readdir(join(root, "public/assets", dir))).sort()) {
    if (extname(file) !== ".avif") continue;
    await copyAvif(
      `public/assets/${dir}/${file}`,
      `assets/${dir}/${file}`,
      `public/assets/${dir}/${file.replace(/\.avif$/, ".webp")}`,
    );
  }
}

const iconSystemSource = "src/utils/icon-system.ts";
const iconSource = await readFile(join(root, iconSystemSource), "utf8");
const iconDictionary = iconSource.match(
  /const TWYNE_ICONS = \{([\s\S]*?)\} satisfies/,
);
if (!iconDictionary)
  throw new Error("Could not find Twyne's semantic icon dictionary");
const iconNames = [
  ...iconDictionary[1].matchAll(/^\s+(?:"([^"]+)"|(\w+)):\s*\w+,/gm),
]
  .map((match) => (match[1] ?? match[2]) as TwyneIconName)
  .sort();
for (const name of iconNames) {
  for (const weight of ["Outline", "Filled"] as const) {
    const bytes = renderTwyneIconSvg(name, { size: 24, weight });
    const path = `twyne/icons/${name}-${weight.toLowerCase()}.svg`;
    const file = `icons/${name}-${weight.toLowerCase()}.svg`;
    await emit(file, bytes);
    records.push({
      path,
      file,
      source: `${iconSystemSource}#${name}:${weight}`,
      sourceSha256: sha(iconSource),
      sha256: sha(bytes),
      bytes: Buffer.byteLength(bytes),
    });
  }
}

// These controls are inline SVGs in the editor route, rather than Reicon names.
// Extract their markup from that source so line shape/stroke cannot drift.
const editorSource = await readFile(
  join(root, "src/routes/editor/index.tsx"),
  "utf8",
);
for (const [name, label] of [
  ["editor-drawer", "Toggle the drawer sidebar"],
  ["editorial-board", "Toggle the editorial board panel"],
] as const) {
  const offset = editorSource.indexOf(`aria-label="${label}"`);
  const markup = editorSource.slice(offset).match(/<svg([\s\S]*?)<\/svg>/)?.[0];
  if (offset < 0 || !markup)
    throw new Error(`Missing original inline icon ${name}`);
  const svg = markup
    .replace(/\s+/g, " ")
    .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const path = `twyne/icons/${name}.svg`;
  const file = `icons/${name}.svg`;
  await emit(file, svg);
  records.push({
    path,
    file,
    source: `src/routes/editor/index.tsx#${label}`,
    sourceSha256: sha(editorSource),
    sha256: sha(svg),
    bytes: Buffer.byteLength(svg),
  });
}

// SpeakButton's idle speaker is original inline artwork, separate from Reicon.
const speakSourcePath = "src/components/ui/speak-button.tsx";
const speakSource = await readFile(join(root, speakSourcePath), "utf8");
const speakMarkup = [...speakSource.matchAll(/<svg[\s\S]*?<\/svg>/g)]
  .map((match) => match[0])
  .find((svg) => svg.includes('d="M11 5 6 9H3v6h3l5 4V5Z"'));
if (!speakMarkup) throw new Error("Missing original SpeakButton idle SVG");
const speakSvg = speakMarkup
  .replace(/\s+/g, " ")
  .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
await emit("icons/speak-idle.svg", speakSvg);
records.push({
  path: "twyne/icons/speak-idle.svg",
  file: "icons/speak-idle.svg",
  source: `${speakSourcePath}#idle`,
  sourceSha256: sha(speakSource),
  sha256: sha(speakSvg),
  bytes: Buffer.byteLength(speakSvg),
});

// ChatComposer's send arrow and microphone are also original inline artwork.
// Keep their original 15px viewports, paths, fills, strokes and round caps;
// the caller owns submission and voice capability, rather than the icon.
const composerSourcePath = "src/components/ui/chat-composer.tsx";
const composerSource = await readFile(join(root, composerSourcePath), "utf8");
const composerSvgs = [...composerSource.matchAll(/<svg[\s\S]*?<\/svg>/g)].map(
  (match) => match[0],
);
for (const [name, sourceName, signature] of [
  ["composer-send", "send", 'd="M12 19V5"'],
  ["composer-mic", "MicIcon", 'd="M5 11a7 7 0 0 0 14 0"'],
] as const) {
  const matches = composerSvgs.filter((svg) => svg.includes(signature));
  if (matches.length !== 1)
    throw new Error(`Expected exactly one original ChatComposer SVG ${name}`);
  const svg = matches[0]
    .replace(/\s+/g, " ")
    .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const path = `twyne/icons/${name}.svg`;
  const file = `icons/${name}.svg`;
  await emit(file, svg);
  records.push({
    path,
    file,
    source: `${composerSourcePath}#${sourceName}`,
    sourceSha256: sha(composerSource),
    sha256: sha(svg),
    bytes: Buffer.byteLength(svg),
  });
}

const pascal = (name: string) =>
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

// Palette literals are extracted from the authoritative CSS, including its
// per-preset overrides. The exported Rust fields use the same editorial roles
// as native chrome, while document-applied colors remain a separate table.
const cssSource = await readFile(join(root, "src/global.css"), "utf8");
// The room's paper tooth is CSS artwork, rather than a separate image. Keep
// its exact geometry/opacity and turn its radial gradients into reusable
// monochrome SVG masks. All three layers have the same tint, so their alpha
// compositing is commutative; grouping 7px+13px separately from 11px keeps
// native atlas tiles small without changing the background.
const bodyRule = cssSource.match(/^body \{([\s\S]*?)^\}/m)?.[1];
if (!bodyRule) throw new Error("Missing original body grain rule");
const grainLayers = [
  ...bodyRule.matchAll(
    /radial-gradient\(circle at ([\d.]+)% ([\d.]+)%, var\(--grain-(\d)\) 0, transparent ([\d.]+)px\)/g,
  ),
].map((entry) => ({
  id: Number(entry[3]),
  x: Number(entry[1]) / 100,
  y: Number(entry[2]) / 100,
  radius: Number(entry[4]),
  period: 0,
}));
const grainSizes = [
  ...(bodyRule.match(/background-size:\s*([\s\S]*?);/)?.[1] ?? "").matchAll(
    /([\d.]+)px ([\d.]+)px/g,
  ),
];
if (grainLayers.length !== 3 || grainSizes.length !== 3)
  throw new Error("Original body grain must have three radial layers/sizes");
for (const [index, layer] of grainLayers.entries()) {
  const size = grainSizes[index];
  layer.period = Number(size[1]);
  if (
    layer.id !== index + 1 ||
    layer.period !== Number(size[2]) ||
    !Number.isInteger(layer.period) ||
    layer.period <= 0 ||
    layer.radius <= 0
  ) {
    throw new Error("Unsupported original body grain geometry");
  }
}
const presetBlock = (preset: string) =>
  cssSource.match(
    new RegExp(`\\[data-theme="${preset}"\\] \\{([\\s\\S]*?)\\n\\}`),
  )?.[1] ?? "";
const grainAlpha = (source: string, base: string) =>
  grainLayers.map((layer) => {
    const value = source.match(
      new RegExp(`--grain-${layer.id}:\\s*([^;]+);`),
    )?.[1];
    const expectedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = value?.match(
      new RegExp(
        `^color-mix\\(in srgb, ${expectedBase} ([\\d.]+)%, transparent\\)$`,
      ),
    );
    if (!match) throw new Error(`Unsupported original grain token: ${value}`);
    return Number(match[1]) / 100;
  });
const lightGrainAlpha = grainAlpha(
  cssSource.slice(0, cssSource.indexOf('[data-theme="foolscap"]')),
  "var(--color-ink)",
);
const darkGrainAlpha = grainAlpha(presetBlock("nightpress"), "#000000");
if (
  !grainLayers.every((layer) =>
    new RegExp(`--grain-${layer.id}:\\s*transparent;`).test(
      presetBlock("broadsheet"),
    ),
  )
) {
  throw new Error("Broadsheet's original grain is no longer transparent");
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);
const grainGroups = [
  {
    name: "outer",
    layers: [grainLayers[2], grainLayers[0]],
    // Four repeats keep common 1x/1.25x/1.5x/2x display boundaries integral.
    period: lcm(grainLayers[0].period, grainLayers[2].period) * 4,
  },
  {
    name: "middle",
    layers: [grainLayers[1]],
    period: grainLayers[1].period * 32,
  },
];
for (const [name, alpha] of [
  ["light", lightGrainAlpha],
  ["dark", darkGrainAlpha],
] as const) {
  for (const group of grainGroups) {
    const definitions = group.layers
      .map(
        (layer) =>
          `<radialGradient id="g${layer.id}" gradientUnits="userSpaceOnUse" cx="${layer.x * layer.period}" cy="${layer.y * layer.period}" r="${layer.radius}"><stop offset="0" stop-color="#ffffff" stop-opacity="${alpha[layer.id - 1]}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><pattern id="p${layer.id}" patternUnits="userSpaceOnUse" width="${layer.period}" height="${layer.period}"><rect width="${layer.period}" height="${layer.period}" fill="url(#g${layer.id})"/></pattern>`,
      )
      .join("");
    const content = group.layers
      .map(
        (layer) =>
          `<rect width="${group.period}" height="${group.period}" fill="url(#p${layer.id})"/>`,
      )
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${group.period}" height="${group.period}" viewBox="0 0 ${group.period} ${group.period}"><defs>${definitions}</defs>${content}</svg>\n`;
    const path = `twyne/paper-grain/${name}-${group.name}.svg`;
    const file = `paper-grain/${name}-${group.name}.svg`;
    await emit(file, svg);
    records.push({
      path,
      file,
      source: `src/global.css#body-and-grain-tokens:${name}:${group.name}`,
      sourceSha256: sha(cssSource),
      sha256: sha(svg),
      bytes: Buffer.byteLength(svg),
      encoding:
        "Source-derived radial-gradient alpha mask; native tint follows original theme",
    });
  }
}
const rustFloat = (value: number) =>
  Number.isInteger(value) ? `${value}.` : `${value}`;
await emit(
  "grain.rs",
  `// Generated from src/global.css by tools/sync-assets.ts. Do not edit.\npub const BODY_GRAIN_LAYERS: [(f32, f32, f32, f32); 3] = [\n${grainLayers.map((layer) => `    (${[layer.period, layer.x, layer.y, layer.radius].map(rustFloat).join(", ")}),`).join("\n")}\n];\npub const LIGHT_GRAIN_ALPHA: [f32; 3] = [${lightGrainAlpha.map(rustFloat).join(", ")}];\npub const DARK_GRAIN_ALPHA: [f32; 3] = [${darkGrainAlpha.map(rustFloat).join(", ")}];\npub const GRAIN_OUTER_TILE_PX: f32 = ${rustFloat(grainGroups[0].period)};\npub const GRAIN_MIDDLE_TILE_PX: f32 = ${rustFloat(grainGroups[1].period)};\n`,
);
await emit(
  "paper-grain.json",
  JSON.stringify(
    {
      source: "src/global.css",
      sourceSha256: sha(cssSource),
      layers: grainLayers,
      lightAlpha: lightGrainAlpha,
      darkAlpha: darkGrainAlpha,
      broadsheetAlpha: [0, 0, 0],
      backgroundPosition: "0% 0%, 0% 0%, 0% 0%",
      backgroundRepeat: "repeat, repeat, repeat",
      groups: grainGroups,
    },
    null,
    2,
  ) + "\n",
);
const literalTokens = (source: string) =>
  Object.fromEntries(
    [
      ...source.matchAll(
        /^\s*(--[\w-]+):\s*(#[\da-f]{6}|var\(--[\w-]+\)|transparent)\s*;/gim,
      ),
    ].map((match) => [match[1], match[2]]),
  ) as Record<string, string>;
const base = literalTokens(
  cssSource.slice(0, cssSource.indexOf('[data-theme="foolscap"]')),
);
const paletteFields = {
  paper: "--color-paper",
  sidebar: "--color-paper-2",
  rule: "--color-paper-3",
  paper_soft: "--color-paper-soft",
  page: "--color-editor-bg",
  editor_line: "--color-editor-line",
  ink: "--color-ink",
  ink_light: "--color-ink-light",
  ink_muted: "--color-ink-muted",
  vermilion: "--color-vermilion",
  vermilion_deep: "--color-vermilion-2",
  brand_light: "--color-brand-light",
  periwinkle: "--color-periwinkle",
  sage: "--color-sage",
  mustard: "--color-mustard",
  blush: "--color-blush",
  cobalt: "--color-cobalt",
  writer_note: "--color-writer-note",
  success: "--color-accent-green",
  warning: "--color-accent-amber",
  danger: "--color-accent-red",
  blue: "--color-accent-blue",
  emboss: "--emboss",
  foxing: "--foxing-base",
  shade: "--shade",
};
let palettes =
  "// Generated from src/global.css by tools/sync-assets.ts. Do not edit.\n";
const tokenTables: Record<string, Record<string, string>> = {};
for (const preset of ["editorial", "foolscap", "broadsheet", "nightpress"]) {
  const block = cssSource.match(
    new RegExp(`\\[data-theme="${preset}"\\] \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  const tokens = { ...base, ...literalTokens(block ?? "") };
  const resolveToken = (token: string, seen = new Set<string>()): string => {
    if (seen.has(token) || !tokens[token])
      throw new Error(`Missing/cyclic CSS token ${token}`);
    seen.add(token);
    const referenced = tokens[token].match(/^var\((--[\w-]+)\)$/)?.[1];
    return referenced ? resolveToken(referenced, seen) : tokens[token];
  };
  tokenTables[preset] = Object.fromEntries(
    Object.keys(tokens).map((token) => [token, resolveToken(token)]),
  );
  palettes += `pub const ${preset.toUpperCase()}: Palette = Palette {\n    preset: ThemePreset::${pascal(preset)},\n    dark: ${preset === "nightpress"},\n`;
  for (const [field, token] of Object.entries(paletteFields)) {
    const value = resolveToken(token);
    palettes += `    ${field}: ${value === "transparent" ? "0x000000" : value.replace("#", "0x")},\n`;
  }
  palettes += `    foxing_alpha: ${resolveToken("--foxing-base") === "transparent" ? "0." : "1."},\n};\n\n`;
}
palettes += "pub const DOCUMENT_COLORS: &[(&str, u32)] = &[\n";
for (const [token, value] of Object.entries(base).filter(([token]) =>
  /^--color-(text|highlight)-/.test(token),
)) {
  palettes += `    (${JSON.stringify(token)}, ${value.replace("#", "0x")}),\n`;
}
palettes += "];\n";
await emit("palette.rs", palettes);
await emit(
  "theme-tokens.json",
  JSON.stringify(
    {
      source: "src/global.css",
      sourceSha256: sha(cssSource),
      presets: tokenTables,
    },
    null,
    2,
  ) + "\n",
);

let catalog = "// Generated by tools/sync-assets.ts. Do not edit.\n";
catalog +=
  "#[derive(Clone, Copy, Debug, Eq, PartialEq)]\npub enum TwyneIcon {\n";
catalog += iconNames.map((name) => `    ${pascal(name)},`).join("\n") + "\n}\n";
catalog += "impl TwyneIcon {\n    pub const ALL: &'static [Self] = &[\n";
catalog +=
  iconNames.map((name) => `        Self::${pascal(name)},`).join("\n") +
  "\n    ];\n";
catalog += "    pub const fn name(self) -> &'static str { match self {\n";
catalog += iconNames
  .map((name) => `        Self::${pascal(name)} => ${JSON.stringify(name)},`)
  .join("\n");
catalog +=
  "\n    }}\n    pub fn from_name(name: &str) -> Option<Self> { Some(match name {\n";
catalog += iconNames
  .map((name) => `        ${JSON.stringify(name)} => Self::${pascal(name)},`)
  .join("\n");
catalog += "\n        _ => return None,\n    })}\n";
catalog +=
  "    pub const fn path(self, weight: IconWeight) -> &'static str { match (self, weight) {\n";
for (const name of iconNames) {
  for (const weight of ["Outline", "Filled"]) {
    catalog += `        (Self::${pascal(name)}, IconWeight::${weight}) => "twyne/icons/${name}-${weight.toLowerCase()}.svg",\n`;
  }
}
catalog += "    }}\n}\n\nconst EMBEDDED_ASSETS: &[EmbeddedAsset] = &[\n";
records.sort((a, b) => a.path.localeCompare(b.path));
// Rust binary search compares bytes, rather than locale-aware punctuation.
records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
for (const record of records) {
  catalog += `    EmbeddedAsset { path: ${JSON.stringify(record.path)}, bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/${record.file}")) },\n`;
}
catalog += "];\n";
await emit("catalog.rs", catalog);
await emit(
  "manifest.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      generator: "desktop/gpui/tools/sync-assets.ts",
      semanticIconRenderer: iconSystemSource,
      reiconVersion: JSON.parse(
        await readFile(join(root, "node_modules/reicon/package.json"), "utf8"),
      ).version,
      assets: records,
    },
    null,
    2,
  ) + "\n",
);

if (failures.length) {
  console.error(
    `Native assets are stale:\n${[...new Set(failures)].join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `${check ? "Verified" : "Synced"} ${records.length} source-backed Twyne assets and ${iconNames.length} semantic icons in both weights.`,
);
