const required = [
  "CREEM_API_KEY",
  "CREEM_API_BASE",
  "CREEM_SUCCESS_URL",
  "CREEM_WEBHOOK_SECRET",
  "E2E_OTP_SECRET",
] as const;

for (const name of required) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  await run(["bunx", "convex", "env", "set", name, value], true);
}

// The Pro product allowlist must include the product id the checkout test buys,
// or createCheckout rejects it as an unknown product.
const proProduct = process.env.PUBLIC_CREEM_PRODUCT_PRO;
if (!proProduct) throw new Error("PUBLIC_CREEM_PRODUCT_PRO is required");
await run(
  ["bunx", "convex", "env", "set", "CREEM_PRO_PRODUCT_IDS", proProduct],
  true,
);

await run(
  ["bunx", "convex", "env", "set", "SITE_URL", "http://localhost:5173"],
  true,
);
await run(["bunx", "convex", "dev", "--once"]);

console.log("Convex development backend configured for Creem E2E.");

async function run(command: string[], quiet = false): Promise<void> {
  const process = Bun.spawn(command, {
    cwd: import.meta.dir + "/..",
    stdout: quiet ? "ignore" : "inherit",
    stderr: "pipe",
  });
  const stderr = await new Response(process.stderr).text();
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(`${command.slice(0, 3).join(" ")} failed: ${stderr}`);
  }
}
