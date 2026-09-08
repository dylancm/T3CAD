// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type {
  AtopileBomLine,
  AtopileBuildResult,
  AtopileLastBuild,
  AtopileReport,
  AtopileVariableRow,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { type AtoProjectConfig, expectedArtifacts } from "./atoProject.ts";

/**
 * Reads the reports `ato build` writes next to its outputs and remembers the
 * last build this server ran, so the viewer can show diagnostics no matter
 * whether an agent tool or the Build button triggered the build.
 */

// --- last build registry --------------------------------------------------------

const lastBuilds = new Map<string, AtopileLastBuild & { readonly build: string | undefined }>();

export function recordAtoBuild(
  projectDir: string,
  build: string | undefined,
  result: AtopileBuildResult,
  finishedAt: number,
): void {
  lastBuilds.set(NodePath.resolve(projectDir), { finishedAt, result, build });
}

export function getLastAtoBuild(
  projectDir: string,
): (AtopileLastBuild & { readonly build: string | undefined }) | undefined {
  return lastBuilds.get(NodePath.resolve(projectDir));
}

/** Test hook. */
export function clearAtoBuildHistory(): void {
  lastBuilds.clear();
}

// --- report files -----------------------------------------------------------------

const BomFile = Schema.Struct({
  components: Schema.Array(
    Schema.Struct({
      lcsc: Schema.optional(Schema.NullOr(Schema.String)),
      manufacturer: Schema.optional(Schema.NullOr(Schema.String)),
      mpn: Schema.optional(Schema.NullOr(Schema.String)),
      type: Schema.optional(Schema.NullOr(Schema.String)),
      value: Schema.optional(Schema.NullOr(Schema.String)),
      package: Schema.optional(Schema.NullOr(Schema.String)),
      description: Schema.optional(Schema.NullOr(Schema.String)),
      quantity: Schema.optional(Schema.NullOr(Schema.Number)),
      unitCost: Schema.optional(Schema.NullOr(Schema.Number)),
      stock: Schema.optional(Schema.NullOr(Schema.Number)),
      isBasic: Schema.optional(Schema.NullOr(Schema.Boolean)),
      source: Schema.optional(Schema.NullOr(Schema.String)),
      usages: Schema.optional(
        Schema.Array(Schema.Struct({ designator: Schema.optional(Schema.NullOr(Schema.String)) })),
      ),
    }),
  ),
});
const decodeBom = Schema.decodeUnknownSync(Schema.fromJsonString(BomFile));

const VariablesFile = Schema.Struct({ nodes: Schema.Array(Schema.Unknown) });
const decodeVariables = Schema.decodeUnknownSync(Schema.fromJsonString(VariablesFile));

export function parseAtoBom(text: string): AtopileBomLine[] {
  return decodeBom(text).components.map((c) => ({
    designators: (c.usages ?? [])
      .map((u) => u.designator ?? "")
      .filter((d) => d.length > 0)
      .sort(),
    quantity: c.quantity ?? 0,
    value: c.value ?? "",
    mpn: c.mpn ?? "",
    manufacturer: c.manufacturer ?? "",
    lcsc: c.lcsc ?? "",
    package: c.package ?? "",
    type: c.type ?? "",
    description: c.description ?? "",
    ...(typeof c.unitCost === "number" ? { unitCost: c.unitCost } : {}),
    ...(typeof c.stock === "number" ? { stock: c.stock } : {}),
    isBasic: c.isBasic === true,
    source: c.source ?? "",
  }));
}

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Walk the node tree depth-first, one row per variable, keeping the module path. */
export function parseAtoVariables(text: string): AtopileVariableRow[] {
  const rows: AtopileVariableRow[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const path = asString(record.path) ?? asString(record.name) ?? "";
    const typeName = asString(record.typeName) ?? "";
    const variables = Array.isArray(record.variables) ? record.variables : [];
    for (const variable of variables) {
      if (typeof variable !== "object" || variable === null) continue;
      const v = variable as Record<string, unknown>;
      rows.push({
        path,
        typeName,
        name: asString(v.name) ?? "",
        spec: asString(v.spec),
        actual: asString(v.actual),
        unit: asString(v.unit),
        source: asString(v.source),
        meetsSpec: typeof v.meetsSpec === "boolean" ? v.meetsSpec : null,
      });
    }
    const children = Array.isArray(record.children) ? record.children : [];
    for (const child of children) visit(child);
  };
  for (const node of decodeVariables(text).nodes) visit(node);
  return rows;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await NodeFSP.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Assemble the Design tab's report for one build. Missing files are not errors. */
export async function readAtoReport(
  projectDir: string,
  config: AtoProjectConfig,
  buildName: string,
): Promise<AtopileReport> {
  const build = config.builds.find((b) => b.name === buildName);
  if (!build) {
    return {
      build: buildName,
      warnings: [`Build ${buildName} is not defined in ato.yaml.`],
    };
  }
  const artifacts = expectedArtifacts(config, build);
  const warnings: string[] = [];
  const locate = (kind: string) => artifacts.find((a) => a.kind === kind)?.path;
  const bomPath = locate("bom-json");
  const variablesPath = locate("variables");

  let bom: AtopileBomLine[] | undefined;
  const bomText = bomPath
    ? await readOptional(NodePath.join(projectDir, ...bomPath.split("/")))
    : undefined;
  if (bomText !== undefined) {
    try {
      bom = parseAtoBom(bomText);
    } catch {
      warnings.push(`Could not read ${bomPath}.`);
    }
  }

  let variables: AtopileVariableRow[] | undefined;
  const variablesText = variablesPath
    ? await readOptional(NodePath.join(projectDir, ...variablesPath.split("/")))
    : undefined;
  if (variablesText !== undefined) {
    try {
      variables = parseAtoVariables(variablesText);
    } catch {
      warnings.push(`Could not read ${variablesPath}.`);
    }
  }

  const last = getLastAtoBuild(projectDir);
  const lastBuild =
    last && (last.build === undefined || last.build === buildName)
      ? { finishedAt: last.finishedAt, result: last.result }
      : undefined;

  return {
    build: buildName,
    ...(lastBuild ? { lastBuild } : {}),
    ...(bom ? { bom } : {}),
    ...(variables ? { variables } : {}),
    warnings,
  };
}
