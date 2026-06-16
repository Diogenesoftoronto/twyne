/**
 * Twyne CI pipeline — Dagger TypeScript module.
 *
 * Builds and packages the app in a reproducible container so the exact same
 * flow runs locally (`dagger call all`) and in CI (.github/workflows/ci.yml).
 *
 * Common entrypoints:
 *   dagger call all                  # lint → typecheck → test → build → package
 *   dagger call test                 # just the test suite
 *   dagger call build export --path ./build-output
 *   dagger call package export --path ./release
 *
 * After editing this file run `dagger develop` once to (re)generate the local
 * SDK in `.dagger/sdk` (it is git-ignored).
 */
import {
  dag,
  Container,
  Directory,
  File,
  Secret,
  object,
  func,
  argument,
} from "@dagger.io/dagger";

/** Pinned to match `packageManager` in package.json. */
const BUN_IMAGE = "oven/bun:1.3.6";

/** Paths we never want to upload into the build container. */
const SOURCE_IGNORE = [
  "node_modules",
  ".git",
  ".dagger/sdk",
  "dist",
  "server",
  "release",
  "build-output",
  "desktop/build",
  "tmp",
];

@object()
export class Twyne {
  /**
   * Base container: Bun + the project source with dependencies installed.
   * Uses a cache volume for Bun's global install cache so repeated runs are
   * fast both locally and in CI.
   */
  @func()
  install(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Container {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume("twyne-bun-cache"),
      )
      .withWorkdir("/app")
      .withDirectory("/app", source)
      .withExec(["bun", "install", "--frozen-lockfile"]);
  }

  /** Formatting + ESLint. */
  @func()
  async lint(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Promise<string> {
    return this.install(source)
      .withExec(["bun", "run", "fmt.check"])
      .withExec(["bun", "run", "lint"])
      .stdout();
  }

  /** TypeScript type checking (tsc --noEmit). */
  @func()
  async typecheck(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Promise<string> {
    return this.install(source)
      .withExec(["bun", "run", "build.types"])
      .stdout();
  }

  /** The Bun test suite. */
  @func()
  async test(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Promise<string> {
    return this.install(source).withExec(["bun", "test"]).stdout();
  }

  /**
   * Production build. Returns the built artifacts (`dist/` client bundle and
   * `server/` SSR output) as a Directory you can `export`.
   */
  @func()
  build(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Directory {
    const built = this.install(source).withExec(["bun", "run", "build"]);
    return dag
      .directory()
      .withDirectory("dist", built.directory("/app/dist"))
      .withDirectory("server", built.directory("/app/server"));
  }

  /**
   * Package a release tarball — mirrors the `release.yml` packaging step.
   * Returns the `.tar.gz` File; `export` it to disk or attach it to a release.
   */
  @func()
  package(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
    version = "dev",
  ): File {
    const tarball = `release/twyne-${version}.tar.gz`;
    return this.install(source)
      .withExec(["bun", "run", "build"])
      .withExec([
        "sh",
        "-c",
        `mkdir -p release && tar --exclude=./node_modules --exclude=./release --exclude=./.git -czf ${tarball} .`,
      ])
      .file(`/app/${tarball}`);
  }

  /**
   * Full CI gate: lint → typecheck → test → build → package.
   * Throws on the first failing stage; returns a summary when everything passes.
   */
  @func()
  async all(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
  ): Promise<string> {
    await this.lint(source);
    await this.typecheck(source);
    await this.test(source);
    // Building the package also covers `build`.
    await this.package(source).sync();
    return "✓ twyne ci: lint, typecheck, test, build, package all passed";
  }

  /**
   * Agent-in-CI seam. Runs an arbitrary command inside the installed project
   * container with an API key wired in as a Dagger secret (never baked into an
   * image layer). This is the hook a coding agent step extends — e.g. running a
   * codegen or review task against the built app.
   */
  @func()
  async agent(
    @argument({ defaultPath: "/", ignore: SOURCE_IGNORE })
    source: Directory,
    /** Shell command for the agent step to run inside /app. */
    command: string,
    /** API key (e.g. ANTHROPIC_API_KEY) exposed to the command as a secret. */
    apiKey?: Secret,
  ): Promise<string> {
    let ctr = this.install(source);
    if (apiKey) {
      ctr = ctr.withSecretVariable("ANTHROPIC_API_KEY", apiKey);
    }
    return ctr.withExec(["sh", "-c", command]).stdout();
  }
}
