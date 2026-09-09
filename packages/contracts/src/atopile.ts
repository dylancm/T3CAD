import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_DIR_DESCRIPTION =
  "Directory holding ato.yaml, relative to the workspace root or absolute within it. Omit to use the workspace root.";

/** Where the `ato` executable came from, in resolution order. */
export const AtopileToolchainSource = Schema.Literals(["setting", "env", "path", "uv"]);
export type AtopileToolchainSource = typeof AtopileToolchainSource.Type;

export const AtopileToolchainStatus = Schema.Struct({
  available: Schema.Boolean,
  /** argv prefix that runs `ato`; empty when unavailable. */
  command: Schema.Array(Schema.String),
  source: Schema.optionalKey(AtopileToolchainSource),
  version: Schema.optionalKey(Schema.String),
  /** `FBRK_LOG_DIR` handed to every `ato` process, when configured. */
  logDir: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type AtopileToolchainStatus = typeof AtopileToolchainStatus.Type;

/** PyPI release the Install button and the `uv tool run` fallback use unless told otherwise. */
export const ATOPILE_PINNED_VERSION = "0.15.8";

export const AtopileInstallPhase = Schema.Literals([
  "idle",
  "locating-uv",
  "downloading-uv",
  "installing",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
]);
export type AtopileInstallPhase = typeof AtopileInstallPhase.Type;

const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * Progress of the one-at-a-time toolchain install a server runs. The
 * `installing` phase warms `uv tool run` for the requested release, so most of
 * the wall time lands there without byte counts.
 */
export const AtopileInstallState = Schema.Struct({
  phase: AtopileInstallPhase,
  /** Release requested for this (or the last) install. */
  version: Schema.String,
  message: Schema.optionalKey(Schema.String),
  downloadedBytes: Schema.optionalKey(ByteCount),
  totalBytes: Schema.optionalKey(ByteCount),
  /** Version `ato self-check` reported once the install succeeded. */
  installedVersion: Schema.optionalKey(Schema.String),
  /** `uv` executable the install used, on PATH or downloaded into the state directory. */
  uvPath: Schema.optionalKey(Schema.String),
});
export type AtopileInstallState = typeof AtopileInstallState.Type;

export const AtopileInstallStartInput = Schema.Struct({
  /** PyPI release to prepare. Defaults to `ATOPILE_PINNED_VERSION`. */
  version: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
});
export type AtopileInstallStartInput = typeof AtopileInstallStartInput.Type;

export const AtopileDiagnostic = Schema.Struct({
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
});
export type AtopileDiagnostic = typeof AtopileDiagnostic.Type;

export const AtopileStage = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  seconds: Schema.Number,
});
export type AtopileStage = typeof AtopileStage.Type;

export const AtopileBuildTarget = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  ok: Schema.Boolean,
  stages: Schema.Array(AtopileStage),
  errors: Schema.Array(AtopileDiagnostic),
  warnings: Schema.Array(AtopileDiagnostic),
  totalSeconds: Schema.optionalKey(Schema.Number),
});
export type AtopileBuildTarget = typeof AtopileBuildTarget.Type;

export const AtopileArtifactKind = Schema.Literals([
  "pcb",
  "netlist",
  "bom-csv",
  "bom-json",
  "variables",
  "manifest",
  "glb",
  "step",
  "gerbers",
  "pick-and-place",
  "other",
]);
export type AtopileArtifactKind = typeof AtopileArtifactKind.Type;

export const AtopileArtifact = Schema.Struct({
  kind: AtopileArtifactKind,
  /** Path relative to the project directory. */
  path: TrimmedNonEmptyString,
});
export type AtopileArtifact = typeof AtopileArtifact.Type;

export const AtopileBuildInput = Schema.Struct({
  projectDir: Schema.optional(
    Schema.String.annotate({ description: PROJECT_DIR_DESCRIPTION }),
  ).annotate({ description: PROJECT_DIR_DESCRIPTION }),
  build: Schema.optional(
    Schema.String.annotate({
      description: "Build name under `builds:` in ato.yaml. Omit to run every configured build.",
    }),
  ).annotate({
    description: "Build name under `builds:` in ato.yaml. Omit to run every configured build.",
  }),
  targets: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).annotate({
      description:
        'Extra build targets passed as --target, e.g. ["mfg-data"], ["3d-models"], or ["all"]. Omit for the default outputs (board, BOM, manifest).',
    }),
  ).annotate({
    description:
      'Extra build targets passed as --target, e.g. ["mfg-data"], ["3d-models"], or ["all"]. Omit for the default outputs (board, BOM, manifest).',
  }),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0))
      .check(Schema.isLessThanOrEqualTo(1_800_000))
      .annotate({
        description: "Maximum build time in milliseconds. Defaults to 600000; maximum 1800000.",
      }),
  ).annotate({
    description: "Maximum build time in milliseconds. Defaults to 600000; maximum 1800000.",
  }),
});
export type AtopileBuildInput = typeof AtopileBuildInput.Type;

