import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ATOPILE_PINNED_VERSION } from "@t3tools/contracts";
import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import {
  formatAtopileCommand,
  formatAtopileInstallProgress,
  formatAtopileToolchainSource,
  formatAtopileToolchainStatusLabel,
  isAtopileInstallRunning,
} from "./atopileToolchain";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TOOLCHAIN_DESCRIPTION =
  "T3CAD uses the ato command below when set, then the T3CAD_ATO_COMMAND environment variable, then ato on PATH, then uv to run the pinned atopile release. Nothing installed? Use Install below.";

const INSTALL_DESCRIPTION =
  "Downloads uv if needed and prepares the chosen atopile release in an isolated tool environment, then sets the ato command below.";

const CONFIGURATION_DESCRIPTION =
  "Saved on this server. Other machines keep their own toolchain settings.";

// Mirrors PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE for a probe rather than a saved value.
const PRIMARY_TOOLCHAIN_UNAVAILABLE_MESSAGE =
  "The toolchain runs on a server, and the hosted app is not anchored to one. Check it from the desktop app or from the server's own address.";

const PENDING_PLACEHOLDER = "…";

function ReadOnlyValue({ children }: { readonly children: ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}

export function AtopileSettingsPanel() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.atopileToolchainStatus({ environmentId, input: {} }),
  );
  const checking = data === null && isPending;
  const statusLabel = data === null ? null : formatAtopileToolchainStatusLabel(data);
  const source = data === null ? null : formatAtopileToolchainSource(data.source);
  const command = data === null ? null : formatAtopileCommand(data.command);

  const atopile = usePrimarySettings((settings) => settings.atopile);
  const updateSettings = useUpdatePrimarySettings();

  const install = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.atopileInstallState({ environmentId, input: {} }),
  ).data;
  const installRunning = install !== null && isAtopileInstallRunning(install.phase);
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startInstall = useAtomCommand(serverEnvironment.startAtopileInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelAtopileInstall, commandOptions);
  const [versionDraft, setVersionDraft] = useState(ATOPILE_PINNED_VERSION);
  const [installError, setInstallError] = useState<string | null>(null);
  const installVersion = versionDraft.trim() || ATOPILE_PINNED_VERSION;
  const installProgress = install === null ? null : formatAtopileInstallProgress(install);
  // The install writes the ato command setting, which the effect below already
  // re-probes on; this covers a reinstall of the same version, where the setting
  // does not change but the tool environment did.
  const installPhaseSeen = useRef(install?.phase);
  useEffect(() => {
    const previous = installPhaseSeen.current;
    installPhaseSeen.current = install?.phase;
    if (install?.phase === "succeeded" && previous !== "succeeded") refresh();
  }, [install?.phase, refresh]);

  async function runInstallCommand(request: () => ReturnType<typeof startInstall>) {
    setInstallError(null);
    const result = await request();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setInstallError(failure instanceof Error ? failure.message : "The install request failed.");
    }
  }
  // The server echoes settings only after it has written them, so re-probing on
  // that echo (not on the edit) shows the Source row what the next build sees.
  const probedFor = useRef(atopile);
  useEffect(() => {
    const previous = probedFor.current;
    if (previous.command === atopile.command && previous.logDir === atopile.logDir) return;
    probedFor.current = atopile;
    refresh();
  }, [atopile, refresh]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="atopile-toolchain"
        title="Toolchain"
        description={TOOLCHAIN_DESCRIPTION}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={environmentId === null || isPending}
            onClick={refresh}
          >
            <RefreshIcon refreshing={isPending} />
            Check again
          </Button>
        }
      >
        {environmentId === null ? (
          <SettingsRow title="Status" description={PRIMARY_TOOLCHAIN_UNAVAILABLE_MESSAGE} />
        ) : (
          <>
            <SettingsRow
              title="Status"
              status={
                error ? (
                  <span className="flex items-start gap-1.5 text-destructive-foreground">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="[overflow-wrap:anywhere]">{error}</span>
                  </span>
                ) : data !== null && !data.available && data.error ? (
                  <span className="[overflow-wrap:anywhere]">{data.error}</span>
                ) : undefined
              }
              control={
                checking ? (
                  <ReadOnlyValue>Checking…</ReadOnlyValue>
                ) : statusLabel === null ? (
                  <ReadOnlyValue>{PENDING_PLACEHOLDER}</ReadOnlyValue>
                ) : (
                  <Badge variant={statusLabel === "Available" ? "success" : "error"}>
                    {statusLabel}
                  </Badge>
                )
              }
            />
            <SettingsRow
              title="Source"
              description="Which resolution step found ato."
              control={
                <ReadOnlyValue>
                  {checking ? PENDING_PLACEHOLDER : (source ?? "Not resolved")}
                </ReadOnlyValue>
              }
            />
            <SettingsRow
              title="Command"
              description="Prefix T3CAD runs for every ato invocation."
              control={
                <ReadOnlyValue>
                  {checking ? (
                    PENDING_PLACEHOLDER
                  ) : command === null ? (
                    "Not resolved"
                  ) : (
                    <code className="font-mono text-xs [overflow-wrap:anywhere]">{command}</code>
                  )}
                </ReadOnlyValue>
              }
            />
            <SettingsRow
              title="Version"
              description="Reported by ato self-check."
              control={
                <ReadOnlyValue>
                  {checking ? PENDING_PLACEHOLDER : (data?.version ?? "Unknown")}
                </ReadOnlyValue>
              }
            />
            <SettingsRow
              title="Log directory"
              description="FBRK_LOG_DIR handed to every ato process."
              control={
                <ReadOnlyValue>
                  {checking ? (
                    PENDING_PLACEHOLDER
                  ) : data?.logDir === undefined ? (
                    "atopile default"
                  ) : (
                    <code className="font-mono text-xs [overflow-wrap:anywhere]">
                      {data.logDir}
                    </code>
                  )}
                </ReadOnlyValue>
              }
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        id={searchableSetting("atopile-install").id}
        title="Install"
        description={INSTALL_DESCRIPTION}
      >
        <SettingsRow
          serverScoped
          title="atopile version"
          description="PyPI release to prepare. Match the project's requires-atopile when it has one."
          control={
            <DraftInput
              size="sm"
              className="w-full font-mono sm:w-40"
              value={versionDraft}
              onCommit={setVersionDraft}
              disabled={installRunning}
              placeholder={ATOPILE_PINNED_VERSION}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="atopile version to install"
            />
          }
        />
        <SettingsRow
          serverScoped
          title="Install"
          description="Runs uv tool run once so the first build does not wait on downloads. Nothing outside uv's own cache and the T3CAD state directory is touched."
          status={
            installError ? (
              <span className="flex items-start gap-1.5 text-destructive-foreground">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="[overflow-wrap:anywhere]">{installError}</span>
              </span>
            ) : installProgress !== null ? (
              <span
                className={
                  install?.phase === "failed"
                    ? "text-destructive-foreground [overflow-wrap:anywhere]"
                    : "[overflow-wrap:anywhere]"
                }
              >
                {installProgress}
              </span>
            ) : undefined
          }
          control={
            installRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void runInstallCommand(() =>
                    cancelInstall({ environmentId: environmentId!, input: {} }),
                  )
                }
              >
                Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={environmentId === null}
                onClick={() =>
                  void runInstallCommand(() =>
                    startInstall({
                      environmentId: environmentId!,
                      input: { version: installVersion },
                    }),
                  )
                }
              >
                Install atopile {installVersion}
              </Button>
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        id={searchableSetting("atopile-configuration").id}
        title="Configuration"
        description={CONFIGURATION_DESCRIPTION}
      >
        <SettingsRow
          serverScoped
          title="ato command"
          description="Full command line. Leave empty to use T3CAD_ATO_COMMAND, then ato on PATH, then the pinned release via uv."
          resetAction={
            atopile.command !== "" ? (
              <SettingResetButton
                label="ato command"
                onClick={() => updateSettings({ atopile: { command: "" } })}
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full font-mono sm:w-72"
              value={atopile.command}
              onCommit={(next) => updateSettings({ atopile: { command: next } })}
              placeholder="uv run --project /path/to/atopile ato"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="ato command"
            />
          }
        />
        <SettingsRow
          serverScoped
          title="Log directory"
          description="Sets FBRK_LOG_DIR, where atopile writes its build logs. Use separate directories when mixing atopile versions on one machine."
          resetAction={
            atopile.logDir !== "" ? (
              <SettingResetButton
                label="log directory"
                onClick={() => updateSettings({ atopile: { logDir: "" } })}
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full font-mono sm:w-72"
              value={atopile.logDir}
              onCommit={(next) => updateSettings({ atopile: { logDir: next } })}
              placeholder=".ato/logs"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="atopile log directory"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
