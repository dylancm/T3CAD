/**
 * Turns `ato build` terminal output into structured diagnostics.
 *
 * atopile prints a Rich "Build Summary" box per build target: a header line
 * with the target and a hash, a `Stages:` list with ✓/✗ and timings, then
 * `Errors (n):` and `Warnings (n):` lists of `•` items. Long items wrap onto
 * indented continuation lines inside the box. Source locations are not in the
 * box; they appear earlier in detail blocks as `File "<path>", line <n>` (March
 * 2026 source) or `Source: <path>:<n>` (0.15.x). We join the two by message.
 */

const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;
const STAGE_RE = /^(✓|✗)\s+(.+?)\s+\[(\d+(?:\.\d+)?)s\]$/;
const HEADER_RE = /^(✓|✗)\s+(.+?)\s+\[[0-9a-f]+\]$/;
const SECTION_RE = /^(Stages|Errors|Warnings)(?:\s*\(\d+\))?:$/;
const TOTAL_RE = /^Total:\s+(\d+(?:\.\d+)?)s$/;
const FILE_LINE_RE = /File "(.+?)", line (\d+)/;
// `Source: <path>:<line>` or, for syntax errors, `<path>:<line>:<column>`.
const SOURCE_RE = /^Source:\s+(.+?):(\d+)(?::\d+)?$/;
const VALIDATE_OK_RE = /^(.+\.ato): ok$/;

export interface AtoStage {
  readonly name: string;
  readonly ok: boolean;
  readonly seconds: number;
}

export interface AtoDiagnostic {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

export interface AtoBuildTarget {
  readonly name: string | undefined;
  readonly ok: boolean;
  readonly stages: readonly AtoStage[];
  readonly errors: readonly AtoDiagnostic[];
  readonly warnings: readonly AtoDiagnostic[];
  readonly totalSeconds: number | undefined;
}

export interface AtoBuildOutput {
  readonly ok: boolean;
  readonly targets: readonly AtoBuildTarget[];
  readonly errors: readonly AtoDiagnostic[];
  readonly warnings: readonly AtoDiagnostic[];
}

export interface AtoValidateFile {
  readonly path: string;
  readonly ok: boolean;
}

export interface AtoValidateOutput {
  readonly ok: boolean;
  readonly files: readonly AtoValidateFile[];
  readonly diagnostics: readonly AtoDiagnostic[];
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Inner text of box lines (`│ ... │`) between a `╭─ Build Summary` and `╰`. */
function extractSummaryBoxes(lines: readonly string[]): string[][] {
  const boxes: string[][] = [];
  let current: string[] | undefined;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (current === undefined) {
      if (line.startsWith("╭") && line.includes("Build Summary")) current = [];
      continue;
    }
    if (line.startsWith("╰")) {
      boxes.push(current);
      current = undefined;
      continue;
    }
    if (!line.startsWith("│")) continue;
    let inner = line.slice(1);
    if (inner.endsWith("│")) inner = inner.slice(0, -1);
    current.push(inner.trimEnd());
  }
  if (current !== undefined) boxes.push(current);
  return boxes;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseBox(inner: readonly string[]): AtoBuildTarget {
  let name: string | undefined;
  let ok = false;
  let totalSeconds: number | undefined;
  const stages: AtoStage[] = [];
  const errors: { message: string }[] = [];
  const warnings: { message: string }[] = [];
  let section: "stages" | "errors" | "warnings" | undefined;
  let items: { message: string }[] | undefined;
  let itemIndent = -1;
  // Bullet-less items (0.15.x) are separated by blank lines; a following
  // non-blank line at the same indent is the item's continuation.
  let afterBlank = true;

  for (const rawLine of inner) {
    const line = rawLine.trim();
    if (line.length === 0) {
      afterBlank = true;
      continue;
    }
    const header = HEADER_RE.exec(line);
    if (header && name === undefined) {
      ok = header[1] === "✓";
      name = header[2];
      continue;
    }
    const total = TOTAL_RE.exec(line);
    if (total) {
      totalSeconds = Number(total[1]);
      section = undefined;
      continue;
    }
    const sec = SECTION_RE.exec(line);
    if (sec) {
      section = sec[1]!.toLowerCase() as typeof section;
      items = section === "errors" ? errors : section === "warnings" ? warnings : undefined;
      itemIndent = -1;
      continue;
    }
    if (section === "stages") {
      const stage = STAGE_RE.exec(line);
      if (stage) stages.push({ name: stage[2]!, ok: stage[1] === "✓", seconds: Number(stage[3]) });
      continue;
    }
    if (items) {
      const indent = indentOf(rawLine);
      if (line.startsWith("•")) {
        items.push({ message: line.slice(1).trim() });
        itemIndent = indent;
      } else if (items.length > 0 && (indent > itemIndent || !afterBlank)) {
        const last = items[items.length - 1]!;
        last.message = `${last.message} ${line}`.trim();
      } else {
        // A titled item without a bullet, e.g. "Deprecated Exception" then its text.
        items.push({ message: line });
        itemIndent = indent;
      }
    }
    afterBlank = false;
  }
  return { name, ok, stages, errors, warnings, totalSeconds };
}

function unbox(line: string): string {
  return line
    .replace(/^\s*│\s?/, "")
    .replace(/\s*│\s*$/, "")
    .trim();
}

interface LocatedDiagnostic {
  readonly message: string;
  readonly file: string;
  readonly line: number;
}

/**
 * Every located error in the detail blocks, in output order. A block is the
 * exception's message followed by `Code causing the error:` and a
 * `File "<path>", line <n>` or `Source: <path>:<n>` line; the message is the
 * nearest preceding line that is not scaffolding.
 */
function collectDetailDiagnostics(raw: readonly string[]): LocatedDiagnostic[] {
  const out: LocatedDiagnostic[] = [];
  // Detail blocks may themselves be drawn inside a Rich box (0.15.x), so look
  // at the text with any box border removed.
  const lines = raw.map(unbox);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fileLine = FILE_LINE_RE.exec(line);
    const source = SOURCE_RE.exec(line);
    const match = fileLine ?? source;
    if (!match) continue;
    // Walk back to the nearest non-empty line that is not scaffolding.
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const candidate = lines[j]!;
      if (
        candidate.length === 0 ||
        candidate.startsWith("Code causing the error") ||
        /^\d{2}:\d{2}:\d{2}/.test(candidate) ||
        candidate === "Exception"
      ) {
        continue;
      }
      out.push({ message: candidate, file: match[1]!, line: Number(match[2]) });
      break;
    }
  }
  return out;
}

