import { AtopileInvalidInputError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildArgs } from "../../../atopile/atoBuild.ts";
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
