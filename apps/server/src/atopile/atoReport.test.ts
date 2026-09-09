// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { AtopileBuildResult } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { parseAtoConfig } from "./atoProject.ts";
import {
  clearAtoBuildHistory,
  computeMargin,
  getLastAtoBuild,
  parseAtoBom,
  parseAtoQuantity,
  parseAtoVariables,
  readAtoReport,
  recordAtoBuild,
} from "./atoReport.ts";

// Trimmed from a real phase0 build (atopile 0.14.1004+76).
const BOM_JSON = `{
  "version": "1.0",
  "build_id": "337ad3e192434095",
  "components": [
    {
      "id": "c11702", "lcsc": "C11702", "manufacturer": "UNI ROYAL Uniroyal Elec",
      "mpn": "0402WGF1001TCE", "type": "resistor", "value": "1±1.0%kΩ 62.5mW 50V",
      "package": "UNI_ROYAL_Uniroyal_Elec_0402WGF1001TCE:R0402", "description": "1kΩ 50V",
      "quantity": 1, "unitCost": 0.0008, "stock": 2610919, "isBasic": true,
      "isPreferred": false, "source": "picked",
      "parameters": [{ "name": "resistance", "value": "1±1.0%kΩ", "unit": null }],
      "usages": [{ "address": "main.ato::App.r_led|Resistor", "designator": "R1" }]
    },
    {
      "id": "c2286", "lcsc": "C2286", "manufacturer": "Hubei KENTO Elec", "mpn": "KT-0603R",
      "type": "diode", "value": "", "package": "Hubei_KENTO_Elec_KT_0603R:LED", "description": "Red LED",
      "quantity": 2, "unitCost": 0.0059, "stock": 8154450, "isBasic": true, "isPreferred": false,
      "source": "explicit",
      "usages": [{ "address": "a", "designator": "D2" }, { "address": "b", "designator": "D1" }]
    }
  ]
}`;

const VARIABLES_JSON = `{
  "version": "1.0",
  "build_id": "337ad3e192434095",
  "nodes": [
    {
      "name": "c_3v3", "type": "module", "path": "c_3v3", "typeName": "Capacitor",
      "variables": [
        { "name": "capacitance", "spec": "{90..110}nF", "specTolerance": null, "actual": "{95..105}nF",
          "actualTolerance": null, "unit": "nF", "type": "capacitance", "meetsSpec": null, "source": "picked" },
        { "name": "max_voltage", "spec": "{≥10}V", "specTolerance": null, "actual": "50V",
          "actualTolerance": null, "unit": "V", "type": "voltage", "meetsSpec": null, "source": "picked" }
      ],
      "children": [
        {
          "name": "power", "type": "interface", "path": "c_3v3.power", "typeName": "ElectricPower",
          "variables": [
            { "name": "voltage", "spec": "{ℝ+}V", "specTolerance": null, "actual": null,
              "actualTolerance": null, "unit": "V", "type": "voltage", "meetsSpec": null, "source": "derived" }
          ],
          "children": []
        }
      ]
    },
    {
      "name": "led", "type": "module", "path": "led", "typeName": "LED",
      "variables": [
        { "name": "color", "spec": "RED", "specTolerance": null, "actual": "RED",
          "actualTolerance": null, "unit": null, "type": "dimensionless", "meetsSpec": null, "source": "picked" },
        { "name": "max_brightness", "spec": "{≥0.1}cd", "specTolerance": null, "actual": "300mcd",
          "actualTolerance": null, "unit": "cd", "type": "dimensionless", "meetsSpec": null, "source": "picked" }
      ],
      "children": [
        {
          "name": "diode", "type": "module", "path": "led.diode", "typeName": "Diode",
          "variables": [
            { "name": "forward_voltage", "spec": "2V", "specTolerance": "±20.0%", "actual": null,
              "actualTolerance": null, "unit": "V", "type": "voltage", "meetsSpec": null, "source": "picked" }
          ],
          "children": []
        }
      ]
    },
    {
      "name": "r_led", "type": "module", "path": "r_led", "typeName": "Resistor",
      "variables": [
        { "name": "max_power", "spec": "{≥0.05}W", "specTolerance": null, "actual": "62.5mW",
          "actualTolerance": null, "unit": "W", "type": "power", "meetsSpec": null, "source": "picked" },
        { "name": "resistance", "spec": "{900..1100}Ω", "specTolerance": null, "actual": "1kΩ",
          "actualTolerance": "±1.0%", "unit": "Ω", "type": "resistance", "meetsSpec": null, "source": "picked" }
      ],
      "children": []
    }
  ]
}`;

