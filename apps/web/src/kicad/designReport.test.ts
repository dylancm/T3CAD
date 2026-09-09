import type { AtopileBomLine, AtopileReport } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  bomRow,
  bomTotal,
  buildHeadline,
  formatBuildTime,
  formatMargin,
  withTolerance,
} from "./designReport";

const line: AtopileBomLine = {
  designators: ["R1", "R2"],
  quantity: 2,
  value: "1kΩ",
  mpn: "0402WGF1001TCE",
  manufacturer: "UNI ROYAL",
  lcsc: "C11702",
  package: "R0402",
  type: "resistor",
  description: "",
  unitCost: 0.0008,
  stock: 2610919,
  isBasic: true,
  source: "picked",
};

describe("designReport", () => {
  it("renders a BOM row and totals unit cost by quantity", () => {
    expect(bomRow(line)).toEqual([
      "R1, R2",
      "2",
      "1kΩ",
      "0402WGF1001TCE",
      "UNI ROYAL",
      "C11702",
      "$0.0008",
      "2,610,919",
      "basic",
      "picked",
    ]);
    expect(bomTotal([line, { ...line, quantity: 1, unitCost: 0.01 }])).toBeCloseTo(0.0116);
    const { unitCost: _omitted, ...withoutCost } = line;
    expect(bomTotal([line, withoutCost])).toBeUndefined();
    expect(bomTotal([])).toBeUndefined();
  });

  it("describes the last build or its absence", () => {
    const base: AtopileReport = { build: "default", warnings: [] };
    expect(buildHeadline(base)).toContain("No build recorded");
    const result = {
      ok: false,
      exitCode: 1,
      durationMs: 1500,
      command: ["ato"],
      projectDir: "/p",
      targets: [],
      errors: [{ message: "x" }],
      warnings: [],
      artifacts: [],
      outputTail: "",
    };
    expect(buildHeadline({ ...base, lastBuild: { finishedAt: 0, result } })).toBe(
      "Last build failed with 1 error and 0 warnings.",
    );
    expect(
      buildHeadline({
        ...base,
        lastBuild: { finishedAt: 0, result: { ...result, ok: true, errors: [] } },
      }),
    ).toBe("Last build succeeded in 1.5 s with 0 warnings.");
  });

  it("formats relative build times", () => {
    expect(formatBuildTime(10_000, 25_000)).toBe("15s ago");
    expect(formatBuildTime(0, 5 * 60_000)).toBe("5 min ago");
  });

  it("joins a value with its tolerance", () => {
    expect(withTolerance("1kΩ", "±1.0%")).toBe("1kΩ ±1.0%");
    expect(withTolerance("1kΩ", undefined)).toBe("1kΩ");
    expect(withTolerance(null, "±1.0%")).toBe("");
  });

  it("formats margin as headroom percent with a colour ramp", () => {
    expect(formatMargin(0.9)).toEqual({ text: "+90%", className: "" });
    expect(formatMargin(0.25)).toEqual({ text: "+25%", className: "" });
    expect(formatMargin(0.1)).toEqual({ text: "+10%", className: "" });
    expect(formatMargin(0.0999)).toEqual({ text: "+10%", className: "text-warning" });
    expect(formatMargin(0.004)).toEqual({ text: "+0%", className: "text-warning" });
    expect(formatMargin(-0.2)).toEqual({ text: "-20%", className: "text-destructive" });
    expect(formatMargin(4)).toEqual({ text: "+400%", className: "" });
    expect(formatMargin(12)).toEqual({ text: ">+999%", className: "" });
    expect(formatMargin(null)).toEqual({ text: "–", className: "text-muted-foreground" });
  });
});
