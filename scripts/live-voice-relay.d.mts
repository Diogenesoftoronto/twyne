import type { Server } from "node:http";
import type { Http2SecureServer } from "node:http2";
export function installLiveVoiceRelay(
  server: Server | Http2SecureServer,
  options?: { issuer?: string; origin?: string },
): () => void;
export function liveHandshake(
  value: unknown,
  issuer: string,
): { url: string; headers: Record<string, string> };
