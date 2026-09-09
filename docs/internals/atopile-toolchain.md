# atopile as an external toolchain

T3CAD never vendors, pins in `package.json`, or installs the atopile compiler. The
[toolchain service](../../apps/server/src/atopile/AtopileToolchain.ts) resolves an `ato` command at
request time (the `atopile.command` server setting, then `T3CAD_ATO_COMMAND`, then PATH, then
`uv tool run` of a pinned release) and every caller treats "not found" as ordinary data, not a
startup failure. Settings are re-read on every resolution so an edit applies to the next build. atopile is a Python package with
a compiled core, moves on its own release cadence, and its public source went stale in 2026 while
the PyPI releases kept changing behaviour (the 0.15 line gates part lookups behind an account).
Bundling any one version would tie T3CAD releases to atopile's, break users who need a different
version for their `requires-atopile`, and drag a Python runtime into the desktop build. Keeping the
boundary at a command line also lets one T3CAD serve a source checkout, a `uv` tool, and a Docker
image the same way. Everything atopile-specific therefore stays in a few new directories
(`apps/server/src/atopile/`, the `ato_*` MCP toolkit, `apps/web/src/kicad/`) so rebases onto
upstream T3 Code do not collide.

Agent skills follow the same rule: T3CAD ships them as a checked-in bundle installed into the app
cache and advertised in the runtime preamble, like the KiStack skills, rather than writing into a
user's project or a provider's home directory. See
[AtopileSkills.ts](../../apps/server/src/provider/AtopileSkills.ts).
