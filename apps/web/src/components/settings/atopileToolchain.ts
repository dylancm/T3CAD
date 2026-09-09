import type {
  AtopileInstallPhase,
  AtopileInstallState,
  AtopileToolchainSource,
  AtopileToolchainStatus,
} from "@t3tools/contracts";

/** Human labels for where the server found `ato`, in resolution order. */
export const ATOPILE_TOOLCHAIN_SOURCE_LABELS: Readonly<Record<AtopileToolchainSource, string>> = {
  setting: "ato command setting",
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

export const ATOPILE_INSTALL_PHASE_LABELS: Readonly<Record<AtopileInstallPhase, string>> = {
  idle: "Not started",
  "locating-uv": "Looking for uv",
  "downloading-uv": "Downloading uv",
  installing: "Preparing atopile",
  verifying: "Verifying",
  succeeded: "Installed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function isAtopileInstallRunning(phase: AtopileInstallPhase): boolean {
  return (
    phase === "locating-uv" ||
    phase === "downloading-uv" ||
    phase === "installing" ||
    phase === "verifying"
  );
}

/** Decimal megabytes to one place, matching the provider install rows. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * One line for the install row: the phase, byte progress while uv downloads,
 * and the server's message otherwise. `null` before the first install.
 */
export function formatAtopileInstallProgress(
  state: Pick<AtopileInstallState, "phase" | "message" | "downloadedBytes" | "totalBytes">,
): string | null {
  if (state.phase === "idle") return null;
  const label = ATOPILE_INSTALL_PHASE_LABELS[state.phase];
  if (state.phase === "downloading-uv") {
    const downloaded = formatMegabytes(state.downloadedBytes ?? 0);
    return state.totalBytes === undefined
      ? `${label}: ${downloaded}`
      : `${label}: ${downloaded} of ${formatMegabytes(state.totalBytes)}`;
  }
  return state.message === undefined ? label : `${label}: ${state.message}`;
}
