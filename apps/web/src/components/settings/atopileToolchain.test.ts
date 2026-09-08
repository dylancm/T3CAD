import { describe, expect, it } from "vite-plus/test";

import {
  ATOPILE_TOOLCHAIN_SOURCE_LABELS,
  formatAtopileCommand,
  formatAtopileToolchainSource,
  formatAtopileToolchainStatusLabel,
} from "./atopileToolchain";

describe("formatAtopileToolchainStatusLabel", () => {
  it("reports an available toolchain", () => {
    expect(formatAtopileToolchainStatusLabel({ available: true, command: ["ato"] })).toBe(
      "Available",
    );
  });

  it("distinguishes a missing toolchain from a resolved one that fails self-check", () => {
    expect(formatAtopileToolchainStatusLabel({ available: false, command: [] })).toBe("Not found");
    expect(formatAtopileToolchainStatusLabel({ available: false, command: ["ato"] })).toBe(
      "Not working",
    );
  });
});

describe("formatAtopileToolchainSource", () => {
  it("names each resolution step in the server's own words", () => {
    expect(formatAtopileToolchainSource("env")).toBe("T3CAD_ATO_COMMAND environment variable");
    expect(formatAtopileToolchainSource("path")).toBe("ato on PATH");
    expect(formatAtopileToolchainSource("uv")).toBe("uv tool run, pinned release");
  });

  it("has no label when nothing resolved", () => {
    expect(formatAtopileToolchainSource(undefined)).toBeNull();
  });

  it("covers every source the contract allows", () => {
    expect(Object.keys(ATOPILE_TOOLCHAIN_SOURCE_LABELS).toSorted()).toEqual(["env", "path", "uv"]);
  });
});

describe("formatAtopileCommand", () => {
  it("joins the argv prefix with single spaces", () => {
    expect(
      formatAtopileCommand(["uv", "tool", "run", "-p", "3.14", "--from", "atopile==0.15.8", "ato"]),
    ).toBe("uv tool run -p 3.14 --from atopile==0.15.8 ato");
  });

  it("is empty when the toolchain was not found", () => {
    expect(formatAtopileCommand([])).toBeNull();
  });
});
