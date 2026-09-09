import { describe, expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AtopileBuildResult,
  AtopileToolchainUnavailableError,
  AuthOrchestrationReadScope,
  AuthSessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";

import * as AtopileToolchain from "../atopile/AtopileToolchain.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { kicadBuildRouteLayer } from "../http.ts";

// Raw `HttpRouter` handlers resolve services at request time from the served
// router's runtime. `Layer.provide` on the routes layer satisfies the types but
// never reaches the handler, which is how POST /api/kicad/build shipped
// answering 500. These tests serve the real route layer and pin both sides.

const ATO_YAML = `
builds:
  default:
    entry: main.ato:App
`;

// Trimmed from real `ato build` output; `parseAtoBuildOutput` needs the box.
const BUILD_SUCCESS_STDOUT = `
╭─ Build Summary ─────────────────────────────────╮
│ ✓ project:default  [de84a54060d144dc]           │
│                                                 │
│ Stages:                                         │
│   ✓ Picking parts [1.11s]                       │
│   ✓ Updating PCB [0.06s]                        │
│                                                 │
│ Total: 1.17s                                    │
╰─────────────────────────────────────────────────╯
10:37:59.293  I  atopile.cli.build  Build successful! 🚀
`;

const readSession: EnvironmentAuth.AuthenticatedSession = {
  sessionId: AuthSessionId.make("kicad-build-test-session"),
  subject: "kicad-build-test",
  method: "bearer-access-token",
  scopes: [AuthOrchestrationReadScope],
};

const EnvironmentAuthTest = Layer.succeed(
  EnvironmentAuth.EnvironmentAuth,
  EnvironmentAuth.EnvironmentAuth.of({
    authenticateHttpRequest: () => Effect.succeed(readSession),
  } as Partial<
    EnvironmentAuth.EnvironmentAuth["Service"]
  > as EnvironmentAuth.EnvironmentAuth["Service"]),
);

const ReadyToolchain = Layer.succeed(
  AtopileToolchain.AtopileToolchain,
  AtopileToolchain.AtopileToolchain.of({
    status: () => Effect.succeed({ available: true, command: ["ato"], source: "path" }),
    run: (input) =>
      Effect.succeed({
        command: ["ato", ...input.args],
        exitCode: 0,
        stdout: BUILD_SUCCESS_STDOUT,
        stderr: "",
        timedOut: false,
      }),
  }),
);

const UNAVAILABLE_DETAIL = "no `ato` on PATH (runtime stub)";
const UnavailableToolchain = Layer.succeed(
  AtopileToolchain.AtopileToolchain,
  AtopileToolchain.AtopileToolchain.of({
    status: () => Effect.succeed({ available: false, command: [], error: UNAVAILABLE_DETAIL }),
    run: () => Effect.fail(new AtopileToolchainUnavailableError({ detail: UNAVAILABLE_DETAIL })),
  }),
);

/** Serve `routes` on the test server and POST `{ build: "default" }` for a fresh ato project. */
const postBuild = <R>(routes: Layer.Layer<never, never, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cad-kicad-build-route-" });
    yield* fs.writeFileString(`${projectDir}/ato.yaml`, ATO_YAML);
    yield* HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.build,
    );
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.post(
      `/api/kicad/build?cwd=${encodeURIComponent(projectDir)}`,
      { body: HttpBody.jsonUnsafe({ build: "default" }) },
    );
    return { projectDir, response };
  });

describe("POST /api/kicad/build", () => {
  it.effect("runs the toolchain from the served runtime and answers a build result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { projectDir, response } = yield* postBuild(kicadBuildRouteLayer);
        expect(response.status).toBe(200);
        const result = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(AtopileBuildResult)),
        );
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.projectDir).toBe(projectDir);
        expect(result.command).toEqual(["ato", "build", "--build", "default"]);
        expect(result.targets.map((target) => [target.name, target.ok])).toEqual([
          ["project:default", true],
        ]);
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeHttpServer.layerTest,
          NodeServices.layer,
          EnvironmentAuthTest,
          ReadyToolchain,
        ),
      ),
    ),
  );

  it.effect("ignores a toolchain provided onto the routes layer instead of the runtime", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The wiring that shipped: the working toolchain sits on the routes
        // layer. The served runtime holds an unavailable one; that is the one
        // the handler must see, so the route reports 503 rather than a build.
        const { response } = yield* postBuild(
          kicadBuildRouteLayer.pipe(Layer.provide(ReadyToolchain)),
        );
        expect(response.status).toBe(503);
        expect(yield* response.text).toContain(UNAVAILABLE_DETAIL);
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeHttpServer.layerTest,
          NodeServices.layer,
          EnvironmentAuthTest,
          UnavailableToolchain,
        ),
      ),
    ),
  );
});
