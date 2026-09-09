import { AtopileInvalidInputError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildArgs } from "../../../atopile/atoBuild.ts";
import { resolveValidateFile, validateArgs } from "../../../atopile/atoValidate.ts";
import { resolveProjectDir } from "./handlers.ts";

describe("buildArgs", () => {
  it("runs every configured build with default targets when nothing is specified", () => {
    expect(buildArgs({})).toEqual(["build"]);
  });

  it("passes the build name and each extra target as separate flags", () => {
    expect(buildArgs({ build: "default", targets: ["mfg-data", "3d-models"] })).toEqual([
      "build",
      "--build",
      "default",
      "--target",
      "mfg-data",
      "--target",
      "3d-models",
    ]);
  });
});

describe("resolveProjectDir", () => {
  it("defaults to the workspace root and resolves relative paths inside it", () => {
    expect(resolveProjectDir("/ws", undefined)).toBe("/ws");
    expect(resolveProjectDir("/ws", "boards/led")).toBe("/ws/boards/led");
    expect(resolveProjectDir("/ws", "/ws/boards/led")).toBe("/ws/boards/led");
  });

  it("rejects paths that escape the workspace", () => {
    expect(resolveProjectDir("/ws", "../elsewhere")).toBeInstanceOf(AtopileInvalidInputError);
    expect(resolveProjectDir("/ws", "/etc")).toBeInstanceOf(AtopileInvalidInputError);
  });
});

describe("validateArgs", () => {
  it("passes every file as a positional argument", () => {
    expect(validateArgs(["main.ato", "boards/extra.ato"])).toEqual([
      "validate",
      "main.ato",
      "boards/extra.ato",
    ]);
  });
});

describe("resolveValidateFile", () => {
  it("returns project-relative paths for files inside the project", () => {
    expect(resolveValidateFile("/proj", "main.ato")).toBe("main.ato");
    expect(resolveValidateFile("/proj", "./boards/extra.ato")).toBe("boards/extra.ato");
    expect(resolveValidateFile("/proj", "/proj/boards/extra.ato")).toBe("boards/extra.ato");
  });

  it("rejects escapes, the project directory itself, and non-.ato files", () => {
    expect(resolveValidateFile("/proj", "../other/main.ato")).toBeInstanceOf(
      AtopileInvalidInputError,
    );
    expect(resolveValidateFile("/proj", "/etc/passwd.ato")).toBeInstanceOf(
      AtopileInvalidInputError,
    );
    expect(resolveValidateFile("/proj", ".")).toBeInstanceOf(AtopileInvalidInputError);
    expect(resolveValidateFile("/proj", "ato.yaml")).toBeInstanceOf(AtopileInvalidInputError);
  });
});
