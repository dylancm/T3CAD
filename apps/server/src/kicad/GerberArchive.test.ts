// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { extractArchiveIfStale } from "./GerberArchive.ts";
import { storedZip } from "./testSupport.ts";

it("extracts gerber members flat, skips unsafe names, and reuses an up-to-date extraction", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3cad-gerber-zip-"));
  try {
    const archive = NodePath.join(root, "default.gerber.zip");
    await NodeFSP.writeFile(
      archive,
      storedZip([
        ["default-F_Cu.gbr", "G04 front copper*"],
        ["nested/default-B_Cu.gbr", "G04 back copper*"],
        [".hidden", "x"],
        ["dir/", ""],
      ]),
    );
    const dest = NodePath.join(root, "gerbers");
    const first = await extractArchiveIfStale(archive, dest);
    expect(first.extracted).toBe(true);
    expect(first.files).toEqual(["default-B_Cu.gbr", "default-F_Cu.gbr"]);
    expect(await NodeFSP.readFile(NodePath.join(dest, "default-B_Cu.gbr"), "utf8")).toBe(
      "G04 back copper*",
    );

    const second = await extractArchiveIfStale(archive, dest);
    expect(second.extracted).toBe(false);
    expect(second.files).toEqual(first.files);

    // A changed archive is unpacked again and stale members disappear.
    await NodeFSP.writeFile(archive, storedZip([["default-F_Mask.gbr", "G04 mask*"]]));
    const future = new Date(Date.now() + 5_000);
    await NodeFSP.utimes(archive, future, future);
    const third = await extractArchiveIfStale(archive, dest);
    expect(third.extracted).toBe(true);
    expect(third.files).toEqual(["default-F_Mask.gbr"]);

    // yauzl refuses traversal names outright; the caller reports the archive as unusable.
    const hostile = NodePath.join(root, "hostile.zip");
    await NodeFSP.writeFile(hostile, storedZip([["../escape.gbr", "G04 nope*"]]));
    await expect(extractArchiveIfStale(hostile, NodePath.join(root, "hostile"))).rejects.toThrow(
      /invalid relative path/,
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
