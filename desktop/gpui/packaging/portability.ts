//! Native dependency and update-signature portability analysis.
//!
//! Verification checks a declared tree's integrity against the current source
//! contract. It does **not** prove the
//! staged binaries run on a clean machine. This module turns the loader
//! metadata recorded during staging into an explicit, bounded portability
//! report so a green stage run is never mistaken for portable-build or
//! clean-install proof.
//!
//! It is analysis only: it reads the staged manifest and the system library
//! directories, and writes a report. It never executes a staged binary,
//! installs anything, signs anything, or contacts a network.

import { readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { freshDestination, readRegularPath } from "./files";
import { verify, type DistributionManifest, type Platform } from "./stage";

export type DependencyClass =
  | "system-glibc"
  | "system-x11"
  | "system-wayland"
  | "system-font"
  | "system-graphics"
  | "system-other"
  | "absolute-store-path"
  | "bundled-relative"
  | "unknown";

export interface DependencyFinding {
  library: string;
  classification: DependencyClass;
  /** True when a clean machine may not already provide this. */
  requiresHostInstall: boolean;
  note: string;
}

export interface BinaryPortability {
  id: string;
  path: string;
  format: string;
  architecture: string | null;
  interpreter: string | null;
  /** Interpreter path that cannot exist on a clean machine. */
  nonPortableInterpreter: boolean;
  runpaths: string[];
  dependencies: DependencyFinding[];
}

export interface PortabilityReport {
  schemaVersion: number;
  generator: "desktop/gpui/packaging/portability.ts";
  platform: Platform;
  scope: string;
  binaries: BinaryPortability[];
  /** Whole-tree facts that staging alone cannot establish. */
  updateSignature: {
    requiresCodeSigning: Platform[];
    updateMechanismImplemented: false;
    note: string;
  };
  limits: string[];
}

const GLIBC =
  /^(libc|libm|libpthread|libdl|librt|libgcc_s|libstdc\+\+)\.|^ld-linux|^ld-musl/;
const X11 =
  /^(libX|libxcb|xcb-|libxkbcommon|libXau|libXdmcp|libXext|libXrender|libXfixes|libXi|libXrandr|libXcursor|libXinerama|libXtst)/;
const WAYLAND = /^(libwayland|libffi)/;
const FONT = /^(libfontconfig|libfreetype|libexpat|libpng|libbz2|libbrotli)/;
const GRAPHICS =
  /^(libGL|libEGL|libGLX|libgbm|libdrm|libvulkan|libvdpau|libxshmfence)/;

/** Classify one loader dependency for the given platform. */
export function classifyDependency(
  library: string,
  platform: Platform,
): DependencyFinding {
  if (library.startsWith("/")) {
    if (
      platform === "macos" &&
      (library.startsWith("/usr/lib/") ||
        library.startsWith("/System/Library/"))
    ) {
      return {
        library,
        classification: "system-other",
        requiresHostInstall: false,
        note: "macOS system library/framework path; target OS availability and version are not verified.",
      };
    }
    return {
      library,
      classification:
        library.startsWith("/nix/store/") || library.startsWith("/gnu/store/")
          ? "absolute-store-path"
          : "system-other",
      requiresHostInstall: true,
      note: "Absolute build/host path. Confirm availability or relocate it before a clean-host claim.",
    };
  }
  if (GLIBC.test(library)) {
    return {
      library,
      classification: "system-glibc",
      requiresHostInstall: false,
      note: "Provided by the host C library; a minimum glibc/musl version is still required.",
    };
  }
  if (X11.test(library)) {
    return {
      library,
      classification: "system-x11",
      requiresHostInstall: true,
      note: "Host must provide X11/xkbcommon development or runtime packages.",
    };
  }
  if (WAYLAND.test(library)) {
    return {
      library,
      classification: "system-wayland",
      requiresHostInstall: true,
      note: "Host must provide the Wayland client library.",
    };
  }
  if (FONT.test(library)) {
    return {
      library,
      classification: "system-font",
      requiresHostInstall: true,
      note: "Host must provide fontconfig/freetype and at least one usable font.",
    };
  }
  if (GRAPHICS.test(library)) {
    return {
      library,
      classification: "system-graphics",
      requiresHostInstall: true,
      note: "Host must provide a GPU/software driver and its loader.",
    };
  }
  if (platform === "linux") {
    return {
      library,
      classification: "system-other",
      requiresHostInstall: true,
      note: "Unclassified shared library; confirm it is present on the target distribution.",
    };
  }
  return {
    library,
    classification: "unknown",
    requiresHostInstall: true,
    note: "Unclassified dependency; review before claiming clean-install support.",
  };
}

/** True when an ELF interpreter path cannot exist on a clean host. */
export function isNonPortableInterpreter(interpreter: string | null): boolean {
  if (!interpreter) return false;
  // A Nix store path is unique to the build machine.
  return (
    interpreter.startsWith("/nix/store/") || interpreter.includes("/gnu/store/")
  );
}

export async function buildPortabilityReport(
  manifest: DistributionManifest,
  options: { scope?: string } = {},
): Promise<PortabilityReport> {
  const binaries: BinaryPortability[] = manifest.executables.map(
    (executable) => ({
      id: executable.id,
      path: executable.path,
      format: executable.dependencies.format,
      architecture: executable.dependencies.architecture,
      interpreter: executable.dependencies.interpreter,
      nonPortableInterpreter: isNonPortableInterpreter(
        executable.dependencies.interpreter,
      ),
      runpaths: executable.dependencies.runpaths,
      dependencies: executable.dependencies.libraries.map((library) =>
        classifyDependency(library, manifest.platform),
      ),
    }),
  );

  const limits = [
    "This report describes loader metadata only. It is not proof the staged binaries run.",
    "It does not establish a portable Linux build, a clean install, macOS/Windows runtime behavior, signing, or updates.",
    "A minimum host glibc/musl version is not verified here.",
    "Wayland/X11 runtime selection and GPU driver availability are not verified here.",
  ];
  if (manifest.platform === "linux") {
    limits.push(
      "Any build-store interpreter reported below must be resolved or relocated for the intended target; this report does not assume all Bun helpers use one.",
    );
  }

  return {
    schemaVersion: 1,
    generator: "desktop/gpui/packaging/portability.ts",
    platform: manifest.platform,
    scope:
      options.scope ??
      "Declared loader metadata for staged executables/helpers; provenance and runtime behavior require separate checks.",
    binaries,
    updateSignature: {
      requiresCodeSigning:
        manifest.platform === "macos"
          ? ["macos"]
          : manifest.platform === "windows"
            ? ["windows"]
            : [],
      updateMechanismImplemented: false,
      note:
        "No update mechanism or signing is implemented. The reference Electrobun shell " +
        "self-updates; the native port has no updater, so any update channel and its " +
        "signature requirements are still to be designed and are out of scope here.",
    },
    limits,
  };
}

/** Count how many distinct host libraries must be present for a clean run. */
export function hostRequirementCount(report: PortabilityReport): number {
  const required = new Set<string>();
  for (const binary of report.binaries) {
    for (const dependency of binary.dependencies) {
      if (dependency.requiresHostInstall) required.add(dependency.library);
    }
  }
  return required.size;
}

async function systemLibraryRoots(): Promise<string[]> {
  const roots = [
    "/usr/lib",
    "/usr/lib64",
    "/lib",
    "/lib64",
    "/usr/lib/x86_64-linux-gnu",
  ];
  const present: string[] = [];
  for (const root of roots) {
    try {
      await readdir(root);
      present.push(root);
    } catch {
      // Not every host uses every layout.
    }
  }
  return present;
}

/**
 * Best-effort check of whether each required host library is resolvable in
 * standard system library directories. Absence is reported as a finding, not
 * a failure: a library may legitimately live on a nonstandard path.
 */
export async function missingSystemLibraries(
  report: PortabilityReport,
): Promise<string[]> {
  const roots = await systemLibraryRoots();
  const available = new Set<string>();
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) available.add(entry);
  }
  const missing = new Set<string>();
  for (const binary of report.binaries) {
    for (const dependency of binary.dependencies) {
      if (
        dependency.requiresHostInstall &&
        dependency.classification !== "absolute-store-path" &&
        !available.has(dependency.library)
      ) {
        missing.add(dependency.library);
      }
    }
  }
  return [...missing].sort();
}

