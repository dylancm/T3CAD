# atopile integration: open items

Status of the atopile-in-T3CAD effort and everything still open, across the
four repositories involved. Kept here at the fork maintainer's request; upstream
T3 Code keeps plans out of the tree, so this file is fork-only.

Original evaluation and plan: https://claude.ai/code/artifact/7816e528-6a4f-4d01-b860-d3e9e39f743a

## Repositories

| Repo                                                | Role                                                                      | State (2026-09-08)                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `dylancm/T3CAD` (this fork, branch `t3cad`)         | Agent workspace + KiCad viewer + atopile tools                            | Phase 0 and 1 done                                       |
| `dylancm/atopile` (branch `fix/easyeda-user-agent`) | March 2026 open-source atopile, built from source                         | 1 local fix; upstream public repo stale since 2026-03-11 |
| `dylancm/parts-server` (private)                    | Stand-in for atopile's retired components API over the jlcparts catalogue | Explicit + parametric picking working                    |
| `dylancm/t3cad-phase0` (private)                    | Sample `.ato` project wired to T3CAD                                      | Builds with no atopile account                           |

## Done

- **Phase 0** — config-only spike: `t3.json` build script, `.k3eda.json`,
  agent rules, community skills. Confirmed the build → viewer loop, and that
  atopile 0.15.8 gates every part behind `ato auth login`.
- **parts-server** — `/v0/component/lcsc`, `/v0/component/mfr`, batched
  `/v0/query`, parametric resistors/capacitors/inductors with interval
  matching, atopile-format `attributes`, 400 error-list responses.
- **atopile fix** — browser-like headers for EasyEDA footprint downloads
  (`fix/easyeda-user-agent`), without which every part fails after picking.
- **Phase 1** — `ato_status`, `ato_project`, `ato_build` MCP tools;
  toolchain resolution via `T3CAD_ATO_COMMAND` → PATH → `uv tool run`;
  structured build output parser; `docs/user/atopile.md`.

## Open: T3CAD

### Phase 2 — project awareness in the KiCad panel

- Detect `ato.yaml` in `apps/server/src/kicad/KiCadProject.ts` and derive
  default PCB/GLB/BOM/Gerber locations from `paths.layout` and `builds`;
  fold `.k3eda.json` overrides on top. Add `atopile?: { builds }` to the manifest.
- Unpack `<name>.gerber.zip` to a temp dir for the Gerber tab (the tab wants
  loose layer files and rejects `.gbrjob`).
- Prefer atopile's `.pcba.glb` over running `kicad-cli` when present and newer.
- Build-target select + Build button in the viewer header (web and mobile),
  streaming through the terminal manager; status pill from the exit code.
- Review the 50,000-entry scan cap and 300 ms manifest cache against a real
  `build/` tree.
- Decide the config surface: fold KiCad and atopile settings into `t3.json`
  or commit to `.k3eda.json`. Do not add a third file.

### Phase 3 — diagnostics, BOM, variables (needs re-scoping)

- The plan assumed `ato serve backend` with `/api/problems`, `/api/bom`,
  `/api/variables`. atopile 0.15.8 ships `ato serve core` instead: RPC-style
  kicad/layout/diff domains and only a `/ws/logs` route. The March source has
  the old server. Re-survey before building a sidecar; the CLI-only path
  (parse `ato build` output, read `build/builds/<name>/*.json`) may be enough.
- A "Design" tab: problems with severity and `file:line`, BOM from
  `<name>.bom.json`, variables from `<name>.variables.json`.
- Feed problems into `ato_build` results (already carries stage errors).

### Phase 4 — embed atopile's own panels (elective)

- Vendor the built `src/ui-server` sidebar from atopile `619eda7f` under
  `apps/web/public/atopile-ui/` with license + pinned commit, iframe it with
  the five `window.__ATOPILE_*` globals, implement the five delegated host
  actions (`openFile`, `openSource`, `openLayout`, `openKiCad`, `open3D`).
- Mount the WebGL layout editor (`src/atopile/layout_server/frontend`) as a
  Layout tab. Theme shim from T3 CSS variables to VS Code variable names.
