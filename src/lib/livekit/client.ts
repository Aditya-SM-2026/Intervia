/**
 * Contract shared between the candidate join flow (browser) and the token
 * endpoint (server). Contains no secrets: the token itself is issued for one
 * participant and a limited time, and the URL is required to connect.
 */
export interface LiveKitJoinCredentials {
  token: string;
  url: string;
  identity: string;
}

export const LIVEKIT_TOKEN_ENDPOINT = "/api/livekit/token";