export const AtopileBuildResult = Schema.Struct({
  ok: Schema.Boolean,
  exitCode: Schema.Number,
  durationMs: Schema.Number,
  command: Schema.Array(Schema.String),
  projectDir: Schema.String,
  targets: Schema.Array(AtopileBuildTarget),
  errors: Schema.Array(AtopileDiagnostic),
  warnings: Schema.Array(AtopileDiagnostic),
  artifacts: Schema.Array(AtopileArtifact),
  /** Last part of the combined output, for anything the parser did not structure. */
  outputTail: Schema.String,
});
export type AtopileBuildResult = typeof AtopileBuildResult.Type;

export const AtopileProjectInput = Schema.Struct({
  projectDir: Schema.optional(
    Schema.String.annotate({ description: PROJECT_DIR_DESCRIPTION }),
  ).annotate({ description: PROJECT_DIR_DESCRIPTION }),
});
export type AtopileProjectInput = typeof AtopileProjectInput.Type;

export const AtopileBuildConfig = Schema.Struct({
  name: Schema.String,
  entry: Schema.optionalKey(Schema.String),
  /** Project-relative path of the KiCad board this build writes. */
  layoutPcb: Schema.String,
  layoutExists: Schema.Boolean,
});
export type AtopileBuildConfig = typeof AtopileBuildConfig.Type;

export const AtopileProjectInfo = Schema.Struct({
  projectDir: Schema.String,
  configPath: Schema.String,
  requiresAtopile: Schema.optionalKey(Schema.String),
  builds: Schema.Array(AtopileBuildConfig),
  srcDir: Schema.String,
  layoutDir: Schema.String,
  buildDir: Schema.String,
  componentsServiceUrl: Schema.optionalKey(Schema.String),
  dependencies: Schema.Array(Schema.String),
});
export type AtopileProjectInfo = typeof AtopileProjectInfo.Type;

/** One BOM line as atopile's `<build>.bom.json` records it, with designators merged. */
export const AtopileBomLine = Schema.Struct({
  designators: Schema.Array(Schema.String),
  quantity: Schema.Number,
  value: Schema.String,
  mpn: Schema.String,
  manufacturer: Schema.String,
  lcsc: Schema.String,
  package: Schema.String,
  type: Schema.String,
  description: Schema.String,
  unitCost: Schema.optionalKey(Schema.Number),
  stock: Schema.optionalKey(Schema.Number),
  isBasic: Schema.Boolean,
  source: Schema.String,
});
export type AtopileBomLine = typeof AtopileBomLine.Type;

/** One solved parameter from `<build>.variables.json`, flattened with its module path. */
export const AtopileVariableRow = Schema.Struct({
  path: Schema.String,
  typeName: Schema.String,
  name: Schema.String,
  spec: Schema.NullOr(Schema.String),
  actual: Schema.NullOr(Schema.String),
  unit: Schema.NullOr(Schema.String),
  source: Schema.NullOr(Schema.String),
  meetsSpec: Schema.NullOr(Schema.Boolean),
});
export type AtopileVariableRow = typeof AtopileVariableRow.Type;

export const AtopileLastBuild = Schema.Struct({
  finishedAt: Schema.Number,
  result: AtopileBuildResult,
});
export type AtopileLastBuild = typeof AtopileLastBuild.Type;

/** Everything the viewer's Design tab shows for one build. */
export const AtopileReport = Schema.Struct({
  build: Schema.String,
  lastBuild: Schema.optionalKey(AtopileLastBuild),
  bom: Schema.optionalKey(Schema.Array(AtopileBomLine)),
  variables: Schema.optionalKey(Schema.Array(AtopileVariableRow)),
  warnings: Schema.Array(Schema.String),
});
export type AtopileReport = typeof AtopileReport.Type;

export class AtopileToolchainUnavailableError extends Schema.TaggedErrorClass<AtopileToolchainUnavailableError>()(
  "AtopileToolchainUnavailableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `The atopile toolchain is not available: ${this.detail}`;
  }
}

export class AtopileProjectNotFoundError extends Schema.TaggedErrorClass<AtopileProjectNotFoundError>()(
  "AtopileProjectNotFoundError",
  { projectDir: Schema.String },
) {
  override get message(): string {
    return `No ato.yaml found at ${this.projectDir}.`;
  }
}

export class AtopileInvalidInputError extends Schema.TaggedErrorClass<AtopileInvalidInputError>()(
  "AtopileInvalidInputError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class AtopileExecutionError extends Schema.TaggedErrorClass<AtopileExecutionError>()(
  "AtopileExecutionError",
  { command: Schema.Array(Schema.String), detail: Schema.String },
) {
  override get message(): string {
    return `Running ${this.command.join(" ")} failed: ${this.detail}`;
  }
}

export const AtopileError = Schema.Union([
  AtopileToolchainUnavailableError,
  AtopileProjectNotFoundError,
  AtopileInvalidInputError,
  AtopileExecutionError,
]);
export type AtopileError = typeof AtopileError.Type;
