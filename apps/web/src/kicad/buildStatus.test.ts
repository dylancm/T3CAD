import type { AtopileBuildResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeBuild } from "./buildStatus";

const base: AtopileBuildResult = {
  ok: true,
  exitCode: 0,
  durationMs: 4012,
  command: ["ato"],
  projectDir: "/ws",
  targets: [],
  errors: [],
  warnings: [],
  artifacts: [],
  outputTail: "",
};

describe("summarizeBuild", () => {
  it("describes running and successful builds with warning counts", () => {
    expect(summarizeBuild({ status: "running", build: "default" })).toBe("Build default running…");
    expect(summarizeBuild({ status: "done", build: undefined, result: base })).toBe(
      "Build succeeded in 4.0 s",
    );
    expect(
      summarizeBuild({
        status: "done",
        build: "default",
        result: { ...base, warnings: [{ message: "a" }, { message: "b" }] },
      }),
    ).toBe("Build default succeeded in 4.0 s · 2 warnings");
  });

  it("leads with the first error and its short location", () => {
    const result: AtopileBuildResult = {
      ...base,
      ok: false,
      exitCode: 1,
      errors: [
        { message: "Field `r1.nope` could not be resolved", file: "/ws/main.ato", line: 11 },
        { message: "second" },
      ],
    };
    expect(summarizeBuild({ status: "done", build: "default", result })).toBe(
      "Build default failed: Field `r1.nope` could not be resolved (main.ato:11) · 1 more error",
    );
    expect(summarizeBuild({ status: "done", build: "x", result: { ...result, errors: [] } })).toBe(
      "Build x failed (exit 1)",
    );
    expect(summarizeBuild({ status: "error", build: undefined, message: "503" })).toBe(
      "Build request failed: 503",
    );
  });
});
