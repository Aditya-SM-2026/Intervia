/**
 * Contract shared between the candidate join flow (browser) and the verify
 * endpoint (server). Contains no secrets: the token itself is issued for one
 * participant and a limited time, and the URL is required to connect.
 */
export interface LiveKitJoinCredentials {
  token: string;
  url: string;
  identity: string;
  /** Authorises uploading this participant's own recording. */
  recordingToken?: string;
  /**
   * Present only when resuming an interview in progress: seconds still left
   * on the server's clock. The client continues the timer from here instead
   * of restarting it; the server remains authoritative for the deadline.
   */
  remainingSeconds?: number;
  /** How long a dropped candidate may rejoin and resume (server-defined). */
  reconnectGraceSeconds?: number;
  /**
   * Seconds left of the whole-interview pause budget. A candidate who reloads
   * keeps the countdown they had rather than starting a fresh one.
   */
  pauseSecondsLeft?: number;
  /** The whole pause budget, so the client can work out what was spent. */
  pauseBudgetSeconds?: number;
}

/** Email gate: issues join credentials only for a verified email + consent. */
export function verifyEndpoint(roomId: string): string {
  return `/api/interviews/${encodeURIComponent(roomId)}/verify`;
}