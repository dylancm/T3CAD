/**
 * Locates and runs the `ato` CLI.
 *
 * Resolution order, first hit wins:
 * 1. The `atopile.command` server setting (Settings → atopile), a full
 *    command line such as `uv run --project /src/atopile ato`.
 * 2. `T3CAD_ATO_COMMAND`, the same thing as an environment variable.
 * 3. `ato` on PATH.
 * 4. `uv` on PATH, running the pinned PyPI release through `uv tool run`.
 *
 * Settings are read on every resolution rather than at layer construction so
 * an edit applies to the next build without a restart. Nothing is installed
 * on the user's behalf; a missing toolchain surfaces as a typed error the
 * agent can explain.
 */

import {
  AtopileExecutionError,
  type AtopileSettings,
  type AtopileToolchainSource,
  type AtopileToolchainStatus,
  AtopileToolchainUnavailableError,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export const ATO_COMMAND_ENV = "T3CAD_ATO_COMMAND";
/** atopile's own knob for where it writes its SQLite build logs. */
export const ATO_LOG_DIR_ENV = "FBRK_LOG_DIR";
export const ATOPILE_PINNED_RELEASE = "atopile==0.15.8";
export const UV_FALLBACK_COMMAND: ReadonlyArray<string> = [
  "uv",
  "tool",
  "run",
  "-p",
  "3.14",
  "--from",
  ATOPILE_PINNED_RELEASE,
  "ato",
];

const PROBE_TIMEOUT = Duration.seconds(30);
const DEFAULT_RUN_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TRUNCATED_MARKER = "\n[output truncated]\n";

/** Split a command line on whitespace, honouring single and double quotes. */
export function splitCommandLine(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let hasToken = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) out.push(current);
      current = "";
      hasToken = false;
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) out.push(current);
  return out;
}

