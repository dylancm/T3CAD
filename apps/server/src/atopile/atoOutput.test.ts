import { describe, expect, it } from "vite-plus/test";

import { parseAtoBuildOutput, parseAtoValidateOutput, stripAnsi } from "./atoOutput.ts";

// Trimmed from real `ato build` output (atopile 0.14.1004+76, 2026-09-08).
const SUCCESS = `
10:37:55.293  I  atopile.config  Using project /home/dylan/phase0
╭─ Build Summary ─────────────────────────────────────────────────────────────╮
│ ✓ phase0:default  [de84a54060d144dc]                                        │
│                                                                             │
│ Stages:                                                                     │
│   ✓ Initializing build context [1.11s]                                      │
│   ✓ Picking parts [1.11s]                                                   │
│   ✓ Updating PCB [0.06s]                                                    │
│   ✓ bom [0.03s]                                                             │
│                                                                             │
│ Errors (2):                                                                 │
│   • Failed to download datasheet datasheet_03a4.pdf: Datasheet URL          │
│     https://jlcpcb.com/api/file/1 is probably not a PDF                     │
│   • Failed to download datasheet datasheet_e99d.pdf: Datasheet URL          │
│     https://jlcpcb.com/api/file/2 is probably not a PDF                     │
│                                                                             │
│ Total: 3.82s                                                                │
╰─────────────────────────────────────────────────────────────────────────────╯
10:37:59.293  I  atopile.cli.build  Build successful! 🚀
`;

const FAILURE = `
Exception
Field \`r1.nonexistent_pin\` could not be resolved
Code causing the error:
  File "/home/dylan/phase0-broken/main.ato", line 11
   9     r1.package = "R0402"
  10     power_3v3.hv ~> r1 ~> power_3v3.lv
❱ 11     power_3v3.hv ~ r1.nonexistent_pin
  12
╭─ Build Summary ──────────────────────────────────────╮
│ ✗ phase0-broken:default  [fad8809e4e070435]          │
│                                                      │
│ Stages:                                              │
│   ✗ Initializing build context [1.05s]               │
│                                                      │
│ Errors (1):                                          │
│   • Field \`r1.nonexistent_pin\` could not be resolved │
│                                                      │
│ Total: 2.32s                                         │
╰──────────────────────────────────────────────────────╯
10:38:04.160  E  atopile.cli.build  Build failed! 1 of 1 targets failed
`;

// 0.15.x style: a titled warning without a bullet, and a "Source:" location.
const WARNINGS_015 = `
│   Exception                                                                       │
│   Field \`r_led.lcsc.can_be_operand\` could not be resolved                        │
│   Code causing the error:                                                         │
│   Source: /home/dylan/phase0/main.ato:22                                          │
╭─ Build Summary ───────────────────────────────────────────────────────────────────╮
│ ✗ default  [50ae51b123960c98]                                                     │
│ Stages:                                                                           │
│   ✓ Loading PCB [0.05s]                                                           │
│   ✗ Picking parts [0.16s]                                                         │
│ Errors (1):                                                                       │
│   Field \`r_led.lcsc.can_be_operand\` could not be resolved                        │
│ Warnings (1):                                                                     │
│   Deprecated Exception                                                            │
│   Multiple imports on one line is deprecated. Found: importElectricPower,Resistor │
│ Total: 0.78s                                                                      │
╰───────────────────────────────────────────────────────────────────────────────────╯
`;

