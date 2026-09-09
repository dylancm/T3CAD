import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { AtopileToolkit } from "./tools.ts";

function schemaHasDescription(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const record = schema as Record<string, unknown>;
  if (typeof record.description === "string" && record.description.length > 0) return true;
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const variants = record[key];
    if (Array.isArray(variants) && variants.some(schemaHasDescription)) return true;
  }
  return false;
}

it("exports provider-compatible object schemas with described parameters", () => {
  const tools = Object.values(AtopileToolkit.tools);
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "ato_build",
    "ato_project",
    "ato_status",
    "ato_validate",
  ]);
  for (const tool of tools) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      expect(
        schemaHasDescription(fieldSchema),
        `${tool.name}.${field} should explain what data the agent must pass`,
      ).toBe(true);
    }
  }
});

it("marks the build tool as the only non-readonly action", () => {
  const readonly = Object.values(AtopileToolkit.tools)
    .filter((tool) => Context.get(tool.annotations, Tool.Readonly) === true)
    .map((tool) => tool.name)
    .sort();
  expect(readonly).toEqual(["ato_project", "ato_status", "ato_validate"]);
});
