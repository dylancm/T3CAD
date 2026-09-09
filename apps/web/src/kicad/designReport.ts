import type { AtopileBomLine, AtopileReport, AtopileVariableRow } from "@t3tools/contracts";

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

/** Column order for the Design tab's variables table. */
export const VARIABLE_COLUMNS = [
  "Module",
  "Parameter",
  "Spec",
  "Actual",
  "Margin",
  "Unit",
  "Source",
] as const;

/** `1kΩ` plus its `±1.0%` as one cell, the way the report's markdown shows it. */
export function withTolerance(value: string | null, tolerance: string | undefined): string {
  if (value === null) return "";
  return tolerance ? `${value} ${tolerance}` : value;
}

/**
 * The Margin cell for a server-computed margin ratio: `+90%` reads as "90 % of
 * the allowance left". Under 10 % is amber, negative (outside spec, which a
 * successful build should never produce) is red, unknown is a muted dash.
 */
export function formatMargin(margin: AtopileVariableRow["margin"]): {
  text: string;
  className: string;
} {
  if (margin === null) return { text: "–", className: "text-muted-foreground" };
  const percent = margin * 100;
  const text =
    percent > 999 ? ">+999%" : `${percent < 0 ? "-" : "+"}${Math.round(Math.abs(percent))}%`;
  if (margin < 0) return { text, className: "text-destructive" };
  if (margin < 0.1) return { text, className: "text-warning" };
  return { text, className: "" };
}
