// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import {
  type AtopileArtifact,
  type AtopileBuildResult,
  type AtopileBuildTarget,
  type AtopileDiagnostic,
  type AtopileExecutionError,
  AtopileInvalidInputError,
  type AtopileProjectInfo,
  AtopileProjectNotFoundError,
  type AtopileToolchainUnavailableError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as AtopileToolchain from "./AtopileToolchain.ts";
import { type AtoBuildTarget, parseAtoBuildOutput, stripAnsi } from "./atoOutput.ts";
import { recordAtoBuild } from "./atoReport.ts";
import {
  ATO_CONFIG_FILENAME,
  type AtoProjectConfig,
  expectedArtifacts,
  parseAtoConfig,
} from "./atoProject.ts";

/**
 * The `ato build` workflow shared by the MCP tools and the KiCad viewer's Build
 * button: read `ato.yaml`, run the toolchain in the project, parse the output,
 * and report which artifacts exist afterwards.
 */

const OUTPUT_TAIL_CHARS = 4000;

export interface AtoBuildRequest {
  readonly build?: string | undefined;
  readonly targets?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface AtoProjectLocation {
  readonly projectDir: string;
  readonly configPath: string;
  readonly config: AtoProjectConfig;
}

/** `ato build` argv for the requested build and extra targets. */
export function buildArgs(input: AtoBuildRequest): string[] {
  const args = ["build"];
  if (input.build !== undefined) args.push("--build", input.build);
  for (const target of input.targets ?? []) args.push("--target", target);
  return args;
}

const exists = (fs: FileSystem.FileSystem, path: string) =>
  fs.exists(path).pipe(Effect.orElseSucceed(() => false));

/** Read and parse the project's `ato.yaml`. */
export const readAtoProject = Effect.fn("atopile.readAtoProject")(function* (
  projectDir: string,
): Effect.fn.Return<
  AtoProjectLocation,
  AtopileProjectNotFoundError | AtopileInvalidInputError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const configPath = NodePath.join(projectDir, ATO_CONFIG_FILENAME);
  const text = yield* fs
    .readFileString(configPath)
    .pipe(Effect.mapError(() => new AtopileProjectNotFoundError({ projectDir })));
  const config = yield* Effect.try({
    try: () => parseAtoConfig(text),
    catch: (error) =>
      new AtopileInvalidInputError({
        detail: `${configPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });
  return { projectDir, configPath, config };
});

/** Project facts an agent needs before building: builds, board paths, directories. */
export const describeAtoProject = Effect.fn("atopile.describeAtoProject")(function* (
  location: AtoProjectLocation,
): Effect.fn.Return<AtopileProjectInfo, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const { projectDir, configPath, config } = location;
  const builds: AtopileProjectInfo["builds"][number][] = [];
  for (const build of config.builds) {
    const layoutExists = yield* exists(fs, NodePath.join(projectDir, build.layoutPcb));
    builds.push({
      name: build.name,
      ...(build.entry === undefined ? {} : { entry: build.entry }),
      layoutPcb: build.layoutPcb,
      layoutExists,
    });
  }
  return {
    projectDir,
    configPath,
    ...(config.requiresAtopile === undefined ? {} : { requiresAtopile: config.requiresAtopile }),
    builds,
    srcDir: config.srcDir,
    layoutDir: config.layoutDir,
    buildDir: config.buildDir,
    ...(config.componentsServiceUrl === undefined
      ? {}
      : { componentsServiceUrl: config.componentsServiceUrl }),
    dependencies: [...config.dependencies],
  };
});

function toContractDiagnostic(diagnostic: {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}): AtopileDiagnostic {
  return {
    message: diagnostic.message,
    ...(diagnostic.file === undefined ? {} : { file: diagnostic.file }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
  };
}

function toContractTarget(target: AtoBuildTarget): AtopileBuildTarget {
  return {
    ...(target.name === undefined ? {} : { name: target.name }),
    ok: target.ok,
    stages: [...target.stages],
    errors: target.errors.map(toContractDiagnostic),
    warnings: target.warnings.map(toContractDiagnostic),
    ...(target.totalSeconds === undefined ? {} : { totalSeconds: target.totalSeconds }),
  };
}

/** Run `ato build` in `location.projectDir` and structure the outcome. */
export const runAtoBuild = Effect.fn("atopile.runAtoBuild")(function* (
  location: AtoProjectLocation,
  input: AtoBuildRequest,
): Effect.fn.Return<
  AtopileBuildResult,
  AtopileInvalidInputError | AtopileToolchainUnavailableError | AtopileExecutionError,
  AtopileToolchain.AtopileToolchain | FileSystem.FileSystem
> {
  const { projectDir, config } = location;
  if (input.build !== undefined && !config.builds.some((b) => b.name === input.build)) {
    return yield* new AtopileInvalidInputError({
      detail: `Build ${input.build} is not defined in ato.yaml. Available: ${config.builds.map((b) => b.name).join(", ") || "(none)"}.`,
    });
  }
  const toolchain = yield* AtopileToolchain.AtopileToolchain;
  const fs = yield* FileSystem.FileSystem;
  const startedAt = yield* Clock.currentTimeMillis;
  const run = yield* toolchain.run({
    args: buildArgs(input),
    cwd: projectDir,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const finishedAt = yield* Clock.currentTimeMillis;

  const combined = `${run.stdout}\n${run.stderr}`;
  const exitCode = run.exitCode ?? -1;
  const parsed = parseAtoBuildOutput(combined, exitCode);
  const errors = parsed.errors.map(toContractDiagnostic);
  if (run.timedOut) errors.push({ message: "ato build exceeded its time limit and was stopped." });

  const builtBuilds =
    input.build === undefined ? config.builds : config.builds.filter((b) => b.name === input.build);
  const artifacts: AtopileArtifact[] = [];
  for (const build of builtBuilds) {
    for (const artifact of expectedArtifacts(config, build)) {
      if (yield* exists(fs, NodePath.join(projectDir, artifact.path))) artifacts.push(artifact);
    }
  }

  const result: AtopileBuildResult = {
    ok: parsed.ok && !run.timedOut,
    exitCode,
    durationMs: finishedAt - startedAt,
    command: [...run.command],
    projectDir,
    targets: parsed.targets.map(toContractTarget),
    errors,
    warnings: parsed.warnings.map(toContractDiagnostic),
    artifacts,
    outputTail: stripAnsi(combined).trimEnd().slice(-OUTPUT_TAIL_CHARS),
  };
  recordAtoBuild(projectDir, input.build, result, finishedAt);
  return result;
});
