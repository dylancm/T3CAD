// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off cryptoRandomUUID:off globalDateInEffect:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { discoverKiCadProject, resolveKiCadProjectFile } from "./KiCadProject.ts";
import { storedZip } from "./testSupport.ts";
import { afterEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";

afterEach(() => vi.restoreAllMocks());

const tempRoot = () => NodePath.join("/tmp", `t3-kicad-${crypto.randomUUID()}`);

it.effect(
  "discovers source and generated KiCad files recursively, including ignored build output",
  () =>
    Effect.promise(async () => {
      const root = tempRoot();
      NodeFS.mkdirSync(NodePath.join(root, "build", "gerbers"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, ".git"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "board.kicad_pcb"), "pcb");
      NodeFS.writeFileSync(NodePath.join(root, "board.kicad_sch"), "sch");
      NodeFS.writeFileSync(NodePath.join(root, "build", "gerbers", "board-F_Cu.gtl"), "gerber");
      NodeFS.writeFileSync(NodePath.join(root, "build", "board.step"), "step");
      NodeFS.writeFileSync(NodePath.join(root, ".git", "ignored.gbr"), "ignored");
      for (const directory of [".history", "hardware/.history"]) {
        NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
        for (const extension of ["kicad_pcb", "kicad_sch", "gbr", "glb"])
          NodeFS.writeFileSync(NodePath.join(root, directory, `old.${extension}`), "archived");
      }
      const manifest = await discoverKiCadProject(root);
      expect(await resolveKiCadProjectFile(root, ".history/old.kicad_pcb")).toBeUndefined();
      expect(manifest.files.map((file) => file.path)).toEqual([
        "board.kicad_pcb",
        "board.kicad_sch",
        "build/board.step",
        "build/gerbers/board-F_Cu.gtl",
      ]);
      expect(manifest.files.find((file) => file.kind === "gerber")?.mimeType).toBe(
        "application/octet-stream",
      );
    }),
);

it.effect(
  "changes revision when an inspected file changes and rejects traversal/symlink escapes",
  () =>
    Effect.promise(async () => {
      const root = tempRoot();
      const outside = tempRoot();
      NodeFS.mkdirSync(root, { recursive: true });
      NodeFS.mkdirSync(outside, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "board.kicad_pcb"), "one");
      NodeFS.writeFileSync(NodePath.join(outside, "outside.kicad_pcb"), "secret");
      NodeFS.symlinkSync(
        NodePath.join(outside, "outside.kicad_pcb"),
        NodePath.join(root, "link.kicad_pcb"),
      );
      const first = await discoverKiCadProject(root);
      NodeFS.utimesSync(
        NodePath.join(root, "board.kicad_pcb"),
        new Date(),
        new Date(Date.now() + 1000),
      );
      NodeFS.writeFileSync(NodePath.join(root, "board.kicad_pcb"), "two");
      // writeFileSync stamps "now"; on a fast run that can equal the first scan's
      // mtime at millisecond resolution, so move it explicitly.
      NodeFS.utimesSync(
        NodePath.join(root, "board.kicad_pcb"),
        new Date(),
        new Date(Date.now() + 2000),
      );
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 350);
      expect((await discoverKiCadProject(root)).revision).not.toBe(first.revision);
      expect(await resolveKiCadProjectFile(root, "../outside.kicad_pcb")).toBeUndefined();
      expect(await resolveKiCadProjectFile(root, "link.kicad_pcb")).toBeUndefined();
    }),
);

it.effect("reports malformed project configuration without preventing discovery", () =>
  Effect.promise(async () => {
    const root = tempRoot();
    NodeFS.mkdirSync(root, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, ".k3eda.json"), "{broken");
    NodeFS.writeFileSync(NodePath.join(root, "board.kicad_pro"), "{}");
    const manifest = await discoverKiCadProject(root);
    expect(manifest.files[0]?.kind).toBe("project");
    expect(manifest.warnings).toContain("Unable to parse .k3eda.json");
  }),
);

it.effect("discovers library assets and preserves the optional analysis dashboard", () =>
  Effect.promise(async () => {
    const root = tempRoot();
    NodeFS.mkdirSync(NodePath.join(root, "parts.pretty"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "parts.pretty", "antenna.kicad_mod"),
      '(footprint "antenna")',
    );
    NodeFS.writeFileSync(NodePath.join(root, "parts.kicad_sym"), "(kicad_symbol_lib)");
    NodeFS.writeFileSync(
      NodePath.join(root, ".k3eda.json"),
      '{"analysisUrl":"https://analysis.example.test/"}',
    );
    const manifest = await discoverKiCadProject(root);
    expect(manifest.files.map(({ kind }) => kind).sort()).toEqual(["footprint", "symbol"]);
    expect(manifest.config?.analysisUrl).toBe("https://analysis.example.test/");
    expect((await resolveKiCadProjectFile(root, "parts.pretty/antenna.kicad_mod"))?.file.kind).toBe(
      "footprint",
    );
  }),
);

