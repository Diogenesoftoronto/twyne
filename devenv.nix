{
  pkgs,
  lib,
  config,
  ...
}:
{
  # Per-project devenv config for the Twyne app shell.
  # Provides Bun + the orchestration tasks that previously lived in justfile.

  # Keep the locked project modules compatible with the installed devenv CLI.
  devenv.cli.requireVersionMatch = lib.mkForce true;

  dotenv.enable = true;
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  # Keep package.json as the command source of truth while exposing the common
  # project workflows through one namespaced devenv task graph.
  tasks."twyne:install" = {
    description = "Install dependencies and run Convex codegen";
    exec = ''
      bun install
      bun x convex dev --once --codegen enable --typecheck disable
    '';
  };

  tasks."twyne:codegen" = {
    description = "Regenerate Convex types";
    exec = "bun x convex dev --once --codegen enable --typecheck disable";
  };

  tasks."twyne:check:types" = {
    description = "Typecheck the application";
    exec = "bun run build.types";
  };

  tasks."twyne:check:lint" = {
    description = "Lint the application";
    exec = "bun run lint";
  };

  tasks."twyne:check:format" = {
    description = "Check source formatting";
    exec = "bun run fmt.check";
  };

  tasks."twyne:check" = {
    description = "Run typecheck, lint, and format checks";
    after = [
      "twyne:check:types"
      "twyne:check:lint"
      "twyne:check:format"
    ];
  };

  tasks."twyne:test" = {
    description = "Run the Bun test suite";
    exec = "bun run test";
  };

  tasks."twyne:build" = {
    description = "Build the production application";
    exec = "bun run build";
  };

  tasks."twyne:storybook:build" = {
    description = "Build the static Storybook";
    exec = "bun run storybook.build";
  };

  tasks."twyne:release:check" = {
    description = "Verify package version and release tag consistency";
    exec = "bun run release:check";
  };

  tasks."twyne:ci" = {
    description = "Run checks, tests, and production builds";
    after = [
      "twyne:check"
      "twyne:test"
      "twyne:build"
      "twyne:storybook:build"
    ];
  };

  git-hooks.hooks = {
    twyne-release-check = {
      enable = true;
      name = "Twyne release consistency";
      entry = "devenv tasks run twyne:release:check";
      language = "system";
      pass_filenames = false;
      always_run = true;
      # Bun creates the version commit before its annotated tag exists.
      # preversion/postversion guard that transition; only check pushes here.
      stages = [
        "pre-push"
      ];
    };
  };

  # `devenv up` is the complete local workspace: Convex, the Qwik app, and
  # Storybook. Native process tasks remain individually controllable through
  # `devenv processes` and visible in `devenv tasks list`.
  process.manager.implementation = "native";

  processes."server".exec = "bun run dev.backend";

  processes."app" = {
    exec = "bun run dev.frontend";
    after = [ "devenv:processes:server@started" ];
    ready = {
      exec = "${pkgs.curl}/bin/curl --fail --silent http://127.0.0.1:5173/ >/dev/null";
      initial_delay = 1;
      period = 1;
      timeout = 60;
    };
  };

  processes."storybook" = {
    exec = "bun run storybook";
    ready = {
      http.get.port = 6006;
      initial_delay = 1;
      period = 1;
      timeout = 60;
    };
  };
}
