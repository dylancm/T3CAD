import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as AtopileToolchain from "../../../atopile/AtopileToolchain.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const environmentId = EnvironmentId.make("environment-ato-test");
const threadId = ThreadId.make("thread-ato-test");
const projectId = ProjectId.make("project-ato-test");

const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-ato-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(),
  issuedAt: 1,
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ato-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const ATO_YAML = `requires-atopile: "^0.14.0"
paths:
  src: ./
  layout: ./layouts
builds:
  default:
    entry: main.ato:App
`;

const BUILD_OUTPUT = `
╭─ Build Summary ───────────────────────────────────────╮
│ ✓ board:default  [abc123]                              │
│ Stages:                                                │
│   ✓ Picking parts [1.11s]                              │
│   ✓ Updating PCB [0.06s]                               │
│ Total: 1.5s                                            │
╰────────────────────────────────────────────────────────╯
Build successful!
`;

/** Concatenated text blocks of a tool result, for asserting on error messages. */
const contentText = (content: ReadonlyArray<{ readonly type: string; readonly text?: string }>) =>
  content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");

/** Snapshot query that knows exactly one thread rooted at `workspaceRoot`. */
const projectionLayer = (workspaceRoot: string) =>
  Layer.succeed(
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery.of({
      getThreadShellById: (id: ThreadId) =>
        Effect.succeed(
          id === threadId
            ? Option.some({ id, projectId, worktreePath: null } as OrchestrationThreadShell)
            : Option.none(),
        ),
      getProjectShellById: (id: ProjectId) =>
        Effect.succeed(
          id === projectId
            ? Option.some({ id, workspaceRoot } as OrchestrationProjectShell)
            : Option.none(),
        ),
    } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]),
  );

/** Toolchain stub that records the run and writes the board the real build would. */
const toolchainLayer = (runs: AtopileToolchain.AtopileRunInput[]) =>
  Layer.effect(
    AtopileToolchain.AtopileToolchain,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return AtopileToolchain.AtopileToolchain.of({
        status: () =>
          Effect.succeed({ available: true, command: ["ato"], source: "path", version: "0.15.8" }),
        run: (input) =>
          Effect.gen(function* () {
            runs.push(input);
            const board = path.join(input.cwd, "layouts", "default", "default.kicad_pcb");
            yield* fs.makeDirectory(path.dirname(board), { recursive: true });
            yield* fs.writeFileString(board, "(kicad_pcb)");
            return {
              command: ["ato"],
              exitCode: 0,
              stdout: BUILD_OUTPUT,
              stderr: "",
              timedOut: false,
            };
          }).pipe(Effect.orDie),
      });
    }),
  );

const withProject = <A, E>(
  body: (
    server: McpServer.McpServer["Service"],
    root: string,
    runs: AtopileToolchain.AtopileRunInput[],
  ) => Effect.Effect<A, E, McpSchema.McpServerClient | McpInvocationContext.McpInvocationContext>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3cad-ato-mcp-" });
      yield* fs.writeFileString(path.join(root, "ato.yaml"), ATO_YAML);
      const runs: AtopileToolchain.AtopileRunInput[] = [];
      const layer = McpHttpServer.AtopileToolkitRegistrationLive.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provideMerge(
          Layer.mergeAll(
            projectionLayer(root),
            toolchainLayer(runs).pipe(Layer.provide(NodeServices.layer)),
            NodeServices.layer,
          ),
        ),
      );
      const server = yield* Effect.service(McpServer.McpServer).pipe(Effect.provide(layer));
      return yield* body(server, root, runs).pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer));

it.effect("ato_project describes the workspace project from ato.yaml", () =>
  withProject((server, root) =>
    Effect.gen(function* () {
      const result = yield* server.callTool({ name: "ato_project", arguments: {} });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        projectDir: root,
        layoutDir: "layouts",
        builds: [
          {
            name: "default",
            entry: "main.ato:App",
            layoutPcb: "layouts/default/default.kicad_pcb",
            layoutExists: false,
          },
        ],
      });
    }),
  ),
);

it.effect("ato_build runs the toolchain in the project and reports stages and artifacts", () =>
  withProject((server, root, runs) =>
    Effect.gen(function* () {
      const result = yield* server.callTool({
        name: "ato_build",
        arguments: { build: "default", targets: ["mfg-data"] },
      });
      expect(result.isError).toBe(false);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.cwd).toBe(root);
      expect(runs[0]!.args).toEqual(["build", "--build", "default", "--target", "mfg-data"]);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        exitCode: 0,
        command: ["ato"],
        projectDir: root,
        targets: [{ name: "board:default", ok: true, totalSeconds: 1.5 }],
        errors: [],
        artifacts: [{ kind: "pcb", path: "layouts/default/default.kicad_pcb" }],
      });
    }),
  ),
);

it.effect("ato_build rejects an unknown build name and an escaping projectDir", () =>
  withProject((server, _root, runs) =>
    Effect.gen(function* () {
      const unknownBuild = yield* server.callTool({
        name: "ato_build",
        arguments: { build: "nope" },
      });
      expect(unknownBuild.isError).toBe(true);
      expect(contentText(unknownBuild.content)).toContain("Build nope is not defined in ato.yaml");
      const escaping = yield* server.callTool({
        name: "ato_project",
        arguments: { projectDir: "../../etc" },
      });
      expect(escaping.isError).toBe(true);
      expect(contentText(escaping.content)).toContain("outside the workspace");
      expect(runs).toHaveLength(0);
    }),
  ),
);
