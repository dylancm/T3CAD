import { RefreshIcon } from "~/components/ui/refresh-icon";
import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import {
  formatAtopileCommand,
  formatAtopileToolchainSource,
  formatAtopileToolchainStatusLabel,
} from "./atopileToolchain";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TOOLCHAIN_DESCRIPTION =
  "T3CAD uses the ato command below when set, then the T3CAD_ATO_COMMAND environment variable, then ato on PATH, then uv to run the pinned atopile release. T3CAD does not install atopile yet.";

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
