import {
  AtopileBuildInput,
  AtopileBuildResult,
  AtopileError,
  AtopileProjectInfo,
  AtopileProjectInput,
  AtopileToolchainStatus,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as AtopileToolchain from "../../../atopile/AtopileToolchain.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  AtopileToolchain.AtopileToolchain,
  FileSystem.FileSystem,
];

export const AtoStatusTool = Tool.make("ato_status", {
  description:
    "Report whether the atopile `ato` compiler is available on this environment, which command runs it, and its version. Call this before ato_build when unsure the toolchain is installed.",
  success: AtopileToolchainStatus,
  failure: AtopileError,
  dependencies,
})
  .annotate(Tool.Title, "Check atopile toolchain")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const AtoProjectTool = Tool.make("ato_project", {
  description:
    "Describe an atopile project from its ato.yaml: build names and entry modules, where each build writes its KiCad board (.kicad_pcb), source/layout/build directories, dependencies, and the parts service URL. Use it to learn which build name to pass to ato_build and which files the KiCad viewer should show.",
  parameters: AtopileProjectInput,
  success: AtopileProjectInfo,
  failure: AtopileError,
  dependencies,
})
  .annotate(Tool.Title, "Inspect atopile project")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const AtoBuildTool = Tool.make("ato_build", {
  description:
    "Compile an atopile project with `ato build`: resolves the design, picks parts, updates the KiCad board and BOM. Returns per-stage results, structured errors and warnings with file:line where known, and the artifacts that now exist. Run it after every .ato change and fix reported errors before reporting back. Part picking may contact a parts service, so this can take up to a few minutes.",
  parameters: AtopileBuildInput,
  success: AtopileBuildResult,
  failure: AtopileError,
  dependencies,
})
  .annotate(Tool.Title, "Build atopile project")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const AtopileToolkit = Toolkit.make(AtoStatusTool, AtoProjectTool, AtoBuildTool);
