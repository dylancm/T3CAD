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

// --- quantities and margin ------------------------------------------------------

/** A closed numeric interval with an opaque unit; either end may be infinite. */
export interface AtoQuantity {
  readonly lo: number;
  readonly hi: number;
  readonly unit: string;
}

const SI_PREFIX: Record<string, number> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  m: 1e-3,
  µ: 1e-6,
  μ: 1e-6,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-?∞|-?inf)`;
const ENDPOINT = new RegExp(`^${NUMBER}\\s*(\\S*)$`);
const TOLERANCE = new RegExp(`^${NUMBER}\\s*(%?)\\s*(\\S*)$`);

/**
 * Scale a magnitude to its base unit when the unit starts with an SI prefix
 * (`1kΩ` → 1000 Ω, `300mcd` → 0.3 cd). A lone letter is a unit, never a prefix.
 * Units the table misreads (`min`, `mol`) are misread the same way on both
 * sides of a comparison, so the margin ratio is unaffected.
 */
function toBase(value: number, unit: string): { value: number; unit: string } {
  const scale = unit.length >= 2 ? SI_PREFIX[unit.charAt(0)] : undefined;
  return scale === undefined ? { value, unit } : { value: value * scale, unit: unit.slice(1) };
}

function parseNumber(text: string): number {
  if (text === "∞" || text === "inf") return Infinity;
  if (text === "-∞" || text === "-inf") return -Infinity;
  return Number(text);
}

interface Endpoint {
  readonly value: number;
  readonly unit: string;
}

interface Tolerance {
  readonly amount: number;
  readonly percent: boolean;
  readonly unit: string;
}

/** `62.5mW` → 62.5 and the raw unit `mW`; no scaling yet. */
function splitEndpoint(text: string): Endpoint | null {
  const m = ENDPOINT.exec(text.trim());
  if (!m || m[1] === undefined) return null;
  const value = parseNumber(m[1]);
  return Number.isNaN(value) ? null : { value, unit: m[2] ?? "" };
}

function parseEndpoint(text: string): Endpoint | null {
  const end = splitEndpoint(text);
  return end && toBase(end.value, end.unit);
}

/** `±20.0%`, `+/- 5%`, `±0.1V`, or the writer's inline `1.0%kΩ` (unit after the percent). */
function parseTolerance(text: string): Tolerance | null {
  const m = TOLERANCE.exec(text.trim().replace(/^(±|\+\/-|\+-)\s*/u, ""));
  if (!m || m[1] === undefined) return null;
  const amount = parseNumber(m[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, percent: m[2] === "%", unit: m[3] ?? "" };
}

/**
 * Widen an exact quantity by a tolerance. Tolerances on ranges or infinities
 * have no clear meaning, so they make the quantity unparseable rather than
 * silently ignored. A unitless value adopts an absolute tolerance's unit.
 */
function widen(q: AtoQuantity, tol: Tolerance): AtoQuantity | null {
  if (q.lo !== q.hi || !Number.isFinite(q.lo)) return null;
  if (tol.percent) {
    const delta = Math.abs(q.lo) * (tol.amount / 100);
    return { lo: q.lo - delta, hi: q.lo + delta, unit: q.unit };
  }
  const abs = toBase(tol.amount, tol.unit);
  if (q.unit !== "" && abs.unit !== "" && abs.unit !== q.unit) return null;
  return { lo: q.lo - abs.value, hi: q.lo + abs.value, unit: q.unit || abs.unit };
}

/** `{90..110}nF` carries one unit at the end; `1.6V to 2.4V` carries two. */
function parseRange(loText: string, hiText: string): AtoQuantity | null {
  const lo = splitEndpoint(loText);
  const hi = splitEndpoint(hiText);
  if (!lo || !hi) return null;
  const loBase = toBase(lo.value, lo.unit || hi.unit);
  const hiBase = toBase(hi.value, hi.unit);
  if (loBase.unit !== hiBase.unit || loBase.value > hiBase.value) return null;
  return { lo: loBase.value, hi: hiBase.value, unit: hiBase.unit };
}

/** `1±1.0%kΩ` puts the unit after the tolerance; `3.3V ±5%` before it. */
function parseToleranced(baseText: string, tolText: string): AtoQuantity | null {
  const base = splitEndpoint(baseText);
  const tol = parseTolerance(tolText);
  if (!base || !tol) return null;
  const exact = toBase(base.value, base.unit || (tol.percent ? tol.unit : ""));
  return widen({ lo: exact.value, hi: exact.value, unit: exact.unit }, tol);
}

function parseSet(s: string): AtoQuantity | null {
  const unbounded = /^(ℝ\+|ℝ⁻|ℝ)\s*(\S*)$/u.exec(s);
  if (unbounded) {
    const unit = toBase(1, unbounded[2] ?? "").unit;
    if (unbounded[1] === "ℝ+") return { lo: 0, hi: Infinity, unit };
    if (unbounded[1] === "ℝ⁻") return { lo: -Infinity, hi: 0, unit };
    return { lo: -Infinity, hi: Infinity, unit };
  }
  const oneSided = /^([≥>≤<]=?)\s*(.+)$/u.exec(s);
  if (oneSided) {
    const end = parseEndpoint(oneSided[2] ?? "");
    if (!end) return null;
    return /^[≥>]/u.test(oneSided[1] ?? "")
      ? { lo: end.value, hi: Infinity, unit: end.unit }
      : { lo: -Infinity, hi: end.value, unit: end.unit };
  }
  const range = /^(.+?)\s*(?:\.\.|\s+to\s+)\s*(.+)$/u.exec(s);
  if (range) return parseRange(range[1] ?? "", range[2] ?? "");
  const toleranced = /^(.+?)\s*(?:±|\+\/-)\s*(.+)$/u.exec(s);
  if (toleranced) return parseToleranced(toleranced[1] ?? "", toleranced[2] ?? "");
  const end = parseEndpoint(s);
  return end && { lo: end.value, hi: end.value, unit: end.unit };
}

/**
 * Parse a value as atopile's variable report writes it: `1kΩ`, `62.5mW`,
 * `1±1.0%kΩ`, `3.3V ±5%`, `{90..110}nF`, `1.6V to 2.4V`, `{≥0.05}W`, `≤10V`,
 * `{ℝ+}V`, with or without the outer braces, plus the report's separate
 * tolerance column. Enums, discrete sets, multi-interval sets and anything
 * else come back null. Never throws.
 */
export function parseAtoQuantity(
  text: string | null | undefined,
  tolerance?: string | null,
): AtoQuantity | null {
  if (!text) return null;
  let s = text.trim();
  // The writer puts the unit after the braces: `{900..1100}Ω`, `{≥0.05}W`.
  const braced = /^\{(.*)\}\s*(\S*)$/u.exec(s);
  if (braced) s = `${(braced[1] ?? "").trim()}${braced[2] ?? ""}`;
  if (s.includes(",")) return null;
  const q = parseSet(s);
  if (!q || !tolerance) return q;
  const tol = parseTolerance(tolerance);
  return tol && widen(q, tol);
}

/**
 * Design margin of `actual` against `spec`, as a ratio that reads as "how much
 * of the allowance is left". For a two-sided spec it is the smaller gap between
 * the actual interval and a spec bound, divided by half the spec width: 1kΩ ±1%
 * inside 1kΩ ±10% gives 0.9. For a one-sided spec it is the gap divided by the
 * bound itself: ≥50mW met by 62.5mW gives 0.25. Negative means the actual
 * interval pokes outside the spec. Null when the units differ, the actual is
 * unbounded, the spec is unbounded or exact, or a one-sided bound is zero.
 */
export function computeMargin(spec: AtoQuantity, actual: AtoQuantity): number | null {
  if (spec.unit !== actual.unit) return null;
  if (!Number.isFinite(actual.lo) || !Number.isFinite(actual.hi)) return null;
  const loBounded = Number.isFinite(spec.lo);
  const hiBounded = Number.isFinite(spec.hi);
  let ratio: number;
  if (loBounded && hiBounded) {
    const half = (spec.hi - spec.lo) / 2;
    if (half <= 0) return null;
    ratio = Math.min(actual.lo - spec.lo, spec.hi - actual.hi) / half;
  } else if (loBounded) {
    if (spec.lo === 0) return null;
    ratio = (actual.lo - spec.lo) / Math.abs(spec.lo);
  } else if (hiBounded) {
    if (spec.hi === 0) return null;
    ratio = (spec.hi - actual.hi) / Math.abs(spec.hi);
  } else {
    return null;
  }
  return Math.round(ratio * 1e4) / 1e4;
}

function marginOf(v: Record<string, unknown>): number | null {
  const spec = parseAtoQuantity(asString(v.spec), asString(v.specTolerance));
  const actual = parseAtoQuantity(asString(v.actual), asString(v.actualTolerance));
  return spec && actual ? computeMargin(spec, actual) : null;
}

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
      const specTolerance = asString(v.specTolerance);
      const actualTolerance = asString(v.actualTolerance);
      rows.push({
        path,
        typeName,
        name: asString(v.name) ?? "",
        spec: asString(v.spec),
        ...(specTolerance ? { specTolerance } : {}),
        actual: asString(v.actual),
        ...(actualTolerance ? { actualTolerance } : {}),
        unit: asString(v.unit),
        source: asString(v.source),
        margin: marginOf(v),
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
