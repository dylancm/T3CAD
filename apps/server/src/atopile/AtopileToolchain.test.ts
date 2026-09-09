import { afterEach, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ServerSettings } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { DeepPartial } from "@t3tools/shared/Struct";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as AtopileToolchain from "./AtopileToolchain.ts";

const runMock = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>();

const ProcessRunnerTest = Layer.succeed(
  ProcessRunner.ProcessRunner,
  ProcessRunner.ProcessRunner.of({ run: (input) => runMock(input) }),
);

const processOutput = (stdout: string, code = 0) =>
  Effect.succeed({
    stdout,
    stderr: "",
    code: ChildProcessSpawner.ExitCode(code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  });

const spawnFailure: ProcessRunner.ProcessRunner["Service"]["run"] = (input) =>
  Effect.fail(
    new ProcessRunner.ProcessSpawnError({
      command: input.command,
      argumentCount: input.args.length,
      cwd: input.cwd,
      cause: PlatformError.systemError({
        _tag: "NotFound",
        module: "ChildProcess",
        method: "spawn",
        description: "not installed",
      }),
    }),
  );

const toolchainDependencies = (env: NodeJS.ProcessEnv, settings: DeepPartial<ServerSettings>) =>
  Layer.mergeAll(
    ProcessRunnerTest,
    ServerSettingsModule.layerTest(settings),
    NodeServices.layer,
    Layer.succeed(HostProcessEnvironment, env),
    Layer.succeed(HostProcessPlatform, "linux"),
  );

const toolchainWith = (env: NodeJS.ProcessEnv, settings: DeepPartial<ServerSettings> = {}) =>
  AtopileToolchain.layer.pipe(Layer.provide(toolchainDependencies(env, settings)));

/** A toolchain whose PATH holds only an executable stub named `name`. */
const toolchainWithFakeBinary = (name: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const bin = yield* fs.makeTempDirectoryScoped({ prefix: `t3cad-${name}-path-` });
      yield* fs.writeFileString(`${bin}/${name}`, "#!/bin/sh\nexit 0\n");
      yield* fs.chmod(`${bin}/${name}`, 0o755);
      return toolchainWith({ PATH: bin, HOME: "/home/test" });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

afterEach(() => {
  runMock.mockReset();
});

describe("splitCommandLine", () => {
  it("splits on whitespace and honours quotes", () => {
    expect(AtopileToolchain.splitCommandLine("uv run --project '/my dir/atopile' ato")).toEqual([
      "uv",
      "run",
      "--project",
      "/my dir/atopile",
      "ato",
    ]);
    expect(AtopileToolchain.splitCommandLine("  ato  ")).toEqual(["ato"]);
    expect(AtopileToolchain.splitCommandLine("")).toEqual([]);
  });
});

describe("parseAtoVersion", () => {
  it("finds the version among warning lines", () => {
    const stdout = "10:23 W atopile.cli.motd  maintenance mode\n0.15.8\n";
    expect(AtopileToolchain.parseAtoVersion(stdout)).toBe("0.15.8");
    expect(AtopileToolchain.parseAtoVersion("0.14.1004.post1.dev76+g619eda7f7")).toBe(
      "0.14.1004.post1.dev76+g619eda7f7",
    );
    expect(AtopileToolchain.parseAtoVersion("nothing here")).toBeUndefined();
  });
});

describe("AtopileToolchain", () => {
  it.effect("prefers the command setting over the environment variable and sets the log dir", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("0.15.8\n"));
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const status = yield* toolchain.status();
      expect(status).toEqual({
        available: true,
        command: ["uv", "run", "--project", "/my dir/atopile", "ato"],
        source: "setting",
        version: "0.15.8",
        logDir: "/home/test/.ato/logs-0.15",
      });
      const probe = runMock.mock.calls[0]![0];
      expect(probe.command).toBe("uv");
      expect(probe.args).toEqual(["run", "--project", "/my dir/atopile", "ato", "self-check"]);
      expect(probe.env).toEqual({ FBRK_LOG_DIR: "/home/test/.ato/logs-0.15" });

      yield* toolchain.run({ args: ["build"], cwd: "/ws/board" });
      const build = runMock.mock.calls[1]![0];
      expect(build.command).toBe("uv");
      expect(build.args).toEqual(["run", "--project", "/my dir/atopile", "ato", "build"]);
      expect(build.env).toEqual({ FBRK_LOG_DIR: "/home/test/.ato/logs-0.15" });
    }).pipe(
      Effect.provide(
        toolchainWith(
          { PATH: "", HOME: "/home/test", T3CAD_ATO_COMMAND: "/nope/ato" },
          {
            atopile: {
              command: "uv run --project '/my dir/atopile' ato",
              logDir: "/home/test/.ato/logs-0.15",
            },
          },
        ),
      ),
    ),
  );

  it.effect("reads the setting on every resolution, so an edit applies without a restart", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("0.15.8\n"));
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      expect((yield* toolchain.status()).source).toBe("env");
      yield* settings.updateSettings({ atopile: { command: "/opt/ato/bin/ato" } });
      const status = yield* toolchain.status();
      expect(status.source).toBe("setting");
      expect(status.command).toEqual(["/opt/ato/bin/ato"]);
    }).pipe(
      Effect.provide(
        // provideMerge keeps the settings service reachable for the edit above.
        AtopileToolchain.layer.pipe(
          Layer.provideMerge(
            toolchainDependencies(
              { PATH: "", HOME: "/home/test", T3CAD_ATO_COMMAND: "/env/ato" },
              {},
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("prefers an explicit command override and reports its version", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("0.14.1004+g619eda7f7\n"));
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const status = yield* toolchain.status();
      expect(status).toEqual({
        available: true,
        command: ["uv", "run", "--project", "/src/atopile", "ato"],
        source: "env",
        version: "0.14.1004+g619eda7f7",
      });
      expect(runMock).toHaveBeenCalledTimes(1);
      const call = runMock.mock.calls[0]![0];
      expect(call.command).toBe("uv");
      expect(call.args).toEqual(["run", "--project", "/src/atopile", "ato", "self-check"]);
      // No log directory configured: atopile keeps its own default.
      expect(call.env).toBeUndefined();
    }).pipe(
      Effect.provide(
        toolchainWith(
          {
            PATH: "",
            HOME: "/home/test",
            T3CAD_ATO_COMMAND: "uv run --project /src/atopile ato",
          },
          // Whitespace-only settings normalize to empty and fall through.
          { atopile: { command: "   ", logDir: " " } },
        ),
      ),
    ),
  );

  it.effect("finds ato on PATH and forwards build arguments with the project cwd", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("Build successful!", 0));

      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const result = yield* toolchain.run({
        args: ["build", "--build", "default"],
        cwd: "/ws/board",
        timeoutMs: 1234,
      });
      expect(result.command).toEqual(["ato"]);
      expect(result.exitCode).toBe(0);
      const call = runMock.mock.calls[0]![0];
      expect(call.command).toBe("ato");
      expect(call.args).toEqual(["build", "--build", "default"]);
      expect(call.cwd).toBe("/ws/board");
      expect(call.timeoutBehavior).toBe("timedOutResult");
    }).pipe(Effect.provide(toolchainWithFakeBinary("ato"))),
  );

  it.effect("falls back to uv tool run for the pinned release", () =>
    Effect.gen(function* () {
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      runMock.mockImplementation(() => processOutput("0.15.8\n"));
      const status = yield* toolchain.status();
      expect(status.available).toBe(true);
      expect(status.source).toBe("uv");
      expect(status.command).toEqual(AtopileToolchain.UV_FALLBACK_COMMAND);
    }).pipe(Effect.provide(toolchainWithFakeBinary("uv"))),
  );

  it.effect("reports an unavailable toolchain instead of failing, and run() fails typed", () =>
    Effect.gen(function* () {
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const status = yield* toolchain.status();
      expect(status.available).toBe(false);
      expect(status.command).toEqual([]);
      expect(status.error).toContain("T3CAD_ATO_COMMAND");
      const failure = yield* toolchain.run({ args: ["build"], cwd: "/ws" }).pipe(Effect.flip);
      expect(failure._tag).toBe("AtopileToolchainUnavailableError");
      expect(runMock).not.toHaveBeenCalled();
    }).pipe(Effect.provide(toolchainWith({ PATH: "", HOME: "/home/test" }))),
  );

  it.effect("surfaces a spawn failure of an overridden command as an execution error", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(spawnFailure);
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const status = yield* toolchain.status();
      expect(status.available).toBe(false);
      expect(status.error).toContain("could not start");
      const failure = yield* toolchain.run({ args: ["build"], cwd: "/ws" }).pipe(Effect.flip);
      expect(failure._tag).toBe("AtopileExecutionError");
    }).pipe(Effect.provide(toolchainWith({ PATH: "", T3CAD_ATO_COMMAND: "/nope/ato" }))),
  );
});
