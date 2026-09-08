import { RefreshIcon } from "~/components/ui/refresh-icon";
import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  formatAtopileCommand,
  formatAtopileToolchainSource,
  formatAtopileToolchainStatusLabel,
} from "./atopileToolchain";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const TOOLCHAIN_DESCRIPTION =
  "T3CAD looks for the T3CAD_ATO_COMMAND environment variable, then ato on PATH, then uv to run the pinned atopile release. T3CAD does not install atopile yet.";

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
          </>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
