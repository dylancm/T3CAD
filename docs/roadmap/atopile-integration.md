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
- **Phase 2** — the KiCad manifest recognises `ato.yaml` (`manifest.atopile`
  with per-build board, GLB, BOM, gerber directory), defaults the viewer to the
  first built board, unpacks `<build>.gerber.zip` beside itself for the Gerber
  tab, serves a fresh atopile GLB instead of running `kicad-cli`, and adds a
  Build button plus result strip to the viewer header (web and mobile via the
  shared page) backed by `POST /api/kicad/build`. The MCP handlers and the
  route share `apps/server/src/atopile/atoBuild.ts`.
- **Phase 3** — re-scoped to the CLI: no sidecar. A "Design" tab in the viewer
  (Tools menu, atopile projects only) shows the last build this server ran
  (stages, errors with `file:line`, warnings), the picked BOM with unit cost,
  stock, and library class from `<build>.bom.json`, and every solved parameter
  against its spec from `<build>.variables.json`, out-of-spec rows highlighted.
  Served by `GET /api/kicad/ato-report?build=`. Builds from `ato_build` and the
  Build button both register in an in-memory last-build record that the manifest
  summarises, so the tab refreshes after agent builds too.

## Open: T3CAD

### Phase 2 follow-ups

- Builds from the viewer run synchronously and return when `ato build` exits;
  long builds show only "Building…". Streaming through the terminal manager was
  deferred; the MCP `ato_build` result already carries the structured output.
- A viewer-session token (minted with read scope) can start a build. Accepted
  because the token is bound to one directory and a build only regenerates that
  project's outputs; revisit if viewer links are ever shared more widely.
- Config surface decided: no new file. `.k3eda.json` keeps viewer assignments
  and atopile defaults are derived from `ato.yaml`; an explicit assignment wins.
- The 50,000-entry scan cap and 300 ms manifest cache were reviewed against the
  sample project (hundreds of files); no change needed, but a project with
  years of `build/` output could approach the cap.
- An upstream discovery test ("changes revision when an inspected file
  changes…") failed once in a combined run and passed on every rerun; it relies
  on mtime ordering within the same second. Not caused by this work, worth
  hardening if it recurs.
- The Build button was verified through unit and in-memory tests plus a manifest
  smoke run on the sample project; KiCad is not installed on the dev machine, so
  the GLB and gerber paths were exercised only with fixtures.

### Phase 3 follow-ups

- The last-build record is in memory only; a server restart loses it until the
  next build. Persisting it would mean writing into the user's project or the
  T3 data directory; neither felt justified yet.
- `meetsSpec` is `null` for every row in the March source's variables report,
  so the out-of-spec highlight is wired but untested against real data.
- The Design tab reads whole reports on every manifest revision change; fine for
  boards with hundreds of parts, worth paging past a few thousand.
- Problems still come only from build output. atopile has no separate `ato
check`; the March `ato validate` crashes. If a working validate appears,
  surface it here as pre-build diagnostics.

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

- Raw `HttpRouter` handlers resolve services from the served router's runtime,
  not from `Layer.provide` on the routes layer (that only satisfies the types).
  The build route shipped with exactly that bug and answered 500 until the
  toolchain moved into `ReactorLayerLive`. A route-level test that serves
  `kicadBuildRouteLayer` through `HttpRouter.serve` with a stub toolchain would
  catch a regression; none exists yet.
- Server restarts drop viewer-session tokens (in-memory), so an open KiCad
  panel shows "Viewer access expired" until reopened. Persisting sessions or
  auto re-minting from the host panel on 401 would smooth dev iterations.

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
