import { describe, expect, it } from "vite-plus/test";

import {
  createKiCadViewerSessionRenewalGate,
  isKiCadViewerSessionExpiredMessage,
} from "./viewerSessionRenewal.ts";

describe("createKiCadViewerSessionRenewalGate", () => {
  it("re-mints once for a token the user opened", () => {
    const gate = createKiCadViewerSessionRenewalGate();
    gate.minted("t1");
    expect(gate.requestRenewal("t1")).toBe(true);
    // The viewer keeps polling, so repeats for the same token arrive while the mint is in flight.
    expect(gate.requestRenewal("t1")).toBe(false);
  });

  it("does not re-mint again when the automatically minted token is rejected too", () => {
    const gate = createKiCadViewerSessionRenewalGate();
    gate.minted("t1");
    expect(gate.requestRenewal("t1")).toBe(true);
    gate.minted("t2");
    expect(gate.requestRenewal("t2")).toBe(false);
    expect(gate.requestRenewal("t2")).toBe(false);
  });

  it("allows one more automatic re-mint after a scheduled or manual mint", () => {
    const gate = createKiCadViewerSessionRenewalGate();
    gate.minted("t1");
    gate.requestRenewal("t1");
    gate.minted("t2");
    // Near-expiry refresh or the Retry button mints without a viewer report.
    gate.minted("t3");
    expect(gate.requestRenewal("t3")).toBe(true);
    gate.minted("t4");
    expect(gate.requestRenewal("t4")).toBe(false);
  });
});

describe("isKiCadViewerSessionExpiredMessage", () => {
  it("accepts only the viewer's expiry message", () => {
    expect(isKiCadViewerSessionExpiredMessage({ type: "t3cad:session-expired" })).toBe(true);
    expect(isKiCadViewerSessionExpiredMessage({ type: "k3eda-theme" })).toBe(false);
    expect(isKiCadViewerSessionExpiredMessage("t3cad:session-expired")).toBe(false);
    expect(isKiCadViewerSessionExpiredMessage(null)).toBe(false);
  });
});
