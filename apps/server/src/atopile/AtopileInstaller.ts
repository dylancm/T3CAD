// @effect-diagnostics nodeBuiltinImport:off - Effect has no gunzip; node:zlib feeds NodeStream.pipeThroughDuplex.
/**
 * Makes a working `ato` appear on a machine with nothing installed, the way
 * atopile's VS Code extension does it: find or download a standalone `uv`,
 * warm `uv tool run --from atopile==<version> ato` once (uv fetches Python and
 * the wheel into its own cache, no system Python is touched), then record that
 * command line in the `atopile.command` setting so `AtopileToolchain` resolves
 * it from step 1 and Settings shows exactly what will run.
 *
 * One install runs at a time per server. Progress lives in a `SubscriptionRef`
 * that the `atopile.install.subscribe` RPC streams; cancel interrupts the
 * install fiber, which kills the child process through its scope.
 */

import * as EffectNodeStream from "@effect/platform-node/NodeStream";
import {
  ATOPILE_PINNED_VERSION,
  type AtopileInstallStartInput,
  type AtopileInstallState,
} from "@t3tools/contracts";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as NodeZlib from "node:zlib";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { parseAtoVersion, quoteCommandArg, uvToolRunCommand } from "./AtopileToolchain.ts";

export const UV_LATEST_RELEASE_URL = "https://api.github.com/repos/astral-sh/uv/releases/latest";
/** Warming downloads a Python and atopile's wheel; slow links need the room. */
const WARM_TIMEOUT = Duration.minutes(10);
const DOWNLOAD_TIMEOUT = Duration.minutes(15);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const STDERR_TAIL_CHARS = 400;

const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      browser_download_url: Schema.String,
      size: Schema.Number,
    }),
  ),
});
const decodeGitHubRelease = Schema.decodeUnknownEffect(GitHubRelease);

