// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** Shape of the bundled `*.bundle.json` files that ship agent skills inside the server. */
export interface SkillBundle {
  readonly source: string;
  readonly revision: string;
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly path: string;
  }>;
  readonly files: Readonly<Record<string, string>>;
}

/** App-owned install location, pinned per revision so upgrades never leave stale files behind. */
export function skillBundleDirectory(bundle: SkillBundle, cacheName: string): string {
  return NodePath.join(NodeOS.homedir(), ".cache", "t3cad", cacheName, bundle.revision);
}

/** Restore the pinned, app-owned copy without modifying provider homes or project skills. */
export async function installSkillBundle(bundle: SkillBundle, directory: string): Promise<void> {
  for (const [relativePath, contents] of Object.entries(bundle.files)) {
    const path = NodePath.join(directory, relativePath);
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
    // Preserve mtimes for unchanged resources and repair missing or edited bundled files.
    const existing = await NodeFSP.readFile(path, "utf8").catch((cause: unknown) => {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    });
    if (existing !== contents) await NodeFSP.writeFile(path, contents);
  }
}

/** Render a `<tag>` prompt block: the preamble lines, then one line per skill with its absolute SKILL.md path. */
export function renderSkillBundleInstructions(
  bundle: SkillBundle,
  directory: string,
  options: { readonly tag: string; readonly preamble: ReadonlyArray<string> },
): string {
  return [
    `<${options.tag}>`,
    ...options.preamble,
    ...bundle.skills.map(
      (skill) =>
        `- ${skill.name}: ${skill.description} Read ${JSON.stringify(NodePath.join(directory, skill.path))}`,
    ),
    `</${options.tag}>`,
  ].join("\n");
}
