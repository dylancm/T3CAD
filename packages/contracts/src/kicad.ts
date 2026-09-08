import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const KiCadFileKind = Schema.Literals([
  "gerber",
  "pcb",
  "schematic",
  "model",
  "project",
  "footprint",
  "symbol",
]);
export type KiCadFileKind = typeof KiCadFileKind.Type;

export const KiCadProjectFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: KiCadFileKind,
  mimeType: TrimmedNonEmptyString,
  size: Schema.Number,
  mtimeMs: Schema.Number,
});
export type KiCadProjectFile = typeof KiCadProjectFile.Type;

export const KiCadProjectConfig = Schema.Struct({
  analysisUrl: Schema.optionalKey(Schema.String),
  pcb: Schema.optionalKey(Schema.String),
  schematic: Schema.optionalKey(Schema.String),
  gerbers: Schema.optionalKey(Schema.Array(Schema.String)),
  symbol: Schema.optionalKey(Schema.String),
  symbolMember: Schema.optionalKey(Schema.String),
  footprint: Schema.optionalKey(Schema.String),
});
export type KiCadProjectConfig = typeof KiCadProjectConfig.Type;

/** One `builds:` entry of an atopile `ato.yaml`, with the outputs that exist right now. */
export const KiCadAtopileBuild = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Project-relative board path this build writes, whether or not it exists yet. */
  layoutPcb: TrimmedNonEmptyString,
  layoutExists: Schema.Boolean,
  /** Project-relative paths of generated outputs, present only when the file exists. */
  glb: Schema.optionalKey(TrimmedNonEmptyString),
  bomJson: Schema.optionalKey(TrimmedNonEmptyString),
  gerberDir: Schema.optionalKey(TrimmedNonEmptyString),
});
export type KiCadAtopileBuild = typeof KiCadAtopileBuild.Type;

/** Outcome of the most recent `ato build` this server ran for the project. */
export const KiCadAtopileLastBuild = Schema.Struct({
  finishedAt: Schema.Number,
  ok: Schema.Boolean,
  build: Schema.optionalKey(TrimmedNonEmptyString),
  errors: Schema.Number,
  warnings: Schema.Number,
});
export type KiCadAtopileLastBuild = typeof KiCadAtopileLastBuild.Type;

export const KiCadAtopileProject = Schema.Struct({
  configPath: TrimmedNonEmptyString,
  builds: Schema.Array(KiCadAtopileBuild),
  lastBuild: Schema.optionalKey(KiCadAtopileLastBuild),
});
export type KiCadAtopileProject = typeof KiCadAtopileProject.Type;

export const KiCadProjectManifest = Schema.Struct({
  root: TrimmedNonEmptyString,
  revision: TrimmedNonEmptyString,
  files: Schema.Array(KiCadProjectFile),
  config: Schema.optionalKey(KiCadProjectConfig),
  /** Present when the workspace root holds an atopile `ato.yaml`. */
  atopile: Schema.optionalKey(KiCadAtopileProject),
  warnings: Schema.Array(Schema.String),
});
export type KiCadProjectManifest = typeof KiCadProjectManifest.Type;

export const KiCadViewerSession = Schema.Struct({
  token: TrimmedNonEmptyString,
  expiresAt: Schema.Number,
});
export type KiCadViewerSession = typeof KiCadViewerSession.Type;

export const KiCadBom = Schema.Struct({
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.String)),
  content: Schema.String,
  preset: Schema.String,
  sourceProject: Schema.NullOr(Schema.String),
  warnings: Schema.Array(Schema.String),
});
export type KiCadBom = typeof KiCadBom.Type;

export const KiCadLibraryMember = Schema.Struct({ name: Schema.String, svg: Schema.String });
export type KiCadLibraryMember = typeof KiCadLibraryMember.Type;
