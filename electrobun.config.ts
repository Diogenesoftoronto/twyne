import type { ElectrobunConfig } from "electrobun";

const localAiEnabled =
  process.env.TWYNE_DESKTOP_LOCAL_AI === "true" ||
  process.env.TWYNE_DESKTOP_LOCAL_AI === "1";

const localAiCopy: Record<string, string> = {};

if (localAiEnabled) {
  const serverBin =
    process.env.LITERT_SERVER_BIN ?? "desktop/bin/litert-lm-server";
  const modelPath = process.env.LOCAL_MODEL_PATH;
  localAiCopy[serverBin] = "bin/litert-lm-server";
  if (modelPath) {
    localAiCopy[modelPath] = "models/gemma-4-e4b.litertlm";
  }
}

/**
 * Electrobun build config for the Twyne desktop shell.
 *
 * The desktop app is a thin native wrapper around the hosted web app at
 * https://twyne.love — SSR, Convex sync, Better Auth, and ATProto publishing
 * all run server-side, so the shell only needs a window pointed at the site.
 * There is no bundled `views://` frontend; the single Bun entrypoint
 * (`desktop/main.ts`) opens a BrowserWindow on the live URL.
 */
export default {
  app: {
    name: "Twyne",
    identifier: "love.twyne.desktop",
    version: "0.2.0",
    // Custom scheme reserved for ATProto OAuth deep-link callbacks (macOS).
    urlSchemes: ["twyne"],
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "desktop/main.ts",
      define: {
        "process.env.TWYNE_DESKTOP_LOCAL_AI": JSON.stringify(
          localAiEnabled ? "true" : "false",
        ),
      },
    },
    copy: localAiEnabled ? localAiCopy : undefined,
    asarUnpack: localAiEnabled
      ? ["bin/**", "models/**", "*.node", "*.dll", "*.dylib", "*.so"]
      : undefined,
    mac: {
      defaultRenderer: "native",
      // Add `icons: "icon.iconset"` + a real .iconset before notarized
      // distribution; omitted so CI builds stay green without one.
    },
    linux: {
      defaultRenderer: "native",
    },
    win: {
      defaultRenderer: "native",
    },
  },
} satisfies ElectrobunConfig;
