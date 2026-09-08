import type { AtopileBomLine, AtopileReport } from "@t3tools/contracts";

/** Column order for the Design tab's BOM table. */
export const BOM_COLUMNS = [
  "Designators",
  "Qty",
  "Value",
  "MPN",
  "Manufacturer",
  "LCSC",
  "Unit cost",
  "Stock",
  "Library",
  "Source",
] as const;

export function bomRow(line: AtopileBomLine): string[] {
  return [
    line.designators.join(", "),
    String(line.quantity),
    line.value,
    line.mpn,
    line.manufacturer,
    line.lcsc,
    line.unitCost === undefined ? "" : `$${line.unitCost.toFixed(4)}`,
    line.stock === undefined ? "" : line.stock.toLocaleString(),
    line.isBasic ? "basic" : "extended",
    line.source,
  ];
}

/** Estimated component cost for one board, ignoring extended-part setup fees. */
export function bomTotal(lines: readonly AtopileBomLine[]): number | undefined {
  if (lines.length === 0) return undefined;
  let total = 0;
  for (const line of lines) {
    if (line.unitCost === undefined) return undefined;
    total += line.unitCost * line.quantity;
  }
  return total;
}

export function formatBuildTime(finishedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - finishedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(finishedAt).toLocaleTimeString();
}

/** Short headline for the build card. */
export function buildHeadline(report: AtopileReport): string {
  const last = report.lastBuild;
  if (!last)
    return "No build recorded by this server yet. Use Build or ask the agent to run ato_build.";
  const { result } = last;
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return result.ok
    ? `Last build succeeded in ${(result.durationMs / 1000).toFixed(1)} s with ${n(result.warnings.length, "warning")}.`
    : `Last build failed with ${n(result.errors.length, "error")} and ${n(result.warnings.length, "warning")}.`;
}
