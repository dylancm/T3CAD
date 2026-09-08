import bundle from "./kistack.bundle.json" with { type: "json" };
import {
  installSkillBundle,
  renderSkillBundleInstructions,
  skillBundleDirectory,
} from "./SkillBundle.ts";

// Imported JSON is bundled into the server, including packaged desktop/remote builds.
export const kiStackSkillsDirectory = skillBundleDirectory(bundle, "kistack");

/** Restore the pinned, app-owned copy without modifying provider homes or project skills. */
export function installKiStackSkills(directory = kiStackSkillsDirectory): Promise<void> {
  return installSkillBundle(bundle, directory);
}

export function buildKiStackInstructions(directory = kiStackSkillsDirectory): string {
  return renderSkillBundleInstructions(bundle, directory, {
    tag: "kistack_skills",
    preamble: [
      `T3CAD includes KiStack by American Embedded (${bundle.source}, revision ${bundle.revision}). These skills are always available in every project.`,
      "For relevant electronics work, read the matching SKILL.md before working and follow its workflow. Resolve referenced scripts and documents relative to that skill's directory. User instructions take precedence. Other installed skills remain available.",
    ],
  });
}