/** First `major.minor…` token in `ato self-check` output. */
export function parseAtoVersion(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /(\d+\.\d+[\w.+-]*)/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

export interface ResolvedAtoCommand {
  readonly command: ReadonlyArray<string>;
  readonly source: AtopileToolchainSource;
  /** `FBRK_LOG_DIR` for the child process; absent leaves atopile's default. */
  readonly logDir?: string | undefined;
}

export interface AtopileRunInput {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs?: number | undefined;
}

export interface AtopileRunOutput {
  readonly command: ReadonlyArray<string>;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class AtopileToolchain extends Context.Service<
  AtopileToolchain,
  {
    readonly status: () => Effect.Effect<AtopileToolchainStatus>;
    readonly run: (
      input: AtopileRunInput,
    ) => Effect.Effect<AtopileRunOutput, AtopileToolchainUnavailableError | AtopileExecutionError>;
  }
>()("t3/atopile/AtopileToolchain") {}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const settingsService = yield* ServerSettingsService;
  const env = yield* HostProcessEnvironment;
  // PATH lookups need the platform services; capture them once so the service
  // methods themselves have no requirements.
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandAvailable = (command: string) =>
    isCommandAvailable(command, { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  // An unreadable settings file must not make the toolchain vanish mid-session;
  // fall back to the environment lookup and say so.
  const readAtopileSettings: Effect.Effect<AtopileSettings> = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.atopile),
    Effect.catch((error) =>
      Effect.logWarning(
        `atopile settings could not be read; using the environment lookup: ${error.message}`,
      ).pipe(Effect.as(DEFAULT_SERVER_SETTINGS.atopile)),
    ),
  );

  const resolveCommand = Effect.fn("AtopileToolchain.resolveCommand")(
    function* (): Effect.fn.Return<ResolvedAtoCommand | undefined> {
      const settings = yield* readAtopileSettings;
      const logDir = settings.logDir.length > 0 ? { logDir: settings.logDir } : {};
      const withLogDir = (
        resolved: Pick<ResolvedAtoCommand, "command" | "source"> | undefined,
      ): ResolvedAtoCommand | undefined =>
        resolved === undefined ? undefined : { ...resolved, ...logDir };
      if (settings.command.length > 0) {
        const command = splitCommandLine(settings.command);
        return withLogDir(command.length > 0 ? { command, source: "setting" } : undefined);
      }
      const override = env[ATO_COMMAND_ENV]?.trim();
      if (override) {
        const command = splitCommandLine(override);
        return withLogDir(command.length > 0 ? { command, source: "env" } : undefined);
      }
      if (yield* commandAvailable("ato")) return withLogDir({ command: ["ato"], source: "path" });
      if (yield* commandAvailable("uv")) {
        return withLogDir({ command: UV_FALLBACK_COMMAND, source: "uv" });
      }
      return undefined;
    },
  );

  const unavailableDetail = `no \`ato\` on PATH, no \`uv\` to run ${ATOPILE_PINNED_RELEASE}, and neither the ato command setting nor ${ATO_COMMAND_ENV} is set`;

  const runResolved = Effect.fn("AtopileToolchain.runResolved")(function* (
    resolved: ResolvedAtoCommand,
    input: AtopileRunInput,
  ) {
    const [executable, ...prefix] = resolved.command;
    const output = yield* processRunner
      .run({
        command: executable!,
        args: [...prefix, ...input.args],
        cwd: input.cwd,
        ...(resolved.logDir === undefined ? {} : { env: { [ATO_LOG_DIR_ENV]: resolved.logDir } }),
        timeout: Duration.millis(input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS),
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
        truncatedMarker: TRUNCATED_MARKER,
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new AtopileExecutionError({ command: resolved.command, detail: error.message }),
        ),
      );
    return {
      command: resolved.command,
      exitCode: output.code === null ? null : Number(output.code),
      stdout: output.stdout,
      stderr: output.stderr,
      timedOut: output.timedOut,
    } satisfies AtopileRunOutput;
  });

  const status: AtopileToolchain["Service"]["status"] = Effect.fn("AtopileToolchain.status")(
    function* (): Effect.fn.Return<AtopileToolchainStatus> {
      const resolved = yield* resolveCommand();
      if (resolved === undefined) {
        const missing: AtopileToolchainStatus = {
          available: false,
          command: [],
          error: unavailableDetail,
        };
        return missing;
      }
      const probe = yield* runResolved(resolved, {
        args: ["self-check"],
        cwd: env.HOME ?? env.USERPROFILE ?? ".",
        timeoutMs: Duration.toMillis(PROBE_TIMEOUT),
      }).pipe(Effect.option);
      if (probe._tag === "None" || probe.value.exitCode !== 0) {
        const detail =
          probe._tag === "None"
            ? `could not start ${resolved.command.join(" ")}`
            : `\`${resolved.command.join(" ")} self-check\` exited with ${probe.value.exitCode}: ${probe.value.stderr.trim().slice(-400)}`;
        const broken: AtopileToolchainStatus = {
          available: false,
          command: resolved.command,
          source: resolved.source,
          ...(resolved.logDir === undefined ? {} : { logDir: resolved.logDir }),
          error: detail,
        };
        return broken;
      }
      const version = parseAtoVersion(probe.value.stdout);
      const ready: AtopileToolchainStatus = {
        available: true,
        command: resolved.command,
        source: resolved.source,
        ...(version === undefined ? {} : { version }),
        ...(resolved.logDir === undefined ? {} : { logDir: resolved.logDir }),
      };
      return ready;
    },
  );

  const run: AtopileToolchain["Service"]["run"] = Effect.fn("AtopileToolchain.run")(function* (
    input: AtopileRunInput,
  ) {
    const resolved = yield* resolveCommand();
    if (resolved === undefined) {
      return yield* new AtopileToolchainUnavailableError({ detail: unavailableDetail });
    }
    return yield* runResolved(resolved, input);
  });

  return AtopileToolchain.of({ status, run });
});

/**
 * Requires `ProcessRunner`, `ServerSettingsService`, `FileSystem`, and
 * `Path`; the server provides them.
 */
export const layer = Layer.effect(AtopileToolchain, make);
