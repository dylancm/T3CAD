// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { buildAtopileSkillsInstructions, installAtopileSkills } from "./AtopileSkills.ts";
import bundle from "./atopile.bundle.json" with { type: "json" };

it("bundles exactly the two atopile skills and every advertised SKILL.md is shipped", () => {
  expect(bundle.skills.map((skill) => skill.name)).toEqual(["ato-language", "atopile-t3cad"]);
  expect(bundle.source).toBe("https://github.com/atopile/atopile");
  expect(bundle.revision).toMatch(/^[0-9a-f]{40}$/);
  for (const skill of bundle.skills) {
    expect(skill.path).toBe(`${skill.name}/SKILL.md`);
    expect(bundle.files).toHaveProperty(skill.path);
    expect(bundle.files[skill.path as keyof typeof bundle.files]).toContain(`name: ${skill.name}`);
  }
  expect(bundle.files).toHaveProperty("LICENSE");
  expect(bundle.files).toHaveProperty("ato-language/references/grammar.g4");
});

it("installs both skills and their references offline, and repairs edited resources", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3cad-atopile-test-"));
  try {
    await installAtopileSkills(directory);
    for (const [relative, contents] of Object.entries(bundle.files)) {
      expect(await NodeFSP.readFile(NodePath.join(directory, relative), "utf8")).toBe(contents);
    }
    const language = NodePath.join(directory, "ato-language/SKILL.md");
    const before = (await NodeFSP.stat(language)).mtimeMs;
    const t3cad = NodePath.join(directory, "atopile-t3cad/SKILL.md");
    await NodeFSP.writeFile(t3cad, "edited by hand");
    await installAtopileSkills(directory);
    expect((await NodeFSP.stat(language)).mtimeMs).toBe(before);
    expect(await NodeFSP.readFile(t3cad, "utf8")).toBe(bundle.files["atopile-t3cad/SKILL.md"]);

    const instructions = buildAtopileSkillsInstructions(directory);
    expect(instructions.startsWith("<atopile_skills>\n")).toBe(true);
    expect(instructions.split("\n")[1]).toContain("ato.yaml");
    expect(instructions.endsWith("</atopile_skills>")).toBe(true);
    for (const skill of bundle.skills) {
      expect(instructions).toContain(`- ${skill.name}: ${skill.description} Read `);
      expect(instructions).toContain(JSON.stringify(NodePath.join(directory, skill.path)));
    }
    expect(instructions).toContain("User instructions take precedence");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("reports installation errors instead of advertising unavailable skills", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3cad-atopile-error-"));
  try {
    const file = NodePath.join(directory, "not-a-directory");
    await NodeFSP.writeFile(file, "existing");
    await expect(installAtopileSkills(file)).rejects.toThrow();
    expect(await NodeFSP.readFile(file, "utf8")).toBe("existing");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
