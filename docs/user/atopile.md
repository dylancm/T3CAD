# atopile

atopile lets you describe a circuit in `.ato` files and compile it with `ato build`
into a KiCad board, a bill of materials, and manufacturing outputs. T3CAD gives
every agent provider three tools for working with atopile projects, and the KiCad
viewer picks up the board the build writes.

## Requirements

The environment running T3CAD needs the `ato` compiler. T3CAD looks for it in this
order and does not install anything itself:

1. `T3CAD_ATO_COMMAND`, an environment variable holding a full command line, for
   example `uv run --project /src/atopile ato` for a source checkout.
2. `ato` on the PATH.
3. `uv` on the PATH, in which case T3CAD runs the pinned PyPI release through
   `uv tool run`.

Ask the agent to call `ato_status` to see which of these applied and the version
found. Part picking in recent atopile releases requires an atopile account or a
local parts service; see the atopile documentation for the version you run.

## Tools

- `ato_status` reports whether the compiler is available and how it is invoked.
- `ato_project` reads `ato.yaml` and returns the build names, entry modules, the
  board file each build writes, and the source, layout, and build directories.
- `ato_build` runs `ato build` for one build or all of them, optionally with extra
  targets such as `mfg-data` or `3d-models`. It returns each stage's result,
  errors and warnings with `file:line` where atopile reports one, and the output
  files that exist afterwards. Builds run inside the project's workspace only.

Prompts such as "add a pull-up on SDA and build" work without naming the tools;
agents call `ato_build` after editing `.ato` files and fix the reported errors.

## In the KiCad viewer

When the workspace root holds an `ato.yaml`, the KiCad viewer recognises the
project without configuration:

- The PCB and 3D tabs show the first build's board (`<layout dir>/<build>/<build>.kicad_pcb`)
  as soon as it exists. A `pcb` assignment in `.k3eda.json` still wins.
- The header gains a **Build** button, with a build picker when `ato.yaml`
  defines more than one build. It runs `ato build` in the project and shows the
  outcome in a status strip: duration and warning count on success, or the first
  error with its file and line on failure. Saved files refresh automatically
  after a successful build.
- The 3D tab reuses the build's own `.pcba.glb` when it is at least as new as
  the board, so no `kicad-cli` export runs.
- Gerbers from `ato build --target mfg-data` arrive as `<build>.gerber.zip`. The
  viewer unpacks that archive into a `gerbers` folder next to it and shows the
  layers in the Gerber tab.

- **Tools, then Design** opens a tab with the last build's outcome and
  diagnostics, the picked bill of materials with unit costs and stock, and every
  solved parameter next to its spec, with out-of-spec rows highlighted. It reads
  the `.bom.json` and `.variables.json` reports `ato build` writes, so it reflects
  builds started by agents as well as by the Build button.

Anyone who can open the viewer for a project can start a build of it. Builds
only regenerate that project's own outputs. See the
[KiCad viewer guide](./kicad.md) for the other tabs.