describe("parseAtoBuildOutput", () => {
  it("reads stages, joins wrapped error lines, and reports success", () => {
    const result = parseAtoBuildOutput(SUCCESS, 0);
    expect(result.ok).toBe(true);
    expect(result.targets).toHaveLength(1);
    const target = result.targets[0]!;
    expect(target.name).toBe("phase0:default");
    expect(target.stages.map((s) => s.name)).toEqual([
      "Initializing build context",
      "Picking parts",
      "Updating PCB",
      "bom",
    ]);
    expect(target.stages[1]).toEqual({ name: "Picking parts", ok: true, seconds: 1.11 });
    expect(target.totalSeconds).toBe(3.82);
    expect(result.errors.map((e) => e.message)).toEqual([
      "Failed to download datasheet datasheet_03a4.pdf: Datasheet URL https://jlcpcb.com/api/file/1 is probably not a PDF",
      "Failed to download datasheet datasheet_e99d.pdf: Datasheet URL https://jlcpcb.com/api/file/2 is probably not a PDF",
    ]);
  });

  it("attaches the source location from the detail block to the error", () => {
    const result = parseAtoBuildOutput(FAILURE, 1);
    expect(result.ok).toBe(false);
    expect(result.targets[0]!.stages).toEqual([
      { name: "Initializing build context", ok: false, seconds: 1.05 },
    ]);
    expect(result.errors).toEqual([
      {
        message: "Field `r1.nonexistent_pin` could not be resolved",
        file: "/home/dylan/phase0-broken/main.ato",
        line: 11,
      },
    ]);
  });

  it("handles 0.15-style titled items and Source: locations", () => {
    const result = parseAtoBuildOutput(WARNINGS_015, 1);
    expect(result.errors).toEqual([
      {
        message: "Field `r_led.lcsc.can_be_operand` could not be resolved",
        file: "/home/dylan/phase0/main.ato",
        line: 22,
      },
    ]);
    expect(result.warnings.map((w) => w.message)).toEqual([
      "Deprecated Exception Multiple imports on one line is deprecated. Found: importElectricPower,Resistor",
    ]);
  });

  it("falls back to the last exception line when the CLI crashed before building", () => {
    const crash = `Traceback...\nImportError: cannot import name 'front_end' from 'atopile.compiler'\n10:38 I atopile.logging  Unfortunately errors ^^^ stopped the build.`;
    const result = parseAtoBuildOutput(crash, 1);
    expect(result.ok).toBe(false);
    expect(result.targets).toEqual([]);
    expect(result.errors[0]!.message).toContain("ImportError: cannot import name 'front_end'");
  });

  it("treats a non-zero exit with a clean box as a failure", () => {
    expect(parseAtoBuildOutput(SUCCESS, 1).ok).toBe(false);
  });

  it("reads the line, not the column, from a Source: path:line:column location", () => {
    const output = `
Syntax Error
mismatched input '(' expecting {';', NEWLINE}
Code causing the error:
Source: /home/dylan/phase0/main.ato:32:24
╭─ Build Summary ──────────────────────────────────────╮
│ ✗ phase0:default  [fad8809e4e070435]                 │
│ Errors (1):                                          │
│   • mismatched input '(' expecting {';', NEWLINE}    │
╰──────────────────────────────────────────────────────╯
`;
    expect(parseAtoBuildOutput(output, 1).errors).toEqual([
      {
        message: "mismatched input '(' expecting {';', NEWLINE}",
        file: "/home/dylan/phase0/main.ato",
        line: 32,
      },
    ]);
  });

  it("strips ANSI colour codes", () => {
    expect(stripAnsi("[32m✓[0m bom")).toBe("✓ bom");
  });
});

// Shape of `ato validate a.ato b.ato`: `<path>: ok` on stdout per passing
// file, the same detail blocks as `ato build` on stderr per failing one.
const VALIDATE_PASS = `
main.ato: ok
boards/extra.ato: ok
`;

const VALIDATE_FAIL = `
13:02:11.001  W  …ile.cli.configure  Couldn't enable plugin api: KeyErrorNotFound()
boards/extra.ato: ok
Syntax Error
mismatched input '(' expecting {';', NEWLINE}
Code causing the error:
Source: /home/dylan/phase0/main.ato:32:24
  31 │   assert led.diode.forward_voltage within 1.6V to 2.4V
❱ 32 │   r_led = new Resistor(
Exception
Field \`power_3v3.nonexistent_pin\` could not be resolved

Code causing the error:
  File "/home/dylan/phase0/main.ato", line 38
  37     power_3v3.hv ~> r_led ~> led.diode.anode
❱ 38     led.diode.cathode ~ power_3v3.nonexistent_pin
`;

describe("parseAtoValidateOutput", () => {
  const files = ["main.ato", "boards/extra.ato"];

  it("marks every echoed file ok on a clean exit", () => {
    expect(parseAtoValidateOutput(VALIDATE_PASS, 0, files)).toEqual({
      ok: true,
      files: [
        { path: "main.ato", ok: true },
        { path: "boards/extra.ato", ok: true },
      ],
      diagnostics: [],
    });
  });

  it("keeps the passing file ok and lists the failing file's diagnostics in order", () => {
    const result = parseAtoValidateOutput(VALIDATE_FAIL, 1, files);
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([
      { path: "main.ato", ok: false },
      { path: "boards/extra.ato", ok: true },
    ]);
    expect(result.diagnostics).toEqual([
      {
        message: "mismatched input '(' expecting {';', NEWLINE}",
        file: "/home/dylan/phase0/main.ato",
        line: 32,
      },
      {
        message: "Field `power_3v3.nonexistent_pin` could not be resolved",
        file: "/home/dylan/phase0/main.ato",
        line: 38,
      },
    ]);
  });

  it("matches ok lines whether the CLI echoes the path as given or resolved", () => {
    const output = "./main.ato: ok\n/abs/proj/boards/extra.ato: ok\n";
    expect(parseAtoValidateOutput(output, 0, files).files.every((f) => f.ok)).toBe(true);
  });

  it("is not ok on a clean exit with a diagnostic, nor on a failing exit without one", () => {
    expect(parseAtoValidateOutput(VALIDATE_FAIL, 0, files).ok).toBe(false);
    const crash = parseAtoValidateOutput(
      "ImportError: cannot import name 'front_end' from 'atopile.compiler'\n",
      1,
      files,
    );
    expect(crash.ok).toBe(false);
    expect(crash.files).toEqual([
      { path: "main.ato", ok: false },
      { path: "boards/extra.ato", ok: false },
    ]);
    expect(crash.diagnostics).toEqual([
      { message: "ImportError: cannot import name 'front_end' from 'atopile.compiler'" },
    ]);
    expect(parseAtoValidateOutput("", 2, files).diagnostics).toEqual([
      { message: "ato validate exited with code 2" },
    ]);
  });
});
