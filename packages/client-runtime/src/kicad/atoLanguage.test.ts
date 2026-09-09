import { describe, expect, it } from "vite-plus/test";

import { ATO_SCOPE_NAME, loadAtoLanguageRegistration } from "./atoLanguage.ts";

describe("loadAtoLanguageRegistration", () => {
  it("loads the atopile grammar under the ato language id", async () => {
    const registration = await loadAtoLanguageRegistration();
    expect(registration.name).toBe("ato");
    expect(registration.aliases).toEqual(["atopile"]);
    expect(registration.scopeName).toBe(ATO_SCOPE_NAME);
    expect(registration.patterns.length).toBeGreaterThan(0);
  });
});
