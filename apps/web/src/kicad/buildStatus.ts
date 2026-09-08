import type { AtopileBuildResult } from "@t3tools/contracts";

export type BuildState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly build: string | undefined }
  | {
      readonly status: "done";
      readonly build: string | undefined;
      readonly result: AtopileBuildResult;
    }
  | { readonly status: "error"; readonly build: string | undefined; readonly message: string };

const label = (build: string | undefined) => (build ? `Build ${build}` : "Build");

function where(diagnostic: { readonly file?: string; readonly line?: number }): string {
  if (!diagnostic.file) return "";
  const name = diagnostic.file.split("/").pop() ?? diagnostic.file;
  return diagnostic.line === undefined ? ` (${name})` : ` (${name}:${diagnostic.line})`;
}

/** One line describing a build's state, for the viewer's status strip. */
export function summarizeBuild(state: BuildState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "running":
      return `${label(state.build)} running…`;
    case "error":
      return `${label(state.build)} request failed: ${state.message}`;
    case "done": {
      const { result } = state;
      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.ok) {
        const warnings =
          result.warnings.length === 0
            ? ""
            : ` · ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`;
        return `${label(state.build)} succeeded in ${seconds} s${warnings}`;
      }
      const [first, ...rest] = result.errors;
      const detail = first ? `: ${first.message}${where(first)}` : ` (exit ${result.exitCode})`;
      const more =
        rest.length > 0 ? ` · ${rest.length} more error${rest.length === 1 ? "" : "s"}` : "";
      return `${label(state.build)} failed${detail}${more}`;
    }
  }
}
