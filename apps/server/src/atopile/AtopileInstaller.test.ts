// @effect-diagnostics nodeBuiltinImport:off - the fixture archive is gzipped with node:zlib.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it } from "@effect/vitest";
import type { AtopileInstallState } from "@t3tools/contracts";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as NodeZlib from "node:zlib";
import { vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as AtopileInstaller from "./AtopileInstaller.ts";

const UV_CONTENTS = "#!/bin/sh\necho fake uv\n";
const DOWNLOAD_URL =
  "https://github.com/astral-sh/uv/releases/download/0.9.9/uv-x86_64-unknown-linux-gnu.tar.gz";

/** One ustar entry; enough of the format for the extractor to walk. */
function tarEntry(name: string, contents: string, type = "0"): Buffer {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000755\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

/** Layout matches uv's release tarballs: one directory holding `uv` and `uvx`. */
const archive = NodeZlib.gzipSync(
  Buffer.concat([
    tarEntry("uv-x86_64-unknown-linux-gnu/", "", "5"),
    // A PAX header whose basename is also `uv` must not be mistaken for the binary.
    tarEntry("PaxHeaders/uv", "30 mtime=1700000000.000000000\n", "x"),
    tarEntry("uv-x86_64-unknown-linux-gnu/uv", UV_CONTENTS),
    tarEntry("uv-x86_64-unknown-linux-gnu/uvx", "#!/bin/sh\necho uvx\n"),
    Buffer.alloc(1024),
  ]),
);

const runMock = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>();

const processOutput = (stdout: string, code = 0, stderr = "") =>
  Effect.succeed({
    stdout,
    stderr,
    code: ChildProcessSpawner.ExitCode(code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  });

const makeHarness = Effect.fn("test.makeAtopileInstaller")(function* (
  options: {
    readonly uvOnPath?: boolean;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bin = yield* fs.makeTempDirectoryScoped({ prefix: "t3cad-uv-path-" });
  if (options.uvOnPath) {
    yield* fs.writeFileString(path.join(bin, "uv"), UV_CONTENTS);
    yield* fs.chmod(path.join(bin, "uv"), 0o755);
  }
  const requests: string[] = [];
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url);
      if (request.url === AtopileInstaller.UV_LATEST_RELEASE_URL) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            tag_name: "0.9.9",
            assets: [
              { name: "uv-aarch64-apple-darwin.tar.gz", browser_download_url: "x", size: 1 },
              {
                name: "uv-x86_64-unknown-linux-gnu.tar.gz",
                browser_download_url: DOWNLOAD_URL,
                size: archive.byteLength,
              },
            ],
          }),
        );
      }
      const response = HttpClientResponse.fromWeb(request, new Response(null));
      // Three uneven chunks so the tar walk crosses header and data boundaries.
      return Object.defineProperty(response, "stream", {
        value: Stream.make(archive.subarray(0, 7), archive.subarray(7, 300), archive.subarray(300)),
      });
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({ run: (input) => runMock(input) }),
    ),
    Layer.succeed(HttpClient.HttpClient, httpClient),
    Layer.succeed(HostProcessEnvironment, { PATH: bin, HOME: "/home/test" }),
    Layer.succeed(HostProcessPlatform, "linux"),
    Layer.succeed(HostProcessArchitecture, "x64"),
    ServerSettingsModule.layerTest({}),
    ServerConfig.layerTest("/ws", { prefix: "t3cad-installer-state-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
    NodeServices.layer,
  );
  const context = yield* Layer.build(AtopileInstaller.layer.pipe(Layer.provideMerge(dependencies)));
  return {
    installer: Context.get(context, AtopileInstaller.AtopileInstaller),
    settings: Context.get(context, ServerSettingsModule.ServerSettingsService),
    config: Context.get(context, ServerConfig.ServerConfig),
    requests,
    bin,
    fs,
    path,
  };
});

