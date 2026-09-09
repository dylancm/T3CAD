---
name: atopile-t3cad
description: "Use when a workspace contains ato.yaml: how to validate, build, inspect and iterate on atopile projects inside T3CAD with the ato_status, ato_project, ato_validate and ato_build tools and the KiCad viewer's Design tab."
---

# atopile projects in T3CAD

A workspace with an `ato.yaml` at its root is an atopile project. The `.ato`
files are the source of truth: describe the circuit there, then compile with
`ato build` to regenerate the KiCad board, the bill of materials and the
manufacturing outputs. T3CAD exposes the compiler through four tools; use them
instead of running `ato` in a shell.

## Rules

- Edit `.ato` files and `ato.yaml`. Never hand-edit `layouts/**/*.kicad_pcb`;
  atopile owns the board file and rewrites footprints, nets and fields on every
  build. Only component positions survive between builds.
- Do not install, upgrade or configure atopile yourself. If `ato_status` reports
  the toolchain is missing, relay its error to the user and stop.
- Validate after every edit with `ato_validate`; it compiles in about a second.
  Do not report a change as done until `ato_build` succeeds for the affected
  build.

## Workflow

1. Call `ato_status` once at the start. It reports whether `ato` is available,
   which command T3CAD uses to run it (the ato command from Settings → atopile,
   an explicit `T3CAD_ATO_COMMAND`, `ato` on the PATH, or the pinned release
   through `uv tool run`) and the version.
2. Call `ato_project` to read `ato.yaml`: the build names, each build's entry
   module (`file.ato:Module`), where each build writes its `.kicad_pcb`, and
   the source, layout and build directories. Use the build names it returns
   when calling `ato_build`; do not guess them.
3. Edit the `.ato` sources (follow the `ato-language` skill for syntax and
   semantics), then call `ato_validate`. It compiles the files without picking
   parts or touching the board and returns each file's pass/fail plus compile
   errors with `file:line`. Omit `files` to check every build's entry file, or
   pass the files you edited. Fix every compile error and validate again until
   it passes; only then call `ato_build`.
4. Call `ato_build` with the relevant `build` name (omit it to build all). It
   returns per-stage results, errors and warnings with `file:line` where atopile
   reports one, and the artifacts that exist afterwards. Part picking may
   contact a parts service, so allow a few minutes.
5. Fix every reported error at the given `file:line`, validate, rebuild, and
   repeat until the build passes. Treat warnings as worth reading, not as
   blockers.
6. Pass extra `targets` when the user needs more than the board: `mfg-data`
   produces gerbers, pick-and-place and BOM exports; `3d-models` produces the
   3D model of the assembled board.

## Fixing compile and build errors

`ato_validate` catches the first two kinds; the picker and solver only run in
`ato_build`.

- Syntax error: the parser names the file and line. Check indentation, colons
  after block headers, and that experimental syntax (`~>`, `for`, `trait`,
  `new X<...>`) has its `#pragma experiment(...)` enabled at the top of the file.
- Unresolved import: the module name or path in `from "..." import ...` does not
  match a file in the source directory or an installed package. Check the path
  relative to the project's `src` directory and the package's `ato.yaml`.
- No part found: the picker could not satisfy the constraints. Widen tolerances
  (`assert resistance within 10kohm +/- 10%` instead of an exact value), relax
  the `package`, or pin a specific part with `lcsc_id = "C12345"`.
- Solver contradiction: two constraints on the same parameter cannot both hold
  (for example a fixed value and a range that excludes it). Trace every
  `assert` on that parameter, including ones inherited through connections,
  and remove or loosen the conflicting one.

## Parts

- Passives (`Resistor`, `Capacitor`, `Inductor`) are picked automatically from
  their parameter constraints. Give every value a tolerance or a range; an
  exact value has zero tolerance and matches nothing.
- Everything else needs an explicit part: a component from an installed package
  or an `lcsc_id` on the module.

## After a successful build

Tell the user where to look in the KiCad viewer:

- The PCB and 3D tabs show the build's board.
- The Design tab shows the build's outcome and diagnostics, the picked BOM with
  unit costs and stock, and every solved parameter next to its spec, with
  a Margin column showing how much of each spec's allowance the picked part
  leaves unused. It reflects agent-run builds as well as builds
  started with the viewer's Build button.
- Gerbers from `mfg-data` appear in the Gerber tab once the build has written
  `<build>.gerber.zip`.
