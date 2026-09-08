import bundle from "./atopile.bundle.json" with { type: "json" };
import {
  installSkillBundle,
  renderSkillBundleInstructions,
  skillBundleDirectory,
} from "./SkillBundle.ts";

// Imported JSON is bundled into the server, including packaged desktop/remote builds.
export const atopileSkillsDirectory = skillBundleDirectory(bundle, "atopile-skills");

/** Restore the pinned, app-owned copy without modifying provider homes or project skills. */
export function installAtopileSkills(directory = atopileSkillsDirectory): Promise<void> {
  return installSkillBundle(bundle, directory);
}

export function buildAtopileSkillsInstructions(directory = atopileSkillsDirectory): string {
  return renderSkillBundleInstructions(bundle, directory, {
    tag: "atopile_skills",
    preamble: [
      `T3CAD includes skills for atopile projects, meaning workspaces that contain an ato.yaml. The language rules come from atopile (${bundle.source}, revision ${bundle.revision}).`,
      "When the workspace has an ato.yaml, read the matching SKILL.md before editing .ato files or building, and follow its workflow. Resolve referenced documents relative to that skill's directory. User instructions take precedence. Other installed skills remain available.",
    ],
  });
}
