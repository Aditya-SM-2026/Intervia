/**
 * Contract shared between the candidate join flow (browser) and the verify
 * endpoint (server). Contains no secrets: the token itself is issued for one
 * participant and a limited time, and the URL is required to connect.
 */
export interface LiveKitJoinCredentials {
  token: string;
  url: string;
  identity: string;
}

/** Email gate: issues join credentials only for a verified email + consent. */
export function verifyEndpoint(roomId: string): string {
  return `/api/interviews/${encodeURIComponent(roomId)}/verify`;
}