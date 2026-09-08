import { createFileRoute } from "@tanstack/react-router";

import { AtopileSettingsPanel } from "../components/settings/AtopileSettingsPanel";

export const Route = createFileRoute("/settings/atopile")({
  component: AtopileSettingsPanel,
});
