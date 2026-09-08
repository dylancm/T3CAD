// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import {
  type AtopileArtifact,
  type AtopileBuildInput,
  type AtopileBuildResult,
  type AtopileBuildTarget,
  type AtopileDiagnostic,
  AtopileExecutionError,
  AtopileInvalidInputError,
  type AtopileProjectInfo,
  AtopileProjectNotFoundError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as AtopileToolchain from "../../../atopile/AtopileToolchain.ts";
import { type AtoBuildTarget, parseAtoBuildOutput, stripAnsi } from "../../../atopile/atoOutput.ts";
import {
  ATO_CONFIG_FILENAME,
  type AtoProjectConfig,
  expectedArtifacts,
  parseAtoConfig,
} from "../../../atopile/atoProject.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AtopileToolkit } from "./tools.ts";

const OUTPUT_TAIL_CHARS = 4000;

/** `ato build` argv for the requested build and extra targets. */
export function buildArgs(input: Pick<AtopileBuildInput, "build" | "targets">): string[] {
  const args = ["build"];
  if (input.build !== undefined) args.push("--build", input.build);
  for (const target of input.targets ?? []) args.push("--target", target);
  return args;
}

/**
 * Absolute project directory, or an error when it escapes the workspace.
 * Agents run with the workspace as their sandbox; a project outside it would
 * let a tool call reach arbitrary paths on the host.
 */
export function resolveProjectDir(
  workspaceRoot: string,
  projectDir: string | undefined,
): string | AtopileInvalidInputError {
  const absolute = NodePath.resolve(workspaceRoot, projectDir ?? ".");
  const relative = NodePath.relative(workspaceRoot, absolute);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    return new AtopileInvalidInputError({
      detail: `projectDir ${projectDir ?? "."} is outside the workspace ${workspaceRoot}.`,
    });
  }
  return absolute;
}

const resolveWorkspaceRoot = Effect.fn("AtopileToolkit.resolveWorkspaceRoot")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const lookupFailed = (error: { readonly message: string }) =>
    new AtopileExecutionError({ command: [], detail: `project lookup failed: ${error.message}` });
  const thread = yield* query
    .getThreadShellById(invocation.threadId)
    .pipe(Effect.mapError(lookupFailed));
  if (Option.isNone(thread)) {
    return yield* new AtopileInvalidInputError({
      detail: "This agent session is not attached to a thread with a project.",
    });
  }
  const project = yield* query
    .getProjectShellById(thread.value.projectId)
    .pipe(Effect.mapError(lookupFailed));
  if (Option.isNone(project)) {
    return yield* new AtopileInvalidInputError({
      detail: "The thread's project no longer exists.",
    });
  }
  return thread.value.worktreePath ?? project.value.workspaceRoot;
});

const locateProject = Effect.fn("AtopileToolkit.locateProject")(function* (
  projectDirInput: string | undefined,
) {
  const workspaceRoot = yield* resolveWorkspaceRoot();
  const resolved = resolveProjectDir(workspaceRoot, projectDirInput);
  if (typeof resolved !== "string") return yield* resolved;
  const fs = yield* FileSystem.FileSystem;
  const configPath = NodePath.join(resolved, ATO_CONFIG_FILENAME);
  const text = yield* fs
    .readFileString(configPath)
    .pipe(Effect.mapError(() => new AtopileProjectNotFoundError({ projectDir: resolved })));
  const config = yield* Effect.try({
    try: () => parseAtoConfig(text),
    catch: (error) =>
      new AtopileInvalidInputError({
        detail: `${configPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });
  return { projectDir: resolved, configPath, config };
});

const exists = (fs: FileSystem.FileSystem, path: string) =>
  fs.exists(path).pipe(Effect.orElseSucceed(() => false));

const describeProject = Effect.fn("AtopileToolkit.describeProject")(function* (
  projectDir: string,
  configPath: string,
  config: AtoProjectConfig,
): Effect.fn.Return<AtopileProjectInfo, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
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

const handlers = {
  ato_status: () =>
    Effect.gen(function* () {
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      return yield* toolchain.status();
    }),

  ato_project: (input) =>
    Effect.gen(function* () {
      const { projectDir, configPath, config } = yield* locateProject(input?.projectDir);
      return yield* describeProject(projectDir, configPath, config);
    }),

  ato_build: (input) =>
    Effect.gen(function* () {
      const { projectDir, config } = yield* locateProject(input?.projectDir);
      if (input?.build !== undefined && !config.builds.some((b) => b.name === input.build)) {
        return yield* new AtopileInvalidInputError({
          detail: `Build ${input.build} is not defined in ato.yaml. Available: ${config.builds.map((b) => b.name).join(", ") || "(none)"}.`,
        });
      }
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      const fs = yield* FileSystem.FileSystem;
      const startedAt = yield* Clock.currentTimeMillis;
      const run = yield* toolchain.run({
        args: buildArgs(input ?? {}),
        cwd: projectDir,
        ...(input?.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });
      const finishedAt = yield* Clock.currentTimeMillis;

      const combined = `${run.stdout}\n${run.stderr}`;
      const exitCode = run.exitCode ?? -1;
      const parsed = parseAtoBuildOutput(combined, exitCode);
      const errors = parsed.errors.map(toContractDiagnostic);
      if (run.timedOut) {
        errors.push({ message: `ato build exceeded its time limit and was stopped.` });
      }

      const builtBuilds =
        input?.build === undefined
          ? config.builds
          : config.builds.filter((b) => b.name === input.build);
      const artifacts: AtopileArtifact[] = [];
      for (const build of builtBuilds) {
        for (const artifact of expectedArtifacts(config, build)) {
          if (yield* exists(fs, NodePath.join(projectDir, artifact.path))) artifacts.push(artifact);
        }
      }

      return {
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
      } satisfies AtopileBuildResult;
    }),
} satisfies Parameters<typeof AtopileToolkit.toLayer>[0];

export const AtopileToolkitHandlersLive = AtopileToolkit.toLayer(handlers);