const ATO_YAML = `paths:\n  src: ./\n  layout: ./layouts\nbuilds:\n  default:\n    entry: main.ato:App\n`;

const buildResult: AtopileBuildResult = {
  ok: false,
  exitCode: 1,
  durationMs: 2000,
  command: ["ato"],
  projectDir: "/p",
  targets: [],
  errors: [{ message: "boom", file: "/p/main.ato", line: 3 }],
  warnings: [{ message: "meh" }],
  artifacts: [],
  outputTail: "",
};

afterEach(() => clearAtoBuildHistory());

describe("parseAtoBom", () => {
  it("merges designators per part and keeps cost and stock", () => {
    const lines = parseAtoBom(BOM_JSON);
    expect(lines.map((l) => [l.designators, l.lcsc, l.quantity, l.isBasic, l.source])).toEqual([
      [["R1"], "C11702", 1, true, "picked"],
      [["D1", "D2"], "C2286", 2, true, "explicit"],
    ]);
    expect(lines[0]).toMatchObject({
      unitCost: 0.0008,
      stock: 2610919,
      value: "1±1.0%kΩ 62.5mW 50V",
    });
  });
});

describe("parseAtoVariables", () => {
  it("flattens the node tree into rows with module paths, tolerances and margins", () => {
    const rows = parseAtoVariables(VARIABLES_JSON);
    expect(rows.map((r) => [r.path, r.name, r.margin])).toEqual([
      ["c_3v3", "capacitance", 0.5],
      ["c_3v3", "max_voltage", 4],
      ["c_3v3.power", "voltage", null],
      ["led", "color", null],
      ["led", "max_brightness", 2],
      ["led.diode", "forward_voltage", null],
      ["r_led", "max_power", 0.25],
      ["r_led", "resistance", 0.9],
    ]);
    expect(rows[7]).toEqual({
      path: "r_led",
      typeName: "Resistor",
      name: "resistance",
      spec: "{900..1100}Ω",
      actual: "1kΩ",
      actualTolerance: "±1.0%",
      unit: "Ω",
      source: "picked",
      margin: 0.9,
    });
    expect(rows[5]).toMatchObject({ spec: "2V", specTolerance: "±20.0%", actual: null });
    expect("specTolerance" in (rows[7] as object)).toBe(false);
  });
});

describe("parseAtoQuantity", () => {
  const q = (lo: number, hi: number, unit: string) => ({ lo, hi, unit });

  it("reads every form the variable report writes, scaled to the base unit", () => {
    expect(parseAtoQuantity("{900..1100}Ω")).toEqual(q(900, 1100, "Ω"));
    expect(parseAtoQuantity("1kΩ", "±1.0%")).toEqual(q(990, 1010, "Ω"));
    expect(parseAtoQuantity("1±1.0%kΩ")).toEqual(q(990, 1010, "Ω"));
    expect(parseAtoQuantity("{≥0.05}W")).toEqual(q(0.05, Infinity, "W"));
    expect(parseAtoQuantity("62.5mW")).toEqual(q(0.0625, 0.0625, "W"));
    expect(parseAtoQuantity("300mcd")).toEqual(q(0.3, 0.3, "cd"));
    expect(parseAtoQuantity("{ℝ+}V")).toEqual(q(0, Infinity, "V"));
    expect(parseAtoQuantity("{ℝ}V")).toEqual(q(-Infinity, Infinity, "V"));
    expect(parseAtoQuantity("2V", "±20.0%")).toEqual(q(1.6, 2.4, "V"));
    expect(parseAtoQuantity("{95..105}nF")).toEqual({
      lo: expect.closeTo(95e-9, 15),
      hi: expect.closeTo(105e-9, 15),
      unit: "F",
    });
  });

  it("accepts looser hand-written spellings", () => {
    expect(parseAtoQuantity("1kΩ ±10%")).toEqual(q(900, 1100, "Ω"));
    expect(parseAtoQuantity("3.3V +/- 5%")).toEqual(q(3.135, 3.465, "V"));
    expect(parseAtoQuantity("≥ 50mW")).toEqual(q(0.05, Infinity, "W"));
    expect(parseAtoQuantity("<= 10V")).toEqual(q(-Infinity, 10, "V"));
    expect(parseAtoQuantity("1.6V to 2.4V")).toEqual(q(1.6, 2.4, "V"));
    expect(parseAtoQuantity("1V", "±0.1V")).toEqual(q(0.9, 1.1, "V"));
    expect(parseAtoQuantity("900Ω..1.1kΩ")).toEqual(q(900, 1100, "Ω"));
  });

  it("returns null instead of guessing", () => {
    expect(parseAtoQuantity(null)).toBeNull();
    expect(parseAtoQuantity("")).toBeNull();
    expect(parseAtoQuantity("RED")).toBeNull();
    expect(parseAtoQuantity("{1, 2}V")).toBeNull();
    expect(parseAtoQuantity("{1..2, 5..6}V")).toBeNull();
    expect(parseAtoQuantity("{1..2}V", "±5%")).toBeNull();
    expect(parseAtoQuantity("1V", "±abc")).toBeNull();
    expect(parseAtoQuantity("1V", "±0.1A")).toBeNull();
    expect(parseAtoQuantity("2V..1V")).toBeNull();
    expect(parseAtoQuantity("{{}}")).toBeNull();
  });
});

