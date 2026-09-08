// @effect-diagnostics nodeBuiltinImport:off
/**
 * Reads an atopile project's `ato.yaml` into the shape agents need: build
 * names, where each build writes its KiCad board, and where outputs land.
 *
 * Pure with respect to the filesystem: callers pass the YAML text and check
 * paths themselves, so this stays trivially testable.
 */

import * as NodePath from "node:path";
import type { AtopileArtifactKind } from "@t3tools/contracts";
import { parse as parseYaml } from "yaml";

export const ATO_CONFIG_FILENAME = "ato.yaml";

// Defaults from atopile's ProjectPaths (src/atopile/config.py). Recent project
// templates override `src` and `layout` explicitly.
const DEFAULT_SRC = "elec/src";
const DEFAULT_LAYOUT = "elec/layout";
const DEFAULT_BUILD = "build";

export interface AtoBuildConfig {
  readonly name: string;
  readonly entry: string | undefined;
  /** Project-relative, normalised path of the board this build updates. */
  readonly layoutPcb: string;
}

export interface AtoProjectConfig {
  readonly requiresAtopile: string | undefined;
  readonly srcDir: string;
  readonly layoutDir: string;
  readonly buildDir: string;
  readonly builds: readonly AtoBuildConfig[];
  readonly componentsServiceUrl: string | undefined;
  readonly dependencies: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeRelative(path: string): string {
  const normalized = NodePath.posix.normalize(path.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function joinRelative(...parts: string[]): string {
  return normalizeRelative(NodePath.posix.join(...parts.filter((p) => p.length > 0)));
}

/** Parse `ato.yaml` text. Throws on invalid YAML; tolerates missing sections. */
export function parseAtoConfig(yamlText: string): AtoProjectConfig {
  const root = asRecord(parseYaml(yamlText));
  const paths = asRecord(root.paths);
  const srcDir = normalizeRelative(asString(paths.src) ?? DEFAULT_SRC);
  const layoutDir = normalizeRelative(asString(paths.layout) ?? DEFAULT_LAYOUT);
  const buildDir = normalizeRelative(asString(paths.build) ?? DEFAULT_BUILD);

  const builds: AtoBuildConfig[] = Object.entries(asRecord(root.builds)).map(([name, raw]) => {
    const cfg = asRecord(raw);
    // `address` is the older alias of `entry`.
    const entry = asString(cfg.entry) ?? asString(cfg.address);
    const layoutOverride = asString(asRecord(cfg.paths).layout);
    const layoutPcb = layoutOverride
      ? joinRelative(layoutOverride, `${name}.kicad_pcb`)
      : joinRelative(layoutDir, name, `${name}.kicad_pcb`);
    return { name, entry, layoutPcb };
  });

  const services = asRecord(root.services);
  const components = asRecord(services.components);
  const rawDeps = Array.isArray(root.dependencies) ? root.dependencies : [];
  const dependencies = rawDeps
    .map((dep) =>
      typeof dep === "string"
        ? dep
        : (asString(asRecord(dep).identifier) ?? asString(asRecord(dep).name)),
    )
    .filter((dep): dep is string => dep !== undefined);

  return {
    requiresAtopile: asString(root["requires-atopile"]) ?? asString(root.requires_atopile),
    srcDir,
    layoutDir,
    buildDir,
    builds,
    componentsServiceUrl: asString(components.url),
    dependencies,
  };
}

export interface ExpectedArtifact {
  readonly kind: AtopileArtifactKind;
  /** Project-relative path. */
  readonly path: string;
}

/**
 * Files `ato build` may have produced for one build, project-relative.
 * Callers keep the ones that exist.
 */
export function expectedArtifacts(
  config: AtoProjectConfig,
  build: AtoBuildConfig,
): ExpectedArtifact[] {
  const out = joinRelative(config.buildDir, "builds", build.name);
  const base = `${build.name}`;
  return [
    { kind: "pcb", path: build.layoutPcb },
    { kind: "manifest", path: joinRelative(config.buildDir, "manifest.json") },
    { kind: "netlist", path: joinRelative(out, `${base}.net`) },
    { kind: "bom-csv", path: joinRelative(out, `${base}.bom.csv`) },
    { kind: "bom-json", path: joinRelative(out, `${base}.bom.json`) },
    { kind: "variables", path: joinRelative(out, `${base}.variables.json`) },
    { kind: "glb", path: joinRelative(out, `${base}.pcba.glb`) },
    { kind: "step", path: joinRelative(out, `${base}.pcba.step`) },
    { kind: "gerbers", path: joinRelative(out, `${base}.gerber.zip`) },
    { kind: "pick-and-place", path: joinRelative(out, `${base}.pick_and_place.csv`) },
  ];
}
