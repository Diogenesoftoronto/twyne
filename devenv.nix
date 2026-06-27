{ pkgs, lib, config, ... }:
{
  # Per-project devenv config for the Twyne app shell.
  # Keep the shell focused on the tools the repo actually needs.
  packages = with pkgs; [
    just
  ];

  languages.javascript = {
    enable = true;
    bun.enable = true;
  };
}
