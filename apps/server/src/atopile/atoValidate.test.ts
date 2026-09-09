import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AtopileInvalidInputError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as AtopileToolchain from "./AtopileToolchain.ts";
import { readAtoProject } from "./atoBuild.ts";
import { parseAtoConfig } from "./atoProject.ts";
import { entryFiles, runAtoValidate, VALIDATE_TIMEOUT_MS } from "./atoValidate.ts";

// Two builds share main.ato; one is a Python entry, which validate cannot take.
const ATO_YAML = `paths:
  src: ./
builds:
  default:
    entry: main.ato:App
  variant:
    entry: ./main.ato:Variant
  extra:
    entry: boards/extra.ato:Extra
  script:
    entry: gen.py:Main
`;

const PASSING = { stdout: "main.ato: ok\nboards/extra.ato: ok\n", stderr: "", exitCode: 0 };

const FAILING = {
  stdout: "boards/extra.ato: ok\n",
  stderr: `
Syntax Error
mismatched input '(' expecting {';', NEWLINE}
Code causing the error:
Source: /proj/main.ato:32:24
  31 │   assert led.diode.forward_voltage within 1.6V to 2.4V
❱ 32 │   r_led = new Resistor(
Exception
Field \`power_3v3.nonexistent_pin\` could not be resolved

Code causing the error:
  File "/proj/main.ato", line 38
  37     power_3v3.hv ~> r_led ~> led.diode.anode
❱ 38     led.diode.cathode ~ power_3v3.nonexistent_pin
`,
  exitCode: 1,
};

interface CannedRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut?: boolean;
}

const toolchainLayer = (canned: CannedRun, runs: AtopileToolchain.AtopileRunInput[]) =>
  Layer.succeed(
    AtopileToolchain.AtopileToolchain,
    AtopileToolchain.AtopileToolchain.of({
      status: () => Effect.succeed({ available: true, command: ["ato"] }),
      run: (input) => {
        runs.push(input);
        return Effect.succeed({
          command: ["ato"],
          exitCode: canned.exitCode,
          stdout: canned.stdout,
          stderr: canned.stderr,
          timedOut: canned.timedOut ?? false,
        });
      },
    }),
  );

/** A temp project holding `ato.yaml` and the two `.ato` entry files. */
const withProject = <A, E>(
  canned: CannedRun,
  body: (
    root: string,
    runs: AtopileToolchain.AtopileRunInput[],
  ) => Effect.Effect<A, E, AtopileToolchain.AtopileToolchain | FileSystem.FileSystem>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3cad-ato-validate-" });
      yield* fs.writeFileString(path.join(root, "ato.yaml"), ATO_YAML);
      yield* fs.writeFileString(path.join(root, "main.ato"), "module App:\n    pass\n");
      yield* fs.makeDirectory(path.join(root, "boards"));
      yield* fs.writeFileString(
        path.join(root, "boards", "extra.ato"),
        "module Extra:\n    pass\n",
      );
      const runs: AtopileToolchain.AtopileRunInput[] = [];
      return yield* body(root, runs).pipe(Effect.provide(toolchainLayer(canned, runs)));
    }),
  ).pipe(Effect.provide(NodeServices.layer));

it("collects each build's .ato entry once, ignoring Python entries", () => {
  expect(entryFiles(parseAtoConfig(ATO_YAML))).toEqual(["main.ato", "boards/extra.ato"]);
});

it.effect("validates every entry file by default and reports each as ok", () =>
  withProject(PASSING, (root, runs) =>
    Effect.gen(function* () {
      const location = yield* readAtoProject(root);
      const result = yield* runAtoValidate(location, {});
      expect(runs).toHaveLength(1);
      expect(runs[0]).toEqual({
        args: ["validate", "main.ato", "boards/extra.ato"],
        cwd: root,
        timeoutMs: VALIDATE_TIMEOUT_MS,
      });
      expect(result).toMatchObject({
        ok: true,
        exitCode: 0,
        command: ["ato"],
        projectDir: root,
        files: [
          { path: "main.ato", ok: true },
          { path: "boards/extra.ato", ok: true },
        ],
        diagnostics: [],
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }),
  ),
);

it.effect("reports the failing file's diagnostics and keeps the passing file ok", () =>
  withProject(FAILING, (root) =>
    Effect.gen(function* () {
      const location = yield* readAtoProject(root);
      const result = yield* runAtoValidate(location, { files: ["./main.ato", "boards/extra.ato"] });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.files).toEqual([
        { path: "main.ato", ok: false },
        { path: "boards/extra.ato", ok: true },
      ]);
      expect(result.diagnostics).toEqual([
        {
          message: "mismatched input '(' expecting {';', NEWLINE}",
          file: "/proj/main.ato",
          line: 32,
        },
        {
          message: "Field `power_3v3.nonexistent_pin` could not be resolved",
          file: "/proj/main.ato",
          line: 38,
        },
      ]);
    }),
  ),
);

it.effect("marks a timed-out run as failed with an explanatory diagnostic", () =>
  withProject({ stdout: "", stderr: "", exitCode: null, timedOut: true }, (root) =>
    Effect.gen(function* () {
      const location = yield* readAtoProject(root);
      const result = yield* runAtoValidate(location, { files: ["main.ato"] });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.files).toEqual([{ path: "main.ato", ok: false }]);
      expect(result.diagnostics).toContainEqual({
        message: "ato validate exceeded its time limit and was stopped.",
      });
    }),
  ),
);

it.effect(
  "rejects files outside the project, non-.ato files, and missing files before running",
  () =>
    withProject(PASSING, (root, runs) =>
      Effect.gen(function* () {
        const location = yield* readAtoProject(root);
        const attempt = (files: string[]) => runAtoValidate(location, { files }).pipe(Effect.flip);
        const escaping = yield* attempt(["../outside.ato"]);
        expect(escaping).toBeInstanceOf(AtopileInvalidInputError);
        expect(escaping.message).toContain("outside the project directory");
        const notAto = yield* attempt(["ato.yaml"]);
        expect(notAto.message).toContain("not an .ato file");
        const missing = yield* attempt(["boards/nope.ato"]);
        expect(missing.message).toContain("does not exist");
        expect(runs).toHaveLength(0);
      }),
    ),
);