interface CliArgs {
  manifestPath: string;
  outPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  let manifestPath = resolve(
    import.meta.dir,
    "../target/distribution/distribution-manifest.json",
  );
  let outPath = resolve(
    import.meta.dir,
    "../target/distribution-portability.json",
  );
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--manifest" && argv[index + 1]) {
      manifestPath = resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--out" && argv[index + 1]) {
      outPath = resolve(argv[index + 1]);
      index += 1;
    } else
      throw new Error(
        "Usage: portability.ts [--manifest PATH] [--out FRESH_PATH]",
      );
  }
  return { manifestPath, outPath };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (basename(args.manifestPath) !== "distribution-manifest.json")
    throw new Error(
      "Use the distribution's actual distribution-manifest.json.",
    );
  const integrity = await verify(dirname(args.manifestPath));
  if (!integrity.ok)
    throw new Error(
      `Distribution integrity failed: ${integrity.issues.map((issue) => issue.code).join(", ")}`,
    );
  const manifest = JSON.parse(
    (await readRegularPath(args.manifestPath, 8 * 1024 * 1024)).bytes.toString(
      "utf8",
    ),
  ) as DistributionManifest;
  const destination = await freshDestination(args.outPath);
  if (
    destination.startsWith(`${dirname(args.manifestPath)}/`) ||
    destination.startsWith(`${dirname(args.manifestPath)}\\`)
  )
    throw new Error("Keep the report outside the verified distribution tree.");
  const report = await buildPortabilityReport(manifest);
  const missing = await missingSystemLibraries(report);
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644,
  });
  console.log(
    `Portability report: ${report.binaries.length} binaries, ` +
      `${hostRequirementCount(report)} host libraries required.`,
  );
  for (const binary of report.binaries) {
    if (binary.nonPortableInterpreter) {
      console.log(
        `Non-portable interpreter on ${binary.path}: ${binary.interpreter}`,
      );
    }
  }
  if (missing.length > 0) {
    console.log(`Not found in standard library dirs: ${missing.join(", ")}`);
  }
}
