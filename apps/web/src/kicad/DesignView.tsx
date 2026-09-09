import type { AtopileReport } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import {
  BOM_COLUMNS,
  VARIABLE_COLUMNS,
  bomRow,
  bomTotal,
  buildHeadline,
  formatBuildTime,
  formatMargin,
  withTolerance,
} from "./designReport";

export type DesignViewProps = {
  readonly build: string;
  readonly revision: string;
  readonly read: (signal: AbortSignal) => Promise<AtopileReport>;
};

const cell = "border-b border-border/60 px-3 py-1.5 align-top";

/**
 * The atopile "Design" tab: last build outcome with its diagnostics, the
 * picked bill of materials, and every solved parameter against its spec.
 */
export function DesignView({ build, revision, read }: DesignViewProps) {
  const [report, setReport] = useState<AtopileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);
  const requestKey = `${build} ${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void readRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setReport(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Unable to load the design report.");
      });
    return () => controller.abort();
  }, [requestKey]);

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-full items-center justify-center p-6 text-center text-xs text-destructive"
      >
        {error}
      </div>
    );
  }
  if (!report) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground"
      >
        Loading design report...
      </div>
    );
  }
  const last = report.lastBuild;
  const total = report.bom ? bomTotal(report.bom) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground">
      <section className="border-b border-border px-3 py-3 text-xs">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-medium">Build {report.build}</span>
          <span className={last && !last.result.ok ? "text-destructive" : "text-muted-foreground"}>
            {buildHeadline(report)}
          </span>
          {last && (
            <span className="text-muted-foreground">{formatBuildTime(last.finishedAt)}</span>
          )}
        </div>
        {report.warnings.map((warning) => (
          <div key={warning} className="mt-1 text-warning">
            {warning}
          </div>
        ))}
        {last && (last.result.errors.length > 0 || last.result.warnings.length > 0) && (
          <ul className="mt-2 flex flex-col gap-1">
            {last.result.errors.map((diagnostic) => (
              <li
                key={`e:${diagnostic.message}:${diagnostic.file ?? ""}:${diagnostic.line ?? ""}`}
                className="text-destructive"
              >
                <span className="font-medium">error</span> {diagnostic.message}
                {diagnostic.file && (
                  <span className="text-muted-foreground">
                    {` (${diagnostic.file.split("/").pop()}${diagnostic.line === undefined ? "" : `:${diagnostic.line}`})`}
                  </span>
                )}
              </li>
            ))}
            {last.result.warnings.map((diagnostic) => (
              <li key={`w:${diagnostic.message}`} className="text-warning">
                <span className="font-medium">warning</span> {diagnostic.message}
              </li>
            ))}
          </ul>
        )}
        {last && last.result.targets.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {last.result.targets.flatMap((target) =>
              target.stages.map((stage) => (
                <span key={`${target.name ?? ""}:${stage.name}`}>
                  <span className={stage.ok ? "text-foreground" : "text-destructive"}>
                    {stage.ok ? "ok" : "failed"}
                  </span>
                  {` ${stage.name} ${stage.seconds.toFixed(2)}s`}
                </span>
              )),
            )}
          </div>
        )}
      </section>

      <section className="border-b border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
          <span className="font-medium">Bill of materials</span>
          {report.bom ? (
            <span className="text-muted-foreground">
              {report.bom.length} part{report.bom.length === 1 ? "" : "s"}
              {total === undefined ? "" : ` / about $${total.toFixed(3)} in components per board`}
            </span>
          ) : (
            <span className="text-muted-foreground">
              No BOM yet. Build the project to pick parts.
            </span>
          )}
        </div>
        {report.bom && report.bom.length > 0 && (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-left text-xs"
              aria-label="atopile bill of materials"
            >
              <thead className="bg-background">
                <tr>
                  {BOM_COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="border-b border-border px-3 py-2 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.bom.map((line) => (
                  <tr
                    key={`${line.lcsc}:${line.designators.join(",")}`}
                    className="odd:bg-muted/20"
                  >
                    {bomRow(line).map((value, index) => (
                      <td
                        key={BOM_COLUMNS[index]}
                        className={`${cell} max-w-[24rem] whitespace-pre-wrap`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
          <span className="font-medium">Variables</span>
          {report.variables ? (
            <span className="text-muted-foreground">
              {report.variables.length} solved parameter
              {report.variables.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-muted-foreground">No variables report yet.</span>
          )}
        </div>
        {report.variables && report.variables.length > 0 && (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-left text-xs"
              aria-label="atopile solved variables"
            >
              <thead className="bg-background">
                <tr>
                  {VARIABLE_COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="border-b border-border px-3 py-2 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.variables.map((row) => {
                  const margin = formatMargin(row.margin);
                  return (
                    <tr key={`${row.path}.${row.name}`} className="odd:bg-muted/20">
                      <td className={`${cell} font-mono`}>
                        {row.path}
                        <span className="text-muted-foreground"> {row.typeName}</span>
                      </td>
                      <td className={`${cell} font-mono`}>{row.name}</td>
                      <td className={`${cell} font-mono`}>
                        {withTolerance(row.spec, row.specTolerance)}
                      </td>
                      <td className={`${cell} font-mono`}>
                        {withTolerance(row.actual, row.actualTolerance)}
                      </td>
                      <td className={`${cell} font-mono tabular-nums ${margin.className}`}>
                        {margin.text}
                      </td>
                      <td className={cell}>{row.unit ?? ""}</td>
                      <td className={cell}>{row.source ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
