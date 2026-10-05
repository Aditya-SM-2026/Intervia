import "server-only";
import { AccessToken } from "livekit-server-sdk";
import { getLiveKitConfig } from "./config";

export interface LiveKitTokenParams {
  roomName: string;
  identity: string;
  displayName?: string;
  /** Marks the participant as a programmatic agent (the AI interviewer). */
  agent?: boolean;
}

/**
 * Token lifetime. Short-lived on purpose: it covers the interview session and
 * its reconnection window, but never days. A 4-hour interview would need a
 * re-issued token (known limitation for v1).
 */
const TOKEN_TTL_MINUTES = 120;

export interface LiveKitToken {
  token: string;
  url: string;
}

export async function generateLiveKitToken({
  roomName,
  identity,
  displayName,
  agent = false,
}: LiveKitTokenParams): Promise<LiveKitToken> {
  const config = getLiveKitConfig();

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: displayName,
    ttl: TOKEN_TTL_MINUTES * 60,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    agent,
  });

  return { token: await token.toJwt(), url: config.url };
}