const terminalState = (installer: AtopileInstaller.AtopileInstaller["Service"]) =>
  installer.changes.pipe(
    Stream.filter((state) => ["succeeded", "failed", "cancelled"].includes(state.phase)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

afterEach(() => {
  runMock.mockReset();
});

describe("uvReleaseAsset", () => {
  it("names the archive for supported hosts and refuses Windows", () => {
    expect(AtopileInstaller.uvReleaseAsset("linux", "x64")).toEqual({
      name: "uv-x86_64-unknown-linux-gnu.tar.gz",
    });
    expect(AtopileInstaller.uvReleaseAsset("darwin", "arm64")).toEqual({
      name: "uv-aarch64-apple-darwin.tar.gz",
    });
    expect(AtopileInstaller.uvReleaseAsset("win32", "x64")).toMatchObject({
      unsupported: expect.stringContaining("Windows"),
    });
    expect(AtopileInstaller.uvReleaseAsset("linux", "ppc64")).toMatchObject({
      unsupported: expect.stringContaining("linux-ppc64"),
    });
  });
});

describe("TarMemberExtractor", () => {
  it("emits exactly the named regular file however the bytes are chunked", () => {
    const tar = Buffer.concat([
      tarEntry("PaxHeaders/uv", "ignored", "x"),
      tarEntry("dir/other", "other"),
      tarEntry("dir/uv", UV_CONTENTS),
      tarEntry("dir/uv-after", "after"),
      Buffer.alloc(1024),
    ]);
    for (const chunkSize of [1, 100, 512, 513, tar.length]) {
      const extractor = new AtopileInstaller.TarMemberExtractor("uv");
      const pieces: Uint8Array[] = [];
      for (let offset = 0; offset < tar.length; offset += chunkSize) {
        pieces.push(...extractor.push(tar.subarray(offset, offset + chunkSize)));
      }
      expect(Buffer.concat(pieces).toString()).toBe(UV_CONTENTS);
      expect(extractor.complete).toBe(true);
    }
  });

  it("stays incomplete when the member is absent", () => {
    const extractor = new AtopileInstaller.TarMemberExtractor("uv");
    extractor.push(Buffer.concat([tarEntry("dir/uvx", "x"), Buffer.alloc(1024)]));
    expect(extractor.complete).toBe(false);
  });
});

it.layer(NodeServices.layer)("AtopileInstaller", (it) => {
  it.effect("uses uv from PATH, warms the pinned release, and records the command", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("10:23 W motd\n0.15.8\n"));
      const { installer, settings, requests, bin, path } = yield* makeHarness({ uvOnPath: true });
      const started = yield* installer.start({});
      expect(started).toMatchObject({ phase: "locating-uv", version: "0.15.8" });
      const final = yield* terminalState(installer);
      const uv = path.join(bin, "uv");
      expect(final).toEqual({
        phase: "succeeded",
        version: "0.15.8",
        message: "atopile 0.15.8 is ready.",
        installedVersion: "0.15.8",
        uvPath: uv,
      });
      expect(requests).toEqual([]);
      expect(runMock).toHaveBeenCalledTimes(1);
      const warm = runMock.mock.calls[0]![0];
      expect(warm.command).toBe(uv);
      expect(warm.args).toEqual([
        "tool",
        "run",
        "-p",
        "3.14",
        "--from",
        "atopile==0.15.8",
        "ato",
        "self-check",
      ]);
      expect(warm.cwd).toBe("/home/test");
      expect((yield* settings.getSettings).atopile.command).toBe(
        `${uv} tool run -p 3.14 --from atopile==0.15.8 ato`,
      );
    }),
  );

  it.effect("downloads uv into the state directory when PATH has none", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() => processOutput("0.15.9\n"));
      const { installer, settings, config, requests, fs, path } = yield* makeHarness();
      yield* installer.start({ version: "0.15.9" });
      const final = yield* terminalState(installer);
      const uv = path.join(config.stateDir, "tools", "uv", "uv");
      expect(final).toMatchObject({
        phase: "succeeded",
        version: "0.15.9",
        installedVersion: "0.15.9",
        uvPath: uv,
        downloadedBytes: archive.byteLength,
        totalBytes: archive.byteLength,
      });
      expect(requests).toEqual([AtopileInstaller.UV_LATEST_RELEASE_URL, DOWNLOAD_URL]);
      expect(yield* fs.readFileString(uv)).toBe(UV_CONTENTS);
      expect((yield* fs.stat(uv)).mode & 0o111).not.toBe(0);
      expect(yield* fs.readDirectory(path.dirname(uv))).toEqual(["uv"]);
      const warm = runMock.mock.calls[0]![0];
      expect(warm.command).toBe(uv);
      expect(warm.args).toContain("atopile==0.15.9");
      expect((yield* settings.getSettings).atopile.command).toBe(
        `${uv} tool run -p 3.14 --from atopile==0.15.9 ato`,
      );

      // A second install reuses the download instead of fetching again.
      yield* installer.start({});
      expect((yield* terminalState(installer)).phase).toBe("succeeded");
      expect(requests).toHaveLength(2);
    }),
  );

  it.effect("reports a failed warm-up with the stderr tail and leaves the setting alone", () =>
    Effect.gen(function* () {
      runMock.mockImplementation(() =>
        processOutput("", 1, "error: No solution found when resolving tool dependencies"),
      );
      const { installer, settings } = yield* makeHarness({ uvOnPath: true });
      yield* installer.start({ version: "9.9.9" });
      const final = yield* terminalState(installer);
      expect(final.phase).toBe("failed");
      expect(final.message).toContain("exited with 1: error: No solution found");
      expect((yield* settings.getSettings).atopile.command).toBe("");
    }),
  );

  it.effect("cancel interrupts the warm-up, and a second start joins the running install", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      runMock.mockImplementation(() =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      );
      const { installer, settings } = yield* makeHarness({ uvOnPath: true });
      yield* installer.start({});
      yield* Deferred.await(entered);
      const joined = yield* installer.start({ version: "0.1.0" });
      expect(joined).toMatchObject({ phase: "installing", version: "0.15.8" });
      const cancelled = yield* installer.cancel();
      expect(cancelled).toMatchObject({
        phase: "cancelled",
        message: expect.stringContaining("cancelled"),
      } satisfies Partial<AtopileInstallState>);
      yield* Deferred.await(interrupted);
      expect((yield* settings.getSettings).atopile.command).toBe("");
      // Idle again: cancelling with nothing running is a no-op.
      expect((yield* installer.cancel()).phase).toBe("cancelled");
    }),
  );
});