describe("computeMargin", () => {
  const m = (spec: string, actual: string, actualTolerance?: string) => {
    const s = parseAtoQuantity(spec);
    const a = parseAtoQuantity(actual, actualTolerance);
    if (!s || !a) throw new Error("fixture does not parse");
    return computeMargin(s, a);
  };

  it("measures the allowance left on the tighter side of a two-sided spec", () => {
    expect(m("{900..1100}Ω", "1kΩ", "±1.0%")).toBe(0.9);
    expect(m("{90..110}nF", "{95..105}nF")).toBe(0.5);
    expect(m("{90..110}nF", "{91..105}nF")).toBe(0.1);
    expect(m("{900..1100}Ω", "1kΩ")).toBe(1);
    expect(m("{900..1100}Ω", "1.2kΩ")).toBe(-1);
  });

  it("measures distance from a one-sided bound as a fraction of the bound", () => {
    expect(m("{≥0.05}W", "62.5mW")).toBe(0.25);
    expect(m("{≥0.1}cd", "300mcd")).toBe(2);
    expect(m("{≥10}V", "50V")).toBe(4);
    expect(m("{≤10}V", "12V")).toBe(-0.2);
    expect(m("{≤10}V", "9V", "±1%")).toBeCloseTo(0.091, 3);
  });

  it("is null when there is nothing to measure against", () => {
    expect(m("{ℝ+}V", "5V")).toBeNull();
    expect(m("{ℝ}V", "5V")).toBeNull();
    expect(m("2V", "2V")).toBeNull();
    expect(m("{≥10}V", "50A")).toBeNull();
    expect(m("{≥10}V", "≥50V")).toBeNull();
  });
});

describe("readAtoReport", () => {
  it("reads whichever report files exist and includes the matching last build", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3cad-ato-report-"));
    try {
      const out = NodePath.join(root, "build", "builds", "default");
      await NodeFSP.mkdir(out, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(out, "default.bom.json"), BOM_JSON);
      await NodeFSP.writeFile(NodePath.join(out, "default.variables.json"), "{not json");
      const config = parseAtoConfig(ATO_YAML);
      recordAtoBuild(root, "default", buildResult, 1234);

      const report = await readAtoReport(root, config, "default");
      expect(report.bom?.length).toBe(2);
      expect(report.variables).toBeUndefined();
      expect(report.warnings).toEqual([
        "Could not read build/builds/default/default.variables.json.",
      ]);
      expect(report.lastBuild).toEqual({ finishedAt: 1234, result: buildResult });
      expect(getLastAtoBuild(root)?.build).toBe("default");

      // A build recorded for another build name does not leak into this report.
      recordAtoBuild(root, "debug", buildResult, 2000);
      expect((await readAtoReport(root, config, "default")).lastBuild).toBeUndefined();
      expect((await readAtoReport(root, config, "nope")).warnings[0]).toContain("not defined");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
