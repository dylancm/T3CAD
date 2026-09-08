import type { AtopileToolchainSource, AtopileToolchainStatus } from "@t3tools/contracts";

/** Human labels for where the server found `ato`, in resolution order. */
export const ATOPILE_TOOLCHAIN_SOURCE_LABELS: Readonly<Record<AtopileToolchainSource, string>> = {
  env: "T3CAD_ATO_COMMAND environment variable",
  path: "ato on PATH",
  uv: "uv tool run, pinned release",
};

export type AtopileToolchainStatusLabel = "Available" | "Not found" | "Not working";

/**
 * Three states, not two: a resolved command whose `self-check` failed is
 * "Not working", so the row does not claim `ato` is missing when it is present
 * but broken.
 */
export function formatAtopileToolchainStatusLabel(
  status: Pick<AtopileToolchainStatus, "available" | "command">,
): AtopileToolchainStatusLabel {
  if (status.available) return "Available";
  return status.command.length === 0 ? "Not found" : "Not working";
}

export function formatAtopileToolchainSource(
  source: AtopileToolchainSource | undefined,
): string | null {
  return source === undefined ? null : ATOPILE_TOOLCHAIN_SOURCE_LABELS[source];
}

/** argv prefix as one shell-like line; `null` when nothing resolved. */
export function formatAtopileCommand(command: ReadonlyArray<string>): string | null {
  return command.length === 0 ? null : command.join(" ");
}
