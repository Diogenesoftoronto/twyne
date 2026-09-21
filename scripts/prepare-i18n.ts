// Qwik may run client/type builds concurrently. The outer build prepares the
// local package once; child scripts must not clear its output under each other.
if (process.env.TWYNE_I18N_PREPARED !== "1") {
  for (const script of ["i18n:package", "i18n:compile"]) {
    const child = Bun.spawn(["bun", "run", script], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) process.exit(code);
  }
}
export {};
