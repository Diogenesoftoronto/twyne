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

  # GPUI Kit is a native Rust application. Keep the compiler, linker and
  # platform libraries in one shell instead of mixing host toolchains.
  languages.rust = {
    enable = true;
    clangLinker.enable = true;
  };

  packages = [ pkgs.pkg-config ] ++ lib.optionals pkgs.stdenv.isLinux [
    pkgs.fontconfig
    pkgs.freetype
    pkgs.libxkbcommon
    pkgs.wayland
    pkgs.libGL
    pkgs.vulkan-loader
    pkgs.xorg.libxcb
    pkgs.openssl
    # Native visual checks render in their own display, leaving the user's
    # desktop and window layout untouched.
    pkgs.xorg.xorgserver
    pkgs.xorg.xwd
  ];

  env.LD_LIBRARY_PATH = lib.mkIf pkgs.stdenv.isLinux (
    lib.mkDefault (lib.makeLibraryPath [
      pkgs.stdenv.cc.cc.lib
      pkgs.libxkbcommon
      pkgs.wayland
      pkgs.libGL
      pkgs.vulkan-loader
    ])
  );
  # Only the isolated screenshot harness opts into the software Vulkan driver.
  env.TWYNE_GPUI_RENDER_ICD = lib.mkIf pkgs.stdenv.isLinux
    "${pkgs.mesa}/share/vulkan/icd.d/lvp_icd.x86_64.json";

  tasks."twyne:desktop:gpui" = {
    description = "Launch the native offline GPUI writing room";
    exec = "bun run desktop.gpui";
  };

  tasks."twyne:desktop:check" = {
    description = "Check the native GPUI application";
    exec = "bun run desktop.gpui.check";
  };

  tasks."twyne:desktop:test" = {
    description = "Test native manuscript storage and file exchange";
    exec = "bun run desktop.gpui.test";
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

  # Avoid the default Vite/Storybook ports used by standalone dev commands
  # and other workspaces. Keep the probes on the same configurable ports.
  env.TWYNE_DEV_PORT = lib.mkDefault "5180";
  env.TWYNE_STORYBOOK_PORT = lib.mkDefault "6010";

  processes."server".exec = "bun run dev.backend";

  processes."app" = {
    exec = "bun run dev.frontend";
    after = [ "devenv:processes:server@started" ];
    ready = {
      exec = ''${pkgs.curl}/bin/curl --fail --silent "http://127.0.0.1:$TWYNE_DEV_PORT/" >/dev/null'';
      initial_delay = 1;
      period = 1;
      timeout = 60;
    };
  };

  processes."storybook" = {
    exec = "bun run storybook";
    ready = {
      exec = ''${pkgs.curl}/bin/curl --fail --silent "http://127.0.0.1:$TWYNE_STORYBOOK_PORT/" >/dev/null'';
      initial_delay = 1;
      period = 1;
      timeout = 60;
    };
  };
}
