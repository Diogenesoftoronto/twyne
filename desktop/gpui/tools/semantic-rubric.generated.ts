// Generated from src/utils/rubric-judgement-result.ts by build-helper.ts.
export async function rubricDraftFingerprint(draft: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(draft),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
