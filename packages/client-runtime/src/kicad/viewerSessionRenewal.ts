/** Sent by the standalone KiCad viewer to its host when the server rejects its session token. */
export const KICAD_VIEWER_SESSION_EXPIRED_MESSAGE = "t3cad:session-expired";

export interface KiCadViewerSessionExpiredMessage {
  readonly type: typeof KICAD_VIEWER_SESSION_EXPIRED_MESSAGE;
}

export function isKiCadViewerSessionExpiredMessage(
  data: unknown,
): data is KiCadViewerSessionExpiredMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { readonly type?: unknown }).type === KICAD_VIEWER_SESSION_EXPIRED_MESSAGE
  );
}

/**
 * Decides whether an expiry report from the viewer may be answered with an
 * automatic re-mint. Viewer sessions live in server memory, so a restart
 * invalidates every token while the panel still shows the old page; one
 * silent re-mint per token recovers that. The token produced by that re-mint
 * is never re-minted automatically again, so a server that keeps rejecting
 * tokens ends in the visible expired state instead of a reload loop.
 */
export function createKiCadViewerSessionRenewalGate() {
  let pending = false;
  let autoMintedToken: string | null = null;
  return {
    /** Whether the host should re-mint in response to an expiry report for `token`. */
    requestRenewal(token: string): boolean {
      if (pending || token === autoMintedToken) return false;
      pending = true;
      return true;
    },
    /** Record every minted token; the first mint after an accepted request is the automatic one. */
    minted(token: string): void {
      autoMintedToken = pending ? token : null;
      pending = false;
    },
  };
}
