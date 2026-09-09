// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import {
  type AtopileDiagnostic,
  type AtopileExecutionError,
  AtopileInvalidInputError,
  type AtopileToolchainUnavailableError,
  type AtopileValidateResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as AtopileToolchain from "./AtopileToolchain.ts";
import type { AtoProjectLocation } from "./atoBuild.ts";
import { parseAtoValidateOutput } from "./atoOutput.ts";
import type { AtoProjectConfig } from "./atoProject.ts";

/**
 * The `ato validate` workflow behind the `ato_validate` MCP tool: compile
 * `.ato` files without picking parts or touching the board, so an agent can
 * check an edit in about a second before paying for `ato build`.
 */

/** Compiling is quick; a run this long means the toolchain is stuck. */
export const VALIDATE_TIMEOUT_MS = 120_000;

export interface AtoValidateRequest {
  readonly files?: readonly string[] | undefined;
}

/** `ato validate` argv for the given project-relative files. */
export function validateArgs(files: readonly string[]): string[] {
  return ["validate", ...files];
}

function toPosix(path: string): string {
  return path.split(NodePath.sep).join("/");
}

/**
 * The `.ato` file of every build entry in `ato.yaml` (`path.ato:Module`),
 * project-relative and deduplicated. Python entries are not validatable.
 */
export function entryFiles(config: AtoProjectConfig): string[] {
  const out: string[] = [];
  for (const build of config.builds) {
    const file = build.entry?.split(":")[0];
    if (file === undefined || !file.endsWith(".ato")) continue;
    const normalized = NodePath.posix.normalize(file).replace(/^\.\//, "");
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Project-relative POSIX path for one requested file, or an error when it is
 * not an `.ato` file inside the project. A path outside the project would let
 * a tool call compile arbitrary files on the host.
 */
export function resolveValidateFile(
  projectDir: string,
  file: string,
): string | AtopileInvalidInputError {
  const absolute = NodePath.resolve(projectDir, file);
  const relative = NodePath.relative(projectDir, absolute);
  if (relative.length === 0 || relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    return new AtopileInvalidInputError({
      detail: `${file} is outside the project directory ${projectDir}.`,
    });
  }
  if (!relative.endsWith(".ato")) {
    return new AtopileInvalidInputError({ detail: `${file} is not an .ato file.` });
  }
  return toPosix(relative);
}

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

/** Run `ato validate` in `location.projectDir` on the requested or default files. */
export const runAtoValidate = Effect.fn("atopile.runAtoValidate")(function* (
  location: AtoProjectLocation,
  input: AtoValidateRequest,
): Effect.fn.Return<
  AtopileValidateResult,
  AtopileInvalidInputError | AtopileToolchainUnavailableError | AtopileExecutionError,
  AtopileToolchain.AtopileToolchain | FileSystem.FileSystem
> {
  const { projectDir, config } = location;
  const files: string[] = [];
  for (const file of input.files ?? entryFiles(config)) {
    const resolved = resolveValidateFile(projectDir, file);
    if (typeof resolved !== "string") return yield* resolved;
    if (!files.includes(resolved)) files.push(resolved);
  }
  if (files.length === 0) {
    return yield* new AtopileInvalidInputError({
      detail:
        "Nothing to validate: pass files, or give each build in ato.yaml an entry such as main.ato:App.",
    });
  }
  const fs = yield* FileSystem.FileSystem;
  for (const file of files) {
    const present = yield* fs
      .exists(NodePath.join(projectDir, file))
      .pipe(Effect.orElseSucceed(() => false));
    if (!present) {
      return yield* new AtopileInvalidInputError({
        detail: `${file} does not exist in ${projectDir}.`,
      });
    }
  }

  const toolchain = yield* AtopileToolchain.AtopileToolchain;
  const startedAt = yield* Clock.currentTimeMillis;
  const run = yield* toolchain.run({
    args: validateArgs(files),
    cwd: projectDir,
    timeoutMs: VALIDATE_TIMEOUT_MS,
  });
  const finishedAt = yield* Clock.currentTimeMillis;

  const exitCode = run.exitCode ?? -1;
  const parsed = parseAtoValidateOutput(`${run.stdout}\n${run.stderr}`, exitCode, files);
  const diagnostics = parsed.diagnostics.map(toContractDiagnostic);
  if (run.timedOut) {
    diagnostics.push({ message: "ato validate exceeded its time limit and was stopped." });
  }
  return {
    ok: parsed.ok && !run.timedOut,
    exitCode,
    durationMs: finishedAt - startedAt,
    command: [...run.command],
    projectDir,
    files: parsed.files.map((file) => ({ path: file.path, ok: file.ok })),
    diagnostics,
  };
});
