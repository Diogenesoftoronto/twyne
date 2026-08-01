{ pkgs, lib, config, ... }:
{
  # Per-project devenv config for the Twyne app shell.
  # Provides Bun + the orchestration tasks that previously lived in justfile.

  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  # Multi-step workflows. Single-step commands live in package.json (`bun run X`).
  tasks."install" = {
    description = "Install dependencies and run Convex codegen";
    exec = ''
      bun install
      bun x convex dev --once --codegen enable --typecheck disable
    '';
  };

  tasks."ci" = {
    description = "Typecheck, lint, format check, and build";
    exec = ''
      bun run build.types
      bun run lint
      bun run fmt.check
      bun run build
    '';
  };
}
