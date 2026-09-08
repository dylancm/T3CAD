import { describe, expect, it } from "vite-plus/test";

import { expectedArtifacts, parseAtoConfig } from "./atoProject.ts";

const TEMPLATE_015 = `
requires-atopile: "^0.14.0"

paths:
  src: ./
  layout: ./layouts

builds:
  default:
    entry: main.ato:App

services:
  components:
    url: http://127.0.0.1:8720
`;

const LEGACY = `
requires-atopile: ^0.9.0
dependencies:
  - atopile/usb-connectors
  - identifier: atopile/ti-tlv75901
    version: "1.0.0"
builds:
  default:
    address: elec/src/main.ato:Main
  debug:
    entry: elec/src/debug.ato:Debug
    paths:
      layout: elec/layout/special
`;

describe("parseAtoConfig", () => {
  it("reads the current project template and derives the board path", () => {
    const cfg = parseAtoConfig(TEMPLATE_015);
    expect(cfg.requiresAtopile).toBe("^0.14.0");
    expect(cfg.srcDir).toBe("");
    expect(cfg.layoutDir).toBe("layouts");
    expect(cfg.buildDir).toBe("build");
    expect(cfg.componentsServiceUrl).toBe("http://127.0.0.1:8720");
    expect(cfg.builds).toEqual([
      { name: "default", entry: "main.ato:App", layoutPcb: "layouts/default/default.kicad_pcb" },
    ]);
  });

  it("applies atopile's defaults and accepts the older address alias", () => {
    const cfg = parseAtoConfig(LEGACY);
    expect(cfg.srcDir).toBe("elec/src");
    expect(cfg.layoutDir).toBe("elec/layout");
    expect(cfg.dependencies).toEqual(["atopile/usb-connectors", "atopile/ti-tlv75901"]);
    expect(cfg.builds.map((b) => [b.name, b.entry, b.layoutPcb])).toEqual([
      ["default", "elec/src/main.ato:Main", "elec/layout/default/default.kicad_pcb"],
      ["debug", "elec/src/debug.ato:Debug", "elec/layout/special/debug.kicad_pcb"],
    ]);
  });

  it("tolerates an empty or minimal file", () => {
    expect(parseAtoConfig("").builds).toEqual([]);
    expect(parseAtoConfig("builds: {}\n").layoutDir).toBe("elec/layout");
  });

  it("lists every output a build can produce, project-relative", () => {
    const cfg = parseAtoConfig(TEMPLATE_015);
    const paths = expectedArtifacts(cfg, cfg.builds[0]!).map((a) => `${a.kind}=${a.path}`);
    expect(paths).toContain("pcb=layouts/default/default.kicad_pcb");
    expect(paths).toContain("bom-json=build/builds/default/default.bom.json");
    expect(paths).toContain("gerbers=build/builds/default/default.gerber.zip");
    expect(paths).toContain("manifest=build/manifest.json");
  });
});
