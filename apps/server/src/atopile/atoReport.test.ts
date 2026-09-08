// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { AtopileBuildResult } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { parseAtoConfig } from "./atoProject.ts";
import {
  clearAtoBuildHistory,
  getLastAtoBuild,
  parseAtoBom,
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
          "actualTolerance": null, "unit": "nF", "type": "capacitance", "meetsSpec": null, "source": "picked" }
      ],
      "children": [
        {
          "name": "power", "type": "interface", "path": "c_3v3.power", "typeName": "ElectricPower",
          "variables": [
            { "name": "voltage", "spec": "{ℝ+}V", "specTolerance": null, "actual": null,
              "actualTolerance": null, "unit": "V", "type": "voltage", "meetsSpec": false, "source": "derived" }
          ],
          "children": []
        }
      ]
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
  it("flattens the node tree into rows with module paths", () => {
    const rows = parseAtoVariables(VARIABLES_JSON);
    expect(rows).toEqual([
      {
        path: "c_3v3",
        typeName: "Capacitor",
        name: "capacitance",
        spec: "{90..110}nF",
        actual: "{95..105}nF",
        unit: "nF",
        source: "picked",
        meetsSpec: null,
      },
      {
        path: "c_3v3.power",
        typeName: "ElectricPower",
        name: "voltage",
        spec: "{ℝ+}V",
        actual: null,
        unit: "V",
        source: "derived",
        meetsSpec: false,
      },
    ]);
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
