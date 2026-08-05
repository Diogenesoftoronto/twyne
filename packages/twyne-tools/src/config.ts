import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_VERSION = 1;

export interface TwyneConfig {
  version: 1;
  apiUrl: string;
  accessToken: string;
}

export interface Credentials {
  apiUrl: string;
  accessToken: string;
  source: "environment" | "config";
  configPath?: string;
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TWYNE_CONFIG_PATH?.trim()) return env.TWYNE_CONFIG_PATH.trim();
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "twyne", "config.json");
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Twyne API URL is required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Twyne API URL: ${trimmed}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Twyne API URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

function validateToken(value: string): string {
  const token = value.trim();
  if (!token.startsWith("twyne_pat_") || token.length <= "twyne_pat_".length) {
    throw new Error("Twyne access token must start with twyne_pat_");
  }
  return token;
}

function parseConfig(value: unknown): TwyneConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Twyne config must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== CONFIG_VERSION) {
    throw new Error(`Unsupported Twyne config version: ${String(input.version)}`);
  }
  if (typeof input.apiUrl !== "string" || typeof input.accessToken !== "string") {
    throw new Error("Twyne config must contain apiUrl and accessToken");
  }
  return {
    version: CONFIG_VERSION,
    apiUrl: normalizeApiUrl(input.apiUrl),
    accessToken: validateToken(input.accessToken),
  };
}

async function assertSecureConfig(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to read symlinked Twyne config: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`Twyne config is not a regular file: ${path}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(
      `Twyne config permissions are too open (${(stat.mode & 0o777).toString(8)}); run chmod 600 ${path}`,
    );
  }
}

export async function readConfig(path = defaultConfigPath()): Promise<TwyneConfig> {
  await assertSecureConfig(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Twyne config is not valid JSON: ${path}`);
    throw error;
  }
  return parseConfig(parsed);
}

export async function loadCredentials(
  env: NodeJS.ProcessEnv = process.env,
  path = defaultConfigPath(env),
): Promise<Credentials> {
  const envUrl = env.TWYNE_API_URL?.trim();
  const envToken = env.TWYNE_ACCESS_TOKEN?.trim();
  if (envUrl || envToken) {
    if (!envUrl || !envToken) {
      throw new Error("Set both TWYNE_API_URL and TWYNE_ACCESS_TOKEN, or neither");
    }
    return {
      apiUrl: normalizeApiUrl(envUrl),
      accessToken: validateToken(envToken),
      source: "environment",
    };
  }
  try {
    const config = await readConfig(path);
    return { ...config, source: "config", configPath: path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Twyne is not authenticated. Run `twyne auth login` or set TWYNE_API_URL and TWYNE_ACCESS_TOKEN.",
      );
    }
    throw error;
  }
}

export async function writeConfig(
  input: { apiUrl: string; accessToken: string },
  path = defaultConfigPath(),
): Promise<string> {
  const config: TwyneConfig = {
    version: CONFIG_VERSION,
    apiUrl: normalizeApiUrl(input.apiUrl),
    accessToken: validateToken(input.accessToken),
  };
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const temporary = join(directory, `.config-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return path;
}

export async function deleteConfig(path = defaultConfigPath()): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