/**
 * Map from error message → source location, harvested from the detail blocks
 * that precede the summary box. The first location for a message wins.
 */
function collectLocations(raw: readonly string[]): Map<string, { file: string; line: number }> {
  const out = new Map<string, { file: string; line: number }>();
  for (const { message, file, line } of collectDetailDiagnostics(raw)) {
    if (!out.has(message)) out.set(message, { file, line });
  }
  return out;
}

function withLocation(
  item: { message: string },
  locations: Map<string, { file: string; line: number }>,
): AtoDiagnostic {
  const direct = locations.get(item.message);
  if (direct) return { message: item.message, file: direct.file, line: direct.line };
  for (const [message, loc] of locations) {
    if (item.message.startsWith(message) || message.startsWith(item.message)) {
      return { message: item.message, file: loc.file, line: loc.line };
    }
  }
  return { message: item.message };
}

/**
 * Parse combined stdout+stderr of `ato build`.
 *
 * When no summary box is present (the CLI crashed before building) the last
 * `SomethingError: ...` line becomes the single error so the caller still gets
 * a message instead of an empty result.
 */
export function parseAtoBuildOutput(output: string, exitCode: number): AtoBuildOutput {
  const lines = stripAnsi(output).split(/\r?\n/);
  const locations = collectLocations(lines);
  const targets = extractSummaryBoxes(lines).map((box) => {
    const parsed = parseBox(box);
    return {
      ...parsed,
      errors: parsed.errors.map((e) => withLocation(e, locations)),
      warnings: parsed.warnings.map((w) => withLocation(w, locations)),
    };
  });
  const errors = targets.flatMap((t) => t.errors);
  const warnings = targets.flatMap((t) => t.warnings);
  if (targets.length === 0 && exitCode !== 0) {
    return {
      ok: false,
      targets,
      errors: [{ message: lastExceptionLine(lines) ?? `ato exited with code ${exitCode}` }],
      warnings,
    };
  }
  return { ok: exitCode === 0 && targets.every((t) => t.ok), targets, errors, warnings };
}

function normalizeAtoPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

/** `ato validate` echoes the path as given, resolved relative to its cwd; accept either spelling. */
function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** Last `SomethingError: ...` line, for a CLI that failed without a located diagnostic. */
function lastExceptionLine(lines: readonly string[]): string | undefined {
  return lines
    .toReversed()
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z_]+(Error|Exception)\b.*:/.test(l));
}

/**
 * Parse combined stdout+stderr of `ato validate <files>`.
 *
 * The CLI prints `<path>: ok` for each file that compiled and logs compile
 * errors with the same detail blocks `ato build` uses. It exits 1 when any
 * file failed and keeps going past the failure, so a run can carry several
 * files' diagnostics. Every located diagnostic is an error; `ok` is a clean
 * exit with none of them.
 */
export function parseAtoValidateOutput(
  output: string,
  exitCode: number,
  requestedFiles: readonly string[],
): AtoValidateOutput {
  const lines = stripAnsi(output).split(/\r?\n/);
  const passed = new Set<string>();
  for (const raw of lines) {
    const ok = VALIDATE_OK_RE.exec(raw.trim());
    if (ok) passed.add(normalizeAtoPath(ok[1]!));
  }
  const files = requestedFiles.map((path) => {
    const normalized = normalizeAtoPath(path);
    return { path, ok: [...passed].some((p) => samePath(p, normalized)) };
  });

  const seen = new Set<string>();
  const diagnostics: AtoDiagnostic[] = [];
  for (const diagnostic of collectDetailDiagnostics(lines)) {
    const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic);
  }
  if (exitCode !== 0 && diagnostics.length === 0) {
    diagnostics.push({
      message: lastExceptionLine(lines) ?? `ato validate exited with code ${exitCode}`,
    });
  }
  return { ok: exitCode === 0 && diagnostics.length === 0, files, diagnostics };
}
