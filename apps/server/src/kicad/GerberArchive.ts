/* eslint-disable t3code/namespace-node-imports */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { pipeline } from "node:stream/promises";
import * as Yauzl from "yauzl";

/**
 * Unpacks a fabrication archive such as atopile's `<build>.gerber.zip` next to
 * itself so the Gerber tab, which reads loose layer files, can show it.
 *
 * Extraction is skipped when the marker written last time still matches the
 * archive's size and mtime, so repeated manifest scans are cheap. Entries are
 * flattened to their base name and anything that is not a plain file with a
 * safe name is ignored.
 */

const MARKER_FILENAME = ".t3cad-extracted";
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 512;

function safeEntryName(entry: Yauzl.Entry): string | undefined {
  if (entry.fileName.endsWith("/")) return undefined;
  const base = NodePath.posix.basename(entry.fileName.replaceAll("\\", "/"));
  if (base.length === 0 || base === "." || base === ".." || base.startsWith(".")) return undefined;
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) return undefined;
  return base;
}

function openZip(archivePath: string): Promise<Yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    Yauzl.open(
      archivePath,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: false },
      (error, zip) =>
        error || !zip ? reject(error ?? new Error("zip open failed")) : resolve(zip),
    );
  });
}

function nextEntry(zip: Yauzl.ZipFile): Promise<Yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.removeListener("entry", onEntry);
      zip.removeListener("end", onEnd);
      zip.removeListener("error", onError);
    };
    const onEntry = (entry: Yauzl.Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (cause: unknown) => {
      cleanup();
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

function openEntryStream(zip: Yauzl.ZipFile, entry: Yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (cause, readable) =>
      cause || !readable ? reject(cause ?? new Error("zip entry unreadable")) : resolve(readable),
    );
  });
}

export interface ExtractedArchive {
  /** Directory the members were written to. */
  readonly directory: string;
  /** Base names of the members present after extraction. */
  readonly files: readonly string[];
  /** True when the archive was unpacked on this call rather than found up to date. */
  readonly extracted: boolean;
}

/**
 * Extract `archivePath` into `destinationDir` unless the marker says it is
 * current. Throws on unreadable archives; callers turn that into a warning.
 */
export async function extractArchiveIfStale(
  archivePath: string,
  destinationDir: string,
): Promise<ExtractedArchive> {
  const info = await NodeFSP.stat(archivePath);
  const fingerprint = `${info.size}\0${info.mtimeMs}`;
  const markerPath = NodePath.join(destinationDir, MARKER_FILENAME);
  try {
    if ((await NodeFSP.readFile(markerPath, "utf8")) === fingerprint) {
      const names = (await NodeFSP.readdir(destinationDir)).filter((n) => n !== MARKER_FILENAME);
      return { directory: destinationDir, files: names.sort(), extracted: false };
    }
  } catch {
    /* no marker yet */
  }

  await NodeFSP.rm(destinationDir, { recursive: true, force: true });
  await NodeFSP.mkdir(destinationDir, { recursive: true });
  const zip = await openZip(archivePath);
  const written: string[] = [];
  try {
    for (let count = 0; count < MAX_ENTRIES; count++) {
      const entry = await nextEntry(zip);
      if (entry === null) break;
      const name = safeEntryName(entry);
      if (name === undefined || written.includes(name)) continue;
      const readable = await openEntryStream(zip, entry);
      await pipeline(readable, NodeFS.createWriteStream(NodePath.join(destinationDir, name)));
      written.push(name);
    }
  } finally {
    zip.close();
  }
  await NodeFSP.writeFile(markerPath, fingerprint, "utf8");
  return { directory: destinationDir, files: written.sort(), extracted: true };
}
