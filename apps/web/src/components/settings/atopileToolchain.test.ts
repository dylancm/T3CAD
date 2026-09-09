import { describe, expect, it } from "vite-plus/test";

import {
  ATOPILE_INSTALL_PHASE_LABELS,
  ATOPILE_TOOLCHAIN_SOURCE_LABELS,
  formatAtopileCommand,
  formatAtopileInstallProgress,
  isAtopileInstallRunning,
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
    expect(formatAtopileToolchainSource("setting")).toBe("ato command setting");
    expect(formatAtopileToolchainSource("env")).toBe("T3CAD_ATO_COMMAND environment variable");
    expect(formatAtopileToolchainSource("path")).toBe("ato on PATH");
    expect(formatAtopileToolchainSource("uv")).toBe("uv tool run, pinned release");
  });

  it("has no label when nothing resolved", () => {
    expect(formatAtopileToolchainSource(undefined)).toBeNull();
  });

  it("covers every source the contract allows", () => {
    expect(Object.keys(ATOPILE_TOOLCHAIN_SOURCE_LABELS).toSorted()).toEqual([
      "env",
      "path",
      "setting",
      "uv",
    ]);
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

describe("formatAtopileInstallProgress", () => {
  it("is empty before the first install", () => {
    expect(formatAtopileInstallProgress({ phase: "idle" })).toBeNull();
  });

  it("shows byte progress while uv downloads, with or without a known total", () => {
    expect(
      formatAtopileInstallProgress({
        phase: "downloading-uv",
        message: "Downloading uv 0.9.9.",
        downloadedBytes: 12_345_678,
        totalBytes: 40_000_000,
      }),
    ).toBe("Downloading uv: 12.3 MB of 40.0 MB");
    expect(formatAtopileInstallProgress({ phase: "downloading-uv" })).toBe(
      "Downloading uv: 0.0 MB",
    );
  });

  it("pairs the phase label with the server's message elsewhere", () => {
    expect(
      formatAtopileInstallProgress({ phase: "installing", message: "Preparing atopile 0.15.8." }),
    ).toBe("Preparing atopile: Preparing atopile 0.15.8.");
    expect(formatAtopileInstallProgress({ phase: "failed", message: "uv exited with 1" })).toBe(
      "Failed: uv exited with 1",
    );
    expect(formatAtopileInstallProgress({ phase: "verifying" })).toBe("Verifying");
  });

  it("labels every phase the contract allows and knows which ones are in flight", () => {
    const phases = Object.keys(ATOPILE_INSTALL_PHASE_LABELS).toSorted();
    expect(phases).toEqual([
      "cancelled",
      "downloading-uv",
      "failed",
      "idle",
      "installing",
      "locating-uv",
      "succeeded",
      "verifying",
    ]);
    expect(phases.filter((phase) => isAtopileInstallRunning(phase as never))).toEqual([
      "downloading-uv",
      "installing",
      "locating-uv",
      "verifying",
    ]);
  });
});
