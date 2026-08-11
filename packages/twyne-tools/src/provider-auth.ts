import { spawn } from "node:child_process";

export type SdkProvider = "codex" | "anthropic";
export type SdkAuthAction = "login" | "status" | "logout";

export interface SdkAuthInvocation {
  command: string;
  args: string[];
}

/**
 * Resolve the official local authentication command for an SDK provider.
 *
 * Both SDKs deliberately reuse credentials owned by their official CLI. Twyne
 * never reads, copies, logs, or persists the access/refresh tokens itself.
 */
export function sdkAuthInvocation(
  provider: SdkProvider,
  action: SdkAuthAction,
): SdkAuthInvocation {
  if (provider === "codex") {
    if (action === "login") return { command: "codex", args: ["login"] };
    if (action === "status")
      return { command: "codex", args: ["login", "status"] };
    return { command: "codex", args: ["logout"] };
  }

  if (action === "login") return { command: "ant", args: ["auth", "login"] };
  if (action === "status")
    return { command: "ant", args: ["auth", "status"] };
  return { command: "ant", args: ["auth", "logout"] };
}

export async function runSdkAuthCommand(
  provider: SdkProvider,
  action: SdkAuthAction,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const invocation = sdkAuthInvocation(provider, action);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `${invocation.command} is not installed. Install the official ${
              provider === "codex" ? "Codex CLI" : "Anthropic CLI"
            } and try again.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `${provider} ${action} ${
            signal ? `was interrupted by ${signal}` : `exited with code ${code}`
          }.`,
        ),
      );
    });
  });
}
