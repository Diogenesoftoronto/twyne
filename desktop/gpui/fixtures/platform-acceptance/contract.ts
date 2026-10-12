/** Types for SYNTHETIC platform-input consistency fixtures, not observed build
 * or device receipts. Files/keys/startup fields are supplied declarations.
 * Actual staging integrity and OS interaction each require separate evidence. */
export type Platform = "linux" | "macos" | "windows";
export interface HelperSpec {
  id: string;
  targetName: string;
  windowsExtension?: ".exe";
  required: boolean;
}
export interface KeyAliasSpec {
  action: "save" | "undo" | "redo" | "quit";
  /** Required aliases in this fixture; no running keymap is inspected. */
  aliases: string[];
}
export interface FileAssociationSpec {
  /** Filename suffix or importer token, without an initial dot. OS registration
   * is not inspected. A compound suffix dispatches using its final token. */
  extension: string;
  mime: string;
}
export interface UrlSchemeSpec {
  scheme: string;
  /** A declared scheme must have handling; false is rejected, not registered. */
  implementedInGpui: boolean;
}
export interface MicrophoneContract {
  required: boolean;
  usageKeys: string[];
}
export interface PlatformContract {
  schemaVersion: 2;
  platform: Platform;
  appId: string;
  helpers: HelperSpec[];
  keyAliases: KeyAliasSpec[];
  fileAssociations: FileAssociationSpec[];
  urlSchemes: UrlSchemeSpec[];
  microphone: MicrophoneContract;
}
/** Schema-2 packaging subset. Listing a path is NOT filesystem existence proof.
 * The actual stage.ts verifier checks bytes/types/modes on disk separately. */
export interface DistributionManifest {
  schemaVersion: 2;
  layout: "flat-executables-and-metadata";
  bundleStatus: "not-assembled";
  platform: Platform;
  appId: string;
  executables: {
    id: string;
    path: string;
    targetName: string;
    required: boolean;
  }[];
  files: {
    path: string;
    kind: "executable" | "metadata" | "icon" | "notice";
  }[];
}
export interface BuildDeclaration {
  kind: "synthetic-fixture";
  platform: Platform;
  /** Stated names, not independently observed build output. */
  producedExecutables: string[];
  /** Stated aliases, not observed input events. */
  keyBindings: { action: string; keystrokes: string[] }[];
  startup: {
    handlesFileArguments: boolean;
    handlesUrlScheme: boolean;
    extensionTokens: string[];
  };
  /** A hypothetical capability/metadata declaration. No adapter is inspected. */
  microphone: { realAdapterPresent: boolean; usageDescriptionKeys: string[] };
}
export interface PlatformAcceptanceInput {
  scope: "synthetic-input-consistency";
  contract: PlatformContract;
  manifest: DistributionManifest;
  build: BuildDeclaration;
}
export function expectedExecutableName(
  helper: HelperSpec,
  platform: Platform,
): string {
  return platform === "windows"
    ? `${helper.targetName}${helper.windowsExtension ?? ""}`
    : helper.targetName;
}
