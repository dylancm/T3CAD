#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

/**
 * Regenerate `src/provider/atopile.bundle.json` from the skill sources under
 * `src/provider/atopile-skills/`.
 *
 * Run from the repo root:
 *   node apps/server/scripts/build-atopile-skills-bundle.ts
 *
 * Every `<skill>/SKILL.md` contributes one entry to `skills` (name and
 * description come from its YAML frontmatter) and every file in the tree,
 * including the LICENSE and `references/`, lands in `files` keyed by its
 * path relative to the skills directory. Keys are sorted so the output is
 * deterministic and diffs stay small.
 *
 * `revision` is the atopile commit the `ato-language` rule text was copied
 * from, not a T3CAD revision; bump it together with the copied text.
 */

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const ATOPILE_SOURCE = "https://github.com/atopile/atopile";
const ATOPILE_REVISION = "619eda7f777558a3e500dbad9cc2941712881495";

const scriptsDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const skillsDirectory = NodePath.resolve(scriptsDirectory, "../src/provider/atopile-skills");
const bundlePath = NodePath.resolve(scriptsDirectory, "../src/provider/atopile.bundle.json");

interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

function listFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function toBundlePath(path: string): string {
  return NodePath.relative(skillsDirectory, path).split(NodePath.sep).join("/");
}

function parseFrontmatter(contents: string, path: string): SkillEntry {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(contents);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    const quoted = /^"(.*)"$/.exec(raw);
    fields.set(key, quoted ? quoted[1]! : raw);
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description) throw new Error(`${path}: frontmatter needs name and description`);
  const expectedName = NodePath.basename(NodePath.dirname(path));
  if (name !== expectedName) {
    throw new Error(`${path}: frontmatter name "${name}" must match directory "${expectedName}"`);
  }
  return { name, description, path: toBundlePath(path) };
}

const files: Record<string, string> = {};
const skills: Array<SkillEntry> = [];
for (const path of listFiles(skillsDirectory).sort()) {
  const contents = NodeFS.readFileSync(path, "utf8");
  files[toBundlePath(path)] = contents;
  if (NodePath.basename(path) === "SKILL.md") skills.push(parseFrontmatter(contents, path));
}
skills.sort((a, b) => a.name.localeCompare(b.name));

const bundle = {
  source: ATOPILE_SOURCE,
  revision: ATOPILE_REVISION,
  skills,
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
};

NodeFS.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(
  `Wrote ${NodePath.relative(process.cwd(), bundlePath)}: ${skills.length} skills, ${Object.keys(files).length} files`,
);
