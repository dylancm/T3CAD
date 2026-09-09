# atopile

atopile lets you describe a circuit in `.ato` files and compile it with `ato build`
into a KiCad board, a bill of materials, and manufacturing outputs. T3CAD gives
every agent provider four tools for working with atopile projects, and the KiCad
viewer picks up the board the build writes.

## Requirements

The environment running T3CAD needs the `ato` compiler. On a machine with nothing
installed, **Settings → atopile → Install** downloads `uv` when it is missing and
prepares the chosen atopile release in uv's own tool environment, without touching
a system Python, then records the resulting command in the **ato command** setting.
Windows is not supported, because atopile publishes no Windows wheel; use WSL or a
remote environment there. Otherwise T3CAD looks for `ato` in this order:

1. The **ato command** in **Settings → atopile**, a full command line such as
   `uv run --project /src/atopile ato` for a source checkout. It is saved per
   server, so each machine can point at its own install.
2. `T3CAD_ATO_COMMAND`, the same command line as an environment variable.
3. `ato` on the PATH.
4. `uv` on the PATH, in which case T3CAD runs the pinned PyPI release through
   `uv tool run`.

**Settings → atopile** shows which of these applied, the exact command, and the
version found, with a **Check again** button after you install or change the
toolchain; edits to the command re-check automatically. The **Log directory**
setting on the same page tells atopile where to write its build logs
(`FBRK_LOG_DIR`), which keeps two atopile versions on one machine from sharing
a log database. Agents get the same information from `ato_status`. Part picking
in recent atopile releases requires an atopile account or a local parts
service; see the atopile documentation for the version you run.

`.ato` files are highlighted in the file preview, diffs, search results, and
code blocks using atopile's own grammar. Nothing needs enabling.

## Tools

- `ato_status` reports whether the compiler is available and how it is invoked.
- `ato_project` reads `ato.yaml` and returns the build names, entry modules, the
  board file each build writes, and the source, layout, and build directories.
- `ato_validate` compiles `.ato` files without building: syntax, imports,
  connections, and types in about a second, with compile errors as `file:line`.
  It checks every build's entry file unless the agent names files.
- `ato_build` runs `ato build` for one build or all of them, optionally with extra
  targets such as `mfg-data` or `3d-models`. It returns each stage's result,
  errors and warnings with `file:line` where atopile reports one, and the output
  files that exist afterwards. Builds run inside the project's workspace only.

Prompts such as "add a pull-up on SDA and build" work without naming the tools;
agents validate after each edit, fix the reported errors, and build before
reporting back.

## Skills

Two atopile skills are available to every agent provider without installation,
alongside the KiStack electronics skills:

- `ato-language` carries atopile's own language rules and syntax reference for
  writing and reviewing `.ato` files.
- `atopile-t3cad` explains how to build and iterate inside T3CAD: check the
  toolchain, read `ato.yaml`, validate after every edit, build before finishing,
  fix the reported diagnostics, and point you to the viewer's Design tab.

Agents read them when a workspace holds an `ato.yaml`. They do not appear in the
`$` skill picker, which lists only skills the provider itself discovers.

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

- A **Design** tab appears next to Schematic, PCB, 3D, Gerbers, and STEP. It
  shows the last build's outcome and diagnostics, the picked bill of materials
  with unit costs and stock, and every solved parameter next to its spec, with
  out-of-spec rows highlighted. It reads the `.bom.json` and `.variables.json`
  reports `ato build` writes, so it reflects builds started by agents as well as
  by the Build button.

Anyone who can open the viewer for a project can start a build of it. Builds
only regenerate that project's own outputs. See the
[KiCad viewer guide](./kicad.md) for the other tabs.