- Only worthwhile if Phase 3 sidecar work happens; otherwise skip.

### Phase 5 — skills, install flow, docs

- `.agents/skills/atopile/` assembled from atopile's MIT rule templates plus a
  T3CAD recipe for `ato_build`; `.claude/skills` mirror for the Claude provider.
- Toolchain install helper mirroring the VS Code extension (download `uv`,
  `uv tool install atopile==0.15.8 -p 3.14`), surfaced in Settings.
- `.ato` syntax highlighting in the file viewer from atopile's TextMate grammar.
- One `docs/internals/` paragraph on why atopile is an external toolchain.

### Smaller T3CAD items

- `T3CAD_ATO_COMMAND` is an environment variable; a per-project or Settings
  entry would be friendlier. Environment variables also cannot carry
  `FBRK_LOG_DIR`, needed when mixing atopile versions on one machine.
- `ato_validate` was dropped because `ato validate` crashes in the March source
  (`ImportError: front_end`). Revisit if a version fixes it.
- Capability gating: the atopile tools are granted to every MCP session. Add an
  `"atopile"` capability if per-thread control is wanted
  (`McpInvocationContext.ts`, `McpSessionRegistry.ts`).
- Windows: no 0.15.x wheel exists, and the toolchain probe assumes POSIX
  shells in tests. Document as unsupported until a wheel appears.
- Bundled electronics skills (upstream's KiStack set) and the atopile skills
  overlap; decide which the agent sees by default.

## Open: parts-server

- `attributes` on explicit lookups (`/v0/component/lcsc/{id}`) so pinned parts
  carry resistance/capacitance/etc. into atopile's solver, not just parametric picks.
- More part families using atopile's 2024 `mappings.py` as the guide: LEDs
  (colour, forward voltage, current), diodes, TVS, MOSFETs. Requires the
  matching `is_pickable_by_type` endpoints on the atopile side, which today
  only exist for resistors, capacitors, inductors.
- Hot-value latency: common values (1kΩ 0402) take ~0.3 s due to ordering
  across thousands of matches. A covering index on
  `(endpoint, package, resistance_min, basic, preferred, stock)` or a
  pre-ranked column would bring it to ~20 ms.
- Temperature coefficient coverage is ~45% of MLCCs; codes outside atopile's
  enum (`U2J`, `X8G`, `X6S`, `X7T`, `X8L`) are dropped. Widening requires an
  atopile enum change.
- Datasheet URLs from JLCPCB are redirects that atopile rejects as "not a
  PDF", producing two noisy errors per build. Options: resolve redirects at
  index time, or serve the LCSC datasheet URL when available.
- Catalogue refresh: `fetch-catalog` is manual (650 MB download, ~2 min index).
  A `--if-older-than` guard or scheduled refresh would help.
- jlcparts is a scrape of JLCPCB's catalogue; review terms before offering the
  server publicly. Repo is private for now.
- Multiple backends: the `Catalog` protocol exists but only jlcparts
  implements it. A Mouser/DigiKey or private-inventory backend is the test of
  the abstraction.

## Open: atopile checkout

- Upstream the EasyEDA header fix, or re-pin `atopile-easyeda2kicad` to a
  version carrying upstream easyeda2kicad's fix. The public repo has had no
  commits since March 2026, so a PR may sit.
- Version pin decision stands: March source (`0.14.1004+76`) for a login-free
  toolchain, 0.15.8 wheel if an atopile account is acceptable. Both read
  `services.components.url`; 0.15.8 also demands a stored token before any
  request, so parts-server alone does not unblock it.
- `FBRK_LOG_DIR` must be isolated when 0.14 and 0.15 share a machine; their
  SQLite log schemas differ (`build_history has no column display_name`).
- The March-source `.venv` is built with `CC=/usr/bin/gcc CXX=/usr/bin/g++ uv sync`
  because linuxbrew's CMake does not find a C++ compiler on its own. Document
  in a setup script if more machines need it.

## Open: phase0 sample

- The LED stays pinned (`lcsc_id`) until LEDs are parametric.
- The two datasheet errors per build are noise (see parts-server item);
  `exclude_targets` cannot remove `datasheets` because the default target
  group always includes it.
