// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import { AtopileExecutionError, AtopileInvalidInputError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as AtopileToolchain from "../../../atopile/AtopileToolchain.ts";
import { describeAtoProject, readAtoProject, runAtoBuild } from "../../../atopile/atoBuild.ts";
import { runAtoValidate } from "../../../atopile/atoValidate.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AtopileToolkit } from "./tools.ts";

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
  return yield* readAtoProject(resolved);
});

const handlers = {
  ato_status: () =>
    Effect.gen(function* () {
      const toolchain = yield* AtopileToolchain.AtopileToolchain;
      return yield* toolchain.status();
    }),

  ato_project: (input) =>
    Effect.gen(function* () {
      const location = yield* locateProject(input?.projectDir);
      return yield* describeAtoProject(location);
    }),

  ato_validate: (input) =>
    Effect.gen(function* () {
      const location = yield* locateProject(input?.projectDir);
      return yield* runAtoValidate(location, input ?? {});
    }),

  ato_build: (input) =>
    Effect.gen(function* () {
      const location = yield* locateProject(input?.projectDir);
      return yield* runAtoBuild(location, input ?? {});
    }),
} satisfies Parameters<typeof AtopileToolkit.toLayer>[0];

export const AtopileToolkitHandlersLive = AtopileToolkit.toLayer(handlers);