class AtopileInstallError extends Schema.TaggedErrorClass<AtopileInstallError>()(
  "AtopileInstallError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
const isInstallError = Schema.is(AtopileInstallError);

/** Name of the uv release archive for this host, or the reason there is none. */
export function uvReleaseAsset(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): { readonly name: string } | { readonly unsupported: string } {
  if (platform === "win32") {
    return {
      unsupported:
        "atopile publishes no Windows wheel, so T3CAD cannot install it on Windows. Run T3CAD in WSL or point the ato command at a remote toolchain.",
    };
  }
  const triple =
    platform === "linux" && arch === "x64"
      ? "x86_64-unknown-linux-gnu"
      : platform === "linux" && arch === "arm64"
        ? "aarch64-unknown-linux-gnu"
        : platform === "darwin" && arch === "x64"
          ? "x86_64-apple-darwin"
          : platform === "darwin" && arch === "arm64"
            ? "aarch64-apple-darwin"
            : undefined;
  return triple === undefined
    ? { unsupported: `uv publishes no build for ${platform}-${arch}.` }
    : { name: `uv-${triple}.tar.gz` };
}

/**
 * Pulls one regular-file member out of a tar byte stream as it arrives, so the
 * archive never has to be held whole. Matching is by basename; PAX and long-name
 * pseudo-entries are skipped by type. Feed every chunk to `push` and check
 * `complete` once the stream ends.
 */
export class TarMemberExtractor {
  #buffer = Buffer.alloc(0);
  #remaining = 0;
  #dataRemaining = 0;
  #capturing = false;
  #found = false;
  #complete = false;
  readonly #member: string;

  constructor(member: string) {
    this.#member = member;
  }

  get complete(): boolean {
    return this.#complete;
  }

  push(chunk: Uint8Array): ReadonlyArray<Uint8Array> {
    if (this.#complete) return [];
    const out: Uint8Array[] = [];
    this.#buffer =
      this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      if (this.#remaining > 0) {
        const take = Math.min(this.#remaining, this.#buffer.length);
        if (take === 0) break;
        const data = Math.min(this.#dataRemaining, take);
        if (this.#capturing && data > 0) out.push(this.#buffer.subarray(0, data));
        this.#dataRemaining -= data;
        this.#remaining -= take;
        this.#buffer = this.#buffer.subarray(take);
        if (this.#remaining === 0 && this.#capturing) {
          this.#capturing = false;
          this.#complete = true;
          break;
        }
        continue;
      }
      if (this.#buffer.length < 512) break;
      const header = this.#buffer.subarray(0, 512);
      this.#buffer = this.#buffer.subarray(512);
      if (header.every((byte) => byte === 0)) break;
      const size = Number.parseInt(readField(header, 124, 12), 8) || 0;
      const type = header[156];
      const ustar = readField(header, 257, 6) === "ustar";
      const prefix = ustar ? readField(header, 345, 155) : "";
      const name = readField(header, 0, 100);
      const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
      const regular = type === 0x30 || type === 0;
      this.#remaining = size + ((512 - (size % 512)) % 512);
      this.#dataRemaining = size;
      this.#capturing = regular && !this.#found && fullName.split("/").at(-1) === this.#member;
      if (this.#capturing) this.#found = true;
      if (this.#capturing && size === 0) {
        this.#capturing = false;
        this.#complete = true;
        break;
      }
    }
    return out;
  }
}

function readField(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function isRunning(state: AtopileInstallState): boolean {
  return (
    state.phase === "locating-uv" ||
    state.phase === "downloading-uv" ||
    state.phase === "installing" ||
    state.phase === "verifying"
  );
}

export class AtopileInstaller extends Context.Service<
  AtopileInstaller,
  {
    /** Begins an install, or returns the running one's state unchanged. */
    readonly start: (input: AtopileInstallStartInput) => Effect.Effect<AtopileInstallState>;
    /** Interrupts the running install; a no-op when nothing runs. */
    readonly cancel: () => Effect.Effect<AtopileInstallState>;
    readonly state: Effect.Effect<AtopileInstallState>;
    /** Current state first, then every change. */
    readonly changes: Stream.Stream<AtopileInstallState>;
  }
>()("t3/atopile/AtopileInstaller") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const platform = yield* HostProcessPlatform;
  const arch = yield* HostProcessArchitecture;
  const env = yield* HostProcessEnvironment;
  const serviceScope = yield* Effect.scope;
  const uvDirectory = path.join(config.stateDir, "tools", "uv");
  const managedUvPath = path.join(uvDirectory, "uv");
  const gate = yield* Semaphore.make(1);
  let running: Fiber.Fiber<void> | undefined;
  const state = yield* SubscriptionRef.make<AtopileInstallState>({
    phase: "idle",
    version: ATOPILE_PINNED_VERSION,
  });
  const report = (patch: Partial<AtopileInstallState>) =>
    SubscriptionRef.update(state, (current) => ({ ...current, ...patch }));
  const fail = (detail: string) => new AtopileInstallError({ detail });

  const executableExists = Effect.fn("AtopileInstaller.executableExists")(function* (
    filePath: string,
  ) {
    const info = yield* fs.stat(filePath).pipe(Effect.option);
    return Option.isSome(info) && info.value.type === "File" && (info.value.mode & 0o111) !== 0;
  });

  const downloadUv = Effect.fn("AtopileInstaller.downloadUv")(function* () {
    const asset = uvReleaseAsset(platform, arch);
    if ("unsupported" in asset) return yield* fail(asset.unsupported);
    const release = yield* http
      .execute(
        HttpClientRequest.get(UV_LATEST_RELEASE_URL).pipe(
          HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeGitHubRelease),
        Effect.mapError((error) =>
          fail(`Could not read uv's latest release from GitHub: ${error.message}`),
        ),
      );
    const download = release.assets.find((candidate) => candidate.name === asset.name);
    if (download === undefined) {
      return yield* fail(`uv ${release.tag_name} has no ${asset.name} asset.`);
    }
    yield* report({
      phase: "downloading-uv",
      message: `Downloading uv ${release.tag_name}.`,
      downloadedBytes: 0,
      totalBytes: download.size,
    });
    yield* fs.makeDirectory(uvDirectory, { recursive: true });
    const staging = yield* fs.makeTempDirectoryScoped({
      directory: uvDirectory,
      prefix: ".download-",
    });
    const stagedUv = path.join(staging, "uv");
    const extractor = new TarMemberExtractor("uv");
    let downloadedBytes = 0;
    let lastProgressAt = yield* Clock.currentTimeMillis;
    const response = yield* http.execute(HttpClientRequest.get(download.browser_download_url)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((error) => fail(`Could not download uv: ${error.message}`)),
    );
    yield* response.stream.pipe(
      Stream.tap((chunk) =>
        Effect.gen(function* () {
          downloadedBytes += chunk.byteLength;
          // Every update reaches every subscriber over the socket; batch them.
          const now = yield* Clock.currentTimeMillis;
          if (now - lastProgressAt < 250 && downloadedBytes < download.size) return;
          lastProgressAt = now;
          yield* report({ downloadedBytes });
        }),
      ),
      EffectNodeStream.pipeThroughDuplex({
        evaluate: () => NodeZlib.createGunzip(),
        onError: (cause) =>
          fail(
            `The uv archive could not be decompressed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      }),
      Stream.map((chunk) => extractor.push(chunk)),
      Stream.flattenIterable,
      Stream.run(fs.sink(stagedUv, { flag: "wx", mode: 0o755 })),
      Effect.mapError((error) =>
        isInstallError(error) ? error : fail(`Could not download uv: ${error.message}`),
      ),
      Effect.timeoutOrElse({
        duration: DOWNLOAD_TIMEOUT,
        orElse: () => Effect.fail(fail("Downloading uv took longer than 15 minutes.")),
      }),
    );
    if (!extractor.complete) {
      return yield* fail(`The uv archive ${asset.name} did not contain a uv executable.`);
    }
    yield* fs.chmod(stagedUv, 0o755);
    yield* fs.rename(stagedUv, managedUvPath);
    return managedUvPath;
  }, Effect.scoped);

  const locateUv = Effect.fn("AtopileInstaller.locateUv")(function* () {
    yield* report({ phase: "locating-uv", message: "Looking for uv." });
    const onPath = yield* resolveCommandPath("uv", { env }).pipe(
      Effect.option,
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcessPlatform, platform),
    );
    if (Option.isSome(onPath)) return onPath.value;
    if (yield* executableExists(managedUvPath)) return managedUvPath;
    return yield* downloadUv();
  });

  const warm = Effect.fn("AtopileInstaller.warm")(function* (uv: string, version: string) {
    yield* report({
      phase: "installing",
      message: `Preparing atopile ${version} in an isolated tool environment. The first run downloads Python and atopile.`,
      uvPath: uv,
    });
    const [command, ...prefix] = uvToolRunCommand(uv, version);
    const output = yield* processRunner
      .run({
        command: command!,
        args: [...prefix, "self-check"],
        cwd: env.HOME ?? env.USERPROFILE ?? config.stateDir,
        timeout: WARM_TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
        truncatedMarker: "\n[output truncated]\n",
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.mapError((error) => fail(`Could not start ${command}: ${error.message}`)));
    if (output.timedOut) {
      return yield* fail(`\`uv tool run\` did not finish within ${Duration.format(WARM_TIMEOUT)}.`);
    }
    if (output.code !== 0) {
      const tail =
        output.stderr.trim().slice(-STDERR_TAIL_CHARS) ||
        output.stdout.trim().slice(-STDERR_TAIL_CHARS);
      return yield* fail(`\`ato self-check\` exited with ${output.code}: ${tail}`);
    }
    return parseAtoVersion(output.stdout) ?? version;
  });

  const install = Effect.fn("AtopileInstaller.install")(
    function* (version: string) {
      const uv = yield* locateUv();
      const installedVersion = yield* warm(uv, version);
      yield* report({ phase: "verifying", message: "Recording the ato command." });
      const command = uvToolRunCommand(quoteCommandArg(uv), version).join(" ");
      yield* settings
        .updateSettings({ atopile: { command } })
        .pipe(Effect.mapError((error) => fail(`Could not save the ato command: ${error.message}`)));
      yield* report({
        phase: "succeeded",
        message: `atopile ${installedVersion} is ready.`,
        installedVersion,
      });
    },
    Effect.mapError((error) =>
      isInstallError(error) ? error : fail(`Could not install atopile: ${error.message}`),
    ),
  );

  const start: AtopileInstaller["Service"]["start"] = Effect.fn("AtopileInstaller.start")(
    function* (input: AtopileInstallStartInput) {
      return yield* gate.withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (isRunning(current)) return current;
          const version = input.version ?? ATOPILE_PINNED_VERSION;
          const next: AtopileInstallState = {
            phase: "locating-uv",
            version,
            message: "Looking for uv.",
          };
          yield* SubscriptionRef.set(state, next);
          const work = install(version).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? report({
                    phase: Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed",
                    message: Cause.hasInterruptsOnly(exit.cause)
                      ? "Installation cancelled. The ato command setting is unchanged."
                      : Option.getOrElse(
                          Option.map(Cause.findErrorOption(exit.cause), (error) => error.detail),
                          () => `Could not install atopile: ${Cause.pretty(exit.cause)}`,
                        ),
                  })
                : Effect.void,
            ),
            Effect.ignoreCause,
            Effect.ensuring(
              Effect.sync(() => {
                running = undefined;
              }),
            ),
          );
          running = yield* Effect.forkIn(Effect.interruptible(work), serviceScope);
          return next;
        }).pipe(Effect.uninterruptible),
      );
    },
  );

  const cancel: AtopileInstaller["Service"]["cancel"] = Effect.fn("AtopileInstaller.cancel")(
    function* () {
      return yield* gate.withPermit(
        Effect.gen(function* () {
          if (running !== undefined) yield* Fiber.interrupt(running);
          return yield* SubscriptionRef.get(state);
        }),
      );
    },
  );

  return AtopileInstaller.of({
    start,
    cancel,
    state: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
  });
});

/**
 * Requires `ProcessRunner`, `ServerSettingsService`, `ServerConfig`,
 * `HttpClient`, `FileSystem`, and `Path`; the server provides them.
 */
export const layer = Layer.effect(AtopileInstaller, make);