it.effect("reads explicit library assignments and reports missing assigned assets", () =>
  Effect.promise(async () => {
    const root = tempRoot();
    NodeFS.mkdirSync(root, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "parts.kicad_sym"), "(kicad_symbol_lib)");
    NodeFS.writeFileSync(
      NodePath.join(root, ".k3eda.json"),
      `{"symbol":"parts.kicad_sym","symbolMember":"Controller","footprint":"generated/controller.kicad_mod"}`,
    );
    const manifest = await discoverKiCadProject(root);
    expect(manifest.config).toMatchObject({
      symbol: "parts.kicad_sym",
      symbolMember: "Controller",
      footprint: "generated/controller.kicad_mod",
    });
    expect(manifest.warnings).toContain(
      "Configured footprint file not found: generated/controller.kicad_mod",
    );
  }),
);

const ATO_YAML = `requires-atopile: "^0.14.0"
paths:
  src: ./
  layout: ./layouts
builds:
  default:
    entry: main.ato:App
  debug:
    entry: main.ato:Debug
`;

it.effect(
  "describes atopile builds, unpacks gerber archives, and defaults the viewer to the built board",
  () =>
    Effect.promise(async () => {
      const root = tempRoot();
      NodeFS.mkdirSync(NodePath.join(root, "layouts", "default"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, "build", "builds", "default"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "ato.yaml"), ATO_YAML);
      NodeFS.writeFileSync(NodePath.join(root, "layouts", "default", "default.kicad_pcb"), "pcb");
      NodeFS.writeFileSync(
        NodePath.join(root, "build", "builds", "default", "default.pcba.glb"),
        "glb",
      );
      NodeFS.writeFileSync(
        NodePath.join(root, "build", "builds", "default", "default.bom.json"),
        "[]",
      );
      NodeFS.writeFileSync(
        NodePath.join(root, "build", "builds", "default", "default.gerber.zip"),
        storedZip([
          ["default-F_Cu.gbr", "G04 front*"],
          ["default-Edge_Cuts.gbr", "G04 edge*"],
        ]),
      );
      const manifest = await discoverKiCadProject(root);
      expect(manifest.atopile).toEqual({
        configPath: "ato.yaml",
        builds: [
          {
            name: "default",
            layoutPcb: "layouts/default/default.kicad_pcb",
            layoutExists: true,
            glb: "build/builds/default/default.pcba.glb",
            bomJson: "build/builds/default/default.bom.json",
            gerberDir: "build/builds/default/gerbers",
          },
          { name: "debug", layoutPcb: "layouts/debug/debug.kicad_pcb", layoutExists: false },
        ],
      });
      expect(manifest.config).toEqual({
        pcb: "layouts/default/default.kicad_pcb",
        gerbers: ["build/builds/default/gerbers"],
      });
      expect(
        manifest.files.filter((file) => file.kind === "gerber").map((file) => file.path),
      ).toEqual([
        "build/builds/default/gerbers/default-Edge_Cuts.gbr",
        "build/builds/default/gerbers/default-F_Cu.gbr",
      ]);
      expect(manifest.warnings).toEqual([]);
    }),
);

it.effect(
  "keeps explicit .k3eda.json assignments over atopile defaults and flags a bad ato.yaml",
  () =>
    Effect.promise(async () => {
      const root = tempRoot();
      NodeFS.mkdirSync(NodePath.join(root, "layouts", "default"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "ato.yaml"), ATO_YAML);
      NodeFS.writeFileSync(NodePath.join(root, "layouts", "default", "default.kicad_pcb"), "pcb");
      NodeFS.writeFileSync(NodePath.join(root, "other.kicad_pcb"), "pcb");
      NodeFS.writeFileSync(NodePath.join(root, ".k3eda.json"), '{"pcb":"other.kicad_pcb"}');
      const manifest = await discoverKiCadProject(root);
      expect(manifest.config?.pcb).toBe("other.kicad_pcb");
      expect(manifest.atopile?.builds[0]?.layoutExists).toBe(true);

      const broken = tempRoot();
      NodeFS.mkdirSync(broken, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(broken, "ato.yaml"), "builds: [not: a: map");
      const brokenManifest = await discoverKiCadProject(broken);
      expect(brokenManifest.atopile).toBeUndefined();
      expect(brokenManifest.warnings).toContain("Unable to parse ato.yaml");
    }),
);
